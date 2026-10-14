/**
 * Riel de cobro al viajero (F2): estado de cada cuota del plan acordado contra los pagos reales,
 * la franja de la cabecera (pagado / por cobrar / próxima cuota / marca 80/15), las cuentas que
 * reciben la plata, la lectura del comprobante y los mensajes al viajero (recibo y recordatorio).
 *
 * Puro (servidor y navegador). El estado de una cuota se DERIVA del reparto FIFO de los pagos con
 * fecha (`cobros.fecha`); nunca se guarda (Vera §7.2.3). Copy de Noor §2 (riel A), §7.2-7.3 y §8,
 * con las resoluciones de Vera: sin link de pago si la agencia no tiene uno propio (X1).
 */

import { repartirFifo } from '@/lib/cobros/cuotas-fifo'
import type { CampoExtraccion } from '@/lib/ai/extract-fields'
import { normalizarMontoExtraido } from '@/lib/ai/monto-extraido'
import { fechaConDia, fechaCorta, fechaDelMinimo, pesos, type CuotaPlan, type ReglaPlan } from './plan-pagos'
import { primerNombre } from './confirmacion'

// ── Pagos y cuotas ───────────────────────────────────────────────────────────

export interface PagoViajero {
  id?: string
  monto: number | null
  fecha: string | null
  retencion_iva?: number | null
  anulado_at?: string | null
}

/** Lo recibido de verdad: pagos con fecha, no anulados, más la retención de IVA (como `cobradoConfirmado`). */
export function recibido(pagos: readonly PagoViajero[]): number {
  return pagos
    .filter((p) => !!p.fecha && !p.anulado_at)
    .reduce((s, p) => s + (Number(p.monto) || 0) + (Number(p.retencion_iva) || 0), 0)
}

export type EstadoCuotaViaje = 'pagada' | 'parcial' | 'por_pagar' | 'vence_hoy' | 'vencida'

export interface CuotaConEstadoViaje extends CuotaPlan {
  abonado: number
  saldo: number
  estado: EstadoCuotaViaje
  /** Días de atraso (solo `vencida`). */
  diasVencida: number
  etiqueta: string
}

const DIA_MS = 86_400_000
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA_MS)

/** Cada cuota con su estado (F2-7): Pagada · Pagada en parte (falta $X) · Por pagar · Vence hoy · Vencida hace N días. */
export function cuotasConEstadoViaje(cuotas: readonly CuotaPlan[], pagos: readonly PagoViajero[], hoy: string): { cuotas: CuotaConEstadoViaje[]; saldoAFavor: number } {
  const ordenadas = [...cuotas].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.numero - b.numero))
  const { tramos, sobrante } = repartirFifo(ordenadas.map((c) => c.monto), recibido(pagos))
  return {
    saldoAFavor: Math.round(sobrante),
    cuotas: ordenadas.map((c, i) => {
      const t = tramos[i]
      const atraso = dias(c.fecha, hoy)
      const estado: EstadoCuotaViaje = t.pagada
        ? 'pagada'
        : c.fecha < hoy
          ? 'vencida'
          : t.abonado > 0
            ? 'parcial'
            : c.fecha === hoy
              ? 'vence_hoy'
              : 'por_pagar'
      const etiqueta =
        estado === 'pagada' ? 'Pagada'
          : estado === 'parcial' ? `Pagada en parte (falta ${pesos(t.saldo)})`
            : estado === 'vence_hoy' ? 'Vence hoy'
              : estado === 'vencida' ? `Vencida hace ${atraso} día${atraso === 1 ? '' : 's'}${t.abonado > 0 ? ` (falta ${pesos(t.saldo)})` : ''}`
                : 'Por pagar'
      return { ...c, abonado: Math.round(t.abonado), saldo: Math.round(t.saldo), estado, diasVencida: estado === 'vencida' ? atraso : 0, etiqueta }
    }),
  }
}

export type EstadoMarca = 'en_camino' | 'en_riesgo' | 'cumplido'

export interface Riel {
  total: number
  pagado: number
  porCobrar: number
  pct: number
  /** Lo comprometido hasta hoy y no pagado (rojo). */
  vencido: number
  proxima: { monto: number; fecha: string } | null
  marca: { fecha: string; pct: number; estado: EstadoMarca } | null
  saldoAFavor: number
  cuotas: CuotaConEstadoViaje[]
}

