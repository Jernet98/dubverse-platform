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
  moderation: { reports: { items: [] }, users: [] },
  moderationStatus: 'OPEN',
  trash: { projects: [], studios: [], episodes: [] }
};

const titles = {
  dashboard: 'Resumen',
  projects: 'Proyectos',
  episodes: 'Episodios',
  studios: 'Estudios',
  upload: 'Subir a Archive',
  moderation: 'Moderación',
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

let flashTimer = null;

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const headers = isForm
    ? { ...(options.headers || {}) }
    : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
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

async function refresh(includeTrash = false, includeModeration = false) {
  const requests = [
    api('/api/admin/projects'),
    api('/api/admin/episodes'),
    api('/api/admin/studios'),
    api('/api/admin/overview'),
    api('/api/admin/config')
  ];
  if (includeTrash) requests.push(api('/api/admin/trash'));
  if (includeModeration) requests.push(api(`/api/admin/moderation/list?status=${encodeURIComponent(state.moderationStatus)}`));
  const result = await Promise.all(requests);
  [state.projects, state.episodes, state.studios, state.overview, state.config] = result;
  if (includeTrash) state.trash = result[5];
  if (includeModeration) state.moderation = result[5];
}

async function navigate(tab) {
  state.tab = tab;
  $$('.sidebar nav button').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  $('#tabTitle').textContent = titles[tab] || titles.dashboard;
  $('#content').innerHTML = '<div class="loading">Cargando…</div>';
  try {
    await refresh(tab === 'trash', tab === 'moderation');
    ({ dashboard, projects, episodes, studios, upload, moderation, trash }[tab] || dashboard)();
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
        <td><div class="row-actions"><button class="action-btn edit-project" data-id="${esc(project.id)}">Editar</button><button class="action-btn danger trash-project" data-id="${esc(project.id)}">Papelera</button></div></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">Sin resultados</td></tr>';
    bindProjectRows();
  };

  $('#tableSearch').addEventListener('input', draw);
  $('#newProject').onclick = () => openProject();
  draw();
}

function bindProjectRows() {
  $$('.edit-project').forEach(button => button.onclick = () => openProject(state.projects.find(project => project.id === button.dataset.id)));
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
    </table></div>`;

  const draw = () => {
    const query = $('#tableSearch').value.toLowerCase();
    const rows = state.studios.filter(studio => studio.name.toLowerCase().includes(query));
    $('#studioRows').innerHTML = rows.map(studio => `
      <tr>
        <td><div class="record-cell"><img class="logo-thumb" src="${esc(studio.logo || '/assets/dubverse-icon.png')}" alt=""><div><div class="record-title">${esc(studio.name)}</div><div class="record-sub">${esc(studio.id)}</div></div></div></td>
        <td>${esc(studio.director || '—')}</td><td>${studio.projects.length}</td>
        <td>${studio.published ? badge('Publicado', 'green') : badge('Oculto', 'red')}</td>
        <td><div class="row-actions"><button class="action-btn edit-studio" data-id="${esc(studio.id)}">Editar</button><button class="action-btn danger trash-studio" data-id="${esc(studio.id)}">Papelera</button></div></td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">Sin resultados</td></tr>';
    bindStudioRows();
  };

  $('#tableSearch').addEventListener('input', draw);
  $('#newStudio').onclick = () => openStudio();
  draw();
}

function bindStudioRows() {
  $$('.edit-studio').forEach(button => button.onclick = () => openStudio(state.studios.find(studio => studio.id === button.dataset.id)));
  $$('.trash-studio').forEach(button => button.onclick = () => moveToTrash('studios', button.dataset.id, 'El estudio se ocultará sin perder sus relaciones con los proyectos.'));
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

const dialog = $('#editorDialog');
const fields = $('#editorFields');
let editor = { kind: null, id: null, uploading: 0, pendingUrls: new Set() };

function field(name, label, value = '', type = 'text', full = false, options = []) {
  if (type === 'checkbox') return `<label class="field checkbox ${full ? 'full' : ''}"><input name="${name}" type="checkbox" ${value ? 'checked' : ''}><span>${label}</span></label>`;
  if (type === 'textarea') return `<label class="field ${full ? 'full' : ''}"><span>${label}</span><textarea name="${name}">${esc(value)}</textarea></label>`;
  if (type === 'select') return `<label class="field ${full ? 'full' : ''}"><span>${label}</span><select name="${name}">${options.map(option => `<option value="${esc(option.value ?? option)}" ${(option.value ?? option) === value ? 'selected' : ''}>${esc(option.label ?? option)}</option>`).join('')}</select></label>`;
  const min = type === 'number' ? ' min="1" step="1"' : '';
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
        setImagePreview(input.dataset.target, previousValue, 'La subida falló', false);
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
    field('status', 'Estado', project?.status || 'ONGOING', 'select', false, ['ONGOING', 'FINISHED', 'PAUSED', 'CANCELLED']) +
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
    studioSocialFields(studio?.socials || {}) +
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
    field('provider', 'Proveedor', episode?.provider || 'ARCHIVE', 'select', false, ['ARCHIVE', 'PIXELDRAIN', 'EXTERNAL', 'LOCAL']) +
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
  for (const [key, value] of formData) if (key !== 'studioIds') body[key] = value;
  $$('input[type="checkbox"]', fields).filter(input => input.name !== 'studioIds').forEach(input => body[input.name] = input.checked);
  if (editor.kind === 'projects') body.studioIds = $$('input[name="studioIds"]:checked', fields).map(input => input.value);
  if (body.genres) body.genres = body.genres.split(',').map(item => item.trim()).filter(Boolean);
  ['season', 'number'].forEach(key => { if (key in body) body[key] = Number(body[key]); });

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
    if (editor.id) {
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
    flash(error.message, 'error');
    $('#editorStatus').textContent = error.message;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Guardar';
  }
});

checkSession();
