/**
 * Tipos del tablero de operaciones (bono por indicadores).
 *
 * Regla que gobierna todo este modulo: **sin dato no es lo mismo que cumplido**.
 * Por eso los porcentajes y los scores son `number | null` y no `number`: `null`
 * significa "no hay con que calcularlo", y se pinta distinto de un 0. Un 0 es un
 * resultado; un null es una ausencia de medicion.
 */

export interface IndicadorRango {
  /** null = no hubo casos medibles en el periodo. */
  pct: number | null
  a_tiempo: number
  /** Casos con el dato de referencia disponible. */
  medibles: number
  /** Casos totales del periodo, incluidos los que no se pudieron medir. */
  eventos: number
}

export interface IndicadorCorrecciones {
  pct: number | null
  radicaciones: number
  correcciones: number
}

export interface PersonaOperaciones {
  staff_id: string
  nombre: string
  cargo: string | null
  /** false = el salario esta en 0, asi que el bono en pesos no significa nada. */
  salario_registrado: boolean
  malos: number
  /** false = nadie registro reprocesos en el mes: la calidad no se midio. */
  calidad_medida: boolean
  radicacion: IndicadorRango
  envio: IndicadorRango
  correcciones: IndicadorCorrecciones
  score_calidad: number | null
  score_radicacion: number | null
  score_envio: number | null
  score_correcciones: number | null
  puntaje: number
  /** true solo si los cuatro indicadores tuvieron con que calcularse. */
  completo: boolean
  /** Solo llega si quien mira puede ver este dinero. Ver `filtrarDinero`. */
  bono?: number | null
}

export interface SupervisorOperaciones {
  staff_id: string
  nombre: string
  cargo: string | null
  salario_registrado: boolean
  promedios: {
    calidad: number | null
    radicacion: number | null
    envio: number | null
    correcciones: number | null
  }
  aportes: {
    calidad: number | null
    radicacion: number | null
    envio: number | null
    correcciones: number | null
  }
  puntaje: number
  completo: boolean
  bono?: number | null
}

export interface ParametrosBono {
  bono_max_pct: number
  calidad_base: number
  calidad_tramo: number
  calidad_frac_un_malo: number
  calidad_malos_pierde_todo: number
  peso_radicacion: number
  peso_envio: number
  peso_correcciones: number
  piso_operativo: number
  techo_operativo: number
  horas_radicacion: number
  horas_desde_certificado: number
  horas_antes_cita: number
  bono_max_pct_director: number
  piso_director: number
  techo_director: number
}

export interface OperacionesBonoData {
  periodo: { anio: number; mes: number }
  parametros: ParametrosBono
  /** false = el mecanismo de reprocesos no registro nada en el mes. */
  calidad_medida: boolean
  reprocesos_mes: number
  personas: PersonaOperaciones[]
  supervisor: SupervisorOperaciones | null
}

export interface RadicacionDetalle {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  inicio: string | null
  fin: string
  horas: number | null
  a_tiempo: boolean | null
}

export interface ReprocesoDetalle {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  tipo: 'certificacion_upme' | 'devolucion_dian'
  causa: 'error_propio' | 'criterio_tercero'
  ciclo: number
  detalle: string | null
  abierto_at: string
}

export interface OperacionesDetalleData {
  staff_id: string
  nombre: string
  radicaciones: RadicacionDetalle[]
  reprocesos: ReprocesoDetalle[]
}
