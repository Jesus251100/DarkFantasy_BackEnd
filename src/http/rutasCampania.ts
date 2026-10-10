import { Router } from 'express'
import { z } from 'zod'
import { ActualizarNombre } from '../application/ActualizarNombre'
import { CompletarNivel } from '../application/CompletarNivel'
import { ComprarBoosterRemoto } from '../application/ComprarBoosterRemoto'
import { IntercambiarMonedaRemoto } from '../application/IntercambiarMonedaRemoto'
import { ObtenerCampania } from '../application/ObtenerCampania'
import { RegistrarPartida } from '../application/RegistrarPartida'
import { PrismaCampaniaRepo } from '../infrastructure/PrismaCampaniaRepo'
import { PrismaPartidasRepo } from '../infrastructure/PrismaPartidasRepo'
import { authObligatoria } from './auth'

const router = Router()
router.use(authObligatoria)

const campanias = new PrismaCampaniaRepo()
const partidas = new PrismaPartidasRepo()

router.get('/', async (req, res) => {
  const campania = await new ObtenerCampania(campanias).ejecutar(req.usuario!.sub)
  if (!campania) {
    res.status(404).json({ error: 'Usuario no encontrado.' })
    return
  }
  res.json({
    usuario: {
      id: req.usuario!.sub,
      correo: req.usuario!.correo,
      rol: req.usuario!.rol,
      nombre: campania.displayName,
    },
    campania,
  })
})

router.post('/completar-nivel', async (req, res) => {
  const parsed = z.object({ nivel: z.number().int().min(1).max(10) }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Nivel inválido.' })
    return
  }
  const out = await new CompletarNivel(campanias, partidas).ejecutar(
    req.usuario!.sub,
    parsed.data.nivel,
  )
  if (!out) {
    res.status(404).json({ error: 'Usuario no encontrado.' })
    return
  }
  if ('error' in out) {
    res.status(409).json({ error: out.error })
    return
  }
  res.json(out)
})

router.post('/comprar-booster', async (req, res) => {
  const parsed = z
    .object({ id: z.number().int(), cantidad: z.number().int().min(1).max(99) })
    .safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos de compra inválidos.' })
    return
  }
  const out = await new ComprarBoosterRemoto(campanias).ejecutar(
    req.usuario!.sub,
    parsed.data.id,
    parsed.data.cantidad,
  )
  if (!out.ok) {
    res.status(out.error === 'Usuario no encontrado.' ? 404 : 400).json({ error: out.error })
    return
  }
  res.json({ ok: true, nombre: out.nombre, campania: out.campania })
})

router.post('/intercambiar', async (req, res) => {
  const parsed = z
    .object({ modo: z.enum(['diamonds-to-coins', 'coins-to-diamonds']) })
    .safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Modo de intercambio inválido.' })
    return
  }
  const out = await new IntercambiarMonedaRemoto(campanias).ejecutar(
    req.usuario!.sub,
    parsed.data.modo,
  )
  if (!out.ok) {
    res.status(out.error === 'Usuario no encontrado.' ? 404 : 400).json({ error: out.error })
    return
  }
  res.json({ ok: true, campania: out.campania })
})

router.post('/partida', async (req, res) => {
  const parsed = z
    .object({
      nivel: z.number().int().min(1).max(10),
      gano: z.boolean(),
    })
    .safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Partida inválida.' })
    return
  }
  const partida = await new RegistrarPartida(partidas).ejecutar(
    req.usuario!.sub,
    parsed.data.nivel,
    parsed.data.gano,
  )
  res.status(201).json({ partida })
})

router.get('/partidas', async (req, res) => {
  const lista = await partidas.listarDeUsuario(req.usuario!.sub)
  res.json({ partidas: lista })
})

router.get('/transacciones', async (req, res) => {
  const transacciones = await campanias.listarTransacciones(req.usuario!.sub)
  res.json({ transacciones })
})

router.patch('/nombre', async (req, res) => {
  const parsed = z.object({ nombre: z.string().min(1).max(40) }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Nombre inválido.' })
    return
  }
  const campania = await new ActualizarNombre(campanias).ejecutar(
    req.usuario!.sub,
    parsed.data.nombre,
  )
  if (!campania) {
    res.status(404).json({ error: 'Usuario no encontrado.' })
    return
  }
  res.json({ campania })
})

export default router
