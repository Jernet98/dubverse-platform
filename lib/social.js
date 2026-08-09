import crypto from 'node:crypto';
import { AppError, getSql } from '@/lib/db';
import { getUserAuth, userAuthStatus } from '@/lib/user-auth';
import { displayNameValue, initialUsername } from '@/lib/social-validation';

export function dateValue(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function mediaUrl(row, prefix) {
  return row?.[`${prefix}_url`] || row?.[`${prefix}_fallback`] || '';
}

export function mapSocialProfile(row, { privateView = false } = {}) {
  if (!row) return null;
  const profile = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar_url || row.provider_image || '',
    banner: row.banner_url || '',
    bio: row.bio || '',
    status: row.status,
    joinedAt: dateValue(row.joined_at),
    updatedAt: dateValue(row.updated_at)
  };
  if (privateView) profile.authUserId = row.auth_user_id;
  return profile;
}

export async function findProfileByAuthUser(authUserId, sql = getSql()) {
  const rows = await sql`
    SELECT p.*, au.image AS provider_image,
      avatar.public_url AS avatar_url,
      banner.public_url AS banner_url
    FROM user_profiles p
    JOIN auth_users au ON au.id = p.auth_user_id
    LEFT JOIN user_media_uploads avatar ON avatar.id = p.avatar_media_id AND avatar.status = 'ACTIVE'
    LEFT JOIN user_media_uploads banner ON banner.id = p.banner_media_id AND banner.status = 'ACTIVE'
    WHERE p.auth_user_id = ${authUserId}
  `;
  return rows[0] || null;
}

export async function ensureProfileForAuthUser(user, sql = getSql()) {
  const existing = await findProfileByAuthUser(user.id, sql);
  if (existing) return existing;
  const root = initialUsername(user.name, user.id);
  let displayName = 'Fan de Dubverse';
  try { displayName = displayNameValue(user.name || displayName); } catch {}
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const suffix = attempt ? `_${crypto.randomBytes(2).toString('hex')}` : '';
    const username = `${root.slice(0, 30 - suffix.length)}${suffix}`;
    const rows = await sql`
      INSERT INTO user_profiles (id, auth_user_id, username, display_name)
      VALUES (${crypto.randomUUID()}::uuid, ${user.id}, ${username}, ${displayName})
      ON CONFLICT DO NOTHING
      RETURNING *
    `;
    if (rows.length) return findProfileByAuthUser(user.id, sql);
    const raced = await findProfileByAuthUser(user.id, sql);
    if (raced) return raced;
  }
  throw new AppError(409, 'No fue posible generar un username único. Intenta nuevamente.');
}

export async function socialSession(request, { required = false, active = false } = {}) {
  const status = userAuthStatus();
  if (!status.database || !status.secret || !status.baseUrl) {
    if (required) throw new AppError(401, 'Inicia sesión para continuar.');
    return null;
  }
  const session = await getUserAuth().api.getSession({ headers: request.headers });
  if (!session?.user) {
    if (required) throw new AppError(401, 'Inicia sesión para continuar.');
    return null;
  }
  const sql = getSql();
  const row = await ensureProfileForAuthUser(session.user, sql);
  if (active && row.status !== 'ACTIVE') throw new AppError(403, 'Tu cuenta está suspendida para operaciones sociales.');
  return { auth: session, profile: mapSocialProfile(row, { privateView: true }), row, sql };
}

export function assertSocialWriteOrigin(request) {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') throw new AppError(403, 'Solicitud de origen no permitido.');
  const origin = request.headers.get('origin');
  if (!origin) return;
  const allowed = new Set([request.nextUrl.origin]);
  if (process.env.BETTER_AUTH_URL) allowed.add(process.env.BETTER_AUTH_URL.replace(/\/$/, ''));
  String(process.env.BETTER_AUTH_TRUSTED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).forEach(value => allowed.add(value));
  if (!allowed.has(origin)) throw new AppError(403, 'Solicitud de origen no permitido.');
}

export async function jsonBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new AppError(415, 'Se requiere Content-Type application/json.');
  }
  return request.json().catch(() => { throw new AppError(400, 'JSON inválido.'); });
}

export async function enforceSocialRateLimit(sql, profileId, action, max, windowSeconds) {
  const key = `${profileId}:${action}`;
  const expiresAt = new Date(Date.now() + windowSeconds * 1000);
  const rows = await sql`
    INSERT INTO social_rate_limits (key, count, window_started_at, expires_at, updated_at)
    VALUES (${key}, 1, now(), ${expiresAt}, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN social_rate_limits.expires_at <= now() THEN 1 ELSE social_rate_limits.count + 1 END,
      window_started_at = CASE WHEN social_rate_limits.expires_at <= now() THEN now() ELSE social_rate_limits.window_started_at END,
      expires_at = CASE WHEN social_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE social_rate_limits.expires_at END,
      updated_at = now()
    RETURNING count, expires_at
  `;
  if (Number(rows[0].count) > max) {
    const error = new AppError(429, 'Demasiadas acciones. Espera un momento antes de intentarlo otra vez.');
    error.retryAfter = Math.max(1, Math.ceil((new Date(rows[0].expires_at).getTime() - Date.now()) / 1000));
    throw error;
  }
}

export function socialErrorResponse(error) {
  const databaseStatus = error?.code === '23505' ? 409 : error?.code === '22P02' ? 400 : null;
  const status = Number(error?.status || error?.statusCode || databaseStatus || 500);
  const headers = { 'Cache-Control': 'no-store' };
  if (error?.retryAfter) headers['Retry-After'] = String(error.retryAfter);
  const message = error?.code === '23505' ? 'Ese valor ya está registrado.' : error?.code === '22P02' ? 'El identificador no es válido.' : error.message;
  return Response.json({ error: status >= 500 ? 'Error interno del servicio social.' : message }, { status, headers });
}
