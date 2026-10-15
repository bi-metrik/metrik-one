/**
 * Pasarela `epayco`: un LINK DE COBRO por cuota + su URL de confirmación. Reemplaza a Bold
 * (decisión `2026-09-22_epayco-davivienda-reemplaza-wompi-bancolombia`): mismo contrato
 * (`PasarelaAdapter`), así que cambiar un plan de Bold a ePayco es cambiar `planes_cobro.pasarela`.
 *
 * Lo que usa de ePayco (documentación oficial leída el 2026-10-14: colección «ApiFy ePayco
 * Producción» de https://api.epayco.co y https://docs.epayco.com/docs/url-de-confirmacion.md):
 *
 *   - **Login** `POST https://apify.epayco.co/login` con `Authorization: Basic base64(PUBLIC_KEY:
 *     PRIVATE_KEY)`. Devuelve `{ token }`, un JWT que vive 20 minutos.
 *   - **Crear link de cobro** `POST /collection/link/create` con `Authorization: Bearer <token>`.
 *     Obligatorios: `quantity`, `onePayment`, `amount` (sin impuesto), `currency`, `id` (0 = lo asigna
 *     ePayco), `title`, `description`, `typeSell` (2 = link). Opcionales que se usan: `tax` (0: la
 *     suscripción va sin IVA, art. 476 num. 21 E.T.), `urlConfirmation`, `methodConfirmation` y
 *     `expirationDate`. Responde `{ success, data: { id, routeLink: "https://payco.link/<id>" } }`.
 *     `reference` es un ENTERO de 11 dígitos: no cabe la referencia de ONE (`ONE-<cobro>-<ms>`), así
 *     que viaja en la URL de confirmación del link (`?ref=…`).
 *   - **Confirmación**: ePayco llama a la `urlConfirmation` del link (POST, form) con `x_ref_payco`,
 *     `x_transaction_id`, `x_amount`, `x_currency_code`, `x_cod_transaction_state`,
 *     `x_transaction_date`, `x_test_request` y `x_signature`, donde
 *     `x_signature = sha256(P_CUST_ID_CLIENTE^P_KEY^x_ref_payco^x_transaction_id^x_amount^x_currency_code)`.
 *     Estados: 1 aceptada, 2 rechazada, 3 pendiente, 4 fallida, 6 reversada, 7 retenida, 8 iniciada,
 *     9 caducada, 10 abandonada, 11 cancelada. Una misma transacción confirma varias veces (pendiente
 *     y después aceptada): la notificación es transacción + estado.
 *
 * ⚠️ Lo que la documentación NO deja claro y se comprueba con el primer link real, antes de pasar a
 * ePayco un plan de cliente:
 *   1. El formato de `expirationDate` («Format DateTime UTC», sin ejemplo). Va `YYYY-MM-DD HH:mm:ss`
 *      en UTC. Si ePayco lo rechaza, el link no se crea y el error queda escrito: nada se cobra mal.
 *   2. Que ePayco conserve la consulta (`?ref=…`) de la `urlConfirmation` al llamarla. Si no la
 *      conserva, la confirmación llega sin referencia y queda `sin_cobro` en `pasarela_eventos`
 *      (visible, sin registrar nada): habría que volver al cobro por `x_id_invoice` o por el link.
 *
 * La firma solo cubre transacción, monto y moneda: la `ref` de la URL no va firmada. Por eso el link
 * NO lleva `urlResponse`: sin ella, los datos firmados no pasan por el navegador del pagador y solo
 * ePayco los manda, de servidor a servidor.
 *
 * Las llaves son las del comercio ePayco de METRIK IA S.A.S., NO las `EPAYCO_PUBLIC_KEY` /
 * `EPAYCO_PRIVATE_KEY` que ya existen (esas son de SOENA y sirven para consultar sus transacciones,
 * `src/lib/epayco.ts`). Sin ellas nada se cae: el link devuelve el motivo y la confirmación responde
 * `no_configurado`.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { fechaTransaccionBogota } from '@/lib/epayco/fecha-transaccion'
import { referenciaEnlaceCobro } from '@/lib/cobros/referencia-enlace'
import { DIAS_VIGENCIA_ENLACE, descripcionEnlace } from './bold'
import type {
  EventoPasarela,
  PasarelaAdapter,
  ResultadoCargo,
  ResultadoEnlacePago,
  SolicitudCargo,
  SolicitudEnlacePago,
  VerificacionWebhook,
} from './adapter'

export const EPAYCO_APIFY_BASE = 'https://apify.epayco.co'

export const ENV_EPAYCO = {
  // Los nombres con que Mauricio las cargó en Vercel (metrik-one) el 2026-10-12.
  llavePublica: 'EPAYCO_PUBLIC_KEY_METRIK',
  llavePrivada: 'EPAYCO_PRIVATE_KEY_METRIK',
  idCliente: 'EPAYCO_P_CUST_ID_CLIENTE',
  pKey: 'EPAYCO_P_KEY',
} as const

export const MOTIVO_EPAYCO_SIN_LLAVE =
  'ePayco sin configurar: faltan las llaves del comercio de MeTRIK (EPAYCO_PUBLIC_KEY_METRIK y EPAYCO_PRIVATE_KEY_METRIK) en el servidor. No se creó ningún link.'

/** Adonde ePayco confirma los pagos de los links de ONE. */
export const RUTA_CONFIRMACION_EPAYCO = '/api/webhooks/epayco'

