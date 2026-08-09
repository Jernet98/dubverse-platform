# Dubverse Social v1 — operación y configuración

Esta ampliación conserva la SPA pública, el panel y la API existentes. Better Auth atiende únicamente `/api/auth/*`; la sesión administrativa `dubverse_session`, `ADMIN_ACCESS_KEY` y `AUTH_SECRET` no cambian. Ninguna petición web ejecuta DDL. El esquema social sólo se crea al aplicar manualmente `database/migrations/2026-08-09-social-v1.sql`.

## Orden de activación

1. Crear un respaldo de PostgreSQL.
2. Revisar y aplicar manualmente `database/migrations/2026-08-09-social-v1.sql` con una identidad autorizada. El archivo usa una transacción y no contiene seeds.
3. Crear y configurar OAuth y los dos buckets R2 descritos abajo.
4. Configurar las variables de entorno.
5. Probar primero en Preview con una base no productiva que ya tenga la migración.
6. Desplegar sólo después de verificar callbacks, CORS, moderación y eliminación de cuenta.

El código compila sin OAuth ni R2. En ese estado no se muestran proveedores y los controles sociales que dependan del esquema degradan sin romper catálogo, proyectos o reproductor.

## Variables

- `DATABASE_URL`: PostgreSQL existente; también lo usa Better Auth.
- `BETTER_AUTH_SECRET`: secreto aleatorio de al menos 32 caracteres, independiente del administrador.
- `BETTER_AUTH_URL`: origen canónico, por ejemplo `https://dubversefandub.vercel.app`.
- `BETTER_AUTH_TRUSTED_ORIGINS`: orígenes completos permitidos, separados por coma. Añadir sólo previews conocidos.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- `R2_UPLOAD_BUCKET`: bucket privado para objetos `PENDING`.
- `R2_PUBLIC_BUCKET`: bucket público que sólo recibe imágenes ya decodificadas y re-encodeadas.
- `R2_PUBLIC_URL`: dominio público del segundo bucket, sin `/` final.

No reutilizar `AUTH_SECRET` del administrador como `BETTER_AUTH_SECRET`. No exponer ninguna variable `*_SECRET*` ni access keys en variables `NEXT_PUBLIC_*`.

## Google OAuth

1. En Google Cloud Console, seleccionar o crear un proyecto.
2. Configurar la pantalla de consentimiento y solicitar sólo los scopes básicos de identidad que usa Better Auth.
3. Crear credenciales “OAuth client ID” de tipo Web application.
4. Añadir el origen público a “Authorized JavaScript origins”.
5. Añadir como redirect URI exacta: `https://TU_DOMINIO/api/auth/callback/google`.
6. Copiar el client ID y secret a las variables de servidor.

En local, la callback es `http://localhost:3000/api/auth/callback/google`. Un Preview necesita su callback exacta registrada; no autorizar comodines amplios.

## Discord OAuth

1. Crear una aplicación en Discord Developer Portal.
2. En OAuth2, añadir la redirect URI exacta: `https://TU_DOMINIO/api/auth/callback/discord`.
3. Copiar Client ID y Client Secret a las variables de servidor.
4. No habilitar scopes administrativos ni de bot; el inicio de sesión sólo necesita identidad básica.

En local, la callback es `http://localhost:3000/api/auth/callback/discord`.

Discord puede devolver `email: null` para cuentas creadas sólo con teléfono. En ese caso el adaptador genera internamente un alias estable no entregable bajo `@oauth.invalid`, derivado mediante SHA-256 del ID de Discord. El alias nunca se publica, se marca como no verificado y no habilita linking implícito.

La vinculación implícita por coincidencia de email está deshabilitada. Si dos proveedores presentan el mismo email, Dubverse no ejecuta un linking casero; cualquier vinculación futura deberá usar el flujo oficial y autenticado de Better Auth.

## Cloudflare R2

