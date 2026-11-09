import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../infrastructure/prisma'

export type JwtPayload = {
  sub: string
  correo: string
  rol: 'jugador' | 'administrador'
  nombre: string
  nacionalidad?: string | null
  genero?: string | null
  fechaNacimiento?: Date | null
}

function secret(): string {
  const value = process.env.JWT_SECRET?.trim()
  if (!value || value.length < 32 || /^(cambia-esto|darkfantasy-dev|reemplazar)/i.test(value)) {
    throw new Error('JWT_SECRET debe configurarse con al menos 32 caracteres aleatorios.')
  }
  return value
}

export function firmarToken(payload: JwtPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: '7d', algorithm: 'HS256' })
}

export function validarConfiguracionAuth(): void {
  secret()
}

export async function authObligatoria(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) {
    res.status(401).json({ error: 'No hay sesión. Inicia sesión.' })
    return
  }
  let data: JwtPayload
  try {
    data = jwt.verify(token, secret(), { algorithms: ['HS256'] }) as JwtPayload
    if (typeof data.sub !== 'string' || !data.sub) throw new Error('Token sin usuario.')
  } catch {
    res.status(401).json({ error: 'Sesión inválida o vencida.' })
    return
  }

  let actual
  try {
    actual = await prisma.usuario.findUnique({
      where: { id: data.sub },
      select: { id: true, correo: true, rol: true, nombre: true, nacionalidad: true, genero: true, fechaNacimiento: true },
    })
  } catch {
    res.status(503).json({ error: 'No se pudo validar la sesión con la base de datos.' })
    return
  }
  if (!actual) {
    res.status(401).json({ error: 'La cuenta ya no está disponible. Inicia sesión de nuevo.' })
    return
  }
  if (actual.rol !== 'jugador' && actual.rol !== 'administrador') {
    res.status(403).json({ error: 'El rol de esta cuenta no está autorizado.' })
    return
  }
  req.usuario = {
    ...data,
    sub: actual.id,
    correo: actual.correo,
    rol: actual.rol,
    nombre: actual.nombre,
    nacionalidad: actual.nacionalidad,
    genero: actual.genero,
    fechaNacimiento: actual.fechaNacimiento ?? undefined,
  }
  next()
}

export function soloAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.usuario?.rol !== 'administrador') {
    res.status(403).json({ error: 'Solo el administrador puede ver esto.' })
    return
  }
  next()
}

declare global {
  namespace Express {
    interface Request {
      usuario?: JwtPayload
    }
  }
}
