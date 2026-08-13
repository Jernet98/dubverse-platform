import crypto from 'node:crypto';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

let authInstance = null;
let authPool = null;

function providerPair(idName, secretName) {
  const clientId = process.env[idName]?.trim();
  const clientSecret = process.env[secretName]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function configuredSocialProviders() {
  const providers = [];
  if (providerPair('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')) providers.push('google');
  if (providerPair('DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET')) providers.push('discord');
  return providers;
}

function configuredBaseUrl() {
  try {
    const url = new URL(process.env.BETTER_AUTH_URL || '');
    if (!['http:', 'https:'].includes(url.protocol) || (url.pathname && url.pathname !== '/')) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function userAuthStatus() {
  const providers = configuredSocialProviders();
  const database = Boolean(process.env.DATABASE_URL?.trim());
  const secret = Boolean(process.env.BETTER_AUTH_SECRET?.trim() && process.env.BETTER_AUTH_SECRET.trim().length >= 32);
  const baseUrl = configuredBaseUrl();
  return { available: Boolean(database && secret && baseUrl && providers.length > 0), database, secret, baseUrl, providers };
}

function trustedOrigins() {
  const origins = new Set(
    String(process.env.BETTER_AUTH_TRUSTED_ORIGINS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );
  if (process.env.BETTER_AUTH_URL) origins.add(process.env.BETTER_AUTH_URL.replace(/\/$/, ''));
  if (process.env.NODE_ENV !== 'production') origins.add('http://localhost:3000');
  return [...origins];
}

function authFields() {
  return {
    user: {
      modelName: 'auth_users',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
      deleteUser: {
        enabled: true,
        beforeDelete: async user => {
          const { deleteUserMediaByAuthUser } = await import('@/lib/r2');
          await deleteUserMediaByAuthUser(user.id);
        }
      }
    },
    session: {
      modelName: 'auth_sessions',
      fields: {
        expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at',
        ipAddress: 'ip_address', userAgent: 'user_agent', userId: 'user_id'
      },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 60
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        accountId: 'account_id', providerId: 'provider_id', userId: 'user_id',
        accessToken: 'access_token', refreshToken: 'refresh_token', idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at', refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at', updatedAt: 'updated_at'
      },
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false
      }
    },
    verification: {
      modelName: 'auth_verifications',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' }
    }
  };
}

export function getUserAuth() {
  if (authInstance) return authInstance;
  const status = userAuthStatus();
  if (!status.database) throw new Error('DATABASE_URL no está configurada para Better Auth.');
  if (!status.secret) throw new Error('BETTER_AUTH_SECRET debe tener al menos 32 caracteres.');
  if (!status.baseUrl) throw new Error('BETTER_AUTH_URL debe ser un origen HTTP(S) válido, sin ruta.');

  authPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000
  });

  const google = providerPair('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET');
  const discord = providerPair('DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET');
  const socialProviders = {};
  if (google) socialProviders.google = google;
  if (discord) {
    socialProviders.discord = {
      ...discord,
      mapProfileToUser: profile => ({
        email: profile.email || `discord-${crypto.createHash('sha256').update(String(profile.id)).digest('hex').slice(0, 32)}@oauth.invalid`,
        emailVerified: Boolean(profile.email && profile.verified)
      })
    };
  }
  const fields = authFields();

  authInstance = betterAuth({
    appName: 'Dubverse',
    baseURL: status.baseUrl,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authPool,
    emailAndPassword: { enabled: false },
    socialProviders,
    user: fields.user,
    session: fields.session,
    account: fields.account,
    verification: fields.verification,
    trustedOrigins: trustedOrigins(),
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limits',
      fields: { lastRequest: 'last_request' },
      window: 60,
      max: 100
    },
    advanced: {
      cookiePrefix: 'dubverse-user',
      useSecureCookies: process.env.NODE_ENV === 'production',
      database: { generateId: () => crypto.randomUUID() }
    }
  });
  return authInstance;
}
