import crypto from 'node:crypto';
import { AppError, getSql } from '@/lib/db';
import {
  assertSocialWriteOrigin,
  dateValue,
  enforceSocialRateLimit,
  jsonBody,
  mapSocialProfile,
  socialErrorResponse,
  socialSession
} from '@/lib/social';
import {
  bioValue,
  commentValue,
  displayNameValue,
  mediaRequestValue,
  pageValue,
  plainText,
  ratingValue,
  reportReasonValue,
  REPORT_DETAILS_MAX,
  reviewValue,
  usernameValue,
  uuidValue
} from '@/lib/social-validation';
import { configuredSocialProviders, userAuthStatus } from '@/lib/user-auth';
import {
  activeObjectKey,
  deleteR2Object,
  pendingObjectKey,
  presignedPutUrl,
  publicObjectUrl,
  r2Status,
  rejectPendingObject,
  validateAndProcessUpload
} from '@/lib/r2';
import { assertStudioIdentity, managedStudios } from '@/lib/studio-access';
import { normalizedProgress } from '@/lib/update2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const REVIEW_PAGE_SIZE = 10;
const REPLY_PAGE_SIZE = 5;
const NOTIFICATION_PAGE_SIZE = 15;

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function segments(context) {
  const params = await context.params;
  return Array.isArray(params.path) ? params.path : [];
}

function pageSlice(rows, page, pageSize) {
  return { items: rows.slice(0, pageSize), page, hasMore: rows.length > pageSize };
}

function mapProject(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    poster: row.poster || '',
    episodeCount: Number(row.episode_count || 0)
  };
}

function mapComment(row, viewerId = '') {
  const studioAuthor = row.author_studio_id ? {
    id: row.author_studio_id,
    studioId: row.author_studio_id,
    username: '',
    displayName: row.author_studio_name,
    avatar: row.author_studio_logo || '',
    isStudio: true,
    isVerified: Boolean(row.author_studio_verified)
  } : null;
  return {
    id: row.id,
    episodeId: row.episode_id,
    body: row.body,
    image: row.image_url || '',
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
    edited: String(row.updated_at) !== String(row.created_at),
    own: Boolean(viewerId && row.author_profile_id === viewerId),
    parentCommentId: row.parent_comment_id || null,
    replyCount: Number(row.reply_count || 0),
    likeCount: Number(row.like_count || 0),
    likedByViewer: Boolean(row.liked_by_viewer),
    replyTo: row.reply_to_studio_id ? {
      studioId: row.reply_to_studio_id,
      username: '',
      displayName: row.reply_to_studio_name,
      isStudio: true,
      isVerified: Boolean(row.reply_to_studio_verified)
    } : row.reply_to_profile_id ? {
      username: row.reply_to_username,
      displayName: row.reply_to_display_name,
      isStudio: false
    } : null,
    author: studioAuthor || (row.author_profile_id ? {
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar_url || row.provider_image || '',
      isStudio: false
    } : null)
  };
}

function mapProfileSummary(row) {
  return {
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar_url || row.provider_image || ''
  };
}

function mapNotification(row) {
  const studioActor = row.actor_studio_id ? {
    studioId: row.actor_studio_id,
    username: '', displayName: row.actor_studio_name, avatar: row.actor_studio_logo || '',
    isStudio: true, isVerified: Boolean(row.actor_studio_verified)
  } : null;
  return {
    id: row.id,
    type: row.type,
    targetType: row.target_type,
    targetId: row.target_type === 'COMMENT' ? row.target_id : null,
    episodeId: row.episode_id || null,
    projectId: row.project_id || null,
    studioId: row.studio_id || null,
    rootCommentId: row.root_comment_id || null,
    createdAt: dateValue(row.created_at),
    readAt: dateValue(row.read_at),
    commentKind: row.context_kind || 'COMMENT',
    projectTitle: row.project_title || '',
    actor: studioActor || (row.username ? { ...mapProfileSummary(row), isStudio: false } : null)
  };
}

function mapReview(row, viewerId = '') {
  return {
    id: row.id,
    projectId: row.project_id,
    project: row.project_title ? { id: row.project_id, title: row.project_title, poster: row.project_poster || '' } : undefined,
    rating: Number(row.rating),
    body: row.body,
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
    edited: String(row.updated_at) !== String(row.created_at),
    own: Boolean(viewerId && row.author_profile_id === viewerId),
    author: row.author_profile_id ? {
      username: row.username,
      displayName: row.display_name,
      avatar: row.avatar_url || row.provider_image || ''
    } : null
  };
}

function ownAuthorRow(content, profile) {
  return {
    ...content,
    username: profile.username,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    provider_image: profile.provider_image
  };
}

function commentAuthorRow(content, profile, studio = null) {
  return {
    ...ownAuthorRow(content, profile),
    author_studio_id: studio?.id || null,
    author_studio_name: studio?.name || null,
    author_studio_logo: studio?.logo || null,
    author_studio_verified: studio?.is_verified || false
  };
}

async function requireProject(sql, id) {
  const rows = await sql`SELECT id FROM projects WHERE id = ${id} AND published = true AND deleted_at IS NULL`;
  if (!rows.length) throw new AppError(404, 'Proyecto no encontrado.');
}

async function requireEpisode(sql, id) {
  const rows = await sql`
    SELECT e.id, e.project_id FROM episodes e
    JOIN projects p ON p.id = e.project_id
    WHERE e.id = ${id} AND e.published = true AND e.deleted_at IS NULL
      AND p.published = true AND p.deleted_at IS NULL
  `;
  if (!rows.length) throw new AppError(404, 'Episodio no encontrado.');
  return rows[0];
}

async function requirePublicComment(sql, id) {
  const commentId = uuidValue(id, 'El comentario');
  const rows = await sql`
    SELECT c.id, c.episode_id, c.parent_comment_id, c.author_profile_id,
      c.author_studio_id, up.username, up.display_name,
      author_studio.name AS author_studio_name, author_studio.logo AS author_studio_logo,
      author_studio.is_verified AS author_studio_verified
    FROM episode_comments c
    JOIN episodes e ON e.id = c.episode_id
    JOIN projects p ON p.id = e.project_id
    LEFT JOIN user_profiles up ON up.id = c.author_profile_id
    LEFT JOIN studios author_studio ON author_studio.id = c.author_studio_id
    WHERE c.id = ${commentId}::uuid
      AND c.moderation_status = 'VISIBLE' AND c.deleted_at IS NULL
      AND e.published = true AND e.deleted_at IS NULL
      AND p.published = true AND p.deleted_at IS NULL
  `;
  if (!rows.length) throw new AppError(404, 'Comentario no encontrado.');
  return rows[0];
}

async function optionalSession(request) {
  return socialSession(request).catch(error => {
    if (error?.status === 401) return null;
    throw error;
  });
}

