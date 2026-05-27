/**
 * OAuth bootstrap — obtiene refresh_token de Google Drive para un workspace.
 *
 * Levanta un servidor local en localhost:8080 que captura el callback OAuth.
 * Imprime una URL para abrir en el navegador, donde el admin del workspace
 * autoriza el acceso. Al callback se intercambia el code por refresh_token y
 * se imprime en consola.
 *
 * Uso:
 *   WS_DRIVE_CLIENT_ID=xxx WS_DRIVE_CLIENT_SECRET=xxx npx tsx scripts/oauth-bootstrap.ts
 *
 * Pasos:
 *   1. Ejecutar este comando con las credenciales del OAuth Client
 *   2. Abrir la URL impresa en el navegador (loggeado con la cuenta admin del cliente)
 *   3. Aceptar el scope drive
 *   4. El script captura el callback y muestra el refresh_token
 *   5. Setear ese refresh_token como WS_DRIVE_REFRESH_TOKEN y correr setup-drive-workspace.ts
 */

import http from 'http'
import { URL } from 'url'

const REDIRECT_URI = 'http://localhost:8080/oauth/callback'
const SCOPE = 'https://www.googleapis.com/auth/drive'

const clientId = process.env.WS_DRIVE_CLIENT_ID
const clientSecret = process.env.WS_DRIVE_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error('Faltan env vars: WS_DRIVE_CLIENT_ID y WS_DRIVE_CLIENT_SECRET')
  process.exit(1)
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
authUrl.searchParams.set('client_id', clientId)
authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('scope', SCOPE)
authUrl.searchParams.set('access_type', 'offline')
authUrl.searchParams.set('prompt', 'consent') // fuerza emisión de refresh_token

console.log('\n→ Abre esta URL en el navegador (loggeado con cuenta admin del workspace):\n')
console.log(authUrl.toString())
console.log('\n→ Esperando callback en http://localhost:8080/oauth/callback ...\n')

async function exchangeCodeForTokens(code: string): Promise<void> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error(`\n[!] Exchange falló (${res.status}): ${body}`)
    process.exit(1)
  }
  const tokens = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
    token_type: string
  }

  if (!tokens.refresh_token) {
    console.error('\n[!] Google NO devolvió refresh_token. Posibles causas:')
    console.error('    - La cuenta ya autorizó esta app antes. Solución: revoca el acceso en https://myaccount.google.com/permissions y vuelve a correr.')
    console.error('    - El prompt=consent no se aplicó.')
    process.exit(1)
  }

  console.log('\n\n✓ OAuth completado con éxito.\n')
  console.log('─'.repeat(60))
  console.log('REFRESH TOKEN (cópialo, no se vuelve a mostrar):\n')
  console.log(tokens.refresh_token)
  console.log('─'.repeat(60))
  console.log('\nPróximo paso:\n')
  console.log('  WS_DRIVE_REFRESH_TOKEN="<token>" \\')
  console.log('  WS_DRIVE_CLIENT_ID="' + clientId + '" \\')
  console.log('  WS_DRIVE_CLIENT_SECRET="<secret>" \\')
  console.log('  npx tsx scripts/setup-drive-workspace.ts <slug> <folder_id>')
  console.log('')
}

const server = http.createServer(async (req, res) => {
  if (!req.url) return
  const url = new URL(req.url, REDIRECT_URI)
  if (url.pathname !== '/oauth/callback') {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html' })
    res.end(`<h1>Error OAuth</h1><p>${error}</p><p>Cierra esta pestaña y revisa la consola.</p>`)
    console.error(`\n[!] OAuth error: ${error}`)
    process.exit(1)
  }
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' })
    res.end('<h1>Falta el code</h1>')
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end('<h1>OAuth completado</h1><p>Cierra esta pestaña y vuelve a la terminal — el refresh token aparece allí.</p>')
  await exchangeCodeForTokens(code)
  server.close()
  process.exit(0)
})

server.listen(8080, () => {
  // listo
})