/**
 * La franja de la cabecera (Noor riel A). La marca del 80 %: «cumplido» si ya se pagó; «en riesgo»
 * si hay una cuota vencida o ya pasó la fecha sin llegar; «en camino» si el plan llega.
 */
export function rielDeCobro(args: {
  total: number
  cuotas: readonly CuotaPlan[]
  pagos: readonly PagoViajero[]
  hoy: string
  fechaSalida: string | null
  regla: ReglaPlan
}): Riel {
  const { cuotas, saldoAFavor } = cuotasConEstadoViaje(args.cuotas, args.pagos, args.hoy)
  const pagado = Math.round(recibido(args.pagos))
  const total = Math.round(args.total)
  const pendiente = cuotas.find((c) => c.estado !== 'pagada') ?? null
  const vencido = cuotas.filter((c) => c.estado === 'vencida').reduce((s, c) => s + c.saldo, 0)
  let marca: Riel['marca'] = null
  if (args.fechaSalida) {
    // La fecha del mínimo es la del plan (T-15), aunque ya haya pasado: el riel la sigue mostrando.
    const fecha = fechaDelMinimo(args.fechaSalida, '0000-01-01', args.regla)
    const meta = (total * args.regla.pct_minimo) / 100
    const estado: EstadoMarca = pagado >= meta - 0.5
      ? 'cumplido'
      : vencido > 0 || fecha < args.hoy
        ? 'en_riesgo'
        : 'en_camino'
    marca = { fecha, pct: args.regla.pct_minimo, estado }
  }
  return {
    total,
    pagado,
    porCobrar: Math.max(0, total - pagado),
    pct: total > 0 ? Math.min(100, Math.floor((pagado / total) * 100)) : 0,
    vencido,
    proxima: pendiente ? { monto: pendiente.saldo, fecha: pendiente.fecha } : null,
    marca,
    saldoAFavor,
    cuotas,
  }
}

export const ETIQUETA_MARCA: Record<EstadoMarca, string> = { en_camino: 'en camino', en_riesgo: 'en riesgo', cumplido: 'cumplido' }

/** Los textos de la franja (Noor §8, riel de cobro). */
export function textosDelRiel(r: Riel): { pagado: string; proxima: string | null; marca: string | null; aFavor: string | null } {
  return {
    pagado: `Pagado ${pesos(r.pagado)} de ${pesos(r.total)} (${r.pct} %)`,
    proxima: r.proxima ? `Próxima cuota ${pesos(r.proxima.monto)} el ${fechaConDia(r.proxima.fecha)}` : null,
    marca: r.marca ? `${r.marca.pct} % al ${fechaCorta(r.marca.fecha)}: ${ETIQUETA_MARCA[r.marca.estado]}` : null,
    aFavor: r.saldoAFavor > 0 ? `Saldo a favor de ${pesos(r.saldoAFavor)}` : null,
  }
}

// ── Cuentas que reciben la plata ─────────────────────────────────────────────

export interface CuentaRecaudo {
  id: string
  nombre: string
  tipo: 'banco' | 'link' | 'efectivo' | 'nequi' | 'otra'
  /** Número completo o sus últimos dígitos: con esto se cruza la lectura del comprobante. */
  numero: string | null
  /** Solo `link`: la URL del link de pago PROPIO de la agencia (X1). */
  url: string | null
  /** Forma de pago de Siigo para el recibo de caja de los pagos que entran aquí (F2-6). */
  siigo_payment_id: number | null
}

