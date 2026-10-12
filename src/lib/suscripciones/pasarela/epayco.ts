/**
 * Pasarela `epayco`: tarjeta tokenizada y cobro iniciado por el comercio (sin clic del cliente).
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
 *   EPAYCO_PUBLIC_KEY            llave pública (también la usa ePayco.js en el navegador)
 *   EPAYCO_PRIVATE_KEY           llave privada
 *   EPAYCO_P_CUST_ID_CLIENTE     P_CUST_ID_CLIENTE, para verificar la firma de la confirmación
 *   EPAYCO_P_KEY                 P_KEY, para verificar la firma de la confirmación
 *   EPAYCO_PRODUCCION=1          cobros reales (sin esto: modo prueba)
 *   EPAYCO_API_BASE              opcional; por defecto https://apify.epayco.co
 *   EPAYCO_URL_CONFIRMACION      opcional; por defecto https://metrikone.co/api/webhooks/epayco
 *
 * ⚠️ Sin verificar contra una cuenta real (no hay llaves): la forma exacta de las respuestas sale de
 * los ejemplos de la colección oficial. Antes del primer cobro real se corre el recorrido en preview
 * con las tarjetas de prueba (https://docs.epayco.com/docs/medios-de-pruebas-1).
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type {
  EventoPasarela,
  PasarelaAdapter,
  ResultadoCargo,
  SolicitudCargo,
  VerificacionWebhook,
} from './adapter'

type Env = Record<string, string | undefined>

export const EPAYCO_API_BASE_POR_DEFECTO = 'https://apify.epayco.co'
export const EPAYCO_URL_CONFIRMACION_POR_DEFECTO = 'https://metrikone.co/api/webhooks/epayco'
/** El script oficial de tokenización. Pide jQuery (usa `$.ajax`): la pantalla lo carga antes. */
export const EPAYCO_JS = 'https://checkout.epayco.co/epayco.min.js'
const TIMEOUT_MS = 15_000

