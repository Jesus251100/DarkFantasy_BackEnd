export type RolUsuario = 'jugador' | 'administrador'

/** Usuario base. El admin hereda y suma el panel (Liskov). */
export class Usuario {
  constructor(
    readonly correo: string,
    readonly rol: RolUsuario = 'jugador',
  ) {}

  puedeJugar(): boolean {
    return true
  }

  puedeVerPanel(): boolean {
    return false
  }
}

