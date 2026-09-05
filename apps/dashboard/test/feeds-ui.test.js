import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(k,v) { this.attributes[k] = v; }
  getAttribute(k) { return k === 'src' ? this.src : this.attributes[k]; }
  addEventListener(k,v) { this[k] = v; }
  contains(node) { return this === node || this.children.some(c => c.contains(node)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const matches = n => selector.startsWith('[data-') ? Object.hasOwn(n.dataset, selector.slice(6,-1).replace(/-([a-z])/g, (_,c) => c.toUpperCase())) : selector === 'details[open]' ? n.tag === 'details' && n.open : selector === '[type=checkbox]' ? n.type === 'checkbox' : n.tag === selector;
    return this.children.flatMap(n => [...(matches(n) ? [n] : []), ...n.querySelectorAll(selector)]);
  }
}
test('feed health keeps updating while edits stay intact, and network failure is explicit', async () => {
  const root = new Element('section'), token = new Element('input');
  const data = { revision: 0, automationOwner: 'openirl', profiles: [], feeds: [{ id: 'feed-1', name: 'Main', type: 'mobile', protocols: ['srtla'], enabled: true, health: { state: 'ONLINE', telemetryFresh: true, bitrate: 2000 }, preview: { available: false } }] };
  let offline = false;
  const context = vm.createContext({ document: { querySelector: s => s === '#feed-manager' ? root : token, createElement: tag => new Element(tag), addEventListener() {}, activeElement: null }, fetch: async () => { if (offline) throw Error('Network lost'); return { ok: true, headers: { get: () => 'application/json' }, json: async () => structuredClone(data) }; }, AbortSignal, Date, setInterval() {} });
  vm.runInContext(await readFile(new URL('../public/feeds.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(root.querySelector('[data-health]').textContent, /ONLINE/);
  const editor = root.querySelector('details'); editor.open = true;
  const form = editor.querySelector('form'); form.querySelector('input').value = 'Unsaved name';
  data.feeds[0].health.state = 'OFFLINE'; data.feeds[0].health.bitrate = 0;
  await vm.runInContext('refresh()', context);
  assert.match(root.querySelector('[data-health]').textContent, /OFFLINE/);
  assert.equal(editor.querySelector('form'), form);
  assert.equal(form.querySelector('input').value, 'Unsaved name');
  assert.ok(root.querySelectorAll('[data-control]').every(n => n.disabled));
  token.value = 'test-only-token'; token.input();
  assert.ok(root.querySelectorAll('[data-control]').every(n => !n.disabled));
  offline = true; await vm.runInContext('refresh()', context);
  assert.match(root.querySelector('[data-health]').textContent, /Telemetry unavailable/);
  assert.ok(root.querySelectorAll('[data-control]').every(n => n.disabled));
});
