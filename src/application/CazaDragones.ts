import { Carton } from '../domain/bingo/Carton'
import { Oraculo } from '../domain/bingo/Oraculo'
import { patronesDesdeModos } from '../domain/bingo/patrones/catalogoPatrones'
import type { BingoCell, WinMode } from '../domain/bingo/tipos'

const MODOS: WinMode[] = ['row', 'column', 'diagonal']
const INTERVALO_MS = 3000
const PATRONES = patronesDesdeModos(MODOS)

/** 10.000 diamantes sale el 2% de las veces. El resto queda entre 100 y 500. */
export const PREMIOS_CAZA = [
  { diamantes: 10000, peso: 2 },
  { diamantes: 500, peso: 8 },
  { diamantes: 350, peso: 15 },
  { diamantes: 250, peso: 25 },
  { diamantes: 180, peso: 25 },
  { diamantes: 100, peso: 25 },
] as const

export function sortearDiamantesCaza(): number {
  const total = PREMIOS_CAZA.reduce((suma, premio) => suma + premio.peso, 0)
  let tiro = Math.floor(Math.random() * total)
  for (const premio of PREMIOS_CAZA) {
    if (tiro < premio.peso) return premio.diamantes
    tiro -= premio.peso
  }
  return 100
}

export interface Cazador {
  usuarioId: string
  nombre: string
  socketId: string
  carton: Carton
  gano: boolean
  indicesGanadores: number[]
}

export interface VistaCaza {
  id: string
  calledList: number[]
  lastDrawn: number | null
  tuCarton: BingoCell[]
  indicesGanadores: number[]
  cazadores: { id: string; nombre: string; gano: boolean }[]
  dragonGano: boolean
  dragonMarcadas: number
}

interface Caceria {
  id: string
  cazadores: Cazador[]
  dragon: Carton
  dragonGano: boolean
  oraculo: Oraculo
  timer: ReturnType<typeof setInterval> | null
}

export interface OyenteCaza {
  onEspera(socketId: string, esperando: number): void
  onInicio(caceriaId: string, cazadores: Cazador[]): void
  onEstado(cazador: Cazador, vista: VistaCaza): void
  onBola(caceriaId: string, numero: number, cazadores: Cazador[]): void
  onRechazo(socketId: string, mensaje: string): void
  onVictoria(caceriaId: string, cazadores: Cazador[], diamantes: number): void
  onDerrota(caceriaId: string, cazadores: Cazador[], mensaje: string): void
}

/** Evento aparte del modo online: dos cazadores contra un dragón. */
export class CazaDragones {
  private cola: Cazador[] = []
  private cacerias = new Map<string, Caceria>()
  private caceriaDe = new Map<string, string>()

  constructor(private readonly oyente: OyenteCaza) {}

  entrar(usuarioId: string, nombre: string, socketId: string): void {
    this.salir(usuarioId)
    this.cola.push(this.crearCazador({ usuarioId, nombre, socketId }))
    this.avisarCola()
    if (this.cola.length >= 2) {
      const pareja = this.cola.splice(0, 2)
      this.abrir(pareja)
    }
  }

  /** Abre una caza con los dos jugadores de una sala con código. */
  iniciarCon(datos: { usuarioId: string; nombre: string; socketId: string }[]): void {
    if (datos.length < 2) return
    for (const dato of datos) this.salir(dato.usuarioId)
    this.abrir(datos.slice(0, 2).map((dato) => this.crearCazador(dato)))
  }

  salir(usuarioId: string): void {
    const antes = this.cola.length
    this.cola = this.cola.filter((cazador) => cazador.usuarioId !== usuarioId)
    if (this.cola.length !== antes) this.avisarCola()

    const id = this.caceriaDe.get(usuarioId)
    if (!id) return
    const caceria = this.cacerias.get(id)
    if (!caceria || caceria.dragonGano || caceria.cazadores.every((c) => c.gano)) return
    this.cerrar(caceria)
    const resto = caceria.cazadores.filter((c) => c.usuarioId !== usuarioId)
    this.oyente.onDerrota(caceria.id, resto, 'El otro cazador salió. La caza se cancela.')
  }

