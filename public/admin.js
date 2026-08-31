const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));

const state = {
  tab: 'dashboard',
  projects: [],
  episodes: [],
  studios: [],
  overview: null,
  config: null,
  home: null,
  studioAccess: { studios: [], memberships: [], users: [] },
  idAudit: null,
  moderation: { reports: { items: [] }, users: [] },
  moderationStatus: 'OPEN',
  trash: { projects: [], studios: [], episodes: [] }
};

const titles = {
  dashboard: 'Resumen',
  home: 'Portada',
  projects: 'Proyectos',
  episodes: 'Episodios',
  studios: 'Estudios',
  ids: 'IDs y aliases',
  upload: 'Subir a Archive',
  moderation: 'Moderación',
  announcements: 'Anuncios',
  trash: 'Papelera'
};

const EPISODE_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Borrador' },
  { value: 'UPLOADING', label: 'Subiendo' },
  { value: 'PROCESSING', label: 'Procesando' },
  { value: 'READY', label: 'Listo' },
  { value: 'PUBLISHED', label: 'Publicado' },
  { value: 'ERROR', label: 'Error' },
  { value: 'RETIRED', label: 'Retirado' }
];
const PROJECT_TYPE_OPTIONS = [
  { value: 'SERIES', label: 'Serie' },
  { value: 'MOVIE', label: 'Película' },
  { value: 'OVA', label: 'OVA' },
  { value: 'SPECIAL', label: 'Especial' },
  { value: 'MANGA_COMIC_DUB', label: 'Manga / Comic Dub' }
];
const STUDIO_SOCIAL_KEYS = ['website', 'facebook', 'youtube', 'instagram', 'tiktok', 'twitter', 'x', 'discord', 'twitch'];
const episodeStatusLabel = status => EPISODE_STATUS_OPTIONS.find(option => option.value === status)?.label || status;
const projectTypeLabel = type => PROJECT_TYPE_OPTIONS.find(option => option.value === type)?.label || type;
const slugValue = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

function recommendedId(kind, record) {
  if (kind === 'projects') return slugValue(record.title);
  if (kind === 'studios') return slugValue(record.name);
  return slugValue(`${record.project_id}-s${String(record.season || 1).padStart(2, '0')}-e${String(record.number || 1).padStart(3, '0')}`);
}

