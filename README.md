# Dubverse 2.0 — Next.js + Neon + Archive.org

Esta es la versión completa de Dubverse. La página pública, el panel y el catálogo se alimentan desde Neon; ya no hay que editar `data.js` ni crear un HTML por anime.

## Incluye

- Página pública responsive con catálogo, buscador, estudios y reproductores.
- Neon PostgreSQL para proyectos, estudios, relaciones y episodios.
- Panel protegido en `/admin`.
- Alta, edición y eliminación de proyectos, estudios y episodios.
- Relación de uno o varios estudios con cada proyecto.
- Estados de Archive.org: `UPLOADING`, `PROCESSING`, `READY`, `PUBLISHED` y `ERROR`.
- Importador inicial en `/setup` para los 13 proyectos, 9 estudios y 86 episodios recuperados.
- Subida opcional de portadas, banners y logos mediante Vercel Blob.
- Dubverse Uploader para enviar MP4 directamente desde Windows a Archive.org sin entregar las claves de Archive a Vercel.

## Variables de Vercel

Obligatorias:

```env
DATABASE_URL=...
ADMIN_ACCESS_KEY=...
AUTH_SECRET=...
```

Opcional para subir imágenes desde el panel:

```env
BLOB_READ_WRITE_TOKEN=...
```

`AUTH_SECRET` debe ser distinto de la clave administrativa y tener al menos 32 caracteres.

## Primera instalación

1. Sustituye el contenido del repositorio por los archivos de este paquete.
2. Espera el despliegue de Vercel.
3. Crea o conecta una base Neon y copia su cadena de conexión a `DATABASE_URL`.
4. Agrega `ADMIN_ACCESS_KEY` y `AUTH_SECRET` en Vercel para Production, Preview y Development.
5. Haz Redeploy.
6. Abre `https://TU-DOMINIO.vercel.app/setup`.
7. Escribe la misma `ADMIN_ACCESS_KEY` y pulsa **Crear o actualizar base**.
8. Entra a `/admin`.

## Imágenes

Las imágenes antiguas siguen dentro de `public/assets`. Para nuevas imágenes puedes:

- pegar una URL;
- conservar una ruta de `/assets/...` añadida manualmente al repositorio;
- conectar Vercel Blob y usar el botón **Subir** del panel.

El panel limita las imágenes a 4 MB porque las funciones de Vercel tienen límite de cuerpo de solicitud. Los MP4 nunca pasan por Vercel.

## Videos de Archive.org

1. Ejecuta `uploader/INICIAR_UPLOADER.bat` en tu computadora.
2. URL de Dubverse: `https://dubverse-platform.vercel.app`.
3. Clave administrativa: el valor de `ADMIN_ACCESS_KEY`.
4. Coloca las claves S3 de Archive.org solamente dentro del cargador.
5. Selecciona proyecto, número y MP4.
6. Cuando la transferencia termine, el episodio quedará en `PROCESSING`.
7. En `/admin`, usa **Revisar Archive**.
8. Cuando cambie a `READY`, edítalo, marca **Publicado** y selecciona `PUBLISHED`.

## Desarrollo local

```bash
npm install
copy .env.example .env.local
npm run dev
```

Después abre `http://localhost:3000/setup` y realiza la importación.

## Seguridad

- No subas `.env.local` a GitHub.
- No coloques las claves de Archive.org en Vercel o en el repositorio.
- El panel usa una cookie `HttpOnly`, `SameSite=Strict` y firmada con `AUTH_SECRET`.
- Dubverse Uploader puede autenticarse por `X-Admin-Key` sin guardar la clave en el código.
