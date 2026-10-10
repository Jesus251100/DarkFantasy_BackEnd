import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'

export type JwtPayload = {
  sub: string
  correo: string
  rol: 'jugador' | 'administrador'
  nombre: string
}

const secret = () => process.env.JWT_SECRET ?? 'darkfantasy-dev'

export function firmarToken(payload: JwtPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: '7d' })
}

export function authObligatoria(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) {
    res.status(401).json({ error: 'No hay sesión. Inicia sesión.' })
    return
  }
  try {
    const data = jwt.verify(token, secret()) as JwtPayload
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
