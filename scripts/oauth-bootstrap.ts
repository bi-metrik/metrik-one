/**
 * OAuth bootstrap — obtiene un refresh_token de Google para Drive (+ Calendar).
 *
 * Levanta un servidor local en localhost:8080 que captura el callback OAuth.
 * Imprime una URL para abrir en el navegador, donde se autoriza el acceso.
 * Al callback intercambia el code por refresh_token y lo imprime en consola.
 *
 * Dos usos:
 *
 *  A) Credencial GLOBAL de MeTRIK (cuenta mauricio.moreno@metrik.com.co).
 *     Es la que usa el workspace `metrik`, y la que necesita Calendar para el
 *     frente de actas automaticas.
 *
 *       GOOGLE_DRIVE_CLIENT_ID=xxx GOOGLE_DRIVE_CLIENT_SECRET=xxx \
 *       npx tsx scripts/oauth-bootstrap.ts
 *
 *     El token resultante va a la env var GOOGLE_DRIVE_REFRESH_TOKEN en Vercel.
 *
 *  B) Credencial per-workspace de un cliente (flujo original).
 *
 *       WS_DRIVE_CLIENT_ID=xxx WS_DRIVE_CLIENT_SECRET=xxx \
 *       npx tsx scripts/oauth-bootstrap.ts
 *
 *     Luego: setup-drive-workspace.ts <slug> <folder_id>
 *
 * Scopes: por defecto pide Drive Y Calendar de solo lectura. El refresh_token
 * carga el conjunto de scopes concedidos en el momento del consentimiento, asi
 * que hay que pedirlos TODOS a la vez: pedir solo Calendar dejaria a Drive sin
 * acceso y romperia lo que ya funciona. El script verifica que Google haya
 * concedido los dos y aborta si falta alguno.
 *
 * Para pedir otro conjunto: OAUTH_SCOPES="url1 url2" npx tsx ...
 *
 * Requisito en Google Cloud Console, sobre el OAuth Client que se use:
 *   - `http://localhost:8080/oauth/callback` en URIs de redireccion autorizados.
 *   - El scope de Calendar habilitado en la pantalla de consentimiento.
 */

import http from 'http'
import { URL } from 'url'

const REDIRECT_URI = 'http://localhost:8080/oauth/callback'

const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive'
const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.readonly'

const SCOPES = (process.env.OAUTH_SCOPES ?? `${SCOPE_DRIVE} ${SCOPE_CALENDAR}`)
  .split(/\s+/)
  .filter(Boolean)

const esGlobal = !!process.env.GOOGLE_DRIVE_CLIENT_ID
const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID ?? process.env.WS_DRIVE_CLIENT_ID
const clientSecret =
  process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? process.env.WS_DRIVE_CLIENT_SECRET

if (!clientId || !clientSecret) {
  console.error('Faltan credenciales del OAuth Client. Usa una de las dos parejas:')
  console.error('  GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET   (credencial global)')
  console.error('  WS_DRIVE_CLIENT_ID / WS_DRIVE_CLIENT_SECRET           (per-workspace)')
  process.exit(1)
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
authUrl.searchParams.set('client_id', clientId)
authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('scope', SCOPES.join(' '))
authUrl.searchParams.set('access_type', 'offline')
authUrl.searchParams.set('include_granted_scopes', 'true')
authUrl.searchParams.set('prompt', 'consent') // fuerza emisión de refresh_token

console.log(`\nModo: ${esGlobal ? 'credencial GLOBAL de MeTRIK' : 'credencial per-workspace'}`)
console.log('\nScopes solicitados:')
for (const s of SCOPES) console.log(`  - ${s}`)
console.log('\n→ Abre esta URL en el navegador (loggeado con la cuenta dueña de los archivos):\n')
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

  // Verificacion dura: el token nuevo REEMPLAZA al viejo. Si Google no concedió
  // todos los scopes pedidos, guardarlo rompe lo que hoy funciona.
  const concedidos = (tokens.scope ?? '').split(/\s+/).filter(Boolean)
  const faltantes = SCOPES.filter((s) => !concedidos.includes(s))

  console.log('\nScopes concedidos por Google:')
  for (const s of concedidos) console.log(`  - ${s}`)

  if (faltantes.length > 0) {
    console.error('\n[!] ABORTADO — Google no concedió todos los scopes pedidos.')
    for (const s of faltantes) console.error(`    falta: ${s}`)
    console.error('\n    NO guardes este token: reemplazaría al actual y dejaría')
    console.error('    sin acceso a lo que hoy funciona.')
    console.error('\n    Revisa en Google Cloud Console que el scope esté habilitado')
    console.error('    en la pantalla de consentimiento del OAuth Client, y repite.')
    process.exit(1)
  }

  console.log('\n✓ OAuth completado. Todos los scopes concedidos.\n')
  console.log('─'.repeat(60))
  console.log('REFRESH TOKEN (cópialo, no se vuelve a mostrar):\n')
  console.log(tokens.refresh_token)
  console.log('─'.repeat(60))
  console.log('\nPróximo paso:\n')
  if (esGlobal) {
    console.log('  Reemplaza GOOGLE_DRIVE_REFRESH_TOKEN en Vercel (Production,')
    console.log('  Preview y Development) con el token de arriba, y redeploy.')
    console.log('')
    console.log('  Verificación: el cron /api/crons/drive-health debe seguir en verde.')
  } else {
    console.log('  WS_DRIVE_REFRESH_TOKEN="<token>" \\')
    console.log('  WS_DRIVE_CLIENT_ID="' + clientId + '" \\')
    console.log('  WS_DRIVE_CLIENT_SECRET="<secret>" \\')
    console.log('  npx tsx scripts/setup-drive-workspace.ts <slug> <folder_id>')
  }
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
