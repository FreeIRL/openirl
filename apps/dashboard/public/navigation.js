// Keep one live controller and DOM tree across routes, including unsaved editors.
const pages = { overview: ['Overview', 'Your live broadcast at a glance.'], feeds: ['Feeds', 'Manage sources and secure connection details.'], production: ['Production', 'Choose the feeds and scenes that go live together.'], obs: ['OBS / Stream', 'Scenes, audio, stream controls and recovery.'], health: ['Health', 'Live telemetry, service diagnostics and recent changes.'], settings: ['Settings', 'Server configuration and operator access.'], more: ['More', 'Stream controls and advanced settings.'] };
const move = (selector, destination) => document.querySelector(destination).append(document.querySelector(selector));
move('.token-field', '#access'); move('#control-note', '#access'); move('#control-result', '#action-status');
move('.stream-card', '#page-obs'); move('.ingest-card', '#page-overview'); move('.scene-card', '#page-obs');
move('.ingest-actions', '#page-obs'); move('#audio-note', '#page-obs'); move('#recovery-note', '#page-obs'); move('#recovery-result', '#page-obs');
move('.preview-card', '#page-overview'); move('.chart-card', '#page-health'); move('.system-card', '#page-health');
document.querySelector('#system').open = true;
document.querySelector('.top-grid').remove(); document.querySelector('.media-grid').remove();
function route(focus = false) {
  const key = location.pathname.slice(1) || 'overview';
  const page = pages[key] ? key : 'overview';
  document.querySelectorAll('[data-page]').forEach(node => { node.hidden = node.dataset.page !== page; });
  document.querySelector('#feed-manager').hidden = !['feeds', 'production'].includes(page);
  document.querySelector('#page-title').textContent = pages[page][0];
  document.querySelector('#page-description').textContent = pages[page][1];
  document.title = `${pages[page][0]} · OpenIRL`;
  document.querySelectorAll('[data-route]').forEach(link => {
    const active = link.dataset.route === page || (link.dataset.route === 'more' && ['obs', 'settings'].includes(page));
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  if (focus) { document.querySelector('#page-title').focus(); window.scrollTo(0, 0); }
  window.dispatchEvent(new Event('resize'));
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[data-route], a.brand');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); history.pushState({}, '', link.getAttribute('href')); route(true);
});
addEventListener('popstate', () => route(true));
document.addEventListener('pagesupdated', () => route());
route();
