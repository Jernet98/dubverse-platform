import { toNextJsHandler } from 'better-auth/next-js';
import { getUserAuth, userAuthStatus } from '@/lib/user-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let handlers = null;

async function handle(request) {
  const status = userAuthStatus();
  if (!status.database || !status.secret || !status.baseUrl) {
    return Response.json({ error: 'La autenticación pública todavía no está configurada.' }, { status: 503 });
  }
  try {
    handlers ||= toNextJsHandler(getUserAuth());
    return await handlers[request.method](request);
  } catch (error) {
    console.error('Better Auth:', error);
    return Response.json({ error: 'No fue posible procesar la autenticación.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
