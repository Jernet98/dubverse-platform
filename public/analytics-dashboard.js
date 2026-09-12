(function analyticsDashboardUI(global) {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const count = value => Number(value || 0).toLocaleString('es-MX');
  const rate = (value, previous) => {
    if (!previous || !Number.isFinite(Number(previous)) || Number(previous) <= 0) return '';
    const change = Math.round((Number(value || 0) - Number(previous)) / Number(previous) * 100);
    return `<small class="analytics-change ${change < 0 ? 'down' : 'up'}">${change > 0 ? '+' : ''}${change}% vs. periodo anterior</small>`;
  };
  const card = (label, value, previous) => `<article class="analytics-card"><span>${label}</span><strong>${count(value)}</strong>${rate(value, previous)}</article>`;
  const chart = (daily, metric = 'views') => {
    if (!daily.length) return '<div class="analytics-empty">Todavía no hay suficientes datos para mostrar el tráfico.</div>';
    const values = daily.map(day => Number(day[metric] || 0));
    const max = Math.max(1, ...values);
    const points = values.map((value, index) => `${daily.length === 1 ? 50 : index / (daily.length - 1) * 100},${95 - value / max * 85}`).join(' ');
    return `<div class="analytics-chart" role="img" aria-label="Evolución diaria de ${metric === 'views' ? 'vistas' : metric === 'plays' ? 'reproducciones' : 'visitantes'}"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="#ff454e" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="analytics-chart-labels"><span>${esc(daily[0].day)}</span><span>${esc(daily.at(-1).day)}</span></div></div>`;
  };
  const table = (headers, rows, empty) => `<div class="analytics-table-wrap"><table class="analytics-table"><thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="analytics-empty">${empty}</td></tr>`}</tbody></table></div>`;

  function render(data, { admin = false, period = '30d', studioId = '', projectId = '', studios = [], projects = [] } = {}) {
    const summary = data.summary || {};
    const previous = data.previous;
    const selectedProject = data.projects.find(item => item.id === projectId);
    const options = [['today','Hoy'],['7d','Últimos 7 días'],['30d','Últimos 30 días'],['90d','Últimos 90 días'],['all','Todo el tiempo']];
    const controls = `<div class="analytics-filters"><label>Periodo<select data-analytics-period>${options.map(([value,label]) => `<option value="${value}" ${value === period ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      ${admin ? `<label>Estudio<select data-analytics-studio><option value="">Todo Dubverse</option>${studios.map(item => `<option value="${esc(item.id)}" ${item.id === studioId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>` : ''}
      <label>Proyecto<select data-analytics-project><option value="">Todos los proyectos</option>${projects.map(item => `<option value="${esc(item.id)}" ${item.id === projectId ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select></label></div>`;
    const projectRows = data.projects.map(item => `<tr><td><button class="analytics-link" type="button" data-analytics-open-project="${esc(item.id)}">${esc(item.title)}</button>${item.deleted ? ' <small>En Papelera</small>' : ''}</td><td>${count(item.visitors)}</td><td>${count(item.views)}</td><td>${count(item.plays)}</td><td>${count(item.completed)}</td><td>${item.completionRate === null ? '—' : `${item.completionRate}%`}</td></tr>`).join('');
    const episodeRows = data.episodes.map(item => `<tr><td>T${item.season} · Ep. ${item.number}</td><td>${esc(item.title)}</td><td>${count(item.views)}</td><td>${count(item.plays)}</td><td>${count(item.play25)}</td><td>${count(item.play50)}</td><td>${count(item.play75)}</td><td>${count(item.completed)}</td><td>${item.completionRate === null ? '—' : `${item.completionRate}%`}</td></tr>`).join('');
    const rankedEpisodes = [...data.episodes].filter(item => item.views > 0).sort((a,b) => b.views - a.views);
    const projectCompletionRate = Number(summary.plays) > 0 ? `${Math.round(Number(summary.completed || 0) / Number(summary.plays) * 1000) / 10}%` : '—';
    return `<section class="analytics-dashboard"><header><h1>Estadísticas</h1><p>Consulta el rendimiento de tus proyectos y descubre qué contenido llega a más espectadores.</p><small>Datos disponibles desde la activación de Analytics; no incluyen actividad histórica anterior. Las reproducciones sólo cuentan cuando el reproductor de Dubverse detecta el inicio real; si Archive.org se abre en iframe, su reproducción no puede medirse y puede haber menos reproducciones registradas que las reales.</small></header>
      ${controls}<div class="analytics-cards">${card('Visitantes', summary.visitors, previous?.visitors)}${card('Vistas de proyectos', summary.projectViews, previous?.projectViews)}${card('Reproducciones', summary.plays, previous?.plays)}${card('Episodios completados', summary.completed, previous?.completed)}</div>
      ${admin ? `<div class="analytics-secondary"><span>Estudios con tráfico: <strong>${count(summary.activeStudios)}</strong></span><span>Proyectos con tráfico: <strong>${count(summary.activeProjects)}</strong></span></div>` : ''}
      ${projectId ? `<div class="analytics-secondary"><span>Tasa de finalización del proyecto: <strong>${projectCompletionRate}</strong></span></div>` : ''}
      <section class="analytics-section"><h2>Tráfico a lo largo del tiempo</h2><label class="analytics-series-label">Mostrar <select data-analytics-series><option value="views">Vistas</option><option value="visitors">Visitantes</option><option value="plays">Reproducciones</option></select></label><div data-analytics-chart>${chart(data.daily)}</div><p class="analytics-note">Datos diarios en UTC${period === 'all' ? ' (gráfica limitada a los 365 días con actividad más recientes)' : ''}. Una vista no equivale a reproducir.</p></section>
      <section class="analytics-section"><h2>${admin ? 'Proyectos' : 'Tus proyectos'}</h2>${table(['Proyecto','Visitantes','Vistas','Reproducciones','Completados','% finalización'], projectRows, 'Todavía no hay proyectos con estadísticas.')}</section>
      ${admin && !projectId ? `<section class="analytics-section"><h2>Proyectos más vistos</h2>${table(['Proyecto','Vistas','Reproducciones'], [...data.projects].sort((a,b) => b.views - a.views).slice(0, 10).map(item => `<tr><td>${esc(item.title)}</td><td>${count(item.views)}</td><td>${count(item.plays)}</td></tr>`).join(''), 'Sin vistas.')}</section>` : ''}
      ${admin && data.studios.length ? `<section class="analytics-section"><h2>Estudios con más tráfico</h2>${table(['Estudio','Visitantes','Vistas','Reproducciones','Completados'], data.studios.map(item => `<tr><td>${esc(item.name)}</td><td>${count(item.visitors)}</td><td>${count(item.views)}</td><td>${count(item.plays)}</td><td>${count(item.completed)}</td></tr>`).join(''), 'Sin tráfico.')}</section>` : ''}
      ${admin && !projectId ? `<section class="analytics-section"><h2>Episodios más vistos</h2>${table(['Episodio','Título','Vistas','Reproducciones'], [...data.episodes].sort((a,b) => b.views - a.views).slice(0, 10).map(item => `<tr><td>T${item.season} · Ep. ${item.number}</td><td>${esc(item.title)}</td><td>${count(item.views)}</td><td>${count(item.plays)}</td></tr>`).join(''), 'Sin vistas.')}</section><section class="analytics-section"><h2>Contenido con poco tráfico</h2>${table(['Proyecto','Vistas','Reproducciones'], [...data.projects].sort((a,b) => a.plays - b.plays || a.views - b.views).slice(0, 10).map(item => `<tr><td>${esc(item.title)}</td><td>${count(item.views)}</td><td>${count(item.plays)}</td></tr>`).join(''), 'Sin proyectos.')}</section>` : ''}
      ${projectId ? `<section class="analytics-section"><h2>${esc(selectedProject?.title || 'Proyecto')} · Rendimiento por episodio</h2>${table(['Episodio','Título','Vistas','Reproducciones','25%','50%','75%','Completado','% finalización'], episodeRows, 'Todavía no hay episodios con estadísticas.')}
        <p class="analytics-note">${rankedEpisodes.length ? `Más visto: ${esc(rankedEpisodes[0].title)}. Menos visto: ${esc(rankedEpisodes.at(-1).title)}. Interpreta los episodios recién publicados con cautela.` : 'Todavía no hay reproducciones para comparar episodios.'}</p></section>` : ''}
      ${summary.visitors === 0 ? '<p class="analytics-empty">Cuando los espectadores comiencen a visitar y reproducir tu contenido, aquí aparecerán tus estadísticas.</p>' : ''}</section>`;
  }
  global.DubverseAnalyticsDashboard = { render, chart };
})(window);
