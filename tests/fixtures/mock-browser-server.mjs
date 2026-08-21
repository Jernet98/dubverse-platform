import http from 'node:http';

const upstream = 'http://localhost:3000';
const projects = [
  { id: 'alpha', title: 'Alpha Romance', synopsis: 'Mechas en acción', type: 'SERIES', status: 'ONGOING', genres: ['Romance', 'Mecha', 'Acción'], poster: '', banner: '', published: true, featured: true, episodeCount: 1 },
  { id: 'beta', title: 'Beta Corazones', synopsis: 'Drama de robots', type: 'SERIES', status: 'UPCOMING', genres: ['Romance', 'Mecha'], poster: '', banner: '', published: true, featured: false, episodeCount: 0 },
  { id: 'gamma', title: 'Gamma Acción', synopsis: 'Batallas', type: 'MOVIE', status: 'FINISHED', genres: ['Acción'], poster: '', banner: '', published: true, featured: false, episodeCount: 0 },
  { id: 'delta', title: 'Delta Comedia', synopsis: 'Risas', type: 'SPECIAL', status: 'FINISHED', genres: ['Comedia'], poster: '', banner: '', published: true, featured: false, episodeCount: 0 }
];
const episode = { id: 'episode-alpha-1', project_id: 'alpha', season: 1, number: 1, title: 'El comienzo', description: 'Primer episodio', provider: 'DIRECT', video_url: 'http://127.0.0.1:3100/missing-video.mp4', playback: { provider: 'DIRECT', source: { kind: 'VIDEO', url: 'http://127.0.0.1:3100/missing-video.mp4' }, fallback: null }, project: { id: 'alpha', title: 'Alpha Romance', poster: '', banner: '' } };
const promos = [{ id: 'promo-1', projectId: 'alpha', type: 'TRAILER', provider: 'OTHER', title: 'Tráiler de Alpha', url: 'https://example.com/trailer', providerIdentifier: '', providerFile: '', thumbnailUrl: '/assets/projects/dandadan-season-2/banner.jpg', position: 0, isActive: true, playback: { kind: 'LINK', url: 'https://example.com/trailer' } }];
const project = { ...projects[0], projectDirector: 'Dirección segura', dubbingInfo: 'Información del fandoblaje', credits: 'Créditos', studios: [{ id: 'studio', name: 'Estudio Mock', logo: '', role: 'Fandoblaje' }], episodes: [episode], promos };
const upcomingProject = { ...projects[1], projectDirector: 'Dirección próxima', dubbingInfo: 'Proyecto anunciado', credits: 'Créditos próximos', studios: [{ id: 'studio', name: 'Estudio Mock', logo: '', role: 'Fandoblaje' }], episodes: [], promos };
const studios = [
  { id: 'studio', name: 'Estudio Mock', director: 'Directora', description: 'Descripción', logo: '', banner: '/assets/projects/dandadan-season-2/banner.jpg', isVerified: true, followerCount: 42, published: true, socials: { website: 'https://example.com', youtube: 'https://youtube.com', tiktok: 'https://tiktok.com' }, projects: [projects[0]] },
  { id: 'studio-dos', name: 'Voces del Norte', director: 'Equipo Norte', description: 'Fandoblaje comunitario', logo: '/assets/studios/essential-fandubs/logo.jpeg', published: true, socials: {}, projects: [projects[1]] }
];
const homeSections = [
  { id: '10000000-0000-4000-8000-000000000001', sectionKey: 'hero', sectionType: 'HERO', title: '', subtitle: '', enabled: true, position: 0, maxItems: 6, configuration: {}, persisted: true, isDefault: true, items: projects.slice(0, 3) },
  { id: '10000000-0000-4000-8000-000000000002', sectionKey: 'featured-projects', sectionType: 'FEATURED_PROJECTS', title: 'Proyectos destacados', subtitle: 'Elegidos por el equipo de Dubverse.', enabled: true, position: 10, maxItems: 6, configuration: { autoFill: true }, persisted: true, isDefault: true, href: '/catalogo', items: projects },
  { sectionType: 'BANNER', sectionKey: 'banner-demo', position: 25, banner: { id: '20000000-0000-4000-8000-000000000001', label: 'NOVEDAD', title: 'La comunidad crece contigo', description: 'Descubre proyectos, estudios y nuevas voces de fandoblaje.', imageUrl: '/assets/projects/dandadan-season-2/banner.jpg', linkUrl: '/estudios', buttonText: 'Conocer estudios', enabled: true, position: 25, startsAt: null, endsAt: null } },
  { sectionType: 'BANNER', sectionKey: 'banner-demo-2', position: 26, banner: { id: '20000000-0000-4000-8000-000000000002', label: 'ESTRENO', title: 'Una portada que se adapta', description: 'El carrusel usa una composición compacta en cualquier pantalla.', imageUrl: '/assets/projects/kowloon-generic-romance/banner.jpg', mobileImageUrl: '/assets/projects/kowloon-generic-romance/poster.jpg', linkUrl: '/proyecto/alpha', buttonText: 'Ver proyecto', enabled: true, position: 26, startsAt: null, endsAt: null } },
  { id: '10000000-0000-4000-8000-000000000003', sectionKey: 'ongoing', sectionType: 'AUTO_STATUS', title: 'En emisión', subtitle: 'Nuevos episodios en camino.', enabled: true, position: 30, maxItems: 8, configuration: { status: 'ONGOING' }, persisted: true, isDefault: true, href: '/catalogo?status=ONGOING', items: projects.filter(item => item.status === 'ONGOING') },
  { id: '10000000-0000-4000-8000-000000000004', sectionKey: 'featured-studios', sectionType: 'FEATURED_STUDIOS', title: 'Estudios destacados', subtitle: 'Conoce a quienes dan voz a estas historias.', enabled: true, position: 50, maxItems: 5, configuration: { autoFill: true }, persisted: true, isDefault: true, items: studios }
];
const siteSettings = { siteName: 'DUBVERSE', footerSlogan: 'Fandoblaje hecho por amor al arte.', description: 'Una plataforma para fans y estudios.', publicEmail: 'hola@example.com', copyrightText: '© 2026 Dubverse', socials: { youtube: 'https://youtube.com', discord: 'https://discord.com' } };
const profiles = {
  '1': { id: 'fan-id', username: 'fan', displayName: 'Fan Mock', avatar: '/assets/projects/anohana-the-flower-we-saw-that-day/poster.jpg', banner: '/assets/projects/dandadan-season-2/banner.jpg', bio: 'Perfil de prueba', joinedAt: '2026-08-09T00:00:00Z' },
  '2': { id: 'fan-2-id', username: 'fan2', displayName: 'Fan Dos', avatar: '/assets/studios/essential-fandubs/logo.jpeg', banner: '/assets/projects/kowloon-generic-romance/banner.jpg', bio: 'Segundo perfil de prueba', joinedAt: '2026-08-10T00:00:00Z' }
};
const watchedByViewer = new Map();
const historyByViewer = new Map();
const reviewsByViewer = new Map();
const commentsByViewer = new Map();
const commentLikesByViewer = new Map();
const followsByViewer = new Map();
const readNotificationsByViewer = new Map();
let activeViewerId = '';
const appliedSessionSeeds = new Set();

