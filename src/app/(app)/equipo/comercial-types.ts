// Tipos del tablero comercial de SOENA (negocios + responsable_id).
// Distinto de vendedores-types.ts (ese va sobre ventas_hechos / rentabilidad_comercial).

/** Fila de resumen por responsable. sin_responsable=true es el bucket "(sin responsable)". */
export interface ComercialResumenRow {
  responsable_id: string | null
  nombre: string
  position: string | null
  /**
   * Lidera el equipo (owner / admin / supervisor). Toma casos especiales, pero NO
   * compite en el ranking ni se mide con estos indicadores: comparar a quien reparte
   * el trabajo contra quien lo ejecuta no dice nada de ninguno de los dos. Sus casos
   * se muestran aparte para que la suma del equipo siga cuadrando.
   */
  es_lider: boolean
  sin_responsable: boolean
  negocios_total: number
  negocios_abiertos: number
  en_venta: number
  en_ejecucion: number
  en_cobro: number
  cerrados: number
  /** Ventas del negocio = negocios con >=1 pago de honorario recibido (venta = primer pago). */
  num_ventas: number
  /**
   * Valor aprobado SIN IVA (base). Lo comercial se mide por el ingreso real: el IVA
   * se recauda para la DIAN y no es ingreso. Sale de `v_negocio_valor`, fuente unica
   * del desglose. Para la cifra que el cliente paga, `valor_aprobado_con_iva`.
   */
  valor_aprobado: number
  /** Valor aprobado CON IVA: lo que el cliente paga. Es la cifra de cartera. */
  valor_aprobado_con_iva: number
  /** Honorario recaudado = ingreso real (excluye tarifa UPME / pasante). Headline. */
  honorario_recaudado: number
  /** Tarifa UPME recaudada (pasante) = plata de terceros. Linea secundaria, aparte. */
  tarifa_recaudada: number
}

export interface ComercialPerfilKpis {
  negocios_total: number
  negocios_abiertos: number
  num_ventas: number
  /** SIN IVA (base): el ingreso real. Ver `ComercialResumenRow.valor_aprobado`. */
  valor_aprobado: number
  /** CON IVA: lo que el cliente paga. */
  valor_aprobado_con_iva: number
  honorario_recaudado: number
  tarifa_recaudada: number
  /**
   * Pendiente de recaudo del honorario, CON IVA (valor con IVA - honorario recaudado).
   * Es cartera: se compara contra plata que entra, que tambien lleva IVA. Por eso NO
   * es `valor_aprobado - honorario_recaudado`: esas dos cifras estan en bases distintas.
   */
  pendiente_honorario: number
  /** Negocios abiertos con SLA de etapa vencido. */
  vencidos: number
}

export interface ComercialPerfilStage {
  stage: string
  negocios: number
  valor_aprobado: number
  pendiente_honorario: number
}

/** Embudo por etapa/estatus con monto pendiente de recaudo. */
export interface ComercialPerfilEtapa {
  etapa_numero: number | null
  etapa_nombre: string
  stage: string | null
  negocios: number
  valor_aprobado: number
  pendiente_honorario: number
}

export interface ComercialPerfilNegocio {
  id: string
  codigo: string | null
  nombre: string | null
  stage: string | null
  estado: string | null
  etapa_nombre: string | null
  etapa_numero: number | null
  es_venta: boolean
  fecha_venta: string | null
  /** Fecha de entrada a la etapa actual (ultimo avance). etapa_cambiada_at. */
  ultimo_avance: string | null
  /** SLA de la etapa actual en horas habiles (null si la etapa no define SLA). */
  sla_horas: number | null
  /** 'a_tiempo' | 'vencido' | 'sin_sla'. */
  sla_estado: 'a_tiempo' | 'vencido' | 'sin_sla'
  /** SIN IVA (base). */
  valor_aprobado: number
  /** CON IVA: lo que el cliente paga. */
  valor_aprobado_con_iva: number
  honorario_recaudado: number
  tarifa_recaudada: number
  pendiente_honorario: number
}

