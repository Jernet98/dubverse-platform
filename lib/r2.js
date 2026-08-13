import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { AppError, getSql } from './db.js';
import { MEDIA_POLICIES } from './social-validation.js';

let r2Client = null;

export function r2Status() {
  const names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_UPLOAD_BUCKET', 'R2_PUBLIC_BUCKET', 'R2_PUBLIC_URL'];
  const configured = names.every(name => Boolean(process.env[name]?.trim()));
  return { configured };
}

function config() {
  if (!r2Status().configured) throw new AppError(503, 'Cloudflare R2 todavía no está configurado.');
  return {
    accountId: process.env.R2_ACCOUNT_ID.trim(),
    accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
    uploadBucket: process.env.R2_UPLOAD_BUCKET.trim(),
    publicBucket: process.env.R2_PUBLIC_BUCKET.trim(),
    publicUrl: process.env.R2_PUBLIC_URL.trim().replace(/\/$/, '')
  };
}

function client() {
  if (r2Client) return r2Client;
  const current = config();
  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${current.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: current.accessKeyId, secretAccessKey: current.secretAccessKey }
  });
  return r2Client;
}

export function pendingObjectKey(profileId, purpose, uploadId) {
  return `pending/${profileId}/${purpose.toLowerCase()}/${uploadId}`;
}

export function activeObjectKey(profileId, purpose, uploadId, targetId = '') {
  if (purpose === 'COMMENT') return `comments/${profileId}/${targetId}/${uploadId}.webp`;
  return `users/${profileId}/${MEDIA_POLICIES[purpose].prefix}/${uploadId}.webp`;
}

export function publicObjectUrl(key) {
  const base = config().publicUrl;
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function presignedPutUrl(key, contentType) {
  const current = config();
  return getSignedUrl(client(), new PutObjectCommand({
    Bucket: current.uploadBucket,
    Key: key,
    ContentType: contentType
  }), { expiresIn: 300 });
}

export async function deleteR2Object(key, { pending = false } = {}) {
  if (!key) return;
  const current = config();
  await client().send(new DeleteObjectCommand({ Bucket: pending ? current.uploadBucket : current.publicBucket, Key: key }));
}

function detectedImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return '';
}

export async function processImageBuffer(bytes, purpose) {
  const policy = MEDIA_POLICIES[purpose];
  if (!policy) throw new AppError(400, 'Tipo de imagen no permitido.');
  const detectedType = detectedImageType(bytes);
  if (!detectedType) throw new AppError(400, 'El archivo no contiene una imagen JPEG, PNG o WebP válida.');
  const pipeline = sharp(bytes, { animated: true, limitInputPixels: 40_000_000 });
  const metadata = await pipeline.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format) || Number(metadata.pages || 1) !== 1) {
    throw new AppError(400, 'La imagen está animada o usa un formato no permitido.');
  }
  if (!metadata.width || !metadata.height || metadata.width > 12000 || metadata.height > 12000) {
    throw new AppError(400, 'Las dimensiones originales de la imagen no son razonables.');
  }
  const output = await pipeline
    .rotate()
    .resize({ width: policy.width, height: policy.height, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { detectedType, output };
}

export async function validateAndProcessUpload({ sourceKey, destinationKey, purpose }) {
  const current = config();
  const policy = MEDIA_POLICIES[purpose];
  if (!policy) throw new AppError(400, 'Tipo de imagen no permitido.');
  const head = await client().send(new HeadObjectCommand({ Bucket: current.uploadBucket, Key: sourceKey }));
  const storedBytes = Number(head.ContentLength || 0);
  if (!storedBytes || storedBytes > policy.maxBytes) throw new AppError(400, 'El tamaño real de la imagen no es válido.');
  const object = await client().send(new GetObjectCommand({ Bucket: current.uploadBucket, Key: sourceKey }));
  const bytes = Buffer.from(await object.Body.transformToByteArray());
  if (bytes.length !== storedBytes || bytes.length > policy.maxBytes) throw new AppError(400, 'El tamaño real de la imagen no coincide con la subida.');
  const { detectedType, output } = await processImageBuffer(bytes, purpose);

  await client().send(new PutObjectCommand({
    Bucket: current.publicBucket,
    Key: destinationKey,
    Body: output.data,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable'
  }));
  await deleteR2Object(sourceKey, { pending: true });
  return {
    contentType: detectedType,
    outputContentType: 'image/webp',
    byteSize: output.data.length,
    width: output.info.width,
    height: output.info.height,
    url: publicObjectUrl(destinationKey)
  };
}

export async function rejectPendingObject(sourceKey) {
  try {
    await deleteR2Object(sourceKey, { pending: true });
  } catch {}
}

export async function deleteUserMediaByAuthUser(authUserId) {
  const sql = getSql();
  const rows = await sql`
    SELECT m.object_key, m.source_object_key
    FROM user_media_uploads m
    JOIN user_profiles p ON p.id = m.owner_profile_id
    WHERE p.auth_user_id = ${authUserId} AND m.status <> 'DELETED'
  `;
  if (rows.length && !r2Status().configured) {
    throw new AppError(503, 'No se puede eliminar la cuenta hasta configurar R2 para limpiar sus imágenes.');
  }
  for (const row of rows) {
    if (row.object_key) await deleteR2Object(row.object_key);
    if (row.source_object_key) await deleteR2Object(row.source_object_key, { pending: true });
  }
}
