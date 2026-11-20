/**
 * Catálogo de logros de la campaña.
 * Cada logro se desbloquea al completar su nivel por primera vez
 * y otorga una recompensa extra (monedas + diamantes).
 */
export interface DefinicionLogro {
  nivel: number | null
  codigo: string
  nombre: string
  imagen: string
  monedas: number
  diamantes: number
  objetivo?: number
}

/** Recompensa extra del logro, sumada a la del nivel. */
export const LOGROS: readonly DefinicionLogro[] = [
  { nivel: 1, codigo: 'nivel-1', nombre: 'Completa el nivel 1', imagen: 'level1 1.png', monedas: 0, diamantes: 0 },
  { nivel: 2, codigo: 'nivel-2', nombre: 'Completa el nivel 2', imagen: 'level2 1.png', monedas: 0, diamantes: 0 },
  { nivel: 3, codigo: 'nivel-3', nombre: 'Completa el nivel 3', imagen: 'level3 1.png', monedas: 0, diamantes: 0 },
  { nivel: 4, codigo: 'nivel-4', nombre: 'Completa el nivel 4', imagen: 'level4 1.png', monedas: 0, diamantes: 0 },
  { nivel: 5, codigo: 'nivel-5', nombre: 'Completa el nivel 5', imagen: 'level5.gif', monedas: 0, diamantes: 0 },
  { nivel: 6, codigo: 'nivel-6', nombre: 'Completa el nivel 6', imagen: 'level6.gif', monedas: 0, diamantes: 2 },
  { nivel: 7, codigo: 'nivel-7', nombre: 'Completa el nivel 7', imagen: 'level7.gif', monedas: 0, diamantes: 3 },
  { nivel: 8, codigo: 'nivel-8', nombre: 'Completa el nivel 8', imagen: 'level8.gif', monedas: 0, diamantes: 4 },
  { nivel: 9, codigo: 'nivel-9', nombre: 'Completa el nivel 9', imagen: 'level9.gif', monedas: 0, diamantes: 5 },
  { nivel: 10, codigo: 'nivel-10', nombre: 'Completa el nivel 10', imagen: 'level10.gif', monedas: 0, diamantes: 8 },
  { nivel: null, codigo: 'primer-booster', nombre: 'Primer booster usado', imagen: 'freeze.png', monedas: 100, diamantes: 0 },
  { nivel: null, codigo: 'primera-victoria-online', nombre: 'Primera victoria online', imagen: 'dragon.png', monedas: 200, diamantes: 0 },
  { nivel: null, codigo: 'golpe-de-suerte', nombre: 'Golpe de suerte', imagen: 'goodluck 2.png', monedas: 100, diamantes: 0 },
  { nivel: null, codigo: 'manos-de-hielo', nombre: 'Manos de hielo', imagen: 'freeze.png', monedas: 150, diamantes: 0 },
  { nivel: null, codigo: 'saboteador', nombre: 'Saboteador', imagen: 'sabotage 2.png', monedas: 150, diamantes: 0 },
  { nivel: null, codigo: 'escudo-perfecto', nombre: 'Escudo perfecto', imagen: 'shield 1.png', monedas: 200, diamantes: 0 },
  { nivel: null, codigo: 'racha-online', nombre: 'Cinco victorias online', imagen: 'level10.gif', monedas: 300, diamantes: 0, objetivo: 5 },
]

const POR_NIVEL = new Map(LOGROS.map((logro) => [logro.nivel, logro]))

export function logroDeNivel(nivel: number): DefinicionLogro | undefined {
  return POR_NIVEL.get(nivel)
}
