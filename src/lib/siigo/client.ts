// ============================================================
// Siigo API — cliente HTTP (REST fetch, sin SDK)
//
// Credenciales POR WORKSPACE en `workspaces.config_extra` (server-only, mismo
// patrón que Drive y Valida). No hay fallback a env var global: facturar es un
// acto fiscal a nombre de una empresa concreta, y una credencial global
// permitiría emitir con el emisor equivocado si un workspace queda sin
// configurar. Preferimos fallar.
//
// Server-only — NUNCA importar desde un componente cliente.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'

const SIIGO_BASE = 'https://api.siigo.com'

/**
 * Margen antes de la expiración real del token. Siigo devuelve 86.400 s (24 h);
 * renovamos antes para que una petición no salga con un token que expira a
 * mitad de vuelo.
 */
const TOKEN_SKEW_MS = 5 * 60 * 1000

interface CachedToken {
  token: string
  expiresAt: number
}

/** Cache por workspace: dos tenants NUNCA comparten token. */
const tokenCache = new Map<string, CachedToken>()

export interface SiigoCredentials {
  username: string
  accessKey: string
  partnerId: string
}

/** Configuración de catálogo del workspace (ids internos de SU Siigo). */
export interface SiigoConfig {
  /** `document.id` del comprobante de factura electrónica de venta. */
  facturaDocumentId: number
  /** `document.id` del comprobante de recibo de caja. */
  reciboDocumentId: number
  /** Id del vendedor (usuario de Siigo) que firma las facturas. */
  sellerId: number
  /** Código del producto/servicio que se factura. */
  productoCode: string
  /** Id del impuesto IVA aplicable al producto. */
  ivaId: number
  /** Forma de pago de la factura. */
  facturaPaymentId: number
  /** Forma de pago del recibo de caja. */
  reciboPaymentId: number
}

export class SiigoError extends Error {
  readonly status: number
  readonly codes: string[]
  constructor(message: string, status: number, codes: string[] = []) {
    super(message)
    this.name = 'SiigoError'
    this.status = status
    this.codes = codes
  }
}

// ── Credenciales ─────────────────────────────────────────────────────────────

/**
 * Lee las credenciales del workspace. Exige las TRES: con credenciales a medias
 * el fallo aparece más adelante, disfrazado de 401, y cuesta rastrearlo.
 */
async function resolveCredentials(workspaceId: string): Promise<SiigoCredentials> {
  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws, error } = await (svc as any)
    .from('workspaces')
    .select('slug, config_extra')
    .eq('id', workspaceId)
    .single()

  if (error || !ws) throw new SiigoError(`Workspace ${workspaceId} no encontrado`, 0)

  const cfg = (ws.config_extra ?? {}) as Record<string, unknown>
  const username = cfg.siigo_username as string | undefined
  const accessKey = cfg.siigo_access_key as string | undefined
  const partnerId = cfg.siigo_partner_id as string | undefined

  const slug = (ws.slug as string) ?? workspaceId
  const faltantes = [
    !username && 'siigo_username',
    !accessKey && 'siigo_access_key',
    !partnerId && 'siigo_partner_id',
  ].filter(Boolean)

  if (faltantes.length > 0) {
    throw new SiigoError(
      `Workspace ${slug}: faltan credenciales de Siigo en config_extra (${faltantes.join(', ')}). ` +
      `Se cargan con scripts/setup-siigo-workspace.ts, nunca desde la app.`,
      0,
    )
  }

  return { username: username!, accessKey: accessKey!, partnerId: partnerId! }
}

/**
 * Lee la configuración de catálogo del workspace (los ids internos de su Siigo).
 * Se resuelven una vez con `scripts/inspect-siigo-catalogos.ts` y se guardan; NO
 * se adivinan en runtime ni se hardcodean, porque son distintos en cada empresa.
 */
export async function getSiigoConfig(workspaceId: string): Promise<SiigoConfig> {
  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws } = await (svc as any)
    .from('workspaces')
    .select('slug, config_extra')
    .eq('id', workspaceId)
    .single()

  const cfg = ((ws?.config_extra ?? {}) as Record<string, unknown>).siigo_config as
    | Partial<SiigoConfig>
    | undefined

  const requeridos: (keyof SiigoConfig)[] = [
    'facturaDocumentId', 'reciboDocumentId', 'sellerId',
    'productoCode', 'ivaId', 'facturaPaymentId', 'reciboPaymentId',
  ]
  const faltantes = requeridos.filter(k => cfg?.[k] === undefined || cfg?.[k] === null)
  if (!cfg || faltantes.length > 0) {
    throw new SiigoError(
      `Workspace ${(ws?.slug as string) ?? workspaceId}: falta config_extra.siigo_config ` +
      `(${faltantes.join(', ')}).`,
      0,
    )
  }
  return cfg as SiigoConfig
}

// ── Token ────────────────────────────────────────────────────────────────────

/**
 * Devuelve un access token vigente para el workspace, cacheado en memoria.
 * El token vive 24 h, así que en la práctica se mintea una vez por proceso.
 */
