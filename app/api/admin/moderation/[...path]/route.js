import { AppError, getSql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { deleteR2Object } from '@/lib/r2';
import { assertSocialWriteOrigin, dateValue, jsonBody, socialErrorResponse } from '@/lib/social';
import { pageValue, plainText, uuidValue } from '@/lib/social-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function segments(context) {
  const params = await context.params;
  return Array.isArray(params.path) ? params.path : [];
}

function reportRow(row) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    details: row.details,
    status: row.status,
    createdAt: dateValue(row.created_at),
    resolvedAt: dateValue(row.resolved_at),
    resolutionNote: row.resolution_note,
    reporter: row.reporter_username ? { username: row.reporter_username, displayName: row.reporter_display_name } : null,
    author: row.author_username ? { id: row.author_id, username: row.author_username, displayName: row.author_display_name, status: row.author_status } : null,
    content: {
      kind: row.target_type === 'COMMENT' ? (row.parent_comment_id ? 'REPLY' : 'COMMENT') : 'REVIEW',
      body: row.content_body || '[Contenido eliminado]',
      moderationStatus: row.content_status || 'DELETED',
      project: row.project_id ? { id: row.project_id, title: row.project_title } : null,
      episode: row.episode_id ? { id: row.episode_id, title: row.episode_title } : null
    }
  };
}

async function moderationOverview(sql, status, page) {
  const offset = (page - 1) * PAGE_SIZE;
  const reports = await sql`
    SELECT cr.*,
      reporter.username AS reporter_username, reporter.display_name AS reporter_display_name,
      COALESCE(comment_author.id, review_author.id) AS author_id,
      COALESCE(comment_author.username, review_author.username) AS author_username,
      COALESCE(comment_author.display_name, review_author.display_name) AS author_display_name,
      COALESCE(comment_author.status, review_author.status) AS author_status,
      COALESCE(c.body, r.body) AS content_body,
      COALESCE(c.moderation_status, r.moderation_status) AS content_status,
      c.parent_comment_id,
      e.id AS episode_id,
      e.title AS episode_title,
      COALESCE(episode_project.id, review_project.id) AS project_id,
      COALESCE(episode_project.title, review_project.title) AS project_title
    FROM content_reports cr
    LEFT JOIN user_profiles reporter ON reporter.id = cr.reporter_profile_id
    LEFT JOIN episode_comments c ON cr.target_type = 'COMMENT' AND c.id = cr.target_id
    LEFT JOIN user_profiles comment_author ON comment_author.id = c.author_profile_id
    LEFT JOIN episodes e ON e.id = c.episode_id
    LEFT JOIN projects episode_project ON episode_project.id = e.project_id
    LEFT JOIN project_reviews r ON cr.target_type = 'REVIEW' AND r.id = cr.target_id
    LEFT JOIN user_profiles review_author ON review_author.id = r.author_profile_id
    LEFT JOIN projects review_project ON review_project.id = r.project_id
    WHERE cr.status = ${status}
    ORDER BY cr.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
  `;
  const users = await sql`
    SELECT p.id, p.username, p.display_name, p.status, p.joined_at, p.updated_at,
      (SELECT COUNT(*) FROM episode_comments c WHERE c.author_profile_id = p.id AND c.deleted_at IS NULL)::int AS comments,
      (SELECT COUNT(*) FROM project_reviews r WHERE r.author_profile_id = p.id AND r.deleted_at IS NULL)::int AS reviews
    FROM user_profiles p ORDER BY p.updated_at DESC LIMIT 200
  `;
  return {
    reports: { items: reports.slice(0, PAGE_SIZE).map(reportRow), page, hasMore: reports.length > PAGE_SIZE },
    users: users.map(row => ({
      id: row.id, username: row.username, displayName: row.display_name, status: row.status,
      joinedAt: dateValue(row.joined_at), updatedAt: dateValue(row.updated_at),
      comments: Number(row.comments), reviews: Number(row.reviews)
    }))
  };
}

async function moderateContent(sql, kind, id, action) {
  const contentId = uuidValue(id, kind === 'comments' ? 'El comentario' : 'La reseña');
  if (!['HIDE', 'RESTORE'].includes(action)) throw new AppError(400, 'Acción de moderación no permitida.');
  const status = action === 'HIDE' ? 'HIDDEN' : 'VISIBLE';
  let rows;
  if (kind === 'comments') {
    rows = await sql`UPDATE episode_comments SET moderation_status = ${status}, updated_at = now()
      WHERE id = ${contentId}::uuid AND deleted_at IS NULL AND moderation_status <> 'DELETED' RETURNING id`;
  } else {
    rows = await sql`UPDATE project_reviews SET moderation_status = ${status}, updated_at = now()
      WHERE id = ${contentId}::uuid AND deleted_at IS NULL AND moderation_status <> 'DELETED' RETURNING id`;
  }
  if (!rows.length) throw new AppError(404, 'Contenido moderable no encontrado.');
  return { id: rows[0].id, moderationStatus: status };
}

