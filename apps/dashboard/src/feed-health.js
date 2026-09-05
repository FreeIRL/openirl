export class FeedHealth {
  constructor({ idleMs = 60000, lowKbps = 1200, offlineKbps = 200, staleMs = 5000 } = {}) {
    Object.assign(this, { idleMs, lowKbps, offlineKbps, staleMs }); this.states = new Map();
  }
  sample(feed, sample, now = Date.now()) {
    const previous = this.states.get(feed.id);
    const age = now - sample?.timestamp;
    const fresh = sample && !sample.error && Number.isFinite(age) && age >= 0 && age <= this.staleMs;
    const connected = Boolean(feed.enabled && fresh && sample.connected);
    const bitrate = connected ? Math.max(0, sample.bitrate || 0) : 0;
    const offlineSince = connected ? null : previous?.offlineSince ?? now;
    let state = 'IDLE';
    if (feed.enabled) {
      if (connected) state = !previous?.connected ? 'CONNECTING' : bitrate >= this.lowKbps ? 'ONLINE' : bitrate >= this.offlineKbps ? 'DEGRADED' : 'OFFLINE';
      else state = now - offlineSince >= this.idleMs ? 'IDLE' : 'OFFLINE';
    }
    const result = { state, connected, bitrate, timestamp: sample?.timestamp || 0, offlineSince, telemetryFresh: Boolean(fresh) };
    this.states.set(feed.id, result); return result;
  }
}
export function profileHealth(profile, states) {
  const values = profile.feedIds.map(id => {
    const value = states.get(id);
    if (value?.timestamp !== undefined && Date.now() - value.timestamp > 5000) return 'OFFLINE';
    return value?.state || 'IDLE';
  });
  const healthy = values.filter(v => v === 'ONLINE').length;
  const usable = values.filter(v => ['ONLINE', 'DEGRADED'].includes(v)).length;
  return { state: healthy >= profile.minimumHealthy ? 'normal' : usable >= profile.minimumHealthy ? 'low' : 'offline', healthy, usable, required: profile.minimumHealthy };
}
export class ProductionController {
  constructor({ registry, health, obs, owner = 'noalbs', settleMs = 3000 }) {
    Object.assign(this, { registry, health, obs, owner, settleMs }); this.candidate = null; this.working = false; this.paused = false;
  }
  async take(body) {
    if (this.owner !== 'openirl') throw new Error('Set automation owner to openirl after stopping NOALBS scene switching');
    if (this.working || !this.obs.snapshot().connected) throw new Error('Controller busy or OBS disconnected');
    this.working = true;
    try {
      const p = this.registry.state.profiles.find(p => p.id === body.id);
      if (!p || body.revision !== this.registry.state.revision) throw new Error('Reload production profiles');
      const scenes = await this.obs.request('GetSceneList');
      if (![p.scene, p.lowScene, p.offlineScene].every(s => scenes.scenes.some(item => item.sceneName === s))) throw new Error('Create all profile scenes in OBS first');
      await this.registry.change('select-profile', body);
      this.paused = true;
      await this.apply(p); this.candidate = null; this.paused = false;
    } finally { this.working = false; }
  }
  async manualScene(scene) {
    if (this.working) throw new Error('Scene controller busy; wait before changing scenes');
    this.working = true;
    this.paused = true;
    this.candidate = null;
    try { await this.obs.setScene(scene); } finally { this.working = false; }
  }
  async apply(p) {
    const state = profileHealth(p, this.health.states).state;
    await this.obs.setScene(state === 'normal' ? p.scene : state === 'low' ? p.lowScene : p.offlineScene);
  }
  async tick(now = Date.now()) {
    if (this.owner !== 'openirl' || this.working || this.paused || !this.obs.snapshot().connected) return;
    const p = this.registry.state.profiles.find(p => p.id === this.registry.state.selectedProfileId);
    if (!p) return;
    const current = this.obs.snapshot().scene;
    // Respect privacy/starting/other manually selected scenes until the operator takes a profile.
    if (current && ![p.scene, p.lowScene, p.offlineScene].includes(current)) { this.paused = true; return; }
    const target = `${p.id}:${profileHealth(p, this.health.states).state}`;
    if (this.candidate?.target !== target) { this.candidate = { target, since: now }; return; }
    if (now - this.candidate.since < this.settleMs) return;
    const state = profileHealth(p, this.health.states).state;
    const scene = state === 'normal' ? p.scene : state === 'low' ? p.lowScene : p.offlineScene;
    if (scene === current) return;
    this.working = true;
    try { await this.obs.setScene(scene); } finally { this.working = false; }
  }
}
