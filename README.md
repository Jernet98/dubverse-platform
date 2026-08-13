# Dubverse 3.0 — Next.js + Neon + Archive.org

Dubverse genera el catálogo público y el panel administrativo desde Neon. Los capítulos se reproducen desde Archive.org u otros proveedores y las imágenes nuevas pueden guardarse en Vercel Blob.

## Incluye

- Página pública responsive para computadora y celular.
- Catálogo, buscador, estudios, fichas de proyecto y reproductores.
- Panel protegido en `/admin`.
- Proyectos, estudios, episodios y relaciones almacenados en Neon.
- Papelera con restauración y eliminación definitiva protegida.
- Respaldo JSON descargable desde el panel.
- Límite temporal después de intentos fallidos de inicio de sesión.
- Subida de imágenes con vista previa, estado de carga y limpieza de archivos reemplazados o cancelados.
- Limpieza automática de imágenes de Vercel Blob al sustituirlas o eliminar definitivamente un registro.
- Migraciones SQL explícitas y versionadas; las peticiones web normales nunca ejecutan DDL.
- Cuentas sociales Google/Discord, perfiles, likes, listas, historial, comentarios, reseñas y moderación (Social v1).
- Dubverse Uploader para enviar MP4 directamente desde Windows a Archive.org.

## Variables de Vercel

Obligatorias:

```env
DATABASE_URL=...
ADMIN_ACCESS_KEY=...
AUTH_SECRET=...
```

Para subir y eliminar imágenes desde el panel:

```env
BLOB_READ_WRITE_TOKEN=...
```

`AUTH_SECRET` debe tener al menos 32 caracteres y ser diferente de `ADMIN_ACCESS_KEY`.

`/setup` permanece cerrado salvo que se cree temporalmente:

```env
SETUP_ENABLED=true
```

No habilites `/setup` para ampliaciones. Aplica cada archivo de `database/migrations` manualmente después de revisarlo y respaldar la base. La API no aplica columnas automáticamente.

Las variables, callbacks OAuth, configuración de R2/CORS, activación y rollback de Social v1 están documentados en [docs/dubverse-social-v1.md](docs/dubverse-social-v1.md). Usa `.env.example` como inventario sin secretos.

## Imágenes

- Las imágenes antiguas permanecen en `public/assets`.
- El panel acepta una ruta local, una URL externa o una imagen de hasta 4 MB subida a Vercel Blob.
- Al reemplazar una imagen administrada por Dubverse, el archivo anterior se elimina si ya no está usado por otro registro.
- Los MP4 nunca pasan por Vercel Blob.
- Avatar, banner e imágenes de comentarios usan dos buckets Cloudflare R2 separados; las subidas temporales permanecen privadas hasta su validación.

## Videos de Archive.org

1. Ejecuta `uploader/INICIAR_UPLOADER.bat`.
2. Usa la URL pública de Dubverse y tu `ADMIN_ACCESS_KEY`.
3. Coloca las credenciales S3 de Archive.org únicamente en el cargador local.
4. Selecciona el proyecto, número y MP4.
5. El episodio quedará en `PROCESSING`.
6. Desde el panel usa **Revisar Archive** hasta que cambie a `READY`.
7. Edita el episodio, activa **Publicado** y cambia el estado a `PUBLISHED`.

## Seguridad

- No subas `.env.local` ni secretos a GitHub.
- El panel usa cookie `HttpOnly`, `Secure` en producción y `SameSite=Strict`.
- Las escrituras con sesión validan el origen de la solicitud.
- Cinco intentos fallidos bloquean temporalmente el acceso durante 15 minutos.
- La eliminación normal envía registros a la Papelera; la eliminación definitiva exige una confirmación adicional.
