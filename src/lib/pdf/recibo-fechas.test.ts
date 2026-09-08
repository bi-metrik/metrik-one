/**
 * Las DOS fechas del recibo salen legibles.
 *
 * EL CASO QUE IMPORTA: `fechaLegible` se aplicaba solo a `fecha`. RC-1-67 salió con
 * "31 de marzo de 2026" al lado de "2026-03-31": el mismo día escrito de dos formas, una
 * de ellas en formato de base de datos, en un documento que recibe el cliente.
 *
 * El propio comentario del código decía que el cliente no debería recibir una fecha en
 * formato de base de datos. La regla estaba escrita; faltaba aplicarla al campo nuevo.
 *
 * SE VIO FALLAR contra la implementación anterior:
 *   - "la fecha del pago sale legible" → salía en ISO
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'

let enviado: Record<string, unknown> | null

const fetchOriginal = global.fetch

// Las env vars se leen al IMPORTAR el módulo, no al llamarlo: van antes del import.
process.env.METRIK_PDF_RENDER_URL = 'https://render.ejemplo'
process.env.METRIK_PDF_RENDER_SECRET = 's3cr3t'
// El cliente firma un JWT con la llave de la service account, así que la llave tiene
// que ser real aunque sea de mentiras: una cadena cualquiera revienta en el firmado y la
// prueba nunca llega a mirar lo que nos importa.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
process.env.METRIK_PDF_RENDER_SA_KEY = JSON.stringify({
  client_email: 'render@ejemplo.iam.gserviceaccount.com',
  private_key: privateKey,
  token_uri: 'https://oauth2.ejemplo/token',
})

beforeEach(() => {
  enviado = null
  global.fetch = vi.fn(async (url: unknown, init?: { body?: string }) => {
    // El primer fetch es por el ID token de Google; el segundo es el render.
    if (String(url).includes('oauth2.ejemplo')) {
      return new Response(JSON.stringify({ id_token: 'tok' }), { status: 200 })
    }
    enviado = (JSON.parse(init?.body ?? '{}') as { data: Record<string, unknown> }).data
    return new Response(Buffer.from('%PDF'), { status: 200 })
  }) as unknown as typeof fetch
})

afterEach(() => { global.fetch = fetchOriginal })

const { renderReciboCaja } = await import('./pdf-render-client')

const BASE = {
  numero: 'RC-1-67',
  cliente_nombre: 'JORGE ANDRES SUESCUN CHACON',
  cliente_identificacion: '94552806',
  negocio_codigo: 'V0134',
  valor: 297500,
  concepto: 'Dinero recibido del cliente',
}

describe('renderReciboCaja — ninguna fecha sale en formato de base de datos', () => {
  it('la fecha del pago sale legible, igual que la del recibo', async () => {
    await renderReciboCaja('soena', { ...BASE, fecha: '2026-03-31', fecha_pago: '2026-03-31' })

    expect(enviado!.fecha).toBe('31 de marzo de 2026')
    expect(enviado!.fecha_pago).toBe('31 de marzo de 2026')
  })

  it('cuando difieren, las dos siguen siendo legibles', async () => {
    await renderReciboCaja('soena', { ...BASE, fecha: '2026-09-07', fecha_pago: '2026-02-17' })

    expect(enviado!.fecha).toBe('7 de septiembre de 2026')
    expect(enviado!.fecha_pago).toBe('17 de febrero de 2026')
  })
})
