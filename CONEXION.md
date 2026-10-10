# Conexión BACKEND → PostgreSQL

Código:

- `src/infrastructure/conexionBd.ts`
- `src/infrastructure/prisma.ts`
- `.env` → `DATABASE_URL`

Datos para pgAdmin:

| Campo | Valor |
|---|---|
| Host | 127.0.0.1 |
| Puerto | **5433** (no 5432) |
| Database | darkfantasy |
| Username | darkfantasy |
| Password | darkfantasy |

El 5432 es el Postgres de Windows. Este proyecto usa el de Docker.
