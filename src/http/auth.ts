import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'

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

export function authObligatoria(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) {
    res.status(401).json({ error: 'No hay sesión. Inicia sesión.' })
    return
  }
  try {
    const data = jwt.verify(token, secret(), { algorithms: ['HS256'] }) as JwtPayload
    req.usuario = data
    next()
  } catch {
    res.status(401).json({ error: 'Sesión inválida o vencida.' })
  }
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
