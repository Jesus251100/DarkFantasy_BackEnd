import { Carton } from '../bingo/Carton'
import { Oraculo } from '../bingo/Oraculo'
import { shuffleInPlace } from '../bingo/geometria'
import { patronesDesdeModos } from '../bingo/patrones/catalogoPatrones'
import type { IPatronVictoria } from '../bingo/patrones/IPatronVictoria'
import type { BingoCell, WinMode, WinResult } from '../bingo/tipos'
import type { ConfigOnline, ModoMesa } from './ConfigOnline'
import {
  BOOSTERS_OFENSIVOS,
  EFECTOS_BOOSTER,
  rechazoDeObjetivo,
  type TipoEfectoBooster,
} from './efectosBooster'
import {
  BOLA_DEL_RADAR,
  elegirLider,
  medirAvance,
  sortearRadar,
  type ContactoRadar,
  type MedidaAvance,
} from './RadarSala'

export type EstadoSala = 'waiting' | 'playing' | 'finished'
const LIMITE_APUESTA_SERIE = 6000

export interface EfectoActivo {
  tipo: TipoEfectoBooster
  hasta: number
  lanzadoPorId: string
  lanzadoPorNombre: string
  casillasBloqueadas?: number[]
  numerosFalsos?: Record<string, number>
}

export interface EfectoBoosterVista {
  tipo: TipoEfectoBooster
  restanteMs: number
  lanzadoPorId: string
  lanzadoPorNombre: string
  casillasBloqueadas?: number[]
  numerosFalsos?: Record<string, number>
}

export interface ResultadoLanzamiento {
  ok: boolean
  error?: string
  tipo?: TipoEfectoBooster
  aplicado?: boolean
  bloqueadoPorEscudo?: boolean
  objetivoNombre?: string
  hasta?: number
  restanteMs?: number
  casillasBloqueadas?: number[]
  numerosFalsos?: Record<string, number>
}

export interface JugadorSala {
  id: string
  nombre: string
  avatarUrl: string | null
  socketId: string | null
  esBot: boolean
  conectado: boolean
  carton: Carton
  ganador: boolean
  equipo?: 1 | 2
  efectos: Partial<Record<TipoEfectoBooster, EfectoActivo>>
}

export interface JugadorVista {
  id: string
  nombre: string
  avatarUrl: string | null
  esBot: boolean
  conectado: boolean
  ganador: boolean
  equipo?: 1 | 2
  efectos: EfectoBoosterVista[]
}

export interface VistaSala {
  salaId: string
  estado: EstadoSala
  size: number
  fondoNivel: number
  winModes: WinMode[]
  metodosVictoria: WinMode[]
  maxNumber: number
  calledList: number[]
  lastDrawn: number | null
  modo: ModoMesa
  cupo: number
  jugadores: JugadorVista[]
  tuCarton: BingoCell[]
  /** En PvP, el cartón del otro humano, con las casillas que ya marcó. */
  cartonRival: { id: string; nombre: string; celdas: BingoCell[] } | null
  ganador: string | null
  apuesta: number
  /** En equipos, el marcador de la serie al mejor de 3. En los demás modos es null. */
  serie: {
    ronda: number
    equipo1: number
    equipo2: number
    aviso: string | null
    equipoGanador: 1 | 2 | null
    fase: 'jugando' | 'intermedio'
    venceIntermedio: number | null
    nombres: { equipo1: string; equipo2: string }
    ganadoresRonda: (1 | 2 | null)[]
    pozo: number
    apuestas: Record<string, number>
    combo: { equipo1: number; equipo2: number }
    evento: string | null
    aumentaron: string[]
  } | null
  /** El sorteo del radar dio que sí. El localizador no se puede usar en esta partida. */
  radarProgramado: boolean
  /** Partidas que le faltan a quien mira para volver a usar el localizador. */
  localizadorEspera: number
}

