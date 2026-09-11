// ============================================================
// Google Drive API Helper — REST fetch (no SDK)
// Soporta OAuth per-workspace + Shared Drives.
//
// Modos de credenciales:
//   1. Service account (preferido, NO caduca): si el workspace tiene
//      config_extra.drive_auth_mode='service_account' + drive_impersonate_user.
//      Firma un JWT con la llave del SA (env GOOGLE_DRIVE_SA_KEY, fallback
//      METRIK_PDF_RENDER_SA_KEY) e impersona al usuario via domain-wide
//      delegation. Sin refresh tokens que caduquen, sin reautorización.
//   2. Per-workspace OAuth (si config_extra tiene drive_refresh_token +
//      drive_client_id + drive_client_secret): flujo refresh_token clásico.
//   3. Global (fallback): env vars GOOGLE_DRIVE_CLIENT_ID / CLIENT_SECRET /
//      REFRESH_TOKEN — OAuth de MeTRIK (cuenta mauricio.moreno@metrik.com.co).
//
// Todas las requests pasan supportsAllDrives=true para soportar
// Unidades Compartidas (Shared Drives).
//
// Server-only — NEVER import from client components.
// ============================================================

import { createSign } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'

// ── Token cache (por workspace) ──────────────────────────────────────────────

const GLOBAL_CACHE_KEY = '__global__'

