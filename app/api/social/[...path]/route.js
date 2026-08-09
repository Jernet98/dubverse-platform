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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;
const REVIEW_PAGE_SIZE = 10;

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
  return {
    id: row.id,
    episodeId: row.episode_id,
    body: row.body,
    image: row.image_url || '',
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

async function optionalSession(request) {
  return socialSession(request).catch(error => {
    if (error?.status === 401) return null;
    throw error;
  });
}

async function publicProfile(sql, username, page) {
  const profiles = await sql`
    SELECT p.*, au.image AS provider_image, avatar.public_url AS avatar_url, banner.public_url AS banner_url
    FROM user_profiles p
    JOIN auth_users au ON au.id = p.auth_user_id
    LEFT JOIN user_media_uploads avatar ON avatar.id = p.avatar_media_id AND avatar.status = 'ACTIVE'
    LEFT JOIN user_media_uploads banner ON banner.id = p.banner_media_id AND banner.status = 'ACTIVE'
    WHERE lower(p.username) = lower(${username})
  `;
  if (!profiles.length) throw new AppError(404, 'Perfil no encontrado.');
  const offset = (page - 1) * PAGE_SIZE;
  const [favorites, reviews] = await sql.transaction([
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
        ORDER BY r.updated_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`
  ]);
  return {
    profile: mapSocialProfile(profiles[0]),
    favorites: pageSlice(favorites.map(mapProject), page, PAGE_SIZE),
    reviews: pageSlice(reviews.map(row => mapReview(row)), page, PAGE_SIZE)
  };
}

async function privateProfile(session, page) {
  const { sql, row } = session;
  const offset = (page - 1) * PAGE_SIZE;
  const [favorites, watchLater, history] = await sql.transaction([
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
        ORDER BY h.last_viewed_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`
  ]);
  return {
    profile: mapSocialProfile(row),
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
  const [stats, reviews, flags, seen] = await sql.transaction([
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
    viewerId ? sql`SELECT h.episode_id FROM episode_history h JOIN episodes e ON e.id = h.episode_id
        WHERE h.user_profile_id = ${viewerId} AND e.project_id = ${projectId}` : sql`SELECT NULL::text AS episode_id WHERE false`
  ]);
  return {
    likes: Number(stats[0].likes), reviewCount: Number(stats[0].review_count), reviewAverage: Number(stats[0].review_average),
    viewer: { authenticated: Boolean(viewer), liked: flags[0].liked, favorite: flags[0].favorite, watchLater: flags[0].watch_later },
    seenEpisodeIds: seen.map(item => item.episode_id),
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
          avatar.public_url AS avatar_url, image.public_url AS image_url
        FROM episode_comments c LEFT JOIN user_profiles up ON up.id = c.author_profile_id
        LEFT JOIN auth_users au ON au.id = up.auth_user_id
        LEFT JOIN user_media_uploads avatar ON avatar.id = up.avatar_media_id AND avatar.status = 'ACTIVE'
        LEFT JOIN user_media_uploads image ON image.id = c.image_media_id AND image.status = 'ACTIVE'
        WHERE c.episode_id = ${episodeId} AND c.moderation_status = 'VISIBLE' AND c.deleted_at IS NULL
        ORDER BY c.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
    viewerId ? sql`SELECT
          EXISTS(SELECT 1 FROM episode_likes WHERE user_profile_id = ${viewerId} AND episode_id = ${episodeId}) AS liked,
          EXISTS(SELECT 1 FROM episode_history WHERE user_profile_id = ${viewerId} AND episode_id = ${episodeId}) AS seen` :
      sql`SELECT false AS liked, false AS seen`
  ]);
  return {
    likes: Number(likes[0].count), viewer: { authenticated: Boolean(viewer), liked: flags[0].liked, seen: flags[0].seen },
    comments: pageSlice(comments.map(row => mapComment(row, viewerId)), page, PAGE_SIZE)
  };
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

async function createComment(request, episodeId) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const episode = await requireEpisode(session.sql, episodeId);
  const body = await jsonBody(request);
  await enforceSocialRateLimit(session.sql, session.row.id, 'comment', 5, 60);
  const rows = await session.sql`
    INSERT INTO episode_comments (id, episode_id, author_profile_id, body)
    VALUES (${crypto.randomUUID()}::uuid, ${episode.id}, ${session.row.id}, ${commentValue(body.body)}) RETURNING *
  `;
  return json({ comment: mapComment(ownAuthorRow(rows[0], session.row), session.row.id) }, 201);
}

async function updateComment(request, id) {
  assertSocialWriteOrigin(request);
  const session = await socialSession(request, { required: true, active: true });
  const body = await jsonBody(request);
  await enforceSocialRateLimit(session.sql, session.row.id, 'comment-edit', 20, 3600);
  const commentId = uuidValue(id, 'El comentario');
  const rows = await session.sql`
    UPDATE episode_comments SET body = ${commentValue(body.body)}, updated_at = now()
    WHERE id = ${commentId}::uuid AND author_profile_id = ${session.row.id}
      AND moderation_status <> 'DELETED' AND deleted_at IS NULL RETURNING *
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
    UPDATE episode_comments SET body = '[Comentario eliminado]', moderation_status = 'DELETED', deleted_at = now(), updated_at = now()
    WHERE id = ${commentId}::uuid AND author_profile_id = ${session.row.id} AND deleted_at IS NULL
  `];
  if (rows[0].media_id) queries.push(session.sql`UPDATE user_media_uploads SET status = 'DELETED', deleted_at = now() WHERE id = ${rows[0].media_id}`);
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
        AND image_media_id IS NULL AND deleted_at IS NULL
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
      const attached = await session.sql`
        UPDATE episode_comments SET image_media_id = ${upload.id}, updated_at = now()
        WHERE id = ${upload.target_id} AND author_profile_id = ${session.row.id} AND image_media_id IS NULL AND deleted_at IS NULL RETURNING id
      `;
      if (!attached.length) throw new AppError(409, 'El comentario ya no puede recibir esta imagen.');
    }
    const previous = oldMedia[0];
    if (previous?.id && previous.id !== upload.id) {
      await session.sql`UPDATE user_media_uploads SET status = 'DELETED', deleted_at = now() WHERE id = ${previous.id}`;
      if (previous.object_key) await deleteR2Object(previous.object_key).catch(error => console.error('R2 previous media cleanup:', error));
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
      return json({ user: session ? mapSocialProfile(session.row) : null });
    }
    const sql = getSql();
    if (path[0] === 'users' && path[1] && path.length === 2) return json(await publicProfile(sql, usernameValue(path[1]), page));
    if (path[0] === 'me' && path.length === 1) return json(await privateProfile(await socialSession(request, { required: true }), page));
    if (path[0] === 'projects' && path[1] && path.length === 2) return json(await projectSocial(request, sql, path[1], page));
    if (path[0] === 'episodes' && path[1] && path.length === 2) return json(await episodeSocial(request, sql, path[1], page));
    throw new AppError(404, 'Ruta social no encontrada.');
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Social GET:', error);
    return socialErrorResponse(error);
  }
}