/** Una sala de bingo online: estado puro, sin socket ni temporizadores. */
export class SalaOnline {
  readonly jugadores: JugadorSala[] = []
  metodoVictoria: WinMode
  readonly fondoNivel: number
  private patrones: IPatronVictoria[]
  private oraculo: Oraculo
  private readonly metodosRonda: WinMode[] = []
  private estado: EstadoSala = 'waiting'
  private ganadorId: string | null = null
  private rondaActual = 1
  private readonly puntosEquipo = { 1: 0, 2: 0 }
  private readonly ganadoresRonda: (1 | 2 | null)[] = []
  private readonly comboEquipo = { 1: 0, 2: 0 }
  private bolasOleada = 0
  private eventoActual: string | null = null
  private eventoHasta: number | null = null
  private avisoRonda: string | null = null
  private equipoGanadorSerie: 1 | 2 | null = null
  private faseSerie: 'jugando' | 'intermedio' = 'jugando'
  private venceIntermedio: number | null = null
  private apuestaMonto = 0
  cierrePorAnfitrion = false
  apuestas: Record<string, number> = {}
  private readonly aumentosPendientes = new Set<string>()
  private readonly aumentosAplicados = new Set<string>()
  private radarProgramado = false
  private radarMostrado = false
  private readonly avanceRatio = new Map<string, number>()
  private readonly avanceBola = new Map<string, number>()
  private readonly esperaLocalizador = new Map<string, number>()
  private readonly creadaEn = Date.now()
  private iniciadaEn: number | null = null

  constructor(
    readonly id: string,
    readonly config: ConfigOnline,
    readonly modo: ModoMesa = 'mesa',
    readonly chatCanal = `partida:${id}`,
    readonly anfitrionId: string | null = null,
    readonly personalizada = false,
  ) {
    this.metodoVictoria =
      config.winModes[Math.floor(Math.random() * config.winModes.length)] ?? 'row'
    this.metodosRonda.push(this.metodoVictoria)
    this.fondoNivel = 1 + Math.floor(Math.random() * 9)
    this.patrones = patronesDesdeModos([this.metodoVictoria])
    this.oraculo = Oraculo.nuevo(config.maxNumber)
  }

  get estadoActual(): EstadoSala {
    return this.estado
  }

  get ganador(): string | null {
    return this.ganadorId
  }

  get modosJugados(): WinMode[] {
    return [...this.metodosRonda]
  }

  get cantidad(): number {
    return this.jugadores.length
  }

  get llena(): boolean {
    return this.jugadores.length >= this.config.maxPlayers
  }

  get humanosConectados(): number {
    return this.jugadores.filter((j) => !j.esBot && j.conectado).length
  }

  get duracionSeg(): number {
    if (this.iniciadaEn === null) return 0
    return Math.round((Date.now() - this.iniciadaEn) / 1000)
  }

  get apuesta(): number {
    return this.apuestaMonto
  }

  fijarApuesta(monto: number): void {
    this.apuestaMonto = monto > 0 ? monto : 0
  }

  /** La cola pública siempre lo permite. Una sala privada solo si el anfitrión lo dejó encendido. */
  programarRadar(permitido: boolean, azar = Math.random()): void {
    this.radarProgramado = sortearRadar(permitido, azar)
  }

  get radarActivo(): boolean {
    return this.radarProgramado
  }

  anotarEspera(usuarioId: string, partidas: number): void {
    this.esperaLocalizador.set(usuarioId, Math.max(0, partidas))
  }

  esperaDe(usuarioId: string): number {
    return this.esperaLocalizador.get(usuarioId) ?? 0
  }

  /**
   * Si el radar estaba pendiente y ya va la bola del escaneo, lo entrega una sola vez.
   * Devuelve null cuando todavía no toca, o cuando esta partida no lo tiene.
   */
  tomarRadar(): ContactoRadar | null {
    if (!this.radarProgramado || this.radarMostrado || this.estado !== 'playing') return null
    if (this.oraculo.lista.length < BOLA_DEL_RADAR) return null
    this.radarMostrado = true
    return this.liderRadar()
  }

