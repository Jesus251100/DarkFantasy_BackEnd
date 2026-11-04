import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../infrastructure/prisma'
import { authObligatoria, firmarToken } from './auth'
import { ObtenerCampania } from '../application/ObtenerCampania'
import { PrismaCampaniaRepo } from '../infrastructure/PrismaCampaniaRepo'
import { CorreoSmtp } from '../infrastructure/CorreoSmtp'
import { SolicitarCodigo, consumirCodigo, restablecerClave } from '../application/SolicitarCodigo'

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
  nombre: z.string().trim().min(1).max(40),
  nacionalidad: z.string().trim().min(2),
  genero: z.enum(['M', 'F']),
  fechaNacimiento: z.string().trim().min(10),
  rol: z.enum(['jugador', 'administrador']).optional(),
})

const loginSchema = z.object({
  correo: correoSchema,
  clave: z.string().min(1),
  rol: z.enum(['jugador', 'administrador']).optional(),
})

const perfilSchema = z.object({
  nombre: z.string().trim().min(1).max(40),
  correo: correoSchema,
  avatar: z
    .string()
    .optional()
    .refine((val) => val === undefined || val === null || /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+\/]+={0,2}$/.test(val), 'La imagen de perfil no es válida.')
    .nullable(),
  nacionalidad: z.string().trim().max(40).nullable().optional(),
  genero: z.enum(['M', 'F']).nullable().optional(),
  fechaNacimiento: z.string().trim().nullable().optional(),
  claveActual: z.string().optional(),
  claveNueva: z.string().optional(),
})

function fechaCorta(valor: Date | null | undefined): string | null {
  if (!valor) return null
  const anio = valor.getUTCFullYear()
  const mes = String(valor.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(valor.getUTCDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

function leerFecha(texto: string): Date | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto)
  if (!partes) return null
  const anio = Number(partes[1])
  const mes = Number(partes[2])
  const dia = Number(partes[3])
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    return null
  }
  if (anio < 1900 || fecha.getTime() > Date.now()) return null
  return fecha
}

function datosPublicos(usuario: {
  id: string
  correo: string
  rol: string
  nombre: string
  avatar?: string | null
  nacionalidad: string | null
  genero: string | null
  fechaNacimiento: Date | null
}) {
  return {
    id: usuario.id,
    correo: usuario.correo,
    rol: usuario.rol,
    nombre: usuario.nombre,
    avatar: usuario.avatar ?? null,
    nacionalidad: usuario.nacionalidad,
    genero: usuario.genero,
    fechaNacimiento: fechaCorta(usuario.fechaNacimiento),
  }
}

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

router.post('/olvidar-clave', async (req, res) => {
  const parsed = solicitarSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Correo inválido.' })
    return
  }
  try {
    const resultado = await solicitarCodigo.ejecutarRestablecimiento(parsed.data.correo)
    res.json({ ok: true, correo: parsed.data.correo.trim().toLowerCase(), bandeja: resultado.bandeja })
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? Number((e as { status: number }).status) : 503
    const error = e instanceof Error ? e.message : 'No se pudo enviar el código.'
    res.status(Number.isFinite(status) ? status : 503).json({ error })
  }
})

const restablecerSchema = z.object({
  correo: correoSchema,
  codigo: z.string().regex(/^\d{6}$/),
  clave: z.string().min(4),
})

router.post('/restablecer-clave', async (req, res) => {
  const parsed = restablecerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Correo, código o contraseña inválidos.' })
    return
  }
  const correo = parsed.data.correo.trim().toLowerCase()
  const usuario = await prisma.usuario.findUnique({ where: { correo } })
  if (!usuario) {
    res.status(404).json({ error: 'Ese correo no está registrado.' })
    return
  }
  const ok = await restablecerClave(correo, parsed.data.codigo, parsed.data.clave)
  if (!ok) {
    res.status(401).json({ error: 'Código incorrecto o vencido. Pide uno nuevo.' })
    return
  }
  res.json({ ok: true })
})

