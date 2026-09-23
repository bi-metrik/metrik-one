/**
 * El próximo pago de un CDA: qué cuota sigue, cuánto falta y con qué enlace se paga. Puro.
 *
 * ## Qué cuota es «la pendiente»
 *
 * La primera cuota, en orden de vencimiento, que la plata recibida no alcanza a cubrir. Lo recibido
 * se reparte de la cuota más vieja a la más nueva (FIFO), y por eso no importa CÓMO se registró el
 * pago: con el cobro atado a la cuota o como un cobro suelto del negocio (así se registró el pago de
 * 4D SOFT, `bold-TXRRP7Q95ZJ`, sin plan ni número de cuota). Mirar solo los cobros atados a la cuota
 * le mostraría «Pagar» a un CDA que ya pagó. Y un excedente se descuenta de la cuota siguiente, no
 * queda flotando (regla de Mauricio sobre el excedente de cobro).
 *
 * Lo recibido es lo `pagado` que devuelve `mis_cobros_de_servicio()`: un cobro programado todavía
 * no es plata, y uno anulado ya no lo es.
 *
 * ## El enlace
 *
 * Vive en el cobro programado de la cuota (`cobros.enlace_pago_url` y `enlace_pago_expira`), la
 * misma fila donde el ciclo de suscripciones anota el intento de la pasarela. Hoy Mauricio crea el
 * enlace a mano en el panel de Bold (Bold no cobra recurrente); con el adaptador `bold-link` lo
 * escribirá el ciclo. El botón lee lo mismo en los dos casos.
 *
 * La base solo exige https; aquí se exige además que sea de Bold, porque es un botón de pago frente
 * al cliente y un dominio equivocado (un error al pegarlo) lo mandaría a pagar a otro lado. Un
 * enlace que no pasa, o que ya venció, no se pinta: la tarjeta dice que el enlace llega, en vez de
 * ofrecer uno dudoso o muerto.
 *
 * El pago NO bloquea el módulo antes de 30 días de mora (cláusula 11.1): esa regla vive en
 * `plazos.ts` (`estadoMora`), y se mide sobre la cuota que devuelve `proximoPago`.
 */

import { saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'

export interface CuotaDeServicio {
  numero: number
  tipo: string
  monto: number
  /** 'YYYY-MM-DD' */
  fechaVencimiento: string
  /** El detalle de la cuota, con su período («Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026»). */
  concepto: string | null
  enlacePagoUrl: string | null
  /** ISO-8601: hasta cuándo sirve el enlace. `null` = sin fecha de vencimiento declarada. */
  enlacePagoExpira: string | null
  /** `plan_cobro_cuotas.id`: por él se descarga la factura. */
  cuotaId?: string | null
  /** La factura electrónica que MeTRIK cargó para esta cuota, si existe. */
  factura?: FacturaDeCuota | null
}

export interface FacturaDeCuota {
  numero: string
  pdf: boolean
  xml: boolean
}

export interface CobroRecibido {
  monto: number
  estado: 'pagado' | 'programado' | 'anulado'
}

export type ProximoPago =
  | { estado: 'sin_cuotas' }
  | { estado: 'al_dia'; cuotasPagadas: number }
  | {
      estado: 'pendiente'
      numero: number
      concepto: string | null
      fechaVencimiento: string
      monto: number
      /** Lo que ya entró y se abonó a esta cuota. */
      abonado: number
      /** Lo que falta de esta cuota. */
      saldo: number
      vencida: boolean
      /** El enlace de Bold de esta cuota, solo si es de Bold, https y no ha vencido. */
      enlacePago: string | null
      /** Había enlace y ya venció: hay que pedir uno nuevo. */
      enlaceVencido: boolean
    }

/** Dominios de la pasarela que pueden salir en el botón «Pagar». */
const HOSTS_PASARELA = ['bold.co'] as const

/** ¿El enlace es https y de Bold? Cualquier otra cosa no se pinta. */
export function enlaceDePagoValido(url: string | null | undefined): string | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  const host = u.hostname.toLowerCase()
  const esDeLaPasarela = HOSTS_PASARELA.some((h) => host === h || host.endsWith(`.${h}`))
  return esDeLaPasarela ? u.toString() : null
}

export type EstadoCuota = 'pagada' | 'abonada' | 'pendiente' | 'vencida'

/** Una cuota con lo que lo pagado le alcanzó a cubrir, para la pestaña Pagos. */
export interface CuotaConEstado {
  cuotaId: string | null
  numero: number
  concepto: string | null
  fechaVencimiento: string
  monto: number
  abonado: number
  saldo: number
  estado: EstadoCuota
  /** El enlace de Bold, solo si la cuota tiene saldo y el enlace es de Bold, https y vigente. */
  enlacePago: string | null
  factura: FacturaDeCuota | null
}

