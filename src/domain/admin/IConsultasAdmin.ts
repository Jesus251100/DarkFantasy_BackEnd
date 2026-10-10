export interface ResumenUsuarioAdmin {
  id: string
  correo: string
  rol: string
  nombre: string
  creadoEn: Date
  coins: number
  diamonds: number
  wins: number
  highestUnlocked: number
  completed: number[]
  partidas: number
}

export interface ReportesAdmin {
  totalUsuarios: number
  totalPartidas: number
  victorias: number
  porNivel: { nivel: number; partidas: number }[]
}

export interface EventoActividad {
  id: string
  nivel: number
  gano: boolean
  creadoEn: Date
  nombre: string
  correo: string
}

export interface RegistroReciente {
  nombre: string
  correo: string
  creadoEn: Date
}

export interface TransaccionReciente {
  id: string
  tipo: string
  deltaMonedas: number
  deltaDiamantes: number
  detalle: string
  creadoEn: Date
  nombre: string
  correo: string
}

/** Consultas de administración. No mezcla escritura de campaña (I de SOLID). */
export interface IConsultasAdmin {
  listarUsuarios(): Promise<ResumenUsuarioAdmin[]>
  reportes(): Promise<ReportesAdmin>
  actividad(): Promise<{
    partidas: EventoActividad[]
    registros: RegistroReciente[]
    transacciones: TransaccionReciente[]
  }>
}