async function publicProfile(request, sql, username, page) {
  const profiles = await sql`
    SELECT p.*, au.image AS provider_image, avatar.public_url AS avatar_url, banner.public_url AS banner_url
    FROM user_profiles p
    JOIN auth_users au ON au.id = p.auth_user_id
    LEFT JOIN user_media_uploads avatar ON avatar.id = p.avatar_media_id AND avatar.status = 'ACTIVE'
    LEFT JOIN user_media_uploads banner ON banner.id = p.banner_media_id AND banner.status = 'ACTIVE'
    WHERE lower(p.username) = lower(${username})
  `;
  if (!profiles.length) throw new AppError(404, 'Perfil no encontrado.');
  const viewer = await optionalSession(request);
  const viewerId = viewer?.row.id || null;
  const offset = (page - 1) * PAGE_SIZE;
  const [favorites, reviews, counts, followState] = await sql.transaction([
    sql`SELECT p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count
        FROM favorites f JOIN projects p ON p.id = f.project_id
        LEFT JOIN episodes e ON e.project_id = p.id
        WHERE f.user_profile_id = ${profiles[0].id} AND p.published = true AND p.deleted_at IS NULL
        GROUP BY p.id, f.created_at ORDER BY f.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    sql`SELECT r.*, p.title AS project_title, p.poster AS project_poster,
          up.username, up.display_name, au.image AS provider_image, avatar.public_url AS avatar_url
        FROM project_reviews r JOIN projects p ON p.id = r.project_id
        LEFT JOIN user_profiles up ON up.id = r.author_profile_id
        LEFT JOIN auth_users au ON au.id = up.auth_user_id
        LEFT JOIN user_media_uploads avatar ON avatar.id = up.avatar_media_id AND avatar.status = 'ACTIVE'
        WHERE r.author_profile_id = ${profiles[0].id} AND r.moderation_status = 'VISIBLE'
          AND r.deleted_at IS NULL AND p.published = true AND p.deleted_at IS NULL
        ORDER BY r.updated_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    sql`SELECT
          (SELECT COUNT(*) FROM user_follows WHERE followed_profile_id = ${profiles[0].id})::int AS followers,
          (SELECT COUNT(*) FROM user_follows WHERE follower_profile_id = ${profiles[0].id})::int AS following`,
    viewerId ? sql`SELECT EXISTS(
          SELECT 1 FROM user_follows WHERE follower_profile_id = ${viewerId} AND followed_profile_id = ${profiles[0].id}
        ) AS following` : sql`SELECT false AS following`
  ]);
  return {
    profile: mapSocialProfile(profiles[0]),
    social: {
      followers: Number(counts[0].followers),
      following: Number(counts[0].following),
      viewerOwn: viewerId === profiles[0].id,
      viewerFollowing: Boolean(followState[0].following)
    },
    favorites: pageSlice(favorites.map(mapProject), page, PAGE_SIZE),
    reviews: pageSlice(reviews.map(row => mapReview(row)), page, PAGE_SIZE)
  };
}

async function profileConnections(request, sql, username, direction, page) {
  const profiles = await sql`SELECT id FROM user_profiles WHERE lower(username) = lower(${username})`;
  if (!profiles.length) throw new AppError(404, 'Perfil no encontrado.');
  const offset = (page - 1) * PAGE_SIZE;
  let rows;
  if (direction === 'followers') {
    rows = await sql`
      SELECT p.username, p.display_name, au.image AS provider_image, avatar.public_url AS avatar_url
      FROM user_follows f JOIN user_profiles p ON p.id = f.follower_profile_id
      JOIN auth_users au ON au.id = p.auth_user_id
      LEFT JOIN user_media_uploads avatar ON avatar.id = p.avatar_media_id AND avatar.status = 'ACTIVE'
      WHERE f.followed_profile_id = ${profiles[0].id}
      ORDER BY f.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
    `;
  } else {
    rows = await sql`
      SELECT p.username, p.display_name, au.image AS provider_image, avatar.public_url AS avatar_url
      FROM user_follows f JOIN user_profiles p ON p.id = f.followed_profile_id
      JOIN auth_users au ON au.id = p.auth_user_id
      LEFT JOIN user_media_uploads avatar ON avatar.id = p.avatar_media_id AND avatar.status = 'ACTIVE'
      WHERE f.follower_profile_id = ${profiles[0].id}
      ORDER BY f.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
    `;
  }
  return { profiles: pageSlice(rows.map(mapProfileSummary), page, PAGE_SIZE), direction };
}

async function privateProfile(session, page) {
  const { sql, row } = session;
  const offset = (page - 1) * PAGE_SIZE;
  const [favorites, watchLater, history, counts] = await sql.transaction([
    sql`SELECT p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count
        FROM favorites f JOIN projects p ON p.id = f.project_id LEFT JOIN episodes e ON e.project_id = p.id
        WHERE f.user_profile_id = ${row.id} AND p.published = true AND p.deleted_at IS NULL
        GROUP BY p.id, f.created_at ORDER BY f.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    sql`SELECT p.*, COUNT(e.id) FILTER (WHERE e.published = true AND e.deleted_at IS NULL) AS episode_count
        FROM watch_later w JOIN projects p ON p.id = w.project_id LEFT JOIN episodes e ON e.project_id = p.id
        WHERE w.user_profile_id = ${row.id} AND p.published = true AND p.deleted_at IS NULL
        GROUP BY p.id, w.created_at ORDER BY w.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    sql`SELECT h.first_viewed_at, h.last_viewed_at, h.view_count,
          e.id AS episode_id, e.title AS episode_title, e.season, e.number,
          p.id AS project_id, p.title AS project_title, p.poster AS project_poster
        FROM episode_history h JOIN episodes e ON e.id = h.episode_id JOIN projects p ON p.id = e.project_id
        WHERE h.user_profile_id = ${row.id} AND e.published = true AND e.deleted_at IS NULL
          AND p.published = true AND p.deleted_at IS NULL
        ORDER BY h.last_viewed_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    sql`SELECT
          (SELECT COUNT(*) FROM user_follows WHERE followed_profile_id = ${row.id})::int AS followers,
          (SELECT COUNT(*) FROM user_follows WHERE follower_profile_id = ${row.id})::int AS following`
  ]);
  return {
    profile: mapSocialProfile(row),
    social: { followers: Number(counts[0].followers), following: Number(counts[0].following) },
    favorites: pageSlice(favorites.map(mapProject), page, PAGE_SIZE),
    watchLater: pageSlice(watchLater.map(mapProject), page, PAGE_SIZE),
    history: pageSlice(history.map(item => ({
      episode: { id: item.episode_id, title: item.episode_title, season: item.season, number: item.number },
      project: { id: item.project_id, title: item.project_title, poster: item.project_poster || '' },
      firstViewedAt: dateValue(item.first_viewed_at), lastViewedAt: dateValue(item.last_viewed_at), viewCount: Number(item.view_count)
    })), page, PAGE_SIZE)
  };
}

async function projectSocial(request, sql, projectId, page) {
  await requireProject(sql, projectId);
  const viewer = await optionalSession(request);
  const offset = (page - 1) * REVIEW_PAGE_SIZE;
  const viewerId = viewer?.row.id || null;
  const [stats, reviews, flags, watched] = await sql.transaction([
    sql`SELECT (SELECT COUNT(*) FROM project_likes WHERE project_id = ${projectId})::int AS likes,
          COUNT(*)::int AS review_count, COALESCE(AVG(rating), 0)::numeric(3,2) AS review_average
        FROM project_reviews WHERE project_id = ${projectId} AND moderation_status = 'VISIBLE' AND deleted_at IS NULL`,
    sql`SELECT r.*, up.username, up.display_name, au.image AS provider_image, avatar.public_url AS avatar_url
        FROM project_reviews r LEFT JOIN user_profiles up ON up.id = r.author_profile_id
        LEFT JOIN auth_users au ON au.id = up.auth_user_id
        LEFT JOIN user_media_uploads avatar ON avatar.id = up.avatar_media_id AND avatar.status = 'ACTIVE'
        WHERE r.project_id = ${projectId} AND r.moderation_status = 'VISIBLE' AND r.deleted_at IS NULL
        ORDER BY r.updated_at DESC LIMIT ${REVIEW_PAGE_SIZE + 1} OFFSET ${offset}`,
    viewerId ? sql`SELECT
          EXISTS(SELECT 1 FROM project_likes WHERE user_profile_id = ${viewerId} AND project_id = ${projectId}) AS liked,
          EXISTS(SELECT 1 FROM favorites WHERE user_profile_id = ${viewerId} AND project_id = ${projectId}) AS favorite,
          EXISTS(SELECT 1 FROM watch_later WHERE user_profile_id = ${viewerId} AND project_id = ${projectId}) AS watch_later` :
      sql`SELECT false AS liked, false AS favorite, false AS watch_later`,
    viewerId ? sql`SELECT w.episode_id FROM episode_watched w JOIN episodes e ON e.id = w.episode_id
        WHERE w.user_profile_id = ${viewerId} AND e.project_id = ${projectId}` : sql`SELECT NULL::text AS episode_id WHERE false`
  ]);
  return {
    likes: Number(stats[0].likes), reviewCount: Number(stats[0].review_count), reviewAverage: Number(stats[0].review_average),
    viewer: { authenticated: Boolean(viewer), liked: flags[0].liked, favorite: flags[0].favorite, watchLater: flags[0].watch_later },
    watchedEpisodeIds: watched.map(item => item.episode_id),
    reviews: pageSlice(reviews.map(row => mapReview(row, viewerId)), page, REVIEW_PAGE_SIZE)
  };
}

async function episodeSocial(request, sql, episodeId, page) {
  await requireEpisode(sql, episodeId);
  const viewer = await optionalSession(request);
  const viewerId = viewer?.row.id || null;
  const offset = (page - 1) * PAGE_SIZE;
  const [likes, comments, flags] = await sql.transaction([
    sql`SELECT COUNT(*)::int AS count FROM episode_likes WHERE episode_id = ${episodeId}`,
    sql`SELECT c.*, up.username, up.display_name, au.image AS provider_image,
          avatar.public_url AS avatar_url, image.public_url AS image_url,
          author_studio.name AS author_studio_name, author_studio.logo AS author_studio_logo,
          author_studio.is_verified AS author_studio_verified,
          (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id)::int AS like_count,
          EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_profile_id = ${viewerId}) AS liked_by_viewer,
          (SELECT COUNT(*) FROM episode_comments reply
            WHERE reply.parent_comment_id = c.id AND reply.moderation_status = 'VISIBLE' AND reply.deleted_at IS NULL)::int AS reply_count
        FROM episode_comments c LEFT JOIN user_profiles up ON up.id = c.author_profile_id
        LEFT JOIN auth_users au ON au.id = up.auth_user_id
        LEFT JOIN user_media_uploads avatar ON avatar.id = up.avatar_media_id AND avatar.status = 'ACTIVE'
        LEFT JOIN user_media_uploads image ON image.id = c.image_media_id AND image.status = 'ACTIVE'
        LEFT JOIN studios author_studio ON author_studio.id = c.author_studio_id
        WHERE c.episode_id = ${episodeId} AND c.parent_comment_id IS NULL
          AND c.moderation_status = 'VISIBLE' AND c.deleted_at IS NULL
        ORDER BY c.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    viewerId ? sql`SELECT
          EXISTS(SELECT 1 FROM episode_likes WHERE user_profile_id = ${viewerId} AND episode_id = ${episodeId}) AS liked,
          EXISTS(SELECT 1 FROM episode_watched WHERE user_profile_id = ${viewerId} AND episode_id = ${episodeId}) AS watched` :
      sql`SELECT false AS liked, false AS watched`
  ]);
  return {
    likes: Number(likes[0].count), viewer: { authenticated: Boolean(viewer), liked: flags[0].liked, watched: flags[0].watched },
    comments: pageSlice(comments.map(row => mapComment(row, viewerId)), page, PAGE_SIZE)
  };
}