interface CachedToken {
  token: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()

type DriveCredentials =
  | {
      mode: 'oauth'
      clientId: string
      clientSecret: string
      refreshToken: string
      cacheKey: string
    }
  | {
      mode: 'service_account'
      saKeyRaw: string
      impersonate: string
      cacheKey: string
    }

/**
 * Mintea un access token de Drive via service account + domain-wide delegation.
 * Firma un JWT (RS256) con la llave privada del SA, con `sub` = usuario a
 * impersonar. No usa refresh tokens → no caduca ni requiere reautorización.
 */
async function mintServiceAccountToken(
  saKeyRaw: string,
  impersonate: string,
): Promise<{ access_token: string; expires_in: number }> {
  let sa: { client_email?: string; private_key?: string; token_uri?: string }
  try {
    sa = JSON.parse(saKeyRaw)
  } catch {
    throw new Error('SA key (GOOGLE_DRIVE_SA_KEY / METRIK_PDF_RENDER_SA_KEY) no es JSON válido')
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('SA key inválida — falta client_email o private_key')
  }
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const b64url = (b: Buffer | string) =>
    Buffer.from(b as Buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      sub: impersonate,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  )
  const signingInput = `${header}.${claims}`
  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const assertion = `${signingInput}.${b64url(signer.sign(sa.private_key))}`

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Drive SA token mint failed (${res.status}): ${t.slice(0, 300)}`)
  }
  const data = await res.json()
  return { access_token: data.access_token as string, expires_in: (data.expires_in as number) ?? 3600 }
}

/**
 * Resuelve credenciales para un workspace o cae a env vars globales.
 *
 * Reglas:
 * - Si workspaceId esta presente Y config_extra tiene los tres campos
 *   (drive_refresh_token, drive_client_id, drive_client_secret) → usa esos.
 * - Si workspaceId esta presente Y config_extra tiene solo ALGUNOS de los
 *   campos → error (credenciales incompletas).
 * - Si workspaceId esta ausente o config_extra no tiene NINGUN campo drive_*
 *   → fallback a env vars.
 */
async function resolveCredentials(workspaceId?: string): Promise<DriveCredentials> {
  if (workspaceId) {
    const svc = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ws, error } = await (svc as any)
      .from('workspaces')
      .select('slug, config_extra')
      .eq('id', workspaceId)
      .single()

    if (!error && ws) {
      const cfg = (ws.config_extra ?? {}) as Record<string, unknown>

      // ── Modo service account (domain-wide delegation) — preferido ──
      // No caduca ni requiere reautorización. Se chequea ANTES del OAuth.
      if (cfg.drive_auth_mode === 'service_account') {
        const impersonate = cfg.drive_impersonate_user as string | undefined
        if (!impersonate) {
          const slug = (ws.slug as string) ?? workspaceId
          throw new Error(
            `Workspace ${slug}: drive_auth_mode=service_account requiere ` +
            `config_extra.drive_impersonate_user`,
          )
        }
        const saKeyRaw = process.env.GOOGLE_DRIVE_SA_KEY || process.env.METRIK_PDF_RENDER_SA_KEY
        if (!saKeyRaw) {
          throw new Error(
            'Falta env GOOGLE_DRIVE_SA_KEY (o METRIK_PDF_RENDER_SA_KEY) para modo service_account',
          )
        }
        return {
          mode: 'service_account',
          saKeyRaw,
          impersonate,
          cacheKey: `sa:${workspaceId}:${impersonate}`,
        }
      }

      const refreshToken = cfg.drive_refresh_token as string | undefined
      const clientId = cfg.drive_client_id as string | undefined
      const clientSecret = cfg.drive_client_secret as string | undefined

      const hasAny = !!(refreshToken || clientId || clientSecret)
      const hasAll = !!(refreshToken && clientId && clientSecret)

      if (hasAll) {
        return {
          mode: 'oauth',
          clientId: clientId!,
          clientSecret: clientSecret!,
          refreshToken: refreshToken!,
          cacheKey: `ws:${workspaceId}`,
        }
      }

      if (hasAny && !hasAll) {
        const slug = (ws.slug as string) ?? workspaceId
        throw new Error(
          `Workspace ${slug}: credenciales Drive incompletas en config_extra ` +
          `(requiere drive_refresh_token + drive_client_id + drive_client_secret)`,
        )
      }
      // hasAny === false → cae a env vars
    }
  }

  // Fallback global (env vars)
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Drive env vars no configuradas ' +
      '(GOOGLE_DRIVE_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN)',
    )
  }

  return {
    mode: 'oauth',
    clientId,
    clientSecret,
    refreshToken,
    cacheKey: GLOBAL_CACHE_KEY,
  }
}

/**
 * Refresh OAuth2 access token (con cache por workspace).
 * Si workspaceId esta presente y tiene credenciales propias en config_extra,
 * usa esas. Si no, cae a env vars.
 */
export async function getAccessToken(workspaceId?: string): Promise<string> {
  const creds = await resolveCredentials(workspaceId)

  // Return cached token if still valid
  const cached = tokenCache.get(creds.cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token
  }

  // ── Service account (domain-wide delegation): mint via JWT, no caduca ──
  if (creds.mode === 'service_account') {
    const { access_token, expires_in } = await mintServiceAccountToken(
      creds.saKeyRaw,
      creds.impersonate,
    )
    tokenCache.set(creds.cacheKey, {
      token: access_token,
      expiresAt: Date.now() + (expires_in - 60) * 1000,
    })
    return access_token
  }

  // ── OAuth refresh_token flow ──
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    console.error(
      `[google-drive] Token refresh failed (cacheKey=${creds.cacheKey}):`,
      res.status,
      errBody.slice(0, 500),
    )
    throw new Error(`Google Drive token refresh failed (${res.status})`)
  }

  const data = await res.json()
  // Cache with 60s safety margin
  tokenCache.set(creds.cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  })

  return data.access_token as string
}

// ── Folder operations ────────────────────────────────────────────────────────

/**
 * Create folder in Drive (idempotente — retorna existente si ya hay match por nombre).
 * Soporta Shared Drives via supportsAllDrives=true + includeItemsFromAllDrives=true.
 */
export async function createDriveFolder(
  name: string,
  parentId: string,
  workspaceId?: string,
): Promise<string> {
  const token = await getAccessToken(workspaceId)

  // Validate parentId format (Drive IDs are alphanumeric + hyphens + underscores)
  if (!/^[-\w]+$/.test(parentId)) {
    throw new Error(`parentId inválido: ${parentId.slice(0, 20)}`)
  }

  // Search for existing folder (Shared Drive friendly)
  const query = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const searchParams = new URLSearchParams({
    q: query,
    fields: 'files(id)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
  })

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${searchParams.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (searchRes.ok) {
    const searchData = await searchRes.json()
    if (searchData.files?.length > 0) {
      return searchData.files[0].id
    }
  } else {
    console.warn('[google-drive] Folder search failed, attempting create:', searchRes.status)
  }

  // Create new folder (supportsAllDrives obligatorio para Shared Drives)
  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    },
  )

  if (!createRes.ok) {
    const errBody = await createRes.text()
    console.error('[google-drive] Folder creation failed:', createRes.status, errBody.slice(0, 500))
    throw new Error(`Error creando carpeta en Drive (${createRes.status}): ${errBody.slice(0, 200)}`)
  }

  const folder = await createRes.json()
  return folder.id
}

/**
 * Crea (o reusa) una cadena de subcarpetas anidadas dentro de un parent.
 *
 * Acepta paths tipo "A/B/C" — divide por "/" y crea cada nivel con
 * createDriveFolder (find-or-create). Devuelve el id del folder mas anidado.
 *
 * Si path es vacio/null devuelve el parentId (no crea nada).
 */
export async function createSubfolderPath(
  path: string | null | undefined,
  parentId: string,
  workspaceId?: string,
): Promise<string> {
  if (!path) return parentId
  const parts = path.split('/').map(p => p.trim()).filter(Boolean)
  let current = parentId
  for (const part of parts) {
    current = await createDriveFolder(part, current, workspaceId)
  }
  return current
}

// ── File upload ──────────────────────────────────────────────────────────────

/** Upload file to Drive using multipart upload (Shared Drive friendly) */
export async function uploadFileToDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  folderId: string,
  workspaceId?: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const token = await getAccessToken(workspaceId)
  const boundary = `----MetrikUpload${Date.now()}`

  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
  })

  // Build multipart/related body
  const bodyParts = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    metadata,
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${mimeType}\r\n`,
    'Content-Transfer-Encoding: base64\r\n\r\n',
    buffer.toString('base64'),
    `\r\n--${boundary}--`,
  ]

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyParts.join(''),
    },
  )

  if (!res.ok) {
    const errBody = await res.text()
    console.error('[google-drive] Upload failed:', res.status, errBody.slice(0, 500))
    throw new Error(`Error subiendo archivo a Drive (${res.status})`)
  }

  const file = await res.json()
  return { fileId: file.id, webViewLink: file.webViewLink }
}

