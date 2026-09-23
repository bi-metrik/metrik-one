/**
 * Pasarela `bold`: un ENLACE de pago por cuota + webhook de venta aprobada.
 *
 * Bold no tiene cobro recurrente ni tokenización (2026-09-08): el cliente abre el enlace y paga
 * cada mes. Lo que sí tiene, y es lo que usa este módulo:
 *
 *   - **API Link de pagos** (https://developers.bold.co/pagos-en-linea/api-link-de-pagos,
 *     leída el 2026-09-23): `POST https://integrations.api.bold.co/online/link/v1` con la cabecera
 *     `Authorization: x-api-key <llave de identidad>` (la llave del Botón de pagos). Monto cerrado
 *     (`amount_type: CLOSE`), `reference` alfanumérica con `_`/`-` de hasta 60, `description` de 2 a
 *     100 caracteres y `expiration_date` en NANOSEGUNDOS desde la época Unix. Responde
 *     `{ payload: { payment_link: "LNK_…", url: "https://checkout.bold.co/LNK_…" }, errors: [] }`.
 *     `GET /online/link/v1/{payment_link}` devuelve el estado (ACTIVE, PROCESSING, PAID, REJECTED,
 *     CANCELLED, EXPIRED).
 *   - **Webhook** (https://developers.bold.co/webhook): CloudEvents con `id` (UUID de la
 *     notificación), `type` (SALE_APPROVED, SALE_REJECTED, VOID_APPROVED, VOID_REJECTED), `subject`
 *     y `data.payment_id` (id de la transacción), `data.amount.total` y `data.metadata.reference`.
 *     La firma va en `x-bold-signature`: HMAC-SHA256 en hex, con la LLAVE SECRETA, sobre el cuerpo
 *     crudo codificado en BASE64 (no sobre el cuerpo tal cual). Hay que responder 200 en menos de
 *     2 s; si no, Bold reintenta 5 veces (15 min, 1 h, 4 h, 8 h, 24 h). Puede mandar varias
 *     notificaciones de la misma transacción: la idempotencia va por el id de la notificación Y por
 *     el id de la transacción.
 *
 * ⚠️ Dos puntos de la documentación que NO son consistentes y que se comprueban con la llave de
 * pruebas antes del primer enlace real:
 *   1. `expiration_date`: el texto y el ejemplo en JavaScript dicen nanosegundos
 *      (`Date.now() * 1e6`), pero los ejemplos de JSON traen 13 dígitos (milisegundos). Aquí va en
 *      nanosegundos, que es lo que dice la regla escrita.
 *   2. `metadata.reference` en el webhook de un enlace: una sección dice que llega la `reference`
 *      que se mandó al crear el enlace y otra que llega el id del enlace (`LNK_…`). El webhook de
 *      ONE acepta las dos (ver `webhook-bold.ts`).
 *
 * ⚠️ TEMPORAL: cuando MeTRIK tenga cuenta en Davivienda, todo migra a ePayco. Este archivo y la ruta
 * `/api/webhooks/bold` son lo ÚNICO que sabe de Bold; el resto habla con `PasarelaAdapter`.
 *
 * Las llaves viven solo en el servidor: `BOLD_IDENTITY_KEY` (identidad) y `BOLD_SECRET_KEY`
 * (secreta). Sin ellas nada se cae: `crearEnlaceBold` devuelve un error con el motivo y el webhook
 * responde `no_configurado`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { referenciaEnlaceCobro } from '@/lib/cobros/referencia-enlace'
import type {
  EventoPasarela,
  PasarelaAdapter,
  ResultadoCargo,
  ResultadoEnlacePago,
  SolicitudCargo,
  SolicitudEnlacePago,
  VerificacionWebhook,
} from './adapter'

export const BOLD_API_BASE = 'https://integrations.api.bold.co'

export const ENV_BOLD = {
  llaveIdentidad: 'BOLD_IDENTITY_KEY',
  llaveSecreta: 'BOLD_SECRET_KEY',
} as const

export const MOTIVO_BOLD_SIN_LLAVE =
  'Bold sin configurar: falta la llave de identidad (BOLD_IDENTITY_KEY) en el servidor. No se creó ningún enlace.'

/** Cuánto vive un enlace desde que se genera. El ciclo manual de los CDA: se manda el 20, vence el 27. */
export const DIAS_VIGENCIA_ENLACE = 7

