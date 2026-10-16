import type { Server as HttpServer } from 'node:http'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import { GestionSalas, type MiembroCola, type OyenteSalas } from '../application/GestionSalas'
import type { SalaOnline } from '../domain/online/SalaOnline'
import { PrismaPartidasOnlineRepo } from '../infrastructure/PrismaPartidasOnlineRepo'
import type { JwtPayload } from './auth'

const secreto = () => process.env.JWT_SECRET ?? 'darkfantasy-dev'

interface Sesion {
  usuarioId: string
  nombre: string
}

export function montarOnline(servidor: HttpServer): Server {
  const io = new Server(servidor, {
    cors: { origin: true, credentials: true },
  })

  const repo = new PrismaPartidasOnlineRepo()

  const sesiones = new Map<string, Sesion>()

  const emitirVista = (usuarioId: string, socketId: string, sala: SalaOnline, evento: string) => {
    io.to(socketId).emit(evento, sala.vistaPara(usuarioId))
  }

  const oyente: OyenteSalas = {
    onEmparejar(sala, humanos) {
      for (const humano of humanos) {
        const socket = io.sockets.sockets.get(humano.socketId)
        if (!socket) continue
        void socket.join(sala.id)
        socket.emit('match:found', { salaId: sala.id })
        emitirVista(humano.usuarioId, humano.socketId, sala, 'room:state')
      }
    },
    onCantar(sala, numero) {
      io.to(sala.id).emit('ball:called', { salaId: sala.id, numero })
    },
    onTerminar(sala, ganadorId) {
      const ganador = sala.jugadores.find((j) => j.id === ganadorId) ?? null
      for (const humano of sala.humanos()) {
        if (humano.socketId) {
          emitirVista(humano.id, humano.socketId, sala, 'game:over')
        }
      }
      io.to(sala.id).emit('game:summary', {
        salaId: sala.id,
        ganadorId,
        ganadorNombre: ganador?.nombre ?? null,
      })
      io.in(sala.id).socketsLeave(sala.id)
    },
    onRechazo(socketId, mensaje) {
      io.to(socketId).emit('claim:rejected', { mensaje })
    },
    onAlertaCola(humanos, mensaje) {
      for (const humano of humanos) {
        io.to(humano.socketId).emit('queue:warning', { mensaje })
      }
    },
  }

  const gestion = new GestionSalas(oyente, repo)

  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined) ?? ''
    if (!token) {
      next(new Error('Falta el token de sesión.'))
      return
    }
    try {
      const data = jwt.verify(token, secreto()) as JwtPayload
      socket.data.sesion = { usuarioId: data.sub, nombre: data.nombre } satisfies Sesion
      next()
    } catch {
      next(new Error('Sesión inválida o vencida.'))
    }
  })

  io.on('connection', (socket) => {
    const sesion = socket.data.sesion as Sesion
    sesiones.set(socket.id, sesion)

    socket.emit('online:ready', { usuarioId: sesion.usuarioId, nombre: sesion.nombre })

    socket.on('queue:join', () => {
      const miembro: MiembroCola = {
        usuarioId: sesion.usuarioId,
        nombre: sesion.nombre,
        socketId: socket.id,
      }
      gestion.entrarCola(miembro.usuarioId, miembro.nombre, miembro.socketId)
      socket.emit('queue:joined', { usuarioId: sesion.usuarioId })
    })

    socket.on('queue:leave', () => {
      gestion.salirCola(sesion.usuarioId)
      socket.emit('queue:left', { usuarioId: sesion.usuarioId })
    })

    socket.on('game:claim', () => {
      gestion.reclamarBingo(sesion.usuarioId)
    })

    socket.on('disconnect', () => {
      sesiones.delete(socket.id)
      gestion.abandonar(sesion.usuarioId)
    })
  })

  return io
}
