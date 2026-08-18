import { isUpdate2SchemaMissing } from './update2.js';

export async function notifyStudioFollowers(sql, { type, projectId, episodeId = null, actorProfileId = null }) {
  if (!['STUDIO_NEW_PROJECT', 'STUDIO_NEW_EPISODE'].includes(type)) return 0;
  try {
    const rows = await sql`
      WITH studios_for_content AS (
        SELECT ps.studio_id
        FROM project_studios ps
        JOIN projects p ON p.id = ps.project_id
        WHERE ps.project_id = ${projectId} AND p.published = true AND p.deleted_at IS NULL
          AND (${episodeId}::text IS NULL OR EXISTS (
            SELECT 1 FROM episodes e
            WHERE e.id = ${episodeId} AND e.project_id = p.id AND e.published = true AND e.deleted_at IS NULL
          ))
      ), inserted AS (
        INSERT INTO social_notifications (
          id, recipient_profile_id, actor_profile_id, actor_studio_id, type, target_type,
          target_id, studio_id, project_id, episode_id, dedupe_key
        )
        SELECT gen_random_uuid(), sf.user_profile_id, ${actorProfileId}::uuid, sfc.studio_id,
          ${type}, ${type === 'STUDIO_NEW_PROJECT' ? 'PROJECT' : 'EPISODE'}, NULL,
          sfc.studio_id, ${projectId}, ${episodeId},
          'studio-publication:' || ${type} || ':' || sf.user_profile_id::text || ':' || sfc.studio_id || ':' || COALESCE(${episodeId}, ${projectId})
        FROM studios_for_content sfc
        JOIN studio_follows sf ON sf.studio_id = sfc.studio_id
        WHERE sf.user_profile_id <> COALESCE(${actorProfileId}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING id
      ) SELECT COUNT(*)::int AS count FROM inserted
    `;
    return Number(rows[0]?.count || 0);
  } catch (error) {
    if (isUpdate2SchemaMissing(error)) return 0;
    throw error;
  }
}