router.post('/register', async (req, res) => {
  const parsed = registroSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Completa todos los datos: nombre, país, correo, contraseña, género y fecha de nacimiento.' })
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
  const nombre = parsed.data.nombre.trim()
  const fechaNacimiento = leerFecha(parsed.data.fechaNacimiento)
  if (!fechaNacimiento) {
    res.status(400).json({ error: 'La fecha de nacimiento no es válida.' })
    return
  }
  const usuario = await prisma.usuario.create({
    data: {
      correo,
      claveHash: await bcrypt.hash(parsed.data.clave, 10),
      rol,
      nombre,
      nacionalidad: parsed.data.nacionalidad.trim().toLowerCase(),
      genero: parsed.data.genero,
      fechaNacimiento,
      progreso: { create: {} },
    },
  })
  const token = firmarToken({
    sub: usuario.id,
    correo: usuario.correo,
    rol: usuario.rol as 'jugador' | 'administrador',
    nombre: usuario.nombre,
    avatar: usuario.avatar ?? undefined,
    nacionalidad: usuario.nacionalidad ?? undefined,
    genero: usuario.genero ?? undefined,
    fechaNacimiento: usuario.fechaNacimiento ?? undefined,
  })
  res.status(201).json({
    token,
    usuario: datosPublicos(usuario),
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
    avatar: usuario.avatar ?? undefined,
    nacionalidad: usuario.nacionalidad ?? undefined,
    genero: usuario.genero ?? undefined,
    fechaNacimiento: usuario.fechaNacimiento ?? undefined,
  })
  res.json({
    token,
    usuario: datosPublicos(usuario),
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
    usuario: datosPublicos(usuario),
    campania,
  })
})

router.patch('/perfil', authObligatoria, async (req, res) => {
  const parsed = perfilSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Revisa los datos del perfil.' })
    return
  }
  const actual = await prisma.usuario.findUnique({ where: { id: req.usuario!.sub } })
  if (!actual) {
    res.status(404).json({ error: 'Usuario no encontrado.' })
    return
  }

  const correo = parsed.data.correo.trim().toLowerCase()
  const claveNueva = parsed.data.claveNueva?.trim() ?? ''
  const correoCambia = correo !== actual.correo
  if (correoCambia || claveNueva) {
    const claveActual = parsed.data.claveActual ?? ''
    const coincide = claveActual ? await bcrypt.compare(claveActual, actual.claveHash) : false
    if (!coincide) {
      res.status(401).json({ error: 'La contraseña actual no coincide.' })
      return
    }
  }
  if (claveNueva && claveNueva.length < 4) {
    res.status(400).json({ error: 'La contraseña nueva debe tener al menos 4 caracteres.' })
    return
  }
  if (correoCambia) {
    const ocupado = await prisma.usuario.findUnique({ where: { correo } })
    if (ocupado && ocupado.id !== actual.id) {
      res.status(409).json({ error: 'Ese correo ya está registrado.' })
      return
    }
  }

  let fechaNacimiento: Date | null = actual.fechaNacimiento
  if (parsed.data.fechaNacimiento !== undefined) {
    const texto = parsed.data.fechaNacimiento?.trim() ?? ''
    if (!texto) {
      fechaNacimiento = null
    } else {
      fechaNacimiento = leerFecha(texto)
      if (!fechaNacimiento) {
        res.status(400).json({ error: 'La fecha de nacimiento no es válida.' })
        return
      }
    }
  }

  const nacionalidadLimpia = parsed.data.nacionalidad?.trim() ?? ''
  const usuario = await prisma.usuario.update({
    where: { id: actual.id },
    data: {
      nombre: parsed.data.nombre.trim(),
      correo,
      ...(parsed.data.avatar !== undefined ? { avatar: parsed.data.avatar } : {}),
      nacionalidad: nacionalidadLimpia ? nacionalidadLimpia.toLowerCase() : null,
      genero: parsed.data.genero ?? null,
      fechaNacimiento,
      ...(claveNueva ? { claveHash: await bcrypt.hash(claveNueva, 10) } : {}),
    },
  })
  const token = firmarToken({
    sub: usuario.id,
    correo: usuario.correo,
    rol: usuario.rol as 'jugador' | 'administrador',
    nombre: usuario.nombre,
    avatar: usuario.avatar ?? undefined,
    nacionalidad: usuario.nacionalidad ?? undefined,
    genero: usuario.genero ?? undefined,
    fechaNacimiento: usuario.fechaNacimiento ?? undefined,
  })
  res.json({ token, usuario: datosPublicos(usuario) })
})

export default router
