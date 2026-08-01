const app = document.querySelector('#app');
const state = { projects: [], studios: [], settings: {}, loaded: false };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const typeLabel = type => ({ SERIES: 'Serie', MOVIE: 'Película', OVA: 'OVA', SPECIAL: 'Especial' }[type] || type);
const statusLabel = status => ({ ONGOING: 'En emisión', FINISHED: 'Finalizado', PAUSED: 'Pausado', CANCELLED: 'Cancelado' }[status] || status);
const imageOrFallback = value => value || '/assets/dubverse-icon.png';

async function api(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Error ${response.status}`);
  }
  return response.json();
}

async function loadBase() {
  if (state.loaded) return;
  [state.projects, state.studios, state.settings] = await Promise.all([
    api('/api/projects'),
    api('/api/studios'),
    api('/api/settings')
  ]);
  state.loaded = true;
}

function projectCard(project) {
  const node = document.createElement('article');
  node.className = 'project-card';
  node.innerHTML = `
    <a class="project-card-link" href="#/proyecto/${encodeURIComponent(project.id)}">
      <div class="poster-wrap">
        <img class="poster" loading="lazy" src="${esc(imageOrFallback(project.poster))}" alt="${esc(project.title)}" />
        <span class="project-type">${esc(typeLabel(project.type))}</span>
        <span class="play-pill" aria-hidden="true">▶</span>
      </div>
      <div class="project-card-copy">
        <h3>${esc(project.title)}</h3>
        <p>${project.episodeCount} ${project.episodeCount === 1 ? 'episodio' : 'episodios'} · ${esc(statusLabel(project.status))}</p>
      </div>
    </a>
  `;
  return node;
}

function renderCards(projects, target) {
  target.innerHTML = '';
  projects.forEach(project => target.append(projectCard(project)));
  if (!projects.length) target.innerHTML = '<div class="empty">No encontré proyectos con esos filtros.</div>';
}

function home() {
  const featured = state.projects.filter(project => project.featured);
  const source = featured.length ? featured : state.projects;
  const hero = source[Math.floor(Math.random() * Math.max(source.length, 1))];

  if (!hero) {
    app.innerHTML = '<div class="empty empty-page"><h2>Dubverse está listo</h2><p>Todavía no hay proyectos publicados.</p></div>';
    return;
  }

  app.innerHTML = `
    <section class="hero">
      <div class="hero-bg" style="background-image:url('${esc(imageOrFallback(hero.banner || hero.poster))}')"></div>
      <div class="hero-content">
        <span class="eyebrow">● Proyecto destacado</span>
        <h1>${esc(hero.title)}</h1>
        <p>${esc(hero.synopsis)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/proyecto/${encodeURIComponent(hero.id)}">▶ Ver proyecto</a>
          <a class="btn btn-secondary" href="#/catalogo">Explorar catálogo</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-heading">
        <div><h2>Proyectos destacados</h2><p>Series, películas y OVA dobladas por la comunidad.</p></div>
        <a href="#/catalogo">Ver todo →</a>
      </div>
      <div class="project-grid" id="featuredGrid"></div>
    </section>

    <section class="section">
      <div class="section-heading">
        <div><h2>Estudios de fandoblaje</h2><p>Cada proyecto conserva sus créditos y responsables.</p></div>
        <a href="#/estudios">Conocer estudios →</a>
      </div>
      <div class="studio-strip">
        ${state.studios.slice(0, 5).map(studio => `
          <a class="studio-mini" href="#/estudios">
            <img src="${esc(imageOrFallback(studio.logo))}" alt="Logo de ${esc(studio.name)}" />
            <div><strong>${esc(studio.name)}</strong><span>${studio.projects?.length || 0} proyectos</span></div>
          </a>
        `).join('')}
      </div>
    </section>
  `;

  renderCards(source.slice(0, 6), $('#featuredGrid'));
}

function catalog() {
  const genres = [...new Set(state.projects.flatMap(project => project.genres || []))].sort((a, b) => a.localeCompare(b, 'es'));
  app.innerHTML = `
    <header class="page-header">
      <span class="eyebrow">Catálogo completo</span>
      <h1>Todo Dubverse, sin carpetas infinitas.</h1>
      <p>${state.projects.length} proyectos migrados y organizados automáticamente.</p>
      <div class="catalog-tools">
        <input id="catalogSearch" type="search" placeholder="Buscar por título o sinopsis" />
        <select id="typeFilter"><option value="">Todos los tipos</option><option value="SERIES">Series</option><option value="MOVIE">Películas</option><option value="OVA">OVA</option><option value="SPECIAL">Especiales</option></select>
        <select id="genreFilter"><option value="">Todos los géneros</option>${genres.map(genre => `<option>${esc(genre)}</option>`).join('')}</select>
      </div>
    </header>
    <section class="section section-tight"><div class="project-grid" id="catalogGrid"></div></section>
  `;

  const draw = () => {
    let list = [...state.projects];
    const query = $('#catalogSearch').value.trim().toLowerCase();
    const type = $('#typeFilter').value;
    const genre = $('#genreFilter').value.toLowerCase();
    if (query) list = list.filter(project => `${project.title} ${project.synopsis}`.toLowerCase().includes(query));
    if (type) list = list.filter(project => project.type === type);
    if (genre) list = list.filter(project => (project.genres || []).some(item => item.toLowerCase() === genre));
    renderCards(list, $('#catalogGrid'));
  };

  ['catalogSearch', 'typeFilter', 'genreFilter'].forEach(id => $(`#${id}`).addEventListener('input', draw));
  draw();
}

async function projectPage(id) {
  const project = await api(`/api/projects/${encodeURIComponent(id)}`);
  app.innerHTML = `
    <section class="project-hero">
      <div class="project-hero-bg" style="background-image:url('${esc(imageOrFallback(project.banner || project.poster))}')"></div>
      <div class="project-summary">
        <img class="poster-large" src="${esc(imageOrFallback(project.poster))}" alt="Portada de ${esc(project.title)}" />

        <div class="project-heading">
          <div class="meta-row">
            <span class="chip">${esc(typeLabel(project.type))}</span>
            <span class="chip status-dot">${esc(statusLabel(project.status))}</span>
            <span class="chip">${project.episodeCount} ${project.episodeCount === 1 ? 'episodio' : 'episodios'}</span>
          </div>
          <h1>${esc(project.title)}</h1>
          <div class="tag-row">${project.genres.map(genre => `<span class="chip">${esc(genre)}</span>`).join('')}</div>
        </div>

        <div class="project-details">
          <p class="synopsis">${esc(project.synopsis)}</p>
          <div class="actions">
            ${project.episodes.length ? `<a class="btn btn-primary" href="#/ver/${encodeURIComponent(project.episodes[0].id)}">▶ Reproducir desde el inicio</a>` : '<span class="chip">Sin episodios publicados</span>'}
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-heading"><div><h2>Episodios</h2><p>Servidor principal: Archive.org. Reproductor limpio y sin anuncios propios.</p></div></div>
      <div class="episode-list">
        ${project.episodes.map(episode => `
          <a class="episode-row" href="#/ver/${encodeURIComponent(episode.id)}">
            <span class="episode-number">${String(episode.number).padStart(2, '0')}</span>
            <div><h3>${esc(episode.title)}</h3><p>${esc(episode.description)}</p></div>
            <span class="episode-play" aria-hidden="true">▶</span>
          </a>
        `).join('') || '<div class="empty">Todavía no hay episodios publicados.</div>'}
      </div>
    </section>

    ${project.studios.length ? `
      <section class="section">
        <div class="section-heading"><div><h2>Créditos del fandoblaje</h2></div></div>
        <div class="studio-strip">
          ${project.studios.map(studio => `
            <a class="studio-mini" href="#/estudios">
              <img src="${esc(imageOrFallback(studio.logo))}" alt="Logo de ${esc(studio.name)}" />
              <div><strong>${esc(studio.name)}</strong><span>${esc(studio.role || 'Fandoblaje')}</span></div>
            </a>
          `).join('')}
        </div>
      </section>
    ` : ''}
  `;
}

async function watch(id) {
  const episode = await api(`/api/episodes/${encodeURIComponent(id)}`);
  const player = episode.provider === 'ARCHIVE'
    ? `<iframe src="${esc(episode.video_url)}" title="${esc(episode.title)}" allow="fullscreen; autoplay" allowfullscreen loading="eager"></iframe>`
    : `<video controls playsinline preload="metadata" src="${esc(episode.video_url)}"></video>`;

  app.innerHTML = `
    <section class="watch-page">
      <a class="watch-back" href="#/proyecto/${encodeURIComponent(episode.project_id)}">← Volver a ${esc(episode.project?.title || 'proyecto')}</a>
      <div class="watch-title"><h1>${esc(episode.title)}</h1><p>Temporada ${episode.season} · Episodio ${episode.number} · ${esc(episode.provider)}</p></div>
      <div class="player-shell">${player}</div>
      <div class="player-note">Dubverse no inserta anuncios. El archivo se reproduce desde el proveedor indicado y conserva los créditos del proyecto.</div>
      <div class="actions"><a class="btn btn-secondary" href="#/proyecto/${encodeURIComponent(episode.project_id)}">Lista de episodios</a></div>
    </section>
  `;
}

function studios() {
  app.innerHTML = `
    <header class="page-header"><span class="eyebrow">Comunidad</span><h1>Estudios y equipos</h1><p>Los proyectos ya no están aislados: cada estudio aparece vinculado con todo su trabajo.</p></header>
    <section class="section section-tight">
      <div class="studio-grid">
        ${state.studios.map(studio => `
          <article class="studio-card">
            <div class="studio-card-head">
              <img src="${esc(imageOrFallback(studio.logo))}" alt="Logo de ${esc(studio.name)}" />
              <div><h2>${esc(studio.name)}</h2><span class="director">${esc(studio.director || 'Dirección no indicada')}</span></div>
            </div>
            <p>${esc(studio.description || 'Sin descripción disponible.')}</p>
            <div class="studio-projects">${(studio.projects || []).map(project => `<a href="#/proyecto/${encodeURIComponent(project.id)}">${esc(project.title)}</a>`).join('') || '<span class="chip">Sin proyectos ligados</span>'}</div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function about() {
  app.innerHTML = `
    <header class="page-header"><span class="eyebrow">Sobre Dubverse</span><h1>Una plataforma comunitaria, no un negocio.</h1></header>
    <section class="section section-tight"><div class="about-panel">
      <p><strong>Dubverse organiza y presenta proyectos de fandoblaje realizados por sus respectivos equipos.</strong> La plataforma no incluye publicidad propia ni busca monetizar el material.</p>
      <p>Los créditos, responsables y enlaces de cada proyecto se conservan en su ficha. El contenido audiovisual se aloja en proveedores externos, principalmente Archive.org.</p>
      <p>Los titulares de derechos pueden solicitar la revisión o retiro de material mediante los canales de contacto del proyecto. El panel permite ocultar o retirar un episodio sin destruir el resto del catálogo.</p>
      <p>La versión anterior estaba formada por numerosos HTML y carpetas. Esta versión genera todo desde una sola base de datos, por lo que crear un proyecto o episodio ya no requiere editar código.</p>
    </div></section>
  `;
}

async function router() {
  try {
    await loadBase();
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    $$('#mainNav a').forEach(link => link.classList.toggle('active', link.getAttribute('href') === location.hash));
    window.scrollTo(0, 0);
    if (!parts.length) return home();
    if (parts[0] === 'catalogo') return catalog();
    if (parts[0] === 'estudios') return studios();
    if (parts[0] === 'acerca') return about();
    if (parts[0] === 'proyecto' && parts[1]) return projectPage(parts[1]);
    if (parts[0] === 'ver' && parts[1]) return watch(parts[1]);
    return home();
  } catch (error) {
    app.innerHTML = `<div class="error-box"><h2>No pude cargar Dubverse</h2><p>${esc(error.message)}</p><button class="btn btn-primary" type="button" onclick="location.reload()">Reintentar</button></div>`;
  }
}

const dialog = $('#searchDialog');
const input = $('#globalSearch');
const results = $('#searchResults');
const menuButton = $('#menuButton');
const mainNav = $('#mainNav');

$('#searchTrigger').addEventListener('click', () => {
  dialog.showModal();
  input.value = '';
  input.focus();
  results.innerHTML = '<p class="empty">Escribe para buscar.</p>';
});

input.addEventListener('input', () => {
  const query = input.value.trim().toLowerCase();
  if (!query) {
    results.innerHTML = '<p class="empty">Escribe para buscar.</p>';
    return;
  }
  const projects = state.projects.filter(project => project.title.toLowerCase().includes(query)).slice(0, 8);
  const studiosFound = state.studios.filter(studio => studio.name.toLowerCase().includes(query)).slice(0, 4);
  results.innerHTML = [
    ...projects.map(project => `<a class="search-item" href="#/proyecto/${encodeURIComponent(project.id)}" data-close-search><img src="${esc(imageOrFallback(project.poster))}" alt=""><div><strong>${esc(project.title)}</strong><small>${esc(typeLabel(project.type))} · ${project.episodeCount} episodios</small></div></a>`),
    ...studiosFound.map(studio => `<a class="search-item" href="#/estudios" data-close-search><img src="${esc(imageOrFallback(studio.logo))}" alt=""><div><strong>${esc(studio.name)}</strong><small>Estudio de fandoblaje</small></div></a>`)
  ].join('') || '<p class="empty">Sin resultados.</p>';
  $$('[data-close-search]', results).forEach(link => link.addEventListener('click', () => dialog.close()));
});

menuButton.addEventListener('click', () => {
  const open = mainNav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.textContent = open ? '×' : '☰';
});

window.addEventListener('hashchange', () => {
  mainNav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.textContent = '☰';
  router();
});

router();
