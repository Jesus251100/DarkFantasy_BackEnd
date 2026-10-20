import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../infrastructure/prisma'
import { authObligatoria, firmarToken } from './auth'
import { ObtenerCampania } from '../application/ObtenerCampania'
import { PrismaCampaniaRepo } from '../infrastructure/PrismaCampaniaRepo'
import { CorreoSmtp } from '../infrastructure/CorreoSmtp'
import { SolicitarCodigo, consumirCodigo } from '../application/SolicitarCodigo'

const router = Router()
const solicitarCodigo = new SolicitarCodigo(new CorreoSmtp())

const correoSchema = z
  .string()
  .trim()
  .min(3)
  .refine((v) => v.includes('@'), 'Correo inválido')

const solicitarSchema = z.object({
  correo: correoSchema,
})

const registroSchema = z.object({
  correo: correoSchema,
  confirmarCorreo: correoSchema,
  clave: z.string().min(4),
  codigo: z.string().regex(/^\d{6}$/),
  nombre: z.string().min(1).max(40).optional(),
  nacionalidad: z.string().optional(),
  genero: z.enum(['M', 'F']).optional(),
  fechaNacimiento: z.string().optional(),
  rol: z.enum(['jugador', 'administrador']).optional(),
})

const loginSchema = z.object({
  correo: correoSchema,
  clave: z.string().min(1),
  rol: z.enum(['jugador', 'administrador']).optional(),
})

router.post('/solicitar-codigo', async (req, res) => {
  const parsed = solicitarSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Correo inválido.' })
    return
  }
  try {
    const resultado = await solicitarCodigo.ejecutar(parsed.data.correo)
    res.json({ ok: true, correo: parsed.data.correo.trim().toLowerCase(), bandeja: resultado.bandeja })
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? Number((e as { status: number }).status) : 503
    const error = e instanceof Error ? e.message : 'No se pudo enviar el código.'
    res.status(Number.isFinite(status) ? status : 503).json({ error })
  }
})

router.post('/register', async (req, res) => {
  const parsed = registroSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Correo, contraseña o código inválidos.' })
    return
  }
  const correo = parsed.data.correo.trim().toLowerCase()
  const confirmarCorreo = parsed.data.confirmarCorreo.trim().toLowerCase()
  if (correo !== confirmarCorreo) {
    res.status(400).json({ error: 'Los correos no coinciden.' })
    return
  }
  const existe = await prisma.usuario.findUnique({ where: { correo } })
  if (existe) {
    res.status(409).json({ error: 'Ese correo ya está registrado.' })
    return
  }
  const codigoOk = await consumirCodigo(correo, parsed.data.codigo)
  if (!codigoOk) {
    res.status(401).json({ error: 'Código incorrecto o vencido. Pide uno nuevo.' })
    return
  }
  const rol = 'jugador'
  const nombre = parsed.data.nombre?.trim() || 'Jugador'
  const usuario = await prisma.usuario.create({
    data: {
      correo,
      claveHash: await bcrypt.hash(parsed.data.clave, 10),
      rol,
      nombre,
      nacionalidad: parsed.data.nacionalidad ?? null,
      genero: parsed.data.genero ?? null,
      fechaNacimiento: parsed.data.fechaNacimiento ? new Date(parsed.data.fechaNacimiento) : null,
      progreso: { create: {} },
    },
  })
  const token = firmarToken({
    sub: usuario.id,
    correo: usuario.correo,
    rol: usuario.rol as 'jugador' | 'administrador',
    nombre: usuario.nombre,
    nacionalidad: usuario.nacionalidad ?? undefined,
    genero: usuario.genero ?? undefined,
    fechaNacimiento: usuario.fechaNacimiento ?? undefined,
  })
  res.status(201).json({
    token,
    usuario: {
      id: usuario.id,
      correo: usuario.correo,
      rol: usuario.rol,
      nombre: usuario.nombre,
      nacionalidad: usuario.nacionalidad,
      genero: usuario.genero,
      fechaNacimiento: usuario.fechaNacimiento,
    },
  })
})

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Correo o contraseña inválidos.' })
    return
  }
  const correo = parsed.data.correo.trim().toLowerCase()
  const usuario = await prisma.usuario.findUnique({ where: { correo } })
  if (!usuario) {
    res.status(401).json({ error: 'Correo o contraseña incorrectos.' })
    return
  }
  const ok = await bcrypt.compare(parsed.data.clave, usuario.claveHash)
  if (!ok) {
    res.status(401).json({ error: 'Correo o contraseña incorrectos.' })
    return
  }
  if (parsed.data.rol && parsed.data.rol !== usuario.rol) {
    res.status(403).json({ error: `Esta cuenta es de ${usuario.rol}, no de ${parsed.data.rol}.` })
    return
  }
  const token = firmarToken({
    sub: usuario.id,
    correo: usuario.correo,
    rol: usuario.rol as 'jugador' | 'administrador',
    nombre: usuario.nombre,
    nacionalidad: usuario.nacionalidad ?? undefined,
    genero: usuario.genero ?? undefined,
    fechaNacimiento: usuario.fechaNacimiento ?? undefined,
  })
  res.json({
    token,
    usuario: {
      id: usuario.id,
      correo: usuario.correo,
      rol: usuario.rol,
      nombre: usuario.nombre,
      nacionalidad: usuario.nacionalidad,
      genero: usuario.genero,
      fechaNacimiento: usuario.fechaNacimiento,
    },
  })
})

router.get('/me', authObligatoria, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario!.sub } })
  if (!usuario) {
    res.status(404).json({ error: 'Usuario no encontrado.' })
    return
  }
  const campania = await new ObtenerCampania(new PrismaCampaniaRepo()).ejecutar(usuario.id)
  res.json({
    usuario: {
      id: usuario.id,
      correo: usuario.correo,
      rol: usuario.rol,
      nombre: usuario.nombre,
      nacionalidad: usuario.nacionalidad,
      genero: usuario.genero,
      fechaNacimiento: usuario.fechaNacimiento,
    },
    campania,
  })
})

export default router
