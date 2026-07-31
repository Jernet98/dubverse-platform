const app = document.querySelector('#app');
const cardTemplate = document.querySelector('#projectCardTemplate');
const state = { projects: [], studios: [], settings: {}, loaded: false };
const $ = (s, root=document) => root.querySelector(s);
const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const typeLabel = t => ({SERIES:'Serie',MOVIE:'Película',OVA:'OVA',SPECIAL:'Especial'}[t] || t);
const statusLabel = s => ({ONGOING:'En emisión',FINISHED:'Finalizado',PAUSED:'Pausado',CANCELLED:'Cancelado'}[s] || s);

async function api(path){
  const r = await fetch(path);
  if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error || `Error ${r.status}`);
  return r.json();
}

async function loadBase(){
  if(state.loaded) return;
  [state.projects,state.studios,state.settings] = await Promise.all([api('/api/projects'),api('/api/studios'),api('/api/settings')]);
  state.loaded = true;
}

function projectCard(project){
  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  const a = $('.project-card-link',node); a.href = `#/proyecto/${project.id}`;
  const img = $('.poster',node); img.src = project.poster || '/assets/dubverse-icon.png'; img.alt = project.title;
  $('.project-type',node).textContent = typeLabel(project.type);
  $('h3',node).textContent = project.title;
  $('p',node).textContent = `${project.episodeCount} ${project.episodeCount===1?'episodio':'episodios'} · ${statusLabel(project.status)}`;
  return node;
}

function renderCards(projects, target){
  target.innerHTML=''; projects.forEach(p=>target.append(projectCard(p)));
  if(!projects.length) target.innerHTML='<div class="empty">No encontré proyectos con esos filtros.</div>';
}

function home(){
  const featured = state.projects.filter(p=>p.featured);
  const hero = featured[Math.floor(Math.random()*Math.max(featured.length,1))] || state.projects[0];
  app.innerHTML = `
    <section class="hero">
      <div class="hero-bg" style="background-image:url('${esc(hero.banner || hero.poster)}')"></div>
      <div class="hero-content">
        <span class="eyebrow">● Proyecto destacado</span>
        <h1>${esc(hero.title)}</h1>
        <p>${esc(hero.synopsis)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/proyecto/${hero.id}">▶ Ver proyecto</a>
          <a class="btn btn-secondary" href="#/catalogo">Explorar catálogo</a>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="section-heading"><div><h2>Proyectos destacados</h2><p>Series, películas y OVA dobladas por la comunidad.</p></div><a href="#/catalogo">Ver todo →</a></div>
      <div class="project-grid" id="featuredGrid"></div>
    </section>
    <section class="section">
      <div class="section-heading"><div><h2>Estudios de fandoblaje</h2><p>Cada proyecto conserva sus créditos y responsables.</p></div><a href="#/estudios">Conocer estudios →</a></div>
      <div class="studio-strip">${state.studios.slice(0,5).map(s=>`<a class="studio-mini" href="#/estudios"><img src="${esc(s.logo||'/assets/dubverse-icon.png')}" alt=""><div><strong>${esc(s.name)}</strong><span>${s.projects?.length||0} proyectos</span></div></a>`).join('')}</div>
    </section>`;
  renderCards((featured.length?featured:state.projects).slice(0,6),$('#featuredGrid'));
}