  liderRadar(): ContactoRadar | null {
    const bolaActual = this.oraculo.lista.length
    const vistos = new Set<string>()
    const candidatos = this.jugadores.filter((jugador) => {
      if (this.modo !== 'equipos' || !jugador.equipo) return true
      const clave = `equipo:${jugador.equipo}`
      if (vistos.has(clave)) return false
      vistos.add(clave)
      return true
    }).map((jugador, asiento) => {
      const medida = this.medir(jugador)
      return {
        nombre: this.modo === 'equipos' && jugador.equipo ? this.nombreEquipo(jugador.equipo) : jugador.nombre,
        asiento,
        hechas: medida.hechas,
        total: medida.total,
        ratio: medida.ratio,
        bola: this.avanceBola.get(jugador.id) ?? bolaActual,
      }
    })
    return elegirLider(candidatos)
  }

  get serie(): VistaSala['serie'] {
    if (this.modo !== 'equipos') return null
    return {
      ronda: this.rondaActual,
      equipo1: this.puntosEquipo[1],
      equipo2: this.puntosEquipo[2],
      aviso: this.avisoRonda,
      equipoGanador: this.equipoGanadorSerie,
      fase: this.faseSerie,
      venceIntermedio: this.venceIntermedio,
      nombres: { equipo1: 'Luna Carmesí', equipo2: 'Legión Umbría' },
      ganadoresRonda: [...this.ganadoresRonda],
      pozo: Object.values(this.apuestas).reduce((total, monto) => total + monto, 0),
      apuestas: { ...this.apuestas },
      combo: { equipo1: this.comboEquipo[1], equipo2: this.comboEquipo[2] },
      evento: this.eventoActual,
      aumentaron: this.jugadores.filter((jugador) => this.aumentosAplicados.has(`${this.rondaActual}:${jugador.id}`)).map((jugador) => jugador.id),
    }
  }

  /**
   * Anota el punto de la ronda que acaba de cerrarse. No reparte cartones.
   * Devuelve true cuando la serie sigue y hay que abrir otra ronda.
   */
  anotarRonda(ganadorId: string | null): boolean {
    if (this.modo !== 'equipos' || this.estado !== 'playing') return false
    const ganador = ganadorId ? this.jugadores.find((jugador) => jugador.id === ganadorId) : undefined
    const equipo = ganador?.equipo
    if (equipo === 1 || equipo === 2) {
      this.puntosEquipo[equipo] += 1
      this.avisoRonda = `${ganador?.nombre ?? 'Un rival'} ganó la ronda ${this.rondaActual} para ${this.nombreEquipo(equipo)}`
    } else {
      this.avisoRonda = `La ronda ${this.rondaActual} quedó sin ganador`
    }
    this.ganadoresRonda.push(equipo === 1 || equipo === 2 ? equipo : null)
    const serieCerrada = this.rondaActual >= 3
    if (!serieCerrada) {
      this.faseSerie = 'intermedio'
      this.venceIntermedio = Date.now() + 15_000
      return true
    }
    this.faseSerie = 'intermedio'
    this.venceIntermedio = null
    if (this.puntosEquipo[1] !== this.puntosEquipo[2]) {
      this.equipoGanadorSerie = this.puntosEquipo[1] > this.puntosEquipo[2] ? 1 : 2
    }
    return false
  }

