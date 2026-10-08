/**
 * Las dos cifras de segundo pago de los tableros de SOENA (SOE-002).
 *
 * Hasta el 2026-10-08 Dirección y Comercial decían "segundo pago" y medían cosas
 * distintas: Dirección sumaba lo que ENTRÓ en el mes (de ventas de cualquier mes) y
 * Comercial lo que ya pagaron las ventas DEL mes (cuando sea que lo hayan pagado). En
 * septiembre una decía $2.053.118 y la otra $29. Las dos preguntas son legítimas; lo
 * que no se puede es ponerles el mismo nombre. Desde aquí cada una tiene el suyo, y los
 * dos tableros las leen de la misma RPC (`get_segundo_pago_mes_soena`).
 *
 * El umbral de migajas lo decide la base y viaja en la respuesta (`umbral_migaja`): la
 * pantalla lo cita, no lo copia.
 */

/** Un negocio detrás de una de las dos cifras. Valores en base, sin IVA. */
export interface SegundoPagoCaso {
  negocio_id: string
  codigo: string | null
  nombre: string | null
  /** 'YYYY-MM-DD'. */
  fecha_venta: string | null
  /** 'YYYY-MM-DD'. El último abono a tramo 2 que contó. */
  fecha_pago: string | null
  valor: number
  responsable_id: string | null
  responsable: string | null
  /** En la cifra de caja: si la venta es de este mismo mes. En la de cohorte, siempre true. */
  de_venta_del_mes: boolean
}

export interface SegundoPagoMes {
  anio: number
  mes: number
  /** Abono a tramo 2 (sin IVA) por debajo del cual no es segundo pago: es sobrante de redondeo. */
  umbral_migaja: number
  /** "2º pago recibido este mes": por fecha de pago, de cualquier venta. */
  recibido: {
    total: number
    negocios: number
    de_ventas_del_mes: number
    de_ventas_anteriores: number
    detalle: SegundoPagoCaso[]
  }
  /** "2º pago de las ventas de este mes": por mes de venta, pagado cuando sea. */
  de_ventas_del_mes: {
    total: number
    negocios: number
    detalle: SegundoPagoCaso[]
  }
  /** Los mismos dos totales del mes anterior, para la comparación del panel. */
  anterior: { recibido: number; de_ventas_del_mes: number }
}

/** Cuál de las dos cifras se abrió. */
export type CifraSegundoPago = 'recibido' | 'de_ventas_del_mes'

export const TITULO_SEGUNDO_PAGO: Record<CifraSegundoPago, string> = {
  recibido: '2º pago recibido este mes',
  de_ventas_del_mes: '2º pago de las ventas de este mes',
}

/** De dónde sale cada cifra, en una línea. Va debajo de la cifra en los dos tableros. */
export function notaSegundoPago(cifra: CifraSegundoPago, umbral: number): string {
  const comun = `sin IVA · solo ventas 50/50 · no cuenta lo menor a ${fmtPesos(umbral)}`
  return cifra === 'recibido'
    ? `Por fecha de pago, de ventas de cualquier mes · ${comun}`
    : `Por mes de venta, pagado cuando sea · ${comun}`
}

function fmtPesos(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CO')}`
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function caso(c: Record<string, unknown>, deVentaDelMes?: boolean): SegundoPagoCaso {
  return {
    negocio_id: String(c.negocio_id),
    codigo: (c.codigo as string | null) ?? null,
    nombre: (c.nombre as string | null) ?? null,
    fecha_venta: (c.fecha_venta as string | null) ?? null,
    fecha_pago: (c.fecha_pago as string | null) ?? null,
    valor: num(c.valor),
    responsable_id: (c.responsable_id as string | null) ?? null,
    responsable: (c.responsable as string | null) ?? null,
    de_venta_del_mes: deVentaDelMes ?? c.de_venta_del_mes === true,
  }
}

/**
 * La respuesta cruda de la RPC, con los `numeric` ya como número. PostgREST devuelve
 * `numeric` dentro de un jsonb como número, pero una cadena no debe volverse NaN en
 * pantalla. `null` cuando la RPC no devolvió nada (guarda de workspace, error).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarSegundoPago(data: any): SegundoPagoMes | null {
  if (!data || typeof data !== 'object' || !data.recibido || !data.de_ventas_del_mes) return null
  const r = data.recibido
  const v = data.de_ventas_del_mes
  return {
    anio: num(data.anio),
    mes: num(data.mes),
    umbral_migaja: num(data.umbral_migaja),
    recibido: {
      total: num(r.total),
      negocios: num(r.negocios),
      de_ventas_del_mes: num(r.de_ventas_del_mes),
      de_ventas_anteriores: num(r.de_ventas_anteriores),
      detalle: (Array.isArray(r.detalle) ? r.detalle : []).map((c: Record<string, unknown>) => caso(c)),
    },
    de_ventas_del_mes: {
      total: num(v.total),
      negocios: num(v.negocios),
      detalle: (Array.isArray(v.detalle) ? v.detalle : []).map((c: Record<string, unknown>) => caso(c, true)),
    },
    anterior: {
      recibido: num(data.anterior?.recibido),
      de_ventas_del_mes: num(data.anterior?.de_ventas_del_mes),
    },
  }
}

/**
 * El segundo pago (por mes de venta) de un conjunto de negocios: una fila por vendedor,
 * por seccional o por plan de pago. Se suma de la MISMA lista que da la cifra del panel,
 * así que la fila y el total no pueden discrepar, y una venta cuyo tramo 2 es solo
 * sobrante vale cero aquí también.
 */
export function segundoPagoDeVentas(
  datos: SegundoPagoMes,
  incluye: (c: SegundoPagoCaso) => boolean,
): number {
  return datos.de_ventas_del_mes.detalle.reduce((s, c) => (incluye(c) ? s + c.valor : s), 0)
}
