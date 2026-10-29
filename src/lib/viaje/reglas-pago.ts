/**
 * Reglas del pago a un proveedor del viaje (F3, Vera C5 y F3-3). Módulo PURO y SIN IMPORTS: la
 * pantalla (`registrarPagoServicio`) y el bot de WhatsApp aplican exactamente la misma regla. Vive
 * copiado byte a byte en `supabase/functions/_shared/reglas-pago.ts` (Deno no resuelve `@/lib`) y
 * una prueba de CI compara las dos copias (`reglas-pago-copia.test.ts`). Se edita aquí y se copia.
 *
 * Tres reglas piden la aprobación de la dirección (Edgar por defecto, D8):
 *   · `pago_sin_abono`: el cliente todavía no ha abonado. Provisional del plan §5 (N4): «haber
 *     abonado» = anticipo registrado (un pago confirmado > 0). Si la línea declara un porcentaje,
 *     el cobrado confirmado tiene que llegar a ese % del precio aprobado.
 *   · `medio_personal`: el medio de pago es de titular personal (tarjeta de Edgar).
 *   · `desviacion_costo`: lo pagado al servicio supera lo cotizado en más del umbral (5 %) Y en
 *     más del piso en pesos (sale en $0; el piso de $50.000 se le propone a Edgar, Vera N1). SOLO
 *     cuenta hacia arriba: un pago más barato o la primera parte de un pago partido no piden nada.
 *     Si quien llama pasa el VIAJE (`viaje`), el sobrecosto que otros servicios ya compensaron no
 *     pide nada (QA Trappvel 2026-10-29, H3-4): Edgar cuida el margen del viaje, no el de cada
 *     fila. Compensar es haber REGISTRADO el ahorro (lo pagado o lo que el proveedor dijo que
 *     cobra), nunca suponerlo: una fila sin registrar cuenta por lo cotizado. Si el proveedor de
 *     esta misma fila dijo que cobra menos (`valorPorPagar`), la desviación se mide contra eso.
 *
 * La aprobación guarda una HUELLA de lo aprobado. Si cambia el monto (o el medio), la huella ya no
 * coincide y la aprobación no sirve: hay que volver a pedirla (F3-3).
 */

export type TipoReglaPago = 'pago_sin_abono' | 'medio_personal' | 'desviacion_costo'

export const TIPOS_REGLA_PAGO: readonly TipoReglaPago[] = ['pago_sin_abono', 'medio_personal', 'desviacion_costo']

export interface MedioPagoProveedor {
  id: string
  label: string
  titular: 'empresa' | 'personal'
}

export interface ConfigReglasPago {
  /** Porcentaje de desviación hacia arriba que pide aprobación (por defecto 5). */
  umbralPct: number
  /** Piso en pesos de la desviación (por defecto 0, Vera N1). */
  pisoPesos: number
  /** % del precio aprobado que el cliente tiene que haber pagado; 0 = basta con el anticipo (N4). */
  abonoMinimoPct: number
  /** ¿Una fila cuenta para el gate solo con la confirmación del proveedor final? (por defecto sí). */
  exigeConfirmacion: boolean
}

function numero(v: unknown, porDefecto: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= 0 ? n : porDefecto
}

/** `lineas_negocio.config_extra.servicios_viaje` → reglas, con los provisionales del plan. */
export function configReglasPago(configLinea: unknown): ConfigReglasPago {
  const sv = (configLinea && typeof configLinea === 'object'
    ? (configLinea as { servicios_viaje?: unknown }).servicios_viaje
    : null) as Record<string, unknown> | null | undefined
  const c = sv && typeof sv === 'object' ? sv : {}
  return {
    umbralPct: numero(c.umbral_desviacion_pct, 5),
    pisoPesos: numero(c.piso_desviacion_pesos, 0),
    abonoMinimoPct: numero(c.abono_minimo_pct, 0),
    exigeConfirmacion: c.exige_confirmacion_proveedor !== false,
  }
}

/**
 * `workspaces.config_extra.medios_pago_proveedor` → lista limpia. Un medio sin id, sin nombre o
 * sin titular válido se descarta: el titular sale del medio y nadie lo escoge aparte (F3-2).
 */
