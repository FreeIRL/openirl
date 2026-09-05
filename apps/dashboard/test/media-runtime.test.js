import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { FeedRegistry, hash } from '../src/feed-registry.js';
import { MultiIngest } from '../src/multi-ingest.js';
import { capture } from '../src/snapshots.js';

// Opt-in: starts only loopback listeners, generates test-only credentials/certificates.
test('real MediaMTX enforces auth, separates RTMPS, produces snapshots and kicks disabled feeds', { skip: !process.env.OPENIRL_TEST_MEDIAMTX, timeout: 45000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'openirl-media-')); const children = [];
  t.after(async () => { for (const c of children) c.kill('SIGKILL'); await rm(dir, { recursive: true, force: true }); });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const registry = await FeedRegistry.load(join(dir, 'registry.json'), { FEED_1_PASSWORD_HASH: hash('test-only-secret') });
  const m = new MultiIngest(registry, {}, { OPENIRL_MEDIAMTX_API_URL: 'http://127.0.0.1:19997' });
  const server = http.createServer((req, res) => m.authRequest(req, res));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(18081, '127.0.0.1', resolve); }); t.after(() => server.close());
  const conf = join(dir, 'mediamtx.yml');
  await writeFile(conf, `logLevel: error\napi: yes\napiAddress: 127.0.0.1:19997\nmetrics: yes\nmetricsAddress: 127.0.0.1:19998\nauthMethod: http\nauthHTTPAddress: http://127.0.0.1:18081/auth\nauthHTTPExclude:\n- action: api\n- action: metrics\nmoq: no\nrtsp: no\nhls: no\nwebrtc: no\nsrtAddress: 127.0.0.1:18890\nrtmpAddress: 127.0.0.1:11935\nrtmpEncryption: optional\nrtmpsAddress: 127.0.0.1:11936\nrtmpServerKey: ${join(dir, 'key.pem')}\nrtmpServerCert: ${join(dir, 'cert.pem')}\npaths:\n  ~^live/[a-zA-Z0-9_-]+$:\n    overridePublisher: no\n`);
  const mtx = spawn(process.env.OPENIRL_TEST_MEDIAMTX, [conf], { stdio: 'ignore', cwd: dir }); children.push(mtx);
  async function until(fn, ms = 7000) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw Error('Runtime condition timed out'); }
  await until(async () => (await fetch('http://127.0.0.1:19997/v3/paths/list')).ok);
  function publish(url) {
    const child = spawn('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '15', '-f', url.startsWith('srt:') ? 'mpegts' : 'flv', url], { stdio: 'ignore' }); children.push(child); return child;
  }
  const path = () => m.mtx('paths/get/live%2Ffeed-1');
  const url = (proto, password = 'test-only-secret') => `${proto}://127.0.0.1:${proto === 'rtmps' ? 11936 : 11935}/live/feed-1?user=openirl-feed-1&pass=${password}`;
  const bad = publish(url('rtmp', 'wrong')); await until(() => bad.exitCode !== null); await assert.rejects(path());
  registry.state.feeds[0].protocols = ['rtmps'];
  const denied = publish(url('rtmp')); await until(() => denied.exitCode !== null); await assert.rejects(path());
  const tls = publish(url('rtmps')); await until(async () => (await path()).ready); assert.equal((await path()).source.type, 'rtmpsConn');
  const image = await capture('rtmp://127.0.0.1:11935/live/feed-1'); assert.equal(image[0], 0xff); assert.ok(image.length > 1000);
  await registry.change('update-feed', { revision: 0, id: 'feed-1', enabled: false, confirm: 'feed-1' });
  await m.disconnect(registry.state.feeds[0]); await until(() => tls.exitCode !== null);
  const supportsSrt = /^  srt$/m.test(execFileSync('ffmpeg', ['-protocols'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  await t.test('SRT stream ID interoperability', { skip: !supportsSrt }, async () => {
  registry.state.feeds[0].enabled = true; registry.state.feeds[0].protocols = ['srtla'];
  const srt = publish('srt://127.0.0.1:18890?streamid=' + 'publish:live/feed-1:openirl-feed-1:test-only-secret');
  await until(async () => (await path()).ready); assert.equal((await path()).source.type, 'srtConn'); srt.kill('SIGKILL');
  });
});
