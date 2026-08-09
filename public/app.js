const app = document.querySelector('#app');
const state = {
  projects: [], studios: [], settings: {}, loaded: false,
  social: { config: { authAvailable: false, providers: [], mediaAvailable: false }, viewer: null, loaded: false }
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[char]));
const typeLabel = type => ({ SERIES: 'Serie', MOVIE: 'Película', OVA: 'OVA', SPECIAL: 'Especial', MANGA_COMIC_DUB: 'Manga / Comic Dub' }[type] || type);
const statusLabel = status => ({ ONGOING: 'En emisión', FINISHED: 'Finalizado', PAUSED: 'Pausado', CANCELLED: 'Cancelado' }[status] || status);
const imageOrFallback = value => value || '/assets/dubverse-icon.png';
const PUBLIC_PATH = /^\/(?:catalogo|estudios|acerca|perfil|(?:estudio|proyecto|ver|u)\/[^/]+)?\/?$/;
const normalizeText = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const dateLabel = value => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value)) : '';
const socialLabel = key => ({
  website: 'Sitio web', facebook: 'Facebook', youtube: 'YouTube', instagram: 'Instagram',
  tiktok: 'TikTok', x: 'X / Twitter', twitter: 'X / Twitter', discord: 'Discord', twitch: 'Twitch'
}[key] || key.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()));

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function socialLinks(socials = {}) {
  const links = Object.entries(socials)
    .map(([key, value]) => ({ key, url: safeExternalUrl(value) }))
    .filter(item => item.url);
  if (!links.length) return '';
  return `<div class="social-links">${links.map(item => `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(socialLabel(item.key))} ↗</a>`).join('')}</div>`;
}