/** Punto de la serie mensual del vendedor (ventas + recaudo). */
export interface ComercialPerfilSerie {
  anio: number
  mes: number
  label: string
  num_ventas: number
  valor_aprobado: number
  honorario_recaudado: number
}

export interface ComercialPerfil {
  responsable_id: string | null
  nombre: string
  position: string | null
  sin_responsable: boolean
  /** Periodo del perfil: null = acumulado; con anio+mes = ese mes. */
  anio: number | null
  mes: number | null
  kpis: ComercialPerfilKpis
  porStage: ComercialPerfilStage[]
  porEtapa: ComercialPerfilEtapa[]
  serie: ComercialPerfilSerie[]
  negocios: ComercialPerfilNegocio[]
}

/** Etiqueta legible por stage. */
export const STAGE_LABEL: Record<string, string> = {
  venta: 'En venta',
  ejecucion: 'En ejecucion',
  cobro: 'En cobro',
  cerrado: 'Cerrado',
}

// ── Iteracion 2: paridad Sheet SOENA (tabla por vendedor del mes, KPIs, series) ──

/** Fila de la tabla por vendedor del mes. Espeja el Sheet "INDICADORES DE VENTA". */
export interface ComercialVendedorMes {
  responsable_id: string | null
  nombre: string
  sin_responsable: boolean
  /** Lidera el equipo: se lista aparte, fuera de la comparacion. Ver ComercialResumenRow. */
  es_lider: boolean
  num_ventas: number
  /** Honorario sin IVA (ingreso limpio). Headline. */
  valor_sin_iva: number
  /** Honorario con IVA. Columna secundaria de paridad. */
  valor_con_iva: number
  primer_pago: number
  segundo_pago: number
  casos_completos: number
  tasa_casos_completos: number | null
  participacion_pct: number | null
  meta_num_ventas: number | null
  meta_valor: number | null
}

/** Panel de KPIs mensuales. */
export interface ComercialKpisMes {
  num_ventas: number
  valor_sin_iva: number
  valor_con_iva: number
  primer_pago: number
  segundo_pago: number
  honorario_recaudado: number
  tarifa_recaudada: number
  casos_completos: number
  tasa_casos_completos: number | null
  ticket_promedio: number
  mejor_dia: string | null
  mejor_dia_ventas: number
  promedio_ventas_dia: number
  ingreso_promedio_dia: number
  ventas_proyectadas: number
  n_perdidos: number
  tasa_cancelacion: number | null
  tasa_recaudo: number | null
  meta_num_ventas: number | null
  meta_valor: number | null
  cumplimiento_num: number | null
  cumplimiento_valor: number | null
}

/** Ventas de un dia del mes (para el grafico de ventas diarias). */
export interface ComercialVentaDia {
  dia: string
  ventas: number
}

export interface ComercialMesResponse {
  anio: number
  mes: number
  kpis: ComercialKpisMes
  porDia: ComercialVentaDia[]
  porVendedor: ComercialVendedorMes[]
}

/** Punto de la serie historica mensual. */
export interface ComercialSeriePunto {
  anio: number
  mes: number
  label: string
  num_ventas: number
  valor_sin_iva: number
  valor_con_iva: number
  honorario_recaudado: number
  primer_pago: number
  segundo_pago: number
  tarifa_recaudada: number
}

export interface ComercialSerieResponse {
  serie: ComercialSeriePunto[]
  tasa_recaudo_global: number | null
}

/** Fila de meta para la mini UI de edicion (staff_id null = meta global). */
export interface MetaComercial {
  id: string
  staff_id: string | null
  anio: number
  mes: number
  meta_num_ventas: number | null
  meta_valor: number | null
}

export const MESES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const