/** Tiempo máximo de espera a la API de Bold antes de rendirse. */
const TIMEOUT_MS = 10_000

type Env = Record<string, string | undefined>

function llave(env: Env, nombre: string): string | null {
  const v = env[nombre]
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

export function boldConfigurado(env: Env = process.env): { identidad: boolean; secreta: boolean } {
  return { identidad: llave(env, ENV_BOLD.llaveIdentidad) !== null, secreta: llave(env, ENV_BOLD.llaveSecreta) !== null }
}

// ── Enlaces ─────────────────────────────────────────────────────────────────

const RE_LINK_BOLD = /^LNK_[A-Za-z0-9]+$/

/** ¿Es un id de enlace de Bold (`LNK_…`)? */
export function esIdEnlaceBold(v: string | null | undefined): v is string {
  return typeof v === 'string' && RE_LINK_BOLD.test(v.trim())
}

/**
 * El id del enlace (`LNK_…`) que aparece en una URL de Bold, sea la que devuelve la API
 * (`https://checkout.bold.co/LNK_…`) o la que se copia del panel (`…/payment/LNK_…`).
 */
export function idEnlaceDeUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  const ultimo = u.pathname.split('/').filter(Boolean).pop() ?? ''
  return RE_LINK_BOLD.test(ultimo) ? ultimo : null
}

/** Descripción del enlace: 2 a 100 caracteres, sin saltos de línea. */
export function descripcionEnlace(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  const base = limpio.length >= 2 ? limpio : 'Pago de cuota'
  return base.length <= 100 ? base : `${base.slice(0, 99).trimEnd()}…`
}

// ── Crear y consultar enlaces ────────────────────────────────────────────────


export interface DepsBold {
  fetch?: typeof fetch
  env?: Env
}

function mensajeDeErrores(cuerpo: unknown): string | null {
  const errores = (cuerpo as { errors?: unknown } | null)?.errors
  if (!Array.isArray(errores) || errores.length === 0) return null
  return errores
    .map((e) => {
      if (typeof e === 'string') return e
      const o = e as Record<string, unknown>
      return String(o?.message ?? o?.detail ?? o?.code ?? JSON.stringify(e))
    })
    .join('; ')
}

