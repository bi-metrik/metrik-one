/**
 * Pasarela `epayco`, con DOS formas de cobrar una cuota (mismo comercio, mismas llaves, misma
 * confirmación):
 *
 *   1. **Tarjeta tokenizada** (Valida autogestionada, PR #1191): cobro iniciado por el comercio, sin
 *      clic del cliente. Se usa cuando la solicitud trae `medioPago.token_ref` de ePayco. Va APAGADA
 *      salvo `EPAYCO_HABILITADO=1` y en modo prueba salvo `EPAYCO_PRODUCCION=1` (abajo).
 *   2. **Link de cobro por cuota** (#1182, #1184): `crearEnlacePago` y `cobrar` sin token dejan un
 *      `https://payco.link/<id>`; la plata la registra la confirmación. Solo pide las llaves; no
 *      depende de `EPAYCO_HABILITADO`. Ver la sección «Links».
 *
 * Las dos confirman en `/api/webhooks/epayco?ref=<referencia de ONE>` (`urlConfirmacionEpayco`). El
 * cargo con token manda además la referencia como `invoice`, que vuelve como `x_id_invoice`: si
 * ePayco no conservara la consulta, el cobro se encuentra igual.
 *
 * Decisiones 7 e I (`2026-09-22_epayco-davivienda-reemplaza-wompi-bancolombia`): ePayco con la cuenta
 * Davivienda de MeTRIK reemplaza a Wompi y, con el tiempo, a Bold. Hoy NO hay llaves ni cuenta: todo
 * esto está APAGADO (`EPAYCO_HABILITADO`) y en MODO PRUEBA salvo que se diga lo contrario.
 *
 * ## Lo que se usa de ePayco (documentación oficial, leída el 2026-10-12)
 *
 *   - **Tokenización en el NAVEGADOR** con ePayco.js (`https://checkout.epayco.co/epayco.min.js`,
 *     https://docs.epayco.com/docs/tokenizacion-de-clientes): el número de la tarjeta, la fecha y el
 *     CVC van del navegador a ePayco y vuelven como un token. A ONE solo llega el token: ONE nunca ve,
 *     guarda ni registra un número de tarjeta.
 *   - **APIFY** (https://api.epayco.co, colección Postman oficial), base `https://apify.epayco.co`:
 *       · `POST /login` con autenticación Basic `base64(PUBLIC_KEY:PRIVATE_KEY)` → `{ token }` (JWT);
 *       · `POST /token/customer` (Bearer) con `docType, docNumber, name, lastName, email, cellPhone,
 *         phone, requireCardToken, cardTokenId` → `data.data.customerId`;
 *       · `POST /payment/process` (Bearer) con `value, docType, docNumber, name, lastName, email,
 *         cellPhone, phone, address, cardTokenId, customerId, dues, currency, invoice, description,
 *         urlConfirmation, methodConfirmation, testMode` → `data.transaction.data` con `ref_payco`,
 *         `estado` (Aceptada | Rechazada | Pendiente | Fallida) y `cod_respuesta`;
 *       · `POST /payment/transaction` con `referencePayco` → el estado de una transacción.
 *   - **Confirmación** (https://docs.epayco.com/docs/url-de-confirmacion y
 *     .../checkout-respuesta-y-confirmacion): ePayco llama `urlConfirmation` con los campos `x_*`. La
 *     firma es `sha256(P_CUST_ID_CLIENTE^P_KEY^x_ref_payco^x_transaction_id^x_amount^x_currency_code)`
 *     en `x_signature`. Estados (`x_cod_transaction_state`): 1 aceptada, 2 rechazada, 3 pendiente,
 *     4 fallida, 6 reversada, 7 retenida, 8 iniciada, 9 caducada, 10 abandonada, 11 cancelada.
 *
 * ## Modo prueba, y por qué no cobra en producción
 *
 * Sin `EPAYCO_PRODUCCION=1` todo va con `testMode: true`. Y en modo prueba el adaptador NO opera en el
 * despliegue de producción (`VERCEL_ENV=production`): una tarjeta de prueba aprobada registraría como
 * pagada la cuota real de un cliente y le abriría el servicio. En un preview sí, para probar el
 * recorrido entero. Por la misma razón, un evento de prueba (`x_test_request=TRUE`) nunca registra un
 * pago fuera de modo prueba.
 *
 * ## Variables (solo servidor)
 *
 *   EPAYCO_HABILITADO=1          enciende la pasarela (sin esto, `adapterPara('epayco')` es null)
 *   EPAYCO_PUBLIC_KEY_METRIK     llave pública de METRIK IA S.A.S. (también la usa ePayco.js en el navegador)
 *   EPAYCO_PRIVATE_KEY_METRIK    llave privada de METRIK IA S.A.S.
 *   EPAYCO_P_CUST_ID_CLIENTE     P_CUST_ID_CLIENTE, para verificar la firma de la confirmación
 *   EPAYCO_P_KEY                 P_KEY, para verificar la firma de la confirmación
 *   EPAYCO_PRODUCCION=1          cobros reales (sin esto: modo prueba)
 *   EPAYCO_API_BASE              opcional; por defecto https://apify.epayco.co
 *   EPAYCO_URL_CONFIRMACION      opcional; por defecto https://<NEXT_PUBLIC_BASE_DOMAIN>/api/webhooks/epayco (+ ?ref=)
 *
 * ⚠️ `EPAYCO_PUBLIC_KEY` / `EPAYCO_PRIVATE_KEY` (sin sufijo) son las llaves de OTRA cuenta de ePayco
 * (conciliación de un cliente: `src/lib/epayco.ts` y scripts). Este adaptador NO las lee nunca: con
 * ellas cobraría a los clientes de Valida en la cuenta equivocada.
 *
 * ⚠️ Sin verificar contra una cuenta real (no hay llaves): la forma exacta de las respuestas sale de
 * los ejemplos de la colección oficial. Antes del primer cobro real se corre el recorrido en preview
 * con las tarjetas de prueba (https://docs.epayco.com/docs/medios-de-pruebas-1).
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

type Env = Record<string, string | undefined>

export const EPAYCO_API_BASE_POR_DEFECTO = 'https://apify.epayco.co'
/** El script oficial de tokenización. Pide jQuery (usa `$.ajax`): la pantalla lo carga antes. */
export const EPAYCO_JS = 'https://checkout.epayco.co/epayco.min.js'
const TIMEOUT_MS = 15_000

