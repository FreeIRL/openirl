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
  assert.match(page,/Ingest Preview/); assert.match(page,/Bitrate/); assert.match(page,/Offline \/ BRB/);
  const status=(await request("/api/v1/dashboard/status")).json();
  assert.equal(status.controls.enabled,false); assert.equal(status.services.srtla.source,"unavailable"); assert.equal(status.links,null);
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