async function commentReplies(request, sql, rootId, page) {
  const root = await requirePublicComment(sql, rootId);
  if (root.parent_comment_id) throw new AppError(400, 'Las respuestas se cargan desde el comentario principal.');
  const viewer = await optionalSession(request);
  const viewerId = viewer?.row.id || null;
  const targetValue = request.nextUrl.searchParams.get('target');
  if (targetValue) {
    const targetId = uuidValue(targetValue, 'La respuesta');
    const positions = await sql`
      SELECT COUNT(*)::int AS position
      FROM episode_comments earlier
      JOIN episode_comments target ON target.id = ${targetId}::uuid
      WHERE target.parent_comment_id = ${root.id}::uuid
        AND earlier.parent_comment_id = target.parent_comment_id
        AND earlier.moderation_status = 'VISIBLE' AND earlier.deleted_at IS NULL
        AND (earlier.created_at < target.created_at OR (earlier.created_at = target.created_at AND earlier.id <= target.id))
    `;
    if (!Number(positions[0].position)) throw new AppError(404, 'Respuesta no encontrada.');
    page = Math.ceil(Number(positions[0].position) / REPLY_PAGE_SIZE);
  }
  const offset = (page - 1) * REPLY_PAGE_SIZE;
  const rows = await sql`
    SELECT c.*, up.username, up.display_name, au.image AS provider_image,
      avatar.public_url AS avatar_url, image.public_url AS image_url,
      reply_to.username AS reply_to_username, reply_to.display_name AS reply_to_display_name,
      author_studio.name AS author_studio_name, author_studio.logo AS author_studio_logo,
      author_studio.is_verified AS author_studio_verified,
      reply_to_studio.name AS reply_to_studio_name, reply_to_studio.is_verified AS reply_to_studio_verified,
      (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id)::int AS like_count,
      EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_profile_id = ${viewerId}) AS liked_by_viewer
    FROM episode_comments c
    LEFT JOIN user_profiles up ON up.id = c.author_profile_id
    LEFT JOIN auth_users au ON au.id = up.auth_user_id
    LEFT JOIN user_media_uploads avatar ON avatar.id = up.avatar_media_id AND avatar.status = 'ACTIVE'
    LEFT JOIN user_media_uploads image ON image.id = c.image_media_id AND image.status = 'ACTIVE'
    LEFT JOIN user_profiles reply_to ON reply_to.id = c.reply_to_profile_id
    LEFT JOIN studios author_studio ON author_studio.id = c.author_studio_id
    LEFT JOIN studios reply_to_studio ON reply_to_studio.id = c.reply_to_studio_id
    WHERE c.parent_comment_id = ${root.id}::uuid
      AND c.episode_id = ${root.episode_id}
      AND c.moderation_status = 'VISIBLE' AND c.deleted_at IS NULL
    ORDER BY c.created_at ASC LIMIT ${REPLY_PAGE_SIZE + 1} OFFSET ${offset}
  `;
  return { rootId: root.id, replies: pageSlice(rows.map(row => mapComment(row, viewerId)), page, REPLY_PAGE_SIZE) };
}

