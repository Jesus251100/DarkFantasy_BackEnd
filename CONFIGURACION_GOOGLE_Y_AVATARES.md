# Acceso con Google y fotos de perfil

## 1. Preparar Google

1. En Google Cloud, crea un cliente OAuth de tipo **Aplicación web**.
2. Agrega `http://localhost:5173` como origen JavaScript autorizado. Si también abres el juego como `http://127.0.0.1:5173`, agrega ese origen exacto. Google admite HTTP para pruebas locales; una IP de red local o un dominio requiere HTTPS.
3. Copia el **ID de cliente**, que termina en `.apps.googleusercontent.com`.
4. En el archivo `.env` que usa el `docker-compose.yml` de la carpeta principal, agrega `GOOGLE_CLIENT_ID=el-id-de-cliente`.
5. El mismo valor se compila en el frontend como `VITE_GOOGLE_CLIENT_ID`; el `docker-compose.yml` y `DarkFantasy_FrontEnd/Dockerfile` ya hacen ese paso.

El backend valida el token de identidad con Google antes de crear o iniciar una sesión. Las cuentas nuevas deben completar nombre, país, género y fecha de nacimiento. Las cuentas Gmail existentes pueden vincularse al entrar con Google. Si no se eligió una foto propia, se conserva la foto confirmada por Google.

## 2. Preparar Supabase Storage

1. En el proyecto de Supabase, abre **Storage** y crea un bucket llamado `avatars`.
2. Marca el bucket como **Public**, porque las fotos se muestran a otros jugadores en partidas online.
3. En límites del bucket, permite `image/jpeg`, `image/png` y `image/webp`, con un tamaño máximo de 5 MB.
4. En el `.env` de la carpeta principal, agrega:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SECRET_KEY=sb_secret_tu-clave-secreta-del-servidor
AVATARS_BUCKET=avatars
```

Usa la **Secret key** nueva de Supabase (`sb_secret_...`) en `SUPABASE_SECRET_KEY`. El backend también acepta la clave antigua `service_role` en `SUPABASE_SERVICE_ROLE_KEY` por compatibilidad. Esta llave solo se usa dentro del backend: no debe ponerse en archivos `VITE_*`, en el frontend ni en GitHub. El backend limita la subida a la sesión del usuario, a su carpeta y a imágenes JPG, PNG o WebP de hasta 5 MB. El bucket público permite ver la imagen a cualquier persona que tenga su URL.

## 3. Reconstruir y aplicar el esquema

Desde la carpeta principal que contiene `docker-compose.yml`, ejecuta:

```powershell
docker compose up -d --build
```

La imagen del backend genera Prisma y ejecuta `prisma db push` al iniciar; eso agrega los campos nuevos del perfil a `Usuario`. Hay que reconstruir ambos servicios porque el frontend recibe el ID de Google al compilar y el backend contiene los endpoints nuevos.

Para revisar el arranque:

```powershell
docker compose ps
docker compose logs --tail 100 backend
```

Después, registra o inicia sesión con Google, sube una imagen JPG/PNG/WebP desde **Lobby → Perfil → Cambiar foto**, y abre una sala online para comprobar que aparezca en las fichas de los jugadores.
