import type { Server as HttpServer } from 'node:http'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import { CazaDragones, PREMIOS_CAZA, type Cazador, type OyenteCaza } from '../application/CazaDragones'
import { GestionSalas, type MiembroCola, type OyenteSalas } from '../application/GestionSalas'
import type { SalaOnline } from '../domain/online/SalaOnline'
import { prisma } from '../infrastructure/prisma'
import { PrismaPartidasOnlineRepo } from '../infrastructure/PrismaPartidasOnlineRepo'
import { pagarDiamantesCaza, pagarExperienciaCaza } from '../infrastructure/PrismaRecompensaCaza'
import type { JwtPayload } from './auth'
import { origenPermitido } from './seguridad'
import { RECARGA_BOOSTER_MS } from '../domain/online/efectosBooster'
import { CONFIG_ONLINE } from '../domain/online/ConfigOnline'

const CUPO_SALA = 4
const PUNTOS_POR_VICTORIA = 25

function secreto(): string {
  const value = process.env.JWT_SECRET?.trim()
  if (!value || value.length < 32 || /^(cambia-esto|darkfantasy-dev|reemplazar)/i.test(value)) {
    throw new Error('JWT_SECRET debe configurarse con al menos 32 caracteres aleatorios.')
  }
  return value
}

interface Sesion {
  usuarioId: string
  nombre: string
  avatarUrl: string | null
}