  /** Cartón nuevo y bolsa nueva. El marcador de la serie se conserva. */
  abrirSiguienteRonda(): void {
    if (this.modo !== 'equipos' || this.estado !== 'playing') return
    this.rondaActual += 1
    this.faseSerie = 'jugando'
    this.venceIntermedio = null
    this.avisoRonda = null
    this.ganadorId = null
    this.oraculo = Oraculo.nuevo(this.config.maxNumber)
    this.metodoVictoria = this.elegirMetodoVictoria()
    this.patrones = patronesDesdeModos([this.metodoVictoria])
    this.metodosRonda.push(this.metodoVictoria)
    this.aumentosAplicados.clear()
    this.aumentosPendientes.clear()
    this.comboEquipo[1] = 0
    this.comboEquipo[2] = 0
    this.bolasOleada = 0
    this.eventoActual = null
    this.eventoHasta = null
    this.radarMostrado = false
    const cartonesEquipo = {
      1: Carton.aleatorio(this.config.size, this.config.maxNumber),
      2: Carton.aleatorio(this.config.size, this.config.maxNumber),
    }
    for (const jugador of this.jugadores) {
      jugador.carton = jugador.equipo ? cartonesEquipo[jugador.equipo] : Carton.aleatorio(this.config.size, this.config.maxNumber)
      jugador.ganador = false
      jugador.efectos = {}
    }
    const equipoRemontada = this.puntosEquipo[1] < this.puntosEquipo[2] ? 1 : this.puntosEquipo[2] < this.puntosEquipo[1] ? 2 : null
    if (equipoRemontada) {
      const hasta = Date.now() + 12_000
      for (const jugador of this.jugadores.filter((miembro) => miembro.equipo === equipoRemontada)) {
        jugador.efectos.shield = {
          tipo: 'shield',
          hasta,
          lanzadoPorId: 'sistema',
          lanzadoPorNombre: 'Sello de Remontada',
        }
      }
      this.eventoActual = `${this.nombreEquipo(equipoRemontada)} recibe un Sello de Remontada`
      this.eventoHasta = hasta
    }
    this.avanceRatio.clear()
    this.avanceBola.clear()
    this.anotarAvance()
  }

  agregarJugador(id: string, nombre: string, esBot: boolean, socketId: string | null = null, avatarUrl: string | null = null): void {
    this.jugadores.push({
      id,
      nombre,
      avatarUrl: esBot ? null : avatarUrl,
      esBot,
      socketId,
      conectado: true,
      carton: Carton.aleatorio(this.config.size, this.config.maxNumber),
      ganador: false,
      efectos: {},
    })
  }

  iniciar(): void {
    this.oraculo = Oraculo.nuevo(this.config.maxNumber)
    this.estado = 'playing'
    this.iniciadaEn = Date.now()
    if (this.modo === 'equipos') {
      const cartonesEquipo = {
        1: Carton.aleatorio(this.config.size, this.config.maxNumber),
        2: Carton.aleatorio(this.config.size, this.config.maxNumber),
      }
      for (const jugador of this.jugadores) {
        if (jugador.equipo) jugador.carton = cartonesEquipo[jugador.equipo]
      }
    }
    this.avanceRatio.clear()
    this.avanceBola.clear()
    this.anotarAvance()
  }

  /**
   * En PvP guarda la marca visual del jugador. Solo se puede marcar un número ya cantado.
   * Devuelve las casillas marcadas, o null si la jugada no vale.
   */
  fijarMarca(usuarioId: string, indice: number, activa: boolean): number[] | null {
    if (this.estado !== 'playing' || this.faseSerie === 'intermedio') return null
    const jugador = this.jugadores.find((item) => item.id === usuarioId && !item.esBot)
    const celda = jugador?.carton.celdaEn(indice)
    if (!jugador || !celda || celda.libre) return null
    const efectoHielo = this.modo === 'equipos'
      ? this.jugadores.some((miembro) => miembro.equipo === jugador.equipo && miembro.efectos.freeze && miembro.efectos.freeze.hasta > Date.now())
      : !!jugador.efectos.freeze && jugador.efectos.freeze.hasta > Date.now()
    const efectoSabotaje = this.modo === 'equipos'
      ? this.jugadores.find((miembro) => miembro.equipo === jugador.equipo)?.efectos.sabotage
      : jugador.efectos.sabotage
    if (efectoHielo || (activa && efectoSabotaje?.casillasBloqueadas?.includes(indice))) return null
    const estabaMarcada = celda.estaMarcada
    if (celda.estaMarcada !== activa) {
      const aceptada = jugador.carton.toggleCelda(indice, this.oraculo.conjunto)
      if (!aceptada) return null
    }
    if (this.modo === 'equipos' && jugador.equipo) {
      this.comboEquipo[jugador.equipo] = activa && !estabaMarcada ? this.comboEquipo[jugador.equipo] + 1 : 0
    }
    return jugador.carton.toSnapshot().flatMap((item, i) => (item.marked && !item.free ? [i] : []))
  }

