const root = document.querySelector('#feed-manager');
const historyEntries = []; let lastHealthKey = '';
let state, refreshing = false, actionBusy = false, reachable = false;
const el = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
const note = el('p'); note.setAttribute('role', 'status');
async function action(action, body = {}) {
  if (!document.querySelector('#control-token').value) throw new Error('Enter the control token above');
  const response = await fetch(`/api/v1/control/production/${action}`,  { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json',
    'x-openirl-control-token': document.querySelector('#control-token').value }, body: JSON.stringify({ revision: state.revision, ...body }) });
  if (response.redirected || !(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Access session expired; reload this page to sign in. Check status before retrying a change.');
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed'); note.textContent = data.warning || 'Request completed'; return data;
}
function button(label, handler, reload = true) {
  const b = el('button', label); b.type = 'button'; b.addEventListener('click', async () => {
    if (actionBusy) return; actionBusy = true; b.disabled = true; try { await handler(); if (reload) await refresh(true); } catch (error) { note.textContent = error.message; } finally { actionBusy = false; b.disabled = false; updateAvailability(); }
  }); if (reload || label === 'Connection details') b.dataset.control = 'true'; return b;
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
  const save = el('button', feed ? 'Save feed' : 'Add feed'); save.type = 'submit'; save.dataset.control = 'true'; form.append(save);
  form.addEventListener('submit', async event => { event.preventDefault(); if (actionBusy) return; actionBusy = true; save.disabled = true;
    try { await action(feed ? 'update-feed' : 'add-feed', { id: feed?.id, name: name.value, type: type.value, ...(!feed?.enabled ? { protocols: selected() } : {}) }); await refresh(true); }
    catch (error) { note.textContent = error.message; } finally { actionBusy = false; updateAvailability(); }
  }); return form;
}
function profileForm(profile) {
  const form = el('form'), name = field(form, 'Profile name', profile?.name || ''), scene = field(form, 'OBS normal scene', profile?.scene || ''),
    low = field(form, 'OBS low bitrate scene', profile?.lowScene || 'Low Bitrate'), offline = field(form, 'OBS offline scene', profile?.offlineScene || 'BRB');
  const group = el('fieldset'); group.append(el('legend', 'Feeds used by this scene'));
  const checks = state.feeds.map(f => { const label = el('label', f.name), check = el('input'); check.type = 'checkbox'; check.value = f.id; check.checked = profile?.feedIds.includes(f.id); label.prepend(check); group.append(label); return check; }); form.append(group);
  const min = field(form, 'Minimum healthy feeds', profile?.minimumHealthy || 1, 'number'); min.min = '1'; min.max = state.feeds.length;
  const save = el('button', 'Save profile'); save.dataset.control = 'true'; form.append(save); form.addEventListener('submit', async event => { event.preventDefault(); if (actionBusy) return; actionBusy = true; save.disabled = true;
    try { await action('save-profile', { id: profile?.id, name: name.value, scene: scene.value, lowScene: low.value, offlineScene: offline.value, feedIds: checks.filter(c => c.checked).map(c => c.value), minimumHealthy: Number(min.value) }); await refresh(true); }
    catch (error) { note.textContent = error.message; } finally { actionBusy = false; updateAvailability(); }
  }); return form;
}
function render() {
  root.hidden = false; root.replaceChildren(note);
  const feedsPage = el('section'); feedsPage.dataset.page = 'feeds';
  const productionPage = el('section'); productionPage.dataset.page = 'production';
  feedsPage.append(el('h2', 'Feeds')); productionPage.append(el('h2', 'Production profiles'));
  root.append(feedsPage, productionPage);
  const automation = el('p', `Scene automation: ${state.automationOwner}${state.automationPaused ? ' (paused — Take Live to resume)' : ''}. ${state.error || ''}`); automation.dataset.automation = 'true'; productionPage.append(automation);
  const grid = el('div'); grid.className = 'feed-manager-grid'; feedsPage.append(grid);
  for (const f of state.feeds) {
    const card = el('article'); card.className = 'card card-body'; card.dataset.feedId = f.id; card.append(el('h3', f.name)); const health = el('p'); health.dataset.health = 'true'; card.append(health);
    const image = el('img'); image.dataset.preview = 'true'; image.alt = `Last ingest frame from ${f.name}`; image.hidden = true; const age = el('p'); age.dataset.age = 'true'; card.append(image, age);
    card.append(button('Refresh Now', () => action('refresh', { id: f.id })), button('Connection details', async () => {
      card.querySelector('[data-credentials]')?.remove();
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
      box.append(button('Hide connection details', () => box.remove(), false)); card.append(box);
    }, false));
    const edit = el('details'); edit.append(el('summary', 'Edit feed'), feedForm(f)); card.append(edit);
    card.append(button(f.enabled ? 'Disable' : 'Enable', async () => { if (f.enabled && !confirm(`Disconnect ${f.name}? This may affect the live production.`)) return;
      await action('update-feed', { id: f.id, enabled: !f.enabled, confirm: f.id }); }));
    if (!f.enabled) card.append(button('Rotate credentials', async () => { if (confirm(`Invalidate all old credentials for ${f.name}?`)) await action('rotate-feed', { id: f.id, confirm: f.id }); }),
      button('Delete', async () => { if (confirm(`Delete ${f.name}? Remove it from profiles first.`)) await action('delete-feed', { id: f.id, confirm: f.id }); }));
    grid.append(card);
  }
  const add = el('details'); add.append(el('summary', 'Add feed'), feedForm()); feedsPage.append(add);
  for (const p of state.profiles) {
    const row = el('article'); row.dataset.profileId = p.id; row.className = 'card card-body'; row.append(el('h3', `${p.name}${p.id === state.selectedProfileId ? ' · Selected' : ''}`),
      el('p', `${p.scene}: ${p.health.state} · ${p.health.healthy}/${p.minimumHealthy} healthy feeds required`), button('Take Live', () => action('take', { id: p.id })));
    if (p.id !== state.selectedProfileId) { const edit = el('details'); edit.append(el('summary', 'Edit profile'), profileForm(p)); row.append(edit, button('Delete profile', () => action('delete-profile', { id: p.id }))); }
    productionPage.append(row);
  }
  const addProfile = el('details'); addProfile.append(el('summary', 'Add production profile'), profileForm()); productionPage.append(addProfile); updateLive(state);
  document.dispatchEvent(new Event('pagesupdated'));
}
function updateLive(data) {
  const healthKey = JSON.stringify([data.feeds.map(f => [f.id, f.health?.state, f.health?.telemetryFresh]), data.profiles.map(p => [p.id, p.health.state]), data.error]);
  if (healthKey !== lastHealthKey) {
    lastHealthKey = healthKey;
    historyEntries.unshift(`${new Date().toLocaleTimeString()}: ${data.feeds.map(f => `${f.name}: ${f.health?.telemetryFresh ? f.health.state : 'Telemetry unavailable'}`).join('; ')}. ${data.error || ''}`);
    historyEntries.splice(30);
    const list = document.querySelector('#production-history'); list.replaceChildren(...historyEntries.map(text => el('li', text)));
  }
  const selected = data.profiles.find(p => p.id === data.selectedProfileId);
  document.querySelector('#overview-profile').textContent = selected ? `Active profile: ${selected.name} · ${selected.health.state}` : 'No production profile selected';
  document.querySelector('#overview-health').textContent = data.feeds.map(f => `${f.name}: ${f.health?.telemetryFresh ? f.health.state : 'Telemetry unavailable'} · ${Math.round(f.health?.bitrate || 0)} kbps`).join(' / ');
  document.querySelector('#automation-summary').textContent = `Scene automation: ${data.automationOwner}${data.automationPaused ? ' (paused)' : ''}`;

  for (const card of root.querySelectorAll('[data-feed-id]')) {
    const f = data.feeds.find(f => f.id === card.dataset.feedId);
    const status = card.querySelector('[data-health]');
    if (!f) { status.textContent = 'Feed removed by another operator; finish editing and reload'; continue; }
    status.textContent = `${f.health?.telemetryFresh ? f.health.state : 'Telemetry unavailable'} · ${Math.round(f.health?.bitrate || 0)} kbps${f.enabled ? '' : ' · Disabled'}`;
    const image = card.querySelector('[data-preview]');
    if (f.preview.url && image.getAttribute('src') !== f.preview.url) image.src = f.preview.url;
    image.hidden = !f.preview.available;
    image.onerror = () => { image.hidden = true; card.querySelector('[data-age]').textContent = 'Preview failed to load; check connection or reload to sign in'; };
    card.querySelector('[data-age]').textContent = f.preview.capturedAt ? `${f.preview.stale ? 'Stale preview · ' : ''}Last received ${Math.max(0, Math.floor((Date.now() - f.preview.capturedAt) / 1000))}s ago` : 'Waiting for ingest snapshot';
  }
  for (const row of root.querySelectorAll('[data-profile-id]')) {
    const p = data.profiles.find(p => p.id === row.dataset.profileId);
    if (p) row.querySelector('p').textContent = `${p.scene}: ${p.health.state} · ${p.health.healthy}/${p.minimumHealthy} healthy feeds required${p.id === data.selectedProfileId ? ' · Selected' : ''}`;
  }
  root.querySelector('[data-automation]').textContent = `Scene automation: ${data.automationOwner}${data.automationPaused ? ' (paused — Take Live to resume)' : ''}. ${data.error || ''}`;
  if (state.revision !== data.revision) note.textContent = 'Configuration changed by another operator. Close the editor to reload before saving.';
}
function updateAvailability() {
  const disabled = !reachable || actionBusy || !document.querySelector('#control-token').value;
  for (const control of root.querySelectorAll('[data-control]')) control.disabled = disabled;
}
document.querySelector('#control-token').addEventListener('input', updateAvailability);
async function refresh(force = false) {
  if (refreshing) return;
  refreshing = true;
  try {
    const response = await fetch('/api/v1/production', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (response.status === 404 && !state) { root.hidden = false; note.textContent = 'Dynamic feeds and production profiles are not enabled on this server.'; document.querySelector('#overview-profile').textContent = 'Legacy single-feed mode'; document.querySelector('#automation-summary').textContent = 'Dynamic production automation is not enabled'; document.querySelector('#overview-health').textContent = 'Main ingest status below'; document.dispatchEvent(new Event('pagesupdated')); return; }
    if (!response.ok || response.redirected || !(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Feed status unavailable. Check your connection or reload to sign in.');
    const data = await response.json(); reachable = true;
    if (force || !state || (!actionBusy && !root.querySelector('details[open]') && !root.querySelector('[data-credentials]') && !root.contains(document.activeElement))) { state = data; render(); }
    else updateLive(data);
  } catch (error) {
    reachable = false; note.textContent = error.message; document.querySelector('#overview-profile').textContent = 'Production status unavailable'; document.querySelector('#overview-health').textContent = 'Ingest health unavailable'; document.querySelector('#automation-summary').textContent = 'Automation status unavailable';
    for (const status of root.querySelectorAll('[data-health]')) status.textContent = 'Telemetry unavailable — displayed preview may be stale';
    for (const age of root.querySelectorAll('[data-age]')) age.textContent = 'Preview status unavailable';
    for (const row of root.querySelectorAll('[data-profile-id]')) row.querySelector('p').textContent = 'Production health unavailable';
  } finally { refreshing = false; updateAvailability(); }
}
refresh();
setInterval(refresh, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
