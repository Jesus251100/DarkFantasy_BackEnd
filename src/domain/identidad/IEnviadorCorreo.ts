export interface IEnviadorCorreo {
  enviarCodigo(correo: string, codigo: string, motivo?: 'registro' | 'clave'): Promise<void>
  /** Si el SMTP es local (Mailpit). Vacío cuando el correo sale de verdad a Gmail. */
  bandejaLocal(): string | undefined
}
