/**
 * Eventos de Wompi del comercio de Dimpro: firma y lectura. Puro (sin red ni base), para probarlo
 * con eventos firmados de ejemplo.
 *
 * Contrato transcrito de la documentación oficial el 2026-09-28
 * (https://docs.wompi.co/docs/colombia/eventos/):
 *
 *   - Wompi hace POST con un JSON { event, data, environment, signature: { properties, checksum },
 *     timestamp, sent_at }. El checksum viene también en la cabecera `X-Event-Checksum`.
 *   - checksum = SHA256( valor de cada propiedad de `signature.properties`, en ese orden, leída
 *     dentro de `data` (p. ej. "transaction.id" → data.transaction.id) + `timestamp` + secreto de
 *     eventos ), en hexadecimal. Las propiedades VARÍAN por evento: se leen siempre del evento.
 *   - Cualquier respuesta distinta de 200 hace que Wompi reintente: a los 30 minutos, a las 3 horas
 *     y a las 24 horas (tres reintentos como máximo).
 *
 * El secreto de eventos (`prod_events_...`) NO es la llave privada ni la pública.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { todayBogotaISO } from '@/lib/dates/bogota'
import type { EnvioWompi } from './wompi-envio'

export { direccionEnvio, type EnvioWompi } from './wompi-envio'

export const ESTADOS_WOMPI = ['PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR'] as const
export type EstadoWompi = (typeof ESTADOS_WOMPI)[number]

export type VerificacionFirma =
  | { ok: true; evento: EventoWompi }
  | { ok: false; motivo: 'cuerpo_invalido' | 'firma_ausente' | 'firma_invalida' }

export interface EventoWompi {
  event: string
  data: Record<string, unknown>
  environment?: string
  signature: { properties: string[]; checksum: string }
  timestamp: number | string
  sent_at?: string
}

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Valor de una ruta con puntos dentro de `data` ("transaction.amount_in_cents"). */
export function valorEnRuta(data: unknown, ruta: string): unknown {
  let actual: unknown = data
  for (const parte of ruta.split('.')) {
    if (!esObj(actual)) return undefined
    actual = actual[parte]
  }
  return actual
}

