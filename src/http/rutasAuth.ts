import express, { Router } from 'express'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { prisma } from '../infrastructure/prisma'
import { authObligatoria, firmarToken } from './auth'
import { ObtenerCampania } from '../application/ObtenerCampania'
import { PrismaCampaniaRepo } from '../infrastructure/PrismaCampaniaRepo'
import { CorreoSmtp } from '../infrastructure/CorreoSmtp'
import { SolicitarCodigo, consumirCodigo, restablecerClave } from '../application/SolicitarCodigo'
import { limitarPeticiones } from './seguridad'
import { almacenAvatares } from '../infrastructure/AlmacenAvatares'

const router = Router()
const solicitarCodigo = new SolicitarCodigo(new CorreoSmtp())
const google = new OAuth2Client()

const correoSchema = z
  .string()
  .trim()
  .email('Correo inválido')
  .max(254)

const CLAVE_ALFANUMERICA = /^(?=.*\p{L})(?=.*\p{N})/u
const claveSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(128, 'La contraseña no puede superar 128 caracteres.')
  .regex(CLAVE_ALFANUMERICA, 'La contraseña debe incluir al menos una letra y un número.')

const solicitarSchema = z.object({
  correo: correoSchema,
})

const registroSchema = z.object({
  correo: correoSchema,
  confirmarCorreo: correoSchema,
  clave: claveSchema,
  codigo: z.string().regex(/^\d{6}$/),
  nombre: z.string().trim().min(1).max(40),
  nacionalidad: z.string().trim().regex(/^[A-Za-z]{2}$/),
  genero: z.enum(['M', 'F']),
  fechaNacimiento: z.string().trim().min(10),
  rol: z.enum(['jugador', 'administrador']).optional(),
})

const loginSchema = z.object({
  correo: correoSchema,
  clave: z.string().min(1).max(128),
  rol: z.enum(['jugador', 'administrador']).optional(),
})

const googleSchema = z.object({
  idToken: z.string().min(100).max(10000),
  nombre: z.string().trim().min(1).max(40).optional(),
  nacionalidad: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  genero: z.enum(['M', 'F']).optional(),
  fechaNacimiento: z.string().optional(),
})

const perfilSchema = z.object({
  nombre: z.string().trim().min(1).max(40),
  correo: correoSchema,
  nacionalidad: z.string().trim().max(40).nullable().optional(),
  genero: z.enum(['M', 'F']).nullable().optional(),
  fechaNacimiento: z.string().trim().nullable().optional(),
  claveActual: z.string().optional(),
  claveNueva: z.string().max(128).optional(),
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
  nacionalidad: string | null
  genero: string | null
  fechaNacimiento: Date | null
  avatarUrl: string | null
}) {
  return {
    id: usuario.id,
    correo: usuario.correo,
    rol: usuario.rol,
    nombre: usuario.nombre,
    nacionalidad: usuario.nacionalidad,
    genero: usuario.genero,
    fechaNacimiento: fechaCorta(usuario.fechaNacimiento),
    avatarUrl: usuario.avatarUrl,
  }
}

router.post('/solicitar-codigo', limitarPeticiones('auth:solicitar-codigo', 3, 15 * 60 * 1000), async (req, res) => {
  const parsed = solicitarSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Correo inválido.' })
    return
  }
  try {
    const resultado = await solicitarCodigo.ejecutar(parsed.data.correo)
    res.json({
      ok: true,
      correo: parsed.data.correo.trim().toLowerCase(),
      bandeja: resultado.bandeja,
      expiraEn: resultado.expiraEn,
    })
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? Number((e as { status: number }).status) : 503
    const error = e instanceof Error ? e.message : 'No se pudo enviar el código.'
    res.status(Number.isFinite(status) ? status : 503).json({ error })
  }
})

router.post('/olvidar-clave', limitarPeticiones('auth:olvidar-clave', 3, 15 * 60 * 1000), async (req, res) => {
  const parsed = solicitarSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Correo inválido.' })
    return
  }
  try {
    const resultado = await solicitarCodigo.ejecutarRestablecimiento(parsed.data.correo)
    res.json({
      ok: true,
      correo: parsed.data.correo.trim().toLowerCase(),
      bandeja: resultado.bandeja,
      expiraEn: resultado.expiraEn,
    })
  } catch (e) {
    const status = e && typeof e === 'object' && 'status' in e ? Number((e as { status: number }).status) : 503
    const error = e instanceof Error ? e.message : 'No se pudo enviar el código.'
    res.status(Number.isFinite(status) ? status : 503).json({ error })
  }
})

const restablecerSchema = z.object({
  correo: correoSchema,
  codigo: z.string().regex(/^\d{6}$/),
  clave: claveSchema,
})

router.post('/restablecer-clave', limitarPeticiones('auth:restablecer-clave', 10, 15 * 60 * 1000), async (req, res) => {
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

router.post('/register', limitarPeticiones('auth:register', 5, 15 * 60 * 1000), async (req, res) => {
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
  const fechaNacimiento = leerFecha(parsed.data.fechaNacimiento)
  if (!fechaNacimiento) {
    res.status(400).json({ error: 'La fecha de nacimiento no es válida.' })
    return
  }
  const codigoOk = await consumirCodigo(correo, parsed.data.codigo)
  if (!codigoOk) {
    res.status(401).json({ error: 'Código incorrecto o vencido. Pide uno nuevo.' })
    return
  }
  const rol = 'jugador'
  const nombre = parsed.data.nombre.trim()
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
    nacionalidad: usuario.nacionalidad ?? undefined,
    genero: usuario.genero ?? undefined,
    fechaNacimiento: usuario.fechaNacimiento ?? undefined,
  })
  res.status(201).json({
    token,
    usuario: datosPublicos(usuario),
  })
})