function dubbingPanel(project) {
  const studios = project.studios || [];
  const director = project.projectDirector || project.project_director || '';
  const info = project.dubbingInfo || project.dubbing_info || '';
  const credits = project.credits || '';
  if (!studios.length && !director && !info && !credits) return '';
  return `
    <article class="dubbing-panel">
      <span class="eyebrow">Información sobre el doblaje</span>
      <div class="dubbing-grid">
        ${studios.length ? `<div class="dubbing-block dubbing-studios"><h3>Estudio${studios.length === 1 ? '' : 's'}</h3><div>${studios.map(studio => `
          <a href="/estudio/${encodeURIComponent(studio.id)}">
            <img src="${esc(imageOrFallback(studio.logo))}" alt="Logo de ${esc(studio.name)}">
            <span><strong>${esc(studio.name)}</strong><small>${esc(studio.role || 'Fandoblaje')}</small></span>
          </a>`).join('')}</div></div>` : ''}
        ${director ? `<div class="dubbing-block"><h3>Dirección del proyecto</h3><p>${esc(director)}</p></div>` : ''}
        ${info ? `<div class="dubbing-block dubbing-copy"><h3>Información del fandoblaje</h3><p>${esc(info)}</p></div>` : ''}
        ${credits ? `<div class="dubbing-block dubbing-copy"><h3>Créditos y agradecimientos</h3><p>${esc(credits)}</p></div>` : ''}
      </div>
    </article>`;
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Error ${response.status}`);
  }
  return response.json();
}

async function socialApi(path, options = {}) {
  return api(`/api/social${path}`, options);
}

async function optionalSocial(path) {
  try { return await socialApi(path); } catch { return null; }
}

async function loadSocial() {
  if (state.social.loaded) return;
  const config = await optionalSocial('/config');
  if (config) state.social.config = config;
  const session = await optionalSocial('/session');
  state.social.viewer = session?.user || null;
  state.social.loaded = true;
  renderAccount();
}

async function loadBase() {
  if (state.loaded) return;
  [state.projects, state.studios, state.settings] = await Promise.all([
    api('/api/projects'),
    api('/api/studios'),
    api('/api/settings')
  ]);
  state.loaded = true;
  await loadSocial();
}

function avatarImage(profile) {
  const value = String(profile?.avatar || '');
  if (value.startsWith('/')) return esc(value);
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol)) return esc(url.toString());
  } catch {}
  return esc(imageOrFallback(''));
}

function openLogin() {
  const loginDialog = $('#loginDialog');
  const providers = state.social.config.providers || [];
  $('#loginProviders').innerHTML = providers.length
    ? providers.map(provider => `<button type="button" data-provider="${esc(provider)}">Continuar con ${provider === 'google' ? 'Google' : 'Discord'}</button>`).join('')
    : '<div class="empty compact-empty">El inicio de sesión no está configurado en este entorno.</div>';
  $('#loginStatus').textContent = '';
  $$('[data-provider]', $('#loginProviders')).forEach(button => button.onclick = async () => {
    button.disabled = true;
    $('#loginStatus').textContent = 'Abriendo el proveedor…';
    try {
      const result = await api('/api/auth/sign-in/social', {
        method: 'POST', body: JSON.stringify({ provider: button.dataset.provider, callbackURL: location.href, disableRedirect: true })
      });
      if (!result.url) throw new Error('El proveedor no devolvió una URL válida.');
      location.assign(result.url);
    } catch (error) {
      button.disabled = false;
      $('#loginStatus').textContent = error.message;
    }
  });
  loginDialog.showModal();
}

function renderAccount() {
  const trigger = $('#accountTrigger');
  const menu = $('#accountMenu');
  const viewer = state.social.viewer;
  if (!viewer) {
    trigger.className = 'account-trigger';
    trigger.innerHTML = 'Iniciar sesión';
    menu.classList.add('hidden');
    menu.innerHTML = '';
    return;
  }
  trigger.className = 'account-trigger account-user';
  trigger.innerHTML = `<img src="${avatarImage(viewer)}" alt=""><span>@${esc(viewer.username)}</span>`;
  menu.innerHTML = `
    <a href="/perfil">Mi perfil</a>
    <a href="/perfil?tab=favoritos">Favoritos</a>
    <a href="/perfil?tab=ver-despues">Ver después</a>
    <a href="/perfil?tab=historial">Historial</a>
    <button id="signOutButton" type="button">Cerrar sesión</button>`;
  $('#signOutButton').onclick = async () => {
    await api('/api/auth/sign-out', { method: 'POST', body: '{}' });
    state.social.viewer = null;
    state.social.loaded = true;
    renderAccount();
    router();
  };
}

function requireViewer() {
  if (state.social.viewer) return true;
  openLogin();
  return false;
}

async function socialWrite(path, method = 'POST', body) {
  if (!requireViewer()) return null;
  return socialApi(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

function projectCard(project) {
  const node = document.createElement('article');
  node.className = 'project-card';
  node.innerHTML = `
    <a class="project-card-link" href="/proyecto/${encodeURIComponent(project.id)}">
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
          <a class="btn btn-primary" href="/proyecto/${encodeURIComponent(hero.id)}">▶ Ver proyecto</a>
          <a class="btn btn-secondary" href="/catalogo">Explorar catálogo</a>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-heading">
        <div><h2>Proyectos destacados</h2><p>Series, películas y OVA dobladas por la comunidad.</p></div>
        <a href="/catalogo">Ver todo →</a>
      </div>
      <div class="project-grid" id="featuredGrid"></div>
    </section>

    <section class="section">
      <div class="section-heading">
        <div><h2>Estudios de fandoblaje</h2><p>Cada proyecto conserva sus créditos y responsables.</p></div>
        <a href="/estudios">Conocer estudios →</a>
      </div>
      <div class="studio-strip">
        ${state.studios.slice(0, 5).map(studio => `
          <a class="studio-mini" href="/estudio/${encodeURIComponent(studio.id)}">
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
  const params = new URLSearchParams(location.search);
  const selectedValues = params.getAll('genre');
  const selectedNormalized = new Set(selectedValues.map(normalizeText));
  const selectedGenres = genres.filter(genre => selectedNormalized.has(normalizeText(genre)));
  const initialQuery = params.get('q') || '';
  const initialType = params.get('type') || '';
  app.innerHTML = `
    <header class="page-header">
      <span class="eyebrow">Catálogo completo</span>
      <h1>Todo Dubverse, sin carpetas infinitas.</h1>
      <p>${state.projects.length} proyectos migrados y organizados automáticamente.</p>
      <div class="catalog-tools">
        <input id="catalogSearch" type="search" value="${esc(initialQuery)}" placeholder="Buscar por título o sinopsis" />
        <select id="typeFilter"><option value="">Todos los tipos</option><option value="SERIES">Series</option><option value="MOVIE">Películas</option><option value="OVA">OVA</option><option value="SPECIAL">Especiales</option><option value="MANGA_COMIC_DUB">Manga / Comic Dub</option></select>
      </div>
      <fieldset class="genre-filter"><legend>Géneros <small>Coincidencia amplia por relevancia</small></legend>
        <div>${genres.map(genre => `<label><input type="checkbox" name="genre" value="${esc(genre)}" ${selectedGenres.includes(genre) ? 'checked' : ''}> <span>${esc(genre)}</span></label>`).join('')}</div>
      </fieldset>
      <div class="filter-actions">
        <button id="clearGenres" class="text-button" type="button">Limpiar géneros</button>
        <button id="clearFilters" class="text-button" type="button">Limpiar filtros</button>
      </div>
    </header>
    <section class="section section-tight"><div class="project-grid" id="catalogGrid"></div></section>
  `;

  $('#typeFilter').value = initialType;

  const updateUrl = mode => {
    const next = new URLSearchParams();
    const query = $('#catalogSearch').value.trim();
    const type = $('#typeFilter').value;
    if (query) next.set('q', query);
    if (type) next.set('type', type);
    $$('input[name="genre"]:checked').forEach(input => next.append('genre', input.value));
    const destination = `/catalogo${next.size ? `?${next}` : ''}`;
    history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', destination);
  };

  const draw = () => {
    let list = [...state.projects];
    const query = normalizeText($('#catalogSearch').value.trim());
    const type = $('#typeFilter').value;
    const chosen = $$('input[name="genre"]:checked').map(input => normalizeText(input.value));
    if (query) list = list.filter(project => normalizeText(`${project.title} ${project.synopsis}`).includes(query));
    if (type) list = list.filter(project => project.type === type);
    if (chosen.length) {
      list = list.map((project, index) => {
        const projectGenres = new Set((project.genres || []).map(normalizeText));
        return { project, index, matches: chosen.reduce((count, genre) => count + Number(projectGenres.has(genre)), 0) };
      }).filter(item => item.matches).sort((left, right) => right.matches - left.matches || left.index - right.index).map(item => item.project);
    }
    renderCards(list, $('#catalogGrid'));
  };

  $('#catalogSearch').addEventListener('input', () => { updateUrl('replace'); draw(); });
  $('#typeFilter').addEventListener('change', () => { updateUrl('push'); draw(); });
  $$('input[name="genre"]').forEach(input => input.addEventListener('change', () => { updateUrl('push'); draw(); }));
  $('#clearGenres').onclick = () => { $$('input[name="genre"]').forEach(input => { input.checked = false; }); updateUrl('push'); draw(); };
  $('#clearFilters').onclick = () => { $('#catalogSearch').value = ''; $('#typeFilter').value = ''; $$('input[name="genre"]').forEach(input => { input.checked = false; }); updateUrl('push'); draw(); };
  draw();
}

function stars(value) {
  const rating = Math.max(0, Math.min(5, Number(value) || 0));
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

function reviewMarkup(review) {
  const author = review.author;
  return `<article class="social-entry" data-review-id="${esc(review.id)}">
    <div class="social-entry-head">
      ${author ? `<a class="social-author" href="/u/${encodeURIComponent(author.username)}"><img src="${avatarImage(author)}" alt=""><span><strong>${esc(author.displayName)}</strong><small>@${esc(author.username)}</small></span></a>` : '<span class="social-author anonymous-author">Usuario eliminado</span>'}
      <span class="rating" aria-label="${review.rating} de 5">${stars(review.rating)}</span>
    </div>
    ${review.project ? `<a class="entry-context" href="/proyecto/${encodeURIComponent(review.project.id)}">${esc(review.project.title)}</a>` : ''}
    <p>${esc(review.body)}</p>
    <footer><time>${esc(dateLabel(review.updatedAt))}${review.edited ? ' · editada' : ''}</time><span>
      ${review.own ? '<button type="button" data-edit-review>Editar</button><button type="button" data-delete-review>Eliminar</button>' : '<button type="button" data-report-review>Reportar</button>'}
    </span></footer>
  </article>`;
}

async function reportContent(targetType, targetId) {
  if (!requireViewer()) return;
  const reason = prompt('Motivo: SPAM, HARASSMENT, INAPPROPRIATE, SPOILER u OTHER', 'SPAM');
  if (!reason) return;
  const details = prompt('Detalles opcionales (máximo 500 caracteres)', '') ?? '';
  await socialWrite('/reports', 'POST', { targetType, targetId, reason: reason.toUpperCase(), details });
  alert('Reporte enviado a moderación.');
}

function bindReviewActions(projectId) {
  $$('[data-report-review]').forEach(button => button.onclick = () => reportContent('REVIEW', button.closest('[data-review-id]').dataset.reviewId).catch(error => alert(error.message)));
  $$('[data-delete-review]').forEach(button => button.onclick = async () => {
    if (!confirm('¿Eliminar tu reseña?')) return;
    try { await socialWrite(`/reviews/${button.closest('[data-review-id]').dataset.reviewId}`, 'DELETE'); await projectPage(projectId); } catch (error) { alert(error.message); }
  });
  $$('[data-edit-review]').forEach(button => button.onclick = async () => {
    const item = button.closest('[data-review-id]');
    const body = prompt('Edita tu reseña', item.querySelector('p').textContent);
    if (!body) return;
    const rating = Number(prompt('Calificación de 1 a 5', '5'));
    try { await socialWrite(`/reviews/${item.dataset.reviewId}`, 'PATCH', { body, rating }); await projectPage(projectId); } catch (error) { alert(error.message); }
  });
}

async function projectPage(id) {
  const project = await api(`/api/projects/${encodeURIComponent(id)}`);
  const social = await optionalSocial(`/projects/${encodeURIComponent(id)}`);
  const dubbing = dubbingPanel(project);
  const seen = new Set(social?.seenEpisodeIds || []);
  const viewer = state.social.viewer;
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
          <div class="tag-row">${project.genres.map(genre => `<a class="chip genre-link" href="/catalogo?genre=${encodeURIComponent(genre)}">${esc(genre)}</a>`).join('')}</div>
        </div>

        <div class="project-details">
          <p class="synopsis">${esc(project.synopsis)}</p>
          <div class="actions">
            ${project.episodes.length ? `<a class="btn btn-primary" href="/ver/${encodeURIComponent(project.episodes[0].id)}">▶ Reproducir desde el inicio</a>` : '<span class="chip">Sin episodios publicados</span>'}
            ${social ? `<button class="btn btn-secondary social-toggle ${social.viewer.liked ? 'active' : ''}" data-social-action="like" type="button">♥ ${social.likes}</button>
              <button class="btn btn-secondary social-toggle ${social.viewer.favorite ? 'active' : ''}" data-social-action="favorite" type="button">${social.viewer.favorite ? '♥' : '♡'} Favorito</button>
              <button class="btn btn-secondary social-toggle ${social.viewer.watchLater ? 'active' : ''}" data-social-action="watch-later" type="button">${social.viewer.watchLater ? '✓' : '+'} Ver después</button>` : ''}
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-heading"><div><h2>Episodios</h2><p>Servidor principal: Archive.org. Reproductor limpio y sin anuncios propios.</p></div></div>
      <div class="episode-list">
        ${project.episodes.map(episode => `
          <a class="episode-row ${seen.has(episode.id) ? 'episode-seen' : ''}" href="/ver/${encodeURIComponent(episode.id)}">
            <span class="episode-number">${String(episode.number).padStart(2, '0')}</span>
            <div><h3>${esc(episode.title)}</h3><p>${esc(episode.description)}</p></div>
            <span class="episode-play" aria-label="${seen.has(episode.id) ? 'Visto' : 'Reproducir'}">${seen.has(episode.id) ? '✓' : '▶'}</span>
          </a>
        `).join('') || '<div class="empty">Todavía no hay episodios publicados.</div>'}
      </div>
    </section>

    ${dubbing ? `<section class="section section-tight">${dubbing}</section>` : ''}

    ${social ? `<section class="section social-section" id="resenas">
      <div class="section-heading"><div><h2>Reseñas</h2><p><strong>${social.reviewAverage.toFixed(1)}</strong> / 5 · ${social.reviewCount} reseña${social.reviewCount === 1 ? '' : 's'}</p></div></div>
      ${viewer ? `<form id="reviewForm" class="social-form"><label>Calificación <select name="rating" class="form-control"><option value="5">5 — Excelente</option><option value="4">4 — Muy buena</option><option value="3">3 — Buena</option><option value="2">2 — Regular</option><option value="1">1 — Mala</option></select></label><label class="form-wide">Tu reseña<textarea name="body" maxlength="2000" required></textarea></label><button class="btn btn-primary" type="submit">Publicar o actualizar reseña</button><p class="form-message" role="status"></p></form>` : '<button class="btn btn-secondary" id="reviewLogin" type="button">Inicia sesión para reseñar</button>'}
      <div class="social-list" id="reviewList">${social.reviews.items.map(reviewMarkup).join('') || '<div class="empty">Aún no hay reseñas.</div>'}</div>
      ${social.reviews.hasMore ? '<button class="btn btn-secondary load-more" id="moreReviews" type="button">Cargar más reseñas</button>' : ''}
    </section>` : ''}
  `;

  $$('[data-social-action]').forEach(button => button.onclick = async () => {
    if (!requireViewer()) return;
    const action = button.dataset.socialAction;
    const active = action === 'like' ? social.viewer.liked : action === 'favorite' ? social.viewer.favorite : social.viewer.watchLater;
    try { await socialWrite(`/projects/${encodeURIComponent(id)}/${action}`, active ? 'DELETE' : 'POST'); await projectPage(id); } catch (error) { alert(error.message); }
  });
  if ($('#reviewLogin')) $('#reviewLogin').onclick = openLogin;
  if ($('#reviewForm')) $('#reviewForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('.form-message', form);
    message.textContent = 'Guardando…';
    try {
      await socialWrite(`/projects/${encodeURIComponent(id)}/reviews`, 'POST', { rating: Number(form.elements.rating.value), body: form.elements.body.value });
      await projectPage(id);
    } catch (error) { message.textContent = error.message; }
  };
  bindReviewActions(id);
  if ($('#moreReviews')) $('#moreReviews').onclick = async () => {
    const next = await socialApi(`/projects/${encodeURIComponent(id)}?page=2`);
    $('#reviewList').insertAdjacentHTML('beforeend', next.reviews.items.map(reviewMarkup).join(''));
    $('#moreReviews').remove();
    bindReviewActions(id);
  };
}

function commentMarkup(comment) {
  const author = comment.author;
  return `<article class="social-entry" data-comment-id="${esc(comment.id)}">
    <div class="social-entry-head">
      ${author ? `<a class="social-author" href="/u/${encodeURIComponent(author.username)}"><img src="${avatarImage(author)}" alt=""><span><strong>${esc(author.displayName)}</strong><small>@${esc(author.username)}</small></span></a>` : '<span class="social-author anonymous-author">Usuario eliminado</span>'}
    </div>
    <p>${esc(comment.body)}</p>
    ${comment.image ? `<img class="comment-image" loading="lazy" src="${esc(comment.image)}" alt="Imagen adjunta al comentario">` : ''}
    <footer><time>${esc(dateLabel(comment.updatedAt))}${comment.edited ? ' · editado' : ''}</time><span>
      ${comment.own ? '<button type="button" data-edit-comment>Editar</button><button type="button" data-delete-comment>Eliminar</button>' : '<button type="button" data-report-comment>Reportar</button>'}
    </span></footer>
  </article>`;
}

async function uploadUserImage(file, purpose, targetId) {
  const signed = await socialWrite('/media/presign', 'POST', { purpose, targetId, contentType: file.type, size: file.size });
  if (!signed) return null;
  const upload = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': signed.contentType }, body: file });
  if (!upload.ok) throw new Error('R2 rechazó la subida temporal.');
  return socialWrite(`/media/${signed.uploadId}/finalize`, 'POST', {});
}

function bindCommentActions(episodeId) {
  $$('[data-report-comment]').forEach(button => button.onclick = () => reportContent('COMMENT', button.closest('[data-comment-id]').dataset.commentId).catch(error => alert(error.message)));
  $$('[data-delete-comment]').forEach(button => button.onclick = async () => {
    if (!confirm('¿Eliminar tu comentario?')) return;
    try { await socialWrite(`/comments/${button.closest('[data-comment-id]').dataset.commentId}`, 'DELETE'); await watch(episodeId, false); } catch (error) { alert(error.message); }
  });
  $$('[data-edit-comment]').forEach(button => button.onclick = async () => {
    const item = button.closest('[data-comment-id]');
    const body = prompt('Edita tu comentario', item.querySelector('p').textContent);
    if (!body) return;
    try { await socialWrite(`/comments/${item.dataset.commentId}`, 'PATCH', { body }); await watch(episodeId, false); } catch (error) { alert(error.message); }
  });
}

async function watch(id, trackView = true) {
  const episode = await api(`/api/episodes/${encodeURIComponent(id)}`);
  const [project, social] = await Promise.all([
    api(`/api/projects/${encodeURIComponent(episode.project_id)}`),
    optionalSocial(`/episodes/${encodeURIComponent(id)}`)
  ]);
  const episodes = [...(project.episodes || [])].sort((left, right) => left.season - right.season || left.number - right.number);
  const currentIndex = episodes.findIndex(item => item.id === episode.id);
  const previous = currentIndex > 0 ? episodes[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < episodes.length - 1 ? episodes[currentIndex + 1] : null;
  const player = episode.provider === 'ARCHIVE'
    ? `<iframe src="${esc(episode.video_url)}" title="${esc(episode.title)}" allow="fullscreen; autoplay" allowfullscreen loading="eager"></iframe>`
    : `<video controls playsinline preload="metadata" src="${esc(episode.video_url)}"></video>`;

  app.innerHTML = `
    <section class="watch-page">
      <a class="watch-back" href="/proyecto/${encodeURIComponent(episode.project_id)}">← Volver a ${esc(episode.project?.title || 'proyecto')}</a>
      <div class="watch-title"><h1>${esc(episode.title)}</h1><p>Temporada ${episode.season} · Episodio ${episode.number} · ${esc(episode.provider)}</p></div>
      <div class="player-shell">${player}</div>
      <div class="player-note">Dubverse no inserta anuncios. El archivo se reproduce desde el proveedor indicado y conserva los créditos del proyecto.</div>
      <nav class="player-navigation" aria-label="Navegación de episodios">
        ${previous ? `<a href="/ver/${encodeURIComponent(previous.id)}">← Anterior</a>` : '<span aria-disabled="true">← Anterior</span>'}
        <details class="episode-picker">
          <summary>Episodios</summary>
          <div class="episode-picker-menu">
            ${episodes.map(item => `<a href="/ver/${encodeURIComponent(item.id)}" ${item.id === episode.id ? 'aria-current="page"' : ''}><span>T${item.season} · E${String(item.number).padStart(2, '0')}</span><strong>${esc(item.title)}</strong></a>`).join('')}
          </div>
        </details>
        ${next ? `<a href="/ver/${encodeURIComponent(next.id)}">Siguiente →</a>` : '<span aria-disabled="true">Siguiente →</span>'}
      </nav>
      ${dubbingPanel(project)}
      <div class="actions"><a class="btn btn-secondary" href="/proyecto/${encodeURIComponent(episode.project_id)}">Ver ficha del proyecto</a>
        ${social ? `<button class="btn btn-secondary social-toggle ${social.viewer.liked ? 'active' : ''}" id="episodeLike" type="button">♥ ${social.likes}</button>` : ''}
      </div>
      ${social ? `<section class="comments-section"><div class="section-heading"><div><h2>Comentarios</h2><p>Conversación sobre este episodio.</p></div></div>
        ${state.social.viewer ? `<form id="commentForm" class="social-form"><label class="form-wide">Comentario<textarea name="body" maxlength="1500" required></textarea></label><label class="file-label">Imagen opcional (JPEG, PNG o WebP)<input name="image" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn btn-primary" type="submit">Publicar comentario</button><p class="form-message" role="status"></p></form>` : '<button class="btn btn-secondary" id="commentLogin" type="button">Inicia sesión para comentar</button>'}
        <div class="social-list" id="commentList">${social.comments.items.map(commentMarkup).join('') || '<div class="empty">Aún no hay comentarios.</div>'}</div>
        ${social.comments.hasMore ? '<button class="btn btn-secondary load-more" id="moreComments" type="button">Cargar más comentarios</button>' : ''}
      </section>` : ''}
    </section>
  `;
  if (state.social.viewer && trackView) socialWrite(`/episodes/${encodeURIComponent(id)}/view`, 'POST').catch(() => {});
  if ($('#episodeLike')) $('#episodeLike').onclick = async () => {
    if (!requireViewer()) return;
    try { await socialWrite(`/episodes/${encodeURIComponent(id)}/like`, social.viewer.liked ? 'DELETE' : 'POST'); await watch(id, false); } catch (error) { alert(error.message); }
  };
  if ($('#commentLogin')) $('#commentLogin').onclick = openLogin;
  if ($('#commentForm')) $('#commentForm').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $('.form-message', form);
    message.textContent = 'Publicando…';
    try {
      const created = await socialWrite(`/episodes/${encodeURIComponent(id)}/comments`, 'POST', { body: form.elements.body.value });
      const file = form.elements.image.files[0];
      if (file) {
        message.textContent = 'Validando imagen…';
        await uploadUserImage(file, 'COMMENT', created.comment.id);
      }
      await watch(id, false);
    } catch (error) { message.textContent = `${error.message} Si el texto ya se publicó, puedes añadir la imagen al crear un comentario nuevo.`; }
  };
  bindCommentActions(id);
  if ($('#moreComments')) $('#moreComments').onclick = async () => {
    const nextPage = await socialApi(`/episodes/${encodeURIComponent(id)}?page=2`);
    $('#commentList').insertAdjacentHTML('beforeend', nextPage.comments.items.map(commentMarkup).join(''));
    $('#moreComments').remove(); bindCommentActions(id);
  };
}

function studios() {
  app.innerHTML = `
    <header class="page-header"><span class="eyebrow">Comunidad</span><h1>Estudios y equipos</h1><p>Los proyectos ya no están aislados: cada estudio aparece vinculado con todo su trabajo.</p></header>
    <section class="section section-tight">
      <div class="studio-grid">
        ${state.studios.map(studio => `
          <article class="studio-card">
            <div class="studio-card-head">
              <a class="studio-card-logo" href="/estudio/${encodeURIComponent(studio.id)}"><img src="${esc(imageOrFallback(studio.logo))}" alt="Logo de ${esc(studio.name)}" /></a>
              <div><h2><a href="/estudio/${encodeURIComponent(studio.id)}">${esc(studio.name)}</a></h2><span class="director">${esc(studio.director || 'Dirección no indicada')}</span></div>
            </div>
            <p>${esc(studio.description || 'Sin descripción disponible.')}</p>
            <div class="studio-projects">${(studio.projects || []).map(project => `<a href="/proyecto/${encodeURIComponent(project.id)}">${esc(project.title)}</a>`).join('') || '<span class="chip">Sin proyectos ligados</span>'}</div>
            <a class="studio-detail-link" href="/estudio/${encodeURIComponent(studio.id)}">Ver página del estudio →</a>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

async function studioPage(id) {
  const studio = await api(`/api/studios/${encodeURIComponent(id)}`);
  app.innerHTML = `
    <section class="studio-profile">
      <div class="studio-profile-head">
        <img src="${esc(imageOrFallback(studio.logo))}" alt="Logo de ${esc(studio.name)}">
        <div>
          <span class="eyebrow">Estudio de fandoblaje</span>
          <h1>${esc(studio.name)}</h1>
          ${studio.director ? `<p class="studio-management"><strong>Dirección / administración del estudio:</strong> ${esc(studio.director)}</p>` : ''}
          ${socialLinks(studio.socials)}
        </div>
      </div>
      <div class="studio-profile-copy">
        <h2>Información general</h2>
        <p>${esc(studio.description || 'Este estudio todavía no tiene una descripción pública.')}</p>
      </div>
    </section>
    <section class="section">
      <div class="section-heading"><div><h2>Proyectos relacionados</h2><p>${studio.projects.length} ${studio.projects.length === 1 ? 'proyecto publicado' : 'proyectos publicados'}.</p></div></div>
      <div class="project-grid" id="studioProjectGrid"></div>
    </section>`;
  renderCards(studio.projects || [], $('#studioProjectGrid'));
}

function profileHero(profile, own = false) {
  const banner = safeExternalUrl(profile.banner);
  return `<section class="user-profile">
    <div class="user-banner" style="background-image:url('${esc(banner)}')"></div>
    <div class="user-identity"><img src="${avatarImage(profile)}" alt="Avatar de ${esc(profile.displayName)}"><div><span class="eyebrow">${own ? 'Mi cuenta' : 'Perfil de la comunidad'}</span><h1>${esc(profile.displayName)}</h1><strong>@${esc(profile.username)}</strong><p>${esc(profile.bio || 'Sin biografía todavía.')}</p><small>En Dubverse desde ${esc(dateLabel(profile.joinedAt))}</small></div></div>
  </section>`;
}

async function publicUserPage(username) {
  const data = await socialApi(`/users/${encodeURIComponent(username)}`);
  app.innerHTML = `${profileHero(data.profile)}
    <section class="section"><div class="section-heading"><div><h2>Favoritos públicos</h2><p>Proyectos guardados por @${esc(data.profile.username)}.</p></div></div><div class="project-grid" id="publicFavorites"></div></section>
    <section class="section"><div class="section-heading"><div><h2>Reseñas</h2><p>Opiniones públicas de este usuario.</p></div></div><div class="social-list">${data.reviews.items.map(reviewMarkup).join('') || '<div class="empty">Aún no ha publicado reseñas.</div>'}</div></section>`;
  renderCards(data.favorites.items, $('#publicFavorites'));
}

function historyMarkup(item) {
  return `<a class="history-item" href="/ver/${encodeURIComponent(item.episode.id)}"><img src="${esc(imageOrFallback(item.project.poster))}" alt=""><span><strong>${esc(item.project.title)}</strong><small>T${item.episode.season} · E${item.episode.number} — ${esc(item.episode.title)}</small><time>Visto ${esc(dateLabel(item.lastViewedAt))} · ${item.viewCount} ${item.viewCount === 1 ? 'vez' : 'veces'}</time></span></a>`;
}

async function ownProfilePage() {
  if (!state.social.viewer) {
    app.innerHTML = '<div class="empty empty-page"><h2>Tu perfil requiere sesión</h2><p>Inicia sesión con Google o Discord para continuar.</p><button id="profileLogin" class="btn btn-primary" type="button">Iniciar sesión</button></div>';
    $('#profileLogin').onclick = openLogin;
    return;
  }
  const data = await socialApi('/me');
  const profile = data.profile;
  const mediaControls = state.social.config.mediaAvailable ? `<div class="profile-media"><label>Avatar<input id="avatarFile" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn btn-secondary" data-upload-profile="AVATAR" type="button">Cambiar avatar</button><label>Banner<input id="bannerFile" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn btn-secondary" data-upload-profile="BANNER" type="button">Cambiar banner</button></div>` : '<p class="form-message">Las imágenes personalizadas no están disponibles hasta configurar R2.</p>';
  app.innerHTML = `${profileHero(profile, true)}
    <section class="section profile-layout">
      <article class="profile-settings"><h2>Editar perfil</h2><form id="profileForm" class="social-form"><label>Nombre visible<input class="form-control" name="displayName" maxlength="80" value="${esc(profile.displayName)}" required></label><label>Username<input class="form-control" name="username" minlength="3" maxlength="30" value="${esc(profile.username)}" required></label><label class="form-wide">Biografía<textarea name="bio" maxlength="500">${esc(profile.bio)}</textarea></label><button class="btn btn-primary" type="submit">Guardar perfil</button><p class="form-message" role="status"></p></form>${mediaControls}</article>
      <article class="profile-settings danger-zone"><h2>Cuenta</h2><p>Cerrar sesión no elimina datos. Eliminar la cuenta revoca sesiones, elimina identidades OAuth y datos privados, anonimiza comentarios/reseñas y limpia medios personalizados.</p><div class="actions"><button id="profileSignOut" class="btn btn-secondary" type="button">Cerrar sesión</button><button id="deleteAccount" class="btn btn-danger" type="button">Eliminar cuenta</button></div></article>
    </section>
    <section class="section" id="favoritos"><div class="section-heading"><div><h2>Favoritos</h2><p>Tu colección pública.</p></div></div><div class="project-grid" id="ownFavorites"></div></section>
    <section class="section" id="ver-despues"><div class="section-heading"><div><h2>Ver después</h2><p>Lista privada.</p></div></div><div class="project-grid" id="ownWatchLater"></div></section>
    <section class="section" id="historial"><div class="section-heading"><div><h2>Historial</h2><p>Episodios vistos recientemente; sólo tú puedes verlo.</p></div></div><div class="history-list">${data.history.items.map(historyMarkup).join('') || '<div class="empty">Todavía no hay reproducciones registradas.</div>'}</div></section>`;
  renderCards(data.favorites.items, $('#ownFavorites'));
  renderCards(data.watchLater.items, $('#ownWatchLater'));
  $('#profileForm').onsubmit = async event => {
    event.preventDefault(); const form = event.currentTarget; const message = $('.form-message', form); message.textContent = 'Guardando…';
    try {
      const result = await socialWrite('/me', 'PATCH', { displayName: form.elements.displayName.value, username: form.elements.username.value, bio: form.elements.bio.value });
      state.social.viewer = result.profile; renderAccount(); message.textContent = 'Perfil actualizado.';
    } catch (error) { message.textContent = error.message; }
  };
  $$('[data-upload-profile]').forEach(button => button.onclick = async () => {
    const purpose = button.dataset.uploadProfile;
    const file = $(`#${purpose === 'AVATAR' ? 'avatarFile' : 'bannerFile'}`).files[0];
    if (!file) return alert('Selecciona una imagen primero.');
    button.disabled = true;
    try { await uploadUserImage(file, purpose); state.social.loaded = false; await loadSocial(); await ownProfilePage(); } catch (error) { alert(error.message); button.disabled = false; }
  });
  $('#profileSignOut').onclick = async () => { await api('/api/auth/sign-out', { method: 'POST', body: '{}' }); state.social.viewer = null; renderAccount(); router(); };
  $('#deleteAccount').onclick = async () => {
    if (prompt('Escribe ELIMINAR para borrar permanentemente tu cuenta.', '') !== 'ELIMINAR') return;
    try { await api('/api/auth/delete-user', { method: 'POST', body: JSON.stringify({ callbackURL: '/' }) }); state.social.viewer = null; renderAccount(); history.replaceState(null, '', '/'); router(); } catch (error) { alert(`${error.message} Por seguridad puede ser necesario volver a iniciar sesión antes de eliminarla.`); }
  };
  const requestedTab = new URLSearchParams(location.search).get('tab');
  if (requestedTab) document.getElementById(requestedTab)?.scrollIntoView();
}

function about() {
  app.innerHTML = `
    <header class="page-header">
      <span class="eyebrow">Sobre DUBVERSE</span>
      <h1>¿Quiénes somos?</h1>
    </header>

    <section class="section section-tight">
      <div class="about-panel">
        <p>
          En <strong>DUBVERSE</strong>, nos dedicamos con pasión a ofrecer
          fandoblajes de calidad, hechos por fans para fans. Traemos a ti
          versiones dobladas de animes, películas y series, creadas con amor
          y dedicación.
        </p>

        <p>
          La inspiración para crear esta página nació al ver cómo muchos
          estudios y personas dedicadas al fandoblaje no tenían un espacio
          donde alojar sus proyectos. Esto hacía que su trabajo pasara
          desapercibido, a pesar del esfuerzo que ponían.
        </p>

        <p>
          Nuestra misión es clara: brindar un espacio para compartir
          fandoblajes en español latino que puedan ser disfrutados por todos,
          de manera gratuita y sin fines de lucro. Cada proyecto alojado aquí
          representa el talento y la dedicación de quienes aman esta forma de
          arte.
        </p>

        <p>
          Nos definen la creatividad, la pasión y el deseo de dar vida a los
          personajes en nuestro idioma. Aquí podrás encontrar doblajes no
          profesionales —realizados por aficionados— de animes, películas y
          series, siempre con el mayor respeto al material original.
        </p>

        <p>
          El propósito de <strong>DUBVERSE</strong> es alojar y dar visibilidad
          a estos trabajos para que todos puedan disfrutar del esfuerzo de cada
          estudio o persona involucrada. Todo esto nace del amor por el arte y
          sin intención de lucro, siendo conscientes de la situación legal de
          los fandoblajes y dejando claro que nuestra meta no es perjudicar los
          derechos de los autores, sino rendir homenaje a sus obras.
        </p>

        <p>
          Gracias por formar parte de esta comunidad.
          <strong>¡DUBVERSE es de fans para fans!</strong>
        </p>
      </div>
    </section>
  `;
}

async function router() {
  try {
    await loadBase();
    const parts = location.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
    const currentPath = location.pathname.replace(/\/$/, '') || '/';
    $$('#mainNav a').forEach(link => {
      const linkPath = new URL(link.href, location.origin).pathname.replace(/\/$/, '') || '/';
      link.classList.toggle('active', linkPath === currentPath);
    });
    window.scrollTo(0, 0);
    if (!parts.length) return home();
    if (parts[0] === 'catalogo') return catalog();
    if (parts[0] === 'estudios') return studios();
    if (parts[0] === 'estudio' && parts[1]) return studioPage(parts[1]);
    if (parts[0] === 'acerca') return about();
    if (parts[0] === 'proyecto' && parts[1]) return projectPage(parts[1]);
    if (parts[0] === 'ver' && parts[1]) return watch(parts[1]);
    if (parts[0] === 'u' && parts[1]) return publicUserPage(parts[1]);
    if (parts[0] === 'perfil') return ownProfilePage();
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
const accountTrigger = $('#accountTrigger');
const accountMenu = $('#accountMenu');

accountTrigger.addEventListener('click', () => {
  if (!state.social.viewer) return openLogin();
  accountMenu.classList.toggle('hidden');
});

$('#closeLogin').addEventListener('click', () => $('#loginDialog').close());

document.addEventListener('click', event => {
  if (!event.target.closest('#accountSlot')) accountMenu.classList.add('hidden');
});

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
    ...projects.map(project => `<a class="search-item" href="/proyecto/${encodeURIComponent(project.id)}" data-close-search><img src="${esc(imageOrFallback(project.poster))}" alt=""><div><strong>${esc(project.title)}</strong><small>${esc(typeLabel(project.type))} · ${project.episodeCount} episodios</small></div></a>`),
    ...studiosFound.map(studio => `<a class="search-item" href="/estudio/${encodeURIComponent(studio.id)}" data-close-search><img src="${esc(imageOrFallback(studio.logo))}" alt=""><div><strong>${esc(studio.name)}</strong><small>Estudio de fandoblaje</small></div></a>`)
  ].join('') || '<p class="empty">Sin resultados.</p>';
  $$('[data-close-search]', results).forEach(link => link.addEventListener('click', () => dialog.close()));
});

menuButton.addEventListener('click', () => {
  const open = mainNav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.textContent = open ? '×' : '☰';
});

function closeMenu() {
  mainNav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.textContent = '☰';
}

function normalizeLegacyHash() {
  if (!location.hash.startsWith('#/')) return false;
  const path = location.hash.slice(1) || '/';
  if (!PUBLIC_PATH.test(path)) return false;
  history.replaceState(history.state, '', `${path}${location.search}`);
  return true;
}

document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[href]');
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || !PUBLIC_PATH.test(url.pathname)) return;
  event.preventDefault();
  const destination = `${url.pathname}${url.search}`;
  if (destination !== `${location.pathname}${location.search}` || location.hash) {
    history.pushState(null, '', destination);
  }
  closeMenu();
  router();
});

window.addEventListener('popstate', () => {
  closeMenu();
  router();
});

window.addEventListener('hashchange', () => {
  if (!normalizeLegacyHash()) return;
  closeMenu();
  router();
});

normalizeLegacyHash();
router();
