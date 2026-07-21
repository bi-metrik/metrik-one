// Tipos del tablero comercial de SOENA (negocios + responsable_id).
// Distinto de vendedores-types.ts (ese va sobre ventas_hechos / rentabilidad_comercial).

/** Fila de resumen por responsable. sin_responsable=true es el bucket "(sin responsable)". */
export interface ComercialResumenRow {
  responsable_id: string | null
  nombre: string
  position: string | null
  sin_responsable: boolean
  negocios_total: number
  negocios_abiertos: number
  en_venta: number
  en_ejecucion: number
  en_cobro: number
  cerrados: number
  valor_aprobado: number
  /** Honorario recaudado = ingreso real (excluye tarifa UPME / pasante). Headline. */
  honorario_recaudado: number
  /** Tarifa UPME recaudada (pasante) = plata de terceros. Linea secundaria, aparte. */
  tarifa_recaudada: number
}

export interface ComercialPerfilKpis {
  negocios_total: number
  negocios_abiertos: number
  valor_aprobado: number
  honorario_recaudado: number
  tarifa_recaudada: number
}

export interface ComercialPerfilStage {
  stage: string
  negocios: number
  valor_aprobado: number
}

export interface ComercialPerfilNegocio {
  id: string
  codigo: string | null
  nombre: string | null
  stage: string | null
  estado: string | null
  etapa_nombre: string | null
  etapa_numero: number | null
  valor_aprobado: number
  honorario_recaudado: number
  tarifa_recaudada: number
}

export interface ComercialPerfil {
  responsable_id: string | null
  nombre: string
  position: string | null
  sin_responsable: boolean
  kpis: ComercialPerfilKpis
  porStage: ComercialPerfilStage[]
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

export interface ComercialMesResponse {
  anio: number
  mes: number
  kpis: ComercialKpisMes
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
