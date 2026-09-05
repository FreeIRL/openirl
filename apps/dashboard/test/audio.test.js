import assert from "node:assert/strict";
import test from "node:test";
import { ObsClient } from "../src/obs-client.js";

function clientWithAudio() {
  const client = new ObsClient({});
  client.state.connected = true;
  const calls = [];
  let muted = false;
  client.request = async (type, data) => {
    calls.push([type, data]);
    if (type === "SetInputMute") muted = data.inputMuted;
    return { inputMuted: muted };
  };
  return { client, calls };
}

test("audio writes only the explicit source and confirms both idempotent states", async () => {
  const { client, calls } = clientWithAudio();
  for (const muted of [true, true, false, false]) {
    assert.equal((await client.setIngestMuted("Feed 1 Audio", muted)).muted, muted);
  }
  assert.equal(calls.length, 12);
  for (const [type, data] of calls) {
    assert.equal(data.inputName, "Feed 1 Audio");
    assert.ok(["GetInputMute", "SetInputMute"].includes(type));
  }
});

test("missing mapping and disconnected OBS never send an audio request", async () => {
  const { client, calls } = clientWithAudio();
  await assert.rejects(client.setIngestMuted("", true), /OBS_INGEST_AUDIO_SOURCE/);
  client.state.connected = false;
  assert.deepEqual(await client.ingestAudioStatus("Feed 1"), { healthy:false, muted:null, reason:"OBS is disconnected" });
  await assert.rejects(client.setIngestMuted("Feed 1", true), /disconnected/);
  assert.equal(calls.length, 0);
});

test("invalid input, timeout, and malformed response fail closed without leaking OBS errors", async () => {
  for (const response of [null, {}, { inputMuted:"false" }]) {
    const { client } = clientWithAudio();
    client.request = async () => response;
    assert.equal((await client.ingestAudioStatus("Feed 1")).healthy, false);
  }
  const { client } = clientWithAudio();
  client.request = async () => { throw new Error("sensitive upstream detail"); };
  const status = await client.ingestAudioStatus("Feed 1");
  assert.equal(status.muted, null);
  assert.doesNotMatch(JSON.stringify(status), /sensitive/);
  await assert.rejects(client.setIngestMuted("Feed 1", true), /could not be queried/);
});

test("OBS rejection and unconfirmed writes are errors", async () => {
  const { client } = clientWithAudio();
  client.request = async () => ({ inputMuted:false });
  await assert.rejects(client.setIngestMuted("Feed 1", true), /could not be confirmed/);
  client.request = async type => {
    if (type === "SetInputMute") throw new Error("private OBS detail");
    return { inputMuted:false };
  };
  await assert.rejects(client.setIngestMuted("Feed 1", true), /could not change/);
});

test("fresh queries follow external changes and source removal", async () => {
  const { client } = clientWithAudio();
  assert.equal((await client.ingestAudioStatus("Feed 1")).muted, false);
  client.request = async () => ({ inputMuted:true });
  assert.equal((await client.ingestAudioStatus("Feed 1")).muted, true);
  client.request = async () => { throw new Error("removed"); };
  assert.equal((await client.ingestAudioStatus("Feed 1")).healthy, false);
});
