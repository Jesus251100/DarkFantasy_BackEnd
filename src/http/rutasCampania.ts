import { Router } from 'express'
import { z } from 'zod'
import { ActualizarNombre } from '../application/ActualizarNombre'
import { CompletarNivel } from '../application/CompletarNivel'
import { ComprarBoosterRemoto } from '../application/ComprarBoosterRemoto'
import { IntercambiarMonedaRemoto } from '../application/IntercambiarMonedaRemoto'
import { ListarLogros } from '../application/ListarLogros'
import { ObtenerCampania } from '../application/ObtenerCampania'
import { PartidasCampania } from '../application/PartidasCampania'
import { RegistrarPartida } from '../application/RegistrarPartida'
import { PrismaCampaniaRepo } from '../infrastructure/PrismaCampaniaRepo'
import { PrismaPartidasRepo } from '../infrastructure/PrismaPartidasRepo'
import { authObligatoria } from './auth'

const router = Router()
router.use(authObligatoria)

const campanias = new PrismaCampaniaRepo()
const partidas = new PrismaPartidasRepo()
const rondasCampania = new PartidasCampania()

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

router.get('/logros', async (req, res) => {
  const logros = await new ListarLogros(campanias).ejecutar(req.usuario!.sub)
  if (!logros) {
    res.status(404).json({ error: 'Usuario no encontrado.' })
    return
  }
  res.json({ logros })
})

router.post('/completar-nivel', (_req, res) => {
  res.status(410).json({ error: 'La victoria debe validarse mediante una ronda de campaña.' })
})

router.post('/rondas', async (req, res) => {
  const parsed = z
    .object({
      nivel: z.number().int().min(1).max(10),
      fase: z.number().int().min(1).max(3),
      modo: z
        .enum(['row', 'column', 'diagonal', 'L', 'O', 'plus', 'X', 'T', 'arrow', 'H', 'diamond', 'zigzag', 'full', 'crown'])
        .optional(),
      runId: z.string().uuid().optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Datos de partida inválidos.' })
    return
  }
  const campania = await new ObtenerCampania(campanias).ejecutar(req.usuario!.sub)
  if (!campania) {
    res.status(404).json({ error: 'Usuario no encontrado.' })
    return
  }
  try {
    const ronda = rondasCampania.iniciar(
      req.usuario!.sub,
      parsed.data.nivel,
      parsed.data.fase,
      parsed.data.modo,
      parsed.data.runId,
      req.usuario!.rol === 'administrador' ? 10 : campania.highestUnlocked,
    )
    res.status(201).json({ ronda })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 409
    res.status(status >= 400 && status < 500 ? status : 409).json({
      error: error instanceof Error ? error.message : 'No se pudo iniciar la ronda.',
    })
  }
})

router.post('/rondas/:id/bola', (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) {
    res.status(400).json({ error: 'Ronda inválida.' })
    return
  }
  try {
    const numero = rondasCampania.siguienteBola(req.usuario!.sub, id.data)
    res.json({ numero })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 409
    res.status(status >= 400 && status < 500 ? status : 409).json({
      error: error instanceof Error ? error.message : 'No se pudo cantar la bola.',
    })
  }
})

router.post('/rondas/:id/cerrar', (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) {
    res.status(400).json({ error: 'Ronda inválida.' })
    return
  }
  try {
    rondasCampania.cerrar(req.usuario!.sub, id.data)
    res.json({ ok: true })
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : 'No se pudo cerrar la ronda.',
    })
  }
})

router.post('/rondas/:id/devolver-bola', (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const body = z.object({ numero: z.number().int().min(1).max(90) }).safeParse(req.body)
  if (!id.success || !body.success) {
    res.status(400).json({ error: 'Bola inválida.' })
    return
  }
  try {
    rondasCampania.devolverBola(req.usuario!.sub, id.data, body.data.numero)
    res.json({ ok: true })
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : 'No se pudo devolver la bola.' })
  }
})

router.post('/rondas/:id/reclamar', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  const parsed = z.object({ cartonIndex: z.number().int().min(0).max(1) }).safeParse(req.body)
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: 'Reclamo inválido.' })
    return
  }
  const ronda = rondasCampania.comenzarReclamo(req.usuario!.sub, id.data, parsed.data.cartonIndex)
  if (!ronda) {
    res.status(409).json({ error: 'El servidor no ha confirmado un BINGO válido.' })
    return
  }
  if (ronda.estado === 'validada') {
    const campania = await new ObtenerCampania(campanias).ejecutar(req.usuario!.sub)
    res.json({
      ok: true,
      nivel: ronda.nivel,
      fase: ronda.fase,
      totalFases: ronda.totalFases,
      nivelCompleto: ronda.fase === ronda.totalFases,
      campania,
    })
    return
  }
  try {
    let resultado
    let campania
    const nivelCompleto = ronda.fase === ronda.totalFases
    if (nivelCompleto) {
      const out = await new CompletarNivel(campanias, partidas).ejecutar(req.usuario!.sub, ronda.nivel)
      if (!out) throw new Error('Usuario no encontrado.')
      if ('error' in out) throw new Error(out.error)
      resultado = out.resultado
      campania = out.campania
    } else {
      await new RegistrarPartida(partidas).ejecutar(req.usuario!.sub, ronda.nivel, true)
    }
    rondasCampania.confirmarReclamo(ronda)
    if (!campania) campania = await new ObtenerCampania(campanias).ejecutar(req.usuario!.sub)
    res.json({
      ok: true,
      nivel: ronda.nivel,
      fase: ronda.fase,
      totalFases: ronda.totalFases,
      nivelCompleto,
      resultado,
      campania,
    })
  } catch (error) {
    rondasCampania.cancelarReclamo(ronda)
    res.status(409).json({
      error: error instanceof Error ? error.message : 'No se pudo guardar la victoria.',
    })
  }
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
      gano: z.literal(false),
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
