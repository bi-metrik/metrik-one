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
  /**
   * Solo radicacion: casos que quedaron sin medir porque su unica asignacion tiene
   * `rol` NULL y el motor no la ve (deuda #57). No es lo mismo que "nunca se asigno",
   * y por eso se cuenta aparte en vez de sumarse a los cumplidos o a los incumplidos.
   */
  sin_rol?: number
}

export interface IndicadorCorrecciones {
  /** null = no se pudo calcular: sin radicaciones, o sin evidencia que lo respalde. */
  pct: number | null
  radicaciones: number
  correcciones: number
  /**
   * false = nadie registro la evidencia que este indicador necesita, asi que
   * "cero correcciones" no significa trabajo impecable. Es la misma distincion
   * que `calidad_medida`, y aqui hacia falta: el denominador (radicaciones) se
   * mide solo, el numerador (devoluciones) sale de `reproceso_eventos`.
   */
  medida: boolean
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
  /**
   * true solo si todo indicador que debia medirse tuvo con que calcularse. Un
   * indicador SUSPENDIDO (peso 0) no cuenta como faltante: no es que falte su
   * dato, es que la politica decidio no juzgarlo.
   */
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
  /** Que evidencia exige el indicador de correcciones para calcularse. */
  correcciones_cobertura: 'devolucion_dian' | 'cualquier_reproceso'
  piso_operativo: number
  techo_operativo: number
  horas_radicacion: number
  /**
   * Con que reloj corren las `horas_radicacion`. `habil` (acordado con la
   * supervisora) descuenta fines de semana y festivos; `corrido` cuenta calendario.
   * ⚠️ Solo aplica a radicacion: `horas_antes_cita` es CORRIDA a proposito, porque
   * mide contra el calendario de la DIAN y no contra el de la oficina.
   */
  radicacion_reloj?: 'habil' | 'corrido'
  /** Hora de Bogota en que arranca la jornada habil. Supuesto sin acordar: 0. */
  jornada_inicio_hora?: number
  /** Hora de Bogota en que termina. Supuesto sin acordar: 24 (dia completo). */
  jornada_fin_hora?: number
  /** Supuesto sin acordar: false. */
  jornada_sabado_habil?: boolean
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
  /** false = sin la evidencia que pide `correcciones_cobertura`; el indicador no se calcula. */
  correcciones_medida: boolean
  devoluciones_mes: number
  /**
   * Asignaciones del workspace con `rol` sin declarar (deuda #57). No es del mes: es el
   * pasivo completo. Son invisibles para el motor, asi que un caso asignado solo asi se
   * queda sin reloj de radicacion. Se expone para que la pantalla lo nombre.
   */
  responsables_sin_rol?: number
  /**
   * Hasta que anio llega el calendario de `festivos_colombia`. Un anio sin sembrar
   * cuenta sus festivos como habiles, en contra del operativo y sin avisar; la
   * pantalla lo advierte cuando el periodo consultado se pasa de ese anio.
   */
  festivos_hasta_anio?: number | null
  /**
   * Techo real del mes: la suma de los pesos vigentes. Suspender un indicador NO
   * reparte su peso entre los demas, asi que el maximo alcanzable baja y con el
   * baja el bono maximo. Sin este dato la pantalla mostraria "58%" sin decir
   * sobre cuanto, que es justo la clase de media verdad que este tablero evita.
   */
  puntaje_maximo?: number
  personas: PersonaOperaciones[]
  supervisor: SupervisorOperaciones | null
}

export interface RadicacionDetalle {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  /** Momento de la asignacion a operaciones. `null` = el caso no se pudo medir. */
  inicio: string | null
  fin: string
  /** Horas del reloj con el que se juzga (habiles por defecto). */
  horas: number | null
  /**
   * Horas de calendario, sin descontar nada. Viaja al lado de `horas` para que la
   * conversacion no se atasque en "a mi me dio otra cosa": la resta cruda es lo que
   * cualquiera calcula al mirar las dos fechas.
   */
  horas_corridas?: number | null
  a_tiempo: boolean | null
  /**
   * Con `inicio` en null, distingue las dos ausencias: `true` = si hubo asignacion
   * pero con el rol sin declarar (deuda #57); `false` = nadie lo asigno.
   */
  sin_rol?: boolean
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
