import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { handleRequest, obsClient, settings } from "../src/server.js";

async function request(url, { method="GET", headers:requestHeaders={}, body:requestBody="" }={}) {
  let statusCode, responseHeaders, responseBody="";
  const response={ writeHead(status,nextHeaders){statusCode=status;responseHeaders=nextHeaders}, end(chunk=""){responseBody+=chunk.toString()} };
  const incoming=Readable.from(requestBody ? [requestBody] : []); incoming.method=method; incoming.url=url; incoming.headers=requestHeaders;
  await handleRequest(incoming,response);
  return { statusCode, headers:responseHeaders, body:responseBody, json:()=>JSON.parse(responseBody) };
}

test("serves the accessible dashboard and status contract", async () => {
  const page=(await request("/")).body;
  assert.match(page,/Skip to controls/); assert.match(page,/Per-link SRTLA telemetry/); assert.match(page,/button[^>]+disabled/);
  assert.match(page,/Ingest Preview/); assert.match(page,/<video[^>]+muted[^>]+autoplay[^>]+playsinline/); assert.match(page,/vendor\/hls\.min\.js/);
  assert.match(page,/Bitrate/); assert.match(page,/Offline \/ BRB/);
  const status=(await request("/api/v1/dashboard/status")).json();
  assert.equal(status.controls.enabled,false); assert.equal(status.services.srtla.source,"unavailable"); assert.equal(status.links,null);
  assert.equal(status.preview.available,false); assert.equal(status.preview.url,null); assert.equal(status.preview.format,"hls");
});

test("control API requires a token and rejects scenes outside the allowlist", async () => {
  const previousToken=settings.controlToken, previousState=obsClient.state;
  settings.controlToken="test-control-token"; obsClient.state={ ...previousState, connected:true };
  try {
    assert.equal((await request("/api/v1/control/stream/start",{method:"POST"})).statusCode,401);
    const response=await request("/api/v1/control/scene",{method:"POST",headers:{"x-openirl-control-token":"test-control-token"},body:JSON.stringify({scene:"Not Allowed"})});
    assert.equal(response.statusCode,400); assert.match(response.body,/Live, Low Bitrate, or BRB/);
  } finally { settings.controlToken=previousToken; obsClient.state=previousState; }
});

test("does not allow path traversal", async () => {
  const response=await request("/..%2f..%2fpackage.json");
  assert.equal(response.statusCode,404);
});

test("preview proxy is limited to the configured Feed 1 asset namespace", async () => {
  assert.equal((await request("/preview/live/feed-1/%2e%2e/secret")).statusCode,404);
  assert.equal((await request("/preview/live/feed-2/index.m3u8")).statusCode,404);
});

test("audio routes require token, reject input selection, and use server mapping", async () => {
  const old = { token:settings.controlToken, source:settings.obsIngestAudioSource, state:obsClient.state, request:obsClient.request };
  const headers={"x-openirl-control-token":"audio-test-token"};
  settings.controlToken="audio-test-token"; settings.obsIngestAudioSource="Mapped Feed 1";
  obsClient.state={...old.state, connected:true};
  let muted=false;
  const calls=[];
  obsClient.request=async (type,data)=>{ calls.push([type,data]); if(type==="SetInputMute") muted=data.inputMuted; return {inputMuted:muted}; };
  try {
    for(const action of ["mute","unmute"]) {
      const url=`/api/v1/control/ingest/${action}`;
      assert.equal((await request(url,{method:"POST"})).statusCode,401);
      assert.equal((await request(url,{method:"POST",headers:{"x-openirl-control-token":"wrong"}})).statusCode,401);
      assert.equal(calls.length,0);
    }
    assert.equal((await request("/api/v1/control/ingest/mute",{method:"POST",headers,body:'{"inputName":"Other input"}'})).statusCode,400);
    assert.equal(calls.length,0);
    for(const action of ["mute","unmute"]) {
      const result=await request(`/api/v1/control/ingest/${action}`,{method:"POST",headers});
      assert.equal(result.statusCode,200);
      assert.equal(result.json().audio.muted,action==="mute");
    }
    assert.ok(calls.every(([,data])=>data.inputName==="Mapped Feed 1"));
    const status=(await request("/api/v1/dashboard/status")).json();
    assert.equal(status.audio.enabled,true); assert.equal(status.audio.muted,false);
    assert.doesNotMatch(JSON.stringify(status), /audio-test-token|Mapped Feed 1/);
    settings.obsIngestAudioSource="";
    assert.equal((await request("/api/v1/control/ingest/mute",{method:"POST",headers})).statusCode,502);
    assert.equal((await request("/api/v1/dashboard/status")).json().audio.enabled,false);
    obsClient.state.connected=false;
    assert.equal((await request("/api/v1/control/ingest/unmute",{method:"POST",headers})).statusCode,503);
  } finally {
    settings.controlToken=old.token; settings.obsIngestAudioSource=old.source; obsClient.state=old.state; obsClient.request=old.request;
  }
});

test("Fix requires token, rejects all source parameters, and diagnoses disconnected OBS", async () => {
  const previous=settings.controlToken;
  settings.controlToken="fix-token";
  const url="/api/v1/control/ingest/fix", headers={"x-openirl-control-token":"fix-token"};
  try {
    for (const token of [undefined,"wrong"]) assert.equal((await request(url,{method:"POST",headers:token?{"x-openirl-control-token":token}:{}})).statusCode,401);
    for (const body of ['{"inputName":"arbitrary"}', '[]', 'null', 'false', '{', 'x'.repeat(4097)]) assert.equal((await request(url,{method:"POST",headers,body})).statusCode,400);
    const result=(await request(url,{method:"POST",headers})).json();
    assert.equal(result.state,"failed");
    assert.equal(result.actions.length,0);
    assert.ok(result.checks.some(check=>check.id==="obs"&&!check.ok));
    settings.controlToken="";
    assert.equal((await request(url,{method:"POST",headers})).statusCode,401);
    const status=(await request("/api/v1/dashboard/status")).json();
    assert.equal(status.recovery.enabled,false);
    assert.doesNotMatch(JSON.stringify(status.recovery),/fix-token/);
  } finally { settings.controlToken=previous; }
});