export function montarOnline(servidor: HttpServer): Server {
  const io = new Server(servidor, {
    cors: { origin: origenPermitido, credentials: true },
  })

  const repo = new PrismaPartidasOnlineRepo()

  const sesiones = new Map<string, Sesion>()
  const recargasBooster = new Map<string, number>()

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
    onRankingActualizado() {
      void listarRanking().then((filas) => io.to('lobby-online').emit('ranking:lista', filas.slice(0, 8)))
      for (const socket of io.sockets.sockets.values()) {
        const sesionActual = sesiones.get(socket.id)
        if (sesionActual) {
          void repo.obtenerPuntosRanking(sesionActual.usuarioId)
            .then((puntos) => socket.emit('ranking:perfil', { puntos }))
            .catch(() => undefined)
        }
      }
    },
    onProgresoActualizado(usuarioIds) {
      for (const usuarioId of usuarioIds) {
        for (const socket of io.sockets.sockets.values()) {
          if (sesiones.get(socket.id)?.usuarioId === usuarioId) socket.emit('profile:refresh')
        }
      }
    },
    onAbandono(usuarioId, salaId) {
      void repo.penalizarAbandono(usuarioId, salaId)
        .then(() => void listarRanking().then((filas) => io.to('lobby-online').emit('ranking:lista', filas.slice(0, 8))))
        .catch((error: unknown) => {
          const mensaje = error instanceof Error ? error.message : 'error desconocido'
          console.error(`No se pudo penalizar el abandono tras desconexión: ${mensaje}`)
        })
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
      void pagarExperienciaCaza(cazadores.map((cazador) => cazador.usuarioId), 25).then((pagada) => {
        for (const cazador of cazadores) {
          io.to(cazador.socketId).emit('dragon:fin', { resultado: 'derrota', mensaje, xp: pagada ? 25 : 0 })
          io.to(cazador.socketId).emit('profile:refresh')
        }
      })
    },
  }

  const caza = new CazaDragones(oyenteCaza)

  interface Espera {
    codigo: string
    anfitrionId: string
    miembros: MiembroCola[]
    completarConBots: boolean
  }

  const esperas = new Map<string, Espera>()
  const esperaDe = new Map<string, string>()
  const salasCaza = new Map<string, Espera>()
  const cazaDe = new Map<string, string>()
  const temporizadoresSala = new Map<string, ReturnType<typeof setTimeout>>()

  const cancelarTemporizadorSala = (usuarioId: string) => {
    const timer = temporizadoresSala.get(usuarioId)
    if (timer) clearTimeout(timer)
    temporizadoresSala.delete(usuarioId)
  }

  const programarRetiroSala = (usuarioId: string, socketId: string) => {
    cancelarTemporizadorSala(usuarioId)
    const timer = setTimeout(() => {
      temporizadoresSala.delete(usuarioId)
      const codigoEspera = esperaDe.get(usuarioId)
      const espera = codigoEspera ? esperas.get(codigoEspera) : undefined
      if (espera?.miembros.some((miembro) => miembro.usuarioId === usuarioId && miembro.socketId === socketId)) {
        salirEspera(usuarioId)
      }
      const codigoCaza = cazaDe.get(usuarioId)
      const salaCaza = codigoCaza ? salasCaza.get(codigoCaza) : undefined
      if (salaCaza?.miembros.some((miembro) => miembro.usuarioId === usuarioId && miembro.socketId === socketId)) {
        salirSalaCaza(usuarioId)
      }
    }, CONFIG_ONLINE.reconnectGraceMs)
    temporizadoresSala.set(usuarioId, timer)
  }

  const codigoNuevo = (): string => {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    let codigo = ''
    for (let i = 0; i < 4; i += 1) {
      codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)]
    }
    return esperas.has(codigo) || salasCaza.has(codigo) ? codigoNuevo() : codigo
  }

  const vistaEspera = (espera: Espera) => ({
    codigo: espera.codigo,
    anfitrionId: espera.anfitrionId,
    completarConBots: espera.completarConBots,
    jugadores: espera.miembros.map((miembro) => ({
      id: miembro.usuarioId,
      nombre: miembro.nombre,
      avatarUrl: miembro.avatarUrl,
    })),
  })

  const emitirEspera = (espera: Espera) => {
    const vista = vistaEspera(espera)
    for (const miembro of espera.miembros) {
      io.to(miembro.socketId).emit('room:state', vista)
    }
  }

  const salirEspera = (usuarioId: string) => {
    cancelarTemporizadorSala(usuarioId)
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
    cancelarTemporizadorSala(usuarioId)
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
    avatarUrl: sesionActual.avatarUrl,
    socketId,
  })

  io.use(async (socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined) ?? ''
    if (!token) {
      next(new Error('Falta el token de sesión.'))
      return
    }
    try {
      const data = jwt.verify(token, secreto(), { algorithms: ['HS256'] }) as JwtPayload
      const usuario = await prisma.usuario.findUnique({
        where: { id: data.sub },
        select: { nombre: true, avatarUrl: true },
      })
      if (!usuario) {
        next(new Error('La cuenta de esta sesión ya no existe.'))
        return
      }
      socket.data.sesion = { usuarioId: data.sub, nombre: usuario.nombre, avatarUrl: usuario.avatarUrl } satisfies Sesion
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

    const codigoEspera = esperaDe.get(sesion.usuarioId)
    const salaEspera = codigoEspera ? esperas.get(codigoEspera) : undefined
    const miembroEspera = salaEspera?.miembros.find((item) => item.usuarioId === sesion.usuarioId)
    if (salaEspera && miembroEspera) {
      cancelarTemporizadorSala(sesion.usuarioId)
      miembroEspera.socketId = socket.id
      emitirEspera(salaEspera)
    }

    const codigoCaza = cazaDe.get(sesion.usuarioId)
    if (codigoCaza) {
      const salaCaza = salasCaza.get(codigoCaza)
      const miembroCaza = salaCaza?.miembros.find((item) => item.usuarioId === sesion.usuarioId)
      if (salaCaza && miembroCaza) {
        cancelarTemporizadorSala(sesion.usuarioId)
        miembroCaza.socketId = socket.id
        emitirSalaCaza(salaCaza)
      }
    }

    if (gestion.reconectarCola(sesion.usuarioId, socket.id)) {
      socket.emit('queue:joined', { usuarioId: sesion.usuarioId, reconectada: true })
    }
    const partidaAntesDeReconectar = gestion.salaDe(sesion.usuarioId)
    const jugadorAntesDeReconectar = partidaAntesDeReconectar?.jugadores.find((item) => item.id === sesion.usuarioId)
    const estabaDesconectado = jugadorAntesDeReconectar ? !jugadorAntesDeReconectar.conectado : false
    const partidaReanudada = gestion.reconectarPartida(sesion.usuarioId, socket.id)
    if (partidaReanudada) {
      void socket.join(partidaReanudada.id)
      socket.emit('match:found', { salaId: partidaReanudada.id, reconectada: true })
      emitirVista(sesion.usuarioId, socket.id, partidaReanudada, 'room:state')
      if (estabaDesconectado) {
        io.to(partidaReanudada.id).emit('game:connection-resumed', { nombre: sesion.nombre })
        for (const humano of partidaReanudada.humanos()) {
          if (humano.socketId && humano.socketId !== socket.id && humano.conectado) {
            emitirVista(humano.id, humano.socketId, partidaReanudada, 'room:state')
          }
        }
      }
    }

    socket.on('ranking:pedir', () => {
      void Promise.all([listarRanking(), repo.obtenerPuntosRanking(sesion.usuarioId)])
        .then(([filas, puntos]) => {
          socket.emit('ranking:lista', filas.slice(0, 8))
          socket.emit('ranking:perfil', { puntos })
        })
        .catch(() => {
          socket.emit('ranking:error', { mensaje: 'No se pudo cargar el ranking.' })
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
      gestion.abandonar(sesion.usuarioId)
      caza.salir(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
      const espera: Espera = {
        codigo: codigoNuevo(),
        anfitrionId: sesion.usuarioId,
        miembros: [miembroDe(socket.id, sesion)],
        completarConBots: false,
      }
      esperas.set(espera.codigo, espera)
      esperaDe.set(sesion.usuarioId, espera.codigo)
      emitirEspera(espera)
    })

    socket.on('room:join', (payload: { codigo?: string }) => {
      const codigo = String(payload?.codigo ?? '').trim().toUpperCase()
      const partidaActual = gestion.salaDe(sesion.usuarioId)
      if (partidaActual) {
        socket.emit('match:found', { salaId: partidaActual.id, reconectada: true })
        emitirVista(sesion.usuarioId, socket.id, partidaActual, 'room:state')
        return
      }
      const espera = esperas.get(codigo)
      if (!espera) {
        socket.emit('room:error', { mensaje: 'Esa sala no existe.' })
        return
      }
      const miembroExistente = espera.miembros.find((miembro) => miembro.usuarioId === sesion.usuarioId)
      if (miembroExistente) {
        cancelarTemporizadorSala(sesion.usuarioId)
        miembroExistente.socketId = socket.id
        emitirEspera(espera)
        return
      }
      if (espera.miembros.length >= CUPO_SALA) {
        socket.emit('room:error', { mensaje: 'La sala ya está llena.' })
        return
      }
      gestion.salirCola(sesion.usuarioId)
      gestion.abandonar(sesion.usuarioId)
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

    socket.on('room:bots', (payload: { habilitado?: boolean }) => {
      const codigo = esperaDe.get(sesion.usuarioId)
      const espera = codigo ? esperas.get(codigo) : undefined
      if (!espera || espera.anfitrionId !== sesion.usuarioId) {
        socket.emit('room:error', { mensaje: 'Solo el anfitrión puede configurar los bots.' })
        return
      }
      espera.completarConBots = payload?.habilitado === true
      emitirEspera(espera)
    })

    socket.on('room:start', () => {
      const codigo = esperaDe.get(sesion.usuarioId)
      const espera = codigo ? esperas.get(codigo) : undefined
      if (!espera || espera.anfitrionId !== sesion.usuarioId) {
        socket.emit('room:error', { mensaje: 'Solo quien creó la sala puede empezarla.' })
        return
      }
      if (espera.miembros.length < CUPO_SALA && !espera.completarConBots) {
        socket.emit('room:error', { mensaje: 'Espera a que se llene la sala o activa el relleno con bots.' })
        return
      }
      const miembros = espera.miembros.map((miembro) => ({ ...miembro }))
      esperas.delete(espera.codigo)
      for (const miembro of miembros) {
        esperaDe.delete(miembro.usuarioId)
        cancelarTemporizadorSala(miembro.usuarioId)
      }
      gestion.iniciarSala(miembros, espera.completarConBots)
      for (const miembro of miembros) {
        if (!io.sockets.sockets.has(miembro.socketId)) gestion.desconectar(miembro.usuarioId, miembro.socketId)
      }
    })

    socket.on('game:leave', (ack?: () => void) => {
      void (async () => {
        const sala = gestion.salaDe(sesion.usuarioId)
        const correspondePenalizacion = sala?.estadoActual === 'playing'
        try {
          if (sala && correspondePenalizacion) await repo.penalizarAbandono(sesion.usuarioId, sala.id)
        } catch (error) {
          const mensaje = error instanceof Error ? error.message : 'error desconocido'
          console.error(`No se pudo registrar la penalización por abandono: ${mensaje}`)
        } finally {
          gestion.abandonar(sesion.usuarioId)
          if (typeof ack === 'function') ack()
          void repo.obtenerPuntosRanking(sesion.usuarioId)
            .then((puntos) => socket.emit('ranking:perfil', { puntos }))
            .catch(() => undefined)
          socket.emit('profile:refresh')
          void listarRanking().then((filas) => io.to('lobby-online').emit('ranking:lista', filas.slice(0, 8)))
        }
      })()
    })

    socket.on('booster:lanzar', (payload: { boosterId?: number; objetivoId?: string }) => {
      void (async () => {
      try {
      const sala = gestion.salaDe(sesion.usuarioId)
      if (!sala) {
        socket.emit('booster:rechazo', { mensaje: 'No estás en una partida.' })
        return
      }
      const boosterId = Number(payload?.boosterId)
      const objetivoId = String(payload?.objetivoId ?? '')
      const recarga = RECARGA_BOOSTER_MS[boosterId]
      const objetivo = sala.jugadores.some((jugador) => jugador.id === objetivoId)
      if (!recarga || !objetivo) {
        socket.emit('booster:rechazo', { mensaje: 'Booster u objetivo inválido.' })
        return
      }
      const claveRecarga = `${sesion.usuarioId}:${boosterId}`
      const disponibleEn = recargasBooster.get(claveRecarga) ?? 0
      if (disponibleEn > Date.now()) {
        const segundos = Math.ceil((disponibleEn - Date.now()) / 1000)
        socket.emit('booster:rechazo', { mensaje: `Este booster estará listo en ${segundos}s.` })
        return
      }
      const stockRestante = await cambiarStockBooster(sesion.usuarioId, boosterId, -1)
      if (stockRestante === null) {
        socket.emit('booster:rechazo', { mensaje: 'No tienes unidades de este booster en el inventario.' })
        return
      }
      const resultado = sala.lanzarBooster(sesion.usuarioId, objetivoId, boosterId)
      if (!resultado.ok) {
        await cambiarStockBooster(sesion.usuarioId, boosterId, 1)
        socket.emit('booster:rechazo', { mensaje: resultado.error ?? 'Lanzamiento no válido.' })
        return
      }
      recargasBooster.set(claveRecarga, Date.now() + recarga)
      io.to(sala.id).emit('booster:lanzado', {
        deId: sesion.usuarioId,
        deNombre: sesion.nombre,
        boosterId,
        stockRestante,
        objetivoId,
        objetivoNombre: resultado.objetivoNombre,
        tipo: resultado.tipo,
        aplicado: resultado.aplicado,
        bloqueadoPorEscudo: resultado.bloqueadoPorEscudo,
        hasta: resultado.hasta,
        restanteMs: resultado.restanteMs,
        ahora: Date.now(),
        casillasBloqueadas: resultado.casillasBloqueadas,
        numerosFalsos: resultado.numerosFalsos,
      })
      for (const humano of sala.humanos()) {
        if (humano.socketId) emitirVista(humano.id, humano.socketId, sala, 'room:state')
      }
      } catch (error) {
        console.error('No se pudo procesar el booster online:', error)
        socket.emit('booster:rechazo', { mensaje: 'No se pudo procesar el booster. Inténtalo de nuevo.' })
      }
      })()
    })

    socket.on('queue:join', () => {
      caza.salir(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
      const miembro: MiembroCola = {
        usuarioId: sesion.usuarioId,
        nombre: sesion.nombre,
        avatarUrl: sesion.avatarUrl,
        socketId: socket.id,
      }
      socket.emit('queue:joined', { usuarioId: sesion.usuarioId })
      gestion.entrarCola(miembro.usuarioId, miembro.nombre, miembro.socketId, miembro.avatarUrl)
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
      gestion.abandonar(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      caza.salir(sesion.usuarioId)
      salirSalaCaza(sesion.usuarioId)
      const sala: Espera = {
        codigo: codigoNuevo(),
        anfitrionId: sesion.usuarioId,
        miembros: [miembroDe(socket.id, sesion)],
        completarConBots: false,
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
      gestion.abandonar(sesion.usuarioId)
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
      for (const miembro of miembros) {
        cazaDe.delete(miembro.usuarioId)
        cancelarTemporizadorSala(miembro.usuarioId)
      }
      caza.iniciarCon(miembros)
    })

    socket.on('dragon:join', () => {
      gestion.salirCola(sesion.usuarioId)
      gestion.abandonar(sesion.usuarioId)
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
      if (esperaDe.has(sesion.usuarioId) || cazaDe.has(sesion.usuarioId)) {
        programarRetiroSala(sesion.usuarioId, socket.id)
      }
      if (!cazaDe.has(sesion.usuarioId)) caza.salir(sesion.usuarioId)
      const salaDesconectada = gestion.desconectar(sesion.usuarioId, socket.id)
      if (salaDesconectada) {
        io.to(salaDesconectada.id).emit('game:connection-paused', {
          nombre: sesion.nombre,
          graciaMs: CONFIG_ONLINE.reconnectGraceMs,
        })
        for (const humano of salaDesconectada.humanos()) {
          if (humano.socketId && humano.conectado) emitirVista(humano.id, humano.socketId, salaDesconectada, 'room:state')
        }
      }
    })
  })

  return io
}

async function cambiarStockBooster(usuarioId: string, boosterId: number, delta: -1 | 1): Promise<number | null> {
  return prisma.$transaction(async (tx) => {
    await tx.progreso.upsert({ where: { usuarioId }, update: {}, create: { usuarioId } })
    const filas = await tx.$queryRaw<{ boosters: unknown }[]>`
      SELECT "boosters" FROM "Progreso" WHERE "usuarioId" = ${usuarioId} FOR UPDATE
    `
    const bruto = filas[0]?.boosters
    const original = bruto && typeof bruto === 'object' && !Array.isArray(bruto)
      ? bruto as Record<string, unknown>
      : {}
    const stock: Record<string, number> = {}
    for (const id of [1, 2, 3, 4]) {
      const cantidad = Number(original[String(id)] ?? 0)
      stock[String(id)] = Number.isFinite(cantidad) ? Math.max(0, Math.floor(cantidad)) : 0
    }
    const clave = String(boosterId)
    if (delta < 0 && stock[clave] === 0) return null
    stock[clave] = Math.max(0, (stock[clave] ?? 0) + delta)
    await tx.progreso.update({ where: { usuarioId }, data: { boosters: stock } })
    return stock[clave] ?? 0
  })
}

async function listarRanking(): Promise<
  { usuarioId: string; nombre: string; avatarUrl: string | null; puntos: number; victorias: number }[]
> {
  const grupos = await prisma.participacionOnline.groupBy({
    by: ['usuarioId'],
    where: { esBot: false, usuarioId: { not: null } },
    _count: { _all: true },
  })
  const victorias = await prisma.participacionOnline.groupBy({
    by: ['usuarioId'],
    where: { esBot: false, gano: true, usuarioId: { not: null } },
    _count: { _all: true },
  })
  const ids = grupos.flatMap((grupo) => (grupo.usuarioId ? [grupo.usuarioId] : []))
  if (ids.length === 0) return []
  const usuarios = await prisma.usuario.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true, avatarUrl: true, progreso: { select: { rankingPoints: true } } },
  })
  const porId = new Map(usuarios.map((usuario) => [usuario.id, usuario]))
  const victoriasPorId = new Map(
    victorias.flatMap((grupo) => (grupo.usuarioId ? [[grupo.usuarioId, grupo._count._all] as const] : [])),
  )
  return grupos
    .flatMap((grupo) => {
      if (!grupo.usuarioId) return []
      const usuario = porId.get(grupo.usuarioId)
      if (!usuario) return []
      const cantidad = victoriasPorId.get(usuario.id) ?? 0
      return [{
        usuarioId: usuario.id,
        nombre: usuario.nombre,
        avatarUrl: usuario.avatarUrl,
        victorias: cantidad,
        puntos: usuario.progreso?.rankingPoints ?? cantidad * PUNTOS_POR_VICTORIA,
      }]
    })
    .sort((a, b) => b.puntos - a.puntos || a.nombre.localeCompare(b.nombre, 'es'))
}