async function getAccessToken(workspaceId: string, creds: SiigoCredentials): Promise<string> {
  const cached = tokenCache.get(workspaceId)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const res = await fetch(`${SIIGO_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Partner-Id': creds.partnerId },
    body: JSON.stringify({ username: creds.username, access_key: creds.accessKey }),
  })

  if (!res.ok) {
    // El cuerpo del error de auth puede venir con eco de lo enviado: NO lo
    // propagamos tal cual para no arrastrar la credencial a un log.
    throw new SiigoError(
      `Siigo rechazó las credenciales del workspace (HTTP ${res.status}). ` +
      `Si el Access Key se restableció en Siigo, hay que volver a cargarlo.`,
      res.status,
    )
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new SiigoError('Siigo no devolvió access_token', res.status)

  const ttlMs = (data.expires_in ?? 86400) * 1000
  tokenCache.set(workspaceId, {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(0, ttlMs - TOKEN_SKEW_MS),
  })
  return data.access_token
}

/** Invalida el token cacheado (tras un 401, para reintentar con uno nuevo). */
export function invalidarTokenSiigo(workspaceId: string): void {
  tokenCache.delete(workspaceId)
}

// ── Petición ─────────────────────────────────────────────────────────────────

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /**
   * Clave de idempotencia. Siigo la acepta SOLO en POST de /invoices,
   * /credit-notes, /journals y /vouchers, y exige alfanumérico sin caracteres
   * especiales ni espacios, MÁXIMO 30 caracteres.
   * ⚠️ Un UUID sin guiones son 32 y NO cabe: usar `claveIdempotencia()`.
   */
  idempotencyKey?: string
}

/**
 * Mensaje legible a partir del cuerpo de error de Siigo, que llega como
 * `{ Status, Errors: [{ Code, Message, Params, Detail }] }`. Sin esto, el
 * operador ve "HTTP 400" y no qué campo rechazaron.
 */
function describirError(status: number, raw: string): SiigoError {
  try {
    const parsed = JSON.parse(raw) as {
      Errors?: Array<{ Code?: string; Message?: string; Params?: string[] }>
    }
    const errs = parsed.Errors ?? []
    if (errs.length > 0) {
      const detalle = errs
        .map(e => {
          const params = e.Params?.length ? ` (${e.Params.join(', ')})` : ''
          return `${e.Message ?? e.Code ?? 'error'}${params}`
        })
        .join(' · ')
      return new SiigoError(detalle, status, errs.map(e => e.Code ?? '').filter(Boolean))
    }
  } catch {
    // cuerpo no-JSON: cae al genérico de abajo
  }
  return new SiigoError(`Siigo respondió HTTP ${status}`, status)
}

/**
 * Ejecuta una petición contra Siigo con el token del workspace.
 * Ante un 401 reintenta UNA vez con token nuevo (el cacheado pudo quedar
 * invalidado del lado de Siigo antes de su expiración nominal).
 */
export async function siigoRequest<T>(
  workspaceId: string,
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const creds = await resolveCredentials(workspaceId)
  const { method = 'GET', body, idempotencyKey } = opts

  const ejecutar = async (token: string): Promise<Response> => {
    const headers: Record<string, string> = {
      Authorization: token,
      'Partner-Id': creds.partnerId,
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    // Solo en POST: en GET/PUT/DELETE el header no tiene efecto.
    if (idempotencyKey && method === 'POST') headers['Idempotency-Key'] = idempotencyKey
    return fetch(`${SIIGO_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
  }

  let token = await getAccessToken(workspaceId, creds)
  let res = await ejecutar(token)

  if (res.status === 401) {
    invalidarTokenSiigo(workspaceId)
    token = await getAccessToken(workspaceId, creds)
    res = await ejecutar(token)
  }

  if (!res.ok) throw describirError(res.status, await res.text())
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ── Idempotencia ─────────────────────────────────────────────────────────────

/**
 * Clave de idempotencia determinista a partir del negocio.
 *
 * ⚠️ Tiene que ser LA MISMA en cada reintento del mismo documento, o la
 * idempotencia no sirve para nada: Siigo devolvería el comprobante ya creado
 * solo si la clave coincide. Por eso se deriva del id del negocio y no de la
 * hora ni de un aleatorio.
 *
 * Tope de Siigo: alfanumérico, sin caracteres especiales ni espacios, máx 30.
 * Un UUID sin guiones son 32, así que se recorta. `sufijo` permite emitir un
 * segundo documento legítimo del mismo negocio (una segunda factura), sin lo
 * cual la idempotencia lo bloquearía como duplicado.
 */
export function claveIdempotencia(negocioId: string, sufijo?: string | number): string {
  const base = negocioId.replace(/[^a-zA-Z0-9]/g, '')
  const suf = sufijo === undefined ? '' : String(sufijo).replace(/[^a-zA-Z0-9]/g, '')
  return (suf ? `${base.slice(0, 30 - suf.length)}${suf}` : base).slice(0, 30)
}
