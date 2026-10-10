/**
 * Conexión del BACKEND → PostgreSQL
 *
 * pgAdmin (no uses el servidor "postgres" del puerto 5432):
 *   Host:     127.0.0.1
 *   Puerto:   5433
 *   Database: darkfantasy
 *   User:     darkfantasy
 *   Password: darkfantasy
 *
 * Prisma lee DATABASE_URL de backend/.env
 */
export const conexionPostgres = {
  motor: 'postgresql' as const,
  host: '127.0.0.1',
  puerto: 5433,
  base: 'darkfantasy',
  usuario: 'darkfantasy',
  contenedorDocker: 'darkfantasy-pg',
}

export function urlBaseDatos(): string {
  return (
    process.env.DATABASE_URL ??
    `postgresql://${conexionPostgres.usuario}:darkfantasy@${conexionPostgres.host}:${conexionPostgres.puerto}/${conexionPostgres.base}`
  )
}

export function resumenConexion(): string {
  try {
    const u = new URL(urlBaseDatos())
    return `${u.protocol}//${u.username}@${u.hostname}:${u.port}${u.pathname}`
  } catch {
    const c = conexionPostgres
    return `${c.motor}://${c.usuario}@${c.host}:${c.puerto}/${c.base}`
  }
}
