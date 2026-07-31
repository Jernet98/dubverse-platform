export function mapProject(row, extra = {}) {
  const genres = Array.isArray(row.genres) ? row.genres : [];
  return {
    id: row.id,
    legacyKey: row.legacy_key || '',
    legacy_key: row.legacy_key || '',
    type: row.type,
    title: row.title,
    alternateTitle: row.alternate_title || '',
    alternate_title: row.alternate_title || '',
    synopsis: row.synopsis || '',
    status: row.status,
    genres,
    poster: row.poster || '',
    banner: row.banner || '',
    published: Boolean(row.published),
    featured: Boolean(row.featured),
    legacyPath: row.legacy_path || '',
    legacy_path: row.legacy_path || '',
    episodeCount: Number(row.episode_count || extra.episodeCount || 0),
    studios: extra.studios || [],
    episodes: extra.episodes || []
  };
}

export function mapStudio(row, extra = {}) {
  return {
    id: row.id,
    name: row.name,
    director: row.director || '',
    description: row.description || '',
    logo: row.logo || '',
    socials: row.socials && typeof row.socials === 'object' ? row.socials : {},
    published: Boolean(row.published),
    projects: extra.projects || []
  };
}

export function mapEpisode(row, extra = {}) {
  return {
    id: row.id,
    projectId: row.project_id,
    project_id: row.project_id,
    projectTitle: row.project_title || extra.project?.title || '',
    project_title: row.project_title || extra.project?.title || '',
    season: Number(row.season),
    number: Number(row.number),
    title: row.title,
    description: row.description || '',
    provider: row.provider,
    videoUrl: row.video_url || '',
    video_url: row.video_url || '',
    archiveIdentifier: row.archive_identifier || '',
    archive_identifier: row.archive_identifier || '',
    archiveFile: row.archive_file || '',
    archive_file: row.archive_file || '',
    status: row.status,
    published: Boolean(row.published),
    project: extra.project || null
  };
}
