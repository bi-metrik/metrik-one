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
