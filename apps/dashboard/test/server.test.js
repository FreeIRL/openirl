import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest } from "../src/server.js";

async function request(url) {
  let statusCode, headers, body="";
  const response={ writeHead(status,nextHeaders){statusCode=status;headers=nextHeaders}, end(chunk=""){body+=chunk.toString()} };
  await handleRequest({ method:"GET", url },response);
  return { statusCode, headers, body, json:()=>JSON.parse(body) };
}

test("serves the accessible dashboard and status contract", async () => {
  const page=(await request("/")).body;
  assert.match(page,/Skip to controls/); assert.match(page,/Per-link SRTLA telemetry|Network links/); assert.match(page,/button disabled/);
  const status=(await request("/api/v1/dashboard/status")).json();
  assert.equal(status.controls.enabled,false); assert.equal(status.services.srtla.source,"unavailable"); assert.equal(status.links,null);
});

test("does not allow path traversal", async () => {
  const response=await request("/..%2f..%2fpackage.json");
  assert.equal(response.statusCode,404);
});