/** Un valor tal como entra en la cadena firmada: null/undefined no aportan nada. */
function comoTextoFirmado(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** El checksum que Wompi calcula para un evento con un secreto dado (hex en MAYÚSCULAS). */
export function checksumEvento(evento: Pick<EventoWompi, 'data' | 'signature' | 'timestamp'>, secreto: string): string {
  const valores = evento.signature.properties.map((p) => comoTextoFirmado(valorEnRuta(evento.data, p))).join('')
  return createHash('sha256').update(`${valores}${evento.timestamp}${secreto}`, 'utf8').digest('hex').toUpperCase()
}

function igualesSinTiempo(a: string, b: string): boolean {
  const x = Buffer.from(a.toUpperCase(), 'utf8')
  const y = Buffer.from(b.toUpperCase(), 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Verifica un evento a partir del cuerpo CRUDO. El checksum se toma del cuerpo; si no viene, de la
 * cabecera `X-Event-Checksum`. Si vienen los dos y no coinciden, no se confía en ninguno.
 */
export function verificarEventoWompi(cuerpoCrudo: string, secreto: string, checksumCabecera?: string | null): VerificacionFirma {
  let crudo: unknown
  try {
    crudo = JSON.parse(cuerpoCrudo)
  } catch {
    return { ok: false, motivo: 'cuerpo_invalido' }
  }
  if (!esObj(crudo) || typeof crudo.event !== 'string' || !esObj(crudo.data)) return { ok: false, motivo: 'cuerpo_invalido' }
  const firma = crudo.signature
  const ts = crudo.timestamp
  if (
    !esObj(firma) ||
    !Array.isArray(firma.properties) ||
    firma.properties.length === 0 ||
    !firma.properties.every((p) => typeof p === 'string' && p.length > 0) ||
    (typeof ts !== 'number' && typeof ts !== 'string') ||
    String(ts).trim() === ''
  ) {
    return { ok: false, motivo: 'firma_ausente' }
  }
  const delCuerpo = typeof firma.checksum === 'string' ? firma.checksum.trim() : ''
  const deCabecera = checksumCabecera?.trim() ?? ''
  if (!delCuerpo && !deCabecera) return { ok: false, motivo: 'firma_ausente' }
  if (delCuerpo && deCabecera && !igualesSinTiempo(delCuerpo, deCabecera)) return { ok: false, motivo: 'firma_invalida' }

  const evento: EventoWompi = {
    event: crudo.event,
    data: crudo.data,
    environment: typeof crudo.environment === 'string' ? crudo.environment : undefined,
    signature: { properties: firma.properties as string[], checksum: delCuerpo || deCabecera },
    timestamp: ts as number | string,
    sent_at: typeof crudo.sent_at === 'string' ? crudo.sent_at : undefined,
  }
  if (!igualesSinTiempo(checksumEvento(evento, secreto), evento.signature.checksum)) return { ok: false, motivo: 'firma_invalida' }
  return { ok: true, evento }
}

// ── Lectura de la transacción ─────────────────────────────────────────────────


export interface TransaccionWompi {
  id: string
  estado: EstadoWompi
  entorno: 'prod' | 'test'
  montoCentavos: number | null
  moneda: string | null
  referencia: string | null
  metodoPago: string | null
  paymentLinkId: string | null
  /** finalized_at si viene; si no, created_at. ISO. */
  pagadoAt: string | null
  comprador: {
    nombre: string | null
    email: string | null
    telefono: string | null
    documento: string | null
  }
  envio: EnvioWompi | null
}

const texto = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/**
 * El documento del comprador. Wompi lo manda en `customer_data.legal_id` (con `legal_id_type`) cuando
 * el link pide la identificación. Los links de la torre además piden un campo propio «Cedula o NIT»
 * (`customer_references`): si el documento no vino en `legal_id`, se busca ahí. Ninguna de las dos
 * formas está en el ejemplo de la documentación de eventos: por eso se leen las dos y se tolera que
 * falten.
 */
function documentoDe(cd: Obj | null): string | null {
  if (!cd) return null
  const legal = texto(cd.legal_id)
  if (legal) {
    const tipo = texto(cd.legal_id_type)
    return tipo ? `${tipo} ${legal}` : legal
  }
  const refs = Array.isArray(cd.customer_references) ? cd.customer_references : []
  for (const r of refs) {
    if (!esObj(r)) continue
    const etiqueta = (texto(r.label) ?? '').toLowerCase()
    if (/c[eé]dula|nit|documento/.test(etiqueta)) {
      const v = texto(r.value)
      if (v) return v
    }
  }
  return null
}

function envioDe(v: unknown): EnvioWompi | null {
  if (!esObj(v)) return null
  const envio: EnvioWompi = {
    direccion: texto(v.address_line_1),
    direccion2: texto(v.address_line_2),
    ciudad: texto(v.city),
    region: texto(v.region),
    pais: texto(v.country),
    telefono: texto(v.phone_number),
    nombre: texto(v.name),
  }
  return Object.values(envio).some((x) => x !== null) ? envio : null
}

/** La transacción de un `transaction.updated`. Null si el evento no es de una transacción. */
export function leerTransaccion(evento: Pick<EventoWompi, 'event' | 'data' | 'environment'>): TransaccionWompi | null {
  if (evento.event !== 'transaction.updated') return null
  const t = evento.data.transaction
  if (!esObj(t)) return null
  const id = texto(t.id)
  const estado = texto(t.status)
  if (!id || !estado || !(ESTADOS_WOMPI as readonly string[]).includes(estado)) return null
  const centavos = typeof t.amount_in_cents === 'number' ? t.amount_in_cents : Number(t.amount_in_cents)
  const cd = esObj(t.customer_data) ? t.customer_data : null
  return {
    id,
    estado: estado as EstadoWompi,
    // Solo 'prod' cuenta como producción: cualquier otra cosa (o nada) se trata como sandbox.
    entorno: evento.environment === 'prod' ? 'prod' : 'test',
    montoCentavos: Number.isInteger(centavos) && centavos > 0 ? centavos : null,
    moneda: texto(t.currency),
    referencia: texto(t.reference),
    metodoPago: texto(t.payment_method_type),
    paymentLinkId: texto(t.payment_link_id),
    pagadoAt: texto(t.finalized_at) ?? texto(t.created_at),
    comprador: {
      nombre: texto(cd?.full_name),
      email: texto(t.customer_email),
      telefono: texto(cd?.phone_number),
      documento: documentoDe(cd),
    },
    envio: envioDe(t.shipping_address),
  }
}

/**
 * Completa lo que el evento no trajo con lo que devuelve `GET /v1/transactions/<id>` (misma forma de
 * transacción). Lo del evento manda: solo se llenan huecos.
 */
export function completarTransaccion(tx: TransaccionWompi, consultada: unknown): TransaccionWompi {
  const otra = leerTransaccion({ event: 'transaction.updated', data: { transaction: consultada }, environment: tx.entorno })
  if (!otra || otra.id !== tx.id) return tx
  return {
    ...tx,
    pagadoAt: tx.pagadoAt ?? otra.pagadoAt,
    comprador: {
      nombre: tx.comprador.nombre ?? otra.comprador.nombre,
      email: tx.comprador.email ?? otra.comprador.email,
      telefono: tx.comprador.telefono ?? otra.comprador.telefono,
      documento: tx.comprador.documento ?? otra.comprador.documento,
    },
    envio: tx.envio ?? otra.envio,
  }
}

/** Día del pago en Bogotá. Sin fecha válida, el día en que llegó el evento. */
export function fechaPagoBogota(pagadoAt: string | null, ahoraIso: string): string {
  // Wompi usa ISO ("2018-06-12T13:14:01.000Z") y, en la referencia del API, "2018-07-01 23:49:45 UTC".
  const normal = pagadoAt?.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/, '$1T$2Z') ?? null
  const d = normal ? new Date(normal) : null
  return todayBogotaISO(d && !Number.isNaN(d.getTime()) ? d : new Date(ahoraIso))
}

/** El código de publicación que trae el `sku` del link, normalizado como los códigos de ONE. */
export function codigoDesdeSku(sku: string | null | undefined): string | null {
  const t = sku?.trim().toUpperCase()
  return t ? t : null
}