/**
 * Un caso detras de una cifra del tablero comercial.
 *
 * Sale de `get_comercial_ventas_mes_soena`, que consume la MISMA vista
 * (`v_venta_mes_comercial`) que produce la cifra. Ese es el punto: la lista no puede
 * contradecir al numero en el que se hizo clic.
 */
export interface ComercialVentaCaso {
  negocio_id: string
  codigo: string | null
  nombre: string
  estado: string | null
  responsable: string | null
  /** Dia en que entro el primer pago: es la definicion de venta que aprobo el cliente. */
  fecha_venta: string
  /** Dia en que el honorario quedo cubierto. `null` mientras el caso no este completo. */
  fecha_completado: string | null
  fecha_creacion: string
  /** Ultimo formulario llenado por el contacto. `null` si nunca registro interaccion. */
  ultima_conversion: string | null
  n_conversiones: number
  /**
   * De donde vino, en tres piezas que NO se colapsan en una.
   *
   * `origen_declarado` es lo que alguien escribio al crear el negocio (catalogo de
   * `ORIGENES_NEGOCIO`); puede ser null. `tiene_rastro_meta` es lo unico
   * verificable: hubo una interaccion de Meta del contacto. `campana` sale del
   * formulario de Meta.
   *
   * Los tres estados que la pantalla debe distinguir:
   *   · rastro + campana        -> atribuido
   *   · rastro sin campana      -> vino de Meta y no se pudo atribuir
   *   · sin rastro              -> sin rastro de Meta (NO es "no vino de Meta")
   */
  origen_declarado: string | null
  tiene_rastro_meta: boolean
  campana: string | null
  /** Lo declarado y el rastro no coinciden. Se muestra, no se corrige: decide comision. */
  atribucion_en_conflicto: boolean
  valor_sin_iva: number
  valor_con_iva: number
  recaudado: number
  primer_pago: number
  segundo_pago: number
  caso_completo: boolean
  /**
   * El caso figura completo pero NO tiene honorario aprobado, asi que el sistema comparo
   * su recaudo contra cero. Se marca en la lista en vez de esconderlo: es la unica forma
   * de que quien mira la cifra entienda por que ese caso esta ahi.
   */
  sin_honorario_aprobado: boolean
}

// ── Origen del lead y campana (punto #23 del inventario SOENA) ──────────────

/** Una fila del desglose por origen declarado. */
export interface ComercialOrigenFila {
  /** `null` = el negocio se creo sin declarar origen. Va en raya, no en "otro". */
  origen: string | null
  ventas: number
  valor_sin_iva: number
  recaudado: number
  /** De esas ventas, cuantas tienen rastro verificable de Meta. */
  con_rastro_meta: number
}

/** Una fila del desglose por campana de Meta. */
export interface ComercialCampanaFila {
  /** `null` = vino de Meta y la interaccion no trae campana. Es su propio estado. */
  campana: string | null
  ventas: number
  valor_sin_iva: number
  recaudado: number
}

/**
 * Desglose de las ventas del mes por origen y campana.
 *
 * Los tres conteos de arriba no son excluyentes con `por_origen`: son la lectura
 * honesta de la cobertura. `sin_rastro` NO significa "no vino de Meta" — significa
 * que no dejo huella en el sistema, que es lo unico que se puede afirmar.
 */
export interface ComercialOrigenMes {
  total: number
  con_rastro_meta: number
  sin_rastro: number
  /** Vino de Meta y aun asi no se le pudo poner campana. */
  meta_sin_campana: number
  /** Lo declarado y el rastro no coinciden. Decide la comision: se muestra. */
  en_conflicto: number
  por_origen: ComercialOrigenFila[]
  por_campana: ComercialCampanaFila[]
}

/** Un negocio perdido del mes: lo que hay detras de la tasa de cancelacion. */
export interface ComercialPerdido {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  responsable: string | null
  fecha: string
  razon: string | null
  detalle: string | null
  etapa: string | null
  origen_declarado: string | null
  tiene_rastro_meta: boolean
  campana: string | null
}