const TIMEOUT_MS = 10_000

type Env = Record<string, string | undefined>

function llave(env: Env, nombre: string): string | null {
  const v = env[nombre]
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

export function epaycoConfigurado(env: Env = process.env): { enlaces: boolean; confirmacion: boolean } {
  return {
    enlaces: llave(env, ENV_EPAYCO.llavePublica) !== null && llave(env, ENV_EPAYCO.llavePrivada) !== null,
    confirmacion: llave(env, ENV_EPAYCO.idCliente) !== null && llave(env, ENV_EPAYCO.pKey) !== null,
  }
}

/** `https://metrikone.co/api/webhooks/epayco?ref=<referencia de ONE>`. */
export function urlConfirmacionEpayco(referencia: string, env: Env = process.env): string {
  const dominio = (env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${dominio}${RUTA_CONFIRMACION_EPAYCO}?ref=${encodeURIComponent(referencia)}`
}

// ── Links ───────────────────────────────────────────────────────────────────

const RE_LINK_EPAYCO = /^\d{1,15}$/

/** El id del link (`https://payco.link/<id>`) dentro de una URL de link de ePayco. */
export function idEnlaceEpaycoDeUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return null
  }
  if (u.hostname !== 'payco.link') return null
  const ultimo = u.pathname.split('/').filter(Boolean).pop() ?? ''
  return RE_LINK_EPAYCO.test(ultimo) ? ultimo : null
}

/** `YYYY-MM-DD HH:mm:ss` en UTC (ver la nota ⚠️ 1 del encabezado). */
export function fechaExpiracionEpayco(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
}

export interface DepsEpayco {
  fetch?: typeof fetch
  env?: Env
}

function mensajeDeErrores(cuerpo: unknown): string | null {
  const o = (cuerpo ?? {}) as Record<string, unknown>
  const data = (o.data && typeof o.data === 'object' ? o.data : {}) as Record<string, unknown>
  const errores = data.errors ?? data.errores
  if (Array.isArray(errores) && errores.length > 0) {
    return errores
      .map((e) => (typeof e === 'string' ? e : String((e as Record<string, unknown>)?.errorMessage ?? JSON.stringify(e))))
      .join('; ')
  }
  const texto = o.textResponse ?? o.text_response
  return typeof texto === 'string' && texto.trim() ? texto.trim() : null
}

async function tokenApify(
  publica: string,
  privada: string,
  f: typeof fetch,
): Promise<{ ok: true; token: string } | { ok: false; error: string; reintentable: boolean }> {
  let res: Response
  try {
    res = await f(`${EPAYCO_APIFY_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${publica}:${privada}`).toString('base64')}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: `No se pudo hablar con ePayco: ${(e as Error).message}`, reintentable: true }
  }
  const json = (await res.json().catch(() => null)) as { token?: unknown; error?: unknown } | null
  if (!res.ok || typeof json?.token !== 'string' || !json.token) {
    const motivo = typeof json?.error === 'string' ? `: ${json.error}` : ''
    return { ok: false, error: `ePayco rechazó el ingreso con las llaves de MeTRIK (HTTP ${res.status})${motivo}`, reintentable: res.status >= 500 || res.status === 429 }
  }
  return { ok: true, token: json.token }
}

