import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("Fix UI gates token, health and busy state, renders results as text, and fails closed", async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: "", textContent: "", disabled: false, dataset: {}, classList: { toggle() {} }, addEventListener(event, handler) { this[event] = handler; }, removeAttribute() {}, setAttribute() {}, querySelector() { return element(id+" child"); }, pause() {}, load() {}, offsetParent: null });
    return elements.get(id);
  };
  let fetchImpl = async () => { throw new Error("offline"); };
  const context = vm.createContext({ document: { querySelector: element, querySelectorAll: () => [] }, fetch: (...args) => fetchImpl(...args), matchMedia: () => ({ matches: false }), setInterval() {}, setTimeout() {}, addEventListener() {}, Date, console });
  vm.runInContext(await readFile(new URL("../public/app.js", import.meta.url), "utf8"), context);
  await new Promise(resolve => setImmediate(resolve));
  const evaluate = code => vm.runInContext(code, context);
  evaluate('recoveryState={enabled:true,reason:"Ready"};updateControls()');
  assert.equal(element("#ingest-fix").disabled, true);
  element("#control-token").value="test-token";
  element("#control-token").input();
  assert.equal(element("#ingest-fix").disabled, false);
  let release;
  fetchImpl=async (url, options)=> {
    assert.equal(url,"/api/v1/control/ingest/fix");
    assert.equal(options.headers["x-openirl-control-token"],"test-token");
    await new Promise(resolve=>{release=resolve});
    return {ok:true,json:async()=>({state:"no_action_needed",summary:"Already playing",checks:[]})};
  };
  const running=element("#ingest-fix").click();
  assert.equal(element("#ingest-fix").disabled,true);
  assert.match(element("#recovery-result").textContent,/Working/);
  release();await running;
  assert.match(element("#recovery-result").textContent,/No action needed/);
  evaluate('showRecovery({state:"failed",summary:"<script>unsafe</script>"})');
  assert.match(element("#recovery-result").textContent,/<script>/);
  fetchImpl=async()=>{throw new Error("offline")};
  await evaluate('refresh()');
  assert.equal(element("#ingest-fix").disabled,true);
  assert.match(element("#recovery-note").textContent,/disabled/);
});
