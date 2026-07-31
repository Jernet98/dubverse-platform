import seed from '@/data/seed.json';
import { ensureSchema } from '@/lib/schema';

export async function seedDatabase(sql, { reset = false } = {}) {
  await ensureSchema(sql);

  if (reset) {
    await sql.transaction([
      sql`DELETE FROM project_studios`,
      sql`DELETE FROM episodes`,
      sql`DELETE FROM studios`,
      sql`DELETE FROM projects`,
      sql`DELETE FROM settings`
    ]);
  }

  const projectQueries = seed.projects.map(project => sql`
    INSERT INTO projects (
      id, legacy_key, type, title, alternate_title, synopsis, status, genres,
      poster, banner, published, featured, legacy_path, updated_at
    ) VALUES (
      ${project.id}, ${project.legacyKey || null}, ${project.type}, ${project.title},
      ${project.alternateTitle || ''}, ${project.synopsis || ''}, ${project.status},
      ${JSON.stringify(project.genres || [])}::jsonb, ${project.poster || null},
      ${project.banner || null}, ${Boolean(project.published)}, ${Boolean(project.featured)},
      ${project.legacyPath || null}, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      legacy_key = EXCLUDED.legacy_key,
      type = EXCLUDED.type,
      title = EXCLUDED.title,
      alternate_title = EXCLUDED.alternate_title,
      synopsis = EXCLUDED.synopsis,
      status = EXCLUDED.status,
      genres = EXCLUDED.genres,
      poster = EXCLUDED.poster,
      banner = EXCLUDED.banner,
      published = EXCLUDED.published,
      featured = EXCLUDED.featured,
      legacy_path = EXCLUDED.legacy_path,
      updated_at = now()
  `);

  const studioQueries = seed.studios.map(studio => sql`
    INSERT INTO studios (
      id, name, director, description, logo, socials, published, updated_at
    ) VALUES (
      ${studio.id}, ${studio.name}, ${studio.director || ''}, ${studio.description || ''},
      ${studio.logo || null}, ${JSON.stringify(studio.socials || {})}::jsonb,
      ${Boolean(studio.published)}, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      director = EXCLUDED.director,
      description = EXCLUDED.description,
      logo = EXCLUDED.logo,
      socials = EXCLUDED.socials,
      published = EXCLUDED.published,
      updated_at = now()
  `);

  const relationQueries = seed.projectStudios.map(relation => sql`
    INSERT INTO project_studios (project_id, studio_id, role, notes)
    VALUES (${relation.projectId}, ${relation.studioId}, ${relation.role || 'Fandoblaje'}, ${relation.notes || ''})
    ON CONFLICT (project_id, studio_id) DO UPDATE SET
      role = EXCLUDED.role,
      notes = EXCLUDED.notes
  `);

  const episodeQueries = seed.episodes.map(episode => sql`
    INSERT INTO episodes (
      id, project_id, season, number, title, description, provider, video_url,
      archive_identifier, archive_file, status, published, updated_at
    ) VALUES (
      ${episode.id}, ${episode.projectId}, ${Number(episode.season || 1)}, ${Number(episode.number)},
      ${episode.title}, ${episode.description || ''}, ${episode.provider || 'ARCHIVE'},
      ${episode.videoUrl || ''}, ${episode.archiveIdentifier || null}, ${episode.archiveFile || null},
      ${episode.status || 'DRAFT'}, ${Boolean(episode.published)}, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      project_id = EXCLUDED.project_id,
      season = EXCLUDED.season,
      number = EXCLUDED.number,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      provider = EXCLUDED.provider,
      video_url = EXCLUDED.video_url,
      archive_identifier = EXCLUDED.archive_identifier,
      archive_file = EXCLUDED.archive_file,
      status = EXCLUDED.status,
      published = EXCLUDED.published,
      updated_at = now()
  `);

  const settingsQueries = Object.entries(seed.settings || {}).map(([key, value]) => sql`
    INSERT INTO settings (key, value)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);

  for (const batch of [projectQueries, studioQueries, relationQueries, episodeQueries, settingsQueries]) {
    if (batch.length) await sql.transaction(batch);
  }

  return {
    projects: seed.projects.length,
    studios: seed.studios.length,
    episodes: seed.episodes.length,
    relations: seed.projectStudios.length,
    warnings: seed.warnings || []
  };
}