let flashTimer = null;

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const headers = isForm
    ? { ...(options.headers || {}) }
    : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Error ${response.status}`);
    error.field = data.field || null;
    throw error;
  }
  return data;
}

function flash(message, type = 'success') {
  const element = $('#flash');
  clearTimeout(flashTimer);
  element.textContent = message;
  element.className = `flash ${type}`;
  flashTimer = setTimeout(() => element.classList.add('hidden'), 5000);
}

function badge(text, kind = '') {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

function dateLabel(value) {
  if (!value) return 'Fecha no disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

async function checkSession() {
  try {
    const session = await api('/api/admin/session');
    if (session.authenticated) {
      $('#loginView').classList.add('hidden');
      $('#panelView').classList.remove('hidden');
      await navigate('dashboard');
    } else {
      $('#loginView').classList.remove('hidden');
      $('#panelView').classList.add('hidden');
    }
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#loginButton');
  $('#loginError').textContent = '';
  button.disabled = true;
  button.textContent = 'Comprobando…';
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ key: $('#loginKey').value })
    });
    $('#loginKey').value = '';
    await checkSession();
  } catch (error) {
    $('#loginError').textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar al panel';
  }
});

async function logout() {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); }
  finally { location.reload(); }
}

$('#logoutButton').addEventListener('click', logout);
$('#topLogoutButton').addEventListener('click', logout);
$$('.sidebar nav button').forEach(button => button.addEventListener('click', () => navigate(button.dataset.tab)));

async function refresh(includeTrash = false, includeModeration = false, includeHome = false, includeIds = false) {
  const requests = [
    api('/api/admin/projects'),
    api('/api/admin/episodes'),
    api('/api/admin/studios'),
    api('/api/admin/overview'),
    api('/api/admin/config')
  ];
  if (includeTrash) requests.push(api('/api/admin/trash'));
  if (includeModeration) requests.push(api(`/api/admin/moderation/list?status=${encodeURIComponent(state.moderationStatus)}`));
  if (includeHome) requests.push(api('/api/admin/home'));
  if (includeIds) requests.push(api('/api/admin/ids/audit'));
  const result = await Promise.all(requests);
  [state.projects, state.episodes, state.studios, state.overview, state.config] = result;
  let index = 5;
  if (includeTrash) state.trash = result[index++];
  if (includeModeration) state.moderation = result[index++];
  if (includeHome) state.home = result[index];
  if (includeHome) index += 1;
  if (includeIds) state.idAudit = result[index];
}

async function navigate(tab) {
  state.tab = tab;
  $$('.sidebar nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  $('#tabTitle').textContent = titles[tab] || titles.dashboard;
  $('#content').innerHTML = '<div class="loading">Cargando…</div>';
  try {
    await refresh(tab === 'trash', tab === 'moderation', tab === 'home', tab === 'ids');
    await ({ dashboard, home, projects, episodes, studios, ids, upload, moderation, announcements, trash }[tab] || dashboard)();
  } catch (error) {
    if (/Sesión|administrativa requerida/i.test(error.message)) return location.reload();
    $('#content').innerHTML = `
      <div class="empty error-panel">
        <strong>${esc(error.message)}</strong>
        <button id="retryPanel" class="action-btn" type="button">Reintentar</button>
      </div>`;
    $('#retryPanel').onclick = () => navigate(tab);
  }
}

function dashboard() {
  const overview = state.overview;
  const config = state.config;
  const max = Math.max(...overview.providers.map(item => item.count), 1);
  $('#content').innerHTML = `
    <div class="stats">
      <div class="stat"><span>Proyectos</span><strong>${overview.projects}</strong></div>
      <div class="stat"><span>Episodios</span><strong>${overview.episodes}</strong></div>
      <div class="stat"><span>Estudios</span><strong>${overview.studios}</strong></div>
      <div class="stat"><span>Procesando</span><strong>${overview.processing}</strong></div>
      <div class="stat"><span>Papelera</span><strong>${overview.trash || 0}</strong></div>
    </div>

    <div class="panel-card">
      <h2>Conexiones</h2>
      <div class="config-grid">
        <div>Neon ${config.database ? badge('Conectado', 'green') : badge('Falta', 'red')}</div>
        <div>Sesiones ${config.authSecret ? badge('Protegidas', 'green') : badge('Falta', 'red')}</div>
        <div>Clave admin ${config.adminKey ? badge('Configurada', 'green') : badge('Falta', 'red')}</div>
        <div>Vercel Blob ${config.blob ? badge('Conectado', 'green') : badge('Opcional', 'yellow')}</div>
      </div>
    </div>

    <div class="panel-card">
      <h2>Distribución por proveedor</h2>
      <div class="provider-bars">
        ${overview.providers.map(provider => `
          <div class="provider-row">
            <strong>${esc(provider.provider)}</strong>
            <div class="bar"><i style="width:${provider.count / max * 100}%"></i></div>
            <span>${provider.count}</span>
          </div>`).join('') || '<p class="muted">Sin episodios registrados.</p>'}
      </div>
    </div>

    <div class="panel-card dashboard-actions">
      <div>
        <h2>Respaldo y seguridad</h2>
        <p>Descarga una copia JSON de proyectos, episodios, estudios, relaciones y registros en papelera.</p>
      </div>
      <div class="row-actions">
        <a class="action-link" href="/api/admin/export">Descargar respaldo</a>
        <button id="openTrash" class="action-btn secondary" type="button">Abrir papelera</button>
      </div>
    </div>

    <div class="panel-card">
      <h2>Base migrada</h2>
      <p class="muted panel-copy">Los proyectos, estudios y episodios viven en Neon. Todo cambio realizado aquí aparece en la página pública sin editar GitHub.</p>
    </div>`;
  $('#openTrash').onclick = () => navigate('trash');
}

const HOME_SECTION_TYPE_OPTIONS = [
  { value: 'AUTO_STATUS', label: 'Automática por estado' },
  { value: 'AUTO_TYPE', label: 'Automática por tipo' },
  { value: 'RECENT', label: 'Recién agregados' },
  { value: 'CURATED', label: 'Selección manual' },
  { value: 'RECOMMENDED', label: 'Recomendaciones' }
];
const PROJECT_STATUS_OPTIONS = [
  { value: 'UPCOMING', label: 'Próximamente' },
  { value: 'ONGOING', label: 'En emisión' },
  { value: 'FINISHED', label: 'Finalizado' },
  { value: 'PAUSED', label: 'Pausado' },
  { value: 'CANCELLED', label: 'Cancelado' }
];
const HOME_STATUS_OPTIONS = [
  { value: 'UPCOMING', label: 'Próximamente' }, { value: 'ONGOING', label: 'En emisión' }, { value: 'FINISHED', label: 'Finalizados' },
  { value: 'PAUSED', label: 'Pausados' }, { value: 'CANCELLED', label: 'Cancelados' }
];

function homeCollectionCard(kind, item, index, total) {
  const resource = item.project || item.studio;
  const image = resource.poster || resource.banner || resource.logo || '/assets/dubverse-icon.png';
  const name = resource.title || resource.name;
  return `<article class="home-item" data-home-kind="${kind}" data-resource-id="${esc(item.projectId || item.studioId)}">
    <img src="${esc(image)}" alt=""><div><strong>${esc(name)}</strong><small>${item.enabled ? 'Activo en portada' : 'Desactivado'}</small></div>
    ${kind === 'hero-projects' ? `<label class="compact-field">Peso <select data-home-weight>${[1, 2, 3, 4, 5].map(weight => `<option value="${weight}" ${weight === item.weight ? 'selected' : ''}>${weight}</option>`).join('')}</select></label>` : ''}
    <label class="switch-field"><input type="checkbox" data-home-enabled ${item.enabled ? 'checked' : ''}><span>Activo</span></label>
    <div class="home-order"><button type="button" data-home-move="-1" ${index === 0 ? 'disabled' : ''} aria-label="Mover arriba">↑</button><button type="button" data-home-move="1" ${index === total - 1 ? 'disabled' : ''} aria-label="Mover abajo">↓</button><button class="danger" type="button" data-home-remove aria-label="Quitar">×</button></div>
  </article>`;
}

function homeCollection(kind, title, description, items, resources, key) {
  const selected = new Set(items.map(item => item.projectId || item.studioId));
  const available = resources.filter(resource => resource.published && !selected.has(resource.id));
  return `<section class="panel-card home-admin-block" data-home-collection="${kind}">
    <header class="home-block-heading"><div><h2>${title}</h2><p>${description}</p></div>${badge(`${items.filter(item => item.enabled).length} activos`, 'green')}</header>
    <div class="home-add-row"><input type="search" data-home-add-search placeholder="Buscar ${kind === 'featured-studios' ? 'estudio' : 'proyecto'}"><select data-home-add-select><option value="">Seleccionar…</option>${available.map(resource => `<option value="${esc(resource.id)}">${esc(resource[key])}</option>`).join('')}</select><button type="button" data-home-add ${available.length ? '' : 'disabled'}>Agregar</button></div>
    <div class="home-item-list">${items.map((item, index) => homeCollectionCard(kind, item, index, items.length)).join('') || '<div class="empty compact-empty">Sin selección manual. La portada usará el fallback configurado.</div>'}</div>
  </section>`;
}

function sectionTypeLabel(type) {
  return ({ HERO: 'Hero', FEATURED_PROJECTS: 'Proyectos destacados', FEATURED_STUDIOS: 'Estudios destacados', AUTO_STATUS: 'Por estado', AUTO_TYPE: 'Por tipo', RECENT: 'Recientes', CURATED: 'Curada', RECOMMENDED: 'Recomendada' })[type] || type;
}

function home() {
  const data = state.home;
  const site = data.site || {};
  const socials = site.socials || {};
  const sections = [...(data.sections || [])].sort((left, right) => left.position - right.position);
  const publishedProjects = state.projects.filter(project => project.published);
  const publishedStudios = state.studios.filter(studio => studio.published);
  $('#content').innerHTML = `
    <div class="home-admin-intro"><div><span class="kicker">CENTRO EDITORIAL</span><h2>Controla la portada sin editar código</h2><p>Los cambios guardados se reflejan en el endpoint público agregado.</p></div><a class="action-link" href="/" target="_blank" rel="noopener noreferrer">Ver portada ↗</a></div>
    ${homeCollection('hero-projects', 'Hero', 'Elige proyectos publicados. El peso influye en el orden de cada ronda sin repetir proyectos.', data.heroProjects || [], publishedProjects, 'title')}
    ${homeCollection('featured-projects', 'Proyectos destacados', 'La selección manual tiene prioridad; la cantidad y el autocompletado viven en su sección.', data.featuredProjects || [], publishedProjects, 'title')}
    ${homeCollection('featured-studios', 'Estudios destacados', 'Selecciona, activa y ordena estudios publicados.', data.featuredStudios || [], publishedStudios, 'name')}

    <section class="panel-card home-admin-block" data-home-sections>
      <header class="home-block-heading"><div><h2>Secciones de contenido</h2><p>Orden, activación, título, cantidad y modo de cada fila de la portada.</p></div><button id="newHomeSection" type="button">+ Nueva sección</button></header>
      <div class="home-section-list">${sections.map((section, index) => `<article class="home-section-item" data-section-index="${index}"><span class="home-position">${index + 1}</span><div><strong>${esc(section.title || sectionTypeLabel(section.sectionType))}</strong><small>${esc(sectionTypeLabel(section.sectionType))} · máximo ${section.maxItems}${section.persisted ? '' : ' · default sin guardar'}</small></div><label class="switch-field"><input type="checkbox" data-section-enabled ${section.enabled ? 'checked' : ''}><span>Activa</span></label><div class="home-order"><button type="button" data-section-move="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-section-move="1" ${index === sections.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-section-edit>Editar</button>${section.isDefault || !section.persisted ? '' : '<button class="danger" type="button" data-section-remove>×</button>'}</div></article>`).join('')}</div>
    </section>

    <section class="panel-card home-admin-block" data-home-banners>
      <header class="home-block-heading"><div><h2>Banners / Novedades</h2><p>Promociones internas con imagen opcional, enlace seguro y programación por fechas.</p></div><button id="newHomeBanner" type="button">+ Crear banner</button></header>
      <div class="home-banner-list">${(data.banners || []).map(banner => `<article class="home-banner-item" data-banner-id="${esc(banner.id)}">${banner.imageUrl ? `<img src="${esc(banner.imageUrl)}" alt="">` : '<span class="banner-placeholder">Novedad</span>'}<div><strong>${esc(banner.title)}</strong><small>${esc(banner.label || 'Sin etiqueta')} · posición ${banner.position}${banner.startsAt ? ` · desde ${esc(dateLabel(banner.startsAt))}` : ''}${banner.endsAt ? ` · hasta ${esc(dateLabel(banner.endsAt))}` : ''}</small></div>${banner.enabled ? badge('Activo', 'green') : badge('Inactivo', 'red')}<div class="row-actions"><button class="action-btn" type="button" data-banner-edit>Editar</button><button class="action-btn danger" type="button" data-banner-remove>Eliminar</button></div></article>`).join('') || '<div class="empty compact-empty">Todavía no hay banners editoriales.</div>'}</div>
    </section>

    <section class="panel-card home-admin-block">
      <header class="home-block-heading"><div><h2>Configuración general</h2><p>Nombre visible, footer, contacto y redes públicas. Los campos vacíos no se muestran.</p></div></header>
      <form id="siteSettingsForm" class="home-settings-grid">
        ${field('siteName', 'Nombre visible', site.siteName || 'DUBVERSE')}
        ${field('publicEmail', 'Correo público', site.publicEmail || '', 'email')}
        ${field('footerSlogan', 'Slogan del footer', site.footerSlogan || '', 'text', true)}
        ${field('description', 'Descripción breve', site.description || '', 'textarea', true)}
        ${field('copyrightText', 'Texto de copyright', site.copyrightText || '', 'text', true)}
        ${field('website', 'Sitio web / contacto', socials.website || '', 'url')}
        ${field('facebook', 'Facebook', socials.facebook || '', 'url')}
        ${field('instagram', 'Instagram', socials.instagram || '', 'url')}
        ${field('x', 'X / Twitter', socials.x || socials.twitter || '', 'url')}
        ${field('youtube', 'YouTube', socials.youtube || '', 'url')}
        ${field('discord', 'Discord', socials.discord || '', 'url')}
        ${field('tiktok', 'TikTok', socials.tiktok || '', 'url')}
        <div class="home-settings-actions"><button type="submit">Guardar configuración</button></div>
      </form>
    </section>`;
  bindHomeAdmin(sections);
}

async function saveHomeCollection(kind, id, body, method = 'PATCH') {
  await api(`/api/admin/home/${kind}/${encodeURIComponent(id)}`, { method, body: JSON.stringify(body) });
}

async function reorderHomeCollection(kind, items, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target], items[index]];
  await Promise.all(items.map((item, position) => saveHomeCollection(kind, item.projectId || item.studioId, { enabled: item.enabled, position: position * 10, weight: item.weight || 1 })));
}

async function persistHomeSection(section, updates = {}) {
  const body = { ...section, ...updates };
  delete body.id;
  delete body.persisted;
  if (section.id) return api(`/api/admin/home/sections/${encodeURIComponent(section.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  const result = await api('/api/admin/home/sections', { method: 'POST', body: JSON.stringify(body) });
  section.id = result.id;
  section.persisted = true;
  return result;
}

function bindHomeAdmin(sections) {
  $$('[data-home-collection]').forEach(block => {
    const kind = block.dataset.homeCollection;
    const items = kind === 'hero-projects' ? state.home.heroProjects : kind === 'featured-projects' ? state.home.featuredProjects : state.home.featuredStudios;
    $('[data-home-add-search]', block).oninput = event => {
      const query = event.target.value.trim().toLowerCase();
      const select = $('[data-home-add-select]', block);
      [...select.options].slice(1).forEach(option => { option.hidden = Boolean(query && !option.textContent.toLowerCase().includes(query)); });
      if (select.selectedOptions[0]?.hidden) select.value = '';
    };
    $('[data-home-add]', block).onclick = async () => {
      const id = $('[data-home-add-select]', block).value;
      if (!id) return flash('Selecciona un recurso publicado.', 'error');
      try { await api(`/api/admin/home/${kind}`, { method: 'POST', body: JSON.stringify({ resourceId: id, enabled: true, position: items.length * 10, weight: 1 }) }); flash('Elemento agregado'); await navigate('home'); } catch (error) { flash(error.message, 'error'); }
    };
    $$('[data-resource-id]', block).forEach((card, index) => {
      const item = items[index];
      $('[data-home-enabled]', card).onchange = async event => { try { await saveHomeCollection(kind, card.dataset.resourceId, { enabled: event.target.checked, position: item.position, weight: $('[data-home-weight]', card)?.value || item.weight || 1 }); flash('Estado actualizado'); await navigate('home'); } catch (error) { flash(error.message, 'error'); } };
      $('[data-home-weight]', card)?.addEventListener('change', async event => { try { await saveHomeCollection(kind, card.dataset.resourceId, { enabled: item.enabled, position: item.position, weight: Number(event.target.value) }); flash('Peso actualizado'); await navigate('home'); } catch (error) { flash(error.message, 'error'); } });
      $$('[data-home-move]', card).forEach(button => button.onclick = async () => { try { await reorderHomeCollection(kind, items, index, Number(button.dataset.homeMove)); flash('Orden actualizado'); await navigate('home'); } catch (error) { flash(error.message, 'error'); } });
      $('[data-home-remove]', card).onclick = async () => { if (!confirm('¿Quitar este elemento de la selección manual?')) return; try { await saveHomeCollection(kind, card.dataset.resourceId, {}, 'DELETE'); flash('Elemento quitado'); await navigate('home'); } catch (error) { flash(error.message, 'error'); } };
    });
  });

  $('#newHomeSection').onclick = () => openHomeSection();
  $$('.home-section-item').forEach((card, index) => {
    const section = sections[index];
    $('[data-section-edit]', card).onclick = () => openHomeSection(section);
    $('[data-section-enabled]', card).onchange = async event => { try { await persistHomeSection(section, { enabled: event.target.checked }); flash('Sección actualizada'); await navigate('home'); } catch (error) { flash(error.message, 'error'); } };
    $$('[data-section-move]', card).forEach(button => button.onclick = async () => {
      const target = index + Number(button.dataset.sectionMove);
      if (target < 0 || target >= sections.length) return;
      [sections[index], sections[target]] = [sections[target], sections[index]];
      try { for (let position = 0; position < sections.length; position += 1) await persistHomeSection(sections[position], { position: position * 10 }); flash('Orden de portada actualizado'); await navigate('home'); } catch (error) { flash(error.message, 'error'); }
    });
    $('[data-section-remove]', card)?.addEventListener('click', async () => { if (!confirm('¿Eliminar esta sección de la portada?')) return; try { await api(`/api/admin/home/sections/${encodeURIComponent(section.id)}`, { method: 'DELETE' }); flash('Sección eliminada'); await navigate('home'); } catch (error) { flash(error.message, 'error'); } });
  });

  $('#newHomeBanner').onclick = () => openHomeBanner();
  $$('.home-banner-item').forEach(card => {
    const banner = state.home.banners.find(item => item.id === card.dataset.bannerId);
    $('[data-banner-edit]', card).onclick = () => openHomeBanner(banner);
    $('[data-banner-remove]', card).onclick = async () => { if (!confirm('¿Eliminar definitivamente este banner editorial?')) return; try { await api(`/api/admin/home/banners/${encodeURIComponent(banner.id)}`, { method: 'DELETE' }); flash('Banner eliminado'); await navigate('home'); } catch (error) { flash(error.message, 'error'); } };
  });

  $('#siteSettingsForm').onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const socialKeys = ['website', 'facebook', 'instagram', 'x', 'youtube', 'discord', 'tiktok'];
    const socials = Object.fromEntries(socialKeys.filter(key => values[key]?.trim()).map(key => [key, values[key].trim()]));
    socialKeys.forEach(key => delete values[key]);
    try { await api('/api/admin/home/settings', { method: 'POST', body: JSON.stringify({ ...values, socials }) }); flash('Configuración guardada'); await navigate('home'); } catch (error) { flash(error.message, 'error'); }
  };
}