async function writeMembership(request, path, present) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const { sql, row } = session;
  const [resource, id, action] = path;
  const table = action === 'like' ? (resource === 'projects' ? 'project_likes' : 'episode_likes')
    : action === 'favorite' ? 'favorites' : action === 'watch-later' ? 'watch_later' : '';
  if (!table || !['projects', 'episodes'].includes(resource)) throw new AppError(404, 'Ruta social no encontrada.');
  if (action !== 'like' && resource !== 'projects') throw new AppError(404, 'Ruta social no encontrada.');
  if (resource === 'projects') await requireProject(sql, id); else await requireEpisode(sql, id);
  await enforceSocialRateLimit(sql, row.id, 'membership', 80, 60);
  if (table === 'project_likes') {
    if (present) await sql`INSERT INTO project_likes (user_profile_id, project_id) VALUES (${row.id}, ${id}) ON CONFLICT DO NOTHING`;
    else await sql`DELETE FROM project_likes WHERE user_profile_id = ${row.id} AND project_id = ${id}`;
  } else if (table === 'episode_likes') {
    if (present) await sql`INSERT INTO episode_likes (user_profile_id, episode_id) VALUES (${row.id}, ${id}) ON CONFLICT DO NOTHING`;
    else await sql`DELETE FROM episode_likes WHERE user_profile_id = ${row.id} AND episode_id = ${id}`;
  } else if (table === 'favorites') {
    if (present) await sql`INSERT INTO favorites (user_profile_id, project_id) VALUES (${row.id}, ${id}) ON CONFLICT DO NOTHING`;
    else await sql`DELETE FROM favorites WHERE user_profile_id = ${row.id} AND project_id = ${id}`;
  } else {
    if (present) await sql`INSERT INTO watch_later (user_profile_id, project_id) VALUES (${row.id}, ${id}) ON CONFLICT DO NOTHING`;
    else await sql`DELETE FROM watch_later WHERE user_profile_id = ${row.id} AND project_id = ${id}`;
  }
  return json({ active: present });
}

async function writeWatched(request, episodeId, present) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const episode = await requireEpisode(session.sql, episodeId);
  await enforceSocialRateLimit(session.sql, session.row.id, 'episode-watched', 80, 60);
  if (present) {
    await session.sql`
      INSERT INTO episode_watched (user_profile_id, episode_id)
      VALUES (${session.row.id}, ${episode.id}) ON CONFLICT DO NOTHING
    `;
  } else {
    await session.sql`
      DELETE FROM episode_watched WHERE user_profile_id = ${session.row.id} AND episode_id = ${episode.id}
    `;
  }
  return json({ watched: present });
}

async function createComment(request, episodeId) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const episode = await requireEpisode(session.sql, episodeId);
  const body = await jsonBody(request);
  const authorStudio = await assertStudioIdentity(session.sql, session.row.id, String(body['authorStudioId'] || '').trim() || null);
  await enforceSocialRateLimit(session.sql, session.row.id, 'comment', 5, 60);
  const rows = await session.sql`
    INSERT INTO episode_comments (id, episode_id, author_profile_id, author_studio_id, body)
    VALUES (${crypto.randomUUID()}::uuid, ${episode.id}, ${session.row.id}, ${authorStudio?.id || null}, ${commentValue(body.body)}) RETURNING *
  `;
  return json({ comment: mapComment(commentAuthorRow(rows[0], session.row, authorStudio), session.row.id) }, 201);
}

async function createReply(request, targetId) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const target = await requirePublicComment(session.sql, targetId);
  const rootId = target.parent_comment_id || target.id;
  const roots = await session.sql`
    SELECT id FROM episode_comments
    WHERE id = ${rootId}::uuid AND episode_id = ${target.episode_id}
      AND parent_comment_id IS NULL AND moderation_status = 'VISIBLE' AND deleted_at IS NULL
  `;
  if (!roots.length) throw new AppError(409, 'El comentario principal ya no está disponible.');
  const body = await jsonBody(request);
  const authorStudio = await assertStudioIdentity(session.sql, session.row.id, String(body['authorStudioId'] || '').trim() || null);
  await enforceSocialRateLimit(session.sql, session.row.id, 'comment-reply', 10, 60);
  let rows = await session.sql`
    WITH created AS (
      INSERT INTO episode_comments (id, episode_id, author_profile_id, body, parent_comment_id, reply_to_profile_id)
      VALUES (${crypto.randomUUID()}::uuid, ${target.episode_id}, ${session.row.id}, ${commentValue(body.body)},
        ${rootId}::uuid, ${target.author_profile_id || null}::uuid)
      RETURNING *
    ), notified AS (
      INSERT INTO social_notifications (
        id, recipient_profile_id, actor_profile_id, actor_studio_id, type, target_type, target_id, context_kind, root_comment_id, episode_id, dedupe_key
      )
      SELECT ${crypto.randomUUID()}::uuid, ${target.author_profile_id || null}::uuid, ${session.row.id}, ${authorStudio?.id || null},
        'COMMENT_REPLY', 'COMMENT', created.id,
        ${target.parent_comment_id ? 'REPLY' : 'COMMENT'}, ${rootId}::uuid, created.episode_id, 'reply:' || created.id::text
      FROM created
      WHERE ${target.author_profile_id || null}::uuid IS NOT NULL
        AND ${target.author_profile_id || null}::uuid <> ${session.row.id}
      ON CONFLICT (dedupe_key) DO NOTHING
    )
    SELECT * FROM created
  `;
  if (authorStudio || target.author_studio_id) {
    rows = await session.sql`
      UPDATE episode_comments
      SET author_studio_id = ${authorStudio?.id || null}, reply_to_studio_id = ${target.author_studio_id || null}
      WHERE id = ${rows[0].id}::uuid
      RETURNING *
    `;
  }
  const counts = await session.sql`
    SELECT COUNT(*)::int AS count FROM episode_comments
    WHERE parent_comment_id = ${rootId}::uuid AND moderation_status = 'VISIBLE' AND deleted_at IS NULL
  `;
  const reply = commentAuthorRow({
    ...rows[0],
    reply_to_username: target.username,
    reply_to_display_name: target.display_name,
    reply_to_studio_id: target.author_studio_id || null,
    reply_to_studio_name: target.author_studio_name || null,
    reply_to_studio_verified: target.author_studio_verified || false,
    like_count: 0,
    liked_by_viewer: false
  }, session.row, authorStudio);
  return json({ reply: mapComment(reply, session.row.id), replyCount: Number(counts[0].count) }, 201);
}

async function writeCommentLike(request, id, present) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const comment = await requirePublicComment(session.sql, id);
  await enforceSocialRateLimit(session.sql, session.row.id, 'comment-like', 120, 60);
  if (present) {
    await session.sql`
      WITH liked AS (
        INSERT INTO comment_likes (user_profile_id, comment_id)
        VALUES (${session.row.id}, ${comment.id}::uuid)
        ON CONFLICT DO NOTHING RETURNING comment_id
      )
      INSERT INTO social_notifications (
        id, recipient_profile_id, actor_profile_id, type, target_type, target_id, context_kind, root_comment_id, episode_id, dedupe_key
      )
      SELECT ${crypto.randomUUID()}::uuid, ${comment.author_profile_id || null}::uuid, ${session.row.id},
        'COMMENT_LIKE', 'COMMENT', liked.comment_id,
        ${comment.parent_comment_id ? 'REPLY' : 'COMMENT'}, ${comment.parent_comment_id || comment.id}::uuid, ${comment.episode_id},
        'like:' || ${session.row.id}::text || ':' || liked.comment_id::text
      FROM liked
      WHERE ${comment.author_profile_id || null}::uuid IS NOT NULL
        AND ${comment.author_profile_id || null}::uuid <> ${session.row.id}
      ON CONFLICT (dedupe_key) DO NOTHING
    `;
  } else {
    await session.sql`
      DELETE FROM comment_likes WHERE user_profile_id = ${session.row.id} AND comment_id = ${comment.id}::uuid
    `;
  }
  const rows = await session.sql`
    SELECT COUNT(*)::int AS count,
      EXISTS(SELECT 1 FROM comment_likes WHERE user_profile_id = ${session.row.id} AND comment_id = ${comment.id}::uuid) AS liked
    FROM comment_likes WHERE comment_id = ${comment.id}::uuid
  `;
  return json({ commentId: comment.id, liked: rows[0].liked, likeCount: Number(rows[0].count) });
}

