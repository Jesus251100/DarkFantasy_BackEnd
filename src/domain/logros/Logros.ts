/**
 * Catálogo de logros de la campaña.
 * Cada logro se desbloquea al completar su nivel por primera vez
 * y otorga una recompensa extra (monedas + diamantes).
 */
export interface DefinicionLogro {
  nivel: number
  codigo: string
  nombre: string
  imagen: string
  monedas: number
  diamantes: number
}

/** Recompensa extra del logro, sumada a la del nivel. */
export const LOGROS: readonly DefinicionLogro[] = [
  { nivel: 1, codigo: 'nivel-1', nombre: 'Completa el nivel 1', imagen: 'level1 1.png', monedas: 500, diamantes: 10 },
  { nivel: 2, codigo: 'nivel-2', nombre: 'Completa el nivel 2', imagen: 'level2 1.png', monedas: 500, diamantes: 10 },
  { nivel: 3, codigo: 'nivel-3', nombre: 'Completa el nivel 3', imagen: 'level3 1.png', monedas: 700, diamantes: 15 },
  { nivel: 4, codigo: 'nivel-4', nombre: 'Completa el nivel 4', imagen: 'level4 1.png', monedas: 700, diamantes: 15 },
  { nivel: 5, codigo: 'nivel-5', nombre: 'Completa el nivel 5', imagen: 'level5.gif', monedas: 900, diamantes: 20 },
  { nivel: 6, codigo: 'nivel-6', nombre: 'Completa el nivel 6', imagen: 'level6.gif', monedas: 900, diamantes: 20 },
  { nivel: 7, codigo: 'nivel-7', nombre: 'Completa el nivel 7', imagen: 'level7.gif', monedas: 1100, diamantes: 25 },
  { nivel: 8, codigo: 'nivel-8', nombre: 'Completa el nivel 8', imagen: 'level8.gif', monedas: 1100, diamantes: 25 },
  { nivel: 9, codigo: 'nivel-9', nombre: 'Completa el nivel 9', imagen: 'level9.gif', monedas: 1300, diamantes: 30 },
  { nivel: 10, codigo: 'nivel-10', nombre: 'Completa el nivel 10', imagen: 'level10.gif', monedas: 1500, diamantes: 40 },
]

const POR_NIVEL = new Map(LOGROS.map((logro) => [logro.nivel, logro]))

export function logroDeNivel(nivel: number): DefinicionLogro | undefined {
  return POR_NIVEL.get(nivel)
}
