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