1. Crear un bucket privado para subidas temporales, por ejemplo `dubverse-user-uploads`.
2. Crear un bucket separado para medios validados, por ejemplo `dubverse-user-media`.
3. Mantener privado el primer bucket. Habilitar un dominio público personalizado sólo para el segundo y usarlo como `R2_PUBLIC_URL`.
4. Crear un API token de R2 con lectura/escritura de objetos limitado exclusivamente a esos dos buckets. No usar un token global de cuenta.
5. Configurar lifecycle en el bucket temporal como defensa adicional para borrar objetos antiguos (por ejemplo después de 2 días). El registro PostgreSQL sigue siendo la fuente de estado.

Aplicar CORS únicamente al bucket temporal y sustituir los orígenes de ejemplo:

```json
[
  {
    "AllowedOrigins": [
      "https://dubversefandub.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Añadir previews de forma explícita; no usar `*` junto con orígenes que no se controlan.

### Flujo de imagen

1. Una API autenticada valida finalidad, MIME declarado y tamaño, aplica rate limit y crea un UUID y una key `pending/*` controlada por el servidor.
2. Devuelve una URL PUT prefirmada de 5 minutos para el bucket privado. La access key y el secret nunca llegan al navegador.
3. Tras el PUT, el navegador solicita finalización. El servidor hace HEAD y GET, comprueba bytes reales y magic bytes, decodifica con Sharp, rechaza animación y dimensiones absurdas, limita dimensiones, elimina metadata y re-encodea a WebP.
4. Sólo ese WebP se escribe al bucket público con una nueva key `users/*` o `comments/*`; después se elimina el temporal y se marca `ACTIVE`.
5. Un fallo marca `REJECTED` y elimina el objeto temporal. Sustituir avatar/banner marca el anterior `DELETED` y lo elimina. Eliminar comentario o cuenta limpia sus objetos.

El script `npm run social:cleanup:r2` lista, en dry-run por defecto, hasta 500 registros `PENDING` con más de 24 horas, temporales `REJECTED` pendientes de limpieza y objetos públicos marcados `DELETED` cuyo primer borrado falló. Este script sí consulta la base configurada cuando se invoca deliberadamente. `npm run social:cleanup:r2 -- --hours=48 --execute` borra los objetos listados y actualiza los registros; debe ejecutarse manualmente tras revisar el dry-run. No se programa desde peticiones ni durante el despliegue.

## Moderación, suspensión y privacidad

El panel administrativo existente agrega Moderación usando únicamente su cookie administrativa. Puede ocultar/restaurar/eliminar comentarios y reseñas, resolver/descartar reportes y suspender/reactivar perfiles. Suspender cambia el estado a `SUSPENDED` y borra las sesiones públicas del usuario. Todas las escrituras sociales exigen estado `ACTIVE`.

Favoritos y reseñas visibles aparecen en `/u/{username}`. Historial y Ver después sólo aparecen en `/perfil`. Las respuestas públicas no incluyen email, account IDs, tokens, sesiones ni IP.

Eliminar una cuenta requiere una sesión reciente de Better Auth. Antes del borrado se eliminan los objetos R2; el cascade elimina perfil, sesiones, cuentas OAuth, likes, favoritos, Ver después e historial. Comentarios y reseñas conservan su texto como contenido comunitario pero su autor pasa a `NULL`, por lo que quedan anónimos. Si se necesita una política de borrado integral del contenido escrito, debe aprobarse antes de producción.

## Rate limits durables

Better Auth usa `auth_rate_limits`. Las escrituras sociales usan `social_rate_limits` con upsert atómico: comentarios (5/min), reseñas (10/h), reportes (5/h), presigned URLs (10/h), edición de perfil (10/h), membresías (80/min) e historial (120/h). No se usa memoria de una instancia serverless como defensa principal.

## Rollback

`database/migrations/2026-08-09-social-v1.rollback.sql` elimina todas las tablas sociales y de autenticación. Es destructivo: cerrar escrituras, exportar los datos necesarios, respaldar PostgreSQL y ejecutarlo manualmente sólo si se acepta perder la capa social. Los objetos R2 no se eliminan mediante SQL; deben inventariarse y limpiarse por separado antes o después del rollback. Revertir también el código/configuración evita que la app consulte tablas eliminadas.