async function hardDeleteContent(sql, kind, id) {
  const contentId = uuidValue(id, kind === 'comments' ? 'El comentario' : 'La reseña');
  if (kind === 'comments') {
    const rows = await sql`
      SELECT c.id, m.id AS media_id, m.object_key FROM episode_comments c
      LEFT JOIN user_media_uploads m ON m.id = c.image_media_id WHERE c.id = ${contentId}::uuid
    `;
    if (!rows.length) throw new AppError(404, 'Comentario no encontrado.');
    if (rows[0].object_key) await deleteR2Object(rows[0].object_key);
    await sql`DELETE FROM episode_comments WHERE id = ${contentId}::uuid`;
    if (rows[0].media_id) await sql`UPDATE user_media_uploads SET status = 'DELETED', object_key = NULL, public_url = NULL, deleted_at = now() WHERE id = ${rows[0].media_id}`;
  } else {
    const rows = await sql`DELETE FROM project_reviews WHERE id = ${contentId}::uuid RETURNING id`;
    if (!rows.length) throw new AppError(404, 'Reseña no encontrada.');
  }
  return { deleted: true };
}

export async function GET(request, context) {
  try {
    requireAdmin(request);
    const path = await segments(context);
    if (path[0] !== 'list' || path.length !== 1) throw new AppError(404, 'Ruta de moderación no encontrada.');
    const status = String(request.nextUrl.searchParams.get('status') || 'OPEN').toUpperCase();
    if (!['OPEN', 'RESOLVED', 'DISMISSED'].includes(status)) throw new AppError(400, 'Estado de reporte no permitido.');
    return json(await moderationOverview(getSql(), status, pageValue(request.nextUrl.searchParams.get('page'))));
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Moderation GET:', error);
    return socialErrorResponse(error);
  }
}

export async function PATCH(request, context) {
  try {
    requireAdmin(request);
    assertSocialWriteOrigin(request);
    const path = await segments(context);
    const body = await jsonBody(request);
    const sql = getSql();
    if (path[0] === 'reports' && path[1]) {
      const reportId = uuidValue(path[1], 'El reporte');
      const status = String(body.status || '').toUpperCase();
      if (!['RESOLVED', 'DISMISSED'].includes(status)) throw new AppError(400, 'Resolución no permitida.');
      const note = plainText(body.note, 'La nota', 500);
      const rows = await sql`UPDATE content_reports SET status = ${status}, resolution_note = ${note}, resolved_at = now()
        WHERE id = ${reportId}::uuid AND status = 'OPEN' RETURNING id`;
      if (!rows.length) throw new AppError(404, 'Reporte abierto no encontrado.');
      return json({ id: rows[0].id, status });
    }
    if (['comments', 'reviews'].includes(path[0]) && path[1]) return json(await moderateContent(sql, path[0], path[1], String(body.action || '').toUpperCase()));
    if (path[0] === 'users' && path[1]) {
      const profileId = uuidValue(path[1], 'El usuario');
      const status = String(body.status || '').toUpperCase();
      if (!['ACTIVE', 'SUSPENDED'].includes(status)) throw new AppError(400, 'Estado de usuario no permitido.');
      const rows = await sql`UPDATE user_profiles SET status = ${status}, updated_at = now() WHERE id = ${profileId}::uuid RETURNING auth_user_id`;
      if (!rows.length) throw new AppError(404, 'Usuario no encontrado.');
      if (status === 'SUSPENDED') await sql`DELETE FROM auth_sessions WHERE user_id = ${rows[0].auth_user_id}`;
      return json({ id: profileId, status, sessionsInvalidated: status === 'SUSPENDED' });
    }
    throw new AppError(404, 'Ruta de moderación no encontrada.');
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Moderation PATCH:', error);
    return socialErrorResponse(error);
  }
}

export async function DELETE(request, context) {
  try {
    requireAdmin(request);
    assertSocialWriteOrigin(request);
    const path = await segments(context);
    if (!['comments', 'reviews'].includes(path[0]) || !path[1]) throw new AppError(404, 'Ruta de moderación no encontrada.');
    return json(await hardDeleteContent(getSql(), path[0], path[1]));
  } catch (error) {
    if (Number(error?.status || 500) >= 500) console.error('Moderation DELETE:', error);
    return socialErrorResponse(error);
  }
}
