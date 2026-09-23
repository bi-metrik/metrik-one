/**
 * La retención de IVA que el cliente le practica al cobrador sobre una cuota gravada. Puro.
 *
 * Es operación interna del espacio de MeTRIK como cobrador (acta de Carmen y Felipe, 2026-09-23,
 * sección A): METRIK IA S.A.S. es del SIMPLE y responsable de IVA, y un cliente responsable de IVA
 * que le compra un servicio gravado le retiene el 15% del IVA (ET 437-2 num. 9 y 437-1). No es una
 * función del producto y no se anuncia como tal.
 *
 * Tres datos, y si falta cualquiera no hay retención (el enlace sale por el total, como antes):
 *
 *   1. El espacio cobrador lo declara: `workspaces.config_extra.cobros.retencion_iva_pagador_pct`
 *      (15). Es la condición de SER del SIMPLE, que es del cobrador y no del cliente. Sin el dato,
 *      ningún espacio cambia de comportamiento.
 *   2. La cuota lleva IVA: `plan_cobro_cuotas.iva` > 0 (la parte del total que es IVA, la misma cifra
 *      de la factura). 0 = cuota no gravada o excluida.
 *   3. El cliente pagador es responsable de IVA según su RUT: `empresas.responsable_iva === true`.
 *      `null` (no se sabe) NO retiene: cobrar el total es lo que se hacía y el cliente puede retener
 *      igual; cobrar el neto a quien no retiene deja un faltante que nadie va a certificar.
 *
 * Ejemplo del acta: cuota de 2.380.000 con IVA 380.000 → retención 57.000 → enlace por 2.323.000.
 */

/** Lo que dice la configuración de cobros del espacio. 0 = el espacio no recibe retención de IVA. */
export function pctRetencionIvaDelEspacio(configExtra: unknown): number {
  const cobros = (configExtra as { cobros?: { retencion_iva_pagador_pct?: unknown } } | null)?.cobros
  const v = cobros?.retencion_iva_pagador_pct
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  // Un porcentaje fuera de (0, 100] es un dato mal cargado: se trata como «no hay retención» en vez
  // de inventar una cifra.
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 0
}

/** La retención de IVA de UNA cuota, en pesos enteros. 0 si falta cualquiera de los tres datos. */
export function retencionIvaDeCuota(p: {
  /** `plan_cobro_cuotas.iva`: el IVA incluido en el total de la cuota. */
  ivaCuota: number | null | undefined
  /** `empresas.responsable_iva` del pagador. Solo `true` retiene. */
  pagadorResponsableIva: boolean | null | undefined
  /** `pctRetencionIvaDelEspacio` del cobrador. */
  pct: number
}): number {
  const iva = Number(p.ivaCuota ?? 0)
  if (!(p.pct > 0) || p.pagadorResponsableIva !== true) return 0
  if (!Number.isFinite(iva) || iva <= 0) return 0
  return Math.round((iva * p.pct) / 100)
}
