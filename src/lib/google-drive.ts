// ============================================================
// Google Drive API Helper — REST fetch (no SDK)
// Sube archivos a Drive y los hace accesibles por link.
// Server-only — NEVER import from client components.
// ============================================================

// ── Token cache ──────────────────────────────────────────────────────────────

let cachedToken: string | null = null
let tokenExpiresAt = 0

/** Refresh OAuth2 access token using refresh_token */
export async function getAccessToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken

  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Drive env vars no configuradas (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN)')
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    console.error('[google-drive] Token refresh failed:', res.status, errBody.slice(0, 500))
    throw new Error(`Google Drive token refresh failed (${res.status})`)
  }

  const data = await res.json()
  cachedToken = data.access_token
  // Cache with 60s safety margin
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000

  return cachedToken!
}

// ── Folder operations ────────────────────────────────────────────────────────

/** Create folder in Drive (idempotent — returns existing if name matches within parent) */
export async function createDriveFolder(name: string, parentId: string): Promise<string> {
  const token = await getAccessToken()

  // Validate parentId format (Drive IDs are alphanumeric + hyphens + underscores)
  if (!/^[-\w]+$/.test(parentId)) {
    throw new Error(`parentId inválido: ${parentId.slice(0, 20)}`)
  }

  // Search for existing folder
  const query = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (searchRes.ok) {
    const searchData = await searchRes.json()
    if (searchData.files?.length > 0) {
      return searchData.files[0].id
    }
  } else {
    console.warn('[google-drive] Folder search failed, attempting create:', searchRes.status)
  }

  // Create new folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
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
  })

  if (!createRes.ok) {
    const errBody = await createRes.text()
    console.error('[google-drive] Folder creation failed:', createRes.status, errBody.slice(0, 500))
    throw new Error(`Error creando carpeta en Drive (${createRes.status})`)
  }

  const folder = await createRes.json()
  return folder.id
}

// ── File upload ──────────────────────────────────────────────────────────────

/** Upload file to Drive using multipart upload */
export async function uploadFileToDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  folderId: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const token = await getAccessToken()
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
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
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

/** Make file accessible to anyone with the link (viewer) */
export async function setFilePublicByLink(fileId: string): Promise<void> {
  const token = await getAccessToken()

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
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
    console.error('[google-drive] Permission set failed:', res.status, errBody.slice(0, 500))
    throw new Error(`Error configurando permisos en Drive (${res.status})`)
  }
}
