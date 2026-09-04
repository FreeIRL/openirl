import test from "node:test";
import assert from "node:assert/strict";
import { FeedTracker, findSample, parsePrometheus } from "../src/metrics.js";

test("parses MediaMTX path metrics", () => {
  const samples = parsePrometheus(`
# HELP paths Paths
paths{name="live/feed-1",state="ready"} 1
paths_inbound_bytes{name="live/feed-1",state="ready"} 1500000
`);

  assert.equal(
    findSample(samples, "paths", {
      name: "live/feed-1",
      state: "ready",
    })?.value,
    1,
  );
  assert.equal(
    findSample(samples, "paths_inbound_bytes", {
      name: "live/feed-1",
      state: "ready",
    })?.value,
    1500000,
  );
});

test("computes kbps from cumulative bytes", () => {
  const tracker = new FeedTracker();

  assert.equal(
    tracker.sample({ bytes: 1000, connected: true, timestamp: 1000 }).bitrate,
    0,
  );
  assert.equal(
    tracker.sample({ bytes: 751000, connected: true, timestamp: 2000 }).bitrate,
    6000,
  );
});

test("does not report a negative bitrate after a counter reset", () => {
  const tracker = new FeedTracker();
  tracker.sample({ bytes: 1000, connected: true, timestamp: 1000 });

  assert.equal(
    tracker.sample({ bytes: 10, connected: true, timestamp: 2000 }).bitrate,
    0,
  );
});