  /** Asigna los asientos de forma alternada y mantiene los equipos equilibrados. */
  sellarEquipos(): void {
    if (this.modo !== 'equipos') return
    const conteo = { 1: 0, 2: 0 }
    for (const jugador of this.jugadores) {
      const equipo: 1 | 2 = conteo[1] <= conteo[2] ? 1 : 2
      jugador.equipo = equipo
      conteo[equipo] += 1
    }
    const cartonesEquipo = {
      1: Carton.aleatorio(this.config.size, this.config.maxNumber),
      2: Carton.aleatorio(this.config.size, this.config.maxNumber),
    }
    for (const jugador of this.jugadores) {
      if (jugador.equipo) jugador.carton = cartonesEquipo[jugador.equipo]
    }
  }

  iniciarAumentoApuesta(usuarioId: string, monto: number): boolean {
    if (this.modo !== 'equipos' || this.estado !== 'playing' || this.faseSerie !== 'intermedio' || this.rondaActual >= 3) return false
    if (!Number.isInteger(monto) || monto < 200 || monto > 2000) return false
    const jugador = this.jugadores.find((item) => item.id === usuarioId && !item.esBot)
    const clave = `${this.rondaActual}:${usuarioId}`
    if (!jugador || (this.apuestas[usuarioId] ?? this.apuestaMonto) + monto > LIMITE_APUESTA_SERIE || this.aumentosAplicados.has(clave) || this.aumentosPendientes.has(clave)) return false
    this.aumentosPendientes.add(clave)
    return true
  }

  confirmarAumentoApuesta(usuarioId: string, monto: number): void {
    const clave = `${this.rondaActual}:${usuarioId}`
    this.aumentosPendientes.delete(clave)
    this.aumentosAplicados.add(clave)
    this.apuestas[usuarioId] = (this.apuestas[usuarioId] ?? 0) + monto
  }

  cancelarAumentoApuesta(usuarioId: string): void {
    this.aumentosPendientes.delete(`${this.rondaActual}:${usuarioId}`)
  }

  get tieneAumentosPendientes(): boolean {
    return this.aumentosPendientes.size > 0
  }

  get velocidadBolasMs(): number {
    if (this.modo === 'pvp') return Math.max(1800, this.config.drawIntervalMs - 1000)
    if (this.modo !== 'equipos') return this.config.drawIntervalMs
    if (this.bolasOleada > 0) return 900
    return Math.max(1500, this.config.drawIntervalMs - (this.rondaActual - 1) * 600)
  }

  cantar(): number | null {
    if (this.estado !== 'playing' || this.faseSerie === 'intermedio') return null
    if (!this.oraculo.quedanBolas()) return null
    if (this.eventoHasta !== null && this.eventoHasta <= Date.now()) {
      this.eventoActual = null
      this.eventoHasta = null
    }
    this.limpiarEfectos(Date.now())
    const preferidos = this.numerosEnCartonesConEfecto('luck')
    const evitados = this.numerosEnCartonesConEfecto('sabotage')
    const numero = preferidos.length || evitados.length
      ? this.oraculo.cantarConPreferencias(preferidos, evitados, 0.7)
      : this.oraculo.cantar()
    if (this.modo === 'equipos') {
      if (this.oraculo.lista.length === 5) {
        this.bolasOleada = 3
        this.eventoActual = 'Oleada del Oráculo: las próximas bolas caerán a mayor ritmo'
        this.eventoHasta = null
      } else if (this.bolasOleada > 0) {
        this.bolasOleada -= 1
        if (this.bolasOleada === 0) {
          this.eventoActual = null
          this.eventoHasta = null
        }
      }
    }
    this.anotarAvance()
    return numero
  }

