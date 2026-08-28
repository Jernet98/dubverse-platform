export async function notifyGlobalStudio(sql, studioId) {
  const rows = await sql`WITH inserted AS (
    INSERT INTO social_notifications (id,recipient_profile_id,actor_profile_id,type,target_type,target_id,studio_id,dedupe_key)
    SELECT gen_random_uuid(),p.id,NULL,'GLOBAL_NEW_STUDIO','STUDIO',NULL,${studioId},'publication:studio:'||${studioId}||':'||p.id::text
    FROM user_profiles p WHERE p.status='ACTIVE' ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ) SELECT COUNT(*)::int AS count FROM inserted`;
  return Number(rows[0]?.count || 0);
}

export async function notifyGlobalProject(sql, projectId) {
  const rows = await sql`WITH inserted AS (
    INSERT INTO social_notifications (id,recipient_profile_id,actor_profile_id,type,target_type,target_id,project_id,dedupe_key)
    SELECT gen_random_uuid(),p.id,NULL,'GLOBAL_NEW_PROJECT','PROJECT',NULL,${projectId},'publication:project:'||${projectId}||':'||p.id::text
    FROM user_profiles p WHERE p.status='ACTIVE' ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ) SELECT COUNT(*)::int AS count FROM inserted`;
  return Number(rows[0]?.count || 0);
}

export async function notifyRelatedEpisode(sql, projectId, episodeId) {
  const rows = await sql`WITH recipients AS (
    SELECT user_profile_id AS id FROM favorites WHERE project_id=${projectId}
    UNION SELECT sf.user_profile_id FROM studio_follows sf JOIN project_studios ps ON ps.studio_id=sf.studio_id WHERE ps.project_id=${projectId}
  ), inserted AS (
    INSERT INTO social_notifications (id,recipient_profile_id,actor_profile_id,type,target_type,target_id,project_id,episode_id,dedupe_key)
    SELECT gen_random_uuid(),p.id,NULL,'CONTENT_NEW_EPISODE','EPISODE',NULL,${projectId},${episodeId},'publication:episode:'||${episodeId}||':'||p.id::text
    FROM recipients r JOIN user_profiles p ON p.id=r.id AND p.status='ACTIVE'
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ) SELECT COUNT(*)::int AS count FROM inserted`;
  return Number(rows[0]?.count || 0);
}

function announcementResult(row, requestId) {
  return { id: row?.id || requestId, recipientCount: Number(row?.recipient_count || 0), repeated: !row?.created };
}

