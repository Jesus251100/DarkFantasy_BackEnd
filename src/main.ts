import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { aplicarIntegridad } from './infrastructure/aplicarIntegridad'
import { prisma } from './infrastructure/prisma'
import { resumenConexion } from './infrastructure/conexionBd'
import rutasAuth from './http/rutasAuth'
import rutasCampania from './http/rutasCampania'
import rutasAdmin from './http/rutasAdmin'

const app = express()
const port = Number(process.env.PORT ?? 3001)

app.use(
  cors({
    origin: true,
  }),
)
app.use(express.json())

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>API Dark Fantasy</title>
  <style>
    body { font-family: Georgia, serif; background: #0b1220; color: #e8eef4; margin: 0; min-height: 100vh; display: grid; place-items: center; }
    main { text-align: center; max-width: 420px; padding: 32px; }
    h1 { color: #e8c86a; margin: 0 0 12px; }
    a { color: #7ad7ff; }
    p { line-height: 1.45; }
  </style>
</head>
<body>
  <main>
    <h1>API Dark Fantasy</h1>
    <p>Este puerto (3001) es el backend, no el juego.</p>
    <p>Abre el juego en<br /><a href="http://127.0.0.1:5173">http://127.0.0.1:5173</a></p>
    <p><a href="/api/salud">Comprobar conexión</a></p>
  </main>
</body>
</html>`)
})

app.get('/api/salud', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({
      ok: true,
      servicio: 'dark-fantasy-api',
      baseDatos: resumenConexion(),
    })
  } catch {
    res.status(503).json({
      ok: false,
      servicio: 'dark-fantasy-api',
      error: 'No hay conexión con PostgreSQL. ¿Está docker start darkfantasy-pg?',
    })
  }
})

app.use('/api/auth', rutasAuth)
app.use('/api/campania', rutasCampania)
app.use('/api/admin', rutasAdmin)

app.listen(port, '0.0.0.0', () => {
  console.log(`API Dark Fantasy en http://0.0.0.0:${port}`)
  console.log(`PostgreSQL: ${resumenConexion()}`)
  void aplicarIntegridad(prisma)
    .then(() => console.log('Restricciones activas: saldo, nivel y rol no aceptan datos inválidos.'))
    .catch((error: unknown) => {
      const mensaje = error instanceof Error ? error.message : 'error desconocido'
      console.error(`No se pudieron aplicar las restricciones: ${mensaje}`)
    })
  const smtpUser = process.env.SMTP_USER?.trim()
  const smtpPass = (process.env.SMTP_PASS ?? '').trim()
  console.log(
    smtpUser && smtpPass
      ? `SMTP real: ${smtpUser} → el código de registro llega al correo del jugador`
      : 'SMTP local (Mailpit). Para Gmail real define SMTP_USER y SMTP_PASS.',
  )
})

async function apagar() {
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', () => void apagar())
process.on('SIGTERM', () => void apagar())