  /** Validación autoritativa: ¿completó algún patrón con las bolas cantadas? */
  reclamar(jugadorId: string): WinResult | null {
    if (this.estado !== 'playing' || this.faseSerie === 'intermedio') return null
    const jugador = this.jugadores.find((j) => j.id === jugadorId)
    if (!jugador) return null
    if (this.estaCongelado(jugador)) return null
    return this.victoriaPermitida(jugador)
  }

  botCompleta(jugadorId: string): boolean {
    if (this.faseSerie === 'intermedio') return false
    const jugador = this.jugadores.find((j) => j.id === jugadorId)
    if (!jugador) return false
    if (this.estaCongelado(jugador)) return false
    return this.victoriaPermitida(jugador).won
  }

  /** Valida el lanzamiento y aplica el efecto (el escudo es autoritativo aquí). */
  lanzarBooster(lanzadorId: string, objetivoId: string, boosterId: number): ResultadoLanzamiento {
    if (this.estado !== 'playing' || this.faseSerie === 'intermedio') {
      return { ok: false, error: 'La partida no está en curso.' }
    }
    const lanzador = this.jugadores.find((j) => j.id === lanzadorId)
    if (!lanzador) {
      return { ok: false, error: 'No estás en esta sala.' }
    }
    const objetivo = this.jugadores.find((j) => j.id === objetivoId)
    if (!objetivo) {
      return { ok: false, error: 'El objetivo no pertenece a esta sala.' }
    }
    const definicion = EFECTOS_BOOSTER[boosterId]
    if (!definicion) {
      return { ok: false, error: 'Booster desconocido.' }
    }
    const rechazo = rechazoDeObjetivo(boosterId, lanzador.id, objetivo.id)
    if (rechazo) {
      return { ok: false, error: rechazo }
    }
    if (this.modo === 'equipos' && BOOSTERS_OFENSIVOS.has(boosterId) && lanzador.equipo === objetivo.equipo) {
      return { ok: false, error: 'Los ataques solo pueden afectar al equipo contrario.' }
    }

    const ahora = Date.now()
    this.limpiarEfectos(ahora)

    const afectados = this.modo === 'equipos' && objetivo.equipo
      ? this.jugadores.filter((jugador) => jugador.equipo === objetivo.equipo)
      : [objetivo]
    const tieneEscudo = afectados.some((jugador) => !!jugador.efectos.shield && jugador.efectos.shield.hasta > ahora)
    const bloqueadoPorEscudo = BOOSTERS_OFENSIVOS.has(boosterId) && tieneEscudo

    let casillasBloqueadas: number[] | undefined
    let numerosFalsos: Record<string, number> | undefined
    if (!bloqueadoPorEscudo) {
      if (definicion.tipo === 'sabotage') {
        const indices = objetivo.carton.toSnapshot().flatMap((celda, indice) => celda.free ? [] : [indice])
        casillasBloqueadas = shuffleInPlace([...indices]).slice(0, Math.min(3, indices.length))
        numerosFalsos = {}
        const libres = indices.filter((indice) => !casillasBloqueadas?.includes(indice))
        for (const indice of shuffleInPlace(libres).slice(0, 3)) {
          numerosFalsos[String(indice)] = 1 + Math.floor(Math.random() * this.config.maxNumber)
        }
      }
      for (const miembro of afectados) {
        miembro.efectos[definicion.tipo] = {
          tipo: definicion.tipo,
          hasta: ahora + definicion.duracionMs,
          lanzadoPorId: lanzador.id,
          lanzadoPorNombre: lanzador.nombre,
          ...(casillasBloqueadas ? { casillasBloqueadas } : {}),
          ...(numerosFalsos ? { numerosFalsos } : {}),
        }
      }
    }

    return {
      ok: true,
      tipo: definicion.tipo,
      aplicado: !bloqueadoPorEscudo,
      bloqueadoPorEscudo,
      objetivoNombre: objetivo.nombre,
      hasta: bloqueadoPorEscudo ? 0 : ahora + definicion.duracionMs,
      restanteMs: bloqueadoPorEscudo ? 0 : definicion.duracionMs,
      ...(casillasBloqueadas ? { casillasBloqueadas } : {}),
      ...(numerosFalsos ? { numerosFalsos } : {}),
    }
  }

