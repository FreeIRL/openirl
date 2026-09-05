import http from 'node:http';
import { FeedRegistry, connectionDetails, matches } from './feed-registry.js';
import { FeedHealth, ProductionController, profileHealth } from './feed-health.js';
import { Snapshots } from './snapshots.js';
import { FeedTracker, findSample, parsePrometheus } from './metrics.js';

const loopback = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
export async function readBody(request) {
  let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 16384) throw new Error('Request too large'); }
  const result = JSON.parse(body || '{}');
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected an object'); return result;
}
function reply(response, status, data) { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); }
export class MultiIngest {
  static async start(obs, env = process.env) {
    if (!['openirl', 'noalbs'].includes(env.OPENIRL_AUTOMATION_OWNER || 'noalbs')) throw new Error('Invalid OPENIRL_AUTOMATION_OWNER');
    const registry = await FeedRegistry.load(env.OPENIRL_REGISTRY_PATH || '/data/registry.json', env);
    const result = new MultiIngest(registry, obs, env);
    await new Promise((resolve, reject) => {
      result.authServer = http.createServer((req, res) => result.authRequest(req, res));
      result.authServer.once('error', reject); result.authServer.listen(Number(env.OPENIRL_AUTH_PORT || 8081), '127.0.0.1', resolve);
    });
    result.timer = setInterval(() => result.poll(), 1000); result.timer.unref(); await result.poll(); return result;
  }
  constructor(registry, obs, env = {}) {
    this.registry = registry; this.env = env; this.trackers = new Map(); this.health = new FeedHealth();
    this.snapshots = new Snapshots({ baseUrl: env.OPENIRL_SNAPSHOT_SOURCE || 'rtmp://127.0.0.1:1935' });
    this.controller = new ProductionController({ registry, health: this.health, obs, owner: env.OPENIRL_AUTOMATION_OWNER || 'noalbs' });
    this.api = env.OPENIRL_MEDIAMTX_API_URL || 'http://127.0.0.1:9997'; this.polling = false; this.reconciling = false; this.reconcileIndex = 0; this.error = 'Waiting for telemetry';
  }
  async mtx(path, method = 'GET') {
    const r = await fetch(`${this.api}/v3/${path}`, { method, signal: AbortSignal.timeout(2000) });
    if (!r.ok) { const error = new Error('MediaMTX operation failed'); error.status = r.status; throw error; } return r.status === 204 ? null : r.json();
  }
  async authenticate(body) {
    if (body.action === 'read') return loopback(body.ip); // OBS/snapshots only; never public playback.
    if (body.action !== 'publish') return false;
    const feed = this.registry.state.feeds.find(f => f.path === body.path);
    if (!feed?.enabled || body.user !== feed.username || !matches(body.password, feed.passwordHash)) return false;
    let protocol;
    if (body.protocol === 'srt') {
      // The host-network SRTLA receiver forwards locally. Remote direct SRT retains its remote IP.
      protocol = loopback(body.ip) ? 'srtla' : 'srt';
    } else if (body.protocol === 'rtmp' && /^[a-f0-9-]{36}$/.test(body.id || '')) {
      // MediaMTX reports both transports as "rtmp"; verify the connection in its TLS-only API collection.
      try { await this.mtx(`rtmpsconns/get/${body.id}`); protocol = 'rtmps'; }
      catch { try { await this.mtx(`rtmpconns/get/${body.id}`); protocol = 'rtmp'; } catch { return false; } }
    } else return false;
    const current = this.registry.state.feeds.find(f => f.id === feed.id);
    return Boolean(current?.enabled && current.protocols.includes(protocol) && current.username === body.user && matches(body.password, current.passwordHash));
  }
  async authRequest(req, res) {
    if (!loopback(req.socket.remoteAddress) || req.method !== 'POST' || req.url !== '/auth') return reply(res, 404, {});
    try { reply(res, await this.authenticate(await readBody(req)) ? 200 : 401, {}); } catch { reply(res, 401, {}); }
  }
  async disconnect(feed) {
    let path; try { path = await this.mtx(`paths/get/${encodeURIComponent(feed.path)}`); } catch (error) { if (error.status === 404) return; throw error; }
    const collections = { srtConn: 'srtconns', rtmpConn: 'rtmpconns', rtmpsConn: 'rtmpsconns' };
    if (path.source && (!collections[path.source.type] || !/^[a-f0-9-]{36}$/.test(path.source.id))) throw new Error('Cannot safely disconnect this publisher');
    if (path.source) await this.mtx(`${collections[path.source.type]}/kick/${path.source.id}`, 'POST');
  }
  async poll() {
    if (this.polling) return; this.polling = true;
    try {
      let samples = [], error = null;
      try {
        const r = await fetch(this.env.OPENIRL_MEDIAMTX_METRICS_URL || 'http://127.0.0.1:9998/metrics', { signal: AbortSignal.timeout(2000) });
        if (!r.ok) throw new Error(); samples = parsePrometheus(await r.text());
      } catch { error = 'MediaMTX telemetry unavailable'; }
      this.error = error; const now = Date.now();
      const toDisconnect = [];
      for (const feed of this.registry.state.feeds) {
        if (!this.trackers.has(feed.id)) this.trackers.set(feed.id, new FeedTracker());
        const labels = { name: feed.path, state: 'ready' };
        const stats = this.trackers.get(feed.id).sample({ bytes: findSample(samples, 'paths_inbound_bytes', labels)?.value || 0,
          connected: findSample(samples, 'paths', labels)?.value === 1, timestamp: now });
        this.health.sample(feed, { ...stats, timestamp: now, error }, now);
        if (!feed.enabled && stats.connected) toDisconnect.push(feed);
      }
      // Oldest attempts first; global concurrency and cooldown apply across viewers.
      const snapshotOrder = [...this.registry.state.feeds].sort((a, b) => (this.snapshots.attempts.get(a.id) ?? -Infinity) - (this.snapshots.attempts.get(b.id) ?? -Infinity));
      for (const feed of snapshotOrder) void this.snapshots.refresh(feed, this.health.states.get(feed.id));
      const ids = new Set(this.registry.state.feeds.map(f => f.id));
      for (const id of this.trackers.keys()) if (!ids.has(id)) { this.trackers.delete(id); this.health.states.delete(id); }
      this.snapshots.prune(this.registry.state.feeds);
      await this.controller.tick(now);
      // A broken disabled publisher must not prevent selected-profile health evaluation.
      if (toDisconnect.length && !this.reconciling) {
        const feed = toDisconnect[this.reconcileIndex++ % toDisconnect.length];
        this.reconciling = true;
        void this.disconnect(feed).catch(() => { this.error = 'Disabled publisher disconnect pending; MediaMTX unavailable'; })
          .finally(() => { this.reconciling = false; });
      }
    } catch { this.error = 'Controller operation failed; check OBS and MediaMTX'; }
    finally { this.polling = false; }
  }
  status() {
    const state = this.registry.publicState();
    return { ...state, automationOwner: this.controller.owner, automationPaused: this.controller.paused, error: this.error,
      feeds: state.feeds.map(f => ({ ...f, health: this.health.states.get(f.id), preview: this.snapshots.status(f.id) })),
      profiles: state.profiles.map(p => ({ ...p, health: profileHealth(p, this.health.states) })) };
  }
  async request(req, res, url, authorized) {
    if (req.method === 'GET' && url.pathname === '/api/v1/production') { reply(res, 200, this.status()); return true; }
    if (req.method === 'GET' && url.pathname.startsWith('/api/v1/snapshots/')) {
      const id = url.pathname.slice('/api/v1/snapshots/'.length), frame = this.snapshots.frames.get(id);
      if (!this.registry.state.feeds.some(f => f.id === id) || !frame) reply(res, 404, { error: 'Snapshot unavailable' });
      else { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }); res.end(frame.image); } return true;
    }
    if (!url.pathname.startsWith('/api/v1/control/production/')) return false;
    if (req.method !== 'POST') { reply(res, 405, {}); return true; }
    if (!authorized(req)) { reply(res, 401, { error: 'Valid control token required' }); return true; }
    try {
      const body = await readBody(req), action = url.pathname.split('/').at(-1);
      if (action === 'details') {
        const feed = this.registry.state.feeds.find(f => f.id === body.id);
        if (!feed) throw new Error('Feed not found');
        reply(res, 200, { ...connectionDetails(feed, this.env.OPENIRL_INGEST_HOST), obs: { sourceUrl: `rtmp://127.0.0.1:1935/${feed.path}` } });
      } else if (action === 'refresh') {
        const feed = this.registry.state.feeds.find(f => f.id === body.id);
        if (!feed) throw new Error('Feed not found');
        const ok = await this.snapshots.refresh(feed, this.health.states.get(feed.id));
        reply(res, ok ? 200 : 429, ok ? this.snapshots.status(feed.id) : { error: 'Snapshot unavailable, already running, or within the 10 second cooldown' });
      } else if (action === 'take') {
        await this.controller.take(body); reply(res, 200, this.status());
      } else {
        if (['delete-feed', 'rotate-feed'].includes(action)) {
          const feed = this.registry.state.feeds.find(f => f.id === body.id);
          if (!feed || feed.enabled) throw new Error('Disable the feed first');
          await this.disconnect(feed);
        }
        await this.registry.change(action, body);
        const feed = this.registry.state.feeds.find(f => f.id === body.id);
        if (feed && !feed.enabled) { this.health.sample(feed, null); await this.disconnect(feed); }
        reply(res, 200, this.status());
      }
    } catch (error) { reply(res, 400, { error: error.message }); }
    return true;
  }
}
