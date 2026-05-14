// ============================================================
// Google Drive API Helper — REST fetch (no SDK)
// Soporta OAuth per-workspace + Shared Drives.
//
// Modos de credenciales:
//   1. Per-workspace (preferido si workspaceId tiene config_extra.drive_*):
//      Lee refresh_token + client_id + client_secret de
//      `workspaces.config_extra` con el service client.
//   2. Global (fallback): env vars GOOGLE_DRIVE_CLIENT_ID /
//      CLIENT_SECRET / REFRESH_TOKEN — corresponde al OAuth de MeTRIK
//      (cuenta mauricio.moreno@metrik.com.co).
//
// Todas las requests pasan supportsAllDrives=true para soportar
// Unidades Compartidas (Shared Drives).
//
// Server-only — NEVER import from client components.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'

// ── Token cache (por workspace) ──────────────────────────────────────────────

const GLOBAL_CACHE_KEY = '__global__'

interface CachedToken {
  token: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()

interface DriveCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  cacheKey: string
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
      const refreshToken = cfg.drive_refresh_token as string | undefined
      const clientId = cfg.drive_client_id as string | undefined
      const clientSecret = cfg.drive_client_secret as string | undefined

      const hasAny = !!(refreshToken || clientId || clientSecret)
      const hasAll = !!(refreshToken && clientId && clientSecret)

      if (hasAll) {
        return {
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

// ── Permissions ──────────────────────────────────────────────────────────────

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
