import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

import { AppError } from './db.js';

let imagesClient = null;

function httpsUrl(value, label, { r2Endpoint = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(503, `${label} no contiene una URL válida.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new AppError(503, `${label} debe ser una URL HTTPS sin credenciales.`);
  }
  if (r2Endpoint && !url.hostname.endsWith('.r2.cloudflarestorage.com')) {
    throw new AppError(503, `${label} debe usar el endpoint S3 oficial de Cloudflare R2.`);
  }
  return url.toString().replace(/\/$/, '');
}

function config() {
  const endpoint = String(process.env.R2_IMAGES_ENDPOINT || '').trim();
  const accessKeyId = String(process.env.R2_IMAGES_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_IMAGES_SECRET_ACCESS_KEY || '').trim();
  const bucket = String(process.env.R2_IMAGES_BUCKET || '').trim();
  const publicUrl = String(process.env.R2_IMAGES_PUBLIC_URL || '').trim().replace(/\/$/, '');

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    throw new AppError(503, 'Cloudflare R2 Images todavía no está configurado.');
  }

  if (!/^[A-Za-z0-9]{32}$/.test(accessKeyId)) {
    throw new AppError(503, 'R2_IMAGES_ACCESS_KEY_ID no es válida: debe contener exactamente 32 caracteres.');
  }
  if (secretAccessKey.length < 40) {
    throw new AppError(503, 'R2_IMAGES_SECRET_ACCESS_KEY no parece una credencial R2 válida.');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new AppError(503, 'R2_IMAGES_BUCKET no contiene un nombre de bucket válido.');
  }

  return {
    endpoint: httpsUrl(endpoint, 'R2_IMAGES_ENDPOINT', { r2Endpoint: true }),
    accessKeyId,
    secretAccessKey,
    bucket,
    publicUrl: httpsUrl(publicUrl, 'R2_IMAGES_PUBLIC_URL')
  };
}

function client() {
  if (imagesClient) return imagesClient;

  const current = config();

  imagesClient = new S3Client({
    region: 'auto',
    endpoint: current.endpoint,
    credentials: {
      accessKeyId: current.accessKeyId,
      secretAccessKey: current.secretAccessKey
    }
  });

  return imagesClient;
}

export function r2ImagesStatus() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

export function r2ImageUrl(key) {
  const { publicUrl } = config();

  return `${publicUrl}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

export async function uploadR2Image(key, bytes, contentType) {
  const current = config();

  try {
    await client().send(new PutObjectCommand({
      Bucket: current.bucket,
      Key: key,
      Body: Buffer.from(bytes),
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable'
    }));
  } catch (error) {
    const code = String(error?.name || error?.Code || error?.code || '');
    if (/InvalidAccessKeyId|InvalidArgument/i.test(code)) {
      throw new AppError(503, 'Cloudflare R2 rechazó R2_IMAGES_ACCESS_KEY_ID. Revisa que la Access Key ID esté completa y pertenezca al token S3 de R2.');
    }
    if (/SignatureDoesNotMatch|InvalidToken/i.test(code)) {
      throw new AppError(503, 'Cloudflare R2 rechazó las credenciales. Revisa R2_IMAGES_SECRET_ACCESS_KEY y el endpoint de la cuenta.');
    }
    if (/AccessDenied|Unauthorized|Forbidden/i.test(code) || [401, 403].includes(Number(error?.$metadata?.httpStatusCode))) {
      throw new AppError(503, 'El token de Cloudflare R2 no tiene permiso para escribir en el bucket configurado.');
    }
    if (/NoSuchBucket/i.test(code) || Number(error?.$metadata?.httpStatusCode) === 404) {
      throw new AppError(503, 'Cloudflare R2 no encontró R2_IMAGES_BUCKET en la cuenta configurada.');
    }
    console.error('[R2 Images upload]', {
      code: code || 'R2UploadError',
      status: error?.$metadata?.httpStatusCode || null
    });
    throw new AppError(502, 'Cloudflare R2 no pudo completar la subida. Revisa el endpoint y vuelve a intentarlo.');
  }

  return {
    url: r2ImageUrl(key),
    pathname: key
  };
}

export function isManagedR2ImageUrl(value) {
  if (!value || !r2ImagesStatus()) return false;

  try {
    const target = new URL(String(value));
    const base = new URL(config().publicUrl);

    return target.origin === base.origin;
  } catch {
    return false;
  }
}

export async function deleteR2ImageByUrl(value) {
  if (!isManagedR2ImageUrl(value)) return false;

  const current = config();
  const url = new URL(String(value));
  const base = new URL(current.publicUrl);

  let key = decodeURIComponent(
    url.pathname.substring(base.pathname.length).replace(/^\/+/, '')
  );

  if (!key) return false;

  await client().send(new DeleteObjectCommand({
    Bucket: current.bucket,
    Key: key
  }));

  return true;
}