async function writeFollow(request, username, present) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const targets = await session.sql`
    SELECT id, username FROM user_profiles WHERE lower(username) = lower(${usernameValue(username)})
  `;
  if (!targets.length) throw new AppError(404, 'Perfil no encontrado.');
  const target = targets[0];
  if (target.id === session.row.id) throw new AppError(400, 'No puedes seguirte a ti mismo.');
  await enforceSocialRateLimit(session.sql, session.row.id, 'follow', 40, 3600);
  if (present) {
    await session.sql`
      WITH followed AS (
        INSERT INTO user_follows (follower_profile_id, followed_profile_id)
        VALUES (${session.row.id}, ${target.id})
        ON CONFLICT DO NOTHING RETURNING followed_profile_id
      )
      INSERT INTO social_notifications (
        id, recipient_profile_id, actor_profile_id, type, target_type, target_id, dedupe_key
      )
      SELECT ${crypto.randomUUID()}::uuid, followed_profile_id, ${session.row.id},
        'FOLLOW', 'PROFILE', followed_profile_id, 'follow:' || ${session.row.id}::text || ':' || followed_profile_id::text
      FROM followed ON CONFLICT (dedupe_key) DO NOTHING
    `;
  } else {
    await session.sql`
      DELETE FROM user_follows WHERE follower_profile_id = ${session.row.id} AND followed_profile_id = ${target.id}
    `;
  }
  const rows = await session.sql`
    SELECT EXISTS(SELECT 1 FROM user_follows WHERE follower_profile_id = ${session.row.id} AND followed_profile_id = ${target.id}) AS following,
      (SELECT COUNT(*) FROM user_follows WHERE followed_profile_id = ${target.id})::int AS followers
  `;
  return json({ following: rows[0].following, followers: Number(rows[0].followers) });
}

async function studioSocial(request, sql, studioId) {
  const studios = await sql`SELECT id FROM studios WHERE id = ${studioId} AND published = true AND deleted_at IS NULL`;
  if (!studios.length) throw new AppError(404, 'Estudio no encontrado.');
  const viewer = await optionalSession(request);
  const rows = viewer ? await sql`SELECT COUNT(*)::int AS followers,
      EXISTS(SELECT 1 FROM studio_follows WHERE user_profile_id = ${viewer.row.id} AND studio_id = ${studioId}) AS following
      FROM studio_follows WHERE studio_id = ${studioId}`
    : await sql`SELECT COUNT(*)::int AS followers, false AS following FROM studio_follows WHERE studio_id = ${studioId}`;
  return { followers: Number(rows[0].followers), viewer: { authenticated: Boolean(viewer), following: Boolean(rows[0].following) } };
}

async function writeStudioFollow(request, studioId, present) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const studios = await session.sql`SELECT id FROM studios WHERE id = ${studioId} AND published = true AND deleted_at IS NULL`;
  if (!studios.length) throw new AppError(404, 'Estudio no encontrado.');
  await enforceSocialRateLimit(session.sql, session.row.id, 'studio-follow', 40, 3600);
  if (present) await session.sql`INSERT INTO studio_follows (user_profile_id, studio_id) VALUES (${session.row.id}, ${studioId}) ON CONFLICT DO NOTHING`;
  else await session.sql`DELETE FROM studio_follows WHERE user_profile_id = ${session.row.id} AND studio_id = ${studioId}`;
  const rows = await session.sql`SELECT COUNT(*)::int AS followers,
    EXISTS(SELECT 1 FROM studio_follows WHERE user_profile_id = ${session.row.id} AND studio_id = ${studioId}) AS following
    FROM studio_follows WHERE studio_id = ${studioId}`;
  return json({ followers: Number(rows[0].followers), following: Boolean(rows[0].following) });
}

async function readProgress(request, episodeId) {
  const session = await socialSession(request, { required: true, active: true });
  const episode = await requireEpisode(session.sql, episodeId);
  const rows = await session.sql`SELECT position_seconds, duration_seconds, updated_at FROM watch_progress
    WHERE user_profile_id = ${session.row.id} AND episode_id = ${episode.id}`;
  return { progress: rows.length ? { positionSeconds: Number(rows[0].position_seconds), durationSeconds: Number(rows[0].duration_seconds), updatedAt: dateValue(rows[0].updated_at) } : null };
}

async function writeProgress(request, episodeId) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const episode = await requireEpisode(session.sql, episodeId);
  const body = await jsonBody(request);
  const progress = normalizedProgress(body.positionSeconds, body.durationSeconds);
  await enforceSocialRateLimit(session.sql, session.row.id, 'watch-progress', 360, 3600);
  if (progress.complete) {
    await session.sql.transaction([
      session.sql`DELETE FROM watch_progress WHERE user_profile_id = ${session.row.id} AND episode_id = ${episode.id}`,
      session.sql`INSERT INTO episode_watched (user_profile_id, episode_id, marked_at)
        VALUES (${session.row.id}, ${episode.id}, now()) ON CONFLICT (user_profile_id, episode_id) DO UPDATE SET marked_at = now()`,
      session.sql`INSERT INTO episode_history (user_profile_id, episode_id) VALUES (${session.row.id}, ${episode.id})
        ON CONFLICT (user_profile_id, episode_id) DO UPDATE SET last_viewed_at = now()`
    ]);
    return json({ complete: true, watched: true, progress: null });
  }
  const rows = await session.sql`INSERT INTO watch_progress (user_profile_id, episode_id, position_seconds, duration_seconds, updated_at)
    VALUES (${session.row.id}, ${episode.id}, ${progress.position}, ${progress.duration}, now())
    ON CONFLICT (user_profile_id, episode_id) DO UPDATE SET position_seconds = EXCLUDED.position_seconds,
      duration_seconds = EXCLUDED.duration_seconds, updated_at = now()
    RETURNING position_seconds, duration_seconds, updated_at`;
  return json({ complete: false, watched: false, progress: { positionSeconds: Number(rows[0].position_seconds), durationSeconds: Number(rows[0].duration_seconds), updatedAt: dateValue(rows[0].updated_at) } });
}

async function deleteProgress(request, episodeId) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const episode = await requireEpisode(session.sql, episodeId);
  await session.sql`DELETE FROM watch_progress WHERE user_profile_id = ${session.row.id} AND episode_id = ${episode.id}`;
  return json({ progress: null });
}

async function notifications(session, page) {
  const offset = (page - 1) * NOTIFICATION_PAGE_SIZE;
  const [rows, counts] = await session.sql.transaction([
    session.sql`
      SELECT n.*, actor.username, actor.display_name, au.image AS provider_image,
        avatar.public_url AS avatar_url, COALESCE(direct_project.title, p.title) AS project_title,
        actor_studio.name AS actor_studio_name, actor_studio.logo AS actor_studio_logo,
        actor_studio.is_verified AS actor_studio_verified
      FROM social_notifications n
      LEFT JOIN user_profiles actor ON actor.id = n.actor_profile_id
      LEFT JOIN auth_users au ON au.id = actor.auth_user_id
      LEFT JOIN user_media_uploads avatar ON avatar.id = actor.avatar_media_id AND avatar.status = 'ACTIVE'
      LEFT JOIN studios actor_studio ON actor_studio.id = n.actor_studio_id
      LEFT JOIN episode_comments c ON n.target_type = 'COMMENT' AND c.id = n.target_id
      LEFT JOIN episodes e ON e.id = n.episode_id
      LEFT JOIN projects p ON p.id = e.project_id
      LEFT JOIN projects direct_project ON direct_project.id = n.project_id
      WHERE n.recipient_profile_id = ${session.row.id}
      ORDER BY n.created_at DESC LIMIT ${NOTIFICATION_PAGE_SIZE + 1} OFFSET ${offset}
    `,
    session.sql`SELECT COUNT(*)::int AS unread FROM social_notifications
      WHERE recipient_profile_id = ${session.row.id} AND read_at IS NULL`
  ]);
  return { notifications: pageSlice(rows.map(mapNotification), page, NOTIFICATION_PAGE_SIZE), unreadCount: Number(counts[0].unread) };
}