export function mediosPagoProveedor(configWorkspace: unknown): MedioPagoProveedor[] {
  const lista = (configWorkspace && typeof configWorkspace === 'object'
    ? (configWorkspace as { medios_pago_proveedor?: unknown }).medios_pago_proveedor
    : null)
  if (!Array.isArray(lista)) return []
  const vistos = new Set<string>()
  const out: MedioPagoProveedor[] = []
  for (const m of lista) {
    if (!m || typeof m !== 'object') continue
    const r = m as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id.trim() : ''
    const label = typeof r.label === 'string' ? r.label.trim() : ''
    const titular = r.titular === 'empresa' || r.titular === 'personal' ? r.titular : null
    if (!id || !label || !titular || vistos.has(id)) continue
    vistos.add(id)
    out.push({ id, label, titular })
  }
  return out
}

export interface EntradaReglasPago {
  /** Lo que se va a registrar (o se pide aprobar) ahora. */
  monto: number
  /** Lo ya pagado a este servicio antes de este pago (cada gasto una vez). */
  pagadoAntes: number
  /** Lo cotizado del servicio (contra esto se mide la desviación, Noor §5). */
  costoCotizado: number
  /**
   * Lo que el proveedor dijo que cobra, si es distinto de lo cotizado (`valor_por_pagar`). Si es
   * MENOR, la desviación se mide contra él: el ahorro ya declarado no se gasta sin aprobación.
   */
  valorPorPagar?: number | null
  /**
   * El viaje entero, para medir la desviación contra él (H3-4). Sin esto, la regla es la de
   * siempre: por servicio. `cotizado`: Σ lo cotizado de las filas que van (esta incluida).
   * `comprometidoOtros`: Σ de las OTRAS filas que van, cada una por lo mayor entre lo pagado y
   * lo que hay que pagarle (`valor_por_pagar` o lo cotizado).
   */
  viaje?: { cotizado: number; comprometidoOtros: number } | null
  medio: MedioPagoProveedor
  /** Cobrado confirmado al cliente en el negocio (pagos con fecha). */
  cobradoCliente: number
  /** Precio aprobado del viaje (para el abono mínimo en %). */
  precioAprobado: number
  config: ConfigReglasPago
}

export interface ReglaRota {
  tipo: TipoReglaPago
  /** Lo aprobado: si cambia, la aprobación caduca. */
  huella: string
  /** Para Alejandra (Noor §5, columna «Lo que ve Alejandra»). */
  texto: string
  detalle: Record<string, unknown>
}

function pesos(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CO').replace(/,/g, '.')
}