function valor(env: Env, nombre: string): string | null {
  const v = env[nombre]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
const llave = valor

export const EPAYCO_APIFY_BASE = EPAYCO_API_BASE_POR_DEFECTO

export const ENV_EPAYCO = {
  // Los nombres con que Mauricio las cargó en Vercel (metrik-one) el 2026-10-12.
  llavePublica: 'EPAYCO_PUBLIC_KEY_METRIK',
  llavePrivada: 'EPAYCO_PRIVATE_KEY_METRIK',
  idCliente: 'EPAYCO_P_CUST_ID_CLIENTE',
  pKey: 'EPAYCO_P_KEY',
} as const

export const MOTIVO_EPAYCO_SIN_LLAVE =
  'ePayco sin configurar: faltan las llaves del comercio de MeTRIK (EPAYCO_PUBLIC_KEY_METRIK y EPAYCO_PRIVATE_KEY_METRIK) en el servidor. No se creó ningún link.'

/** Adonde ePayco confirma los pagos de ONE (links y cargos con token). */
export const RUTA_CONFIRMACION_EPAYCO = '/api/webhooks/epayco'

export function epaycoConfigurado(env: Env = process.env): { enlaces: boolean; confirmacion: boolean } {
  return {
    enlaces: llave(env, ENV_EPAYCO.llavePublica) !== null && llave(env, ENV_EPAYCO.llavePrivada) !== null,
    confirmacion: llave(env, ENV_EPAYCO.idCliente) !== null && llave(env, ENV_EPAYCO.pKey) !== null,
  }
}

/**
 * `https://metrikone.co/api/webhooks/epayco?ref=<referencia de ONE>`. La base es
 * `EPAYCO_URL_CONFIRMACION` si existe (un preview que quiere recibir sus propias confirmaciones) o
 * el dominio del despliegue (`NEXT_PUBLIC_BASE_DOMAIN`, `metrikone.co` en producción).
 */
export function urlConfirmacionEpayco(referencia: string, env: Env = process.env): string {
  const base =
    valor(env, 'EPAYCO_URL_CONFIRMACION') ?? `https://${(env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()}${RUTA_CONFIRMACION_EPAYCO}`
  return `${base}${base.includes('?') ? '&' : '?'}ref=${encodeURIComponent(referencia)}`
}

export function epaycoHabilitado(env: Env = process.env): boolean {
  return env.EPAYCO_HABILITADO === '1'
}

export function epaycoEnPruebas(env: Env = process.env): boolean {
  return env.EPAYCO_PRODUCCION !== '1'
}

/** La llave pública, para ePayco.js. No es secreta, pero sale del servidor (no es `NEXT_PUBLIC_`). */
export function llavePublicaEpayco(env: Env = process.env): string | null {
  return valor(env, 'EPAYCO_PUBLIC_KEY_METRIK')
}

/** Por qué ePayco no puede cobrar ahora, o `null`. */
export function faltaConfiguracionEpayco(env: Env = process.env): string | null {
  if (!epaycoHabilitado(env)) return 'ePayco está apagado (EPAYCO_HABILITADO). No se cobró nada.'
  if (!valor(env, 'EPAYCO_PUBLIC_KEY_METRIK') || !valor(env, 'EPAYCO_PRIVATE_KEY_METRIK')) {
    return 'ePayco sin configurar: faltan EPAYCO_PUBLIC_KEY_METRIK o EPAYCO_PRIVATE_KEY_METRIK. No se cobró nada.'
  }
  if (epaycoEnPruebas(env) && env.VERCEL_ENV === 'production') {
    return 'ePayco está en modo prueba y este es el despliegue de producción: no se cobra con tarjetas de prueba sobre cuotas reales.'
  }
  return null
}

export interface DepsEpayco {
  env?: Env
  fetch?: typeof fetch
}

type Respuesta = { ok: true; cuerpo: Record<string, unknown> } | { ok: false; error: string; reintentable: boolean }

async function pedir(
  deps: DepsEpayco,
  ruta: string,
  opciones: { cuerpo?: unknown; bearer?: string; basic?: string },
): Promise<Respuesta> {
  const env = deps.env ?? process.env
  const f = deps.fetch ?? fetch
  const base = valor(env, 'EPAYCO_API_BASE') ?? EPAYCO_API_BASE_POR_DEFECTO
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await f(`${base}${ruta}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(opciones.bearer ? { Authorization: `Bearer ${opciones.bearer}` } : {}),
        ...(opciones.basic ? { Authorization: `Basic ${opciones.basic}` } : {}),
      },
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      signal: ctrl.signal,
    })
    const texto = await r.text()
    let cuerpo: Record<string, unknown> = {}
    try {
      cuerpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {}
    } catch {
      return { ok: false, error: `ePayco respondió ${r.status} sin JSON en ${ruta}.`, reintentable: r.status >= 500 }
    }
    if (!r.ok) return { ok: false, error: `ePayco respondió ${r.status} en ${ruta}.`, reintentable: r.status >= 500 || r.status === 429 }
    return { ok: true, cuerpo }
  } catch (e) {
    const abortado = e instanceof Error && e.name === 'AbortError'
    return { ok: false, error: abortado ? `ePayco no respondió a tiempo en ${ruta}.` : `Sin conexión con ePayco en ${ruta}.`, reintentable: true }
  } finally {
    clearTimeout(t)
  }
}

/** `POST /login` con Basic → JWT. Nunca se registra ni la llave ni el token. */
async function iniciarSesion(deps: DepsEpayco): Promise<{ ok: true; token: string } | { ok: false; error: string; reintentable: boolean }> {
  const env = deps.env ?? process.env
  const publica = valor(env, 'EPAYCO_PUBLIC_KEY_METRIK')
  const privada = valor(env, 'EPAYCO_PRIVATE_KEY_METRIK')
  if (!publica || !privada) return { ok: false, error: 'ePayco sin llaves.', reintentable: false }
  const r = await pedir(deps, '/login', { basic: Buffer.from(`${publica}:${privada}`, 'utf8').toString('base64') })
  if (!r.ok) return r
  const token = typeof r.cuerpo.token === 'string' ? r.cuerpo.token : null
  if (!token) return { ok: false, error: 'ePayco no entregó el token de sesión.', reintentable: false }
  return { ok: true, token }
}

/** Quien paga, como lo pide ePayco. Para una empresa: `NIT` y su número. */
export interface PagadorEpayco {
  tipoDocumento: string
  documento: string
  nombre: string
  apellido: string
  email: string
  celular: string
  direccion?: string | null
  /** La IP de quien dio la orden de cobro (el cargo con token la pide; el alta del cliente no). */
  ip?: string | null
}

/** El medio de pago guardado: un puntero, nunca la tarjeta. `epayco:<customerId>:<cardTokenId>`. */
export function refMedioPagoEpayco(customerId: string, cardTokenId: string): string {
  return `epayco:${customerId}:${cardTokenId}`
}

export function leerRefMedioPagoEpayco(ref: string | null | undefined): { customerId: string; cardTokenId: string } | null {
  const m = /^epayco:([A-Za-z0-9_-]{4,64}):([A-Za-z0-9_-]{4,64})$/.exec((ref ?? '').trim())
  return m ? { customerId: m[1], cardTokenId: m[2] } : null
}

/** El token que devuelve ePayco.js: alfanumérico. Cualquier otra cosa no se manda a ePayco. */
export function esTokenTarjeta(t: unknown): t is string {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(t)
}

/**
 * `POST /token/customer`: el cliente de ePayco con su tarjeta tokenizada. Devuelve la referencia que
 * se guarda (`refMedioPagoEpayco`).
 */
export async function registrarClienteEpayco(
  p: { cardTokenId: string; pagador: PagadorEpayco },
  deps: DepsEpayco = {},
): Promise<{ ok: true; ref: string; customerId: string } | { ok: false; error: string }> {
  const falta = faltaConfiguracionEpayco(deps.env ?? process.env)
  if (falta) return { ok: false, error: falta }
  if (!esTokenTarjeta(p.cardTokenId)) return { ok: false, error: 'El token de la tarjeta no es válido.' }
  const s = await iniciarSesion(deps)
  if (!s.ok) return { ok: false, error: s.error }
  const r = await pedir(deps, '/token/customer', {
    bearer: s.token,
    cuerpo: {
      docType: p.pagador.tipoDocumento,
      docNumber: p.pagador.documento,
      name: p.pagador.nombre,
      lastName: p.pagador.apellido,
      email: p.pagador.email,
      cellPhone: p.pagador.celular,
      phone: p.pagador.celular,
      requireCardToken: true,
      cardTokenId: p.cardTokenId,
      ...(p.pagador.direccion ? { address: p.pagador.direccion } : {}),
    },
  })
  if (!r.ok) return { ok: false, error: r.error }
  const datos = ((r.cuerpo.data as Record<string, unknown> | undefined)?.data ?? null) as Record<string, unknown> | null
  const customerId = typeof datos?.customerId === 'string' ? datos.customerId : null
  if (r.cuerpo.success !== true || !customerId) {
    return { ok: false, error: `ePayco no creó el cliente: ${String(r.cuerpo.textResponse ?? 'sin detalle')}.` }
  }
  return { ok: true, ref: refMedioPagoEpayco(customerId, p.cardTokenId), customerId }
}

/**
 * Borra en ePayco las tarjetas del cliente de una referencia (Condiciones 7.3: al cancelar la prueba
 * «METRIK pide a la pasarela eliminar el medio de pago registrado»; Términos 9.9 y 11.2).
 *
 * APIFY (colección oficial, leída el 2026-10-12):
 *   - `POST /subscriptions/customer` con `{ customerId }` → `data.data.cards[]` con `franchise` y `mask`;
 *   - `POST /subscription/token/card/delete` con `{ franchise, mask, customerId }` → `success: true`.
 * El borrado pide la franquicia y la máscara, que ONE no guarda: por eso primero se consulta el
 * cliente. Se borran TODAS sus tarjetas: el cliente de ePayco lo creó este registro y no tiene otra.
 * Sin tarjetas que borrar (ya se borraron) es éxito: el reintento del cron no falla para siempre.
 *
 * ⚠️ Sin verificar contra una cuenta real: la máscara del ejemplo de consulta (`************0326`) y
 * la del ejemplo de borrado (`457562******0326`) no tienen la misma forma. Se manda la que devuelve
 * la consulta; si ePayco la rechaza, el resultado es `ok: false` y el cron lo reintenta y lo deja a la
 * vista. Probarlo en un preview con la tarjeta de prueba antes del encendido.
 */
export async function eliminarTarjetasEpayco(
  ref: string | null | undefined,
  deps: DepsEpayco = {},
): Promise<{ ok: true; borradas: number } | { ok: false; error: string }> {
  const medio = leerRefMedioPagoEpayco(ref)
  if (!medio) return { ok: false, error: 'La referencia no es de una tarjeta de ePayco.' }
  const env = deps.env ?? process.env
  if (!valor(env, 'EPAYCO_PUBLIC_KEY_METRIK') || !valor(env, 'EPAYCO_PRIVATE_KEY_METRIK')) {
    return { ok: false, error: 'ePayco sin llaves: no se pudo pedir el borrado.' }
  }
  const s = await iniciarSesion(deps)
  if (!s.ok) return { ok: false, error: s.error }
  const c = await pedir(deps, '/subscriptions/customer', { bearer: s.token, cuerpo: { customerId: medio.customerId } })
  if (!c.ok) return { ok: false, error: c.error }
  const datos = ((c.cuerpo.data as Record<string, unknown> | undefined)?.data ?? null) as Record<string, unknown> | null
  if (c.cuerpo.success !== true || !datos) return { ok: false, error: `ePayco no devolvió el cliente: ${String(c.cuerpo.textResponse ?? 'sin detalle')}.` }
  const tarjetas = (Array.isArray(datos.cards) ? datos.cards : []) as Record<string, unknown>[]
  let borradas = 0
  for (const t of tarjetas) {
    const franchise = typeof t.franchise === 'string' ? t.franchise : null
    const mask = typeof t.mask === 'string' ? t.mask : null
    if (!franchise || !mask) return { ok: false, error: 'ePayco devolvió una tarjeta sin franquicia o sin máscara.' }
    const d = await pedir(deps, '/subscription/token/card/delete', {
      bearer: s.token,
      cuerpo: { franchise, mask, customerId: medio.customerId },
    })
    if (!d.ok) return { ok: false, error: d.error }
    if (d.cuerpo.success !== true) return { ok: false, error: `ePayco no borró la tarjeta: ${String(d.cuerpo.textResponse ?? 'sin detalle')}.` }
    borradas += 1
  }
  return { ok: true, borradas }
}

/**
 * Los últimos 4 dígitos de la tarjeta de una referencia, para que la Empresa vea a qué tarjeta se
 * cobra antes de confirmar (Condiciones v2.1, 7.1 literal a). ONE no los guarda: se le preguntan a
 * ePayco (`POST /subscriptions/customer`, la misma consulta del borrado). Las dos formas de máscara
 * que muestra la documentación (`************0326` y `457562******0326`) terminan en los 4 dígitos.
 * Cualquier falla devuelve null: la pantalla dice «la tarjeta que registraste» y no se frena el cobro.
 */
export async function ultimosDigitosTarjetaEpayco(ref: string | null | undefined, deps: DepsEpayco = {}): Promise<string | null> {
  const medio = leerRefMedioPagoEpayco(ref)
  if (!medio) return null
  const env = deps.env ?? process.env
  if (!valor(env, 'EPAYCO_PUBLIC_KEY_METRIK') || !valor(env, 'EPAYCO_PRIVATE_KEY_METRIK')) return null
  try {
    const s = await iniciarSesion(deps)
    if (!s.ok) return null
    const c = await pedir(deps, '/subscriptions/customer', { bearer: s.token, cuerpo: { customerId: medio.customerId } })
    if (!c.ok || c.cuerpo.success !== true) return null
    const datos = ((c.cuerpo.data as Record<string, unknown> | undefined)?.data ?? null) as Record<string, unknown> | null
    const tarjetas = (Array.isArray(datos?.cards) ? datos.cards : []) as Record<string, unknown>[]
    // El cliente de ePayco lo creó el registro con UNA tarjeta; con más, no se adivina cuál.
    if (tarjetas.length !== 1) return null
    const m = /(\d{4})$/.exec(typeof tarjetas[0].mask === 'string' ? tarjetas[0].mask.trim() : '')
    return m ? m[1] : null
  } catch {
    return null
  }
}

/**
 * El texto de un `success: false` de APIFY con lo que ePayco dice que falta: `textResponse` y, si viene,
 * `data.errors[]` (`codError`, `errorMessage`). Sin la llave ni la tarjeta: ePayco no las devuelve.
 */
export function detalleDelError(cuerpo: Record<string, unknown>): string {
  // La colección trae tres formas: `textResponse` + `data.errors`, `text_response` + `data.errores` y
  // `data.error.errors` («Error create transaction»).
  const texto = String(cuerpo.textResponse ?? cuerpo.text_response ?? cuerpo.titleResponse ?? cuerpo.title_response ?? 'sin detalle')
  const datos = (cuerpo.data ?? null) as Record<string, unknown> | null
  const anidado = (datos?.error ?? null) as Record<string, unknown> | null
  const lista = datos?.errors ?? datos?.errores ?? anidado?.errors
  const errores = Array.isArray(lista) ? (lista as unknown[]) : []
  const campos = errores
    .map((e) => {
      if (typeof e === 'string') return e
      const o = (e ?? {}) as Record<string, unknown>
      return [o.codError, o.errorMessage ?? o.message].filter((x) => x !== undefined && x !== null && x !== '').join(' ')
    })
    .filter(Boolean)
  return (campos.length > 0 ? `${texto} (${campos.join('; ')})` : texto).slice(0, 280)
}

/** `estado` de ePayco → resultado del ciclo. */
export function resultadoDeEstado(estado: string | null | undefined): 'aprobado' | 'rechazado' | 'pendiente' {
  const e = (estado ?? '').trim().toLowerCase()
  if (e === 'aceptada' || e === 'aprobada') return 'aprobado'
  if (e === 'pendiente' || e === 'retenida' || e === 'iniciada') return 'pendiente'
  return 'rechazado'
}

/** `x_cod_transaction_state` de ePayco (ver arriba) → lo que ONE hace con la transacción. */
const ESTADOS_CONSULTA: Record<string, 'aprobado' | 'pendiente' | 'rechazado' | 'reversado'> = {
  '1': 'aprobado',
  '2': 'rechazado',
  '3': 'pendiente',
  '4': 'rechazado',
  '6': 'reversado',
  '7': 'pendiente',
  '8': 'pendiente',
  '9': 'rechazado',
  '10': 'rechazado',
  '11': 'rechazado',
}

/**
 * La respuesta de la consulta de una transacción (`POST /payment/transaction` de APIFY), leída contra
 * la colección oficial («Pagos › Consultar Transacción», 2026-10-22):
 *
 *   `{ success: true, data: { refPayco, invoice, amount: "20000.00", status: "Pendiente", response,
 *     codeResponse: 3, codTransactionState: "3", responseReasonText, date: "2021-07-19 11:11:39",
 *     testMode: "FALSE" } }`
 *
 * y la de error: `{ success: false, textResponse: "Transacción no existe", data: { error: {} } }`
 * (producción respondió así el 2026-10-22 con llaves de otro comercio: «Transacción no relacionada
 * con el comercio»). Una consulta que no se pudo hacer es un ERROR, nunca un rechazo: antes de este
 * cambio `data.status` vacío caía en `rechazado` y habría devuelto a enlace un cobro aprobado.
 *
 * El estado sale del CÓDIGO (`codTransactionState`, con `codeResponse` de respaldo), los mismos de la
 * confirmación: `codigo` del rechazo es ese código, para que la conciliación use el mismo id de evento
 * que la confirmación (`<ref_payco>-<estado>`). Un estado sin código conocido no decide nada (error).
 * Una transacción de PRUEBA no paga una cuota real, igual que en la confirmación.
 */
export function resultadoDeConsultaEpayco(
  cuerpo: Record<string, unknown>,
  externalRef: string,
  opciones: { pruebaCuenta?: boolean } = {},
): ResultadoCargo {
  if (cuerpo.success !== true) {
    return { estado: 'error', mensaje: `ePayco no consultó la transacción: ${detalleDelError(cuerpo)}`, reintentable: true }
  }
  const d = (cuerpo.data ?? null) as Record<string, unknown> | null
  if (!d || typeof d !== 'object') return { estado: 'error', mensaje: 'ePayco consultó la transacción sin datos.', reintentable: true }
  const ref = externalRef.replace(/^epayco-/, '')
  const refRespuesta = d.refPayco ?? d.referencePayco
  if (refRespuesta !== undefined && refRespuesta !== null && String(refRespuesta) !== ref) {
    return { estado: 'error', mensaje: `ePayco respondió por otra transacción (${String(refRespuesta)}).`, reintentable: false }
  }
  if (String(d.testMode ?? d.test ?? '').toUpperCase() === 'TRUE' && !opciones.pruebaCuenta) {
    return { estado: 'error', mensaje: 'Transacción de prueba: no paga una cuota real.', reintentable: false }
  }
  const codigo = String(d.codTransactionState ?? d.codeResponse ?? '').trim()
  const estado = ESTADOS_CONSULTA[codigo]
  const texto = String(d.responseReasonText ?? d.status ?? d.response ?? '').trim()
  if (estado === 'aprobado') {
    const monto = Number(d.amount)
    if (!Number.isFinite(monto) || monto <= 0) return { estado: 'error', mensaje: 'ePayco aprobó la transacción sin un monto legible.', reintentable: false }
    return { estado: 'aprobado', externalRef, fecha: fechaBogota(typeof d.date === 'string' ? d.date : null), monto }
  }
  if (estado === 'pendiente') return { estado: 'pendiente', externalRef, detalle: texto || 'Pendiente' }
  if (estado === 'rechazado') return { estado: 'rechazado', externalRef, codigo, mensaje: texto || 'Rechazada', reintentable: false }
  if (estado === 'reversado') return { estado: 'error', mensaje: `ePayco reversó la transacción ${ref}: revisar a mano.`, reintentable: false }
  return { estado: 'error', mensaje: `ePayco devolvió un estado desconocido (${codigo || texto || 'vacío'}).`, reintentable: true }
}

function fechaBogota(ymdHms: string | null | undefined): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(ymdHms ?? '')
  return m ? m[1] : new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10)
}

/**
 * Cobra UNA cuota con la tarjeta guardada (`POST /payment/process`). Idempotencia: la referencia de
 * ONE va como `invoice`; quien llama no vuelve a cobrar un cobro con un pago pendiente o aprobado.
 */
export async function cobrarConTokenEpayco(s: SolicitudCargo & { pagador: PagadorEpayco }, deps: DepsEpayco = {}): Promise<ResultadoCargo> {
  const env = deps.env ?? process.env
  const falta = faltaConfiguracionEpayco(env)
  if (falta) return { estado: 'error', mensaje: falta, reintentable: false }
  const medio = leerRefMedioPagoEpayco(s.medioPago?.token_ref)
  if (!medio) return { estado: 'rechazado', externalRef: null, codigo: 'sin_medio_pago', mensaje: 'No hay una tarjeta de ePayco guardada.', reintentable: false }
  if (!Number.isInteger(s.monto) || s.monto <= 0) return { estado: 'error', mensaje: 'Monto inválido.', reintentable: false }

  const sesion = await iniciarSesion(deps)
  if (!sesion.ok) return { estado: 'error', mensaje: sesion.error, reintentable: sesion.reintentable }
  // El cuerpo, campo por campo contra la colección oficial de APIFY («Transacción TC», leída el
  // 2026-10-19) y contra lo que ePayco respondió de verdad:
  //   value         float(2) en la tabla, string en los ejemplos; como string lo ACEPTÓ el 2026-10-19
  //                 (su validación listó solo tax y taxBase): se queda string.
  //   tax, taxBase  NÚMERO: «field tax is type float» (2026-10-19) con '0'. El ejemplo de split manda 0.
  //   docType string(4) · docNumber string(20) · name, lastName, email string(50) · cellPhone, phone
  //   string(10) · address string obligatorio · dues string · currency, ip, country, city, invoice,
  //   description, urlConfirmation, methodConfirmation, extra1..10 string · testMode Boolean ·
  //   cardTokenId, customerId string(20).
  // Nombre y apellido se recortan a 50 (una razón social larga los pasaría). `ico` no existe en el cargo
  // con tarjeta (es de otros medios): no se manda.
  const r = await pedir(deps, '/payment/process', {
    bearer: sesion.token,
    cuerpo: {
      value: String(s.monto),
      currency: 'COP',
      dues: '1',
      docType: s.pagador.tipoDocumento,
      docNumber: s.pagador.documento,
      name: s.pagador.nombre.slice(0, 50),
      lastName: s.pagador.apellido.slice(0, 50),
      email: s.pagador.email,
      cellPhone: s.pagador.celular,
      phone: s.pagador.celular,
      address: s.pagador.direccion || 'Sin dirección',
      country: 'CO',
      ...(s.pagador.ip ? { ip: s.pagador.ip } : {}),
      cardTokenId: medio.cardTokenId,
      customerId: medio.customerId,
      invoice: s.referencia,
      description: s.descripcion.slice(0, 100),
      tax: 0,
      taxBase: 0,
      // Con `?ref=`: la confirmación (pendiente → aceptada) vuelve al cobro aunque no traiga `x_id_invoice`.
      urlConfirmation: urlConfirmacionEpayco(s.referencia, env),
      methodConfirmation: 'POST',
      testMode: epaycoEnPruebas(env),
      extra1: s.cobroId,
    },
  })
  if (!r.ok) return { estado: 'error', mensaje: r.error, reintentable: r.reintentable }
  const tx = ((r.cuerpo.data as Record<string, unknown> | undefined)?.transaction ?? null) as Record<string, unknown> | null
  const d = (tx?.data ?? null) as Record<string, unknown> | null
  if (r.cuerpo.success !== true) {
    // ePayco no procesó la solicitud (validación de campos, sesión, comercio): no hubo transacción y no
    // es un rechazo del banco. Se guarda qué campo pidió, para no volver a adivinar (2026-10-16: el
    // primer cargo con token respondió «Some fields are required» sin decir cuál).
    return { estado: 'error', mensaje: `ePayco no procesó el cobro: ${detalleDelError(r.cuerpo)}`, reintentable: false, sinTransaccion: true }
  }
  if (!d) return { estado: 'error', mensaje: 'ePayco respondió sin la transacción: hay que revisar si cobró.', reintentable: false }
  const ref = d.ref_payco !== undefined && d.ref_payco !== null ? `epayco-${String(d.ref_payco)}` : null
  const res = resultadoDeEstado(typeof d.estado === 'string' ? d.estado : null)
  if (res === 'aprobado' && ref) {
    return { estado: 'aprobado', externalRef: ref, fecha: fechaBogota(typeof d.fecha === 'string' ? d.fecha : null), monto: Number(d.valor ?? s.monto) }
  }
  if (res === 'pendiente') return { estado: 'pendiente', externalRef: ref, detalle: String(d.respuesta ?? 'Pendiente') }
  return {
    estado: 'rechazado',
    externalRef: ref,
    codigo: String(d.cod_respuesta ?? 'rechazada'),
    mensaje: String(d.respuesta ?? d.estado ?? 'Rechazada'),
    // Fondos insuficientes y parecidos se pueden reintentar; una tarjeta inválida, no. Sin el código
    // de motivo en la respuesta, se trata como no reintentable: lo resuelve el enlace de pago.
    reintentable: false,
  }
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

// ── Confirmación (webhook) ───────────────────────────────────────────────────────────────────

/** Los campos `x_*`: llegan como formulario (POST), como JSON o en la URL (GET). */
export function camposConfirmacion(cuerpoCrudo: string): Record<string, string> | null {
  const t = cuerpoCrudo.trim()
  if (!t) return null
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]))
    } catch {
      return null
    }
  }
  const p = new URLSearchParams(t.startsWith('?') ? t.slice(1) : t)
  const o: Record<string, string> = {}
  for (const [k, v] of p) o[k] = v
  return Object.keys(o).length > 0 ? o : null
}

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
  // La consulta la puso ONE al crear el link o el cargo; si ePayco manda un campo del mismo nombre, gana el suyo.
  for (const [k, v] of consulta) if (!todo.has(k)) todo.set(k, v)
  return todo.toString()
}

export function firmaEpayco(p: { idCliente: string; pKey: string; refPayco: string; transaccionId: string; monto: string; moneda: string }): string {
  return createHash('sha256')
    .update([p.idCliente, p.pKey, p.refPayco, p.transaccionId, p.monto, p.moneda].join('^'))
    .digest('hex')
}

/** La misma firma, sobre los campos `x_*` ya leídos. */
export function firmaConfirmacion(c: Record<string, string>, custId: string, pKey: string): string {
  return firmaEpayco({
    idCliente: custId,
    pKey,
    refPayco: c.x_ref_payco ?? '',
    transaccionId: c.x_transaction_id ?? '',
    monto: c.x_amount ?? '',
    moneda: c.x_currency_code ?? '',
  })
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

/**
 * Normaliza la confirmación YA verificada. `null` si le falta lo mínimo (recibo y estado).
 *
 * Una transacción de PRUEBA (`x_test_request=TRUE`) no registra plata, salvo `pruebaCuenta`: ePayco en
 * modo prueba y fuera del despliegue de producción (un preview que prueba el recorrido con la tarjeta
 * de prueba). En producción una tarjeta de prueba nunca paga una cuota real.
 */
export function parsearConfirmacionEpayco(cuerpoCrudo: string, opciones: { pruebaCuenta?: boolean } = {}): EventoPasarela | null {
  const p = new URLSearchParams(cuerpoCrudo)
  const campo = (k: string) => (p.get(k) ?? '').trim()
  const refPayco = campo('x_ref_payco')
  const estado = campo('x_cod_transaction_state') || campo('x_cod_response')
  if (!/^\d+$/.test(refPayco) || !/^\d+$/.test(estado)) return null

  const prueba = campo('x_test_request').toUpperCase() === 'TRUE'
  const monto = Number(campo('x_amount'))
  const fecha = fechaTransaccionBogota(campo('x_transaction_date') || campo('x_fecha_transaccion'))
  // La referencia de ONE: la de la URL (`?ref=`, links y cargos) o, en un cargo con token, el `invoice`.
  const referencia = campo('ref') || campo('x_id_invoice') || campo('x_id_factura') || null

  return {
    // Una confirmación por transacción Y estado: «pendiente» y luego «aceptada» son dos notificaciones.
    eventoId: `${refPayco}-${estado}`,
    tipoOriginal: `${estado} ${campo('x_transaction_state') || campo('x_response')}`.trim() + (prueba ? ' (prueba)' : ''),
    tipo: prueba && !opciones.pruebaCuenta ? 'otro' : (ESTADOS[estado] ?? 'otro'),
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

/** Formulario, JSON o la consulta de un GET (`?x_ref_payco=…`), a una cadena de formulario. */
function comoFormulario(cuerpoCrudo: string): string {
  const c = camposConfirmacion(cuerpoCrudo)
  return c ? new URLSearchParams(c).toString() : ''
}

export function verificarConfirmacionEpayco(cuerpoCrudo: string, env: Env = process.env): VerificacionWebhook {
  const idCliente = llave(env, ENV_EPAYCO.idCliente)
  const pKey = llave(env, ENV_EPAYCO.pKey)
  if (!idCliente || !pKey) return { ok: false, motivo: 'no_configurado' }
  const form = comoFormulario(cuerpoCrudo)
  const p = new URLSearchParams(form)
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
  const evento = parsearConfirmacionEpayco(form, { pruebaCuenta: epaycoEnPruebas(env) && env.VERCEL_ENV !== 'production' })
  if (!evento) return { ok: false, motivo: 'cuerpo_invalido' }
  return { ok: true, evento }
}

// ── El adaptador ─────────────────────────────────────────────────────────────────────────────

export function crearAdapterEpayco(deps: DepsEpayco = {}): PasarelaAdapter {
  const env = () => deps.env ?? process.env
  return {
    nombre: 'epayco',
    capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: true, webhook: true },
    async cobrar(s) {
      // Sin tarjeta guardada: el link de cobro (#1182), igual que Bold.
      if (!leerRefMedioPagoEpayco(s.medioPago?.token_ref)) {
        const ahora = Date.now()
        const r = await crearEnlaceEpayco(
          {
            monto: Math.round(s.monto),
            descripcion: s.descripcion,
            referencia: referenciaEnlaceCobro(s.cobroId, ahora),
            expiraMs: ahora + DIAS_VIGENCIA_ENLACE * 86_400_000,
          },
          deps,
        )
        if (!r.ok) return { estado: 'error', mensaje: r.error, reintentable: r.reintentable }
        return { estado: 'pendiente', externalRef: r.idEnlace, linkPago: r.url, expira: r.expira, detalle: 'Link de ePayco enviado: el pago lo registra la confirmación.' }
      }
      const c = s.cliente
      if (!c?.documento || !c.email || !c.nombre) {
        return { estado: 'error', mensaje: 'Faltan los datos del pagador (documento, correo, nombre).', reintentable: false }
      }
      // ePayco exige el celular en el cargo: sin él responde «Some fields are required». No se llama.
      if (!c.celular) return { estado: 'error', mensaje: 'Falta el celular del pagador.', reintentable: false, sinTransaccion: true }
      return cobrarConTokenEpayco(
        { ...s, pagador: { tipoDocumento: c.tipoDocumento ?? 'NIT', documento: c.documento, nombre: c.nombre, apellido: c.apellido ?? '.', email: c.email, celular: c.celular ?? '', direccion: c.direccion ?? null, ip: c.ip ?? null } },
        deps,
      )
    },
    async consultar(externalRef) {
      // Un link (`<id>` de payco.link) no se consulta: lo registra la confirmación.
      if (!externalRef.startsWith('epayco-')) {
        return { estado: 'pendiente', externalRef, detalle: 'Link de ePayco: el pago lo registra la confirmación.' }
      }
      const falta = faltaConfiguracionEpayco(env())
      if (falta) return { estado: 'error', mensaje: falta, reintentable: false }
      const s = await iniciarSesion(deps)
      if (!s.ok) return { estado: 'error', mensaje: s.error, reintentable: s.reintentable }
      const r = await pedir(deps, '/payment/transaction', { bearer: s.token, cuerpo: { referencePayco: externalRef.replace(/^epayco-/, '') } })
      if (!r.ok) return { estado: 'error', mensaje: r.error, reintentable: r.reintentable }
      return resultadoDeConsultaEpayco(r.cuerpo, externalRef, { pruebaCuenta: epaycoEnPruebas(env()) && env().VERCEL_ENV !== 'production' })
    },
    verificarWebhook(cuerpoCrudo) {
      return verificarConfirmacionEpayco(cuerpoCrudo, env())
    },
    // Lo que pide el LINK (las llaves). El cargo con token revisa además el interruptor y el modo
    // (`faltaConfiguracionEpayco`) dentro de `cobrarConTokenEpayco`.
    faltaConfiguracion() {
      return epaycoConfigurado(env()).enlaces ? null : MOTIVO_EPAYCO_SIN_LLAVE
    },
    crearEnlacePago(s: SolicitudEnlacePago) {
      return crearEnlaceEpayco(s, deps)
    },
    idEnlaceDeUrl(url) {
      return idEnlaceEpaycoDeUrl(url)
    },
  }
}

export const pasarelaEpayco: PasarelaAdapter = crearAdapterEpayco()
