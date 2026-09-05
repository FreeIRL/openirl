import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeedRegistry, hash, matches, connectionDetails } from '../src/feed-registry.js';
import { FeedHealth, profileHealth, ProductionController } from '../src/feed-health.js';
import { Snapshots } from '../src/snapshots.js';
import { MultiIngest } from '../src/multi-ingest.js';
import { FeedTracker } from '../src/metrics.js';
const env = { FEED_1_PASSWORD_HASH: hash('legacy-secret') };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'openirl-registry-')); t.after(() => rm(dir, { recursive: true, force: true }));
  return FeedRegistry.load(join(dir, 'registry.json'), env);
}
const change = (r, action, body = {}) => r.change(action, { revision: r.state.revision, ...body });

test('migration preserves credentials; reload never rotates; public state is secret-free', async t => {
  const r = await fixture(t); assert.equal(r.state.feeds[0].passwordHash, env.FEED_1_PASSWORD_HASH);
  assert.equal(matches('legacy-secret', r.state.feeds[0].passwordHash), true);
  await change(r, 'add-feed', { name: 'Phone', type: 'encoder', protocols: ['srtla', 'rtmp'] });
  const f = r.state.feeds[1]; assert.ok(matches(f.secret, f.passwordHash));
  assert.doesNotMatch(JSON.stringify(r.publicState()), /passwordHash|secret|username/);
  assert.deepEqual((await FeedRegistry.load(r.file, env)).state, r.state);
  assert.equal((await stat(r.file)).mode & 0o777, 0o600);
  await writeFile(r.file, '{'); await assert.rejects(FeedRegistry.load(r.file, env));
});
test('mutations validate protocols, version, references and rotation guards', async t => {
  const r = await fixture(t);
  await assert.rejects(change(r, 'add-feed', { name: 'bad', type: 'mobile', protocols: ['http'] }));
  await change(r, 'add-feed', { name: 'Guest', type: 'mobile', protocols: ['rtmps'] });
  const f = r.state.feeds[1], original = f.secret;
  await assert.rejects(change(r, 'rotate-feed', { id: f.id, confirm: f.id }));
  await assert.rejects(change(r, 'update-feed', { id: f.id, enabled: false }));
  await change(r, 'update-feed', { id: f.id, enabled: false, confirm: f.id });
  await change(r, 'rotate-feed', { id: f.id, confirm: f.id });
  assert.equal(matches(original, r.state.feeds[1].passwordHash), false);
  await assert.rejects(r.change('update-feed', { revision: 0, id: f.id, name: 'stale' }));
  await change(r, 'save-profile', { name: 'Duo', scene: 'DUO', lowScene: 'Low', offlineScene: 'BRB', feedIds: ['feed-1', f.id], minimumHealthy: 1 });
  await assert.rejects(change(r, 'delete-feed', { id: f.id, confirm: f.id }));
  await change(r, 'delete-profile', { id: r.state.profiles[1].id });
  await change(r, 'delete-feed', { id: f.id, confirm: f.id }); assert.equal(r.state.feeds.length, 1);
});
test('concurrent writes reject stale revisions and failed persistence does not publish state', async t => {
  const r = await fixture(t), body = { revision: 0, id: 'feed-1', name: 'New name' };
  const results = await Promise.allSettled([r.change('update-feed', body), r.change('update-feed', body)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  r.persist = async () => { throw new Error('disk full'); };
  await assert.rejects(change(r, 'update-feed', { id: 'feed-1', name: 'Lost' }));
  assert.equal(r.state.feeds[0].name, 'New name');
});
test('protocol connection details use MediaMTX formats and refuse arbitrary URL hosts', async t => {
  const r = await fixture(t); await change(r, 'add-feed', { name: 'Camera', type: 'encoder', protocols: ['srtla', 'srt', 'rtmp', 'rtmps'] });
  const f = r.state.feeds[1], d = connectionDetails(f, 'ingest.example.com');
  assert.equal(new URL(d.srt.url).searchParams.get('streamid'), d.srtla.streamId);
  assert.match(d.rtmps.server, /^rtmps:.*:1936\/live$/); assert.ok(d.rtmp.streamKey.includes(f.id));
  assert.throws(() => connectionDetails(f, 'evil/path?x=1')); assert.ok(connectionDetails(r.state.feeds[0], 'localhost').note);
});
test('lifecycle becomes idle at 60s; reconnection warms up; stale metrics fail closed', () => {
  const h = new FeedHealth(), f = { id: 'a', enabled: true };
  assert.equal(h.sample(f, { timestamp: 1000, connected: false }, 1000).state, 'OFFLINE');
  assert.equal(h.sample(f, { timestamp: 61000, connected: false }, 61000).state, 'IDLE');
  assert.equal(h.sample(f, { timestamp: 62000, connected: true, bitrate: 2000 }, 62000).state, 'CONNECTING');
  assert.equal(h.sample(f, { timestamp: 63000, connected: true, bitrate: 2000 }, 63000).state, 'ONLINE');
  assert.equal(h.sample(f, { timestamp: 64000, connected: true, bitrate: 600 }, 64000).state, 'DEGRADED');
  assert.equal(h.sample(f, { timestamp: 64000, connected: true, bitrate: 600 }, 70000).state, 'OFFLINE');
  assert.equal(h.sample({ ...f, enabled: false }, {}, 71000).state, 'IDLE');
});
test('profile quorum ignores unrelated feeds and differentiates low from offline', () => {
  const p = { feedIds: ['a', 'b'], minimumHealthy: 1 }, states = new Map([['a', { state: 'ONLINE' }], ['b', { state: 'OFFLINE' }], ['other', { state: 'OFFLINE' }]]);
  assert.equal(profileHealth(p, states).state, 'normal'); states.get('a').state = 'DEGRADED';
  assert.equal(profileHealth(p, states).state, 'low'); p.minimumHealthy = 2;
  assert.equal(profileHealth(p, states).state, 'offline'); states.get('other').state = 'ONLINE';
  assert.equal(profileHealth(p, states).state, 'offline');
});
test('single controller respects ownership, manual scenes, profile selection and settle delay', async t => {
  const r = await fixture(t), h = new FeedHealth(); h.states.set('feed-1', { state: 'ONLINE' });
  let scene = 'Live'; const calls = [], obs = { snapshot: () => ({ connected: true, scene }), setScene: async s => { scene = s; calls.push(s); }, request: async () => ({ scenes: ['Live', 'Low Bitrate', 'BRB'].map(sceneName => ({ sceneName })) }) };
  const c = new ProductionController({ registry: r, health: h, obs }); await assert.rejects(c.take({ id: 'legacy', revision: 0 }));
  await c.tick(1); assert.equal(calls.length, 0); c.owner = 'openirl';
  await c.take({ id: 'legacy', revision: 0 }); assert.deepEqual(calls, ['Live']);
  h.states.get('feed-1').state = 'OFFLINE'; await c.tick(100); await c.tick(200); assert.equal(scene, 'Live');
  await c.tick(3200); assert.equal(scene, 'BRB'); scene = 'Privacy'; await c.tick(3300); assert.equal(c.paused, true);
  h.states.get('feed-1').state = 'ONLINE'; await c.tick(9000); assert.equal(scene, 'Privacy');
});
test('snapshots are bounded, retain last frame on failure and do no work offline or idle', async () => {
  let count = 0, reject = false; const s = new Snapshots({ reader: async () => { count++; if (reject) throw Error(); return Buffer.from('frame'); } });
  const f = { id: 'a', path: 'live/a', enabled: true };
  assert.equal(await s.refresh(f, { state: 'ONLINE' }, 0), true);
  assert.equal(await s.refresh(f, { state: 'ONLINE' }, 9999), false);
  reject = true; assert.equal(await s.refresh(f, { state: 'ONLINE' }, 10000), false); assert.equal(s.status('a').available, true);
  await s.refresh(f, { state: 'IDLE' }, 20000); await s.refresh(f, { state: 'OFFLINE' }, 30000); assert.equal(count, 2);
});
test('publisher authentication checks path, credentials, enabled state and actual transport', async t => {
  const r = await fixture(t), m = new MultiIngest(r, {}, {});
  const b = { action: 'publish', path: 'live/feed-1', user: 'openirl-feed-1', password: 'legacy-secret', protocol: 'srt', ip: '127.0.0.1' };
  assert.equal(await m.authenticate(b), true);
  for (const patch of [{ password: 'wrong' }, { path: 'live/other' }, { action: 'api' }, { protocol: 'rtsp' }]) assert.equal(await m.authenticate({ ...b, ...patch }), false);
  r.state.feeds[0].protocols = ['rtmps']; assert.equal(await m.authenticate(b), false);
  m.mtx = async path => { if (!path.startsWith('rtmpsconns/')) throw Error(); return {}; };
  assert.equal(await m.authenticate({ ...b, protocol: 'rtmp', id: '12345678-1234-1234-1234-123456789abc' }), true);
  m.mtx = async path => { if (!path.startsWith('rtmpconns/')) throw Error(); return {}; };
  assert.equal(await m.authenticate({ ...b, protocol: 'rtmp', id: '12345678-1234-1234-1234-123456789abc' }), false);
  r.state.feeds[0].enabled = false; assert.equal(await m.authenticate(b), false);
  assert.equal(await m.authenticate({ action: 'read', ip: '192.0.2.1' }), false);
});
test('byte counters do not generate a false healthy spike after reconnect', () => {
  const t = new FeedTracker(); t.sample({ connected: false, bytes: 0, timestamp: 1000 });
  assert.equal(t.sample({ connected: true, bytes: 10000000, timestamp: 2000 }).bitrate, 0);
});

test('production HTTP mutations and credential reads require control authorization', async t => {
  const r = await fixture(t), m = new MultiIngest(r, {}, {});
  for (const action of ['add-feed', 'rotate-feed', 'delete-feed', 'take', 'details', 'refresh']) {
    let code, output;
    const req = { method: 'POST' }, res = { writeHead: c => { code = c; }, end: body => { output = body; } };
    assert.equal(await m.request(req, res, new URL(`http://localhost/api/v1/control/production/${action}`), () => false), true);
    assert.equal(code, 401); assert.doesNotMatch(output, /legacy-secret/);
  }
  assert.equal(r.state.revision, 0);
});
test('authentication in flight cannot survive a concurrent disable', async t => {
  const r = await fixture(t), m = new MultiIngest(r, {}, {});
  m.mtx = async () => { await change(r, 'update-feed', { id: 'feed-1', enabled: false, confirm: 'feed-1' }); return {}; };
  assert.equal(await m.authenticate({ action: 'publish', path: 'live/feed-1', user: 'openirl-feed-1', password: 'legacy-secret', protocol: 'rtmp', id: '12345678-1234-1234-1234-123456789abc' }), false);
});

test('snapshot requests from multiple viewers share a two-worker limit', async () => {
  const pending = []; const s = new Snapshots({ reader: () => new Promise(resolve => pending.push(resolve)) });
  const f = id => ({ id, path: `live/${id}`, enabled: true }), healthy = { state: 'ONLINE' };
  const a = s.refresh(f('a'), healthy, 1000), b = s.refresh(f('b'), healthy, 1000);
  assert.equal(await s.refresh(f('a'), healthy, 20000), false);
  assert.equal(await s.refresh(f('c'), healthy, 1000), false); assert.equal(pending.length, 2);
  pending.forEach(resolve => resolve(Buffer.from('frame'))); await Promise.all([a, b]); assert.equal(s.running.size, 0);
});
test('dashboard and legacy telemetry use the same counter parsing implementation', async () => {
  assert.equal(await readFile(new URL('../src/metrics.js', import.meta.url), 'utf8'), await readFile(new URL('../../../services/stats-bridge/src/metrics.js', import.meta.url), 'utf8'));
});

test('profile evaluation cannot use healthy telemetry after it becomes stale', () => {
  const states = new Map([['a', { state: 'ONLINE', timestamp: Date.now() - 6000 }]]);
  assert.equal(profileHealth({ feedIds: ['a'], minimumHealthy: 1 }, states).state, 'offline');
});

test('a stuck disabled publisher does not block polling or scene evaluation', async t => {
  const r = await fixture(t); await change(r, 'add-feed', { name: 'Unused', type: 'encoder', protocols: ['rtmp'] });
  const unused = r.state.feeds[1]; await change(r, 'update-feed', { id: unused.id, enabled: false, confirm: unused.id });
  const m = new MultiIngest(r, {}, {}); let evaluated = 0, release;
  m.controller.tick = async () => { evaluated++; }; m.snapshots.refresh = async () => false;
  m.disconnect = () => new Promise(resolve => { release = resolve; });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => `paths{name="${unused.path}",state="ready"} 1` });
  try { await m.poll(); await m.poll(); assert.equal(evaluated, 2); assert.equal(m.polling, false); }
  finally { globalThis.fetch = oldFetch; release?.(); }
});
