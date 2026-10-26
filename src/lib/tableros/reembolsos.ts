/**
 * Indicador de reembolsos de los tableros de SOENA (SOE-007, segunda parte).
 *
 * Mauricio, 2026-10-09: «es importante que se vea en los indicadores cuantos reembolsos
 * llevamos». Cuenta las devoluciones de dinero con FECHA DE DEVOLUCIÓN en el mes, no por el
 * mes de la venta: la venta reembolsada en su totalidad ya salió de las ventas de su mes, y
 * aquí se ve cuándo salió el dinero. Dirección y Comercial leen la misma RPC
 * (`get_reembolsos_mes_soena`); el corte por vendedor se suma de la misma lista, así que la
 * fila y el total no pueden discrepar.
 */

/** Qué pasó con el caso al registrar la devolución. */
export type CierreReembolso = 'cerro_caso' | 'ya_cerrado' | 'abierto'

/** Una devolución de dinero del mes. */
export interface Reembolso {
  devolucion_id: string
  negocio_id: string
  codigo: string | null
  nombre: string | null
  /** 'YYYY-MM-DD'. Día en que salió el dinero. */
  fecha: string
  /** Lo devuelto sin IVA: honorario en base + tarifa UPME + excedente. */
  valor: number
  /** Lo que salió de la cuenta, con IVA. */
  monto: number
  motivo: string
  cierre: CierreReembolso
  /** Al negocio se le devolvió todo lo que pagó: ya no cuenta como venta. */
  venta_anulada: boolean
  responsable_id: string | null
  responsable: string | null
}

export interface ReembolsosMes {
  anio: number
  mes: number
  /** Cuántas devoluciones. */
  reembolsos: number
  /** Cuántos negocios distintos. */
  negocios: number
  /** Sin IVA. */
  valor: number
  /** Con IVA: lo que salió de caja. */
  monto: number
  /** Negocios del mes que quedaron con todo devuelto y salieron de ventas. */
  ventas_anuladas: number
  detalle: Reembolso[]
  /** Los dos totales del mes anterior, para la comparación del panel. */
  anterior: { reembolsos: number; valor: number }
}

/** Un vendedor en el corte de reembolsos del Comercial. */
export interface ReembolsosVendedor {
  responsable_id: string | null
  responsable: string
  reembolsos: number
  valor: number
}

export const NOTA_REEMBOLSOS = 'Por fecha de la devolución · sin IVA'

export const ETIQUETA_CIERRE: Record<CierreReembolso, string> = {
  cerro_caso: 'Cerró el caso',
  ya_cerrado: 'El caso ya estaba cerrado',
  abierto: 'El caso sigue abierto',
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const CIERRES: CierreReembolso[] = ['cerro_caso', 'ya_cerrado', 'abierto']

function reembolso(c: Record<string, unknown>): Reembolso {
  const cierre = CIERRES.includes(c.cierre as CierreReembolso) ? (c.cierre as CierreReembolso) : 'abierto'
  return {
    devolucion_id: String(c.devolucion_id),
    negocio_id: String(c.negocio_id),
    codigo: (c.codigo as string | null) ?? null,
    nombre: (c.nombre as string | null) ?? null,
    fecha: String(c.fecha ?? ''),
    valor: num(c.valor),
    monto: num(c.monto),
    motivo: String(c.motivo ?? ''),
    cierre,
    venta_anulada: c.venta_anulada === true,
    responsable_id: (c.responsable_id as string | null) ?? null,
    responsable: (c.responsable as string | null) ?? null,
  }
}

/**
 * La respuesta cruda de la RPC, con los `numeric` como número. `null` si no vino nada
 * (guarda de workspace, error): la pantalla calla en vez de pintar un cero, que se leería
 * como «no hubo reembolsos».
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizarReembolsos(data: any): ReembolsosMes | null {
  if (!data || typeof data !== 'object' || !Array.isArray(data.detalle)) return null
  return {
    anio: num(data.anio),
    mes: num(data.mes),
    reembolsos: num(data.reembolsos),
    negocios: num(data.negocios),
    valor: num(data.valor),
    monto: num(data.monto),
    ventas_anuladas: num(data.ventas_anuladas),
    detalle: data.detalle.map((c: Record<string, unknown>) => reembolso(c)),
    anterior: {
      reembolsos: num(data.anterior?.reembolsos),
      valor: num(data.anterior?.valor),
    },
  }
}

/**
 * Los reembolsos del mes por vendedor, de la MISMA lista que da el total. Ordenados por
 * cantidad y luego por valor; los casos sin comercial van juntos, al final.
 */
export function reembolsosPorVendedor(detalle: Reembolso[]): ReembolsosVendedor[] {
  const porId = new Map<string, ReembolsosVendedor>()
  for (const r of detalle) {
    const k = r.responsable_id ?? ''
    const fila = porId.get(k) ?? {
      responsable_id: r.responsable_id,
      responsable: r.responsable_id ? (r.responsable ?? 'Sin nombre') : 'Sin comercial',
      reembolsos: 0,
      valor: 0,
    }
    fila.reembolsos += 1
    fila.valor = Math.round((fila.valor + r.valor) * 100) / 100
    porId.set(k, fila)
  }
  return [...porId.values()].sort((a, b) => {
    if ((a.responsable_id === null) !== (b.responsable_id === null)) return a.responsable_id === null ? 1 : -1
    return b.reembolsos - a.reembolsos || b.valor - a.valor || a.responsable.localeCompare(b.responsable, 'es')
  })
}
