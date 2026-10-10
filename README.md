# Dark Fantasy — Backend

API REST del juego, construida con **Express 5 + TypeScript** y persistencia en **PostgreSQL** vía **Prisma 6**. Las reglas de campaña, tienda y boosters son las mismas clases del dominio del frontend (POO + SOLID).

Sirve a la SPA del frontend (`../frontend`) en la ruta base `/api`.

## Stack

- Node.js + TypeScript (ejecutado con `tsx`)
- Express 5
- Prisma 6 + PostgreSQL 16
- JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`)
- Zod (validación de entrada)
- Nodemailer / SMTP (códigos de verificación)

Node: `^20.19.0 || >=22.12.0`.

## Estructura

```
backend/
├── src/
│   ├── domain/          entidades y puertos (interfaces de repositorio)
│   ├── application/     casos de uso (registro, partidas, campaña, admin)
│   ├── infrastructure/  repositorios Prisma, correo SMTP, conexión a BD
│   ├── http/            routers Express + middleware JWT
│   └── main.ts          app Express, rutas /api/* y /api/salud
├── prisma/
│   ├── schema.prisma    modelo de datos
│   └── seed.ts          datos iniciales (usuarios, niveles, boosters…)
├── Dockerfile
└── .env
```

Arquitectura por capas: `domain` (reglas puras + puertos) → `application` (casos de uso) → `infrastructure` (adaptadores) → `http` (entrada).

## Comandos

Todos se ejecutan dentro de `backend/`:

```sh
npm install          # instalar dependencias
npm run dev          # servidor con recarga (tsx watch src/main.ts) en :3001
npm start            # servidor sin watch
npm run prisma:generate
npm run prisma:migrate   # prisma migrate dev --name init
npm run prisma:seed      # carga los datos iniciales
```

Health check: `GET http://127.0.0.1:3001/api/salud`.

## Variables de entorno (`.env`)

```
DATABASE_URL="postgresql://usuario:clave@host:5432/darkfantasy"
JWT_SECRET="cadena-secreta"
PORT=3001

# Correo (opcional; en Docker por defecto usa Mailpit)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
SMTP_FROM="Dark Fantasy <no-reply@darkfantasy.local>"
```

Sin `SMTP_USER`/`SMTP_PASS` los códigos quedan en Mailpit (`http://127.0.0.1:8025`).

## Modelo de datos (Prisma)

- `Usuario` — cuenta, rol (`jugador` / `administrador`), `claveHash`.
- `Progreso` — monedas, diamantes, victorias, niveles completados y boosters del jugador.
- `Partida` — historial de partidas jugadas.
- `HistorialTransaccion` — libro de compras, intercambios y recompensas.
- `Nivel`, `FaseNivel`, `PatronVictoria` — configuración de la campaña (10 niveles).
- `Booster` + `InventarioBooster` — catálogo y existencias.
- `Rival`, `ReglaTienda` — bots y reglas de la tienda.
- `CodigoVerificacion` — códigos de registro enviados por correo.

## Endpoints

Base: `/api`.

### Autenticación — `/api/auth`

- `POST /solicitar-codigo` — envía el código de verificación al correo.
- `POST /register` — crea la cuenta (requiere código válido). Devuelve token.
- `POST /login` — inicia sesión. Devuelve token y usuario.
- `GET /me` — usuario + campaña (requiere token).

### Campaña — `/api/campania` (requiere token)

- `GET /` — estado de la campaña del jugador.
- `POST /completar-nivel` — `{ nivel }`. Otorga recompensas y desbloquea el siguiente.
- `POST /comprar-booster` — `{ id, cantidad }`.
- `POST /intercambiar` — `{ modo: "diamonds-to-coins" | "coins-to-diamonds" }`.
- `POST /partida` — `{ nivel, gano }`. Registra una partida.
- `GET /partidas` — historial de partidas del usuario.
- `GET /transacciones` — historial de transacciones del usuario.
- `PATCH /nombre` — `{ nombre }`. Actualiza el nombre del jugador.

### Admin — `/api/admin` (requiere token + rol administrador)

- `GET /usuarios` — listado de usuarios.
- `GET /actividad` — actividad reciente.
- `GET /reportes` — reportes agregados.

## Autenticación

JWT firmado con `JWT_SECRET`, expira en 7 días. Se envía como `Authorization: Bearer <token>`. El middleware `http/auth.ts` valida el token (`authObligatoria`) y el rol (`soloAdmin`).

## Usuarios de prueba

Cargados por el seed:

- Jugador: `jugador@darkfantasy.com` / `jugador123`
- Admin: `admin@darkfantasy.com` / `admin123`

(También válidos los `@darkfantasy.local`.)

## Arranque

### Con Docker (recomendado)

Desde la raíz del repositorio:

```sh
docker compose up --build
```

El contenedor aplica `prisma db push`, corre el seed y arranca el API en `http://127.0.0.1:3001`.

### Solo el backend en local

1. PostgreSQL en Docker (puerto 5433):

```sh
docker start darkfantasy-pg
```

2. En `backend/`:

```sh
npm install
npx prisma db push
npx tsx prisma/seed.ts
npm run dev
```

Datos de conexión a la base en `CONEXION.md`.