export async function crearEnlaceBold(
  s: Omit<SolicitudEnlacePago, 'cobroId'>,
  deps: DepsBold = {},
): Promise<ResultadoEnlacePago> {
  const env = deps.env ?? process.env
  const identidad = llave(env, ENV_BOLD.llaveIdentidad)
  if (!identidad) return { ok: false, error: MOTIVO_BOLD_SIN_LLAVE, reintentable: false }

  if (!Number.isInteger(s.monto) || s.monto <= 0) {
    return { ok: false, error: `Monto inválido para Bold: ${s.monto} (tiene que ser un entero positivo en pesos).`, reintentable: false }
  }
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(s.referencia)) {
    return { ok: false, error: `Referencia inválida para Bold: ${s.referencia}`, reintentable: false }
  }

  const cuerpo = {
    amount_type: 'CLOSE',
    amount: { currency: 'COP', total_amount: s.monto, tip_amount: 0 },
    reference: s.referencia,
    description: descripcionEnlace(s.descripcion),
    // Nanosegundos (ver la nota ⚠️ 1 del encabezado). Pasa de 2^53, pero el redondeo de un double
    // en ese rango es de cientos de nanosegundos: irrelevante para una fecha de vencimiento.
    expiration_date: Math.trunc(s.expiraMs) * 1_000_000,
  }

  const f = deps.fetch ?? fetch
  let res: Response
  try {
    res = await f(`${BOLD_API_BASE}/online/link/v1`, {
      method: 'POST',
      headers: { Authorization: `x-api-key ${identidad}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: `No se pudo hablar con Bold: ${(e as Error).message}`, reintentable: true }
  }

  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  const errores = mensajeDeErrores(json)
  if (!res.ok || errores) {
    return {
      ok: false,
      error: `Bold rechazó el enlace (HTTP ${res.status})${errores ? `: ${errores}` : ''}`,
      // 5xx y 429 son de Bold; un 4xx es de lo que mandamos (o de la llave) y repetirlo no sirve.
      reintentable: res.status >= 500 || res.status === 429,
    }
  }

  const payload = (json as { payload?: { payment_link?: unknown; url?: unknown } } | null)?.payload
  const idEnlace = typeof payload?.payment_link === 'string' ? payload.payment_link : ''
  const url = typeof payload?.url === 'string' ? payload.url : ''
  if (!esIdEnlaceBold(idEnlace) || !/^https:\/\/\S+$/.test(url) || url.length > 500) {
    return { ok: false, error: 'Bold respondió sin un enlace utilizable.', reintentable: false }
  }
  return { ok: true, idEnlace, url, expira: new Date(s.expiraMs).toISOString() }
}

export type EstadoEnlaceBold = 'ACTIVE' | 'PROCESSING' | 'PAID' | 'REJECTED' | 'CANCELLED' | 'EXPIRED'

export async function consultarEnlaceBold(
  idEnlace: string,
  deps: DepsBold = {},
): Promise<{ ok: true; estado: string; transaccionId: string | null; total: number | null } | { ok: false; error: string; reintentable: boolean }> {
  const env = deps.env ?? process.env
  const identidad = llave(env, ENV_BOLD.llaveIdentidad)
  if (!identidad) return { ok: false, error: MOTIVO_BOLD_SIN_LLAVE, reintentable: false }
  if (!esIdEnlaceBold(idEnlace)) return { ok: false, error: `No es un enlace de Bold: ${idEnlace}`, reintentable: false }

  const f = deps.fetch ?? fetch
  try {
    const res = await f(`${BOLD_API_BASE}/online/link/v1/${encodeURIComponent(idEnlace)}`, {
      headers: { Authorization: `x-api-key ${identidad}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok || !json) {
      return { ok: false, error: `Bold no devolvió el enlace (HTTP ${res.status})`, reintentable: res.status >= 500 || res.status === 429 }
    }
    // La doc muestra la respuesta suelta; otras respuestas de la misma API vienen en `payload`.
    const d = (json.payload && typeof json.payload === 'object' ? json.payload : json) as Record<string, unknown>
    return {
      ok: true,
      estado: String(d.status ?? ''),
      transaccionId: typeof d.transaction_id === 'string' ? d.transaction_id : null,
      total: typeof d.total === 'number' ? d.total : null,
    }
  } catch (e) {
    return { ok: false, error: `No se pudo hablar con Bold: ${(e as Error).message}`, reintentable: true }
  }
}

// ── Webhook ──────────────────────────────────────────────────────────────────

/** Firma que Bold pone en `x-bold-signature`: hex(HMAC-SHA256(llave secreta, base64(cuerpo crudo))). */
export function firmaBold(cuerpoCrudo: string, llaveSecreta: string): string {
  const base64 = Buffer.from(cuerpoCrudo, 'utf8').toString('base64')
  return createHmac('sha256', llaveSecreta).update(base64).digest('hex')
}

/** Comparación en tiempo constante. Largo distinto = firma inválida, sin comparar. */
export function firmaBoldValida(cuerpoCrudo: string, recibida: string | null | undefined, llaveSecreta: string): boolean {
  if (!recibida) return false
  const esperada = Buffer.from(firmaBold(cuerpoCrudo, llaveSecreta), 'utf8')
  const dada = Buffer.from(recibida.trim().toLowerCase(), 'utf8')
  if (esperada.length !== dada.length) return false
  return timingSafeEqual(esperada, dada)
}

const TIPOS: Record<string, EventoPasarela['tipo']> = {
  SALE_APPROVED: 'aprobado',
  SALE_REJECTED: 'rechazado',
  VOID_APPROVED: 'anulado',
}

/** Normaliza el cuerpo YA verificado. `null` si le falta lo mínimo (id, tipo, transacción). */
export function parsearEventoBold(cuerpoCrudo: string): EventoPasarela | null {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(cuerpoCrudo) as Record<string, unknown>
  } catch {
    return null
  }
  if (!j || typeof j !== 'object') return null
  const data = (j.data && typeof j.data === 'object' ? j.data : {}) as Record<string, unknown>
  const amount = (data.amount && typeof data.amount === 'object' ? data.amount : {}) as Record<string, unknown>
  const metadata = (data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) as Record<string, unknown>

  const eventoId = typeof j.id === 'string' ? j.id.trim() : ''
  const tipoBold = typeof j.type === 'string' ? j.type.trim() : ''
  const transaccionId =
    typeof data.payment_id === 'string' && data.payment_id.trim()
      ? data.payment_id.trim()
      : typeof j.subject === 'string'
        ? j.subject.trim()
        : ''
  if (!eventoId || !tipoBold || !transaccionId) return null

  const total = typeof amount.total === 'number' && Number.isFinite(amount.total) ? amount.total : null
  const referencia = typeof metadata.reference === 'string' && metadata.reference.trim() ? metadata.reference.trim() : null
  const ocurridoAt = typeof data.created_at === 'string' ? data.created_at : null

  return {
    eventoId,
    tipoOriginal: tipoBold,
    tipo: TIPOS[tipoBold] ?? 'otro',
    transaccionId,
    // Misma forma con la que se registró a mano el pago de 4D SOFT (`bold-TXRRP7Q95ZJ`).
    referenciaPago: `bold-${transaccionId}`,
    referencia,
    // La doc dice que en un enlace la referencia puede llegar como el id del enlace (LNK_…).
    idEnlace: esIdEnlaceBold(referencia) ? referencia : null,
    monto: total,
    moneda: typeof amount.currency === 'string' ? amount.currency : null,
    ocurridoAt,
    crudo: j,
  }
}