async function markNotificationRead(request, id) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const notificationId = uuidValue(id, 'La notificación');
  const rows = await session.sql`
    UPDATE social_notifications SET read_at = COALESCE(read_at, now())
    WHERE id = ${notificationId}::uuid AND recipient_profile_id = ${session.row.id}
    RETURNING id, read_at
  `;
  if (!rows.length) throw new AppError(404, 'Notificación propia no encontrada.');
  const counts = await session.sql`SELECT COUNT(*)::int AS unread FROM social_notifications
    WHERE recipient_profile_id = ${session.row.id} AND read_at IS NULL`;
  return json({ id: rows[0].id, readAt: dateValue(rows[0].read_at), unreadCount: Number(counts[0].unread) });
}

async function markAllNotificationsRead(request) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  await session.sql`UPDATE social_notifications SET read_at = now()
    WHERE recipient_profile_id = ${session.row.id} AND read_at IS NULL`;
  return json({ unreadCount: 0 });
}

async function updateComment(request, id) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const body = await jsonBody(request);
  await enforceSocialRateLimit(session.sql, session.row.id, 'comment-edit', 20, 3600);
  const commentId = uuidValue(id, 'El comentario');
  const rows = await session.sql`
    WITH updated AS (
      UPDATE episode_comments SET body = ${commentValue(body.body)}, updated_at = now()
      WHERE id = ${commentId}::uuid AND author_profile_id = ${session.row.id}
        AND moderation_status <> 'DELETED' AND deleted_at IS NULL RETURNING *
    )
    SELECT updated.*, studio.name AS author_studio_name, studio.logo AS author_studio_logo,
      studio.is_verified AS author_studio_verified
    FROM updated LEFT JOIN studios studio ON studio.id = updated.author_studio_id
  `;
  if (!rows.length) throw new AppError(404, 'Comentario propio no encontrado.');
  return json({ comment: mapComment(ownAuthorRow(rows[0], session.row), session.row.id) });
}

async function deleteComment(request, id) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const commentId = uuidValue(id, 'El comentario');
  const rows = await session.sql`
    SELECT c.id, m.id AS media_id, m.object_key FROM episode_comments c
    LEFT JOIN user_media_uploads m ON m.id = c.image_media_id
    WHERE c.id = ${commentId}::uuid AND c.author_profile_id = ${session.row.id} AND c.deleted_at IS NULL
  `;
  if (!rows.length) throw new AppError(404, 'Comentario propio no encontrado.');
  if (rows[0].object_key) await deleteR2Object(rows[0].object_key);
  const queries = [session.sql`
    UPDATE episode_comments SET parent_comment_id = NULL, reply_to_profile_id = NULL, reply_to_studio_id = NULL, updated_at = now()
    WHERE parent_comment_id = ${commentId}::uuid
  `, session.sql`
    DELETE FROM social_notifications WHERE target_type = 'COMMENT'
      AND (target_id = ${commentId}::uuid OR root_comment_id = ${commentId}::uuid)
  `, session.sql`
    DELETE FROM content_reports WHERE target_type = 'COMMENT' AND target_id = ${commentId}::uuid
  `, session.sql`
    DELETE FROM episode_comments
    WHERE id = ${commentId}::uuid AND author_profile_id = ${session.row.id} AND deleted_at IS NULL
  `];
  if (rows[0].media_id) queries.push(session.sql`UPDATE user_media_uploads SET status = 'DELETED', object_key = NULL, public_url = NULL, deleted_at = now() WHERE id = ${rows[0].media_id}`);
  await session.sql.transaction(queries);
  return json({ deleted: true });
}

async function saveReview(request, projectId) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  await requireProject(session.sql, projectId);
  const body = await jsonBody(request);
  await enforceSocialRateLimit(session.sql, session.row.id, 'review', 10, 3600);
  const rows = await session.sql`
    INSERT INTO project_reviews (id, project_id, author_profile_id, rating, body)
    VALUES (${crypto.randomUUID()}::uuid, ${projectId}, ${session.row.id}, ${ratingValue(body.rating)}, ${reviewValue(body.body)})
    ON CONFLICT (author_profile_id, project_id) DO UPDATE SET
      rating = EXCLUDED.rating, body = EXCLUDED.body, moderation_status = 'VISIBLE', deleted_at = NULL, updated_at = now()
    RETURNING *
  `;
  return json({ review: mapReview(ownAuthorRow(rows[0], session.row), session.row.id) });
}

async function updateReview(request, id) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const body = await jsonBody(request);
  await enforceSocialRateLimit(session.sql, session.row.id, 'review', 10, 3600);
  const reviewId = uuidValue(id, 'La reseña');
  const rows = await session.sql`
    UPDATE project_reviews SET rating = ${ratingValue(body.rating)}, body = ${reviewValue(body.body)}, updated_at = now()
    WHERE id = ${reviewId}::uuid AND author_profile_id = ${session.row.id}
      AND moderation_status <> 'DELETED' AND deleted_at IS NULL RETURNING *
  `;
  if (!rows.length) throw new AppError(404, 'Reseña propia no encontrada.');
  return json({ review: mapReview(ownAuthorRow(rows[0], session.row), session.row.id) });
}

async function deleteReview(request, id) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const reviewId = uuidValue(id, 'La reseña');
  const rows = await session.sql`
    UPDATE project_reviews SET body = '[Reseña eliminada]', moderation_status = 'DELETED', deleted_at = now(), updated_at = now()
    WHERE id = ${reviewId}::uuid AND author_profile_id = ${session.row.id} AND deleted_at IS NULL RETURNING id
  `;
  if (!rows.length) throw new AppError(404, 'Reseña propia no encontrada.');
  return json({ deleted: true });
}

async function createReport(request) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const body = await jsonBody(request);
  const targetType = String(body.targetType || '').toUpperCase();
  if (!['COMMENT', 'REVIEW'].includes(targetType)) throw new AppError(400, 'Tipo de contenido no permitido.');
  const targetId = uuidValue(body.targetId, 'El contenido');
  let targets;
  if (targetType === 'COMMENT') targets = await session.sql`SELECT author_profile_id FROM episode_comments WHERE id = ${targetId}::uuid AND deleted_at IS NULL`;
  else targets = await session.sql`SELECT author_profile_id FROM project_reviews WHERE id = ${targetId}::uuid AND deleted_at IS NULL`;
  if (!targets.length) throw new AppError(404, 'Contenido no encontrado.');
  if (targets[0].author_profile_id === session.row.id) throw new AppError(400, 'No puedes reportar tu propio contenido.');
  await enforceSocialRateLimit(session.sql, session.row.id, 'report', 5, 3600);
  const rows = await session.sql`
    INSERT INTO content_reports (id, reporter_profile_id, target_type, target_id, reason, details)
    VALUES (${crypto.randomUUID()}::uuid, ${session.row.id}, ${targetType}, ${targetId}::uuid,
      ${reportReasonValue(body.reason)}, ${plainText(body.details, 'Los detalles', REPORT_DETAILS_MAX)})
    ON CONFLICT (reporter_profile_id, target_type, target_id) WHERE reporter_profile_id IS NOT NULL DO NOTHING
    RETURNING id
  `;
  if (!rows.length) throw new AppError(409, 'Ya reportaste este contenido.');
  return json({ reportId: rows[0].id }, 201);
}

