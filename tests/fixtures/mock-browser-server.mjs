import http from 'node:http';

const upstream = 'http://localhost:3000';
const projects = [
  { id: 'alpha', title: 'Alpha Romance', synopsis: 'Mechas en acción', type: 'SERIES', status: 'ONGOING', genres: ['Romance', 'Mecha', 'Acción'], poster: '', banner: '', published: true, featured: true, episodeCount: 1 },
  { id: 'beta', title: 'Beta Corazones', synopsis: 'Drama de robots', type: 'SERIES', status: 'ONGOING', genres: ['Romance', 'Mecha'], poster: '', banner: '', published: true, featured: false, episodeCount: 0 },
  { id: 'gamma', title: 'Gamma Acción', synopsis: 'Batallas', type: 'MOVIE', status: 'FINISHED', genres: ['Acción'], poster: '', banner: '', published: true, featured: false, episodeCount: 0 },
  { id: 'delta', title: 'Delta Comedia', synopsis: 'Risas', type: 'SPECIAL', status: 'FINISHED', genres: ['Comedia'], poster: '', banner: '', published: true, featured: false, episodeCount: 0 }
];
const episode = { id: 'episode-alpha-1', project_id: 'alpha', season: 1, number: 1, title: 'El comienzo', description: 'Primer episodio', provider: 'EXTERNAL', video_url: '', project: { id: 'alpha', title: 'Alpha Romance', poster: '', banner: '' } };
const project = { ...projects[0], projectDirector: 'Dirección segura', dubbingInfo: 'Información del fandoblaje', credits: 'Créditos', studios: [{ id: 'studio', name: 'Estudio Mock', logo: '', role: 'Fandoblaje' }], episodes: [episode] };
const profiles = {
  '1': { id: 'fan-id', username: 'fan', displayName: 'Fan Mock', avatar: '/assets/projects/anohana-the-flower-we-saw-that-day/poster.jpg', banner: '/assets/projects/dandadan-season-2/banner.jpg', bio: 'Perfil de prueba', joinedAt: '2026-08-09T00:00:00Z' },
  '2': { id: 'fan-2-id', username: 'fan2', displayName: 'Fan Dos', avatar: '/assets/studios/essential-fandubs/logo.jpeg', banner: '/assets/projects/kowloon-generic-romance/banner.jpg', bio: 'Segundo perfil de prueba', joinedAt: '2026-08-10T00:00:00Z' }
};
const watchedByViewer = new Map();
const historyByViewer = new Map();
const reviewsByViewer = new Map();
const commentsByViewer = new Map();