export async function POST(request, context) {
  try {
    const path = await segments(context);
    if (path.length === 3 && ['like', 'favorite', 'watch-later'].includes(path[2])) return await writeMembership(request, path, true);
    if (path[0] === 'episodes' && path[1] && path[2] === 'view') {
      assertSocialWriteOrigin(request);
      const session = await socialSession(request, { required: true, active: true });
      const episode = await requireEpisode(session.sql, path[1]);
      await enforceSocialRateLimit(session.sql, session.row.id, 'history', 120, 3600);
      await session.sql`
        INSERT INTO episode_history (user_profile_id, episode_id) VALUES (${session.row.id}, ${episode.id})
        ON CONFLICT (user_profile_id, episode_id) DO UPDATE SET last_viewed_at = now(), view_count = episode_history.view_count + 1
      `;
      return json({ seen: true });
    }
    if (path[0] === 'episodes' && path[1] && path[2] === 'comments') return await createComment(request, path[1]);
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
    if (path[0] === 'comments' && path[1]) return await updateComment(request, path[1]);
    if (path[0] === 'reviews' && path[1]) return await updateReview(request, path[1]);
    throw new AppError(404, 'Ruta social no encontrada.');
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Social PATCH:', error);
    return socialErrorResponse(error);
  }
}

export async function DELETE(request, context) {
  try {
    const path = await segments(context);
    if (path.length === 3 && ['like', 'favorite', 'watch-later'].includes(path[2])) return await writeMembership(request, path, false);
    if (path[0] === 'comments' && path[1]) return await deleteComment(request, path[1]);
    if (path[0] === 'reviews' && path[1]) return await deleteReview(request, path[1]);
    throw new AppError(404, 'Ruta social no encontrada.');
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Social DELETE:', error);
    return socialErrorResponse(error);
  }
}