function pct1(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

/** Total del servicio después de este pago. */
export function totalTrasPago(e: Pick<EntradaReglasPago, 'monto' | 'pagadoAntes'>): number {
  return Math.round((Number(e.pagadoAntes) || 0) + (Number(e.monto) || 0))
}

/**
 * La huella de lo que se aprueba, por tipo. Lleva el total del servicio tras el pago (y el medio
 * cuando la regla es del medio): pedir antes de pagar $1.262.000 y registrar luego $1.300.000 no
 * usa la aprobación vieja.
 */
export function huellaRegla(tipo: TipoReglaPago, total: number, medioId: string): string {
  if (tipo === 'medio_personal') return `medio_personal|${medioId}|${Math.round(total)}`
  return `${tipo}|${Math.round(total)}`
}

/** Desviación hacia arriba del servicio con este pago: pesos y %. Nunca negativa. */
export function desviacion(total: number, costoCotizado: number): { pesos: number; pct: number } {
  const cot = Number(costoCotizado) || 0
  const sobre = Math.max(0, Math.round(total - cot))
  if (sobre === 0) return { pesos: 0, pct: 0 }
  return { pesos: sobre, pct: cot > 0 ? (sobre / cot) * 100 : Infinity }
}

/** La base contra la que se mide la desviación del servicio: lo cotizado o, si el proveedor dijo que cobra menos, eso. */
export function baseDesviacion(costoCotizado: number, valorPorPagar?: number | null): number {
  const cot = Number(costoCotizado) || 0
  const v = valorPorPagar === null || valorPorPagar === undefined ? NaN : Number(valorPorPagar)
  return Number.isFinite(v) && v >= 0 && v < cot ? v : cot
}

/**
 * Cuánto se pasa el VIAJE de lo cotizado con este pago (pesos, nunca negativo): las otras filas
 * por lo comprometido y esta por lo mayor entre el total tras el pago y lo que hay que pagarle.
 */
export function desviacionDelViaje(
  total: number,
  propio: { costoCotizado: number; valorPorPagar?: number | null },
  viaje: { cotizado: number; comprometidoOtros: number },
): number {
  const v = propio.valorPorPagar === null || propio.valorPorPagar === undefined ? NaN : Number(propio.valorPorPagar)
  const aPagarPropio = Number.isFinite(v) ? v : Number(propio.costoCotizado) || 0
  const proyectado = (Number(viaje.comprometidoOtros) || 0) + Math.max(Number(total) || 0, aPagarPropio)
  return Math.max(0, Math.round(proyectado - (Number(viaje.cotizado) || 0)))
}

/** ¿El cliente ya abonó lo suficiente para pagarle a un proveedor? */
export function clienteAbono(cobrado: number, precioAprobado: number, config: Pick<ConfigReglasPago, 'abonoMinimoPct'>): boolean {
  const c = Number(cobrado) || 0
  if (config.abonoMinimoPct <= 0) return c > 0
  return c > 0 && c >= (config.abonoMinimoPct / 100) * (Number(precioAprobado) || 0)
}

/** Las reglas que rompe este pago, en el orden en que se le explican a Alejandra. */
export function reglasQueRompe(e: EntradaReglasPago): ReglaRota[] {
  const total = totalTrasPago(e)
  const out: ReglaRota[] = []
  if (!clienteAbono(e.cobradoCliente, e.precioAprobado, e.config)) {
    out.push({
      tipo: 'pago_sin_abono',
      huella: huellaRegla('pago_sin_abono', total, e.medio.id),
      texto: e.config.abonoMinimoPct > 0
        ? `El cliente no ha pagado el ${pct1(e.config.abonoMinimoPct)} % del viaje.`
        : 'El cliente no ha pagado el anticipo.',
      detalle: { cobrado: Math.round(Number(e.cobradoCliente) || 0), abono_minimo_pct: e.config.abonoMinimoPct },
    })
  }
  if (e.medio.titular === 'personal') {
    out.push({
      tipo: 'medio_personal',
      huella: huellaRegla('medio_personal', total, e.medio.id),
      texto: `Este medio es personal (${e.medio.label}).`,
      detalle: { medio: e.medio.id, medio_label: e.medio.label },
    })
  }
  const base = baseDesviacion(e.costoCotizado, e.valorPorPagar)
  const contraLoQueCobra = base < (Number(e.costoCotizado) || 0)
  const d = desviacion(total, base)
  const viaje = e.viaje ? desviacionDelViaje(total, e, e.viaje) : null
  // El viaje compensa: lo que esta fila se pasa ya lo ahorraron otras (registrado, no supuesto).
  const compensado = viaje !== null && viaje <= e.config.pisoPesos
  if (d.pesos > 0 && d.pct > e.config.umbralPct && d.pesos > e.config.pisoPesos && !compensado) {
    out.push({
      tipo: 'desviacion_costo',
      huella: huellaRegla('desviacion_costo', total, e.medio.id),
      texto: (contraLoQueCobra
        ? `Costó ${pesos(d.pesos)} más de lo que dijo que cobraba el proveedor (${pesos(base)}).`
        : Number.isFinite(d.pct)
          ? `Costó ${pesos(d.pesos)} más de lo cotizado (+${pct1(d.pct)} %).`
          : `Costó ${pesos(d.pesos)} y no tenía costo cotizado.`)
        + (viaje !== null && viaje < d.pesos ? ` El viaje entero se pasa ${pesos(viaje)}.` : ''),
      detalle: {
        cotizado: Math.round(Number(e.costoCotizado) || 0), total, sobrecosto: d.pesos, pct: Number.isFinite(d.pct) ? Math.round(d.pct * 10) / 10 : null,
        ...(contraLoQueCobra ? { valor_por_pagar: Math.round(base) } : {}),
        ...(e.viaje ? { viaje_cotizado: Math.round(Number(e.viaje.cotizado) || 0), viaje_sobrecosto: viaje } : {}),
      },
    })
  }
  return out
}

export interface AprobacionLeida {
  id: string
  tipo: string
  estado: 'solicitada' | 'aprobada' | 'rechazada' | 'caducada'
  huella: string
}

/**
 * Qué reglas rotas siguen sin una aprobación VIGENTE (aprobada y con la misma huella). Las que
 * quedan son las que hay que pedir; una aprobada con otra huella ya no vale.
 */
export function reglasSinAprobar(rotas: readonly ReglaRota[], aprobaciones: readonly AprobacionLeida[]): ReglaRota[] {
  return rotas.filter(r => !aprobaciones.some(a => a.tipo === r.tipo && a.estado === 'aprobada' && a.huella === r.huella))
}