export function verificarWebhookBold(
  cuerpoCrudo: string,
  cabeceras: Record<string, string | undefined>,
  env: Env = process.env,
): VerificacionWebhook {
  const secreta = llave(env, ENV_BOLD.llaveSecreta)
  if (!secreta) return { ok: false, motivo: 'no_configurado' }
  const firma = cabeceras['x-bold-signature']
  if (!firma) return { ok: false, motivo: 'sin_firma' }
  if (!firmaBoldValida(cuerpoCrudo, firma, secreta)) return { ok: false, motivo: 'firma_invalida' }
  const evento = parsearEventoBold(cuerpoCrudo)
  if (!evento) return { ok: false, motivo: 'cuerpo_invalido' }
  return { ok: true, evento }
}

// ── El adaptador del ciclo de suscripciones ──────────────────────────────────

/**
 * Para el ciclo de suscripciones, «cobrar» con Bold es dejar un enlace: el resultado es siempre
 * `pendiente` con `linkPago` y `expira`, y el ciclo lo anota en el cobro de la cuota
 * (`anotarIntentoEnCobro`). La plata la registra el webhook, no el ciclo: `consultar` nunca devuelve
 * `aprobado`, porque la consulta del enlace no trae la fecha del pago y el ciclo la necesita.
 */
export const pasarelaBold: PasarelaAdapter = {
  nombre: 'bold',
  capacidades: { cobroSinClic: false, tokenizacion: false, linkDePago: true, webhook: true },

  async cobrar(s: SolicitudCargo): Promise<ResultadoCargo> {
    const ahora = Date.now()
    const r = await crearEnlaceBold({
      monto: Math.round(s.monto),
      descripcion: s.descripcion,
      referencia: referenciaEnlaceCobro(s.cobroId, ahora),
      expiraMs: ahora + DIAS_VIGENCIA_ENLACE * 86_400_000,
    })
    if (!r.ok) return { estado: 'error', mensaje: r.error, reintentable: r.reintentable }
    return { estado: 'pendiente', externalRef: r.idEnlace, linkPago: r.url, expira: r.expira, detalle: 'Enlace de Bold enviado: el pago lo registra el webhook.' }
  },

  async consultar(externalRef: string): Promise<ResultadoCargo> {
    const r = await consultarEnlaceBold(externalRef)
    if (!r.ok) return { estado: 'error', mensaje: r.error, reintentable: r.reintentable }
    if (r.estado === 'REJECTED') {
      return { estado: 'rechazado', externalRef, codigo: 'REJECTED', mensaje: 'Bold rechazó el pago del enlace.', reintentable: true }
    }
    return { estado: 'pendiente', externalRef, detalle: `Enlace ${r.estado || 'sin estado'}: el pago lo registra el webhook.` }
  },

  verificarWebhook(cuerpoCrudo, cabeceras) {
    return verificarWebhookBold(cuerpoCrudo, cabeceras)
  },

  faltaConfiguracion() {
    return boldConfigurado().identidad ? null : MOTIVO_BOLD_SIN_LLAVE
  },

  crearEnlacePago(s: SolicitudEnlacePago) {
    return crearEnlaceBold(s)
  },

  idEnlaceDeUrl(url) {
    return idEnlaceDeUrl(url)
  },
}