function catalog(){
  const genres=[...new Set(state.projects.flatMap(p=>p.genres||[]))].sort((a,b)=>a.localeCompare(b,'es'));
  app.innerHTML=`<header class="page-header"><span class="eyebrow">Catálogo completo</span><h1>Todo Dubverse, sin carpetas infinitas.</h1><p>${state.projects.length} proyectos migrados y organizados automáticamente.</p>
    <div class="catalog-tools"><input id="catalogSearch" placeholder="Buscar por título o sinopsis"><select id="typeFilter"><option value="">Todos los tipos</option><option value="SERIES">Series</option><option value="MOVIE">Películas</option></select><select id="genreFilter"><option value="">Todos los géneros</option>${genres.map(g=>`<option>${esc(g)}</option>`).join('')}</select></div></header>
    <section class="section" style="padding-top:10px"><div class="project-grid" id="catalogGrid"></div></section>`;
  const draw=()=>{let list=[...state.projects];const q=$('#catalogSearch').value.trim().toLowerCase(),t=$('#typeFilter').value,g=$('#genreFilter').value.toLowerCase();if(q)list=list.filter(p=>(p.title+' '+p.synopsis).toLowerCase().includes(q));if(t)list=list.filter(p=>p.type===t);if(g)list=list.filter(p=>(p.genres||[]).some(x=>x.toLowerCase()===g));renderCards(list,$('#catalogGrid'));};
  ['catalogSearch','typeFilter','genreFilter'].forEach(id=>$('#'+id).addEventListener('input',draw));draw();
}

async function projectPage(id){
  const p=await api(`/api/projects/${encodeURIComponent(id)}`);
  app.innerHTML=`<section class="project-hero"><div class="project-hero-bg" style="background-image:url('${esc(p.banner||p.poster)}')"></div><div class="project-summary"><img class="poster-large" src="${esc(p.poster||'/assets/dubverse-icon.png')}" alt="${esc(p.title)}"><div><div class="meta-row"><span class="chip">${typeLabel(p.type)}</span><span class="chip status-dot">${statusLabel(p.status)}</span><span class="chip">${p.episodeCount} episodios</span></div><h1>${esc(p.title)}</h1><div class="tag-row">${p.genres.map(g=>`<span class="chip">${esc(g)}</span>`).join('')}</div><p class="synopsis">${esc(p.synopsis)}</p><div class="actions">${p.episodes.length?`<a class="btn btn-primary" href="#/ver/${p.episodes[0].id}">▶ Reproducir desde el inicio</a>`:''}</div></div></div></section>
    <section class="section"><div class="section-heading"><div><h2>Episodios</h2><p>Servidor principal: Archive.org. Reproductor limpio y sin anuncios propios.</p></div></div><div class="episode-list">${p.episodes.map(e=>`<a class="episode-row" href="#/ver/${e.id}"><span class="episode-number">${String(e.number).padStart(2,'0')}</span><div><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p></div><span class="episode-play">▶</span></a>`).join('')}</div></section>
    ${p.studios.length?`<section class="section"><div class="section-heading"><div><h2>Créditos del fandoblaje</h2></div></div><div class="studio-strip">${p.studios.map(s=>`<a class="studio-mini" href="#/estudios"><img src="${esc(s.logo||'/assets/dubverse-icon.png')}" alt=""><div><strong>${esc(s.name)}</strong><span>${esc(s.role||'Fandoblaje')}</span></div></a>`).join('')}</div></section>`:''}`;
}

async function watch(id){
  const e=await api(`/api/episodes/${encodeURIComponent(id)}`);
  let player='';
  if(e.provider==='ARCHIVE') player=`<iframe src="${esc(e.video_url)}" allowfullscreen loading="eager"></iframe>`;
  else if(e.provider==='PIXELDRAIN') player=`<video controls playsinline src="${esc(e.video_url)}"></video>`;
  else player=`<video controls playsinline src="${esc(e.video_url)}"></video>`;
  app.innerHTML=`<section class="watch-page"><a class="watch-back" href="#/proyecto/${e.project_id}">← Volver a ${esc(e.project?.title||'proyecto')}</a><div class="watch-title"><h1>${esc(e.title)}</h1><p>Temporada ${e.season} · Episodio ${e.number} · ${esc(e.provider)}</p></div><div class="player-shell">${player}</div><div class="player-note">Dubverse no inserta anuncios. El archivo se reproduce desde el proveedor indicado y conserva los créditos del proyecto.</div><div class="actions"><a class="btn btn-secondary" href="#/proyecto/${e.project_id}">Lista de episodios</a></div></section>`;
}

