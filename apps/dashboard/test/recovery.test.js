import assert from "node:assert/strict";
import test from "node:test";
import { IngestRecovery } from "../src/recovery.js";

function fixture(options = {}) {
  const calls = [];
  let state = options.state ?? "ERROR";
  const obs = { request: async (type, data) => {
    calls.push([type, data]);
    if (options.fail === type) throw new Error("secret OBS credentials");
    switch (type) {
      case "GetVersion": return { availableRequests: options.unsupported ? [] : ["GetInputList", "GetMediaInputStatus", "GetSourceActive", "GetCurrentProgramScene", "GetStreamStatus", "TriggerMediaInputAction"] };
      case "GetInputList": return { inputs: [{ inputName: "Phone Media", inputKind: options.kind ?? "ffmpeg_source" }] };
      case "GetMediaInputStatus": return { mediaState: `OBS_MEDIA_STATE_${state}` };
      case "GetSourceActive": return { videoActive: !options.inactive, videoShowing: !options.inactive };
      case "GetCurrentProgramScene": return { currentProgramSceneName: options.scene ?? "Live" };
      case "GetStreamStatus": return { outputActive: true };
      case "TriggerMediaInputAction": if (!options.unconfirmed) state = "PLAYING"; return {};
      default: throw new Error(`Unexpected request ${type}`);
    }
  } };
  const recovery = new IngestRecovery({ obs, source: () => options.source ?? "Phone Media", feedId: () => "feed-1", now: () => 10000, wait: async () => {},
    telemetry: async () => ({ feed: { feed: "feed-1", streamId: "publish/live/feed-1", connected: true, bitrate: 1000, timestamp: 10000, ...options.feed }, health: { status: "ok", upstream: "fresh" } }),
    preview: async () => ({ available: !options.noPreview }) });
  return { recovery, calls, options };
}
const writes = calls => calls.filter(([type]) => type === "TriggerMediaInputAction");

test("restarts only mapped media input on ERROR, verifies recovery, and cools down", async () => {
  const { recovery, calls } = fixture();
  const result = await recovery.run();
  assert.equal(result.state, "recovered");
  assert.equal(result.actions[0].success, true);
  assert.deepEqual(writes(calls), [["TriggerMediaInputAction", { inputName: "Phone Media", mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART" }]]);
  assert.equal((await recovery.run()).state, "failed");
  assert.equal(writes(calls).length, 1);
  assert.equal((await recovery.status()).enabled, false);
  assert.equal(result.checks.filter(check => check.phase === "before_action").length, 8);
});

test("healthy feed is a no-op; preview-only failures never restart playing input", async () => {
  for (const noPreview of [false, true]) {
    const { recovery, calls } = fixture({ state: "PLAYING", noPreview });
    assert.equal((await recovery.run()).state, noPreview ? "failed" : "no_action_needed");
    assert.equal(writes(calls).length, 0);
  }
});

test("offline, stale, malformed, and failed metrics block all writes", async () => {
  for (const feed of [{ connected: false }, { bitrate: 0 }, { timestamp: 1 }, { timestamp: 11000 }, { timestamp: null }, { error: "private URL" }, { feed: "feed-2" }, { streamId: "publish/other" }]) {
    const { recovery, calls } = fixture({ feed });
    assert.equal((await recovery.status()).enabled, false);
    const result = await recovery.run();
    assert.equal(result.state, "failed");
    assert.equal(writes(calls).length, 0);
    assert.doesNotMatch(JSON.stringify(result), /private URL/);
  }
});

test("operator scenes and inactive, stopped, paused or unsupported inputs are protected", async () => {
  for (const options of [{ scene: "BRB" }, { scene: "Privacy" }, { scene: "Low Bitrate" }, { inactive: true }, { state: "PAUSED" }, { state: "STOPPED" }, { state: "ENDED" }, { state: "NONE" }, { source: "" }, { source: "Other" }, { kind: "browser_source" }, { unsupported: true }]) {
    const { recovery, calls } = fixture(options);
    assert.equal((await recovery.run()).state, "failed", JSON.stringify(options));
    assert.equal(writes(calls).length, 0);
  }
});

test("OBS failures sanitized; restart acceptance is not success", async () => {
  for (const options of [{ fail: "GetVersion" }, { fail: "GetMediaInputStatus" }, { fail: "GetCurrentProgramScene" }, { fail: "TriggerMediaInputAction" }, { unconfirmed: true }]) {
    const { recovery } = fixture(options);
    const result = await recovery.run();
    assert.equal(result.ok, false);
    assert.equal(recovery.busy, false);
    assert.doesNotMatch(JSON.stringify(result), /secret OBS/);
  }
});

test("state changes during diagnosis prevent restart; concurrent requests do not overlap", async () => {
  const { recovery, calls, options } = fixture();
  const original = recovery.telemetry;
  let reads = 0;
  recovery.telemetry = async () => { if (++reads === 2) options.scene = "BRB"; return original(); };
  const first = recovery.run();
  assert.equal((await recovery.run()).state, "failed");
  assert.equal((await first).state, "failed");
  assert.equal(writes(calls).length, 0);
});

test("post-action loss of feed cannot be reported as recovered", async () => {
  const { recovery, options } = fixture();
  recovery.wait = async () => { options.feed = { connected: false }; };
  const result = await recovery.run();
  assert.equal(result.state, "failed");
  assert.equal(result.actions[0].accepted, true);
  assert.equal(result.actions[0].success, false);
});

test("telemetry that ages out during OBS diagnosis cannot authorize a restart", async () => {
  const { recovery, calls, options } = fixture({ feed: { timestamp: 6000 } });
  let clock = 10000;
  recovery.now = () => clock;
  const request = recovery.obs.request;
  recovery.obs.request = async (...args) => {
    if (args[0] === "GetStreamStatus") clock += 2000;
    return request(...args);
  };
  assert.equal((await recovery.run()).state, "failed");
  assert.equal(writes(calls).length, 0);
});
