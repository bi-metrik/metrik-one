/**
 * El contrato de la suscripción a MeTRIK ONE (Clarity) que paga un espacio, de lo que devuelve
 * `mis_servicios()`. Puro.
 *
 * `/suscripcion` nació para los CDA (módulo `valida_consulta`), y su puerta es la de Valida
 * (`entradaValidaCda`). Un cliente de Clarity que paga su licencia por cuotas (Termotech, `A3 26 2`,
 * 2026-10-05) también tiene dónde ver su próxima cuota, su enlace de pago y lo que ya pagó: el
 * contrato de un servicio de catálogo de un módulo de esta lista, que el espacio PAGA.
 *
 * Solo los contratos que siguen cobrando (`activo`, `pausado`): el mismo criterio del enlace
 * automático (`ESTADOS_CONTRATO_CON_COBRO`). Un borrador todavía no cobra y uno cancelado o terminado
 * ya no. Con varios, el activo más reciente, el orden de la puerta de Valida.
 */

/** Módulos del catálogo cuya suscripción se ve en `/suscripcion` sin pasar por la puerta de Valida. */
export const MODULOS_SUSCRIPCION_ONE = ['business'] as const

const ESTADOS_QUE_COBRAN = new Set(['activo', 'pausado'])

/** Los campos de `mis_servicios()` que esta selección usa. */
export interface FilaMisServicios {
  servicio_contratado_id: string
  modulo: string
  estado: string
  es_pagador: boolean | null
  vigente_desde: string
}

export function contratoOnePagado(filas: readonly FilaMisServicios[]): FilaMisServicios | null {
  const candidatos = filas.filter(
    (f) =>
      f.es_pagador === true &&
      (MODULOS_SUSCRIPCION_ONE as readonly string[]).includes(f.modulo) &&
      ESTADOS_QUE_COBRAN.has(f.estado),
  )
  candidatos.sort(
    (a, b) => Number(b.estado === 'activo') - Number(a.estado === 'activo') || b.vigente_desde.localeCompare(a.vigente_desde),
  )
  return candidatos[0] ?? null
}