export async function crearEnlaceEpayco(
  s: Omit<SolicitudEnlacePago, 'cobroId'>,
  deps: DepsEpayco = {},
): Promise<ResultadoEnlacePago> {
  const env = deps.env ?? process.env
  const publica = llave(env, ENV_EPAYCO.llavePublica)
  const privada = llave(env, ENV_EPAYCO.llavePrivada)
  if (!publica || !privada) return { ok: false, error: MOTIVO_EPAYCO_SIN_LLAVE, reintentable: false }

  if (!Number.isInteger(s.monto) || s.monto <= 0) {
    return { ok: false, error: `Monto inválido para ePayco: ${s.monto} (tiene que ser un entero positivo en pesos).`, reintentable: false }
  }
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(s.referencia)) {
    return { ok: false, error: `Referencia inválida para ePayco: ${s.referencia}`, reintentable: false }
  }

  const f = deps.fetch ?? fetch
  const login = await tokenApify(publica, privada, f)
  if (!login.ok) return login

  const texto = descripcionEnlace(s.descripcion)
  const cuerpo = {
    quantity: 1,
    onePayment: true,
    amount: String(s.monto),
    currency: 'COP',
    id: 0,
    title: texto,
    description: texto,
    typeSell: '2',
    tax: '0',
    urlConfirmation: urlConfirmacionEpayco(s.referencia, env),
    methodConfirmation: 'POST',
    expirationDate: fechaExpiracionEpayco(s.expiraMs),
  }

  let res: Response
  try {
    res = await f(`${EPAYCO_APIFY_BASE}/collection/link/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch (e) {
    return { ok: false, error: `No se pudo hablar con ePayco: ${(e as Error).message}`, reintentable: true }
  }
  const json = (await res.json().catch(() => null)) as { success?: unknown; data?: Record<string, unknown> } | null
  if (!res.ok || json?.success !== true) {
    const errores = mensajeDeErrores(json)
    return {
      ok: false,
      error: `ePayco rechazó el link (HTTP ${res.status})${errores ? `: ${errores}` : ''}`,
      reintentable: res.status >= 500 || res.status === 429,
    }
  }
  const url = typeof json.data?.routeLink === 'string' ? json.data.routeLink.trim() : ''
  const idEnlace = idEnlaceEpaycoDeUrl(url)
  if (!idEnlace || url.length > 500) {
    return { ok: false, error: 'ePayco respondió sin un link utilizable.', reintentable: false }
  }
  return { ok: true, idEnlace, url, expira: new Date(s.expiraMs).toISOString() }
}

// ── Confirmación ─────────────────────────────────────────────────────────────

/**
 * Lo que llega a la URL de confirmación, en una sola cadena `x-www-form-urlencoded`: los campos del
 * cuerpo (form o JSON) y los de la consulta (`ref`). Es lo que la ruta le pasa al adaptador como
 * «cuerpo crudo», y lo que queda en `pasarela_eventos`.
 */
export function cuerpoConfirmacionEpayco(cuerpo: string, tipoContenido: string | null, consulta: URLSearchParams): string {
  const todo = new URLSearchParams()
  const texto = cuerpo.trim()
  if (texto) {
    if ((tipoContenido ?? '').includes('json') || texto.startsWith('{')) {
      try {
        const j = JSON.parse(texto) as Record<string, unknown>
        for (const [k, v] of Object.entries(j ?? {})) if (v !== null && v !== undefined) todo.set(k, String(v))
      } catch {
        // Cuerpo ilegible: se queda sin esos campos y la verificación lo rechaza por firma.
      }
    } else {
      for (const [k, v] of new URLSearchParams(texto)) todo.set(k, v)
    }
  }
  // La consulta la puso ONE al crear el link; si ePayco manda un campo del mismo nombre, gana el suyo.
  for (const [k, v] of consulta) if (!todo.has(k)) todo.set(k, v)
  return todo.toString()
}

export function firmaEpayco(p: { idCliente: string; pKey: string; refPayco: string; transaccionId: string; monto: string; moneda: string }): string {
  return createHash('sha256')
    .update([p.idCliente, p.pKey, p.refPayco, p.transaccionId, p.monto, p.moneda].join('^'))
    .digest('hex')
}

function igualesEnTiempoConstante(a: string, b: string): boolean {
  const x = Buffer.from(a.trim().toLowerCase(), 'utf8')
  const y = Buffer.from(b.trim().toLowerCase(), 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

const ESTADOS: Record<string, EventoPasarela['tipo']> = {
  '1': 'aprobado',
  '2': 'rechazado',
  '4': 'rechazado',
  '9': 'rechazado',
  '10': 'rechazado',
  '11': 'rechazado',
  '6': 'anulado',
}

/** Normaliza la confirmación YA verificada. `null` si le falta lo mínimo (recibo y estado). */
export function parsearConfirmacionEpayco(cuerpoCrudo: string): EventoPasarela | null {
  const p = new URLSearchParams(cuerpoCrudo)
  const campo = (k: string) => (p.get(k) ?? '').trim()
  const refPayco = campo('x_ref_payco')
  const estado = campo('x_cod_transaction_state') || campo('x_cod_response')
  if (!/^\d+$/.test(refPayco) || !/^\d+$/.test(estado)) return null

  const prueba = campo('x_test_request').toUpperCase() === 'TRUE'
  const monto = Number(campo('x_amount'))
  const fecha = fechaTransaccionBogota(campo('x_transaction_date') || campo('x_fecha_transaccion'))
  const referencia = campo('ref') || null

  return {
    // Una confirmación por transacción Y estado: «pendiente» y luego «aceptada» son dos notificaciones.
    eventoId: `${refPayco}-${estado}`,
    tipoOriginal: `${estado} ${campo('x_transaction_state') || campo('x_response')}`.trim() + (prueba ? ' (prueba)' : ''),
    // Una transacción de prueba nunca paga una cuota real: queda en la bandeja y nada más.
    tipo: prueba ? 'otro' : (ESTADOS[estado] ?? 'otro'),
    transaccionId: refPayco,
    referenciaPago: `epayco-${refPayco}`,
    referencia,
    idEnlace: null,
    monto: Number.isFinite(monto) && campo('x_amount') !== '' ? monto : null,
    moneda: campo('x_currency_code') || null,
    ocurridoAt: fecha ? `${fecha}T12:00:00-05:00` : null,
    crudo: Object.fromEntries([...p.entries()].filter(([k]) => k !== 'x_signature')),
  }
}

export function verificarConfirmacionEpayco(cuerpoCrudo: string, env: Env = process.env): VerificacionWebhook {
  const idCliente = llave(env, ENV_EPAYCO.idCliente)
  const pKey = llave(env, ENV_EPAYCO.pKey)
  if (!idCliente || !pKey) return { ok: false, motivo: 'no_configurado' }
  const p = new URLSearchParams(cuerpoCrudo)
  const firma = p.get('x_signature')
  if (!firma) return { ok: false, motivo: 'sin_firma' }
  const esperada = firmaEpayco({
    idCliente,
    pKey,
    refPayco: p.get('x_ref_payco') ?? '',
    transaccionId: p.get('x_transaction_id') ?? '',
    monto: p.get('x_amount') ?? '',
    moneda: p.get('x_currency_code') ?? '',
  })
  if (!igualesEnTiempoConstante(esperada, firma)) return { ok: false, motivo: 'firma_invalida' }
  const evento = parsearConfirmacionEpayco(cuerpoCrudo)
  if (!evento) return { ok: false, motivo: 'cuerpo_invalido' }
  return { ok: true, evento }
}

// ── El adaptador ────────────────────────────────────────────────────────────

/**
 * Igual que Bold: «cobrar» es dejar un link (`pendiente` con `linkPago`), y la plata la registra la
 * confirmación, no el ciclo. El cargo por token sin clic (`epayco-token`) es otra fase.
 */
export const pasarelaEpayco: PasarelaAdapter = {
  nombre: 'epayco',
  capacidades: { cobroSinClic: false, tokenizacion: false, linkDePago: true, webhook: true },

  async cobrar(s: SolicitudCargo): Promise<ResultadoCargo> {
    const ahora = Date.now()
    const r = await crearEnlaceEpayco({
      monto: Math.round(s.monto),
      descripcion: s.descripcion,
      referencia: referenciaEnlaceCobro(s.cobroId, ahora),
      expiraMs: ahora + DIAS_VIGENCIA_ENLACE * 86_400_000,
    })
    if (!r.ok) return { estado: 'error', mensaje: r.error, reintentable: r.reintentable }
    return { estado: 'pendiente', externalRef: r.idEnlace, linkPago: r.url, expira: r.expira, detalle: 'Link de ePayco enviado: el pago lo registra la confirmación.' }
  },

  async consultar(externalRef: string): Promise<ResultadoCargo> {
    return { estado: 'pendiente', externalRef, detalle: 'Link de ePayco: el pago lo registra la confirmación.' }
  },

  verificarWebhook(cuerpoCrudo) {
    return verificarConfirmacionEpayco(cuerpoCrudo)
  },

  faltaConfiguracion() {
    return epaycoConfigurado().enlaces ? null : MOTIVO_EPAYCO_SIN_LLAVE
  },

  crearEnlacePago(s: SolicitudEnlacePago) {
    return crearEnlaceEpayco(s)
  },

  idEnlaceDeUrl(url) {
    return idEnlaceEpaycoDeUrl(url)
  },
}
