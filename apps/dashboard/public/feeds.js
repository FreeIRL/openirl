const root = document.querySelector('#feed-manager');
let state;
const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
const note = el('p'); note.setAttribute('role', 'status');
async function action(action, body = {}) {
  const response = await fetch(`/api/v1/control/production/${action}`, { method: 'POST', headers: { 'content-type': 'application/json',
    'x-openirl-control-token': document.querySelector('#control-token').value }, body: JSON.stringify({ revision: state.revision, ...body }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); return data;
}
function button(label, handler, reload = true) {
  const b = el('button', label); b.type = 'button'; b.addEventListener('click', async () => {
    b.disabled = true; try { await handler(); if (reload) await refresh(); } catch (error) { note.textContent = error.message; } finally { b.disabled = false; }
  }); return b;
}
function field(form, label, value = '', type = 'text') {
  const wrap = el('label', label), input = el('input'); input.type = type; input.value = value; input.required = true;
  wrap.append(input); form.append(wrap); return input;
}
function protocolInputs(form, selected) {
  const group = el('fieldset'); group.append(el('legend', 'Protocols'));
  const checks = ['srtla', 'srt', 'rtmp', 'rtmps'].map(p => { const label = el('label', p.toUpperCase()), input = el('input'); input.type = 'checkbox'; input.checked = selected.includes(p); input.value = p; label.prepend(input); group.append(label); return input; });
  form.append(group); return () => checks.filter(i => i.checked).map(i => i.value);
}
function feedForm(feed) {
  const form = el('form'); const name = field(form, 'Feed name', feed?.name || '');
  const label = el('label', 'Preset'), type = el('select');
  for (const [id, title] of [['mobile', 'IRL / Mobile'], ['encoder', 'PC / Encoder']]) { const o = el('option', title); o.value = id; type.append(o); }
  type.value = feed?.type || 'mobile'; label.append(type); form.append(label);
  const selected = protocolInputs(form, feed?.protocols || ['srtla']);
  if (!feed) type.addEventListener('change', () => form.querySelectorAll('[type=checkbox]').forEach(i => i.checked = i.value === (type.value === 'mobile' ? 'srtla' : 'rtmps')));
  if (feed?.enabled) form.querySelector('fieldset').disabled = true;
  const save = el('button', feed ? 'Save feed' : 'Add feed'); save.type = 'submit'; form.append(save);
  form.addEventListener('submit', async event => { event.preventDefault(); save.disabled = true;
    try { await action(feed ? 'update-feed' : 'add-feed', { id: feed?.id, name: name.value, type: type.value, ...(!feed?.enabled ? { protocols: selected() } : {}) }); await refresh(); }
    catch (error) { note.textContent = error.message; } finally { save.disabled = false; }
  }); return form;
}
function profileForm(profile) {
  const form = el('form'), name = field(form, 'Profile name', profile?.name || ''), scene = field(form, 'OBS normal scene', profile?.scene || ''),
    low = field(form, 'OBS low bitrate scene', profile?.lowScene || 'Low Bitrate'), offline = field(form, 'OBS offline scene', profile?.offlineScene || 'BRB');
  const group = el('fieldset'); group.append(el('legend', 'Feeds used by this scene'));
  const checks = state.feeds.map(f => { const label = el('label', f.name), check = el('input'); check.type = 'checkbox'; check.value = f.id; check.checked = profile?.feedIds.includes(f.id); label.prepend(check); group.append(label); return check; }); form.append(group);
  const min = field(form, 'Minimum healthy feeds', profile?.minimumHealthy || 1, 'number'); min.min = '1'; min.max = state.feeds.length;
  const save = el('button', 'Save profile'); form.append(save); form.addEventListener('submit', async event => { event.preventDefault(); save.disabled = true;
    try { await action('save-profile', { id: profile?.id, name: name.value, scene: scene.value, lowScene: low.value, offlineScene: offline.value, feedIds: checks.filter(c => c.checked).map(c => c.value), minimumHealthy: Number(min.value) }); await refresh(); }
    catch (error) { note.textContent = error.message; } finally { save.disabled = false; }
  }); return form;
}
function render() {
  root.hidden = false; root.replaceChildren(el('h2', 'Feeds and production profiles'), note);
  root.append(el('p', `Scene automation: ${state.automationOwner}${state.automationPaused ? ' (paused — Take Live to resume)' : ''}. ${state.error || ''}`));
  const grid = el('div'); grid.className = 'feed-manager-grid'; root.append(grid);
  for (const f of state.feeds) {
    const card = el('article'); card.className = 'card card-body'; card.append(el('h3', f.name), el('p', `${f.health?.state || 'IDLE'} · ${f.health?.bitrate || 0} kbps${f.enabled ? '' : ' · Disabled'}`));
    if (f.preview.available) { const image = el('img'); image.src = f.preview.url; image.alt = `Last ingest frame from ${f.name}`; image.style.width = '100%'; card.append(image, el('p', `Last received ${Math.floor((Date.now() - f.preview.capturedAt) / 1000)}s ago`)); }
    card.append(button('Refresh Now', () => action('refresh', { id: f.id })), button('Connection details', async () => {
      const data = await action('details', { id: f.id }); const box = el('section'); box.dataset.credentials = 'true';
      for (const [protocol, values] of Object.entries(data)) {
        if (typeof values === 'string') { box.append(el('p', values)); continue; }
        box.append(el('h4', protocol.toUpperCase()));
        for (const [key, value] of Object.entries(values)) {
          const row = el('label', ({server:'Server',streamId:'Stream ID',url:'Connection URL',streamKey:'Stream key',sourceUrl:'OBS source URL'})[key] || key);
          const input = el('input'); input.readOnly = true; input.value = value;
          const sensitive = ['streamId','streamKey','url'].includes(key); input.type = sensitive ? 'password' : 'text';
          row.append(input, button('Copy', async () => { await navigator.clipboard.writeText(value); note.textContent = 'Copied'; }, false));
          if (sensitive) row.append(button('Show / hide', () => { input.type = input.type === 'password' ? 'text' : 'password'; }, false));
          box.append(row);
        }
      }
      const close = button('Hide connection details', () => { box.remove(); close.remove(); }, false); card.append(box, close);
    }, false));
    const edit = el('details'); edit.append(el('summary', 'Edit feed'), feedForm(f)); card.append(edit);
    card.append(button(f.enabled ? 'Disable' : 'Enable', async () => { if (f.enabled && !confirm(`Disconnect ${f.name}? This may affect the live production.`)) return;
      await action('update-feed', { id: f.id, enabled: !f.enabled, confirm: f.id }); }));
    if (!f.enabled) card.append(button('Rotate credentials', async () => { if (confirm(`Invalidate all old credentials for ${f.name}?`)) await action('rotate-feed', { id: f.id, confirm: f.id }); }),
      button('Delete', async () => { if (confirm(`Delete ${f.name}? Remove it from profiles first.`)) await action('delete-feed', { id: f.id, confirm: f.id }); }));
    grid.append(card);
  }
  const add = el('details'); add.append(el('summary', 'Add feed'), feedForm()); root.append(add);
  for (const p of state.profiles) {
    const row = el('article'); row.className = 'card card-body'; row.append(el('h3', `${p.name}${p.id === state.selectedProfileId ? ' · Selected' : ''}`),
      el('p', `${p.scene}: ${p.health.state} · ${p.health.healthy}/${p.minimumHealthy} healthy feeds required`), button('Take Live', () => action('take', { id: p.id })));
    if (p.id !== state.selectedProfileId) { const edit = el('details'); edit.append(el('summary', 'Edit profile'), profileForm(p)); row.append(edit, button('Delete profile', () => action('delete-profile', { id: p.id }))); }
    root.append(row);
  }
  const addProfile = el('details'); addProfile.append(el('summary', 'Add production profile'), profileForm()); root.append(addProfile);
}
async function refresh() {
  const response = await fetch('/api/v1/production', { cache: 'no-store' });
  if (!response.ok) return; state = await response.json(); render();
}
refresh().catch(() => {});
// Keep in-progress forms and revealed credentials stable. The main dashboard still polls OBS.
setInterval(() => { if (!root.querySelector('details[open]') && !root.querySelector('[data-credentials]') && !root.contains(document.activeElement)) refresh().catch(() => {}); }, 10000);
