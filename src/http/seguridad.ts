import type { Request, Response, NextFunction } from 'express'

export const origenPermitido = (origen: string | undefined, callback: (error: Error | null, permitido?: boolean) => void) => {
  const configurados = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((valor) => valor.trim())
    .filter(Boolean)
  
  const permitidos = configurados.length
    ? configurados
    : ['http://localhost:5173', 'http://127.0.0.1:5173']

  // Permite localhost o cualquier despliegue que termine en .vercel.app
  if (!origen || permitidos.includes(origen) || origen.endsWith('.vercel.app')) {
    callback(null, true)
  } else {
    callback(new Error('Origen no permitido por CORS.'))
  }
}

const ventanas = new Map<string, { inicio: number; cantidad: number }>()

export function limitarPeticiones(clave: string, maximo: number, ventanaMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ahora = Date.now()
    const id = `${clave}:${req.ip ?? req.socket.remoteAddress ?? 'desconocida'}`
    const ventana = ventanas.get(id)
    if (!ventana || ahora - ventana.inicio >= ventanaMs) {
      ventanas.set(id, { inicio: ahora, cantidad: 1 })
      next()
      return
    }
    if (ventana.cantidad >= maximo) {
      res.setHeader('Retry-After', String(Math.ceil((ventanaMs - (ahora - ventana.inicio)) / 1000)))
      res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' })
      return
    }
    ventana.cantidad += 1
    next()
  }
}

setInterval(() => {
  const ahora = Date.now()
  for (const [clave, ventana] of ventanas) {
    if (ahora - ventana.inicio > 15 * 60 * 1000) ventanas.delete(clave)
  }
}, 5 * 60 * 1000).unref()