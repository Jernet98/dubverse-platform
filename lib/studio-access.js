import { AppError } from './db.js';
import { socialSession } from './social.js';
import { isUpdate2SchemaMissing } from './update2.js';

export async function managedStudios(sql, profileId) {
  try {
    return await sql`
      SELECT sm.id AS membership_id, sm.role, sm.created_at AS membership_created_at,
        s.id, s.name, s.logo, s.banner, s.is_verified
      FROM studio_memberships sm
      JOIN studios s ON s.id = sm.studio_id
      WHERE sm.user_profile_id = ${profileId} AND s.deleted_at IS NULL
      ORDER BY s.name
    `;
  } catch (error) {
    if (isUpdate2SchemaMissing(error)) return [];
    throw error;
  }
}

export async function studioAdminSession(request, studioId) {
  const session = await socialSession(request, { required: true, active: true });
  const rows = await session.sql`
    SELECT sm.id, sm.role FROM studio_memberships sm
    JOIN studios s ON s.id = sm.studio_id
    WHERE sm.user_profile_id = ${session.row.id} AND sm.studio_id = ${studioId}
      AND s.deleted_at IS NULL
  `;
  if (!rows.length) throw new AppError(403, 'No administras este estudio.');
  return { ...session, membership: rows[0], studioId };
}

export async function requireManagedProject(session, projectId) {
  const rows = await session.sql`
    SELECT p.* FROM projects p
    JOIN project_studios ps ON ps.project_id = p.id
    WHERE p.id = ${projectId} AND ps.studio_id = ${session.studioId} AND p.deleted_at IS NULL
  `;
  if (!rows.length) throw new AppError(403, 'El proyecto no pertenece al estudio administrado.');
  return rows[0];
}

export async function requireManagedEpisode(session, episodeId) {
  const rows = await session.sql`
    SELECT e.* FROM episodes e
    JOIN project_studios ps ON ps.project_id = e.project_id
    WHERE e.id = ${episodeId} AND ps.studio_id = ${session.studioId} AND e.deleted_at IS NULL
  `;
  if (!rows.length) throw new AppError(403, 'El episodio no pertenece al estudio administrado.');
  return rows[0];
}

export async function assertStudioIdentity(sql, profileId, studioId) {
  if (!studioId) return null;
  const rows = await sql`
    SELECT s.id, s.name, s.logo, s.is_verified
    FROM studio_memberships sm JOIN studios s ON s.id = sm.studio_id
    WHERE sm.user_profile_id = ${profileId} AND sm.studio_id = ${studioId} AND s.deleted_at IS NULL
  `;
  if (!rows.length) throw new AppError(403, 'No puedes publicar con la identidad de ese estudio.');
  return rows[0];
}

export function studioResourceAllowed(resourceStudioIds, requestedStudioId) {
  return new Set(resourceStudioIds || []).has(requestedStudioId);
}
