const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const test = require("node:test");
const { join } = require("node:path");

const read = (path) => readFile(join(__dirname, "..", path), "utf8");

test("NOALBS example uses the v2.19.2 WebSocket schema", async () => {
  const config = JSON.parse(await read("integrations/noalbs/config.example.json"));
  const server = config.switcher.streamServers[0].streamServer;

  assert.equal(config.user.name, "openirl");
  assert.deepEqual(config.switcher.switchingScenes, {
    normal: "Live",
    low: "Low Bitrate",
    offline: "BRB",
  });
  assert.equal(config.switcher.scenes, undefined);
  assert.equal(server.type, "WebSocket");
  assert.equal(server.url, "ws://127.0.0.1:9090/ws-stats?feed=feed-1");
  assert.equal(server.statsUrl, undefined);
  assert.equal(server.reconnectIntervalMs, 1000);
  assert.equal(server.staleTimeoutMs, 3000);
  assert.deepEqual(config.software.collections, {});
  assert.equal(config.chat, null);
  assert.ok(config.optionalScenes);
  assert.ok(config.optionalOptions);
});

test("SRTLA Compose profile forwards to MediaMTX without replacing direct ingest", async () => {
  const compose = await read("docker/compose.yaml");

  assert.match(compose, /srtla-receiver:/);
  assert.match(compose, /profiles: \["srtla"\]/);
  assert.match(compose, /- mediamtx\n\s+- --srt_port\n\s+- "8890"/);
  assert.match(compose, /- "5000:5000\/udp"/);
  assert.match(compose, /- "1935:1935"/);
  assert.match(compose, /- "8890:8890\/udp"/);
});

test("SRTLA image pins upstream and initializes its build dependency", async () => {
  const dockerfile = await read("integrations/srtla/Dockerfile");

  assert.match(dockerfile, /ARG SRTLA_REF=[0-9a-f]{40}/);
  assert.match(dockerfile, /submodule update --init --recursive/);
  assert.match(dockerfile, /USER srtla/);
});

test("dashboard remains loopback-only while reaching local OBS", async () => {
  const compose = await read("docker/compose.yaml");
  assert.match(compose, /dashboard:/);
  assert.match(compose, /BIND_HOST: 127\.0\.0\.1/);
  assert.match(compose, /STATS_BRIDGE_URL: http:\/\/127\.0\.0\.1:9090/);
  assert.match(compose, /OBS_WEBSOCKET_URL: ws:\/\/127\.0\.0\.1:4455/);
  assert.match(compose, /network_mode: host/);
  assert.doesNotMatch(compose, /4455:4455/);
});

test("security guide exposes only SRTLA and contains no deployed secret", async () => {
  const guide = await read("docs/security.md");
  assert.match(guide, /ufw allow 5000\/udp/);
  assert.match(guide, /Do \*\*not\*\* forward ports 1935, 8890, 4455, 8080, 9090, 9997, or 9998/);
  assert.match(guide, /YOUR_SECRET/);
});
