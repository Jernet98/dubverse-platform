import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

import { AppError } from './db.js';

let imagesClient = null;

function config() {
  const endpoint = String(process.env.R2_IMAGES_ENDPOINT || '').trim();
  const accessKeyId = String(process.env.R2_IMAGES_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_IMAGES_SECRET_ACCESS_KEY || '').trim();
  const bucket = String(process.env.R2_IMAGES_BUCKET || '').trim();
  const publicUrl = String(process.env.R2_IMAGES_PUBLIC_URL || '').trim().replace(/\/$/, '');

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    throw new AppError(503, 'Cloudflare R2 Images todavía no está configurado.');
  }

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicUrl
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
  return Boolean(
    process.env.R2_IMAGES_ENDPOINT?.trim()
    && process.env.R2_IMAGES_ACCESS_KEY_ID?.trim()
    && process.env.R2_IMAGES_SECRET_ACCESS_KEY?.trim()
    && process.env.R2_IMAGES_BUCKET?.trim()
    && process.env.R2_IMAGES_PUBLIC_URL?.trim()
  );
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

  await client().send(new PutObjectCommand({
    Bucket: current.bucket,
    Key: key,
    Body: Buffer.from(bytes),
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable'
  }));

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