function sendJson(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function requestContext(request) {
  let pageUrl;
  try { pageUrl = new URL(String(request.headers.referer || ''), 'http://localhost:3100'); } catch { pageUrl = new URL('http://localhost:3100/'); }
  const viewerId = pageUrl.searchParams.get('viewer') || '';
  return { pageUrl, viewerId, profile: profiles[viewerId] || null };
}

function viewerSet(store, viewerId) {
  if (!store.has(viewerId)) store.set(viewerId, new Set());
  return store.get(viewerId);
}

function viewerReview(profile) {
  if (!profile) return { rating: 5, body: 'Gran proyecto' };
  if (!reviewsByViewer.has(profile.id)) reviewsByViewer.set(profile.id, { rating: 5, body: 'Gran proyecto' });
  return reviewsByViewer.get(profile.id);
}

function viewerComment(profile) {
  if (!profile) return { body: '<script>window.__xss=true</script>' };
  if (!commentsByViewer.has(profile.id)) commentsByViewer.set(profile.id, { body: '<script>window.__xss=true</script>' });
  return commentsByViewer.get(profile.id);
}

function commentImage(pageUrl) {
  return {
    vertical: '/assets/projects/dandadan-season-2/poster.jpeg',
    horizontal: '/assets/projects/dandadan-season-2/banner.jpg',
    small: '/assets/projects/under-the-dog/poster.jpg',
    large: '/assets/projects/kowloon-generic-romance/banner.jpg'
  }[pageUrl.searchParams.get('commentImage')] || '';
}

async function requestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function apiResponse(path, request, response) {
  const { pageUrl, viewerId, profile } = requestContext(request);
  const authenticated = Boolean(profile);
  const watched = authenticated ? viewerSet(watchedByViewer, viewerId) : new Set();
  if (path === '/api/projects') return sendJson(response, projects);
  if (path === '/api/projects/alpha') return sendJson(response, project);
  if (path === '/api/episodes/episode-alpha-1') return sendJson(response, episode);
  if (path === '/api/studios') return sendJson(response, [{ id: 'studio', name: 'Estudio Mock', director: 'Directora', description: 'Descripción', logo: '', socials: { website: 'https://example.com', youtube: 'https://youtube.com', tiktok: 'https://tiktok.com' }, projects: [projects[0]] }]);
  if (path === '/api/studios/studio') return sendJson(response, { id: 'studio', name: 'Estudio Mock', director: 'Directora', description: 'Descripción', logo: '', socials: { website: 'https://example.com', youtube: 'https://youtube.com', tiktok: 'https://tiktok.com' }, projects: [projects[0]] });
  if (path === '/api/settings') return sendJson(response, {});
  if (path === '/api/social/config') return sendJson(response, { authAvailable: true, providers: ['google', 'discord'], mediaAvailable: true });
  if (path === '/api/social/session') return sendJson(response, { user: profile });
  if (path === '/api/social/projects/alpha') {
    const review = viewerReview(profile);
    return sendJson(response, { likes: 2, reviewCount: 1, reviewAverage: review.rating, viewer: { authenticated, liked: authenticated, favorite: false, watchLater: authenticated }, watchedEpisodeIds: [...watched], reviews: { page: 1, hasMore: false, items: [{ id: '550e8400-e29b-41d4-a716-446655440000', projectId: 'alpha', rating: review.rating, body: review.body, createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-11T00:00:00Z', edited: authenticated, own: authenticated, author: profile || profiles['1'] }] } });
  }
  if (path === '/api/social/episodes/episode-alpha-1') {
    const comment = viewerComment(profile);
    return sendJson(response, { likes: 3, viewer: { authenticated, liked: authenticated, watched: watched.has(episode.id) }, comments: { page: 1, hasMore: false, items: [{ id: '63f3027e-0b65-4b23-a36b-1e98aa6f5e90', episodeId: episode.id, body: comment.body, image: commentImage(pageUrl), createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-11T00:00:00Z', edited: authenticated, own: authenticated, author: profile || profiles['1'] }] } });
  }
  if (path === '/api/social/users/fan') return sendJson(response, { profile: profiles['1'], favorites: { page: 1, hasMore: false, items: [projects[0]] }, reviews: { page: 1, hasMore: false, items: [] } });
  if (path === '/api/social/me') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    const historyItems = historyByViewer.has(viewerId) ? [{ episode: { id: episode.id, title: episode.title, season: episode.season, number: episode.number }, project: { id: project.id, title: project.title, poster: project.poster }, firstViewedAt: '2026-08-12T00:00:00Z', lastViewedAt: '2026-08-12T00:00:00Z', viewCount: historyByViewer.get(viewerId) }] : [];
    return sendJson(response, { profile, favorites: { page: 1, hasMore: false, items: [projects[0]] }, watchLater: { page: 1, hasMore: false, items: [projects[0]] }, history: { page: 1, hasMore: false, items: historyItems } });
  }
  if (path === '/api/social/episodes/episode-alpha-1/watched') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    if (request.method === 'POST') watched.add(episode.id);
    if (request.method === 'DELETE') watched.delete(episode.id);
    return sendJson(response, { watched: watched.has(episode.id) });
  }
  if (path === '/api/social/episodes/episode-alpha-1/view' && request.method === 'POST') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    historyByViewer.set(viewerId, (historyByViewer.get(viewerId) || 0) + 1);
    return sendJson(response, { historyRecorded: true });
  }
  if (path === '/api/social/reviews/550e8400-e29b-41d4-a716-446655440000' && request.method === 'PATCH') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    const body = await requestJson(request);
    reviewsByViewer.set(profile.id, { rating: Number(body.rating), body: String(body.body || '') });
    return sendJson(response, { review: { ...viewerReview(profile), own: true } });
  }
  if (path === '/api/social/comments/63f3027e-0b65-4b23-a36b-1e98aa6f5e90' && request.method === 'PATCH') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    const body = await requestJson(request);
    commentsByViewer.set(profile.id, { body: String(body.body || '') });
    return sendJson(response, { comment: { ...viewerComment(profile), own: true } });
  }
  if (/^\/api\/social\/(?:projects\/alpha\/(?:like|favorite|watch-later)|episodes\/episode-alpha-1\/like)$/.test(path) && ['POST', 'DELETE'].includes(request.method)) return sendJson(response, { active: request.method === 'POST' });
  if (path === '/api/admin/session') return sendJson(response, { authenticated: true });
  if (path === '/api/admin/projects') return sendJson(response, projects.map(item => ({ ...item, studios: [], episodeCount: item.episodeCount })));
  if (path === '/api/admin/episodes') return sendJson(response, [{ ...episode, project_title: project.title, status: 'PUBLISHED', published: true, updatedAt: '2026-08-09T00:00:00Z' }]);
  if (path === '/api/admin/studios') return sendJson(response, []);
  if (path === '/api/admin/overview') return sendJson(response, { projects: 4, episodes: 1, studios: 0, processing: 0, trash: 0, providers: [] });
  if (path === '/api/admin/config') return sendJson(response, { database: false, authSecret: true, adminKey: true, blob: false });
  if (path === '/api/admin/moderation/list') return sendJson(response, { reports: { page: 1, hasMore: false, items: [{ id: 'report', targetType: 'COMMENT', targetId: '63f3027e-0b65-4b23-a36b-1e98aa6f5e90', reason: 'SPAM', details: 'Contexto', status: 'OPEN', createdAt: '2026-08-09T00:00:00Z', reporter: { username: 'reporter', displayName: 'Reporter' }, author: { id: 'fan-id', username: 'fan', displayName: 'Fan Mock', status: 'ACTIVE' }, content: { body: 'Contenido reportado', moderationStatus: 'VISIBLE', project: { id: 'alpha', title: 'Alpha Romance' }, episode: { id: episode.id, title: episode.title } } }] }, users: [{ id: 'fan-id', username: 'fan', displayName: 'Fan Mock', status: 'ACTIVE', comments: 1, reviews: 1 }] });
  return sendJson(response, { error: `Mock no definido: ${request.method} ${path}` }, 404);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost:3100');
  if (url.pathname.startsWith('/api/')) return await apiResponse(url.pathname, request, response);
  const sourcePath = url.pathname === '/admin' || url.pathname.startsWith('/_next/') || /\.(?:js|css|png|jpg|jpeg|webp|svg|ico|woff2?)$/.test(url.pathname) ? url.pathname : '/';
  const upstreamResponse = await fetch(`${upstream}${sourcePath}`);
  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  const headers = Object.fromEntries([...upstreamResponse.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())));
  response.writeHead(upstreamResponse.status, headers);
  response.end(body);
});

server.listen(3100, '127.0.0.1', () => console.log('Mock browser server: http://localhost:3100'));