  reclamar(usuarioId: string): void {
    const caceria = this.caceriaDeUsuario(usuarioId)
    if (!caceria || caceria.dragonGano) return
    const cazador = caceria.cazadores.find((c) => c.usuarioId === usuarioId)
    if (!cazador || cazador.gano) return
    const resultado = cazador.carton.evaluarVictoriaPorBolas(PATRONES, caceria.oraculo.conjunto)
    if (!resultado.won) {
      this.oyente.onRechazo(cazador.socketId, 'Todavía no completas fila, columna o diagonal.')
      return
    }
    cazador.gano = true
    cazador.indicesGanadores = resultado.winningIndices
    this.publicar(caceria)
    if (caceria.cazadores.every((c) => c.gano)) {
      this.cerrar(caceria)
      this.oyente.onVictoria(caceria.id, caceria.cazadores, sortearDiamantesCaza())
    }
  }

  private abrir(pareja: Cazador[]): void {
    const caceria: Caceria = {
      id: `caza-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      cazadores: pareja,
      dragon: Carton.aleatorio(5, 75),
      dragonGano: false,
      oraculo: Oraculo.nuevo(75),
      timer: null,
    }
    this.cacerias.set(caceria.id, caceria)
    for (const cazador of pareja) this.caceriaDe.set(cazador.usuarioId, caceria.id)
    this.oyente.onInicio(caceria.id, pareja)
    this.publicar(caceria)
    caceria.timer = setInterval(() => this.cantar(caceria), INTERVALO_MS)
  }

  private cantar(caceria: Caceria): void {
    if (!this.cacerias.has(caceria.id)) return
    const numero = caceria.oraculo.cantar()
    if (numero === null) {
      this.cerrar(caceria)
      this.oyente.onDerrota(caceria.id, caceria.cazadores, 'Se acabaron las bolas. El dragón sigue en pie.')
      return
    }
    this.oyente.onBola(caceria.id, numero, caceria.cazadores)
    const dragon = caceria.dragon.evaluarVictoriaPorBolas(PATRONES, caceria.oraculo.conjunto)
    if (dragon.won) {
      caceria.dragonGano = true
      this.publicar(caceria)
      this.cerrar(caceria)
      this.oyente.onDerrota(caceria.id, caceria.cazadores, 'El dragón completó el cartón antes.')
      return
    }
    this.publicar(caceria)
  }

  private publicar(caceria: Caceria): void {
    for (const cazador of caceria.cazadores) {
      this.oyente.onEstado(cazador, {
        id: caceria.id,
        calledList: [...caceria.oraculo.lista],
        lastDrawn: caceria.oraculo.ultimaBola,
        tuCarton: cazador.carton.toSnapshot(),
        indicesGanadores: cazador.indicesGanadores,
        cazadores: caceria.cazadores.map((c) => ({
          id: c.usuarioId,
          nombre: c.nombre,
          gano: c.gano,
        })),
        dragonGano: caceria.dragonGano,
        dragonMarcadas: caceria.dragon
          .toSnapshot()
          .filter((celda) => !celda.free && caceria.oraculo.conjunto.has(celda.number)).length,
      })
    }
  }

  private cerrar(caceria: Caceria): void {
    if (caceria.timer) clearInterval(caceria.timer)
    caceria.timer = null
    this.cacerias.delete(caceria.id)
    for (const cazador of caceria.cazadores) this.caceriaDe.delete(cazador.usuarioId)
  }

  private caceriaDeUsuario(usuarioId: string): Caceria | undefined {
    const id = this.caceriaDe.get(usuarioId)
    return id ? this.cacerias.get(id) : undefined
  }

  private crearCazador(datos: { usuarioId: string; nombre: string; socketId: string }): Cazador {
    return {
      usuarioId: datos.usuarioId,
      nombre: datos.nombre,
      socketId: datos.socketId,
      carton: Carton.aleatorio(5, 75),
      gano: false,
      indicesGanadores: [],
    }
  }

  private avisarCola(): void {
    for (const cazador of this.cola) {
      this.oyente.onEspera(cazador.socketId, this.cola.length)
    }
  }
}
