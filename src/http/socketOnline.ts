import type { Server as HttpServer } from 'node:http'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import { CazaDragones, PREMIOS_CAZA, type Cazador, type OyenteCaza } from '../application/CazaDragones'
import { GestionSalas, type MiembroCola, type OyenteSalas } from '../application/GestionSalas'
import type { SalaOnline } from '../domain/online/SalaOnline'
import { prisma } from '../infrastructure/prisma'
import { PrismaPartidasOnlineRepo } from '../infrastructure/PrismaPartidasOnlineRepo'
import { pagarDiamantesCaza } from '../infrastructure/PrismaRecompensaCaza'
import type { JwtPayload } from './auth'

const CUPO_SALA = 4
const PUNTOS_POR_VICTORIA = 25

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

  const avisarRuleta = async (cazadores: Cazador[], diamantes: number) => {
    const pagado = await pagarDiamantesCaza(
      cazadores.map((cazador) => cazador.usuarioId),
      diamantes,
    )
    const premio = {
      diamantes,
      pagado,
      opciones: PREMIOS_CAZA.map((premioCaza) => ({
        diamantes: premioCaza.diamantes,
        peso: premioCaza.peso,
      })),
    }
    for (const cazador of cazadores) {
      io.to(cazador.socketId).emit('dragon:ruleta', premio)
    }
  }

  const oyenteCaza: OyenteCaza = {
    onEspera(socketId, esperando) {
      io.to(socketId).emit('dragon:esperando', { esperando })
    },
    onInicio(caceriaId, cazadores) {
      for (const cazador of cazadores) {
        const rival = cazadores.find((otro) => otro.usuarioId !== cazador.usuarioId)
        io.to(cazador.socketId).emit('dragon:inicio', {
          id: caceriaId,
          rival: rival?.nombre ?? 'Cazador',
        })
      }
    },
    onEstado(cazador, vista) {
      io.to(cazador.socketId).emit('dragon:estado', vista)
    },
    onBola(_caceriaId, numero, cazadores) {
      for (const cazador of cazadores) {
        io.to(cazador.socketId).emit('dragon:bola', { numero })
      }
    },
    onRechazo(socketId, mensaje) {
      io.to(socketId).emit('dragon:rechazo', { mensaje })
    },
    onVictoria(_caceriaId, cazadores, diamantes) {
      void avisarRuleta(cazadores, diamantes)
    },
    onDerrota(_caceriaId, cazadores, mensaje) {
      for (const cazador of cazadores) {
        io.to(cazador.socketId).emit('dragon:fin', { resultado: 'derrota', mensaje })
      }
    },
  }

  const caza = new CazaDragones(oyenteCaza)

  interface Espera {
    codigo: string
    anfitrionId: string
    miembros: MiembroCola[]
  }

  const esperas = new Map<string, Espera>()
  const esperaDe = new Map<string, string>()
  const salasCaza = new Map<string, Espera>()
  const cazaDe = new Map<string, string>()

  const codigoNuevo = (): string => {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let codigo = ''
    for (let i = 0; i < 4; i += 1) {
      codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)]
    }
    return esperas.has(codigo) || salasCaza.has(codigo) ? codigoNuevo() : codigo
  }

  const vistaEspera = (espera: Espera) => ({
    codigo: espera.codigo,
    anfitrionId: espera.anfitrionId,
    jugadores: espera.miembros.map((miembro) => ({
      id: miembro.usuarioId,
      nombre: miembro.nombre,
    })),
  })

  const emitirEspera = (espera: Espera) => {
    const vista = vistaEspera(espera)
    for (const miembro of espera.miembros) {
      io.to(miembro.socketId).emit('room:state', vista)
    }
  }

  const salirEspera = (usuarioId: string) => {
    const codigo = esperaDe.get(usuarioId)
    if (!codigo) return
    const espera = esperas.get(codigo)
    esperaDe.delete(usuarioId)
    if (!espera) return
    espera.miembros = espera.miembros.filter((miembro) => miembro.usuarioId !== usuarioId)
    if (espera.miembros.length === 0) {
      esperas.delete(codigo)
      return
    }
    if (espera.anfitrionId === usuarioId) {
      espera.anfitrionId = espera.miembros[0]?.usuarioId ?? espera.anfitrionId
    }
    emitirEspera(espera)
  }

  const emitirSalaCaza = (sala: Espera) => {
    const vista = vistaEspera(sala)
    for (const miembro of sala.miembros) {
      io.to(miembro.socketId).emit('dragon:sala', vista)
    }
  }

  const salirSalaCaza = (usuarioId: string) => {
    const codigo = cazaDe.get(usuarioId)
    if (!codigo) return
    const sala = salasCaza.get(codigo)
    cazaDe.delete(usuarioId)
    if (!sala) return
    sala.miembros = sala.miembros.filter((miembro) => miembro.usuarioId !== usuarioId)
    if (sala.miembros.length === 0) {
      salasCaza.delete(codigo)
      return
    }
    if (sala.anfitrionId === usuarioId) {
      sala.anfitrionId = sala.miembros[0]?.usuarioId ?? sala.anfitrionId
    }
    emitirSalaCaza(sala)
  }

  const miembroDe = (socketId: string, sesionActual: Sesion): MiembroCola => ({
    usuarioId: sesionActual.usuarioId,
    nombre: sesionActual.nombre,
    socketId,
  })

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
    void socket.join('lobby-online')

    const codigoCaza = cazaDe.get(sesion.usuarioId)
    if (codigoCaza) {
      const salaCaza = salasCaza.get(codigoCaza)
      const miembroCaza = salaCaza?.miembros.find((item) => item.usuarioId === sesion.usuarioId)
      if (salaCaza && miembroCaza) {
        miembroCaza.socketId = socket.id
        emitirSalaCaza(salaCaza)
      }
    }

    socket.on('ranking:pedir', () => {
      void listarRanking()
        .then((filas) => {
          const yaEsta = filas.some((fila) => fila.nombre === sesion.nombre)
          const lista = yaEsta
            ? filas
            : [{ nombre: sesion.nombre, puntos: 0, victorias: 0 }, ...filas]
          socket.emit('ranking:lista', lista.slice(0, 8))
        })
        .catch(() => {
          socket.emit('ranking:lista', [{ nombre: sesion.nombre, puntos: 0, victorias: 0 }])
        })
    })

    socket.on('chat:send', (payload: { texto?: string }) => {
      const texto = String(payload?.texto ?? '').trim().slice(0, 80)
      if (!texto) return
      const mensaje = {
        id: `${Date.now()}-${socket.id}`,
        nombre: sesion.nombre,
        texto,
      }
      const codigo = esperaDe.get(sesion.usuarioId)
      const espera = codigo ? esperas.get(codigo) : undefined
      if (espera) {
        for (const miembro of espera.miembros) {
          io.to(miembro.socketId).emit('chat:message', mensaje)
        }
        return
      }
      const sala = gestion.salaDe(sesion.usuarioId)
      if (sala) {
        io.to(sala.id).emit('chat:message', mensaje)
        return
      }
      io.to('lobby-online').emit('chat:message', mensaje)
    })

    socket.on('room:create', () => {
      gestion.salirCola(sesion.usuarioId)
      caza.salir(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
      const espera: Espera = {
        codigo: codigoNuevo(),
        anfitrionId: sesion.usuarioId,
        miembros: [miembroDe(socket.id, sesion)],
      }
      esperas.set(espera.codigo, espera)
      esperaDe.set(sesion.usuarioId, espera.codigo)
      emitirEspera(espera)
    })

    socket.on('room:join', (payload: { codigo?: string }) => {
      const codigo = String(payload?.codigo ?? '').trim().toUpperCase()
      const espera = esperas.get(codigo)
      if (!espera) {
        socket.emit('room:error', { mensaje: 'Esa sala no existe.' })
        return
      }
      if (espera.miembros.some((miembro) => miembro.usuarioId === sesion.usuarioId)) {
        emitirEspera(espera)
        return
      }
      if (espera.miembros.length >= CUPO_SALA) {
        socket.emit('room:error', { mensaje: 'La sala ya está llena.' })
        return
      }
      gestion.salirCola(sesion.usuarioId)
      caza.salir(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
      espera.miembros.push(miembroDe(socket.id, sesion))
      esperaDe.set(sesion.usuarioId, espera.codigo)
      emitirEspera(espera)
    })

    socket.on('room:leave', () => {
      salirEspera(sesion.usuarioId)
      socket.emit('room:closed')
    })

    socket.on('room:start', () => {
      const codigo = esperaDe.get(sesion.usuarioId)
      const espera = codigo ? esperas.get(codigo) : undefined
      if (!espera || espera.anfitrionId !== sesion.usuarioId) {
        socket.emit('room:error', { mensaje: 'Solo quien creó la sala puede empezarla.' })
        return
      }
      const miembros = espera.miembros.map((miembro) => ({ ...miembro }))
      esperas.delete(espera.codigo)
      for (const miembro of miembros) esperaDe.delete(miembro.usuarioId)
      gestion.iniciarSala(miembros)
    })

    socket.on('booster:lanzar', (payload: { boosterId?: number; objetivoId?: string }) => {
      const sala = gestion.salaDe(sesion.usuarioId)
      const boosterId = Number(payload?.boosterId)
      const objetivoId = String(payload?.objetivoId ?? '')
      if (!sala || sala.estadoActual !== 'playing') return
      if (![1, 2, 3, 4].includes(boosterId) || !objetivoId) return
      const objetivo = sala.jugadores.find((jugador) => jugador.id === objetivoId)
      if (!objetivo) return
      io.to(sala.id).emit('booster:vuelo', {
        deId: sesion.usuarioId,
        deNombre: sesion.nombre,
        boosterId,
        objetivoId,
      })
    })

    socket.on('queue:join', () => {
      caza.salir(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
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

    socket.on('dragon:create', () => {
      gestion.salirCola(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      caza.salir(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
      const sala: Espera = {
        codigo: codigoNuevo(),
        anfitrionId: sesion.usuarioId,
        miembros: [miembroDe(socket.id, sesion)],
      }
      salasCaza.set(sala.codigo, sala)
      cazaDe.set(sesion.usuarioId, sala.codigo)
      emitirSalaCaza(sala)
    })

    socket.on('dragon:code', (payload: { codigo?: string }) => {
      const codigo = String(payload?.codigo ?? '').trim().toUpperCase()
      const sala = salasCaza.get(codigo)
      if (!sala) {
        socket.emit('dragon:error', { mensaje: 'Esa sala no existe.' })
        return
      }
      const ya = sala.miembros.find((miembro) => miembro.usuarioId === sesion.usuarioId)
      if (ya) {
        ya.socketId = socket.id
        emitirSalaCaza(sala)
        return
      }
      if (sala.miembros.length >= 2) {
        socket.emit('dragon:error', { mensaje: 'La sala ya está llena.' })
        return
      }
      gestion.salirCola(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      caza.salir(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
      sala.miembros.push(miembroDe(socket.id, sesion))
      cazaDe.set(sesion.usuarioId, sala.codigo)
      emitirSalaCaza(sala)
    })

    socket.on('dragon:room-leave', () => {
      salirSalaCaza(sesion.usuarioId)
      socket.emit('dragon:sala-cerrada')
    })

    socket.on('dragon:start', () => {
      const codigo = cazaDe.get(sesion.usuarioId)
      const sala = codigo ? salasCaza.get(codigo) : undefined
      if (!sala || sala.anfitrionId !== sesion.usuarioId) {
        socket.emit('dragon:error', { mensaje: 'Solo quien creó la sala puede empezarla.' })
        return
      }
      if (sala.miembros.length < 2) {
        socket.emit('dragon:error', { mensaje: 'Hace falta que tu amigo se una con el código.' })
        return
      }
      const miembros = sala.miembros.map((miembro) => ({ ...miembro }))
      salasCaza.delete(sala.codigo)
      for (const miembro of miembros) cazaDe.delete(miembro.usuarioId)
      caza.iniciarCon(miembros)
    })

    socket.on('dragon:join', () => {
      gestion.salirCola(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
      caza.entrar(sesion.usuarioId, sesion.nombre, socket.id)
    })

    socket.on('dragon:leave', () => {
      caza.salir(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
      socket.emit('dragon:left')
    })

    socket.on('dragon:claim', () => {
      caza.reclamar(sesion.usuarioId)
    })

    socket.on('disconnect', () => {
      sesiones.delete(socket.id)
      salirEspera(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
      caza.salir(sesion.usuarioId)
      gestion.abandonar(sesion.usuarioId)
    })
  })

  return io
}

async function listarRanking(): Promise<{ nombre: string; puntos: number; victorias: number }[]> {
  const grupos = await prisma.participacionOnline.groupBy({
    by: ['nombre'],
    where: { esBot: false, gano: true },
    _count: { _all: true },
  })
  return grupos
    .map((grupo) => ({
      nombre: grupo.nombre,
      victorias: grupo._count._all,
      puntos: grupo._count._all * PUNTOS_POR_VICTORIA,
    }))
    .sort((a, b) => b.puntos - a.puntos)
}