function valor(env: Env, nombre: string): string | null {
  const v = env[nombre]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function epaycoHabilitado(env: Env = process.env): boolean {
  return env.EPAYCO_HABILITADO === '1'
}

export function epaycoEnPruebas(env: Env = process.env): boolean {
  return env.EPAYCO_PRODUCCION !== '1'
}

/** La llave pública, para ePayco.js. No es secreta, pero sale del servidor (no es `NEXT_PUBLIC_`). */
export function llavePublicaEpayco(env: Env = process.env): string | null {
  return valor(env, 'EPAYCO_PUBLIC_KEY')
}

/** Por qué ePayco no puede cobrar ahora, o `null`. */
export function faltaConfiguracionEpayco(env: Env = process.env): string | null {
  if (!epaycoHabilitado(env)) return 'ePayco está apagado (EPAYCO_HABILITADO). No se cobró nada.'
  if (!valor(env, 'EPAYCO_PUBLIC_KEY') || !valor(env, 'EPAYCO_PRIVATE_KEY')) {
    return 'ePayco sin configurar: faltan EPAYCO_PUBLIC_KEY o EPAYCO_PRIVATE_KEY. No se cobró nada.'
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
  const publica = valor(env, 'EPAYCO_PUBLIC_KEY')
  const privada = valor(env, 'EPAYCO_PRIVATE_KEY')
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

/** `estado` de ePayco → resultado del ciclo. */
export function resultadoDeEstado(estado: string | null | undefined): 'aprobado' | 'rechazado' | 'pendiente' {
  const e = (estado ?? '').trim().toLowerCase()
  if (e === 'aceptada' || e === 'aprobada') return 'aprobado'
  if (e === 'pendiente' || e === 'retenida' || e === 'iniciada') return 'pendiente'
  return 'rechazado'
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
  const r = await pedir(deps, '/payment/process', {
    bearer: sesion.token,
    cuerpo: {
      value: String(s.monto),
      currency: 'COP',
      dues: '1',
      docType: s.pagador.tipoDocumento,
      docNumber: s.pagador.documento,
      name: s.pagador.nombre,
      lastName: s.pagador.apellido,
      email: s.pagador.email,
      cellPhone: s.pagador.celular,
      phone: s.pagador.celular,
      address: s.pagador.direccion || 'Sin dirección',
      cardTokenId: medio.cardTokenId,
      customerId: medio.customerId,
      invoice: s.referencia,
      description: s.descripcion.slice(0, 100),
      tax: '0',
      taxBase: '0',
      urlConfirmation: valor(env, 'EPAYCO_URL_CONFIRMACION') ?? EPAYCO_URL_CONFIRMACION_POR_DEFECTO,
      methodConfirmation: 'POST',
      testMode: epaycoEnPruebas(env),
      extra1: s.cobroId,
    },
  })
  if (!r.ok) return { estado: 'error', mensaje: r.error, reintentable: r.reintentable }
  const tx = ((r.cuerpo.data as Record<string, unknown> | undefined)?.transaction ?? null) as Record<string, unknown> | null
  const d = (tx?.data ?? null) as Record<string, unknown> | null
  if (r.cuerpo.success !== true || !d) {
    return { estado: 'rechazado', externalRef: null, codigo: 'epayco_error', mensaje: String(r.cuerpo.textResponse ?? 'ePayco no procesó el cobro.'), reintentable: false }
  }
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

export function firmaConfirmacion(c: Record<string, string>, custId: string, pKey: string): string {
  return createHash('sha256')
    .update(`${custId}^${pKey}^${c.x_ref_payco ?? ''}^${c.x_transaction_id ?? ''}^${c.x_amount ?? ''}^${c.x_currency_code ?? ''}`, 'utf8')
    .digest('hex')
}

function igual(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), 'utf8')
  const y = Buffer.from(b.toLowerCase(), 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

function tipoDeEstado(cod: string | undefined): EventoPasarela['tipo'] {
  switch ((cod ?? '').trim()) {
    case '1':
      return 'aprobado'
    case '2':
    case '4':
    case '9':
    case '10':
    case '11':
      return 'rechazado'
    case '6':
      return 'anulado'
    default:
      // 3 pendiente, 7 retenida, 8 iniciada: no cambian nada todavía.
      return 'otro'
  }
}

export function verificarConfirmacionEpayco(cuerpoCrudo: string, env: Env = process.env): VerificacionWebhook {
  const custId = valor(env, 'EPAYCO_P_CUST_ID_CLIENTE')
  const pKey = valor(env, 'EPAYCO_P_KEY')
  if (!custId || !pKey) return { ok: false, motivo: 'no_configurado' }
  const c = camposConfirmacion(cuerpoCrudo)
  if (!c || !c.x_ref_payco) return { ok: false, motivo: 'cuerpo_invalido' }
  if (!c.x_signature) return { ok: false, motivo: 'sin_firma' }
  if (!igual(firmaConfirmacion(c, custId, pKey), c.x_signature)) return { ok: false, motivo: 'firma_invalida' }

  const esPrueba = (c.x_test_request ?? '').toUpperCase() === 'TRUE'
  // Un pago de prueba nunca registra plata fuera de modo prueba (ni en el despliegue de producción).
  const pruebaFueraDeLugar = esPrueba && (!epaycoEnPruebas(env) || env.VERCEL_ENV === 'production')
  const estado = c.x_cod_transaction_state || c.x_cod_response
  const monto = Number(c.x_amount)
  const fecha = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(c.x_transaction_date ?? c.x_fecha_transaccion ?? '')
  return {
    ok: true,
    evento: {
      tipo: pruebaFueraDeLugar ? 'otro' : tipoDeEstado(estado),
      // ePayco no manda un id de notificación: la transacción + su estado lo hacen único.
      eventoId: `${c.x_ref_payco}-${estado ?? 'x'}`,
      tipoOriginal: `${c.x_transaction_state || c.x_response || 'estado'}${esPrueba ? ' (prueba)' : ''}`,
      transaccionId: c.x_transaction_id || c.x_ref_payco,
      referenciaPago: `epayco-${c.x_ref_payco}`,
      referencia: c.x_id_invoice || c.x_id_factura || null,
      idEnlace: null,
      monto: Number.isFinite(monto) ? monto : null,
      moneda: c.x_currency_code || null,
      ocurridoAt: fecha ? `${fecha[1]}T${fecha[2]}-05:00` : null,
      crudo: { ...c, x_signature: '[verificada]' },
    },
  }
}

// ── El adaptador ─────────────────────────────────────────────────────────────────────────────

export function crearAdapterEpayco(deps: DepsEpayco = {}): PasarelaAdapter {
  const env = () => deps.env ?? process.env
  return {
    nombre: 'epayco',
    capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: false, webhook: true },
    async cobrar(s) {
      const c = s.cliente
      if (!c?.documento || !c.email || !c.nombre) {
        return { estado: 'error', mensaje: 'Faltan los datos del pagador (documento, correo, nombre).', reintentable: false }
      }
      return cobrarConTokenEpayco(
        { ...s, pagador: { tipoDocumento: c.tipoDocumento ?? 'NIT', documento: c.documento, nombre: c.nombre, apellido: c.apellido ?? '.', email: c.email, celular: c.celular ?? '', direccion: c.direccion ?? null } },
        deps,
      )
    },
    async consultar(externalRef) {
      const falta = faltaConfiguracionEpayco(env())
      if (falta) return { estado: 'error', mensaje: falta, reintentable: false }
      const s = await iniciarSesion(deps)
      if (!s.ok) return { estado: 'error', mensaje: s.error, reintentable: s.reintentable }
      const r = await pedir(deps, '/payment/transaction', { bearer: s.token, cuerpo: { referencePayco: externalRef.replace(/^epayco-/, '') } })
      if (!r.ok) return { estado: 'error', mensaje: r.error, reintentable: r.reintentable }
      const d = (r.cuerpo.data ?? null) as Record<string, unknown> | null
      const res = resultadoDeEstado(typeof d?.status === 'string' ? d.status : typeof d?.response === 'string' ? d.response : null)
      if (res === 'aprobado') return { estado: 'aprobado', externalRef, fecha: fechaBogota(typeof d?.date === 'string' ? d.date : null), monto: Number(d?.amount ?? 0) }
      if (res === 'pendiente') return { estado: 'pendiente', externalRef }
      return { estado: 'rechazado', externalRef, codigo: String(d?.codeResponse ?? 'rechazada'), mensaje: String(d?.responseReasonText ?? 'Rechazada'), reintentable: false }
    },
    verificarWebhook(cuerpoCrudo) {
      return verificarConfirmacionEpayco(cuerpoCrudo, env())
    },
    faltaConfiguracion() {
      return faltaConfiguracionEpayco(env())
    },
  }
}

export const pasarelaEpayco: PasarelaAdapter = crearAdapterEpayco()