async function announcements() {
  const history = await api('/api/admin/announcements');
  $('#content').innerHTML = `<section class="admin-announcements"><div class="home-admin-intro"><div><span class="kicker">Comunicación</span><h2>Crear anuncio</h2><p>Usa el mismo buzón interno de notificaciones. El envío se realiza con una sola inserción SQL y deduplicación.</p></div></div>
    <form id="announcementForm" class="form-grid announcement-form">
      ${field('title','Título','','text')} ${field('message','Mensaje','','textarea',true)}
      ${field('imageUrl','Imagen opcional','','url',true)} ${field('linkUrl','Link opcional','','text',true)}
      ${field('audienceType','Destinatarios','ALL','select',false,[{value:'ALL',label:'Todos los usuarios'},{value:'STUDIO_FOLLOWERS',label:'Seguidores de un estudio'},{value:'PROJECT_FOLLOWERS',label:'Seguidores/favoritos de un proyecto'},{value:'USER',label:'Usuario específico'}])}
      ${field('audienceId','ID del estudio/proyecto o @username','','text',true)}
      <button type="submit">Revisar y enviar</button><p class="editor-status" role="status"></p>
    </form>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Anuncio</th><th>Destinatarios</th><th>Enviados</th><th>Fecha</th></tr></thead><tbody>${history.announcements.map(item=>`<tr><td><strong>${esc(item.title)}</strong><small class="record-sub">${esc(item.message)}</small></td><td>${esc(item.audienceType)} ${esc(item.audienceId)}</td><td>${item.recipientCount}</td><td>${dateLabel(item.createdAt)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">Sin anuncios enviados.</td></tr>'}</tbody></table></div></section>`;
  $('#announcementForm').onsubmit = async event => {
    event.preventDefault(); const form=event.currentTarget; const body=Object.fromEntries(new FormData(form)); const status=$('.editor-status',form);
    const warning=body.audienceType==='ALL'?'Esta notificación será enviada a todos los usuarios de Dubverse. ¿Deseas continuar?':'¿Deseas enviar esta notificación a los destinatarios seleccionados?';
    if (!confirm(warning)) return;
    body.requestId = form.dataset.requestId || crypto.randomUUID(); form.dataset.requestId = body.requestId;
    status.textContent='Enviando…'; $('button[type="submit"]',form).disabled=true;
    try { const result=await api('/api/admin/announcements',{method:'POST',body:JSON.stringify(body)}); flash(`Anuncio enviado a ${result.recipientCount} usuarios`); await announcements(); }
    catch(error){status.textContent=error.message;$('button[type="submit"]',form).disabled=false;}
  };
}

function projects() {
  $('#content').innerHTML = `
    <div class="toolbar">
      <input id="tableSearch" type="search" placeholder="Buscar proyecto" />
      <button id="newProject" type="button">+ Nuevo proyecto</button>
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Proyecto</th><th>Tipo</th><th>Estado</th><th>Estudios</th><th>Episodios</th><th>Visible</th><th>Acciones</th></tr></thead>
      <tbody id="projectRows"></tbody>
    </table></div>`;

  const draw = () => {
    const query = $('#tableSearch').value.toLowerCase();
    const rows = state.projects.filter(project => project.title.toLowerCase().includes(query));
    $('#projectRows').innerHTML = rows.map(project => `
      <tr>
        <td><div class="record-cell"><img class="thumb" src="${esc(project.poster || '/assets/dubverse-icon.png')}" alt=""><div><div class="record-title">${esc(project.title)}</div><div class="record-sub">${esc(project.id)}</div></div></div></td>
        <td>${badge(projectTypeLabel(project.type))}</td>
        <td>${badge(project.status, project.status === 'FINISHED' ? 'green' : 'yellow')}</td>
        <td>${project.studios?.length || 0}</td><td>${project.episodeCount}</td>
        <td>${project.published ? badge('Publicado', 'green') : badge('Oculto', 'red')}</td>
        <td><div class="row-actions"><button class="action-btn edit-project" data-id="${esc(project.id)}">Editar</button><button class="action-btn promo-project" data-id="${esc(project.id)}">Material promocional</button><button class="action-btn rename-project" data-id="${esc(project.id)}">Cambiar ID / slug</button><button class="action-btn danger trash-project" data-id="${esc(project.id)}">Papelera</button></div></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">Sin resultados</td></tr>';
    bindProjectRows();
  };

  $('#tableSearch').addEventListener('input', draw);
  $('#newProject').onclick = () => openProject();
  draw();
}

function bindProjectRows() {
  $$('.edit-project').forEach(button => button.onclick = () => openProject(state.projects.find(project => project.id === button.dataset.id)));
  $$('.promo-project').forEach(button => button.onclick = () => openProjectPromos(state.projects.find(project => project.id === button.dataset.id)));
  $$('.rename-project').forEach(button => button.onclick = () => {
    const project = state.projects.find(item => item.id === button.dataset.id);
    openIdRename({ kind: 'projects', name: project.title, currentId: project.id, recommendedId: recommendedId('projects', project) });
  });
  $$('.trash-project').forEach(button => button.onclick = () => moveToTrash('projects', button.dataset.id, 'El proyecto dejará de mostrarse, pero sus episodios y relaciones podrán restaurarse.'));
}

function episodes() {
  $('#content').innerHTML = `
    <div class="toolbar">
      <input id="tableSearch" type="search" placeholder="Buscar episodio o proyecto" />
      <select id="statusFilter"><option value="">Todos los estados</option>${EPISODE_STATUS_OPTIONS.map(status => `<option value="${status.value}">${status.label}</option>`).join('')}</select>
      <button id="newEpisode" type="button">+ Nuevo episodio</button>
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Episodio</th><th>Proyecto</th><th>Proveedor</th><th>Estado</th><th>Visible</th><th>Última modificación</th><th>Acciones</th></tr></thead>
      <tbody id="episodeRows"></tbody>
    </table></div>`;

  const draw = () => {
    const query = $('#tableSearch').value.toLowerCase();
    const status = $('#statusFilter').value;
    const rows = state.episodes.filter(episode => `${episode.title} ${episode.project_title}`.toLowerCase().includes(query) && (!status || episode.status === status));
    $('#episodeRows').innerHTML = rows.map(episode => `
      <tr>
        <td><div class="record-title">T${episode.season} · E${String(episode.number).padStart(2, '0')} — ${esc(episode.title)}</div><div class="record-sub">${esc(episode.id)}</div></td>
        <td>${esc(episode.project_title)}</td><td>${badge(episode.provider)}</td>
        <td>${badge(episodeStatusLabel(episode.status), ['PUBLISHED', 'READY'].includes(episode.status) ? 'green' : episode.status === 'ERROR' ? 'red' : 'yellow')}</td>
        <td>${episode.published ? badge('Sí', 'green') : badge('No', 'red')}</td>
        <td><span class="modified-date">${esc(dateLabel(episode.updatedAt || episode.updated_at))}</span></td>
        <td><div class="row-actions">
          <button class="action-btn edit-episode" data-id="${esc(episode.id)}">Editar</button>
          <button class="action-btn rename-episode" data-id="${esc(episode.id)}">Cambiar ID / slug</button>
          ${episode.provider === 'ARCHIVE' && episode.archive_identifier ? `<button class="action-btn check-archive" data-id="${esc(episode.id)}">Revisar Archive</button>` : ''}
          <button class="action-btn danger trash-episode" data-id="${esc(episode.id)}">Papelera</button>
        </div></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">Sin resultados</td></tr>';
    bindEpisodeRows();
  };

  $('#tableSearch').addEventListener('input', draw);
  $('#statusFilter').addEventListener('change', draw);
  $('#newEpisode').onclick = () => openEpisode();
  draw();
}

function bindEpisodeRows() {
  $$('.edit-episode').forEach(button => button.onclick = () => openEpisode(state.episodes.find(episode => episode.id === button.dataset.id)));
  $$('.rename-episode').forEach(button => button.onclick = () => {
    const episode = state.episodes.find(item => item.id === button.dataset.id);
    openIdRename({ kind: 'episodes', name: `${episode.project_title} · T${episode.season} E${episode.number} — ${episode.title}`, currentId: episode.id, recommendedId: recommendedId('episodes', episode) });
  });
  $$('.trash-episode').forEach(button => button.onclick = () => moveToTrash('episodes', button.dataset.id, 'El episodio se ocultará y podrá restaurarse desde la papelera.'));
  $$('.check-archive').forEach(button => button.onclick = async () => {
    button.disabled = true;
    button.textContent = 'Revisando…';
    try {
      const result = await api(`/api/admin/archive/status/${encodeURIComponent(button.dataset.id)}`);
      flash(`Archive: ${episodeStatusLabel(result.status)}`);
      await navigate('episodes');
    } catch (error) {
      flash(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Revisar Archive';
    }
  });
}

function studios() {
  $('#content').innerHTML = `
    <div class="toolbar">
      <input id="tableSearch" type="search" placeholder="Buscar estudio" />
      <button id="newStudio" type="button">+ Nuevo estudio</button>
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Estudio</th><th>Dirección</th><th>Proyectos</th><th>Visible</th><th>Acciones</th></tr></thead>
      <tbody id="studioRows"></tbody>
    </table></div>
    <section class="panel-card studio-access-admin" id="studioAccessAdmin"><header><div><h2>Administradores de estudios</h2><p>Asigna cuentas personales por @username. Estos permisos no conceden acceso al Admin global.</p></div></header><div class="home-add-row"><input id="studioAdminSearch" type="search" placeholder="Buscar @username"><button id="searchStudioAdmin" type="button">Buscar</button></div><div id="studioAdminResults"></div><div id="studioMembershipList"><p class="muted">Cargando membresías…</p></div></section>`;

  const draw = () => {
    const query = $('#tableSearch').value.toLowerCase();
    const rows = state.studios.filter(studio => studio.name.toLowerCase().includes(query));
    $('#studioRows').innerHTML = rows.map(studio => `
      <tr>
        <td><div class="record-cell"><img class="logo-thumb" src="${esc(studio.logo || '/assets/dubverse-icon.png')}" alt=""><div><div class="record-title">${esc(studio.name)} ${studio.isVerified ? '✓' : ''}</div><div class="record-sub">${esc(studio.id)}${studio.isVerified ? ' · verificado' : ''}</div></div></div></td>
        <td>${esc(studio.director || '—')}</td><td>${studio.projects.length}</td>
        <td>${studio.published ? badge('Publicado', 'green') : badge('Oculto', 'red')}</td>
        <td><div class="row-actions"><button class="action-btn edit-studio" data-id="${esc(studio.id)}">Editar</button><button class="action-btn rename-studio" data-id="${esc(studio.id)}">Cambiar ID / slug</button><button class="action-btn danger trash-studio" data-id="${esc(studio.id)}">Papelera</button></div></td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">Sin resultados</td></tr>';
    bindStudioRows();
  };

  $('#tableSearch').addEventListener('input', draw);
  $('#newStudio').onclick = () => openStudio();
  draw();
  loadStudioAccessAdmin();
}

async function openProjectPromos(project) {
  let modal = $('#projectPromosDialog');
  if (!modal) {
    modal = document.createElement('dialog');
    modal.id = 'projectPromosDialog';
    modal.className = 'promo-admin-dialog';
    document.body.appendChild(modal);
  }
  const result = await api(`/api/admin/promos?projectId=${encodeURIComponent(project.id)}`);
  modal.innerHTML = `<div class="promo-admin-shell"><header><div><span class="kicker">Material promocional</span><h2>${esc(project.title)}</h2></div><button type="button" data-close-promos aria-label="Cerrar">×</button></header><div class="promo-admin-list">${result.promos.map(promo => `<article data-promo-record="${esc(promo.id)}"><span><strong>${esc(promo.title)}</strong><small>${esc(promo.type)} · ${esc(promo.provider)} · posición ${promo.position}</small></span>${promo.isActive ? badge('Activo', 'green') : badge('Inactivo', 'red')}<button class="action-btn" data-edit-promo type="button">Editar</button><button class="action-btn danger" data-delete-promo type="button">Eliminar</button></article>`).join('') || '<p class="muted">Todavía no hay tráilers o teasers.</p>'}</div><form id="promoAdminForm"><input name="id" type="hidden"><div class="form-grid">${field('title', 'Título', '')}${field('type', 'Tipo', 'TRAILER', 'select', false, ['TRAILER', 'TEASER', 'PV', 'SPECIAL'])}${field('provider', 'Proveedor', 'YOUTUBE', 'select', false, ['YOUTUBE', 'ARCHIVE', 'DIRECT', 'OTHER'])}${field('url', 'URL', '', 'text', true)}${field('providerIdentifier', 'ID de YouTube / Archive', '')}${field('providerFile', 'Archivo de Archive', '')}${field('thumbnailUrl', 'URL de miniatura', '', 'text', true)}${field('position', 'Posición', 0, 'number')}${field('isActive', 'Material activo', true, 'checkbox')}</div><p class="editor-status" role="status"></p><footer><button class="secondary" type="reset">Limpiar</button><button type="submit">Guardar material</button></footer></form></div>`;
  $('[data-close-promos]', modal).onclick = () => modal.close();
  const form = $('#promoAdminForm', modal);
  $$('[data-promo-record]', modal).forEach(card => {
    const promo = result.promos.find(item => item.id === card.dataset.promoRecord);
    $('[data-edit-promo]', card).onclick = () => {
      ['id', 'title', 'type', 'provider', 'url', 'providerIdentifier', 'providerFile', 'thumbnailUrl', 'position'].forEach(key => { form.elements[key].value = promo[key] ?? ''; });
      form.elements.isActive.checked = promo.isActive;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    $('[data-delete-promo]', card).onclick = async () => {
      if (!confirm('¿Eliminar definitivamente este material promocional?')) return;
      await api(`/api/admin/promos/${encodeURIComponent(promo.id)}`, { method: 'DELETE' });
      modal.close(); await openProjectPromos(project);
    };
  });
  form.onsubmit = async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    values.projectId = project.id; values.position = Number(values.position || 0); values.isActive = form.elements.isActive.checked;
    const message = $('.editor-status', form); message.textContent = 'Guardando…';
    try {
      await api(values.id ? `/api/admin/promos/${encodeURIComponent(values.id)}` : '/api/admin/promos', { method: values.id ? 'PATCH' : 'POST', body: JSON.stringify(values) });
      modal.close(); await openProjectPromos(project);
    } catch (error) { message.textContent = error.message; }
  };
  modal.showModal();
}

async function loadStudioAccessAdmin(query = '') {
  const root = $('#studioAccessAdmin');
  if (!root) return;
  try {
    const result = await api(`/api/admin/studio-access${query ? `?query=${encodeURIComponent(query)}` : ''}`);
    state.studioAccess = result;
    $('#studioAdminResults').innerHTML = result.users.length ? `<div class="studio-admin-search-results">${result.users.map(user => `<article><span><strong>@${esc(user.username)}</strong><small>${esc(user.display_name)}</small></span><select data-studio-for-user="${esc(user.username)}">${result.studios.map(studio => `<option value="${esc(studio.id)}">${esc(studio.name)}</option>`).join('')}</select><button data-grant-studio="${esc(user.username)}" type="button">Dar permiso</button></article>`).join('')}</div>` : query ? '<p class="muted">No se encontraron usuarios activos.</p>' : '';
    $('#studioMembershipList').innerHTML = `<div class="studio-membership-list">${result.studios.map(studio => { const members = result.memberships.filter(item => item.studio_id === studio.id); return `<article><header><strong>${esc(studio.name)} ${studio.isVerified ? '✓' : ''}</strong><small>${members.length} administrador${members.length === 1 ? '' : 'es'}</small></header>${members.map(member => `<div><span><strong>@${esc(member.username)}</strong><small>${esc(member.display_name)} · ${esc(member.role)}</small></span><button class="action-btn danger" data-revoke-membership="${esc(member.id)}" type="button">Revocar</button></div>`).join('') || '<p class="muted">Sin administradores asignados.</p>'}</article>`; }).join('')}</div>`;
    $('#searchStudioAdmin').onclick = () => loadStudioAccessAdmin($('#studioAdminSearch').value.trim().replace(/^@/, ''));
    $('#studioAdminSearch').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('#searchStudioAdmin').click(); } };
    $$('[data-grant-studio]').forEach(button => button.onclick = async () => {
      const studioId = $(`[data-studio-for-user="${CSS.escape(button.dataset.grantStudio)}"]`).value;
      try { await api('/api/admin/studio-access', { method: 'POST', body: JSON.stringify({ username: button.dataset.grantStudio, studioId, role: 'ADMIN' }) }); flash('Administrador asignado.'); await loadStudioAccessAdmin(); } catch (error) { flash(error.message, 'error'); }
    });
    $$('[data-revoke-membership]').forEach(button => button.onclick = async () => {
      if (!confirm('¿Revocar el acceso de este administrador al estudio?')) return;
      try { await api(`/api/admin/studio-access/${encodeURIComponent(button.dataset.revokeMembership)}`, { method: 'DELETE' }); flash('Permiso revocado.'); await loadStudioAccessAdmin(); } catch (error) { flash(error.message, 'error'); }
    });
  } catch (error) {
    $('#studioMembershipList').innerHTML = `<p class="error">${esc(error.message)}</p>`;
    $('#searchStudioAdmin').onclick = () => loadStudioAccessAdmin($('#studioAdminSearch').value.trim().replace(/^@/, ''));
  }
}

function bindStudioRows() {
  $$('.edit-studio').forEach(button => button.onclick = () => openStudio(state.studios.find(studio => studio.id === button.dataset.id)));
  $$('.rename-studio').forEach(button => button.onclick = () => {
    const studio = state.studios.find(item => item.id === button.dataset.id);
    openIdRename({ kind: 'studios', name: studio.name, currentId: studio.id, recommendedId: recommendedId('studios', studio) });
  });
  $$('.trash-studio').forEach(button => button.onclick = () => moveToTrash('studios', button.dataset.id, 'El estudio se ocultará sin perder sus relaciones con los proyectos.'));
}

function idKindLabel(kind) {
  return ({ projects: 'Proyecto', studios: 'Estudio', episodes: 'Episodio' })[kind] || kind;
}

function idStatusBadge(item) {
  if (item.status === 'CORRECT') return badge('Correcto', 'green');
  if (item.status === 'CONFLICT') return badge('Conflicto', 'red');
  return badge('Incorrecto', 'yellow');
}

function ids() {
  const audit = state.idAudit;
  $('#content').innerHTML = `
    <div class="id-audit-intro">
      <div><span class="kicker">AUDITORÍA DE SOLO LECTURA</span><h2>IDs, slugs y aliases históricos</h2><p>Esta lista no corrige nada automáticamente. Revisa cada recomendación y decide manualmente qué registro cambiar.</p></div>
      ${badge(`${audit.summary.aliases} aliases`, 'green')}
    </div>
    <div class="stats id-audit-stats">
      <div class="stat"><span>Total</span><strong>${audit.summary.total}</strong></div>
      <div class="stat"><span>Correctos</span><strong>${audit.summary.correct}</strong></div>
      <div class="stat"><span>Por revisar</span><strong>${audit.summary.incorrect}</strong></div>
      <div class="stat"><span>Conflictos</span><strong>${audit.summary.conflicts}</strong></div>
    </div>
    <div class="toolbar id-audit-toolbar">
      <input id="idAuditSearch" type="search" placeholder="Buscar nombre o ID" />
      <select id="idAuditKind"><option value="">Todos los tipos</option><option value="projects">Proyectos</option><option value="studios">Estudios</option><option value="episodes">Episodios</option></select>
      <select id="idAuditStatus"><option value="">Todos los estados</option><option value="INCORRECT">Incorrectos</option><option value="CONFLICT">Conflictos</option><option value="CORRECT">Correctos</option></select>
    </div>
    <div class="table-wrap"><table class="data-table id-audit-table">
      <thead><tr><th>Tipo</th><th>Nombre</th><th>ID actual</th><th>ID recomendado</th><th>Estado</th><th>Aliases</th><th>Acción</th></tr></thead>
      <tbody id="idAuditRows"></tbody>
    </table></div>`;

  const draw = () => {
    const query = $('#idAuditSearch').value.trim().toLowerCase();
    const kind = $('#idAuditKind').value;
    const status = $('#idAuditStatus').value;
    const rows = audit.items.filter(item => (!kind || item.kind === kind) && (!status || item.status === status)
      && (!query || `${item.name} ${item.currentId} ${item.recommendedId}`.toLowerCase().includes(query)));
    $('#idAuditRows').innerHTML = rows.map(item => {
      const index = audit.items.indexOf(item);
      return `<tr>
        <td>${badge(idKindLabel(item.kind))}${item.deleted ? `<div class="record-sub">En papelera</div>` : ''}</td>
        <td><div class="record-title">${esc(item.name)}</div><div class="record-sub">${esc(item.detail)}</div></td>
        <td><code class="id-code">${esc(item.currentId)}</code></td>
        <td><code class="id-code recommended">${esc(item.recommendedId)}</code></td>
        <td>${idStatusBadge(item)}</td>
        <td>${item.aliasCount}</td>
        <td><button class="action-btn audit-rename" type="button" data-index="${index}">Cambiar ID / slug</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">Sin resultados</td></tr>';
    $$('.audit-rename').forEach(button => button.onclick = () => openIdRename(audit.items[Number(button.dataset.index)]));
  };

  $('#idAuditSearch').oninput = draw;
  $('#idAuditKind').onchange = draw;
  $('#idAuditStatus').onchange = draw;
  draw();
}

function upload() {
  const options = state.projects.map(project => `<option value="${esc(project.id)}">${esc(project.title)}</option>`).join('');
  $('#content').innerHTML = `
    <div class="upload-layout">
      <div>
        <div class="panel-card panel-card-first"><h2>Flujo de subida</h2><div class="steps">
          <div class="step"><h3>Prepara el episodio</h3><p>Créalo como borrador en “Episodios”.</p></div>
          <div class="step"><h3>Abre Dubverse Uploader</h3><p>El programa manda el MP4 directamente a Archive.org. Las claves no pasan por Vercel.</p></div>
          <div class="step"><h3>Espera el procesamiento</h3><p>Archive seguirá trabajando aunque cierres la página.</p></div>
          <div class="step"><h3>Revisa y publica</h3><p>Cuando aparezca Listo, activa Publicado y cambia el estado a Publicado.</p></div>
        </div></div>
        <div class="panel-card"><h2>Crear episodio para el cargador</h2><button id="quickEpisode" type="button">+ Preparar nuevo episodio</button></div>
      </div>
      <div>
        <div class="panel-card panel-card-first"><h2>Inspeccionar item existente</h2><div class="field"><span>Identificador de Archive.org</span><input id="archiveIdentifier" placeholder="anohana-cap-4"></div><button id="inspectArchive" type="button" class="button-spaced">Consultar Archive</button><pre id="inspectResult" class="inspect-result">Sin consulta todavía.</pre></div>
        <div class="panel-card"><h2>Importar enlace existente</h2><div class="field"><span>Proyecto</span><select id="importProject">${options}</select></div><div class="form-grid form-spaced"><div class="field"><span>Temporada</span><input id="importSeason" type="number" min="1" value="1"></div><div class="field"><span>Número</span><input id="importNumber" type="number" min="1" value="1"></div></div><div class="field form-spaced"><span>Título</span><input id="importTitle" placeholder="Capítulo 1"></div><button id="importArchive" type="button" class="button-spaced">Crear episodio</button></div>
      </div>
    </div>`;
  $('#quickEpisode').onclick = () => openEpisode();
  $('#inspectArchive').onclick = inspectArchive;
  $('#importArchive').onclick = importArchive;
}

async function inspectArchive() {
  const identifier = $('#archiveIdentifier').value.trim();
  if (!identifier) return flash('Escribe un identificador', 'error');
  $('#inspectResult').textContent = 'Consultando…';
  try {
    const result = await api('/api/admin/archive/inspect', { method: 'POST', body: JSON.stringify({ identifier }) });
    $('#inspectResult').textContent = JSON.stringify({ ready: result.ready, title: result.metadata?.title, selected: result.selected, files: result.files }, null, 2);
  } catch (error) {
    $('#inspectResult').textContent = error.message;
  }
}

async function importArchive() {
  const projectId = $('#importProject').value;
  const season = Number($('#importSeason').value);
  const number = Number($('#importNumber').value);
  const title = $('#importTitle').value.trim() || `Episodio ${number}`;
  const archiveIdentifier = $('#archiveIdentifier').value.trim();
  if (!archiveIdentifier) return flash('Primero escribe el identificador de Archive', 'error');
  try {
    await api('/api/admin/episodes', {
      method: 'POST',
      body: JSON.stringify({ projectId, season, number, title, provider: 'ARCHIVE', archiveIdentifier, status: 'PROCESSING', published: false })
    });
    flash('Episodio creado como Procesando');
    await navigate('episodes');
  } catch (error) {
    flash(error.message, 'error');
  }
}

function moderation() {
  const reports = state.moderation.reports?.items || [];
  const users = state.moderation.users || [];
  $('#content').innerHTML = `
    <div class="toolbar">
      <select id="reportStatus"><option value="OPEN">Reportes abiertos</option><option value="RESOLVED">Resueltos</option><option value="DISMISSED">Descartados</option></select>
      <span class="muted">${reports.length} reporte${reports.length === 1 ? '' : 's'} en esta página</span>
    </div>
    <div class="moderation-grid">
      <section>
        <div class="moderation-list">${reports.map(report => `
          <article class="moderation-card" data-report-id="${esc(report.id)}">
            <header><div>${badge(report.reason, report.status === 'OPEN' ? 'red' : 'green')} ${badge(report.content.kind === 'REPLY' ? 'RESPUESTA' : report.targetType === 'COMMENT' ? 'COMENTARIO PRINCIPAL' : 'RESEÑA')}</div><time>${esc(dateLabel(report.createdAt))}</time></header>
            <p class="reported-copy">${esc(report.content.body)}</p>
            <div class="moderation-context">
              <span>Autor: ${report.author ? `<strong>@${esc(report.author.username)}</strong> ${badge(report.author.status, report.author.status === 'ACTIVE' ? 'green' : 'red')}` : 'usuario eliminado'}</span>
              <span>Reportó: ${report.reporter ? `@${esc(report.reporter.username)}` : 'usuario eliminado'}</span>
              ${report.content.project ? `<a href="/proyecto/${encodeURIComponent(report.content.project.id)}" target="_blank" rel="noopener noreferrer">${esc(report.content.project.title)} ↗</a>` : ''}
              ${report.content.episode ? `<a href="/ver/${encodeURIComponent(report.content.episode.id)}" target="_blank" rel="noopener noreferrer">${esc(report.content.episode.title)} ↗</a>` : ''}
              ${report.details ? `<span>Detalle: ${esc(report.details)}</span>` : ''}
            </div>
            ${report.status === 'OPEN' ? `<footer class="row-actions">
              ${report.content.moderationStatus !== 'DELETED' ? `<button class="action-btn" data-content-action="${report.content.moderationStatus === 'HIDDEN' ? 'RESTORE' : 'HIDE'}" data-kind="${report.targetType === 'COMMENT' ? 'comments' : 'reviews'}" data-target="${esc(report.targetId)}">${report.content.moderationStatus === 'HIDDEN' ? 'Restaurar' : 'Ocultar'}</button><button class="action-btn danger" data-delete-content data-kind="${report.targetType === 'COMMENT' ? 'comments' : 'reviews'}" data-target="${esc(report.targetId)}">Eliminar</button>` : ''}
              ${report.author ? `<button class="action-btn danger" data-user-status="SUSPENDED" data-user="${esc(report.author.id)}">Suspender autor</button>` : ''}
              <button class="action-btn" data-report-status="RESOLVED">Resolver</button><button class="action-btn secondary" data-report-status="DISMISSED">Descartar</button>
            </footer>` : `<p class="muted">${esc(report.resolutionNote || 'Sin nota de resolución.')}</p>`}
          </article>`).join('') || '<div class="empty">No hay reportes en este estado.</div>'}</div>
      </section>
      <aside class="panel-card panel-card-first"><h2>Usuarios</h2><div class="moderation-users">${users.map(user => `<div><span><strong>@${esc(user.username)}</strong><small>${esc(user.displayName)} · ${user.comments} comentarios · ${user.reviews} reseñas</small></span>${badge(user.status, user.status === 'ACTIVE' ? 'green' : 'red')}<button class="action-btn ${user.status === 'ACTIVE' ? 'danger' : ''}" data-user-status="${user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}" data-user="${esc(user.id)}">${user.status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}</button></div>`).join('') || '<p class="muted">Sin usuarios.</p>'}</div></aside>
    </div>`;
  $('#reportStatus').value = state.moderationStatus;
  $('#reportStatus').onchange = event => { state.moderationStatus = event.target.value; navigate('moderation'); };
  $$('[data-report-status]').forEach(button => button.onclick = async () => {
    const note = prompt('Nota de resolución opcional', '') ?? '';
    try { await api(`/api/admin/moderation/reports/${button.closest('[data-report-id]').dataset.reportId}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.reportStatus, note }) }); flash('Reporte actualizado.'); await navigate('moderation'); } catch (error) { flash(error.message, 'error'); }
  });
  $$('[data-content-action]').forEach(button => button.onclick = async () => {
    try { await api(`/api/admin/moderation/${button.dataset.kind}/${button.dataset.target}`, { method: 'PATCH', body: JSON.stringify({ action: button.dataset.contentAction }) }); flash('Contenido actualizado.'); await navigate('moderation'); } catch (error) { flash(error.message, 'error'); }
  });
  $$('[data-delete-content]').forEach(button => button.onclick = async () => {
    if (!confirm('Esta eliminación es permanente. ¿Continuar?')) return;
    try { await api(`/api/admin/moderation/${button.dataset.kind}/${button.dataset.target}`, { method: 'DELETE' }); flash('Contenido eliminado.'); await navigate('moderation'); } catch (error) { flash(error.message, 'error'); }
  });
  $$('[data-user-status]').forEach(button => button.onclick = async () => {
    const verb = button.dataset.userStatus === 'SUSPENDED' ? 'suspender' : 'reactivar';
    if (!confirm(`¿${verb[0].toUpperCase() + verb.slice(1)} este usuario?`)) return;
    try { await api(`/api/admin/moderation/users/${button.dataset.user}`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.userStatus }) }); flash(`Usuario ${verb === 'suspender' ? 'suspendido; sus sesiones fueron invalidadas' : 'reactivado'}.`); await navigate('moderation'); } catch (error) { flash(error.message, 'error'); }
  });
}

function trash() {
  const groups = [
    ['projects', 'Proyectos', state.trash.projects || []],
    ['episodes', 'Episodios', state.trash.episodes || []],
    ['studios', 'Estudios', state.trash.studios || []]
  ];
  const total = groups.reduce((sum, group) => sum + group[2].length, 0);
  $('#content').innerHTML = `
    <div class="trash-intro panel-card panel-card-first">
      <div><h2>Papelera</h2><p>Restaurar conserva la publicación y las relaciones anteriores. Eliminar definitivamente no se puede deshacer.</p></div>
      ${badge(`${total} registro${total === 1 ? '' : 's'}`, total ? 'yellow' : 'green')}
    </div>
    ${groups.map(([kind, title, items]) => `
      <section class="trash-section">
        <h2>${title} <small>${items.length}</small></h2>
        <div class="trash-list">
          ${items.map(item => `
            <article class="trash-item">
              <div class="trash-record">
                ${item.image ? `<img src="${esc(item.image)}" alt="">` : '<span class="trash-icon">♲</span>'}
                <div><strong>${esc(item.name)}</strong>${item.parent_name ? `<span>${esc(item.parent_name)}</span>` : ''}<small>${esc(item.id)} · ${esc(dateLabel(item.deleted_at))}</small></div>
              </div>
              <div class="row-actions">
                <button class="action-btn restore-item" data-kind="${kind}" data-id="${esc(item.id)}" type="button">Restaurar</button>
                <button class="action-btn danger purge-item" data-kind="${kind}" data-id="${esc(item.id)}" data-name="${esc(item.name)}" type="button">Eliminar definitivamente</button>
              </div>
            </article>`).join('') || '<div class="empty compact-empty">Vacío</div>'}
        </div>
      </section>`).join('')}`;

  $$('.restore-item').forEach(button => button.onclick = () => restoreItem(button.dataset.kind, button.dataset.id));
  $$('.purge-item').forEach(button => button.onclick = () => purgeItem(button.dataset.kind, button.dataset.id, button.dataset.name));
}

async function moveToTrash(kind, id, message) {
  if (!confirm(message)) return;
  try {
    await api(`/api/admin/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    flash('Registro enviado a la papelera');
    await navigate(state.tab);
  } catch (error) {
    flash(error.message, 'error');
  }
}

async function restoreItem(kind, id) {
  try {
    await api('/api/admin/trash/restore', { method: 'POST', body: JSON.stringify({ kind, id }) });
    flash('Registro restaurado');
    await navigate('trash');
  } catch (error) {
    flash(error.message, 'error');
  }
}

async function purgeItem(kind, id, name) {
  const confirmation = prompt(`Vas a eliminar definitivamente “${name}”. Escribe ELIMINAR para continuar.`);
  if (confirmation !== 'ELIMINAR') return;
  try {
    await api(`/api/admin/trash/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    flash('Registro eliminado definitivamente');
    await navigate('trash');
  } catch (error) {
    flash(error.message, 'error');
  }
}

const idRenameDialog = $('#idRenameDialog');
const idRenameForm = $('#idRenameForm');
let idRenameTarget = null;
let idRenameBusy = false;

function openIdRename(target) {
  idRenameTarget = target;
  $('#idRenameKind').textContent = idKindLabel(target.kind);
  $('#idRenameName').textContent = target.name;
  $('#idRenameCurrent').textContent = target.currentId;
  $('#idRenameNew').value = target.recommendedId || '';
  $('#idRenameConfirm').value = '';
  $('#idRenameStatus').textContent = target.status === 'CONFLICT' ? target.detail : '';
  idRenameBusy = false;
  $('#confirmIdRename').disabled = false;
  $('#cancelIdRename').disabled = false;
  $('#closeIdRename').disabled = false;
  idRenameDialog.showModal();
  $('#idRenameNew').focus();
  $('#idRenameNew').select();
}

function closeIdRename() {
  if (idRenameBusy) return;
  if (idRenameDialog.open) idRenameDialog.close();
  idRenameTarget = null;
}

$('#closeIdRename').onclick = closeIdRename;
$('#cancelIdRename').onclick = closeIdRename;
idRenameDialog.addEventListener('cancel', event => { event.preventDefault(); closeIdRename(); });

idRenameForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!idRenameTarget) return;
  const newId = $('#idRenameNew').value;
  const confirmId = $('#idRenameConfirm').value;
  const status = $('#idRenameStatus');
  if (confirmId !== idRenameTarget.currentId) {
    status.textContent = 'La confirmación debe coincidir exactamente con el ID actual.';
    return;
  }
  if (newId === idRenameTarget.currentId) {
    status.textContent = 'El nuevo ID debe ser diferente del actual.';
    return;
  }
  if (!confirm(`¿Confirmas cambiar ${idRenameTarget.currentId} por ${newId}?\n\nEl ID anterior se conservará como alias.`)) return;
  const button = $('#confirmIdRename');
  const oldId = idRenameTarget.currentId;
  idRenameBusy = true;
  button.disabled = true;
  $('#cancelIdRename').disabled = true;
  $('#closeIdRename').disabled = true;
  status.textContent = 'Validando y actualizando todas las relaciones…';
  try {
    await api('/api/admin/ids/rename', {
      method: 'POST',
      body: JSON.stringify({ kind: idRenameTarget.kind, currentId: idRenameTarget.currentId, newId, confirmId })
    });
    idRenameBusy = false;
    closeIdRename();
    flash(`ID actualizado. ${oldId} quedó registrado como alias.`);
    await navigate(state.tab);
  } catch (error) {
    status.textContent = error.message;
    flash(error.message, 'error');
  } finally {
    idRenameBusy = false;
    button.disabled = false;
    $('#cancelIdRename').disabled = false;
    $('#closeIdRename').disabled = false;
  }
});

const dialog = $('#editorDialog');
const fields = $('#editorFields');
let editor = { kind: null, id: null, uploading: 0, pendingUrls: new Set() };

function field(name, label, value = '', type = 'text', full = false, options = []) {
  if (type === 'checkbox') return `<label class="field checkbox ${full ? 'full' : ''}"><input name="${name}" type="checkbox" ${value ? 'checked' : ''}><span>${label}</span></label>`;
  if (type === 'textarea') return `<label class="field ${full ? 'full' : ''}"><span>${label}</span><textarea name="${name}">${esc(value)}</textarea></label>`;
  if (type === 'select') return `<label class="field ${full ? 'full' : ''}"><span>${label}</span><select name="${name}">${options.map(option => `<option value="${esc(option.value ?? option)}" ${(option.value ?? option) === value ? 'selected' : ''}>${esc(option.label ?? option)}</option>`).join('')}</select></label>`;
  const min = type === 'number' ? ` min="${name === 'position' ? 0 : 1}" step="1"` : '';
  return `<label class="field ${full ? 'full' : ''}"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}"${min}></label>`;
}

function imageField(name, label, value = '', folder = 'dubverse', full = false) {
  const source = value || '/assets/dubverse-icon.png';
  return `
    <div class="field image-field ${full ? 'full' : ''}">
      <span>${label}</span>
      <div class="image-preview" data-preview="${name}">
        <img src="${esc(source)}" alt="Vista previa de ${esc(label)}">
        <div class="image-upload-progress"><i></i></div>
        <small data-image-status="${name}">${value ? 'Imagen actual' : 'Sin imagen nueva'}</small>
      </div>
      <div class="image-row">
        <input name="${name}" value="${esc(value)}" placeholder="/assets/... o URL">
        <label class="upload-file">Elegir imagen<input class="image-upload" data-target="${name}" data-folder="${folder}" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
      </div>
      <small>Puedes conservar la ruta actual, pegar una URL o subir una imagen de hasta 4 MB.</small>
    </div>`;
}

function studioChecks(selected = []) {
  const selectedIds = new Set(selected);
  return `<fieldset class="field full studio-selector"><legend>Estudios relacionados</legend><div>${state.studios.map(studio => `<label><input type="checkbox" name="studioIds" value="${esc(studio.id)}" ${selectedIds.has(studio.id) ? 'checked' : ''}><span>${esc(studio.name)}</span></label>`).join('') || '<small>Primero crea un estudio.</small>'}</div></fieldset>`;
}

function studioSocialFields(socials = {}) {
  const otherSocials = Object.fromEntries(Object.entries(socials).filter(([key]) => !STUDIO_SOCIAL_KEYS.includes(key)));
  return [
    field('socialWebsite', 'Sitio web oficial', socials.website || '', 'url'),
    field('socialFacebook', 'Facebook', socials.facebook || '', 'url'),
    field('socialYoutube', 'YouTube', socials.youtube || '', 'url'),
    field('socialInstagram', 'Instagram', socials.instagram || '', 'url'),
    field('socialTiktok', 'TikTok', socials.tiktok || '', 'url'),
    field('socialTwitter', 'X / Twitter', socials.twitter || socials.x || '', 'url'),
    field('socialDiscord', 'Discord', socials.discord || '', 'url'),
    field('socialTwitch', 'Twitch', socials.twitch || '', 'url'),
    field('socialsExtra', 'Otras redes (JSON: nombre y URL)', Object.keys(otherSocials).length ? JSON.stringify(otherSocials, null, 2) : '', 'textarea', true)
  ].join('');
}

function studioSocialsFromBody(body) {
  let socials = {};
  const extra = String(body.socialsExtra || '').trim();
  if (extra) {
    try {
      const parsed = JSON.parse(extra);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      socials = parsed;
    } catch {
      throw new Error('“Otras redes” debe contener un objeto JSON válido con nombre y URL.');
    }
  }
  const fields = {
    website: 'socialWebsite', facebook: 'socialFacebook', youtube: 'socialYoutube', instagram: 'socialInstagram',
    tiktok: 'socialTiktok', twitter: 'socialTwitter', discord: 'socialDiscord', twitch: 'socialTwitch'
  };
  for (const [key, formKey] of Object.entries(fields)) {
    const value = String(body[formKey] || '').trim();
    if (value) socials[key] = value;
    delete body[formKey];
  }
  delete body.socialsExtra;
  return socials;
}

function resetEditor(kind, id) {
  editor = { kind, id, uploading: 0, pendingUrls: new Set() };
  $('#editorStatus').textContent = '';
  $('#saveEditor').disabled = false;
}

function updateEditorBusy() {
  const busy = editor.uploading > 0;
  $('#saveEditor').disabled = busy;
  $('#cancelEditor').disabled = busy;
  $('#closeEditor').disabled = busy;
  $('#editorStatus').textContent = busy ? `Subiendo ${editor.uploading} imagen${editor.uploading === 1 ? '' : 'es'}… No cierres el editor.` : '';
}

function setImagePreview(name, source, status, uploading = false) {
  const preview = $(`[data-preview="${name}"]`, fields);
  if (!preview) return;
  $('img', preview).src = source || '/assets/dubverse-icon.png';
  preview.classList.toggle('uploading', uploading);
  const statusElement = $(`[data-image-status="${name}"]`, preview);
  if (statusElement) statusElement.textContent = status;
}

async function cleanupUrls(urls) {
  const list = [...new Set((urls || []).filter(Boolean))];
  if (!list.length) return;
  try {
    await api('/api/admin/blob/cleanup', { method: 'POST', body: JSON.stringify({ urls: list }) });
  } catch (error) {
    console.warn('No se pudieron limpiar imágenes temporales:', error.message);
  }
}

async function cleanupPendingUploads() {
  const urls = [...editor.pendingUrls];
  editor.pendingUrls.clear();
  await cleanupUrls(urls);
}

function bindImageUploads() {
  $$('.image-field', fields).forEach(wrapper => {
    const urlInput = $('input:not([type="file"])', wrapper);
    if (urlInput) urlInput.addEventListener('input', () => setImagePreview(urlInput.name, urlInput.value.trim(), urlInput.value.trim() ? 'Vista previa de la URL' : 'Sin imagen'));
  });

  $$('.image-upload', fields).forEach(input => {
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        input.value = '';
        return flash('Selecciona un archivo de imagen.', 'error');
      }
      if (file.size > 4_000_000) {
        input.value = '';
        return flash('La imagen supera 4 MB.', 'error');
      }

      const target = $(`[name="${input.dataset.target}"]`, fields);
      const previousValue = target.value.trim();
      const localUrl = URL.createObjectURL(file);
      editor.uploading += 1;
      input.disabled = true;
      updateEditorBusy();
      setImagePreview(input.dataset.target, localUrl, `Subiendo ${file.name}…`, true);

      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', input.dataset.folder);

      try {
        const result = await api('/api/admin/upload', { method: 'POST', body: formData });
        if (editor.pendingUrls.has(previousValue) && previousValue !== result.url) {
          editor.pendingUrls.delete(previousValue);
          cleanupUrls([previousValue]);
        }
        target.value = result.url;
        editor.pendingUrls.add(result.url);
        setImagePreview(input.dataset.target, result.url, 'Imagen subida y lista para guardar', false);
        flash('Imagen subida');
      } catch (error) {
        target.value = previousValue;
        setImagePreview(input.dataset.target, previousValue, `Error: ${error.message}`, false);
        flash(error.message, 'error');
      } finally {
        URL.revokeObjectURL(localUrl);
        input.disabled = false;
        input.value = '';
        editor.uploading -= 1;
        updateEditorBusy();
      }
    };
  });
}

function openProject(project = null) {
  resetEditor('projects', project?.id || null);
  $('#editorTitle').textContent = project ? 'Editar proyecto' : 'Nuevo proyecto';
  $('#editorKicker').textContent = 'Proyecto';
  fields.innerHTML =
    field('title', 'Título', project?.title || '') +
    field('type', 'Tipo', project?.type || 'SERIES', 'select', false, PROJECT_TYPE_OPTIONS) +
    field('alternateTitle', 'Título alternativo', project?.alternateTitle || project?.alternate_title || '') +
    field('adultContent', 'Contenido para mayores de 18 años', project?.ageRating === 'AGE_18', 'checkbox', true) +
    field('status', 'Estado', project?.status || 'ONGOING', 'select', false, PROJECT_STATUS_OPTIONS) +
    field('synopsis', 'Sinopsis', project?.synopsis || '', 'textarea', true) +
    field('projectDirector', 'Director/a del proyecto', project?.projectDirector || project?.project_director || '', 'text', true) +
    field('dubbingInfo', 'Información del fandoblaje', project?.dubbingInfo || project?.dubbing_info || '', 'textarea', true) +
    field('credits', 'Créditos / agradecimientos', project?.credits || '', 'textarea', true) +
    field('genres', 'Géneros separados por coma', (project?.genres || []).join(', '), 'text', true) +
    imageField('poster', 'Portada', project?.poster || '', 'posters') +
    imageField('banner', 'Banner', project?.banner || '', 'banners') +
    studioChecks((project?.studios || []).map(studio => studio.id)) +
    field('published', 'Publicado', project?.published || false, 'checkbox') +
    field('featured', 'Destacado', project?.featured || false, 'checkbox');
  dialog.showModal();
  bindImageUploads();
}

function openStudio(studio = null) {
  resetEditor('studios', studio?.id || null);
  $('#editorTitle').textContent = studio ? 'Editar estudio' : 'Nuevo estudio';
  $('#editorKicker').textContent = 'Estudio';
  fields.innerHTML =
    field('name', 'Nombre', studio?.name || '') +
    field('director', 'Dirección / administración', studio?.director || '') +
    field('description', 'Descripción', studio?.description || '', 'textarea', true) +
    imageField('logo', 'Logo', studio?.logo || '', 'studios', true) +
    imageField('banner', 'Banner', studio?.banner || '', 'studio-banners', true) +
    studioSocialFields(studio?.socials || {}) +
    field('isVerified', 'Estudio verificado (sólo Admin global)', studio?.isVerified || false, 'checkbox', true) +
    field('published', 'Publicado', studio?.published ?? true, 'checkbox');
  dialog.showModal();
  bindImageUploads();
}

function openEpisode(episode = null) {
  resetEditor('episodes', episode?.id || null);
  $('#editorTitle').textContent = episode ? 'Editar episodio' : 'Nuevo episodio';
  $('#editorKicker').textContent = 'Episodio';
  const availableProjects = episode ? state.projects : state.projects.filter(project => project.status === 'ONGOING');
  const projectOptions = availableProjects.map(project => ({ value: project.id, label: project.title }));
  fields.innerHTML =
    field('projectId', 'Proyecto', episode?.project_id || projectOptions[0]?.value, 'select', false, projectOptions) +
    field('provider', 'Proveedor', episode?.provider || 'ARCHIVE', 'select', false, ['ARCHIVE', 'DIRECT', 'HLS', 'PIXELDRAIN', 'EXTERNAL', 'LOCAL']) +
    field('season', 'Temporada', episode?.season || 1, 'number') +
    field('number', 'Número', episode?.number || 1, 'number') +
    field('title', 'Título', episode?.title || '', 'text', true) +
    field('description', 'Descripción', episode?.description || '', 'textarea', true) +
    field('archiveIdentifier', 'Identificador Archive.org', episode?.archive_identifier || '') +
    field('archiveFile', 'Archivo dentro del item', episode?.archive_file || '') +
    field('videoUrl', 'URL de reproducción', episode?.video_url || '', 'text', true) +
    field('status', 'Estado', episode?.status || 'DRAFT', 'select', false, EPISODE_STATUS_OPTIONS) +
    field('published', 'Publicado', episode?.published || false, 'checkbox');
  dialog.showModal();
  if (!episode && !projectOptions.length) {
    $('#editorStatus').textContent = 'No hay proyectos en emisión disponibles para crear un episodio.';
    $('#saveEditor').disabled = true;
  }
}

function curatedProjectChecks(section) {
  const selected = new Set((state.home?.curated || []).filter(item => item.sectionId === section?.id).map(item => item.projectId));
  return `<fieldset class="field full studio-selector home-project-selector"><legend>Proyectos de esta selección</legend><div>${state.projects.filter(project => project.published).map(project => `<label><input type="checkbox" name="projectIds" value="${esc(project.id)}" ${selected.has(project.id) ? 'checked' : ''}><span>${esc(project.title)}</span></label>`).join('') || '<small>No hay proyectos publicados.</small>'}</div></fieldset>`;
}

function openHomeSection(section = null) {
  resetEditor('home-sections', section?.id || null);
  editor.homeSection = section;
  const type = section?.sectionType || 'RECENT';
  const system = Boolean(section?.isDefault);
  const typeOptions = system ? [{ value: type, label: sectionTypeLabel(type) }] : HOME_SECTION_TYPE_OPTIONS;
  $('#editorTitle').textContent = section ? 'Editar sección' : 'Nueva sección';
  $('#editorKicker').textContent = 'Portada · Sección';
  fields.innerHTML =
    field('sectionKey', 'Clave interna', section?.sectionKey || '', 'text') +
    field('sectionType', 'Modo', type, 'select', false, typeOptions) +
    field('title', 'Título visible', section?.title || '') +
    field('subtitle', 'Subtítulo opcional', section?.subtitle || '', 'text') +
    field('position', 'Posición', section?.position ?? 70, 'number') +
    field('maxItems', 'Cantidad máxima', section?.maxItems || 8, 'number') +
    field('filterStatus', 'Estado para modo automático', section?.configuration?.status || 'ONGOING', 'select', false, HOME_STATUS_OPTIONS) +
    field('filterType', 'Tipo para modo automático', section?.configuration?.type || 'SERIES', 'select', false, PROJECT_TYPE_OPTIONS) +
    field('autoFill', 'Completar espacios automáticamente', section?.configuration?.autoFill !== false, 'checkbox', true) +
    field('enabled', 'Sección activa', section?.enabled !== false, 'checkbox', true) +
    curatedProjectChecks(section);
  dialog.showModal();
}

function localDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function openHomeBanner(banner = null) {
  resetEditor('home-banners', banner?.id || null);
  $('#editorTitle').textContent = banner ? 'Editar banner' : 'Nuevo banner';
  $('#editorKicker').textContent = 'Portada · Novedad';
  fields.innerHTML =
    field('label', 'Etiqueta', banner?.label || 'NOVEDAD') +
    field('title', 'Título', banner?.title || '') +
    field('description', 'Descripción', banner?.description || '', 'textarea', true) +
    imageField('imageUrl', 'Imagen horizontal opcional', banner?.imageUrl || '', 'home-banners', true) +
    imageField('mobileImageUrl', 'Imagen móvil opcional', banner?.mobileImageUrl || '', 'home-banners-mobile', true) +
    field('linkUrl', 'Enlace interno o HTTPS', banner?.linkUrl || '', 'text', true) +
    field('buttonText', 'Texto del botón', banner?.buttonText || '') +
    field('position', 'Posición en portada', banner?.position ?? 25, 'number') +
    field('startsAt', 'Mostrar desde (opcional)', localDateTime(banner?.startsAt), 'datetime-local') +
    field('endsAt', 'Mostrar hasta (opcional)', localDateTime(banner?.endsAt), 'datetime-local') +
    field('enabled', 'Banner activo', banner?.enabled !== false, 'checkbox', true);
  dialog.showModal();
  bindImageUploads();
}

async function closeEditor() {
  if (editor.uploading) return flash('Espera a que termine la subida.', 'error');
  dialog.close();
  await cleanupPendingUploads();
}

$('#closeEditor').onclick = closeEditor;
$('#cancelEditor').onclick = closeEditor;
dialog.addEventListener('cancel', event => {
  event.preventDefault();
  closeEditor();
});

$('#editorForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (editor.uploading) return flash('Espera a que termine la imagen.', 'error');

  const formData = new FormData(event.currentTarget);
  const body = {};
  for (const [key, value] of formData) if (!['studioIds', 'projectIds'].includes(key)) body[key] = value;
  $$('input[type="checkbox"]', fields).filter(input => !['studioIds', 'projectIds'].includes(input.name)).forEach(input => body[input.name] = input.checked);
  if (editor.kind === 'projects') body.studioIds = $$('input[name="studioIds"]:checked', fields).map(input => input.value);
  if (editor.kind === 'projects') {
    body.ageRating = body.adultContent ? 'AGE_18' : 'GENERAL';
    delete body.adultContent;
  }
  if (body.genres) body.genres = body.genres.split(',').map(item => item.trim()).filter(Boolean);
  ['season', 'number'].forEach(key => { if (key in body) body[key] = Number(body[key]); });

  if (editor.kind === 'home-sections') {
    body.position = Number(body.position);
    body.maxItems = Number(body.maxItems);
    body.configuration = {};
    if (body.sectionType === 'AUTO_STATUS') body.configuration.status = body.filterStatus;
    if (body.sectionType === 'AUTO_TYPE') body.configuration.type = body.filterType;
    if (['FEATURED_PROJECTS', 'FEATURED_STUDIOS'].includes(body.sectionType)) body.configuration.autoFill = body.autoFill;
    body.projectIds = $$('input[name="projectIds"]:checked', fields).map(input => input.value);
    delete body.filterStatus;
    delete body.filterType;
    delete body.autoFill;
  }
  if (editor.kind === 'home-banners') body.position = Number(body.position);

  if (editor.kind === 'studios') {
    try {
      body.socials = studioSocialsFromBody(body);
    } catch (error) {
      $('#editorStatus').textContent = error.message;
      return flash(error.message, 'error');
    }
  }

  const saveButton = $('#saveEditor');
  saveButton.disabled = true;
  saveButton.textContent = 'Guardando…';
  $('#editorStatus').textContent = 'Guardando cambios…';

  try {
    if (editor.kind === 'home-sections' && !editor.id) {
      await api('/api/admin/home/sections', { method: 'POST', body: JSON.stringify(body) });
    } else if (editor.kind === 'home-sections') {
      await api(`/api/admin/home/sections/${encodeURIComponent(editor.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else if (editor.kind === 'home-banners' && !editor.id) {
      await api('/api/admin/home/banners', { method: 'POST', body: JSON.stringify(body) });
    } else if (editor.kind === 'home-banners') {
      await api(`/api/admin/home/banners/${encodeURIComponent(editor.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else if (editor.id) {
      await api(`/api/admin/${editor.kind}/${encodeURIComponent(editor.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await api(`/api/admin/${editor.kind}`, { method: 'POST', body: JSON.stringify(body) });
    }

    const usedUrls = new Set(Object.values(body).filter(value => typeof value === 'string'));
    const unusedUploads = [...editor.pendingUrls].filter(url => !usedUrls.has(url));
    editor.pendingUrls.clear();
    await cleanupUrls(unusedUploads);
    dialog.close();
    flash('Cambios guardados');
    await navigate(state.tab);
  } catch (error) {
    $$('[aria-invalid="true"]', fields).forEach(input => input.removeAttribute('aria-invalid'));
    const input = error.field ? $(`[name="${error.field === 'ageRating' ? 'adultContent' : error.field}"]`, fields) : null;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
    flash(error.message, 'error');
    $('#editorStatus').textContent = error.message;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Guardar';
  }
});

checkSession();
