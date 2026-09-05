import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export const protocols = ['srtla', 'srt', 'rtmp', 'rtmps'];
const name = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
export const hash = value => 'sha256:' + createHash('sha256').update(value).digest('base64');
export function matches(secret, digest) {
  if (typeof secret !== 'string' || typeof digest !== 'string') return false;
  const a = Buffer.from(hash(secret)), b = Buffer.from(digest);
  return a.length === b.length && timingSafeEqual(a, b);
}
function fail(message) { throw new Error(message); }
function validateFeed(feed) {
  if (!name(feed.name) || !['mobile', 'encoder'].includes(feed.type) || typeof feed.enabled !== 'boolean' ||
      !Array.isArray(feed.protocols) || !feed.protocols.length || new Set(feed.protocols).size !== feed.protocols.length ||
      feed.protocols.some(p => !protocols.includes(p))) fail('Invalid feed name, preset, enabled flag or protocols');
}
function validateProfile(profile, feeds) {
  if (!name(profile.name) || ![profile.scene, profile.lowScene, profile.offlineScene].every(name) ||
      !Array.isArray(profile.feedIds) || !profile.feedIds.length || new Set(profile.feedIds).size !== profile.feedIds.length ||
      profile.feedIds.some(id => !feeds.some(f => f.id === id)) || !Number.isInteger(profile.minimumHealthy) ||
      profile.minimumHealthy < 1 || profile.minimumHealthy > profile.feedIds.length) fail('Invalid profile scenes, feeds or minimum healthy count');
}
export class FeedRegistry {
  constructor(file, state) { this.file = file; this.state = state; this.pending = Promise.resolve(); }
  static async load(file, env = process.env) {
    let state;
    try {
      state = JSON.parse(await readFile(file, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.feeds) || !Array.isArray(state.profiles)) fail('Unsupported registry');
      for (const f of state.feeds) {
        validateFeed(f);
        if (!/^[a-zA-Z0-9_-]+$/.test(f.id) || f.path !== `live/${f.id}` || !/^sha256:[A-Za-z0-9+/]{43}=$/.test(f.passwordHash || '') || !/^[a-zA-Z0-9_-]+$/.test(f.username || '') || (f.secret !== null && (typeof f.secret !== 'string' || !matches(f.secret, f.passwordHash)))) fail('Invalid stored feed');
      }
      if (!Number.isSafeInteger(state.revision) || state.revision < 0) fail('Invalid revision');
      if (new Set(state.profiles.map(p => p.id)).size !== state.profiles.length) fail('Duplicate profiles');
      if (new Set(state.feeds.map(f => f.id)).size !== state.feeds.length) fail('Duplicate feed IDs');
      state.profiles.forEach(p => validateProfile(p, state.feeds));
      if (state.selectedProfileId && !state.profiles.some(p => p.id === state.selectedProfileId)) fail('Invalid selected profile');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error; // Never overwrite a corrupt registry or rotate credentials on boot.
      const id = env.FEED_ID || 'feed-1';
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail('Invalid FEED_ID');
      if (!/^sha256:[A-Za-z0-9+/]{43}=$/.test(env.FEED_1_PASSWORD_HASH || '')) fail('Existing FEED_1_PASSWORD_HASH required for migration');
      state = { version: 1, revision: 0, selectedProfileId: 'legacy', feeds: [{ id, path: `live/${id}`, name: 'Main Ingest', type: 'mobile', enabled: true,
        protocols: [...protocols], username: 'openirl-feed-1', passwordHash: env.FEED_1_PASSWORD_HASH, secret: null }],
      profiles: [{ id: 'legacy', name: 'Main Ingest', scene: 'Live', lowScene: 'Low Bitrate', offlineScene: 'BRB', feedIds: [id], minimumHealthy: 1 }] };
      const registry = new FeedRegistry(file, state); await registry.persist(state); return registry;
    }
    return new FeedRegistry(file, state);
  }
  async persist(state) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    const handle = await open(tmp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(state, null, 2)); await handle.sync(); } finally { await handle.close(); }
    await rename(tmp, this.file);
  }
  publicState() {
    return { ...this.state, feeds: this.state.feeds.map(({ secret, passwordHash, username, ...feed }) => feed) };
  }
  change(action, body) {
    const job = this.pending.then(async () => {
      if (!body || body.revision !== this.state.revision) fail('Registry changed; reload before making this change');
      const next = structuredClone(this.state);
      const feed = next.feeds.find(f => f.id === body.id);
      const profile = next.profiles.find(p => p.id === body.id);
      if (action === 'add-feed') {
        const id = `feed-${randomUUID()}`, secret = randomBytes(32).toString('base64url');
        const f = { id, path: `live/${id}`, name: body.name, type: body.type, protocols: body.protocols, enabled: true,
          username: id, secret, passwordHash: hash(secret) }; validateFeed(f); next.feeds.push(f);
      } else if (action === 'update-feed') {
        if (!feed) fail('Feed not found');
        if (body.protocols && feed.enabled) fail('Disable the feed before changing protocols');
        if (body.enabled === false && body.confirm !== feed.id) fail('Confirm the feed ID before disconnecting it');
        for (const key of ['name', 'type', 'protocols', 'enabled']) if (body[key] !== undefined) feed[key] = body[key];
        validateFeed(feed);
      } else if (action === 'delete-feed' || action === 'rotate-feed') {
        if (!feed || feed.enabled || body.confirm !== feed.id) fail('Disable the feed and confirm its ID first');
        if (action === 'delete-feed') {
          if (next.profiles.some(p => p.feedIds.includes(feed.id))) fail('Remove this feed from production profiles first');
          next.feeds = next.feeds.filter(f => f.id !== feed.id);
        } else {
          feed.secret = randomBytes(32).toString('base64url'); feed.passwordHash = hash(feed.secret);
        }
      } else if (action === 'save-profile') {
        const p = { id: profile?.id || `profile-${randomUUID()}`, name: body.name, scene: body.scene, lowScene: body.lowScene,
          offlineScene: body.offlineScene, feedIds: body.feedIds, minimumHealthy: body.minimumHealthy };
        validateProfile(p, next.feeds);
        if (profile && next.selectedProfileId === profile.id) fail('Select a different profile before editing this one');
        next.profiles = [...next.profiles.filter(item => item.id !== p.id), p];
      } else if (action === 'delete-profile') {
        if (!profile || next.selectedProfileId === profile.id) fail('Cannot delete the selected profile');
        next.profiles = next.profiles.filter(p => p.id !== profile.id);
      } else if (action === 'select-profile') {
        if (!profile) fail('Profile not found'); next.selectedProfileId = profile.id;
      } else fail('Unknown registry action');
      next.revision++; await this.persist(next); this.state = next; return this.publicState();
    });
    this.pending = job.catch(() => {}); return job;
  }
}

export function connectionDetails(feed, host, ports = {}) {
  if (!/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)$/.test(host || '')) fail('Set OPENIRL_INGEST_HOST to an ingest hostname or IPv4 address');
  if (!feed.secret) return { note: 'Existing secret is not recoverable from its hash. Keep current encoder settings, or disable and rotate this feed.' };
  const streamId = `publish:${feed.path}:${feed.username}:${feed.secret}`;
  return Object.fromEntries(feed.protocols.map(protocol => {
    if (protocol === 'srtla') return [protocol, { server: `srtla://${host}:${ports.srtla || 5000}`, streamId }];
    if (protocol === 'srt') return [protocol, { url: `srt://${host}:${ports.srt || 8890}?streamid=${streamId}` }];
    return [protocol, { server: `${protocol}://${host}:${ports[protocol] || (protocol === 'rtmps' ? 1936 : 1935)}/live`,
      streamKey: `${feed.id}?user=${encodeURIComponent(feed.username)}&pass=${encodeURIComponent(feed.secret)}` }];
  }));
}
