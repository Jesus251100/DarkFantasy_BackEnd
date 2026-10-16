import type { BingoCell, CardValue } from './tipos'

/** Una casilla del cartón. Encapsula número, free y marcado. */
export class Celda {
  private constructor(
    readonly numero: number,
    readonly libre: boolean,
    private marcada: boolean,
  ) {}

  static deValor(value: CardValue): Celda {
    if (value === 'free') return new Celda(0, true, true)
    return new Celda(value, false, false)
  }

  static desdeSnapshot(snap: BingoCell): Celda {
    return new Celda(snap.number, snap.free, snap.marked)
  }

  get estaMarcada(): boolean {
    return this.marcada
  }

  marcar(): void {
    if (!this.libre) this.marcada = true
  }

  desmarcar(): void {
    if (!this.libre) this.marcada = false
  }

  toggle(): void {
    if (this.libre) return
    this.marcada = !this.marcada
  }

  cubreBola(cantadas: ReadonlySet<number>): boolean {
    return this.libre || cantadas.has(this.numero)
  }

  toSnapshot(): BingoCell {
    return { number: this.numero, free: this.libre, marked: this.marcada }
  }

  clonar(): Celda {
    return new Celda(this.numero, this.libre, this.marcada)
  }
}
