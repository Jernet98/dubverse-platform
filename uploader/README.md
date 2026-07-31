# Dubverse Uploader

Este programa envía el video **directamente desde tu computadora a Archive.org** y después actualiza el episodio en el panel. Las claves de Archive.org nunca se mandan al servidor de Dubverse.

## Uso

1. Inicia Dubverse con `python server.py`.
2. Abre `dubverse_uploader.py` con Python 3.
3. Escribe la URL de Dubverse y la clave administrativa.
4. Escribe tus claves S3 de Archive.org.
5. Selecciona proyecto, temporada, episodio y MP4.
6. Presiona **Subir episodio**.
7. Cuando termine la transferencia, puedes cerrar el programa. Archive.org seguirá procesando el video.
8. En el panel, abre **Episodios → Revisar Archive**. Cuando haya un video disponible cambiará a `READY`.
9. Edita el episodio, activa **Publicado** y cambia el estado a `PUBLISHED`.

## Seguridad

- El programa no guarda las claves de Archive.org ni la clave administrativa.
- Solo guarda la última URL utilizada en `~/.dubverse_uploader.json`.
- No publiques tus claves en GitHub ni las escribas dentro del código.