async function createPresign(request) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const body = await jsonBody(request);
  const value = mediaRequestValue(body.purpose, body.contentType, body.size);
  let targetId = null;
  if (value.purpose === 'COMMENT') {
    targetId = uuidValue(body.targetId, 'El comentario');
    const comments = await session.sql`
      SELECT id FROM episode_comments WHERE id = ${targetId}::uuid AND author_profile_id = ${session.row.id}
        AND moderation_status <> 'DELETED' AND deleted_at IS NULL
    `;
    if (!comments.length) throw new AppError(404, 'Comentario propio disponible para imagen no encontrado.');
  }
  await enforceSocialRateLimit(session.sql, session.row.id, 'presign', 10, 3600);
  if (!r2Status().configured) throw new AppError(503, 'Cloudflare R2 todavía no está configurado.');
  const uploadId = crypto.randomUUID();
  const sourceKey = pendingObjectKey(session.row.id, value.purpose, uploadId);
  await session.sql`
    INSERT INTO user_media_uploads (id, owner_profile_id, purpose, target_id, source_object_key, requested_content_type, byte_size)
    VALUES (${uploadId}::uuid, ${session.row.id}, ${value.purpose}, ${targetId || null}::uuid, ${sourceKey}, ${value.contentType}, ${value.size})
  `;
  try {
    const uploadUrl = await presignedPutUrl(sourceKey, value.contentType);
    return json({ uploadId, uploadUrl, contentType: value.contentType, expiresIn: 300 }, 201);
  } catch (error) {
    await session.sql`UPDATE user_media_uploads SET status = 'REJECTED', rejection_reason = 'No se pudo firmar la subida.' WHERE id = ${uploadId}::uuid`;
    throw error;
  }
}

async function finalizeUpload(request, uploadId) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const mediaId = uuidValue(uploadId, 'La subida');
  const rows = await session.sql`
    SELECT * FROM user_media_uploads WHERE id = ${mediaId}::uuid AND owner_profile_id = ${session.row.id} AND status = 'PENDING'
  `;
  if (!rows.length) throw new AppError(404, 'Subida pendiente propia no encontrada.');
  const upload = rows[0];
  const destinationKey = activeObjectKey(session.row.id, upload.purpose, upload.id, upload.target_id || '');
  try {
    const output = await validateAndProcessUpload({ sourceKey: upload.source_object_key, destinationKey, purpose: upload.purpose });
    await session.sql`
      UPDATE user_media_uploads SET object_key = ${destinationKey}, public_url = ${output.url},
        validated_content_type = ${output.outputContentType}, byte_size = ${output.byteSize}, width = ${output.width}, height = ${output.height},
        status = 'ACTIVE', validated_at = now(), rejection_reason = NULL WHERE id = ${upload.id} AND status = 'PENDING'
    `;
    let oldMedia = [];
    if (upload.purpose === 'AVATAR') {
      oldMedia = await session.sql`SELECT m.id, m.object_key FROM user_profiles p LEFT JOIN user_media_uploads m ON m.id = p.avatar_media_id WHERE p.id = ${session.row.id}`;
      await session.sql`UPDATE user_profiles SET avatar_media_id = ${upload.id}, updated_at = now() WHERE id = ${session.row.id}`;
    } else if (upload.purpose === 'BANNER') {
      oldMedia = await session.sql`SELECT m.id, m.object_key FROM user_profiles p LEFT JOIN user_media_uploads m ON m.id = p.banner_media_id WHERE p.id = ${session.row.id}`;
      await session.sql`UPDATE user_profiles SET banner_media_id = ${upload.id}, updated_at = now() WHERE id = ${session.row.id}`;
    } else {
      oldMedia = await session.sql`
        SELECT m.id, m.object_key FROM episode_comments c
        LEFT JOIN user_media_uploads m ON m.id = c.image_media_id
        WHERE c.id = ${upload.target_id} AND c.author_profile_id = ${session.row.id} AND c.deleted_at IS NULL
      `;
      const attached = await session.sql`
        UPDATE episode_comments SET image_media_id = ${upload.id}, updated_at = now()
        WHERE id = ${upload.target_id} AND author_profile_id = ${session.row.id} AND deleted_at IS NULL RETURNING id
      `;
      if (!attached.length) throw new AppError(409, 'El comentario ya no puede recibir esta imagen.');
    }
    const previous = oldMedia[0];
    if (previous?.id && previous.id !== upload.id) {
      await session.sql`UPDATE user_media_uploads SET status = 'DELETED', deleted_at = now() WHERE id = ${previous.id}`;
      if (previous.object_key) {
        await deleteR2Object(previous.object_key)
          .then(() => session.sql`UPDATE user_media_uploads SET object_key = NULL, public_url = NULL WHERE id = ${previous.id} AND status = 'DELETED'`)
          .catch(error => console.error('R2 previous media cleanup:', error));
      }
    }
    return json({ upload: { id: upload.id, purpose: upload.purpose, url: publicObjectUrl(destinationKey), width: output.width, height: output.height } });
  } catch (error) {
    await deleteR2Object(destinationKey).catch(() => {});
    await rejectPendingObject(upload.source_object_key);
    await session.sql`
      UPDATE user_media_uploads SET status = 'REJECTED', object_key = NULL, public_url = NULL,
        rejection_reason = ${String(error.message || 'Validación fallida.').slice(0, 500)}, validated_at = now()
      WHERE id = ${upload.id} AND status IN ('PENDING','ACTIVE')
    `;
    throw error;
  }
}

async function deleteCommentImage(request, id) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const commentId = uuidValue(id, 'El comentario');
  const rows = await session.sql`
    SELECT c.id, m.id AS media_id, m.object_key FROM episode_comments c
    JOIN user_media_uploads m ON m.id = c.image_media_id
    WHERE c.id = ${commentId}::uuid AND c.author_profile_id = ${session.row.id} AND c.deleted_at IS NULL
  `;
  if (!rows.length) throw new AppError(404, 'Imagen propia no encontrada.');
  if (rows[0].object_key) await deleteR2Object(rows[0].object_key);
  await session.sql.transaction([
    session.sql`UPDATE episode_comments SET image_media_id = NULL, updated_at = now()
      WHERE id = ${commentId}::uuid AND author_profile_id = ${session.row.id}`,
    session.sql`UPDATE user_media_uploads SET status = 'DELETED', object_key = NULL, public_url = NULL, deleted_at = now()
      WHERE id = ${rows[0].media_id}`
  ]);
  return json({ removed: true });
}