function sendJson(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function requestContext(request) {
  let pageUrl;
  try { pageUrl = new URL(String(request.headers.referer || ''), 'http://localhost:3100'); } catch { pageUrl = new URL('http://localhost:3100/'); }
  const requestedViewer = pageUrl.searchParams.get('viewer');
  const sessionSeed = requestedViewer === null ? '' : `${pageUrl.pathname}|${requestedViewer}|${pageUrl.searchParams.get('sessionSeed') || 'default'}`;
  if (sessionSeed && !appliedSessionSeeds.has(sessionSeed)) {
    activeViewerId = profiles[requestedViewer] ? requestedViewer : '';
    appliedSessionSeeds.add(sessionSeed);
  }
  const viewerId = activeViewerId;
  return { pageUrl, viewerId, profile: profiles[viewerId] || null };
}

function viewerSet(store, viewerId) {
  if (!store.has(viewerId)) store.set(viewerId, new Set());
  return store.get(viewerId);
}

function unreadNotificationCount(viewerId) {
  const read = viewerSet(readNotificationsByViewer, viewerId);
  if (read.has('all')) return 0;
  return 3 - ['93f3027e-0b65-4b23-a36b-1e98aa6f5e91', '93f3027e-0b65-4b23-a36b-1e98aa6f5e92', '93f3027e-0b65-4b23-a36b-1e98aa6f5e93'].filter(id => read.has(id)).length;
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

function mockReplies(profile) {
  return Array.from({ length: 7 }, (_, index) => {
    const author = index % 2 ? profiles['2'] : profiles['1'];
    return {
      id: `73f3027e-0b65-4b23-a36b-1e98aa6f5e${String(index).padStart(2, '0')}`,
      episodeId: episode.id,
      parentCommentId: '63f3027e-0b65-4b23-a36b-1e98aa6f5e90',
      body: `Respuesta de prueba ${index + 1}`,
      image: index <= 1 ? '/assets/projects/kowloon-generic-romance/banner.jpg' : '',
      createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      edited: false,
      own: Boolean(profile && profile.id === author.id),
      author,
      replyTo: index ? profiles[index % 2 ? '1' : '2'] : profiles['1'],
      likeCount: index,
      likedByViewer: false,
      replyCount: 0
    };
  });
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
  if (path === '/api/home') {
    const sections = homeSections;
    return sendJson(response, { site: siteSettings, sections, catalog: { projects, studios }, cmsAvailable: true, viewer: { authenticated } });
  }
  if (path === '/api/projects') return sendJson(response, projects);
  if (path === '/api/projects/alpha') return sendJson(response, project);
  if (path === '/api/projects/beta') return sendJson(response, upcomingProject);
  if (path === '/api/episodes/episode-alpha-1') return sendJson(response, episode);
  if (path === '/api/studios') return sendJson(response, studios);
  if (path === '/api/studios/studio') return sendJson(response, studios[0]);
  if (path === '/api/settings') return sendJson(response, {});
  if (path === '/api/auth/sign-out' && request.method === 'POST') {
    activeViewerId = '';
    return sendJson(response, { success: true });
  }
  if (path === '/api/social/config') return sendJson(response, { authAvailable: true, providers: ['google', 'discord'], mediaAvailable: true });
  if (path === '/api/social/session') return sendJson(response, { user: profile ? { ...profile, managedStudios: [{ id: 'studio', name: 'Estudio Mock', logo: '', isVerified: true, role: 'ADMIN' }] } : null });
  if (path === '/api/social/projects/alpha') {
    const review = viewerReview(profile);
    return sendJson(response, { likes: 2, reviewCount: 1, reviewAverage: review.rating, viewer: { authenticated, liked: authenticated, favorite: false, watchLater: authenticated }, watchedEpisodeIds: [...watched], reviews: { page: 1, hasMore: false, items: [{ id: '550e8400-e29b-41d4-a716-446655440000', projectId: 'alpha', rating: review.rating, body: review.body, createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-11T00:00:00Z', edited: authenticated, own: authenticated, author: profile || profiles['1'] }] } });
  }
  if (path === '/api/social/episodes/episode-alpha-1') {
    const comment = viewerComment(profile);
    const liked = authenticated && viewerSet(commentLikesByViewer, viewerId).has('63f3027e-0b65-4b23-a36b-1e98aa6f5e90');
    return sendJson(response, { likes: 3, viewer: { authenticated, liked: authenticated, watched: watched.has(episode.id) }, comments: { page: 1, hasMore: false, items: [{ id: '63f3027e-0b65-4b23-a36b-1e98aa6f5e90', episodeId: episode.id, body: comment.body, image: commentImage(pageUrl), createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-11T00:00:00Z', edited: authenticated, own: authenticated, author: profile || profiles['1'], replyCount: 7, likeCount: liked ? 3 : 2, likedByViewer: liked }] } });
  }
  if (path === '/api/social/episodes/episode-alpha-1/progress' && request.method === 'GET') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    return sendJson(response, { progress: { positionSeconds: 637, durationSeconds: 1440, updatedAt: '2026-08-17T20:00:00Z' } });
  }
  if (path === '/api/social/episodes/episode-alpha-1/progress' && request.method === 'PUT') return sendJson(response, { complete: false, watched: false });
  if (path === '/api/social/studios/studio') return sendJson(response, { followers: 42, viewer: { authenticated, following: authenticated } });
  if (path === '/api/social/studios/studio/follow' && ['POST', 'DELETE'].includes(request.method)) return sendJson(response, { following: request.method === 'POST', followers: request.method === 'POST' ? 43 : 42 });
  if (path === '/api/social/comments/63f3027e-0b65-4b23-a36b-1e98aa6f5e90/replies' && request.method === 'GET') {
    const page = Number(new URL(request.url, 'http://localhost:3100').searchParams.get('page') || 1);
    const replies = mockReplies(profile);
    const start = (page - 1) * 5;
    const target = new URL(request.url, 'http://localhost:3100').searchParams.get('target');
    const targetIndex = target ? replies.findIndex(item => item.id === target) : -1;
    const effectivePage = targetIndex >= 0 ? Math.floor(targetIndex / 5) + 1 : page;
    const effectiveStart = (effectivePage - 1) * 5;
    return sendJson(response, { rootId: '63f3027e-0b65-4b23-a36b-1e98aa6f5e90', replies: { page: effectivePage, hasMore: effectiveStart + 5 < replies.length, items: replies.slice(effectiveStart, effectiveStart + 5) } });
  }
  if (/^\/api\/social\/comments\/[0-9a-f-]+\/replies$/.test(path) && request.method === 'POST') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    const body = await requestJson(request);
    return sendJson(response, { replyCount: 8, reply: { ...mockReplies(profile)[0], id: '83f3027e-0b65-4b23-a36b-1e98aa6f5e99', body: String(body.body || ''), own: true, author: profile } }, 201);
  }
  if (/^\/api\/social\/comments\/[0-9a-f-]+\/like$/.test(path) && ['POST', 'DELETE'].includes(request.method)) {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    const commentId = path.split('/')[4];
    const likes = viewerSet(commentLikesByViewer, viewerId);
    if (request.method === 'POST') likes.add(commentId); else likes.delete(commentId);
    return sendJson(response, { commentId, liked: likes.has(commentId), likeCount: likes.has(commentId) ? 3 : 2 });
  }
  if (path === '/api/social/users/fan' || path === '/api/social/users/fan2') {
    const target = path.endsWith('fan2') ? profiles['2'] : profiles['1'];
    const followed = authenticated && viewerSet(followsByViewer, viewerId).has(target.username);
    return sendJson(response, { profile: target, social: { followers: followed ? 13 : 12, following: 4, viewerOwn: profile?.id === target.id, viewerFollowing: followed }, favorites: { page: 1, hasMore: false, items: [projects[0]] }, reviews: { page: 1, hasMore: false, items: [] } });
  }
  if (/^\/api\/social\/users\/(?:fan|fan2)\/(?:followers|following)$/.test(path)) return sendJson(response, { direction: path.endsWith('followers') ? 'followers' : 'following', profiles: { page: 1, hasMore: false, items: [profiles['2']] } });
  if (/^\/api\/social\/users\/(?:fan|fan2)\/follow$/.test(path) && ['POST', 'DELETE'].includes(request.method)) {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    const target = path.split('/')[4];
    const follows = viewerSet(followsByViewer, viewerId);
    if (request.method === 'POST') follows.add(target); else follows.delete(target);
    return sendJson(response, { following: follows.has(target), followers: follows.has(target) ? 13 : 12 });
  }
  if (path === '/api/social/me') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    const historyItems = historyByViewer.has(viewerId) ? [{ episode: { id: episode.id, title: episode.title, season: episode.season, number: episode.number }, project: { id: project.id, title: project.title, poster: project.poster }, firstViewedAt: '2026-08-12T00:00:00Z', lastViewedAt: '2026-08-12T00:00:00Z', viewCount: historyByViewer.get(viewerId) }] : [];
    return sendJson(response, { profile, social: { followers: 12, following: 4 }, favorites: { page: 1, hasMore: false, items: [projects[0]] }, watchLater: { page: 1, hasMore: false, items: [projects[0]] }, history: { page: 1, hasMore: false, items: historyItems } });
  }
  if (path === '/api/social/notifications/unread-count') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    return sendJson(response, { unreadCount: unreadNotificationCount(viewerId) });
  }
  if (path === '/api/social/notifications') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    const read = viewerSet(readNotificationsByViewer, viewerId);
    const items = [
      { id: '93f3027e-0b65-4b23-a36b-1e98aa6f5e91', type: 'FOLLOW', targetType: 'PROFILE', targetId: '00000000-0000-4000-8000-000000000002', episodeId: null, rootCommentId: null, createdAt: '2026-08-12T08:00:00Z', readAt: read.has('all') || read.has('93f3027e-0b65-4b23-a36b-1e98aa6f5e91') ? '2026-08-12T09:00:00Z' : null, commentKind: 'COMMENT', projectTitle: '', actor: profiles['2'] },
      { id: '93f3027e-0b65-4b23-a36b-1e98aa6f5e92', type: 'COMMENT_REPLY', targetType: 'COMMENT', targetId: '73f3027e-0b65-4b23-a36b-1e98aa6f5e01', episodeId: episode.id, rootCommentId: '63f3027e-0b65-4b23-a36b-1e98aa6f5e90', createdAt: '2026-08-12T07:00:00Z', readAt: read.has('all') || read.has('93f3027e-0b65-4b23-a36b-1e98aa6f5e92') ? '2026-08-12T09:00:00Z' : null, commentKind: 'COMMENT', projectTitle: project.title, actor: profiles['2'] },
      { id: '93f3027e-0b65-4b23-a36b-1e98aa6f5e93', type: 'COMMENT_LIKE', targetType: 'COMMENT', targetId: '63f3027e-0b65-4b23-a36b-1e98aa6f5e90', episodeId: episode.id, rootCommentId: '63f3027e-0b65-4b23-a36b-1e98aa6f5e90', createdAt: '2026-08-12T06:00:00Z', readAt: read.has('all') || read.has('93f3027e-0b65-4b23-a36b-1e98aa6f5e93') ? '2026-08-12T09:00:00Z' : null, commentKind: 'COMMENT', projectTitle: project.title, actor: profiles['2'] }
    ];
    return sendJson(response, { unreadCount: unreadNotificationCount(viewerId), notifications: { page: 1, hasMore: false, items } });
  }
  if (/^\/api\/social\/notifications\/[0-9a-f-]+$/.test(path) && request.method === 'PATCH') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    const notificationId = path.split('/').at(-1);
    viewerSet(readNotificationsByViewer, viewerId).add(notificationId);
    return sendJson(response, { id: notificationId, readAt: '2026-08-12T09:00:00Z', unreadCount: unreadNotificationCount(viewerId) });
  }
  if (path === '/api/social/notifications/read-all' && request.method === 'PATCH') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    viewerSet(readNotificationsByViewer, viewerId).add('all');
    return sendJson(response, { unreadCount: 0 });
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
  if (path === '/api/admin/studio-access' && request.method === 'GET') return sendJson(response, { studios: [{ id: 'studio', name: 'Estudio Mock', logo: '', isVerified: true }], memberships: [{ id: 'membership-1', role: 'ADMIN', studio_id: 'studio', studio_name: 'Estudio Mock', profile_id: profiles['1'].id, username: profiles['1'].username, display_name: profiles['1'].displayName }], users: new URL(request.url, 'http://localhost:3100').searchParams.get('query') ? [{ id: profiles['2'].id, username: profiles['2'].username, display_name: profiles['2'].displayName }] : [] });
  if (path === '/api/admin/studio-access' && request.method === 'POST') return sendJson(response, { ok: true, id: 'membership-2' }, 201);
  if (/^\/api\/admin\/studio-access\/.+/.test(path) && request.method === 'DELETE') return sendJson(response, { ok: true, revoked: true });
  if (path === '/api/admin/promos' && request.method === 'GET') return sendJson(response, { promos });
  if (path === '/api/admin/promos' && request.method === 'POST') return sendJson(response, { promo: promos[0] }, 201);
  if (/^\/api\/admin\/promos\/.+/.test(path) && ['PATCH', 'DELETE'].includes(request.method)) return sendJson(response, request.method === 'DELETE' ? { deleted: true } : { promo: promos[0] });
  if (path === '/api/studio-panel') {
    if (!authenticated) return sendJson(response, { error: 'Inicia sesión para continuar.' }, 401);
    return sendJson(response, { studios: [{ id: 'studio', name: 'Estudio Mock', logo: '', banner: studios[0].banner, isVerified: true, role: 'ADMIN' }] });
  }
  if (path === '/api/studio-panel/studio') return sendJson(response, { studio: studios[0], membership: { role: 'ADMIN' }, projects: [project], episodes: [{ ...episode, projectTitle: project.title, status: 'PUBLISHED', published: true }], promos });
  if (path === '/api/studio-panel/studios/studio/media' && request.method === 'POST') return sendJson(response, { image: { url: '/assets/dubverse-icon.png', width: 512, height: 512 } }, 201);
  if (path === '/api/studio-panel/studios/studio/media' && request.method === 'DELETE') return sendJson(response, { deleted: 1 });
  if (/^\/api\/studio-panel\/studios\/studio\/(?:projects|episodes)\/.+/.test(path) && request.method === 'PATCH') return sendJson(response, { ok: true });
  if (path === '/api/studio-panel/studios/studio' && request.method === 'PATCH') return sendJson(response, { ok: true });
  if (path === '/api/studio-panel/studios/studio/promos' && request.method === 'POST') return sendJson(response, { promo: promos[0] }, 201);
  if (/^\/api\/studio-panel\/studios\/studio\/promos\/.+/.test(path) && ['PATCH', 'DELETE'].includes(request.method)) return sendJson(response, request.method === 'DELETE' ? { deleted: true } : { ok: true });
  if (path === '/api/admin/projects') return sendJson(response, projects.map(item => ({ ...item, studios: [], episodeCount: item.episodeCount })));
  if (path === '/api/admin/episodes') return sendJson(response, [{ ...episode, project_title: project.title, status: 'PUBLISHED', published: true, updatedAt: '2026-08-09T00:00:00Z' }]);
  if (path === '/api/admin/studios') return sendJson(response, studios);
  if (path === '/api/admin/overview') return sendJson(response, { projects: 4, episodes: 1, studios: 0, processing: 0, trash: 0, providers: [] });
  if (path === '/api/admin/config') return sendJson(response, { database: false, authSecret: true, adminKey: true, blob: false });
  if (path === '/api/admin/home') return sendJson(response, {
    site: siteSettings,
    sections: homeSections.filter(item => item.sectionType !== 'BANNER').map(({ items, href, ...item }) => item),
    featuredProjects: [{ projectId: 'alpha', enabled: true, position: 0, project: projects[0] }],
    featuredStudios: [{ studioId: 'studio', enabled: true, position: 0, studio: studios[0] }],
    heroProjects: projects.slice(0, 3).map((item, index) => ({ projectId: item.id, enabled: true, position: index * 10, weight: index + 1, project: item })),
    curated: [],
    banners: [homeSections.find(item => item.sectionType === 'BANNER').banner]
  });
  if (path.startsWith('/api/admin/home/') && ['POST', 'PATCH', 'DELETE'].includes(request.method)) return sendJson(response, { ok: true, id: '30000000-0000-4000-8000-000000000001' }, request.method === 'POST' ? 201 : 200);
  if (path === '/api/admin/moderation/list') return sendJson(response, { reports: { page: 1, hasMore: false, items: [{ id: 'report', targetType: 'COMMENT', targetId: '73f3027e-0b65-4b23-a36b-1e98aa6f5e00', reason: 'SPAM', details: 'Contexto', status: 'OPEN', createdAt: '2026-08-09T00:00:00Z', reporter: { username: 'reporter', displayName: 'Reporter' }, author: { id: 'fan-id', username: 'fan', displayName: 'Fan Mock', status: 'ACTIVE' }, content: { kind: 'REPLY', body: 'Respuesta reportada', moderationStatus: 'VISIBLE', project: { id: 'alpha', title: 'Alpha Romance' }, episode: { id: episode.id, title: episode.title } } }] }, users: [{ id: 'fan-id', username: 'fan', displayName: 'Fan Mock', status: 'ACTIVE', comments: 1, reviews: 1 }] });
  return sendJson(response, { error: `Mock no definido: ${request.method} ${path}` }, 404);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost:3100');
  if (url.pathname.startsWith('/api/')) return await apiResponse(url.pathname, request, response);
  const sourcePath = ['/admin', '/panel-estudio'].includes(url.pathname) || url.pathname.startsWith('/_next/') || /\.(?:js|css|png|jpg|jpeg|webp|svg|ico|woff2?|mp4)$/.test(url.pathname) ? url.pathname : '/';
  const upstreamResponse = await fetch(`${upstream}${sourcePath}`);
  let body = Buffer.from(await upstreamResponse.arrayBuffer());
  if (sourcePath === '/') body = Buffer.from(body.toString('utf8').replace('</body>', '<script src="/player.js"></script><script src="/app.js"></script></body>'));
  if (sourcePath === '/admin') body = Buffer.from(body.toString('utf8').replace('</body>', '<script src="/admin.js"></script></body>'));
  if (sourcePath === '/panel-estudio') body = Buffer.from(body.toString('utf8').replace('</body>', '<script src="/studio-panel.js"></script></body>'));
  const headers = Object.fromEntries([...upstreamResponse.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())));
  response.writeHead(upstreamResponse.status, headers);
  response.end(body);
});

server.listen(3100, '127.0.0.1', () => console.log('Mock browser server: http://localhost:3100'));