export async function sendAnnouncement(sql, value) {
  const key = `announcement:${value.requestId}`;
  const base = [value.requestId, value.title, value.message, value.imageUrl || '', value.linkUrl || '', value.audienceType, value.audienceId, key];
  let rows;
  if (value.audienceType === 'ALL') rows = await sql`WITH announcement AS (
    INSERT INTO admin_announcements (id,title,message,image_url,link_url,audience_type,audience_id,dedupe_key,recipient_count)
    VALUES (${base[0]}::uuid,${base[1]},${base[2]},${base[3]},${base[4]},${base[5]},${base[6]},${base[7]},0)
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ), recipients AS (SELECT p.id FROM announcement a CROSS JOIN user_profiles p WHERE p.status='ACTIVE'), inserted AS (
    INSERT INTO social_notifications (id,recipient_profile_id,actor_profile_id,type,target_type,target_id,title,message,image_url,link_url,dedupe_key)
    SELECT gen_random_uuid(),r.id,NULL,'ADMIN_ANNOUNCEMENT','ANNOUNCEMENT',NULL,${base[1]},${base[2]},${base[3]},${base[4]},${base[7]}||':'||r.id::text FROM recipients r
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ), updated AS (UPDATE admin_announcements a SET recipient_count=(SELECT COUNT(*) FROM inserted) FROM announcement n WHERE a.id=n.id RETURNING a.id,a.recipient_count,true AS created)
  SELECT * FROM updated UNION ALL SELECT id,recipient_count,false FROM admin_announcements WHERE dedupe_key=${base[7]} AND NOT EXISTS (SELECT 1 FROM updated) LIMIT 1`;
  if (value.audienceType === 'STUDIO_FOLLOWERS') rows = await sql`WITH announcement AS (
    INSERT INTO admin_announcements (id,title,message,image_url,link_url,audience_type,audience_id,dedupe_key,recipient_count)
    VALUES (${base[0]}::uuid,${base[1]},${base[2]},${base[3]},${base[4]},${base[5]},${base[6]},${base[7]},0)
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ), recipients AS (SELECT p.id FROM announcement a CROSS JOIN studio_follows f JOIN user_profiles p ON p.id=f.user_profile_id WHERE p.status='ACTIVE' AND f.studio_id=${base[6]}), inserted AS (
    INSERT INTO social_notifications (id,recipient_profile_id,actor_profile_id,type,target_type,target_id,studio_id,title,message,image_url,link_url,dedupe_key)
    SELECT gen_random_uuid(),r.id,NULL,'ADMIN_ANNOUNCEMENT','ANNOUNCEMENT',NULL,${base[6]},${base[1]},${base[2]},${base[3]},${base[4]},${base[7]}||':'||r.id::text FROM recipients r
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ), updated AS (UPDATE admin_announcements a SET recipient_count=(SELECT COUNT(*) FROM inserted) FROM announcement n WHERE a.id=n.id RETURNING a.id,a.recipient_count,true AS created)
  SELECT * FROM updated UNION ALL SELECT id,recipient_count,false FROM admin_announcements WHERE dedupe_key=${base[7]} AND NOT EXISTS (SELECT 1 FROM updated) LIMIT 1`;
  if (value.audienceType === 'PROJECT_FOLLOWERS') rows = await sql`WITH announcement AS (
    INSERT INTO admin_announcements (id,title,message,image_url,link_url,audience_type,audience_id,dedupe_key,recipient_count)
    VALUES (${base[0]}::uuid,${base[1]},${base[2]},${base[3]},${base[4]},${base[5]},${base[6]},${base[7]},0)
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ), recipients AS (
    SELECT f.user_profile_id AS id FROM announcement a CROSS JOIN favorites f WHERE f.project_id=${base[6]}
    UNION SELECT sf.user_profile_id FROM announcement a CROSS JOIN studio_follows sf JOIN project_studios ps ON ps.studio_id=sf.studio_id WHERE ps.project_id=${base[6]}
  ), active_recipients AS (SELECT DISTINCT p.id FROM recipients r JOIN user_profiles p ON p.id=r.id AND p.status='ACTIVE'), inserted AS (
    INSERT INTO social_notifications (id,recipient_profile_id,actor_profile_id,type,target_type,target_id,project_id,title,message,image_url,link_url,dedupe_key)
    SELECT gen_random_uuid(),r.id,NULL,'ADMIN_ANNOUNCEMENT','ANNOUNCEMENT',NULL,${base[6]},${base[1]},${base[2]},${base[3]},${base[4]},${base[7]}||':'||r.id::text FROM active_recipients r
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ), updated AS (UPDATE admin_announcements a SET recipient_count=(SELECT COUNT(*) FROM inserted) FROM announcement n WHERE a.id=n.id RETURNING a.id,a.recipient_count,true AS created)
  SELECT * FROM updated UNION ALL SELECT id,recipient_count,false FROM admin_announcements WHERE dedupe_key=${base[7]} AND NOT EXISTS (SELECT 1 FROM updated) LIMIT 1`;
  if (value.audienceType === 'USER') rows = await sql`WITH announcement AS (
    INSERT INTO admin_announcements (id,title,message,image_url,link_url,audience_type,audience_id,dedupe_key,recipient_count)
    VALUES (${base[0]}::uuid,${base[1]},${base[2]},${base[3]},${base[4]},${base[5]},${base[6]},${base[7]},0)
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ), recipients AS (SELECT p.id FROM announcement a CROSS JOIN user_profiles p WHERE p.status='ACTIVE' AND lower(p.username)=lower(${base[6]})), inserted AS (
    INSERT INTO social_notifications (id,recipient_profile_id,actor_profile_id,type,target_type,target_id,title,message,image_url,link_url,dedupe_key)
    SELECT gen_random_uuid(),r.id,NULL,'ADMIN_ANNOUNCEMENT','ANNOUNCEMENT',NULL,${base[1]},${base[2]},${base[3]},${base[4]},${base[7]}||':'||r.id::text FROM recipients r
    ON CONFLICT (dedupe_key) DO NOTHING RETURNING id
  ), updated AS (UPDATE admin_announcements a SET recipient_count=(SELECT COUNT(*) FROM inserted) FROM announcement n WHERE a.id=n.id RETURNING a.id,a.recipient_count,true AS created)
  SELECT * FROM updated UNION ALL SELECT id,recipient_count,false FROM admin_announcements WHERE dedupe_key=${base[7]} AND NOT EXISTS (SELECT 1 FROM updated) LIMIT 1`;
  return announcementResult(rows?.[0], value.requestId);
}
