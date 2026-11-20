import type { Server as HttpServer } from 'node:http'
import jwt from 'jsonwebtoken'
import { Server } from 'socket.io'
import { AccessToken, TrackSource } from 'livekit-server-sdk'
import { GestionSalas, type MiembroCola, type OyenteSalas } from '../application/GestionSalas'
import type { SalaOnline } from '../domain/online/SalaOnline'
import { prisma } from '../infrastructure/prisma'
import { PrismaPartidasOnlineRepo } from '../infrastructure/PrismaPartidasOnlineRepo'
import { otorgarLogro } from '../infrastructure/otorgarLogro'
import type { JwtPayload } from './auth'
import { origenPermitido } from './seguridad'
import { RECARGA_BOOSTER_MS, rechazoDeObjetivo } from '../domain/online/efectosBooster'
import { CONFIG_ONLINE, mesaValida, type MesaElegida } from '../domain/online/ConfigOnline'
import { ESPERA_LOCALIZADOR, ID_LOCALIZADOR } from '../domain/online/RadarSala'

function leerMesa(payload: { modo?: unknown; cupo?: unknown } | undefined): MesaElegida | null {
  if (!payload || (payload.modo === undefined && payload.cupo === undefined)) {
    return { modo: 'mesa', cupo: 4 }
  }
  return mesaValida(payload.modo, payload.cupo)
}
const PUNTOS_POR_VICTORIA = 25
const CORREOS_CUENTAS_PRUEBA = new Set([
  'jugador@darkfantasy.local',
  'jugador@darkfantasy.com',
])

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
  const ultimoEventoUsuario = new Map<string, number>()
  const permitirAccion = (socketId: string, accion: string, intervaloMs: number): boolean => {
    const clave = `${socketId}:${accion}`
    const ahora = Date.now()
    const previo = ultimoEventoUsuario.get(clave) ?? 0
    if (ahora - previo < intervaloMs) return false
    ultimoEventoUsuario.set(clave, ahora)
    return true
  }
  const apuestasPendientes = new Map<string, { montos: Map<string, number>; timer: ReturnType<typeof setTimeout>; venceEn: number; cobrando: boolean }>()

  const emitirVista = (usuarioId: string, socketId: string, sala: SalaOnline, evento: string) => {
    io.to(socketId).emit(evento, sala.vistaPara(usuarioId))
  }
  const refrescarPerfil = (usuarioId: string) => {
    for (const socket of io.sockets.sockets.values()) {
      if (sesiones.get(socket.id)?.usuarioId === usuarioId) socket.emit('profile:refresh')
    }
  }

  const oyente: OyenteSalas = {
    onEmparejar(sala, humanos) {
      void (async () => {
        const pendiente = sala.estadoActual === 'waiting'
        if (pendiente && !apuestasPendientes.has(sala.id)) {
          const venceEn = Date.now() + 90_000
          const timer = setTimeout(() => {
            const actual = apuestasPendientes.get(sala.id)
            if (!actual) return
            apuestasPendientes.delete(sala.id)
            io.to(sala.id).emit('betting:cancelled', { mensaje: 'La elección de apuesta venció; vuelve a buscar partida.' })
            gestion.cancelarSalaPendienteApuesta(sala.id)
            io.in(sala.id).socketsLeave(sala.id)
          }, 90_000)
          apuestasPendientes.set(sala.id, { montos: new Map(), timer, venceEn, cobrando: false })
        }
        // El emparejamiento global primero crea una sala en espera para las apuestas.
        // El cooldown debe bajar al iniciar la partida, no durante esa pantalla previa.
        if (!pendiente) {
          for (const humano of humanos) {
            try {
              sala.anotarEspera(humano.usuarioId, await bajarEsperaLocalizador(humano.usuarioId))
            } catch (error) {
              const mensaje = error instanceof Error ? error.message : 'error desconocido'
              console.error(`No se pudo actualizar la espera del localizador: ${mensaje}`)
            }
          }
        }
        for (const humano of humanos) {
          const socket = io.sockets.sockets.get(humano.socketId)
          if (!socket) continue
          void socket.join(sala.id)
          socket.emit('match:found', { salaId: sala.id })
          if (pendiente) {
            const apuesta = apuestasPendientes.get(sala.id)
            socket.emit('betting:open', {
              salaId: sala.id,
              jugadores: sala.humanos().map((jugador) => ({ id: jugador.id, nombre: jugador.nombre, confirmado: apuesta?.montos.has(jugador.id) ?? false })),
              venceEn: apuesta?.venceEn,
            })
          }
          emitirVista(humano.usuarioId, humano.socketId, sala, 'room:state')
        }
        if (pendiente) {
          const apuesta = apuestasPendientes.get(sala.id)
          if (apuesta) io.to(sala.id).emit('betting:state', { jugadores: sala.humanos().map((j) => ({ id: j.id, nombre: j.nombre, confirmado: apuesta.montos.has(j.id) })) })
        }
      })()
    },
    onCantar(sala, numero) {
      io.to(sala.id).emit('ball:called', { salaId: sala.id, numero, evento: sala.serie?.evento ?? null })
    },
    onRadar(sala, contacto) {
      io.to(sala.id).emit('radar:evento', contacto)
    },
    onEstado(sala) {
      for (const humano of sala.humanos()) {
        if (humano.socketId && humano.conectado) emitirVista(humano.id, humano.socketId, sala, 'room:state')
      }
    },
    onTerminar(sala, ganadorId) {
      const ganador = sala.jugadores.find((j) => j.id === ganadorId) ?? null
      const ganadores = sala.jugadores.filter((jugador) => jugador.ganador && !jugador.esBot)
      const pozo = Object.values(sala.apuestas).reduce((total, monto) => total + monto, 0)
      const pozoPorGanador: Record<string, number> = {}
      if (ganadores.length) {
        const parte = Math.floor(pozo / ganadores.length)
        let sobrante = pozo - parte * ganadores.length
        for (const jugador of [...ganadores].sort((a, b) => a.id.localeCompare(b.id))) {
          pozoPorGanador[jugador.id] = parte + (sobrante-- > 0 ? 1 : 0)
        }
      }
      for (const humano of sala.humanos()) {
        if (humano.socketId) {
          emitirVista(humano.id, humano.socketId, sala, 'game:over')
        }
      }
      io.to(sala.id).emit('game:summary', {
        salaId: sala.id,
        ganadorId,
        ganadorNombre: sala.serie?.equipoGanador ? sala.nombreEquipo(sala.serie.equipoGanador) : ganador?.nombre ?? null,
        equipoGanador: sala.serie?.equipoGanador ?? null,
        pozo,
        pozoPorGanador,
        pozoPagado: ganadores.length > 0,
        diamantesPremio: ganadores.length,
        anfitrionAbandono: sala.cierrePorAnfitrion,
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
    onActividad(usuarioId, salaId, socketId, evento, nombre) {
      if (evento === 'aviso') io.to(socketId).emit('game:afk-warning', { segundos: 60 })
      if (evento === 'regreso') io.to(socketId).emit('game:afk-resumed')
      if (evento === 'expulsion') {
        io.to(salaId).emit('game:afk-player', { usuarioId, nombre })
        io.to(socketId).emit('game:afk-removed', { salaId, nombre })
        io.sockets.sockets.get(socketId)?.leave(salaId)
      }
    },
  }

  const gestion = new GestionSalas(oyente, repo)

  const usarLocalizador = async (
    socket: { emit: (evento: string, datos: unknown) => void; to: (salaId: string) => { emit: (evento: string, datos: unknown) => void } },
    usuarioId: string,
    sala: SalaOnline | null,
  ) => {
    if (!sala || sala.estadoActual !== 'playing') {
      socket.emit('booster:rechazo', { mensaje: 'No estás en una partida.' })
      return
    }
    if (sala.modo === 'pvp') {
      socket.emit('booster:rechazo', { mensaje: 'El localizador no está disponible en duelos.' })
      return
    }
    if (sala.radarActivo) {
      socket.emit('booster:rechazo', { mensaje: 'El escaneo de la sala está activo.' })
      return
    }
    const espera = sala.esperaDe(usuarioId)
    if (espera > 0) {
      const palabra = espera === 1 ? 'partida' : 'partidas'
      socket.emit('booster:rechazo', { mensaje: `Te faltan ${espera} ${palabra} para usar el localizador.` })
      return
    }
    const stockRestante = await cambiarStockBooster(usuarioId, ID_LOCALIZADOR, -1)
    if (stockRestante === null) {
      socket.emit('booster:rechazo', { mensaje: 'No tienes unidades de este booster en el inventario.' })
      return
    }
    try {
      await fijarEsperaLocalizador(usuarioId, ESPERA_LOCALIZADOR)
    } catch (error) {
      await cambiarStockBooster(usuarioId, ID_LOCALIZADOR, 1)
      const mensaje = error instanceof Error ? error.message : 'error desconocido'
      console.error(`No se pudo guardar la espera del localizador: ${mensaje}`)
      socket.emit('booster:rechazo', { mensaje: 'No se pudo usar el localizador.' })
      return
    }
    sala.anotarEspera(usuarioId, ESPERA_LOCALIZADOR)
    gestion.registrarActividad(usuarioId, sala.id)
    const contacto = sala.liderRadar()
    socket.emit('radar:resultado', {
      nombre: contacto?.nombre ?? 'Nadie',
      hechas: contacto?.hechas ?? 0,
      total: contacto?.total ?? 0,
      stockRestante,
      espera: ESPERA_LOCALIZADOR,
    })
    socket.to(sala.id).emit('radar:aviso', { mensaje: 'Alguien acaba de escanear.' })
    for (const humano of sala.humanos()) {
      if (humano.socketId && humano.conectado) emitirVista(humano.id, humano.socketId, sala, 'room:state')
    }
  }

  interface Espera {
    codigo: string
    anfitrionId: string
    miembros: MiembroCola[]
    completarConBots: boolean
    modo: MesaElegida['modo']
    cupo: MesaElegida['cupo']
    apuesta: number
    radar: boolean
  }

  const esperas = new Map<string, Espera>()
  const esperaDe = new Map<string, string>()
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
    }, CONFIG_ONLINE.reconnectGraceMs)
    temporizadoresSala.set(usuarioId, timer)
  }

  const codigoNuevo = (): string => {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    let codigo = ''
    for (let i = 0; i < 4; i += 1) {
      codigo += alfabeto[Math.floor(Math.random() * alfabeto.length)]
    }
    return esperas.has(codigo) ? codigoNuevo() : codigo
  }

  const vistaEspera = (espera: Espera) => ({
    codigo: espera.codigo,
    anfitrionId: espera.anfitrionId,
    completarConBots: espera.completarConBots,
    modo: espera.modo,
    cupo: espera.cupo,
    permiteBots: false,
    apuesta: espera.apuesta,
    escaneo: espera.radar,
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
      if (!permitirAccion(socket.id, 'chat:send', 800)) return
      const texto = String(payload?.texto ?? '').trim().slice(0, 80)
      if (!texto) return
      const mensaje = {
        id: `${Date.now()}-${socket.id}`,
        nombre: sesion.nombre,
        texto,
        creadoEn: new Date().toISOString(),
      }
      const codigo = esperaDe.get(sesion.usuarioId)
      const espera = codigo ? esperas.get(codigo) : undefined
      const sala = gestion.salaDe(sesion.usuarioId)
      const contexto = espera ? `sala:${espera.codigo}` : sala ? sala.chatCanal : 'lobby-online'
      void (async () => {
        try {
          const guardado = await prisma.chatOnlineMensaje.create({
            data: { canal: contexto, usuarioId: sesion.usuarioId, nombre: sesion.nombre, texto },
            select: { id: true, nombre: true, texto: true, creadoEn: true },
          })
          const persistido = { ...guardado, creadoEn: guardado.creadoEn.toISOString() }
          if (espera) for (const miembro of espera.miembros) io.to(miembro.socketId).emit('chat:message', persistido)
          else if (sala) io.to(sala.id).emit('chat:message', persistido)
          else io.to('lobby-online').emit('chat:message', persistido)
        } catch {
          socket.emit('chat:error', { mensaje: 'No se pudo guardar el mensaje.' })
        }
      })()
    })

    socket.on('chat:history', (payload: { contexto?: string }) => {
      const solicitado = String(payload?.contexto ?? '')
      const codigo = esperaDe.get(sesion.usuarioId)
      const espera = codigo ? esperas.get(codigo) : undefined
      const sala = gestion.salaDe(sesion.usuarioId)
      const permitido = solicitado === 'lobby-online'
        ? !espera && !sala
        : espera ? solicitado === `sala:${espera.codigo}`
          : sala ? solicitado === `partida:${sala.id}` || solicitado === sala.chatCanal
            : false
      if (!permitido) return
      const canal = sala && solicitado === `partida:${sala.id}` ? sala.chatCanal : solicitado
      void prisma.chatOnlineMensaje.findMany({
        where: { canal }, orderBy: { creadoEn: 'desc' }, take: 100,
        select: { id: true, nombre: true, texto: true, creadoEn: true },
      }).then((mensajes) => socket.emit('chat:history', {
        contexto: solicitado,
        mensajes: mensajes.reverse().map((mensaje) => ({ ...mensaje, creadoEn: mensaje.creadoEn.toISOString() })),
      })).catch(() => socket.emit('chat:error', { mensaje: 'No se pudo cargar el historial del chat.' }))
    })

    socket.on('room:create', (payload?: { modo?: unknown; cupo?: unknown; radar?: unknown; apuesta?: unknown }) => {
      if (!permitirAccion(socket.id, 'room:create', 1000)) return
      const montoApuesta = Number(payload?.apuesta ?? 200)
      if (!Number.isInteger(montoApuesta) || montoApuesta < 200 || montoApuesta > 2000) {
        socket.emit('room:error', { mensaje: 'La apuesta debe estar entre 200 y 2.000 monedas.' })
        return
      }
      const mesa = leerMesa(payload)
      if (!mesa) {
        socket.emit('room:error', { mensaje: 'Esa mesa no existe. Elige 4, 6, 8, PvP o equipos.' })
        return
      }
      gestion.salirCola(sesion.usuarioId)
      gestion.abandonar(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      const espera: Espera = {
        codigo: codigoNuevo(),
        anfitrionId: sesion.usuarioId,
        miembros: [miembroDe(socket.id, sesion)],
        completarConBots: false,
        modo: mesa.modo,
        cupo: mesa.cupo,
        apuesta: montoApuesta,
        radar: mesa.modo !== 'pvp' && payload?.radar === true,
      }
      esperas.set(espera.codigo, espera)
      esperaDe.set(sesion.usuarioId, espera.codigo)
      emitirEspera(espera)
    })

    socket.on('room:join', (payload: { codigo?: string }) => {
      if (!permitirAccion(socket.id, 'room:join', 500)) return
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
      if (espera.miembros.length >= espera.cupo) {
        socket.emit('room:error', { mensaje: 'La sala ya está llena.' })
        return
      }
      gestion.salirCola(sesion.usuarioId)
      gestion.abandonar(sesion.usuarioId)
      salirEspera(sesion.usuarioId)
      espera.miembros.push(miembroDe(socket.id, sesion))
      esperaDe.set(sesion.usuarioId, espera.codigo)
      emitirEspera(espera)
    })

    socket.on('room:leave', () => {
      salirEspera(sesion.usuarioId)
      socket.emit('room:closed')
    })

    socket.on('room:bots', (payload: { habilitado?: boolean }) => {
      if (!permitirAccion(socket.id, 'room:bots', 300)) return
      const codigo = esperaDe.get(sesion.usuarioId)
      const espera = codigo ? esperas.get(codigo) : undefined
      if (!espera || espera.anfitrionId !== sesion.usuarioId) {
        socket.emit('room:error', { mensaje: 'No puedes cambiar esta sala.' })
        return
      }
      if (payload?.habilitado === true) {
        socket.emit('room:error', { mensaje: 'Las salas privadas solo admiten jugadores reales.' })
        return
      }
      espera.completarConBots = false
      emitirEspera(espera)
    })

    socket.on('room:apuesta', (payload: { monto?: number }) => {
      if (!permitirAccion(socket.id, 'room:apuesta', 500)) return
      void (async () => {
        const codigo = esperaDe.get(sesion.usuarioId)
        const espera = codigo ? esperas.get(codigo) : undefined
        if (!espera) return
        const monto = Number(payload?.monto)
        if (!Number.isInteger(monto) || monto < 200 || monto > 2000) {
          socket.emit('room:error', { mensaje: 'La apuesta debe estar entre 200 y 2.000 monedas.' })
          return
        }
        if (monto === espera.apuesta) return
        if (espera.anfitrionId !== sesion.usuarioId) {
          socket.emit('room:error', { mensaje: 'Solo el anfitrión puede cambiar la apuesta.' })
          return
        }
        espera.apuesta = monto
        emitirEspera(espera)
      })()
    })

    socket.on('room:start', (payload?: { modo?: 'sala' | 'bots' }) => {
      if (!permitirAccion(socket.id, 'room:start', 1000)) return
      void (async () => {
      const codigo = esperaDe.get(sesion.usuarioId)
      const espera = codigo ? esperas.get(codigo) : undefined
      if (!espera || espera.anfitrionId !== sesion.usuarioId) {
        socket.emit('room:error', { mensaje: 'Solo quien creó la sala puede empezarla.' })
        return
      }
      if (payload?.modo === 'bots' || espera.completarConBots) {
        socket.emit('room:error', { mensaje: 'Las salas privadas solo admiten jugadores reales.' })
        return
      }
      const arranque = 'sala' as const
      if (espera.modo === 'pvp' && (espera.miembros.length !== 2 || espera.miembros.some((miembro) => !miembro.usuarioId || miembro.usuarioId.startsWith('bot:')))) {
        socket.emit('room:error', { mensaje: 'El duelo requiere dos jugadores reales.' })
        return
      }
      const minimoSala = espera.modo === 'pvp' || espera.modo === 'equipos' ? 2 : Math.ceil(espera.cupo / 2)
      if (arranque === 'sala' && espera.miembros.length < minimoSala) {
        socket.emit('room:error', { mensaje: `Se necesitan al menos ${minimoSala} jugadores para iniciar esta sala.` })
        return
      }
      if (!Number.isInteger(espera.apuesta) || espera.apuesta < 200 || espera.apuesta > 2000) {
        socket.emit('room:error', { mensaje: 'La apuesta debe estar entre 200 y 2.000 monedas.' })
        return
      }
      try {
        await repo.cobrarApuestas(espera.codigo, Object.fromEntries(espera.miembros.map((miembro) => [miembro.usuarioId, espera.apuesta])))
      } catch (error) {
        socket.emit('room:error', { mensaje: error instanceof Error ? error.message : 'No se pudieron cobrar las apuestas.' })
          return
      }
      for (const miembro of espera.miembros) refrescarPerfil(miembro.usuarioId)
      const mesa = { modo: espera.modo, cupo: espera.cupo }
      const apuesta = espera.apuesta
      const miembros = espera.miembros.map((miembro) => ({ ...miembro }))
      esperas.delete(espera.codigo)
      for (const miembro of miembros) {
        esperaDe.delete(miembro.usuarioId)
        cancelarTemporizadorSala(miembro.usuarioId)
      }
      gestion.iniciarSala(miembros, false, mesa, apuesta, espera.radar, `sala:${espera.codigo}`, espera.anfitrionId)
      for (const miembro of miembros) {
        if (!io.sockets.sockets.has(miembro.socketId)) gestion.desconectar(miembro.usuarioId, miembro.socketId)
      }
      })()
    })

    socket.on('game:leave', (ack?: () => void) => {
      void (async () => {
        const sala = gestion.salaDe(sesion.usuarioId)
        const pendiente = sala ? apuestasPendientes.get(sala.id) : undefined
        if (sala?.estadoActual === 'waiting' && pendiente && !pendiente.cobrando) {
          clearTimeout(pendiente.timer)
          apuestasPendientes.delete(sala.id)
          io.to(sala.id).emit('betting:cancelled', { mensaje: 'La partida se canceló porque un jugador salió antes de confirmar todas las apuestas.' })
          gestion.cancelarSalaPendienteApuesta(sala.id)
          io.in(sala.id).socketsLeave(sala.id)
          if (typeof ack === 'function') ack()
          return
        }
        const correspondePenalizacion = sala?.estadoActual === 'playing'
        const anfitrionAbandonaSala = !!sala?.personalizada && sala.anfitrionId === sesion.usuarioId
        try {
          if (sala && correspondePenalizacion) await repo.penalizarAbandono(sesion.usuarioId, sala.id)
        } catch (error) {
          const mensaje = error instanceof Error ? error.message : 'error desconocido'
          console.error(`No se pudo registrar la penalización por abandono: ${mensaje}`)
        } finally {
          if (sala && anfitrionAbandonaSala) gestion.cerrarPorAbandonoAnfitrion(sala.id, sesion.usuarioId)
          else gestion.abandonar(sesion.usuarioId)
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
      if (!permitirAccion(socket.id, 'booster:lanzar', 350)) return
      void (async () => {
      try {
      const sala = gestion.salaDe(sesion.usuarioId)
      if (!sala) {
        socket.emit('booster:rechazo', { mensaje: 'No estás en una partida.' })
        return
      }
      const boosterId = Number(payload?.boosterId)
      const objetivoId = String(payload?.objetivoId ?? '')
      if (boosterId === ID_LOCALIZADOR) {
        await usarLocalizador(socket, sesion.usuarioId, sala)
        return
      }
      const recarga = RECARGA_BOOSTER_MS[boosterId]
      const objetivo = sala.jugadores.some((jugador) => jugador.id === objetivoId)
      if (!recarga || !objetivo) {
        socket.emit('booster:rechazo', { mensaje: 'Booster u objetivo inválido.' })
        return
      }
      const rechazo = rechazoDeObjetivo(boosterId, sesion.usuarioId, objetivoId)
      if (rechazo) {
        socket.emit('booster:rechazo', { mensaje: rechazo })
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
      gestion.registrarActividad(sesion.usuarioId, sala.id)
      const perfilesConLogro = new Set<string>()
      const registrarLogroSeguro = async (usuarioId: string, logro: string) => {
        try {
          if (await prisma.$transaction((tx) => otorgarLogro(tx, usuarioId, logro))) perfilesConLogro.add(usuarioId)
        } catch (error) {
          console.error(`No se pudo guardar el logro ${logro}:`, error)
        }
      }
      await registrarLogroSeguro(sesion.usuarioId, 'primer-booster')
      if (resultado.aplicado && boosterId === 3) await registrarLogroSeguro(sesion.usuarioId, 'golpe-de-suerte')
      if (resultado.aplicado && boosterId === 1) await registrarLogroSeguro(sesion.usuarioId, 'manos-de-hielo')
      if (resultado.aplicado && boosterId === 2) await registrarLogroSeguro(sesion.usuarioId, 'saboteador')
      if (resultado.bloqueadoPorEscudo) await registrarLogroSeguro(objetivoId, 'escudo-perfecto')
      for (const usuarioId of perfilesConLogro) refrescarPerfil(usuarioId)
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

    socket.on('queue:join', (payload?: { modo?: unknown; cupo?: unknown }) => {
      if (!permitirAccion(socket.id, 'queue:join', 800)) return
      const mesa = leerMesa(payload)
      if (!mesa) {
        socket.emit('queue:warning', { mensaje: 'Esa mesa no existe. Elige 4, 6, 8, PvP o equipos.' })
        return
      }
      salirEspera(sesion.usuarioId)
      const miembro: MiembroCola = {
        usuarioId: sesion.usuarioId,
        nombre: sesion.nombre,
        avatarUrl: sesion.avatarUrl,
        socketId: socket.id,
      }
      socket.emit('queue:joined', { usuarioId: sesion.usuarioId, modo: mesa.modo, cupo: mesa.cupo })
      gestion.entrarCola(miembro.usuarioId, miembro.nombre, miembro.socketId, miembro.avatarUrl, mesa)
    })

    socket.on('queue:leave', () => {
      gestion.salirCola(sesion.usuarioId)
      socket.emit('queue:left', { usuarioId: sesion.usuarioId })
    })

    socket.on('betting:confirm', (payload: { salaId?: string; monto?: number }) => {
      if (!permitirAccion(socket.id, 'betting:confirm', 500)) return
      const salaId = String(payload?.salaId ?? '')
      const sala = gestion.salaDe(sesion.usuarioId)
      const pendiente = apuestasPendientes.get(salaId)
      const monto = Number(payload?.monto)
      if (!sala || sala.id !== salaId || sala.estadoActual !== 'waiting' || !pendiente || pendiente.cobrando) return
      if (!Number.isInteger(monto) || monto < 200 || monto > 2000) {
        socket.emit('betting:error', { mensaje: 'La apuesta debe estar entre 200 y 2.000 monedas.' })
        return
      }
      pendiente.montos.set(sesion.usuarioId, monto)
      const jugadores = sala.humanos().map((j) => ({ id: j.id, nombre: j.nombre, confirmado: pendiente.montos.has(j.id) }))
      io.to(sala.id).emit('betting:state', { salaId, jugadores })
      const humanos = sala.humanos()
      if (humanos.some((jugador) => !pendiente.montos.has(jugador.id))) return
      pendiente.cobrando = true
      const apuestas = Object.fromEntries(humanos.map((jugador) => [jugador.id, pendiente.montos.get(jugador.id)!]))
      void repo.cobrarApuestas(sala.id, apuestas).then(() => {
        const actual = apuestasPendientes.get(sala.id)
        if (!actual) return
        clearTimeout(actual.timer)
        apuestasPendientes.delete(sala.id)
        io.to(sala.id).emit('betting:closed', { salaId, apuestas })
        for (const humano of humanos) refrescarPerfil(humano.id)
        if (!gestion.iniciarSalaPendienteApuesta(sala.id, apuestas)) {
          io.to(sala.id).emit('betting:cancelled', { mensaje: 'No se pudo iniciar la partida. Vuelve al lobby.' })
        }
      }).catch((error: unknown) => {
        pendiente.cobrando = false
        pendiente.montos.clear()
        io.to(sala.id).emit('betting:error', { mensaje: error instanceof Error ? error.message : 'No se pudieron cobrar las apuestas.' })
        io.to(sala.id).emit('betting:state', { salaId, jugadores: humanos.map((j) => ({ id: j.id, nombre: j.nombre, confirmado: false })) })
      })
    })

    socket.on('pvp:marcar', (payload: { indice?: number; activa?: boolean }) => {
      if (!permitirAccion(socket.id, 'pvp:marcar', 220)) return
      const sala = gestion.salaDe(sesion.usuarioId)
      if (!sala) return
      const indice = Number(payload?.indice)
      if (!Number.isInteger(indice)) return
      const marcas = sala.fijarMarca(sesion.usuarioId, indice, payload?.activa === true)
      if (!marcas) return
      gestion.registrarActividad(sesion.usuarioId, sala.id)
      if (sala.modo === 'pvp') {
        io.to(sala.id).emit('pvp:marcas', { jugadorId: sesion.usuarioId, marcas })
      } else if (sala.modo === 'equipos') {
        const equipo = sala.jugadores.find((jugador) => jugador.id === sesion.usuarioId)?.equipo
        for (const compañero of sala.humanos().filter((jugador) => jugador.equipo === equipo && jugador.conectado && jugador.socketId)) {
          emitirVista(compañero.id, compañero.socketId!, sala, 'room:state')
        }
      } else {
        emitirVista(sesion.usuarioId, socket.id, sala, 'room:state')
      }
    })

    socket.on('team:bet:raise', (payload: { monto?: number }) => {
      if (!permitirAccion(socket.id, 'team:bet:raise', 500)) return
      const sala = gestion.salaDe(sesion.usuarioId)
      const monto = Number(payload?.monto)
      if (!sala || !sala.iniciarAumentoApuesta(sesion.usuarioId, monto)) {
        socket.emit('team:bet:error', { mensaje: 'No puedes aumentar la apuesta en este momento o ya la aumentaste esta ronda.' })
        return
      }
      void repo.cobrarAumentoApuesta(sala.id, sala.serie?.ronda ?? 0, { [sesion.usuarioId]: monto })
        .then(() => {
          sala.confirmarAumentoApuesta(sesion.usuarioId, monto)
          refrescarPerfil(sesion.usuarioId)
          for (const humano of sala.humanos()) {
            if (humano.conectado && humano.socketId) emitirVista(humano.id, humano.socketId, sala, 'room:state')
          }
        })
        .catch((error: unknown) => {
          sala.cancelarAumentoApuesta(sesion.usuarioId)
          socket.emit('team:bet:error', { mensaje: error instanceof Error ? error.message : 'No se pudo aumentar la apuesta.' })
        })
    })

    socket.on('game:claim', () => {
      if (!permitirAccion(socket.id, 'game:claim', 800)) return
      gestion.registrarActividad(sesion.usuarioId)
      gestion.reclamarBingo(sesion.usuarioId)
    })

    socket.on('voice:token', (payload: { salaId?: string }, responder?: (respuesta: { ok: boolean; url?: string; token?: string; error?: string }) => void) => {
      if (!permitirAccion(socket.id, 'voice:token', 1500)) {
        responder?.({ ok: false, error: 'Espera un momento antes de volver a conectar la voz.' })
        return
      }
      const salaId = String(payload?.salaId ?? '')
      const sala = gestion.salaDe(sesion.usuarioId)
      const jugador = sala?.jugadores.find((item) => item.id === sesion.usuarioId && !item.esBot)
      if (!sala || sala.id !== salaId || sala.estadoActual !== 'playing' || !jugador) {
        responder?.({ ok: false, error: 'Solo puedes conectar la voz desde una partida activa.' })
        return
      }

      let canalVoz = `darkfantasy-${sala.id}-todos`
      if (sala.modo === 'equipos') {
        if (!jugador.equipo) {
          responder?.({ ok: false, error: 'No se pudo verificar tu equipo para habilitar la voz.' })
          return
        }
        // Cada equipo recibe un nombre de sala independiente: un token nunca da
        // acceso al canal de voz del equipo contrario.
        canalVoz = `darkfantasy-${sala.id}-equipo-${jugador.equipo}`
      }

      const url = process.env.LIVEKIT_URL?.trim()
      const apiKey = process.env.LIVEKIT_API_KEY?.trim()
      const apiSecret = process.env.LIVEKIT_API_SECRET?.trim()
      if (!url || !apiKey || !apiSecret) {
        responder?.({ ok: false, error: 'El servicio de voz todavía no está configurado.' })
        return
      }

      void (async () => {
        try {
          const access = new AccessToken(apiKey, apiSecret, {
            identity: sesion.usuarioId,
            name: sesion.nombre,
            ttl: '10m',
          })
          access.addGrant({
            roomJoin: true,
            room: canalVoz,
            canPublishSources: [TrackSource.MICROPHONE],
            canSubscribe: true,
            canPublishData: false,
          })
          responder?.({ ok: true, url, token: await access.toJwt() })
        } catch (error) {
          console.error('No se pudo generar el acceso de voz:', error)
          responder?.({ ok: false, error: 'No se pudo iniciar la conexión de voz.' })
        }
      })()
    })

    socket.on('disconnect', () => {
      sesiones.delete(socket.id)
      for (const clave of ultimoEventoUsuario.keys()) if (clave.startsWith(`${socket.id}:`)) ultimoEventoUsuario.delete(clave)
      if (esperaDe.has(sesion.usuarioId)) programarRetiroSala(sesion.usuarioId, socket.id)
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

async function bajarEsperaLocalizador(usuarioId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.progreso.upsert({ where: { usuarioId }, update: {}, create: { usuarioId } })
    await tx.$queryRaw`SELECT "usuarioId" FROM "Progreso" WHERE "usuarioId" = ${usuarioId} FOR UPDATE`
    const fila = await tx.progreso.findUnique({ where: { usuarioId }, select: { localizadorEspera: true } })
    const actual = Math.max(0, fila?.localizadorEspera ?? 0)
    const siguiente = actual > 0 ? actual - 1 : 0
    if (siguiente !== actual) {
      await tx.progreso.update({ where: { usuarioId }, data: { localizadorEspera: siguiente } })
    }
    return siguiente
  })
}

async function fijarEsperaLocalizador(usuarioId: string, espera: number): Promise<void> {
  await prisma.progreso.update({
    where: { usuarioId },
    data: { localizadorEspera: Math.max(0, espera) },
  })
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
    for (const id of [1, 2, 3, 4, ID_LOCALIZADOR]) {
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
    select: { id: true, correo: true, nombre: true, avatarUrl: true, progreso: { select: { rankingPoints: true } } },
  })
  const porId = new Map(usuarios
    .filter((usuario) => !CORREOS_CUENTAS_PRUEBA.has(usuario.correo.trim().toLowerCase()))
    .map((usuario) => [usuario.id, usuario]))
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
