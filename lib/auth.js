import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { AppError } from '@/lib/db';

const COOKIE_NAME = 'dubverse_session';
const SESSION_SECONDS = 60 * 60 * 12;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function secrets() {
  const adminKey = process.env.ADMIN_ACCESS_KEY;
  const authSecret = process.env.AUTH_SECRET;
  if (!adminKey) throw new AppError(503, 'Falta configurar ADMIN_ACCESS_KEY en Vercel.');
  if (!authSecret || authSecret.length < 32) throw new AppError(503, 'Falta configurar AUTH_SECRET con al menos 32 caracteres.');
  return { adminKey, authSecret };
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function verifyAdminKey(value) {
  const { adminKey } = secrets();
  return safeEqual(value, adminKey);
}

export function createSessionToken() {
  const { authSecret } = secrets();
  const payload = `${Date.now() + SESSION_SECONDS * 1000}.${crypto.randomBytes(18).toString('base64url')}`;
  return `${payload}.${sign(payload, authSecret)}`;
}

export function validSessionToken(token) {
  if (!token) return false;
  const { authSecret } = secrets();
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], sign(payload, authSecret))) return false;
  const expiresAt = Number(parts[0]);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function isAdminRequest(request) {
  const directKey = request.headers.get('x-admin-key');
  if (directKey && verifyAdminKey(directKey)) return true;
  return validSessionToken(request.cookies.get(COOKIE_NAME)?.value);
}

export function requireAdmin(request) {
  if (!isAdminRequest(request)) throw new AppError(401, 'Sesión administrativa requerida.');
}

export function loginResponse(payload = { ok: true }) {
  const response = NextResponse.json(payload);
  response.cookies.set(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_SECONDS
  });
  return response;
}

export function logoutResponse() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0
  });
  return response;
}