router.post('/google', limitarPeticiones('auth:google', 10, 15 * 60 * 1000), async (req, res) => {
  const parsed = googleSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'No se recibieron los datos necesarios para continuar con Google.' })
    return
  }
  const audience = process.env.GOOGLE_CLIENT_ID?.trim()
  if (!audience) {
    res.status(503).json({ error: 'El acceso con Google todavía no está configurado en el servidor.' })
    return
  }
  const ticket = await google.verifyIdToken({ idToken: parsed.data.idToken, audience }).catch(() => null)
  if (!ticket) {
    res.status(401).json({ error: 'La sesión de Google no es válida o venció. Inténtalo otra vez.' })
    return
  }
  const identidad = ticket.getPayload()
  if (!identidad?.sub || !identidad.email || identidad.email_verified !== true) {
    res.status(401).json({ error: 'Google no pudo confirmar esta cuenta.' })
    return
  }
    const correo = identidad.email.trim().toLowerCase()
    const dominioWorkspace = Boolean(identidad.hd)
    const correoGoogleAutoritativo = correo.endsWith('@gmail.com') || dominioWorkspace
    if (!correoGoogleAutoritativo) {
      res.status(403).json({ error: 'Ese correo de Google requiere primero la verificación normal por correo.' })
      return
    }

    let usuario = await prisma.usuario.findUnique({ where: { googleSubject: identidad.sub } })
    if (usuario) {
      if (!usuario.avatarPersonalizado && identidad.picture) {
        usuario = await prisma.usuario.update({
          where: { id: usuario.id },
          data: { avatarUrl: identidad.picture },
        })
      }
    } else {
      usuario = await prisma.usuario.findUnique({ where: { correo } })
      if (usuario) {
        usuario = await prisma.usuario.update({
          where: { id: usuario.id },
          data: {
            googleSubject: identidad.sub,
            ...(!usuario.avatarPersonalizado && identidad.picture ? { avatarUrl: identidad.picture } : {}),
          },
        })
      } else {
        const fechaNacimiento = parsed.data.fechaNacimiento ? leerFecha(parsed.data.fechaNacimiento) : null
        if (!parsed.data.nombre || !parsed.data.nacionalidad || !parsed.data.genero || !fechaNacimiento) {
          res.status(400).json({ error: 'Para crear la cuenta, completa nombre, país, género y fecha de nacimiento en el formulario.' })
          return
        }
        usuario = await prisma.usuario.create({
          data: {
            correo,
            claveHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
            googleSubject: identidad.sub,
            avatarUrl: identidad.picture ?? null,
            rol: 'jugador',
            nombre: parsed.data.nombre,
            nacionalidad: parsed.data.nacionalidad.toLowerCase(),
            genero: parsed.data.genero,
            fechaNacimiento,
            progreso: { create: {} },
          },
        })
      }
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
  res.json({ token, usuario: datosPublicos(usuario) })
})

router.post('/login', limitarPeticiones('auth:login', 10, 15 * 60 * 1000), async (req, res) => {
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

router.put(
  '/perfil/avatar',
  authObligatoria,
  limitarPeticiones('auth:avatar', 10, 15 * 60 * 1000),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb', inflate: false }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      res.status(415).json({ error: 'Envía una imagen JPG, PNG o WebP.' })
      return
    }
    const id = req.usuario!.sub
    const actual = await prisma.usuario.findUnique({ where: { id }, select: { avatarUrl: true } })
    if (!actual) {
      res.status(404).json({ error: 'Usuario no encontrado.' })
      return
    }
    let nuevaUrl: string | null = null
    try {
      nuevaUrl = await almacenAvatares.guardar(id, req.headers['content-type'] ?? '', req.body)
      const usuario = await prisma.usuario.update({
        where: { id },
        data: { avatarUrl: nuevaUrl, avatarPersonalizado: true },
      })
      try {
        await almacenAvatares.borrar(actual.avatarUrl)
      } catch (error) {
        console.warn('No se pudo retirar el avatar anterior:', error instanceof Error ? error.message : 'error desconocido')
      }
      res.json({ usuario: datosPublicos(usuario) })
    } catch (error) {
      if (nuevaUrl) {
        try { await almacenAvatares.borrar(nuevaUrl) } catch { /* limpia en otra ocasión */ }
      }
      const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status: number }).status) : 503
      res.status(Number.isFinite(status) ? status : 503).json({
        error: error instanceof Error ? error.message : 'No se pudo guardar la imagen.',
      })
    }
  },
)

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
  const claveNueva = parsed.data.claveNueva ?? ''
  const correoCambia = correo !== actual.correo
  if (correoCambia || claveNueva) {
    const claveActual = parsed.data.claveActual ?? ''
    const coincide = claveActual ? await bcrypt.compare(claveActual, actual.claveHash) : false
    if (!coincide) {
      res.status(401).json({ error: 'La contraseña actual no coincide.' })
      return
    }
  }
  if (claveNueva && (claveNueva.length < 8 || !CLAVE_ALFANUMERICA.test(claveNueva))) {
    res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres e incluir letras y números.' })
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
    nacionalidad: usuario.nacionalidad ?? undefined,
    genero: usuario.genero ?? undefined,
    fechaNacimiento: usuario.fechaNacimiento ?? undefined,
  })
  res.json({ token, usuario: datosPublicos(usuario) })
})

export default router
