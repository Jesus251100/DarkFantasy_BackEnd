import type { DatosCampania, IRepositorioCampania } from './IRepositorioCampania'

/** Adaptador en memoria: permite a Campania mutar y luego volcar a Prisma. */
export class RepoMemoriaCampania implements IRepositorioCampania {
  constructor(private datos: DatosCampania) {}

  cargar(): DatosCampania {
    return this.datos
  }

  guardar(datos: DatosCampania): void {
    this.datos = datos
  }
}