function slug(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Las cuentas declaradas en `workspaces.config_extra.cuentas_recaudo`. Sin esa clave, las que trae
 * el texto de «Medios de pago» de los términos de la línea («Bancolombia, cuenta de ahorros
 * 32800003241»): la misma fuente que ve el cliente en el mensaje.
 */
export function cuentasDeRecaudo(configWs: unknown, terminosBase: string | null): CuentaRecaudo[] {
  const raw = (configWs as { cuentas_recaudo?: unknown } | null | undefined)?.cuentas_recaudo
  if (Array.isArray(raw) && raw.length > 0) {
    const out: CuentaRecaudo[] = []
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      const nombre = typeof o.nombre === 'string' ? o.nombre.trim() : ''
      const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : slug(nombre)
      if (!id || !nombre) continue
      const tipo = ['banco', 'link', 'efectivo', 'nequi'].includes(String(o.tipo)) ? (o.tipo as CuentaRecaudo['tipo']) : 'otra'
      const pid = Number(o.siigo_payment_id)
      out.push({
        id: id.slice(0, 60),
        nombre,
        tipo,
        numero: typeof o.numero === 'string' && o.numero.trim() ? o.numero.replace(/\D/g, '') : null,
        url: tipo === 'link' && typeof o.url === 'string' && /^https:\/\//.test(o.url) ? o.url : null,
        siigo_payment_id: Number.isInteger(pid) && pid > 0 ? pid : null,
      })
    }
    return out
  }
  if (!terminosBase) return []
  const out: CuentaRecaudo[] = []
  for (const linea of terminosBase.split(/\r?\n/)) {
    const m = /^\s*[-•*]\s*([^,]+),\s*cuenta (?:de )?(ahorros|corriente)\s+([\d\s-]{5,})/i.exec(linea)
    if (!m) continue
    const banco = m[1].trim()
    const numero = m[3].replace(/\D/g, '')
    out.push({ id: slug(`${banco}-${numero.slice(-4)}`), nombre: `${banco} ${m[2].toLowerCase()} ${numero}`, tipo: 'banco', numero, url: null, siigo_payment_id: null })
  }
  return out
}

/** La cuenta cuyo número termina en los dígitos leídos (mínimo 4). `null` si no hay una sola. */
export function cuentaPorDigitos(cuentas: readonly CuentaRecaudo[], digitos: string | null | undefined): CuentaRecaudo | null {
  const d = (digitos ?? '').replace(/\D/g, '')
  if (d.length < 4) return null
  const cola = d.slice(-4)
  const hits = cuentas.filter((c) => c.numero && c.numero.endsWith(cola))
  return hits.length === 1 ? hits[0] : null
}

/** El link de pago propio de la agencia (X1). Sin él, ningún mensaje lleva link. */
export function linkDePagoPropio(cuentas: readonly CuentaRecaudo[]): string | null {
  return cuentas.find((c) => c.tipo === 'link' && c.url)?.url ?? null
}

// ── Lectura del comprobante (Max §3.1, F2-4) ─────────────────────────────────

export const CAMPOS_COMPROBANTE: CampoExtraccion[] = [
  { slug: 'monto', label: 'Monto', tipo: 'currency', required: true, descripcion_ai: 'Valor transferido o pagado, en pesos colombianos. Sin comisiones.' },
  { slug: 'fecha', label: 'Fecha', tipo: 'fecha', required: true, descripcion_ai: 'Fecha en que se hizo la transferencia o el pago (YYYY-MM-DD).' },
  { slug: 'banco_origen', label: 'Banco de origen', tipo: 'texto', required: false, descripcion_ai: 'Banco o billetera desde donde salió el dinero (Bancolombia, Nequi, Davivienda...).' },
  { slug: 'cuenta_destino', label: 'Cuenta destino', tipo: 'texto', required: false, descripcion_ai: 'Número de la cuenta que RECIBIÓ el dinero, o sus últimos dígitos visibles. Solo dígitos.' },
  { slug: 'destinatario', label: 'Destinatario', tipo: 'texto', required: false, descripcion_ai: 'Nombre de la persona o empresa que recibió el dinero.' },
  { slug: 'referencia', label: 'Referencia', tipo: 'texto', required: false, descripcion_ai: 'Número de comprobante, referencia o código de aprobación de la transacción.' },
  { slug: 'ordenante', label: 'Ordenante', tipo: 'texto', required: false, descripcion_ai: 'Nombre de quien envió el dinero, si aparece.' },
]

export interface LecturaComprobante {
  monto: number | null
  fecha: string | null
  banco: string | null
  referencia: string | null
  cuentaId: string | null
  /** Lo leído no parece un pago a la agencia (C17): avisar antes de registrar. */
  pareceProveedor: boolean
}