// ── Hojas nativas de Google (conversión de .xlsx) ────────────────────────────
//
// Drive convierte un .xlsx a hoja NATIVA de Google cuando el metadata declara
// `mimeType: application/vnd.google-apps.spreadsheet` y el media viaja con el
// mimeType del .xlsx. Eso es todo: NO hace falta la API de Sheets, y por lo tanto
// tampoco un scope nuevo. El service account de este producto ya pide
// `https://www.googleapis.com/auth/drive` (ver `mintServiceAccountToken`), que
// alcanza para crear, reemplazar contenido, leer la ficha y dar permisos.
//
// Pedir `spreadsheets` habría dejado el frente esperando a que el admin de
// Workspace del cliente ampliara la delegación — un trámite ajeno, sin fecha, y
// para nada que Drive no haga solo.

/** El mimeType de una hoja nativa de Google. Convertir = pedir este de destino. */
export const MIME_HOJA_GOOGLE = 'application/vnd.google-apps.spreadsheet'

/** El mimeType del .xlsx que sale de SheetJS. Es el media que se sube. */
export const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Arma el cuerpo multipart/related que Drive espera para metadata + media. */
function cuerpoMultipart(
  metadata: Record<string, unknown>,
  buffer: Buffer,
  mimeMedia: string,
): { boundary: string; body: string } {
  const boundary = `----MetrikUpload${Date.now()}`
  const body = [
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${mimeMedia}\r\n`,
    'Content-Transfer-Encoding: base64\r\n\r\n',
    buffer.toString('base64'),
    `\r\n--${boundary}--`,
  ].join('')
  return { boundary, body }
}

export interface ArchivoDriveCreado {
  fileId: string
  webViewLink: string
}

/**
 * Crea una hoja NATIVA de Google Sheets a partir de un buffer .xlsx.
 *
 * Devuelve el id y el enlace. El id es el que hay que guardar: el enlace se puede
 * reconstruir siempre desde él, pero al revés no.
 */
export async function crearHojaGoogleDesdeXlsx(
  buffer: Buffer,
  nombre: string,
  folderId: string,
  workspaceId?: string,
): Promise<ArchivoDriveCreado> {
  const token = await getAccessToken(workspaceId)
  const { boundary, body } = cuerpoMultipart(
    { name: nombre, parents: [folderId], mimeType: MIME_HOJA_GOOGLE },
    buffer,
    MIME_XLSX,
  )

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )

  if (!res.ok) {
    const errBody = await res.text()
    console.error('[google-drive] Crear hoja falló:', res.status, errBody.slice(0, 500))
    throw new Error(`Error creando la hoja en Drive (${res.status})`)
  }

  const file = await res.json()
  return { fileId: file.id as string, webViewLink: file.webViewLink as string }
}

/**
 * Reemplaza el CONTENIDO de una hoja de Google ya existente con un .xlsx nuevo.
 *
 * Mismo id, mismo enlace, mismos permisos: quien tenga el enlace guardado ve el dato
 * de hoy sin que nadie le mande nada. Ese es el punto del frente entero.
 *
 * Va por `multipart` y no por `uploadType=media` a propósito: con `media` no viaja
 * metadata, así que la conversión queda implícita en que el archivo destino ya sea una
 * hoja de Google. Declarando el `mimeType` de destino, la petición dice lo que quiere
 * en vez de depender de que el estado del archivo remoto sea el que suponemos — que es
 * justo lo que falla cuando alguien tocó el archivo por fuera.
 */
export async function reemplazarHojaGoogleDesdeXlsx(
  fileId: string,
  buffer: Buffer,
  workspaceId?: string,
): Promise<ArchivoDriveCreado> {
  const token = await getAccessToken(workspaceId)
  const { boundary, body } = cuerpoMultipart(
    { mimeType: MIME_HOJA_GOOGLE },
    buffer,
    MIME_XLSX,
  )

  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )

  if (!res.ok) {
    const errBody = await res.text()
    console.error('[google-drive] Reemplazar hoja falló:', res.status, errBody.slice(0, 500))
    throw new Error(`Error actualizando la hoja en Drive (${res.status})`)
  }

  const file = await res.json()
  return { fileId: file.id as string, webViewLink: file.webViewLink as string }
}

export interface FichaArchivo {
  id: string
  name: string
  trashed: boolean
  webViewLink: string | null
  /** `false` si el archivo existe pero esta cuenta no lo puede escribir. */
  puedeEditar: boolean
}

/**
 * Pide la ficha de un archivo. Devuelve `null` si NO existe o no es alcanzable.
 *
 * ⚠️ El `null` es deliberado y es la mitad del valor de esta función: un `file_id`
 * guardado puede apuntar a un archivo que alguien borró desde su propio Drive, y ahí
 * `files.update` responde 404 **para siempre**. Sin preguntar antes, el botón quedaría
 * roto de forma permanente y la única salida sería editar `config_extra` a mano.
 *
 * 404 y 403 se tratan igual (no alcanzable) porque para quien decide dan lo mismo: en
 * los dos casos hay que crear uno nuevo. Cualquier otro error SÍ se lanza — un 500 de
 * Google no es «el archivo no existe», y tratarlo como tal crearía un archivo nuevo
 * cada vez que Drive tenga un mal minuto, dejando huérfano el bueno.
 */
export async function obtenerFichaArchivo(
  fileId: string,
  workspaceId?: string,
): Promise<FichaArchivo | null> {
  const token = await getAccessToken(workspaceId)
  const params = new URLSearchParams({
    fields: 'id,name,trashed,webViewLink,capabilities/canEdit',
    supportsAllDrives: 'true',
  })

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (res.status === 404 || res.status === 403) return null
  if (!res.ok) {
    const errBody = await res.text()
    console.error('[google-drive] Ficha de archivo falló:', res.status, errBody.slice(0, 500))
    throw new Error(`Error leyendo el archivo en Drive (${res.status})`)
  }

  const f = await res.json()
  return {
    id: f.id as string,
    name: (f.name as string) ?? '',
    trashed: !!f.trashed,
    webViewLink: (f.webViewLink as string) ?? null,
    puedeEditar: f.capabilities?.canEdit !== false,
  }
}

/** Manda un archivo a la papelera (reversible, a diferencia de borrarlo). */
export async function moverArchivoAPapelera(
  fileId: string,
  workspaceId?: string,
): Promise<void> {
  const token = await getAccessToken(workspaceId)
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trashed: true }),
    },
  )
  if (!res.ok && res.status !== 404) {
    const errBody = await res.text()
    console.error('[google-drive] Enviar a papelera falló:', res.status, errBody.slice(0, 500))
    throw new Error(`Error enviando el archivo a la papelera (${res.status})`)
  }
}

// ── Permissions ──────────────────────────────────────────────────────────────

export interface PermisoArchivo {
  id: string
  type: string | null
  role: string | null
  emailAddress: string | null
}

/** Lista los permisos de un archivo (para no volver a conceder lo ya concedido). */
export async function listarPermisosArchivo(
  fileId: string,
  workspaceId?: string,
): Promise<PermisoArchivo[]> {
  const token = await getAccessToken(workspaceId)
  const out: PermisoArchivo[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      fields: 'nextPageToken, permissions(id,type,role,emailAddress)',
      pageSize: '100',
      supportsAllDrives: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) {
      const errBody = await res.text()
      console.error('[google-drive] Listar permisos falló:', res.status, errBody.slice(0, 500))
      throw new Error(`Error leyendo los permisos del archivo (${res.status})`)
    }
    const data = await res.json()
    out.push(...((data.permissions ?? []) as PermisoArchivo[]))
    pageToken = data.nextPageToken as string | undefined
  } while (pageToken)

  return out
}

/**
 * Da permiso de LECTURA a una persona concreta.
 *
 * `sendNotificationEmail=false` a propósito: quien oprime el botón puede hacerlo varias
 * veces al día, y aunque el permiso solo se concede cuando falta, un correo automático
 * de Google por cada cambio es ruido que se aprende a ignorar. A las personas de la
 * lista se les avisa una vez, por fuera, con contexto — no con una notificación de
 * Drive que parece spam.
 */
export async function compartirArchivoComoLector(
  fileId: string,
  email: string,
  workspaceId?: string,
): Promise<void> {
  const token = await getAccessToken(workspaceId)
  const params = new URLSearchParams({
    supportsAllDrives: 'true',
    sendNotificationEmail: 'false',
  })

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?${params.toString()}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: email }),
    },
  )

  if (!res.ok) {
    const errBody = await res.text()
    console.error(
      '[google-drive] Compartir falló:',
      res.status,
      errBody.slice(0, 300),
    )
    throw new Error(`Error compartiendo con ${email} (${res.status})`)
  }
}

/**
 * Make file accessible to anyone with the link (viewer).
 *
 * En Shared Drives con restricciones de permisos externos esta operacion puede
 * fallar con 403 — se hace downgrade a warning y se retorna void en vez de
 * crashear el flujo (el archivo ya fue subido, el link puede compartirse
 * manualmente o via permisos del Shared Drive).
 */
export async function setFilePublicByLink(
  fileId: string,
  workspaceId?: string,
): Promise<void> {
  const token = await getAccessToken(workspaceId)

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    },
  )

  if (!res.ok) {
    const errBody = await res.text()
    // 403: tipico de Shared Drives con restriccion de permisos externos.
    // No bloqueamos el flujo — el archivo ya esta en Drive.
    if (res.status === 403) {
      console.warn(
        '[google-drive] setFilePublicByLink 403 (probable Shared Drive restriction):',
        errBody.slice(0, 300),
      )
      return
    }
    console.error('[google-drive] Permission set failed:', res.status, errBody.slice(0, 500))
    throw new Error(`Error configurando permisos en Drive (${res.status})`)
  }
}

// ── File download/delete ─────────────────────────────────────────────────────

/** Download file from Drive (Shared Drive friendly) */
export async function downloadDriveFile(
  fileId: string,
  workspaceId?: string,
): Promise<Buffer> {
  const token = await getAccessToken(workspaceId)

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) {
    const errBody = await res.text()
    console.error('[google-drive] Download failed:', res.status, errBody.slice(0, 500))
    throw new Error(`Error descargando archivo de Drive (${res.status})`)
  }

  const arrBuf = await res.arrayBuffer()
  return Buffer.from(arrBuf)
}

/** Delete file from Drive (Shared Drive friendly) */
export async function deleteDriveFile(
  fileId: string,
  workspaceId?: string,
): Promise<void> {
  const token = await getAccessToken(workspaceId)

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  if (!res.ok && res.status !== 404) {
    const errBody = await res.text()
    console.error('[google-drive] Delete failed:', res.status, errBody.slice(0, 500))
    throw new Error(`Error eliminando archivo de Drive (${res.status})`)
  }
}

// ── Listado y export (transcripciones de Meet) ───────────────────────────────

export interface DriveFileMeta {
  id: string
  name: string
  mimeType: string
  createdTime: string
  modifiedTime: string
  webViewLink?: string
}

/**
 * Lista archivos de una carpeta de Drive.
 *
 * `modifiedAfter` filtra por fecha ISO (Drive espera RFC 3339). Se usa para
 * traer solo lo que llego en la ventana del cron, no la carpeta completa.
 * Pagina hasta agotar; el volumen esperado por dia es de unidades.
 */
export async function listDriveFolderFiles(
  folderId: string,
  opts: { modifiedAfter?: string; mimeType?: string } = {},
  workspaceId?: string,
): Promise<DriveFileMeta[]> {
  const token = await getAccessToken(workspaceId)

  const clauses = [`'${folderId}' in parents`, 'trashed = false']
  if (opts.modifiedAfter) clauses.push(`modifiedTime > '${opts.modifiedAfter}'`)
  if (opts.mimeType) clauses.push(`mimeType = '${opts.mimeType}'`)

  const out: DriveFileMeta[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      q: clauses.join(' and '),
      fields: 'nextPageToken, files(id,name,mimeType,createdTime,modifiedTime,webViewLink)',
      orderBy: 'createdTime',
      pageSize: '100',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error('[google-drive] List failed:', res.status, errBody.slice(0, 500))
      throw new Error(`Error listando carpeta de Drive (${res.status})`)
    }

    const data = await res.json()
    out.push(...((data.files ?? []) as DriveFileMeta[]))
    pageToken = data.nextPageToken as string | undefined
  } while (pageToken)

  return out
}

/**
 * Exporta un Google Doc nativo a texto plano.
 *
 * Las transcripciones de Meet se guardan como Google Doc, no como archivo
 * binario: `?alt=media` devuelve 403 sobre ellas. La ruta correcta es
 * `/export`, que no acepta `supportsAllDrives` (no lo necesita).
 */
export async function exportGoogleDocAsText(
  fileId: string,
  workspaceId?: string,
): Promise<string> {
  const token = await getAccessToken(workspaceId)

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text%2Fplain`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) {
    const errBody = await res.text()
    console.error('[google-drive] Export failed:', res.status, errBody.slice(0, 500))
    throw new Error(`Error exportando Google Doc (${res.status})`)
  }

  return await res.text()
}