/** Las cuotas con monto, de la más vieja a la más nueva: el orden del reparto. */
function cuotasEnOrden(cuotas: readonly CuotaDeServicio[]): CuotaDeServicio[] {
  return [...cuotas]
    .filter((c) => Number.isFinite(c.monto) && c.monto > 0)
    .sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento) || a.numero - b.numero)
}

function totalRecibido(cobros: readonly CobroRecibido[]): number {
  return cobros.filter((c) => c.estado === 'pagado').reduce((s, c) => s + (Number.isFinite(c.monto) ? c.monto : 0), 0)
}

/** El enlace que se puede pintar y si había uno ya vencido. */
function enlaceDeCuota(cuota: CuotaDeServicio, ahoraISO: string): { enlace: string | null; vencido: boolean } {
  const enlace = enlaceDePagoValido(cuota.enlacePagoUrl)
  const expira = cuota.enlacePagoExpira ? Date.parse(cuota.enlacePagoExpira) : Number.NaN
  // Un vencimiento ilegible no se lee como «vigente»: sin poder compararlo, el enlace no sale.
  const vencido =
    enlace !== null && cuota.enlacePagoExpira !== null && (Number.isNaN(expira) || expira < Date.parse(ahoraISO))
  return { enlace: vencido ? null : enlace, vencido }
}

/**
 * Todas las cuotas, con el mismo reparto de `proximoPago`: lo recibido cubre de la más vieja a la
 * más nueva, y unos pesos de redondeo no dejan una cuota «abonada».
 */
export function cuotasConEstado(p: {
  cuotas: readonly CuotaDeServicio[]
  cobros: readonly CobroRecibido[]
  hoy: string
  ahoraISO: string
}): CuotaConEstado[] {
  let disponible = totalRecibido(p.cobros)
  return cuotasEnOrden(p.cuotas).map((cuota) => {
    const abonado = Math.max(0, Math.min(disponible, cuota.monto))
    disponible -= cuota.monto
    const saldo = cuota.monto - abonado
    const pagada = saldo <= 0 || saldoCuadrado(saldo)
    const estado: EstadoCuota = pagada
      ? 'pagada'
      : cuota.fechaVencimiento < p.hoy
        ? 'vencida'
        : abonado > 0
          ? 'abonada'
          : 'pendiente'
    return {
      cuotaId: cuota.cuotaId ?? null,
      numero: cuota.numero,
      concepto: cuota.concepto,
      fechaVencimiento: cuota.fechaVencimiento,
      monto: cuota.monto,
      abonado: pagada ? cuota.monto : abonado,
      saldo: pagada ? 0 : saldo,
      estado,
      enlacePago: pagada ? null : enlaceDeCuota(cuota, p.ahoraISO).enlace,
      factura: cuota.factura ?? null,
    }
  })
}

export function proximoPago(p: {
  cuotas: readonly CuotaDeServicio[]
  cobros: readonly CobroRecibido[]
  /** Hoy en Bogotá, 'YYYY-MM-DD'. Entra por parámetro: una marca por lote, testeable. */
  hoy: string
  /** El instante de ahora, ISO-8601, para comparar contra el vencimiento del enlace. */
  ahoraISO: string
}): ProximoPago {
  const cuotas = cuotasEnOrden(p.cuotas)
  if (cuotas.length === 0) return { estado: 'sin_cuotas' }

  let disponible = totalRecibido(p.cobros)

  for (let i = 0; i < cuotas.length; i++) {
    const cuota = cuotas[i]
    const abonado = Math.max(0, Math.min(disponible, cuota.monto))
    const saldo = cuota.monto - abonado
    // El piso de materialidad del sistema: unos pesos de redondeo no dejan una cuota «pendiente».
    if (saldo <= 0 || saldoCuadrado(saldo)) {
      disponible -= cuota.monto
      continue
    }
    const { enlace, vencido: enlaceVencido } = enlaceDeCuota(cuota, p.ahoraISO)
    return {
      estado: 'pendiente',
      numero: cuota.numero,
      concepto: cuota.concepto,
      fechaVencimiento: cuota.fechaVencimiento,
      monto: cuota.monto,
      abonado,
      saldo,
      vencida: cuota.fechaVencimiento < p.hoy,
      enlacePago: enlace,
      enlaceVencido,
    }
  }
  return { estado: 'al_dia', cuotasPagadas: cuotas.length }
}

/** '2026-09-30' → '30/09/2026', la misma forma del período que trae el concepto de la cuota. */
export function fechaCorta(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
