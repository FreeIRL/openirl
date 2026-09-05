// Optional real-Caddy integration: CADDY_BIN=/path/to/caddy node --test test/https-smoke.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const https = require('node:https');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');

test('real HTTPS gate protects dashboard, control token and same-origin HLS', { skip: !process.env.CADDY_BIN, timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openirl-https-'));
  const password = randomBytes(24).toString('hex');
  const hash = execFileSync(process.env.CADDY_BIN, ['hash-password', '--plaintext', password], { encoding: 'utf8' }).trim();
  const app = await import('../apps/dashboard/src/server.js');
  let seenHeaders;
  const upstream = http.createServer((req, res) => {
    if (req.url.includes('.m3u8')) { res.setHeader('content-type', 'application/vnd.apple.mpegurl'); res.end('#EXTM3U\n#EXTINF:1,\nsegment.ts\n'); }
    else res.end('fixture-media');
  });
  const dashboard = http.createServer((req, res) => { seenHeaders = req.headers; app.handleRequest(req, res); });
  let caddy, logs = '';
  try {
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    app.settings.previewUpstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    app.settings.controlToken = randomBytes(24).toString('hex');
    await new Promise((resolve, reject) => { dashboard.once('error', reject); dashboard.listen(0, '127.0.0.1', resolve); });
    const probe = http.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    let config = await readFile(join(__dirname, '../integrations/caddy/Caddyfile'), 'utf8');
    // Only test TLS issuer/listening ports differ. Never trust/install this ephemeral CA.
    config = config.replace('admin off', 'admin off\n\tskip_install_trust\n\tauto_https disable_redirects');
    config = config.replace('https://{$OPENIRL_DOMAIN} {', `https://localhost:${port} {\n\tbind 127.0.0.1\n\ttls internal`);
    config = config.replace('127.0.0.1:8080', `127.0.0.1:${dashboard.address().port}`);
    const configPath = join(directory, 'Caddyfile');
    await writeFile(configPath, config);
    const env = { ...process.env, OPENIRL_DOMAIN: 'localhost', OPENIRL_AUTH_USER: 'operator', OPENIRL_AUTH_HASH: hash, XDG_DATA_HOME: directory, XDG_CONFIG_HOME: directory };
    execFileSync(process.env.CADDY_BIN, ['validate', '--config', configPath, '--adapter', 'caddyfile'], { env, stdio: 'pipe' });
    caddy = spawn(process.env.CADDY_BIN, ['run', '--config', configPath, '--adapter', 'caddyfile'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    caddy.stderr.on('data', chunk => { logs += chunk; });
    const request = (path, headers = {}, method = 'GET', body = '') => new Promise((resolve, reject) => {
      // Only this isolated self-signed local test disables certificate validation.
      const req = https.request({ hostname: '127.0.0.1', servername: 'localhost', port, path, method, rejectUnauthorized: false, headers: { host: `localhost:${port}`, ...headers } }, res => {
        let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }); req.on('error', reject); req.end(body);
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { await request('/'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready, logs);
    for (const path of ['/', '/healthz', '/api/v1/dashboard/status', '/preview/live/feed-1/index.m3u8', '/preview/live/feed-1/segment.ts']) {
      assert.equal((await request(path)).status, 401);
      assert.equal((await request(path, { authorization: 'Basic ' + Buffer.from('operator:wrong').toString('base64') })).status, 401);
    }
    const auth = { authorization: 'Basic ' + Buffer.from(`operator:${password}`).toString('base64') };
    const page = await request('/', auth);
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /media-src 'self' blob:/);
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.equal(seenHeaders.authorization, undefined);
    assert.equal((await request('/api/v1/control/stream/start', auth, 'POST')).status, 401);
    app.obsClient.state = { ...app.obsClient.state, connected: true };
    const result = await request('/api/v1/control/scene', { ...auth, 'x-openirl-control-token': app.settings.controlToken }, 'POST', '{"scene":"invalid"}');
    assert.equal(result.status, 400); // Passed both gates, rejected before any OBS action.
    assert.equal(seenHeaders['x-openirl-control-token'], app.settings.controlToken);
    const playlist = await request('/preview/live/feed-1/index.m3u8', auth);
    assert.equal(playlist.status, 200);
    assert.equal(playlist.headers['cache-control'], 'no-store');
    assert.match(playlist.body, /segment.ts/);
    assert.doesNotMatch(playlist.body, /127\.0\.0\.1|8888/);
    assert.equal((await request('/preview/live/feed-1/segment.ts', auth)).body, 'fixture-media');
    assert.equal((await request('/preview/live/feed-2/index.m3u8', auth)).status, 404);
  } finally {
    if (caddy && caddy.exitCode === null) { caddy.kill('SIGTERM'); await once(caddy, 'exit'); }
    dashboard.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => dashboard.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
    await rm(directory, { recursive: true, force: true });
  }
});