function studios(){
  app.innerHTML=`<header class="page-header"><span class="eyebrow">Comunidad</span><h1>Estudios y equipos</h1><p>Los proyectos ya no están aislados: cada estudio aparece vinculado con todo su trabajo.</p></header><section class="section" style="padding-top:10px"><div class="studio-grid">${state.studios.map(s=>`<article class="studio-card"><div class="studio-card-head"><img src="${esc(s.logo||'/assets/dubverse-icon.png')}" alt=""><div><h2>${esc(s.name)}</h2><span class="director">${esc(s.director||'Dirección no indicada')}</span></div></div><p>${esc(s.description||'Sin descripción disponible.')}</p><div class="studio-projects">${(s.projects||[]).map(p=>`<a href="#/proyecto/${p.id}">${esc(p.title)}</a>`).join('')||'<span class="chip">Sin proyectos ligados</span>'}</div></article>`).join('')}</div></section>`;
}

function about(){app.innerHTML=`<header class="page-header"><span class="eyebrow">Sobre Dubverse</span><h1>Una plataforma comunitaria, no un negocio.</h1></header><section class="section" style="padding-top:10px"><div class="about-panel"><p><strong>Dubverse organiza y presenta proyectos de fandoblaje realizados por sus respectivos equipos.</strong> La plataforma no incluye publicidad propia ni busca monetizar el material.</p><p>Los créditos, responsables y enlaces de cada proyecto se conservan en su ficha. El contenido audiovisual se aloja en proveedores externos, principalmente Archive.org.</p><p>Los titulares de derechos pueden solicitar la revisión o retiro de material mediante los canales de contacto del proyecto. Esta reconstrucción también permite ocultar un episodio sin destruir el resto del catálogo.</p><p>La versión anterior estaba formada por numerosos HTML y carpetas. Esta versión genera todo desde una sola base de datos, por lo que crear un proyecto o episodio ya no requiere editar código.</p></div></section>`;}

async function router(){
  try{await loadBase();const parts=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);document.querySelectorAll('#mainNav a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')===location.hash));window.scrollTo(0,0);if(!parts.length)return home();if(parts[0]==='catalogo')return catalog();if(parts[0]==='estudios')return studios();if(parts[0]==='acerca')return about();if(parts[0]==='proyecto'&&parts[1])return await projectPage(parts[1]);if(parts[0]==='ver'&&parts[1])return await watch(parts[1]);home();}catch(err){app.innerHTML=`<div class="error-box"><h2>No pude cargar Dubverse</h2><p>${esc(err.message)}</p><button class="btn btn-primary" onclick="location.reload()">Reintentar</button></div>`;}}

const dialog=$('#searchDialog'), input=$('#globalSearch'), results=$('#searchResults');
$('#searchTrigger').addEventListener('click',()=>{dialog.showModal();input.value='';input.focus();results.innerHTML='<p class="empty">Escribe para buscar.</p>';});
input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();if(!q){results.innerHTML='<p class="empty">Escribe para buscar.</p>';return;}const projects=state.projects.filter(p=>p.title.toLowerCase().includes(q)).slice(0,8);const studios=state.studios.filter(s=>s.name.toLowerCase().includes(q)).slice(0,4);results.innerHTML=[...projects.map(p=>`<a class="search-item" href="#/proyecto/${p.id}" onclick="document.querySelector('#searchDialog').close()"><img src="${esc(p.poster)}"><div><strong>${esc(p.title)}</strong><small>${typeLabel(p.type)} · ${p.episodeCount} episodios</small></div></a>`),...studios.map(s=>`<a class="search-item" href="#/estudios" onclick="document.querySelector('#searchDialog').close()"><img src="${esc(s.logo||'/assets/dubverse-icon.png')}"><div><strong>${esc(s.name)}</strong><small>Estudio de fandoblaje</small></div></a>`)].join('')||'<p class="empty">Sin resultados.</p>';});
$('#menuButton').addEventListener('click',()=>$('#mainNav').classList.toggle('open'));window.addEventListener('hashchange',()=>{$('#mainNav').classList.remove('open');router();});router();
