const panelState = { studios: [], selected: '', data: null, tab: 'studio' };
const $p = (selector, root = document) => root.querySelector(selector);
const $$p = (selector, root = document) => [...root.querySelectorAll(selector)];
const panelEsc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

async function panelApi(path, options = {}) {
  const response = await fetch(`/api/studio-panel${path}`, { credentials: 'same-origin', ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
  return body;
}

function panelBadge(text, active = false) { return `<span class="studio-panel-badge ${active ? 'active' : ''}">${panelEsc(text)}</span>`; }
function panelStatus(status) { return ({ ONGOING: 'En emisión', UPCOMING: 'Próximamente', FINISHED: 'Finalizado', PAUSED: 'Pausado', CANCELLED: 'Cancelado', DRAFT: 'Borrador', READY: 'Listo', PUBLISHED: 'Publicado', PROCESSING: 'Procesando', ERROR: 'Error', RETIRED: 'Retirado' })[status] || status; }

function renderPanelSidebar() {
  const sidebar = $p('#studioPanelSidebar');
  sidebar.innerHTML = `<span class="sidebar-label">Mis estudios</span>${panelState.studios.map(studio => `<button type="button" data-select-studio="${panelEsc(studio.id)}" class="${studio.id === panelState.selected ? 'active' : ''}"><img src="${panelEsc(studio.logo || '/assets/dubverse-icon.png')}" alt=""><span><strong>${panelEsc(studio.name)}</strong><small>${panelEsc(studio.role)}${studio.isVerified ? ' · Verificado' : ''}</small></span></button>`).join('')}<nav><button data-panel-tab="studio">Perfil público</button><button data-panel-tab="projects">Proyectos</button><button data-panel-tab="episodes">Episodios</button><button data-panel-tab="promos">Material promocional</button></nav><p class="sidebar-note">Este panel no concede acceso al Admin global ni muestra credenciales de infraestructura.</p>`;
  $$p('[data-select-studio]', sidebar).forEach(button => button.onclick = () => selectStudio(button.dataset.selectStudio));
  $$p('[data-panel-tab]', sidebar).forEach(button => {
    button.classList.toggle('active', button.dataset.panelTab === panelState.tab);
    button.onclick = () => { panelState.tab = button.dataset.panelTab; renderPanelSidebar(); renderPanelContent(); };
  });
}

function studioView(data) {
  const studio = data.studio;
  return `<div class="studio-panel-heading"><div><span>Estudio administrado</span><h1>${panelEsc(studio.name)} ${studio.isVerified ? '<i title="Estudio verificado">✓</i>' : ''}</h1><p>Los cambios se aplican a la identidad pública oficial del estudio.</p></div><button data-edit-studio type="button">Editar perfil</button></div><article class="studio-public-preview">${studio.banner ? `<div class="studio-preview-banner" style="background-image:url('${panelEsc(studio.banner)}')"></div>` : ''}<img src="${panelEsc(studio.logo || '/assets/dubverse-icon.png')}" alt=""><div><h2>${panelEsc(studio.name)}</h2><p>${panelEsc(studio.description || 'Sin descripción pública.')}</p><small>${panelEsc(studio.director || 'Dirección no indicada')}</small></div></article>`;
}

function projectsView(data) {
  return `<div class="studio-panel-heading"><div><span>Contenido del estudio</span><h1>Proyectos</h1><p>Sólo aparecen proyectos relacionados con ${panelEsc(data.studio.name)}.</p></div></div><div class="studio-record-list">${data.projects.map(project => `<article><img src="${panelEsc(project.poster || '/assets/dubverse-icon.png')}" alt=""><div><strong>${panelEsc(project.title)}</strong><small>${panelEsc(panelStatus(project.status))} · ${project.episodeCount} episodios</small></div>${panelBadge(project.published ? 'Publicado' : 'Oculto', project.published)}<button data-edit-project="${panelEsc(project.id)}" type="button">Editar</button></article>`).join('') || '<p class="studio-panel-empty">No hay proyectos relacionados.</p>'}</div>`;
}

function episodesView(data) {
  return `<div class="studio-panel-heading"><div><span>Metadata autorizada</span><h1>Episodios</h1><p>Las credenciales y cargas de Archive continúan limitadas al Admin global.</p></div></div><div class="studio-record-list">${data.episodes.map(episode => `<article><span class="episode-number">${String(episode.number).padStart(2, '0')}</span><div><strong>${panelEsc(episode.projectTitle)} — ${panelEsc(episode.title)}</strong><small>T${episode.season} · ${panelEsc(panelStatus(episode.status))}</small></div>${panelBadge(episode.published ? 'Publicado' : 'Oculto', episode.published)}<button data-edit-episode="${panelEsc(episode.id)}" type="button">Editar</button></article>`).join('') || '<p class="studio-panel-empty">No hay episodios relacionados.</p>'}</div>`;
}

function promosView(data) {
  return `<div class="studio-panel-heading"><div><span>Tráilers y teasers</span><h1>Material promocional</h1><p>Entidad independiente: nunca se crea un episodio 0.</p></div><button data-new-promo type="button">+ Agregar material</button></div><div class="studio-record-list">${data.promos.map(promo => `<article><img src="${panelEsc(promo.thumbnailUrl || data.projects.find(project => project.id === promo.projectId)?.poster || '/assets/dubverse-icon.png')}" alt=""><div><strong>${panelEsc(promo.title)}</strong><small>${panelEsc(promo.type)} · ${panelEsc(promo.provider)} · ${panelEsc(data.projects.find(project => project.id === promo.projectId)?.title || promo.projectId)}</small></div>${panelBadge(promo.isActive ? 'Activo' : 'Inactivo', promo.isActive)}<button data-edit-promo="${panelEsc(promo.id)}" type="button">Editar</button><button class="danger" data-delete-promo="${panelEsc(promo.id)}" type="button">Eliminar</button></article>`).join('') || '<p class="studio-panel-empty">Todavía no hay material promocional.</p>'}</div>`;
}

function renderPanelContent() {
  const data = panelState.data;
  if (!data) return;
  $p('#studioPanelContent').innerHTML = ({ studio: studioView, projects: projectsView, episodes: episodesView, promos: promosView })[panelState.tab](data);
  $p('[data-edit-studio]')?.addEventListener('click', () => openStudioEditor(data.studio));
  $$p('[data-edit-project]').forEach(button => button.onclick = () => openProjectEditor(data.projects.find(item => item.id === button.dataset.editProject)));
  $$p('[data-edit-episode]').forEach(button => button.onclick = () => openEpisodeEditor(data.episodes.find(item => item.id === button.dataset.editEpisode)));
  $p('[data-new-promo]')?.addEventListener('click', () => openPromoEditor());
  $$p('[data-edit-promo]').forEach(button => button.onclick = () => openPromoEditor(data.promos.find(item => item.id === button.dataset.editPromo)));
  $$p('[data-delete-promo]').forEach(button => button.onclick = async () => { if (!confirm('¿Eliminar este material promocional?')) return; await panelApi(`/studios/${encodeURIComponent(panelState.selected)}/promos/${encodeURIComponent(button.dataset.deletePromo)}`, { method: 'DELETE' }); await selectStudio(panelState.selected); });
}

const panelDialog = $p('#studioPanelDialog');
const panelFields = $p('#studioPanelFields');
let panelEditor = null;
function panelField(name, label, value = '', type = 'text', options = []) {
  if (type === 'textarea') return `<label class="wide"><span>${label}</span><textarea name="${name}">${panelEsc(value)}</textarea></label>`;
  if (type === 'checkbox') return `<label class="check wide"><input name="${name}" type="checkbox" ${value ? 'checked' : ''}><span>${label}</span></label>`;
  if (type === 'select') return `<label><span>${label}</span><select name="${name}">${options.map(item => `<option value="${panelEsc(item.value || item)}" ${(item.value || item) === value ? 'selected' : ''}>${panelEsc(item.label || item)}</option>`).join('')}</select></label>`;
  return `<label><span>${label}</span><input name="${name}" type="${type}" value="${panelEsc(value)}"></label>`;
}
function showPanelEditor(kind, id, title, fields) { panelEditor = { kind, id }; $p('#studioPanelTitle').textContent = title; $p('#studioPanelKicker').textContent = panelState.data.studio.name; panelFields.innerHTML = fields; $p('#studioPanelMessage').textContent = ''; panelDialog.showModal(); }
function openStudioEditor(studio) { showPanelEditor('studio', studio.id, 'Editar perfil del estudio', panelField('name', 'Nombre', studio.name) + panelField('director', 'Dirección / administración', studio.director) + panelField('description', 'Descripción', studio.description, 'textarea') + panelField('logo', 'URL del logo', studio.logo) + panelField('banner', 'URL del banner', studio.banner) + panelField('socials', 'Redes sociales (JSON)', JSON.stringify(studio.socials || {}, null, 2), 'textarea')); }
function openProjectEditor(project) { showPanelEditor('project', project.id, 'Editar proyecto', panelField('title', 'Título', project.title) + panelField('alternateTitle', 'Título alternativo', project.alternateTitle) + panelField('status', 'Estado', project.status, 'select', [{ value: 'UPCOMING', label: 'Próximamente' }, { value: 'ONGOING', label: 'En emisión' }, { value: 'FINISHED', label: 'Finalizado' }, { value: 'PAUSED', label: 'Pausado' }, { value: 'CANCELLED', label: 'Cancelado' }]) + panelField('synopsis', 'Sinopsis', project.synopsis, 'textarea') + panelField('projectDirector', 'Dirección del proyecto', project.projectDirector, 'text') + panelField('dubbingInfo', 'Información del doblaje', project.dubbingInfo, 'textarea') + panelField('credits', 'Créditos', project.credits, 'textarea') + panelField('poster', 'URL de portada', project.poster) + panelField('banner', 'URL de banner', project.banner) + panelField('published', 'Proyecto publicado', project.published, 'checkbox')); }
function openEpisodeEditor(episode) { showPanelEditor('episode', episode.id, 'Editar episodio', panelField('title', 'Título', episode.title) + panelField('description', 'Descripción', episode.description, 'textarea') + panelField('status', 'Estado', episode.status, 'select', ['DRAFT', 'PROCESSING', 'READY', 'PUBLISHED', 'ERROR', 'RETIRED']) + panelField('published', 'Episodio publicado', episode.published, 'checkbox')); }
function openPromoEditor(promo = null) { const projects = panelState.data.projects.map(project => ({ value: project.id, label: project.title })); showPanelEditor('promo', promo?.id || '', promo ? 'Editar material promocional' : 'Nuevo material promocional', panelField('projectId', 'Proyecto', promo?.projectId || projects[0]?.value || '', 'select', projects) + panelField('type', 'Tipo', promo?.type || 'TRAILER', 'select', ['TRAILER', 'TEASER', 'PV', 'SPECIAL']) + panelField('provider', 'Proveedor', promo?.provider || 'YOUTUBE', 'select', ['YOUTUBE', 'ARCHIVE', 'DIRECT', 'OTHER']) + panelField('title', 'Título', promo?.title || '') + panelField('url', 'URL', promo?.url || '') + panelField('providerIdentifier', 'ID de YouTube / Archive', promo?.providerIdentifier || '') + panelField('providerFile', 'Archivo de Archive', promo?.providerFile || '') + panelField('thumbnailUrl', 'Miniatura', promo?.thumbnailUrl || '') + panelField('position', 'Posición', promo?.position || 0, 'number') + panelField('isActive', 'Material activo', promo?.isActive ?? true, 'checkbox')); }

async function selectStudio(id) { panelState.selected = id; renderPanelSidebar(); $p('#studioPanelContent').innerHTML = '<div class="studio-panel-loading"><span></span><p>Cargando estudio…</p></div>'; try { panelState.data = await panelApi(`/${encodeURIComponent(id)}`); renderPanelContent(); } catch (error) { $p('#studioPanelContent').innerHTML = `<p class="studio-panel-error">${panelEsc(error.message)}</p>`; } }

$p('#studioPanelClose').onclick = () => panelDialog.close();
$p('#studioPanelCancel').onclick = () => panelDialog.close();
$p('#studioPanelForm').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form));
  $$p('input[type="checkbox"]', form).forEach(input => { body[input.name] = input.checked; });
  if (panelEditor.kind === 'studio') { try { body.socials = JSON.parse(body.socials || '{}'); } catch { return $p('#studioPanelMessage').textContent = 'Las redes deben ser un objeto JSON válido.'; } }
  body.position = body.position === undefined ? undefined : Number(body.position);
  const base = `/studios/${encodeURIComponent(panelState.selected)}`;
  let path = base; let method = 'PATCH';
  if (panelEditor.kind === 'project') path += `/projects/${encodeURIComponent(panelEditor.id)}`;
  if (panelEditor.kind === 'episode') path += `/episodes/${encodeURIComponent(panelEditor.id)}`;
  if (panelEditor.kind === 'promo') { path += `/promos${panelEditor.id ? `/${encodeURIComponent(panelEditor.id)}` : ''}`; method = panelEditor.id ? 'PATCH' : 'POST'; }
  $p('#studioPanelMessage').textContent = 'Guardando…';
  try { await panelApi(path, { method, body: JSON.stringify(body) }); panelDialog.close(); await selectStudio(panelState.selected); } catch (error) { $p('#studioPanelMessage').textContent = error.message; }
};

(async function initStudioPanel() {
  try {
    const data = await panelApi('');
    panelState.studios = data.studios || [];
    if (!panelState.studios.length) { $p('#studioPanelSidebar').innerHTML = ''; $p('#studioPanelContent').innerHTML = '<div class="studio-panel-empty-page"><h1>Sin estudios asignados</h1><p>El Admin global debe asignar tu @username explícitamente a un estudio.</p><a href="/">Volver a Dubverse</a></div>'; return; }
    panelState.selected = panelState.studios[0].id;
    renderPanelSidebar();
    await selectStudio(panelState.selected);
  } catch (error) {
    $p('#studioPanelSidebar').innerHTML = '';
    $p('#studioPanelContent').innerHTML = `<div class="studio-panel-empty-page"><h1>No pudimos abrir el panel</h1><p>${panelEsc(error.message)}</p><a href="/">Iniciar sesión o volver a Dubverse</a></div>`;
  }
})();