export async function GET(request, context) {
  try {
    const path = await segments(context);
    const page = pageValue(request.nextUrl.searchParams.get('page'));
    if (path[0] === 'config' && path.length === 1) {
      const auth = userAuthStatus();
      return json({ authAvailable: auth.available, providers: auth.available ? configuredSocialProviders() : [], mediaAvailable: r2Status().configured });
    }
    if (path[0] === 'session' && path.length === 1) {
      const session = await optionalSession(request);
      if (!session) return json({ user: null });
      const studios = await managedStudios(session.sql, session.row.id);
      return json({ user: { ...mapSocialProfile(session.row), managedStudios: studios.map(row => ({ id: row.id, name: row.name, logo: row.logo || '', isVerified: row.is_verified, role: row.role })) } });
    }
    const sql = getSql();
    if (path[0] === 'users' && path[1] && path.length === 2) return json(await publicProfile(request, sql, usernameValue(path[1]), page));
    if (path[0] === 'users' && path[1] && ['followers', 'following'].includes(path[2]) && path.length === 3) {
      return json(await profileConnections(request, sql, usernameValue(path[1]), path[2], page));
    }
    if (path[0] === 'me' && path.length === 1) return json(await privateProfile(await socialSession(request, { required: true }), page));
    if (path[0] === 'notifications' && path.length === 1) return json(await notifications(await socialSession(request, { required: true }), page));
    if (path[0] === 'notifications' && path[1] === 'unread-count' && path.length === 2) {
      const session = await socialSession(request, { required: true });
      const counts = await session.sql`SELECT COUNT(*)::int AS unread FROM social_notifications
        WHERE recipient_profile_id = ${session.row.id} AND read_at IS NULL`;
      return json({ unreadCount: Number(counts[0].unread) });
    }
    if (path[0] === 'projects' && path[1] && path.length === 2) return json(await projectSocial(request, sql, path[1], page));
    if (path[0] === 'studios' && path[1] && path.length === 2) return json(await studioSocial(request, sql, path[1]));
    if (path[0] === 'episodes' && path[1] && path[2] === 'progress' && path.length === 3) return json(await readProgress(request, path[1]));
    if (path[0] === 'episodes' && path[1] && path.length === 2) return json(await episodeSocial(request, sql, path[1], page));
    if (path[0] === 'comments' && path[1] && path[2] === 'replies' && path.length === 3) return json(await commentReplies(request, sql, path[1], page));
    throw new AppError(404, 'Ruta social no encontrada.');
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Social GET:', error);
    return socialErrorResponse(error);
  }
}

export async function POST(request, context) {
  try {
    const path = await segments(context);
    if (path.length === 3 && ['projects', 'episodes'].includes(path[0]) && ['like', 'favorite', 'watch-later'].includes(path[2])) return await writeMembership(request, path, true);
    if (path[0] === 'episodes' && path[1] && path[2] === 'watched' && path.length === 3) return await writeWatched(request, path[1], true);
    if (path[0] === 'episodes' && path[1] && path[2] === 'view') {
      assertSocialWriteOrigin(request);
      const session = await socialSession(request, { required: true, active: true });
      const episode = await requireEpisode(session.sql, path[1]);
      await enforceSocialRateLimit(session.sql, session.row.id, 'history', 120, 3600);
      await session.sql`
        INSERT INTO episode_history (user_profile_id, episode_id) VALUES (${session.row.id}, ${episode.id})
        ON CONFLICT (user_profile_id, episode_id) DO UPDATE SET last_viewed_at = now(), view_count = episode_history.view_count + 1
      `;
      return json({ historyRecorded: true });
    }
    if (path[0] === 'episodes' && path[1] && path[2] === 'comments') return await createComment(request, path[1]);
    if (path[0] === 'comments' && path[1] && path[2] === 'replies' && path.length === 3) return await createReply(request, path[1]);
    if (path[0] === 'comments' && path[1] && path[2] === 'like' && path.length === 3) return await writeCommentLike(request, path[1], true);
    if (path[0] === 'users' && path[1] && path[2] === 'follow' && path.length === 3) return await writeFollow(request, path[1], true);
    if (path[0] === 'studios' && path[1] && path[2] === 'follow' && path.length === 3) return await writeStudioFollow(request, path[1], true);
    if (path[0] === 'projects' && path[1] && path[2] === 'reviews') return await saveReview(request, path[1]);
    if (path[0] === 'reports' && path.length === 1) return await createReport(request);
    if (path[0] === 'media' && path[1] === 'presign') return await createPresign(request);
    if (path[0] === 'media' && path[1] && path[2] === 'finalize') return await finalizeUpload(request, path[1]);
    throw new AppError(404, 'Ruta social no encontrada.');
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Social POST:', error);
    return socialErrorResponse(error);
  }
}

export async function PUT(request, context) {
  try {
    const path = await segments(context);
    if (path[0] === 'episodes' && path[1] && path[2] === 'progress' && path.length === 3) return await writeProgress(request, path[1]);
    throw new AppError(404, 'Ruta social no encontrada.');
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Social PUT:', error);
    return socialErrorResponse(error);
  }
}

export async function PATCH(request, context) {
  try {
    const path = await segments(context);
    if (path[0] === 'me' && path.length === 1) {
      assertSocialWriteOrigin(request);
      const session = await socialSession(request, { required: true, active: true });
      const body = await jsonBody(request);
      await enforceSocialRateLimit(session.sql, session.row.id, 'profile-edit', 10, 3600);
      const displayName = displayNameValue(body.displayName);
      const username = usernameValue(body.username);
      const bio = bioValue(body.bio);
      const rows = await session.sql`
        UPDATE user_profiles SET display_name = ${displayName}, username = ${username}, bio = ${bio}, updated_at = now()
        WHERE id = ${session.row.id}
          AND NOT EXISTS (SELECT 1 FROM user_profiles other WHERE lower(other.username) = lower(${username}) AND other.id <> ${session.row.id})
        RETURNING *
      `;
      if (!rows.length) throw new AppError(409, 'Ese username ya está en uso.');
      return json({ profile: mapSocialProfile({ ...session.row, ...rows[0] }) });
    }
    if (path[0] === 'comments' && path[1] && path.length === 2) return await updateComment(request, path[1]);
    if (path[0] === 'reviews' && path[1]) return await updateReview(request, path[1]);
    if (path[0] === 'notifications' && path[1] === 'read-all' && path.length === 2) return await markAllNotificationsRead(request);
    if (path[0] === 'notifications' && path[1] && path.length === 2) return await markNotificationRead(request, path[1]);
    throw new AppError(404, 'Ruta social no encontrada.');
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Social PATCH:', error);
    return socialErrorResponse(error);
  }
}

export async function DELETE(request, context) {
  try {
    const path = await segments(context);
    if (path.length === 3 && ['projects', 'episodes'].includes(path[0]) && ['like', 'favorite', 'watch-later'].includes(path[2])) return await writeMembership(request, path, false);
    if (path[0] === 'episodes' && path[1] && path[2] === 'watched' && path.length === 3) return await writeWatched(request, path[1], false);
    if (path[0] === 'comments' && path[1] && path[2] === 'like' && path.length === 3) return await writeCommentLike(request, path[1], false);
    if (path[0] === 'users' && path[1] && path[2] === 'follow' && path.length === 3) return await writeFollow(request, path[1], false);
    if (path[0] === 'studios' && path[1] && path[2] === 'follow' && path.length === 3) return await writeStudioFollow(request, path[1], false);
    if (path[0] === 'episodes' && path[1] && path[2] === 'progress' && path.length === 3) return await deleteProgress(request, path[1]);
    if (path[0] === 'comments' && path[1] && path[2] === 'image' && path.length === 3) return await deleteCommentImage(request, path[1]);
    if (path[0] === 'comments' && path[1] && path.length === 2) return await deleteComment(request, path[1]);
    if (path[0] === 'reviews' && path[1]) return await deleteReview(request, path[1]);
    throw new AppError(404, 'Ruta social no encontrada.');
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Social DELETE:', error);
    return socialErrorResponse(error);
  }
}
