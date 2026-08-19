const panelState = { studios: [], selected: '', data: null, tab: 'studio' };
const $p = (selector, root = document) => root.querySelector(selector);
const $$p = (selector, root = document) => [...root.querySelectorAll(selector)];
const panelEsc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const PANEL_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PANEL_MEDIA_LIMITS = Object.freeze({
  'studio-logo': 2 * 1024 * 1024,
  'studio-banner': 5 * 1024 * 1024,
  'project-poster': 3 * 1024 * 1024,
  'project-banner': 5 * 1024 * 1024,
  'promo-thumbnail': 3 * 1024 * 1024
});
const PANEL_SOCIAL_FIELDS = [
  { key: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/tu-estudio' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/tu-estudio' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@tu-estudio' },
  { key: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@tu-estudio' },
  { key: 'x', aliases: ['twitter'], label: 'X / Twitter', placeholder: 'https://x.com/tu-estudio' },
  { key: 'discord', label: 'Discord', placeholder: 'https://discord.gg/...' },
  { key: 'website', label: 'Sitio web', placeholder: 'https://tu-estudio.example' }
];

async function panelApi(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`/api/studio-panel${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { Accept: 'application/json', ...(!isForm && options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body.error === 'string' && body.error.trim()
      ? body.error
      : typeof body.error?.message === 'string' && body.error.message.trim()
        ? body.error.message
        : 'No pudimos completar esta acción. Inténtalo de nuevo.';
    throw new Error(message);
  }
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
  return `<div class="studio-panel-heading"><div><span>Estudio administrado</span><h1>${panelEsc(studio.name)} ${studio.isVerified ? '<i title="Estudio verificado">✓</i>' : ''}</h1><p>Los cambios se aplican a la identidad pública oficial del estudio.</p></div><button data-edit-studio type="button">Editar perfil</button></div><article class="studio-public-preview">${studio.banner ? `<img class="studio-preview-banner" src="${panelEsc(studio.banner)}" alt="">` : ''}<img class="studio-preview-logo" src="${panelEsc(studio.logo || '/assets/dubverse-icon.png')}" alt=""><div><h2>${panelEsc(studio.name)}</h2><p>${panelEsc(studio.description || 'Sin descripción pública.')}</p><small>${panelEsc(studio.director || 'Dirección no indicada')}</small></div></article>`;
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
  $$p('[data-delete-promo]').forEach(button => button.onclick = async () => {
    if (!confirm('¿Eliminar este material promocional?')) return;
    button.disabled = true;
    try { await panelApi(`/studios/${encodeURIComponent(panelState.selected)}/promos/${encodeURIComponent(button.dataset.deletePromo)}`, { method: 'DELETE' }); await selectStudio(panelState.selected); }
    catch (error) { alert(error.message); button.disabled = false; }
  });
}

const panelDialog = $p('#studioPanelDialog');
const panelFields = $p('#studioPanelFields');
let panelEditor = null;

function panelField(name, label, value = '', type = 'text', options = [], extra = '') {
  if (type === 'textarea') return `<label class="panel-field wide"><span>${label}</span><textarea name="${name}" ${extra}>${panelEsc(value)}</textarea></label>`;
  if (type === 'checkbox') return `<label class="check wide"><input name="${name}" type="checkbox" ${value ? 'checked' : ''}><span>${label}</span></label>`;
  if (type === 'select') return `<label class="panel-field"><span>${label}</span><select name="${name}" ${extra}>${options.map(item => `<option value="${panelEsc(item.value || item)}" ${(item.value || item) === value ? 'selected' : ''}>${panelEsc(item.label || item)}</option>`).join('')}</select></label>`;
  return `<label class="panel-field"><span>${label}</span><input name="${name}" type="${type}" value="${panelEsc(value)}" ${extra}></label>`;
}

function panelSection(title, description, content, className = '') {
  return `<section class="panel-form-section ${className}"><div class="panel-section-heading"><h3>${panelEsc(title)}</h3>${description ? `<p>${panelEsc(description)}</p>` : ''}</div><div class="panel-section-grid">${content}</div></section>`;
}

function mediaField(key, label, url, { kind, help, aspect = 'square', projectId = '' }) {
  return `<div class="panel-media-field wide" data-panel-media="${panelEsc(key)}"><div class="panel-media-copy"><strong>${panelEsc(label)}</strong><small>${panelEsc(help)}</small></div><div class="panel-media-layout"><div class="panel-media-preview ${panelEsc(aspect)}" data-media-preview>${url ? `<img src="${panelEsc(url)}" alt="Previsualización de ${panelEsc(label)}">` : '<span>Sin imagen</span>'}</div><div class="panel-media-actions"><input type="file" accept="image/jpeg,image/png,image/webp" data-media-input hidden><button type="button" data-media-select>Seleccionar imagen</button><button type="button" class="secondary" data-media-remove ${url ? '' : 'disabled'}>Quitar imagen</button><small data-media-status>JPEG, PNG o WebP.</small></div></div></div>`;
}

function socialValue(socials, field) {
  return socials?.[field.key] || (field.aliases || []).map(key => socials?.[key]).find(Boolean) || '';
}

function socialFields(socials) {
  return PANEL_SOCIAL_FIELDS.map(field => panelField(`social_${field.key}`, field.label, socialValue(socials, field), 'url', [], `placeholder="${panelEsc(field.placeholder)}" inputmode="url"`)).join('');
}

function editorMedia(configs) {
  return Object.fromEntries(configs.map(config => [config.key, { ...config, url: config.url || '', file: null, previewUrl: '', automatic: Boolean(config.automatic) }]));
}

function showPanelEditor({ kind, id = '', title, fields, media = [], originalSocials = {}, promo = null }) {
  panelEditor = { kind, id, media: editorMedia(media), originalSocials, promo, initialProvider: promo?.provider || 'YOUTUBE' };
  $p('#studioPanelTitle').textContent = title;
  $p('#studioPanelKicker').textContent = panelState.data.studio.name;
  panelFields.innerHTML = fields;
  const message = $p('#studioPanelMessage');
  message.textContent = '';
  message.className = '';
  const submit = $p('#studioPanelForm button[type="submit"]');
  submit.disabled = false;
  submit.querySelector('span').textContent = 'Guardar cambios';
  bindMediaFields();
  if (kind === 'promo') bindPromoProvider();
  panelDialog.showModal();
  panelDialog.scrollTop = 0;
}

function updateMediaPreview(key) {
  const media = panelEditor?.media[key];
  const field = $p(`[data-panel-media="${CSS.escape(key)}"]`, panelFields);
  if (!media || !field) return;
  const preview = $p('[data-media-preview]', field);
  const src = media.previewUrl || media.url;
  preview.innerHTML = src ? `<img src="${panelEsc(src)}" alt="Previsualización de ${panelEsc(media.label)}">` : '<span>Sin imagen</span>';
  $p('[data-media-remove]', field).disabled = !src;
}

function bindMediaFields() {
  $$p('[data-panel-media]', panelFields).forEach(field => {
    const key = field.dataset.panelMedia;
    const media = panelEditor.media[key];
    const input = $p('[data-media-input]', field);
    const status = $p('[data-media-status]', field);
    $p('[data-media-select]', field).onclick = () => input.click();
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      const limit = PANEL_MEDIA_LIMITS[media.kind] || 3 * 1024 * 1024;
      if (!PANEL_IMAGE_TYPES.has(file.type)) { input.value = ''; status.textContent = 'Selecciona una imagen JPEG, PNG o WebP.'; status.className = 'error'; return; }
      if (file.size > limit) { input.value = ''; status.textContent = `La imagen supera ${Math.round(limit / 1024 / 1024)} MB.`; status.className = 'error'; return; }
      if (media.previewUrl) URL.revokeObjectURL(media.previewUrl);
      media.file = file;
      media.previewUrl = URL.createObjectURL(file);
      media.automatic = false;
      status.textContent = `${file.name} · lista para subir`;
      status.className = 'ready';
      updateMediaPreview(key);
    };
    $p('[data-media-remove]', field).onclick = () => {
      if (media.previewUrl) URL.revokeObjectURL(media.previewUrl);
      media.file = null;
      media.previewUrl = '';
      media.url = '';
      media.automatic = false;
      input.value = '';
      if (key === 'thumbnailUrl' && $p('[name="provider"]', panelFields)?.value === 'YOUTUBE') {
        media.automatic = true;
        syncYouTubeThumbnail();
        return;
      }
      status.textContent = 'La imagen se quitará al guardar.';
      status.className = 'ready';
      updateMediaPreview(key);
    };
  });
}

function openStudioEditor(studio) {
  const media = [
    { key: 'logo', kind: 'studio-logo', label: 'Logo del estudio', url: studio.logo, help: 'Imagen cuadrada. Máximo 2 MB.', aspect: 'square' },
    { key: 'banner', kind: 'studio-banner', label: 'Banner del estudio', url: studio.banner, help: 'Imagen horizontal. Máximo 5 MB.', aspect: 'banner' }
  ];
  const identity = panelField('name', 'Nombre', studio.name) + panelField('director', 'Dirección / administración', studio.director) + panelField('description', 'Descripción', studio.description, 'textarea');
  const images = media.map(item => mediaField(item.key, item.label, item.url, item)).join('');
  showPanelEditor({ kind: 'studio', id: studio.id, title: 'Editar perfil del estudio', media, originalSocials: studio.socials || {}, fields: panelSection('Identidad', 'Información pública principal del estudio.', identity) + panelSection('Imagen', 'Así se reconocerá el estudio en Dubverse.', images) + panelSection('Redes', 'Sólo se mostrarán públicamente los campos completos.', socialFields(studio.socials || {})) });
}

function openProjectEditor(project) {
  const media = [
    { key: 'poster', kind: 'project-poster', label: 'Portada del proyecto', url: project.poster, help: 'Imagen vertical. Máximo 3 MB.', aspect: 'poster', projectId: project.id },
    { key: 'banner', kind: 'project-banner', label: 'Banner del proyecto', url: project.banner, help: 'Imagen horizontal. Máximo 5 MB.', aspect: 'banner', projectId: project.id }
  ];
  const details = panelField('title', 'Título', project.title) + panelField('alternateTitle', 'Título alternativo', project.alternateTitle) + panelField('status', 'Estado', project.status, 'select', [{ value: 'UPCOMING', label: 'Próximamente' }, { value: 'ONGOING', label: 'En emisión' }, { value: 'FINISHED', label: 'Finalizado' }, { value: 'PAUSED', label: 'Pausado' }, { value: 'CANCELLED', label: 'Cancelado' }]) + panelField('projectDirector', 'Dirección del proyecto', project.projectDirector) + panelField('synopsis', 'Sinopsis', project.synopsis, 'textarea') + panelField('dubbingInfo', 'Información del doblaje', project.dubbingInfo, 'textarea') + panelField('credits', 'Créditos', project.credits, 'textarea') + panelField('published', 'Proyecto publicado', project.published, 'checkbox');
  showPanelEditor({ kind: 'project', id: project.id, title: 'Editar proyecto', media, fields: panelSection('Información', 'Metadata pública del proyecto.', details) + panelSection('Imágenes', 'Selecciona archivos desde este dispositivo.', media.map(item => mediaField(item.key, item.label, item.url, item)).join('')) });
}

function openEpisodeEditor(episode) {
  showPanelEditor({ kind: 'episode', id: episode.id, title: 'Editar episodio', fields: panelSection('Información del episodio', 'La fuente de video sigue protegida en el Admin global.', panelField('title', 'Título', episode.title) + panelField('status', 'Estado', episode.status, 'select', ['DRAFT', 'PROCESSING', 'READY', 'PUBLISHED', 'ERROR', 'RETIRED']) + panelField('description', 'Descripción', episode.description, 'textarea') + panelField('published', 'Episodio publicado', episode.published, 'checkbox')) });
}

function panelYouTubeId(value) {
  const raw = String(value || '').trim();
  if (/^[A-Za-z0-9_-]{6,20}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) return url.pathname === '/watch' ? url.searchParams.get('v') || '' : /^\/(?:embed|shorts)\//.test(url.pathname) ? url.pathname.split('/').filter(Boolean)[1] || '' : '';
  } catch {}
  return '';
}

function archiveLink(promo) {
  if (promo?.url) return promo.url;
  return promo?.providerIdentifier ? `https://archive.org/details/${promo.providerIdentifier}` : '';
}

function openPromoEditor(promo = null) {
  const projects = panelState.data.projects.map(project => ({ value: project.id, label: project.title }));
  const initialId = panelYouTubeId(promo?.url || promo?.providerIdentifier || '');
  const automaticThumbnail = promo?.provider === 'YOUTUBE' && promo?.thumbnailUrl === (initialId ? `https://i.ytimg.com/vi/${initialId}/hqdefault.jpg` : '');
  const media = [{ key: 'thumbnailUrl', kind: 'promo-thumbnail', label: 'Miniatura', url: promo?.thumbnailUrl || '', help: 'YouTube se completa automáticamente; también puedes elegir otra imagen.', aspect: 'video', projectId: promo?.projectId || '', automatic: automaticThumbnail }];
  const common = panelField('projectId', 'Proyecto', promo?.projectId || projects[0]?.value || '', 'select', projects, promo ? 'disabled' : '') + panelField('type', 'Tipo', promo?.type || 'TRAILER', 'select', [{ value: 'TRAILER', label: 'Tráiler' }, { value: 'TEASER', label: 'Teaser' }, { value: 'PV', label: 'PV' }, { value: 'SPECIAL', label: 'Especial' }]) + panelField('provider', 'Proveedor', promo?.provider || 'YOUTUBE', 'select', [{ value: 'YOUTUBE', label: 'YouTube' }, { value: 'ARCHIVE', label: 'Archive.org' }, { value: 'DIRECT', label: 'URL directa' }, { value: 'OTHER', label: 'Enlace externo' }]) + panelField('title', 'Título', promo?.title || '') + panelField('position', 'Posición', promo?.position ?? 0, 'number', [], 'min="0" max="10000"') + panelField('isActive', 'Material activo', promo?.isActive ?? true, 'checkbox');
  const providerFields = '<div id="promoProviderFields" class="wide"></div>';
  const thumbnail = mediaField('thumbnailUrl', 'Miniatura', promo?.thumbnailUrl || '', media[0]);
  showPanelEditor({ kind: 'promo', id: promo?.id || '', title: promo ? 'Editar material promocional' : 'Nuevo material promocional', media, promo, fields: panelSection('Información', 'El formulario se adapta al proveedor seleccionado.', common) + panelSection('Fuente del video', '', providerFields, 'provider-section') + panelSection('Presentación', 'La miniatura aparecerá en la ficha del proyecto.', thumbnail) });
}

function renderPromoProviderFields({ reset = false } = {}) {
  const provider = $p('[name="provider"]', panelFields).value;
  const promo = reset ? null : panelEditor.promo;
  const slot = $p('#promoProviderFields', panelFields);
  if (provider === 'YOUTUBE') slot.innerHTML = panelField('videoUrl', 'Enlace de YouTube', promo?.provider === 'YOUTUBE' ? promo.url : '', 'url', [], 'placeholder="https://youtube.com/watch?v=..." inputmode="url"');
  if (provider === 'ARCHIVE') slot.innerHTML = panelField('archiveReference', 'Enlace o identifier de Archive.org', promo?.provider === 'ARCHIVE' ? archiveLink(promo) : '', 'text', [], 'placeholder="https://archive.org/details/..."') + `<label class="panel-field" data-archive-file><span>Archivo dentro del item</span><input name="providerFile" value="${panelEsc(promo?.provider === 'ARCHIVE' ? promo.providerFile : '')}" placeholder="video.mp4"><small>Déjalo vacío si el enlace ya incluye el archivo.</small></label>`;
  if (provider === 'DIRECT') slot.innerHTML = panelField('videoUrl', 'URL directa del video', promo?.provider === 'DIRECT' ? promo.url : '', 'url', [], 'placeholder="https://.../video.mp4" inputmode="url"');
  if (provider === 'OTHER') slot.innerHTML = panelField('videoUrl', 'Enlace externo', promo?.provider === 'OTHER' ? promo.url : '', 'url', [], 'placeholder="https://..." inputmode="url"');
  if (provider === 'YOUTUBE') $p('[name="videoUrl"]', slot).addEventListener('input', syncYouTubeThumbnail);
  if (provider === 'ARCHIVE') {
    const input = $p('[name="archiveReference"]', slot);
    const sync = () => {
      let containsFile = false;
      try { const parts = new URL(input.value).pathname.split('/').filter(Boolean); containsFile = ['download', 'embed'].includes(parts[0]) && parts.length > 2; } catch {}
      $p('[data-archive-file]', slot).classList.toggle('hidden', containsFile);
    };
    input.addEventListener('input', sync); sync();
  }
  if (provider !== 'YOUTUBE') {
    const thumb = panelEditor.media.thumbnailUrl;
    if (thumb.automatic) { thumb.url = ''; thumb.automatic = false; updateMediaPreview('thumbnailUrl'); }
  } else syncYouTubeThumbnail();
}

function syncYouTubeThumbnail() {
  const media = panelEditor.media.thumbnailUrl;
  if (media.file || (media.url && !media.automatic)) return;
  const id = panelYouTubeId($p('[name="videoUrl"]', panelFields)?.value || '');
  media.url = id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
  media.automatic = true;
  const status = $p('[data-panel-media="thumbnailUrl"] [data-media-status]', panelFields);
  if (status) status.textContent = id ? 'Miniatura oficial de YouTube detectada.' : 'Pega un enlace válido para obtener la miniatura.';
  updateMediaPreview('thumbnailUrl');
}

function bindPromoProvider() {
  const select = $p('[name="provider"]', panelFields);
  renderPromoProviderFields();
  select.onchange = () => { panelEditor.promo = null; renderPromoProviderFields({ reset: true }); };
}

function buildSocials(form) {
  const socials = { ...(panelEditor.originalSocials || {}) };
  for (const field of PANEL_SOCIAL_FIELDS) {
    delete socials[field.key];
    for (const alias of field.aliases || []) delete socials[alias];
    const value = String(form.elements[`social_${field.key}`]?.value || '').trim();
    if (value) socials[field.key] = value;
  }
  return socials;
}

function formBody(form) {
  const body = {};
  for (const [key, value] of new FormData(form)) if (!(value instanceof File)) body[key] = value;
  $$p('input[type="checkbox"]', form).forEach(input => { body[input.name] = input.checked; });
  return body;
}

async function uploadEditorMedia(form, message) {
  const uploaded = [];
  for (const media of Object.values(panelEditor.media)) {
    if (!media.file) continue;
    message.textContent = `Subiendo ${media.label.toLowerCase()}…`;
    const data = new FormData();
    data.set('kind', media.kind);
    data.set('file', media.file);
    data.set('projectId', media.projectId || form.elements.projectId?.value || panelEditor.promo?.projectId || '');
    const result = await panelApi(`/studios/${encodeURIComponent(panelState.selected)}/media`, { method: 'POST', body: data });
    media.url = result.image.url;
    uploaded.push(result.image.url);
  }
  return uploaded;
}

async function cleanupUploadedMedia(urls) {
  if (!urls.length) return;
  await panelApi(`/studios/${encodeURIComponent(panelState.selected)}/media`, { method: 'DELETE', body: JSON.stringify({ urls }) }).catch(() => {});
}

function closePanelEditor() {
  for (const media of Object.values(panelEditor?.media || {})) if (media.previewUrl) URL.revokeObjectURL(media.previewUrl);
  panelDialog.close();
  panelEditor = null;
}

async function selectStudio(id) {
  panelState.selected = id;
  renderPanelSidebar();
  $p('#studioPanelContent').innerHTML = '<div class="studio-panel-loading"><span></span><p>Cargando estudio…</p></div>';
  try { panelState.data = await panelApi(`/${encodeURIComponent(id)}`); renderPanelContent(); }
  catch (error) { $p('#studioPanelContent').innerHTML = `<p class="studio-panel-error">${panelEsc(error.message)}</p>`; }
}

$p('#studioPanelClose').onclick = closePanelEditor;
$p('#studioPanelCancel').onclick = closePanelEditor;
panelDialog.addEventListener('close', () => {
  for (const media of Object.values(panelEditor?.media || {})) if (media.previewUrl) URL.revokeObjectURL(media.previewUrl);
  panelEditor = null;
});
$p('#studioPanelForm').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = $p('#studioPanelMessage');
  const submit = $p('button[type="submit"]', form);
  const submitLabel = submit.querySelector('span');
  const uploaded = [];
  submit.disabled = true;
  submitLabel.textContent = 'Guardando…';
  message.className = '';
  message.textContent = 'Preparando cambios…';
  try {
    uploaded.push(...await uploadEditorMedia(form, message));
    const body = formBody(form);
    body.position = body.position === undefined ? undefined : Number(body.position);
    const base = `/studios/${encodeURIComponent(panelState.selected)}`;
    let path = base;
    let method = 'PATCH';
    if (panelEditor.kind === 'studio') {
      body.logo = panelEditor.media.logo.url;
      body.banner = panelEditor.media.banner.url;
      body.socials = buildSocials(form);
    }
    if (panelEditor.kind === 'project') {
      path += `/projects/${encodeURIComponent(panelEditor.id)}`;
      body.poster = panelEditor.media.poster.url;
      body.banner = panelEditor.media.banner.url;
    }
    if (panelEditor.kind === 'episode') path += `/episodes/${encodeURIComponent(panelEditor.id)}`;
    if (panelEditor.kind === 'promo') {
      path += `/promos${panelEditor.id ? `/${encodeURIComponent(panelEditor.id)}` : ''}`;
      method = panelEditor.id ? 'PATCH' : 'POST';
      body.projectId = form.elements.projectId?.value || panelEditor.promo?.projectId || '';
      body.providerIdentifier = body.provider === 'ARCHIVE' ? body.archiveReference : '';
      body.providerFile = body.provider === 'ARCHIVE' ? body.providerFile || '' : '';
      body.url = ['YOUTUBE', 'DIRECT', 'OTHER'].includes(body.provider) ? body.videoUrl || '' : /^https?:/i.test(body.archiveReference || '') ? body.archiveReference : '';
      body.thumbnailUrl = panelEditor.media.thumbnailUrl.url;
      delete body.videoUrl;
      delete body.archiveReference;
    }
    message.textContent = 'Guardando cambios…';
    await panelApi(path, { method, body: JSON.stringify(body) });
    await selectStudio(panelState.selected);
    message.className = 'success';
    message.textContent = 'Cambios guardados';
    submitLabel.textContent = 'Guardado';
    setTimeout(() => { if (panelDialog.open) closePanelEditor(); }, 650);
  } catch (error) {
    await cleanupUploadedMedia(uploaded);
    message.className = 'error';
    message.textContent = error.message;
    submit.disabled = false;
    submitLabel.textContent = 'Guardar cambios';
  }
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