  private limpiarEfectos(ahora: number): void {
    for (const jugador of this.jugadores) {
      for (const [tipo, efecto] of Object.entries(jugador.efectos)) {
        if (!efecto || efecto.hasta <= ahora) {
          delete jugador.efectos[tipo as TipoEfectoBooster]
        }
      }
    }
  }

  private numerosEnCartonesConEfecto(tipo: TipoEfectoBooster): number[] {
    const numeros: number[] = []
    const cantadas = this.oraculo.conjunto
    for (const jugador of this.jugadores) {
      const efecto = jugador.efectos[tipo]
      if (!efecto || efecto.hasta <= Date.now()) continue
      for (const celda of jugador.carton.toSnapshot()) {
        if (!celda.free && !cantadas.has(celda.number)) numeros.push(celda.number)
      }
    }
    return numeros
  }

  private victoriaPermitida(jugador: JugadorSala): WinResult {
    const cantadas = this.oraculo.conjunto
    const compañero = this.modo === 'equipos'
      ? this.jugadores.find((miembro) => miembro.id !== jugador.id && miembro.equipo === jugador.equipo)
      : undefined
    const bloqueadas = new Set(jugador.efectos.sabotage?.casillasBloqueadas ?? compañero?.efectos.sabotage?.casillasBloqueadas ?? [])
    for (const patron of this.patrones) {
      for (const indices of patron.indices(jugador.carton.tamano)) {
        if (indices.some((indice) => bloqueadas.has(indice))) continue
        if (indices.every((indice) => jugador.carton.celdaEn(indice)?.cubreBola(cantadas) === true)) {
          return { won: true, winningIndices: indices, mode: patron.id }
        }
      }
    }
    return { won: false, winningIndices: [], reason: 'no-line' }
  }

  private estaCongelado(jugador: JugadorSala): boolean {
    const equipo = this.modo === 'equipos' ? jugador.equipo : undefined
    return this.jugadores.some((miembro) =>
      (miembro.id === jugador.id || (!!equipo && miembro.equipo === equipo))
      && !!miembro.efectos.freeze && miembro.efectos.freeze.hasta > Date.now(),
    )
  }

  nombreEquipo(equipo: 1 | 2): string {
    return equipo === 1 ? 'Luna Carmesí' : 'Legión Umbría'
  }

  private elegirMetodoVictoria(): WinMode {
    const opciones = this.config.winModes.filter((modo) => modo !== this.metodoVictoria)
    const disponibles = opciones.length ? opciones : this.config.winModes
    return disponibles[Math.floor(Math.random() * disponibles.length)] ?? 'row'
  }

  private efectosDe(jugador: JugadorSala, ahora: number): EfectoBoosterVista[] {
    return Object.values(jugador.efectos)
      .filter((efecto): efecto is EfectoActivo => !!efecto && efecto.hasta > ahora)
      .map((efecto) => ({
        tipo: efecto.tipo,
        restanteMs: Math.max(0, efecto.hasta - ahora),
        lanzadoPorId: efecto.lanzadoPorId,
        lanzadoPorNombre: efecto.lanzadoPorNombre,
        ...(efecto.casillasBloqueadas ? { casillasBloqueadas: [...efecto.casillasBloqueadas] } : {}),
        ...(efecto.numerosFalsos ? { numerosFalsos: { ...efecto.numerosFalsos } } : {}),
      }))
  }

  finalizar(ganadorId: string | null): void {
    this.estado = 'finished'
    this.ganadorId = ganadorId
    if (this.modo === 'equipos') {
      const equipo = this.equipoGanadorSerie
      for (const jugador of this.jugadores) jugador.ganador = equipo !== null && jugador.equipo === equipo
      return
    }
    for (const j of this.jugadores) j.ganador = j.id === ganadorId
  }

