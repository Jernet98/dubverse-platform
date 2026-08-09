import { neon } from '@neondatabase/serverless';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

const execute = process.argv.includes('--execute');
const hoursArgument = process.argv.find(argument => argument.startsWith('--hours='));
const hours = Number(hoursArgument?.split('=')[1] || 24);
const required = ['DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_UPLOAD_BUCKET', 'R2_PUBLIC_BUCKET'];

if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
  console.error('Usa --hours=N con un valor entre 1 y 720.');
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL. El script no realizó ninguna acción.');
  process.exitCode = 1;
} else {
  const sql = neon(process.env.DATABASE_URL, { fetchOptions: { cache: 'no-store' } });
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const pendingRows = await sql`
    SELECT id, status, source_object_key, created_at
    FROM user_media_uploads
    WHERE (status = 'PENDING' AND created_at < ${cutoff})
       OR (status = 'REJECTED' AND deleted_at IS NULL)
    ORDER BY created_at ASC LIMIT 500
  `;
  const deletedRows = await sql`
    SELECT id, status, object_key, created_at
    FROM user_media_uploads
    WHERE status = 'DELETED' AND object_key IS NOT NULL
    ORDER BY deleted_at ASC NULLS FIRST LIMIT 500
  `;

  console.log(`${execute ? 'EJECUCIÓN' : 'DRY-RUN'}: ${pendingRows.length} temporal(es) abandonado(s) y ${deletedRows.length} objeto(s) público(s) marcado(s) DELETED.`);
  for (const row of pendingRows) console.log(`TEMPORAL ${row.status}  ${row.id}  ${row.created_at}  ${row.source_object_key}`);
  for (const row of deletedRows) console.log(`PÚBLICO DELETED  ${row.id}  ${row.created_at}  ${row.object_key}`);

  if (execute && (pendingRows.length || deletedRows.length)) {
    const missing = required.filter(name => !process.env[name]);
    if (missing.length) throw new Error(`Faltan variables: ${missing.join(', ')}. No se modificó ningún registro.`);
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
    });
    for (const row of pendingRows) {
      await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_UPLOAD_BUCKET, Key: row.source_object_key }));
      await sql`
        UPDATE user_media_uploads
        SET status = 'REJECTED', rejection_reason = COALESCE(rejection_reason, 'Subida temporal abandonada.'),
          validated_at = COALESCE(validated_at, now()), deleted_at = now()
        WHERE id = ${row.id} AND status IN ('PENDING','REJECTED')
      `;
      console.log(`Temporal eliminado: ${row.id}`);
    }
    for (const row of deletedRows) {
      await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_PUBLIC_BUCKET, Key: row.object_key }));
      await sql`UPDATE user_media_uploads SET object_key = NULL, public_url = NULL WHERE id = ${row.id} AND status = 'DELETED'`;
      console.log(`Público eliminado: ${row.id}`);
    }
  } else if (!execute) {
    console.log('No se modificó PostgreSQL ni R2. Agrega --execute sólo después de revisar esta lista.');
  }
}