/** De los campos leídos a la propuesta que la persona confirma. */
export function propuestaDesdeLectura(
  campos: Record<string, { value: string | null } | undefined>,
  cuentas: readonly CuentaRecaudo[],
  agencia: string,
): LecturaComprobante {
  const v = (k: string) => {
    const x = campos[k]?.value
    return typeof x === 'string' && x.trim() !== '' ? x.trim() : null
  }
  const montoTxt = v('monto')
  const monto = montoTxt ? Math.round(Number(normalizarMontoExtraido(montoTxt))) : null
  const fecha = v('fecha')
  const cuenta = cuentaPorDigitos(cuentas, v('cuenta_destino'))
  const dest = v('destinatario')
  const normal = (t: string) => slug(t).replace(/-/g, '')
  const aLaAgencia = !!dest && !!agencia && normal(dest).includes(normal(agencia).slice(0, 8))
  return {
    monto: monto && Number.isFinite(monto) && monto > 0 ? monto : null,
    fecha: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null,
    banco: v('banco_origen'),
    referencia: v('referencia'),
    cuentaId: cuenta?.id ?? null,
    pareceProveedor: !cuenta && !!dest && !aLaAgencia,
  }
}

/** ¿Ya hay un pago con la misma referencia y el mismo monto? (F2-5: avisa antes de registrar). */
export function pagoRepetido(pagos: ReadonlyArray<PagoViajero & { external_ref?: string | null }>, referencia: string | null, monto: number): boolean {
  const ref = (referencia ?? '').replace(/\s/g, '').toLowerCase()
  if (!ref) return false
  return pagos.some((p) => !p.anulado_at && (p.external_ref ?? '').replace(/\s/g, '').toLowerCase() === ref && Math.round(Number(p.monto)) === Math.round(monto))
}

/** A qué cuota va un pago nuevo (la más vieja sin pagar), para «Va a: Cuota n». */
export function cuotaQueCubre(cuotas: readonly CuotaConEstadoViaje[]): CuotaConEstadoViaje | null {
  return cuotas.find((c) => c.estado !== 'pagada') ?? null
}

// ── Mensajes al viajero (Noor §7.2 y §7.3) ───────────────────────────────────

export function mensajeRecibo(args: {
  nombreCliente: string
  monto: number
  riel: Riel
  numeroRecibo: string | null
  agencia: string
}): string {
  const nombre = primerNombre(args.nombreCliente)
  const lineas: string[] = []
  const cubierta = args.riel.cuotas.find((c) => c.estado === 'parcial' || (c.estado === 'vencida' && c.abonado > 0))
  if (cubierta && cubierta.abonado > 0 && cubierta.saldo > 0) {
    lineas.push(`${nombre}, recibimos ${pesos(args.monto)} de tu cuota de ${pesos(cubierta.monto)}. ¿Nos envías los ${pesos(cubierta.saldo)} que faltan antes del ${fechaCorta(cubierta.fecha)}?`)
  } else {
    lineas.push(`${nombre}, recibimos tu pago de ${pesos(args.monto)}. ¡Gracias!`)
    if (args.riel.porCobrar > 0) {
      lineas.push(`Te quedan ${pesos(args.riel.porCobrar)}.${args.riel.proxima ? ` Tu próxima cuota es de ${pesos(args.riel.proxima.monto)} el ${fechaConDia(args.riel.proxima.fecha)}.` : ''}`)
    } else {
      lineas.push('Con este pago quedaste al día con todo el viaje.')
    }
  }
  if (args.numeroRecibo) lineas.push(`Adjunto tu recibo de caja ${args.numeroRecibo}.`)
  lineas.push('')
  lineas.push(args.agencia)
  return lineas.join('\n')
}

export function mensajeRecordatorioCuota(args: {
  nombreCliente: string
  cuota: { monto: number; fecha: string }
  hoy: string
  link: string | null
  comercial: string | null
  agencia: string
}): string {
  const nombre = primerNombre(args.nombreCliente)
  const firma = [args.comercial ? primerNombre(args.comercial) : null, args.agencia].filter(Boolean).join(' · ')
  if (args.cuota.fecha === args.hoy) {
    return [
      `${nombre}, hoy vence tu cuota de ${pesos(args.cuota.monto)}. ¿Ya la pagaste?`,
      `Si sí, mándame el comprobante por aquí.${args.link ? ` Si no, este es el link: ${args.link}` : ' Si no, puedes transferir a las cuentas de siempre.'}`,
      '',
      firma,
    ].join('\n')
  }
  return [
    `${nombre}, ¿te queda bien pagar el ${fechaConDia(args.cuota.fecha)} tu cuota de ${pesos(args.cuota.monto)}?`,
    `Puedes transferir a las cuentas de siempre${args.link ? ` o pagar aquí: ${args.link}` : ''}.`,
    'Cuando pagues, mándame el comprobante por aquí.',
    '',
    firma,
  ].join('\n')
}