  marcarDesconectado(jugadorId: string): void {
    const jugador = this.jugadores.find((j) => j.id === jugadorId)
    if (jugador && !jugador.esBot) jugador.conectado = false
  }

  marcarConectado(jugadorId: string, socketId: string): void {
    const jugador = this.jugadores.find((j) => j.id === jugadorId)
    if (!jugador || jugador.esBot) return
    jugador.socketId = socketId
    jugador.conectado = true
  }

  expulsarJugador(jugadorId: string): boolean {
    const indice = this.jugadores.findIndex((jugador) => jugador.id === jugadorId && !jugador.esBot)
    if (indice < 0) return false
    this.jugadores.splice(indice, 1)
    return true
  }

  humanos(): JugadorSala[] {
    return this.jugadores.filter((j) => !j.esBot)
  }

  vistaPara(usuarioId: string): VistaSala {
    const yo = this.jugadores.find((j) => j.id === usuarioId)
    const ahora = Date.now()
    this.limpiarEfectos(ahora)
    return {
      salaId: this.id,
      estado: this.estado,
      size: this.config.size,
      fondoNivel: this.fondoNivel,
      winModes: [this.metodoVictoria],
      metodosVictoria: [...this.config.winModes],
      maxNumber: this.config.maxNumber,
      calledList: [...this.oraculo.lista],
      lastDrawn: this.oraculo.ultimaBola,
      modo: this.modo,
      cupo: this.config.maxPlayers,
      jugadores: this.jugadores.map((j) => ({
        id: j.id,
        nombre: j.nombre,
        avatarUrl: j.avatarUrl,
        esBot: j.esBot,
        conectado: j.conectado,
        ganador: j.ganador,
        ...(j.equipo ? { equipo: j.equipo } : {}),
        efectos: this.efectosDe(j, ahora),
      })),
      tuCarton: yo ? yo.carton.toSnapshot() : [],
      cartonRival: this.cartonDelRival(usuarioId),
      ganador: this.ganadorId,
      apuesta: this.apuestas[usuarioId] ?? this.apuestaMonto,
      serie: this.serie,
      radarProgramado: this.radarProgramado,
      localizadorEspera: this.esperaLocalizador.get(usuarioId) ?? 0,
    }
  }

  private medir(jugador: JugadorSala): MedidaAvance {
    const bloqueadas = new Set(jugador.efectos.sabotage?.casillasBloqueadas ?? [])
    const figuras = this.patrones.flatMap((patron) => patron.indices(jugador.carton.tamano))
    const celdas = jugador.carton.toSnapshot().map((celda) => ({
      numero: celda.number,
      libre: celda.free,
    }))
    return medirAvance(celdas, figuras, this.oraculo.conjunto, bloqueadas)
  }

  /** Guarda en qué bola cada jugador alcanzó su avance actual. */
  private anotarAvance(): void {
    const bola = this.oraculo.lista.length
    for (const jugador of this.jugadores) {
      const medida = this.medir(jugador)
      const previo = this.avanceRatio.get(jugador.id) ?? -1
      if (medida.ratio > previo) {
        this.avanceRatio.set(jugador.id, medida.ratio)
        this.avanceBola.set(jugador.id, bola)
      }
    }
  }

  private cartonDelRival(usuarioId: string): VistaSala['cartonRival'] {
    if (this.modo !== 'pvp') return null
    const rival = this.jugadores.find((jugador) => jugador.id !== usuarioId && !jugador.esBot)
    if (!rival) return null
    return { id: rival.id, nombre: rival.nombre, celdas: rival.carton.toSnapshot() }
  }

  get contexto(): string {
    return `sala ${this.id.slice(0, 8)} (${this.cantidad} jugadores)`
  }

  antiguedadMs(): number {
    return Date.now() - this.creadaEn
  }
}
