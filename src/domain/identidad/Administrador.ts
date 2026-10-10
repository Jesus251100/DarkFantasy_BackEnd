import { Usuario } from './Usuario'

/** Admin: hereda Usuario y cambia el acceso al panel (Liskov). */
export class Administrador extends Usuario {
  constructor(correo: string) {
    super(correo, 'administrador')
  }

  override puedeVerPanel(): boolean {
    return true
  }

  puedeJugar(): boolean {
    return false
  }
}
