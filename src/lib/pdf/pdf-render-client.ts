// ============================================================
// PDF Render Client — llama al servicio metrik-pdf-render (Cloud Run + WeasyPrint)
// ============================================================
// Spec: metrik-one/docs/specs/2026-05-15_pdf-render-weasyprint-serverless.md
//
// Flujo de autenticacion:
//   1. SA key JSON en env METRIK_PDF_RENDER_SA_KEY (raw JSON, no base64)
//   2. Mintea Google ID token via JWT bearer flow (target_audience = service URL)
//   3. Llama al endpoint con Authorization: Bearer <id_token> + X-MeTRIK-Secret
//
// Env vars requeridas:
//   METRIK_PDF_RENDER_URL     — https://metrik-pdf-render-xxx.us-east1.run.app
//   METRIK_PDF_RENDER_SECRET  — shared secret (32 bytes hex)
//   METRIK_PDF_RENDER_SA_KEY  — SA key JSON (raw, single-line)
//
// Si alguna env var falta, isPdfRenderConfigured() retorna false y el caller debe usar fallback.
// ============================================================

import { createSign } from 'crypto'

const RENDER_URL = process.env.METRIK_PDF_RENDER_URL
const RENDER_SECRET = process.env.METRIK_PDF_RENDER_SECRET
const SA_KEY_RAW = process.env.METRIK_PDF_RENDER_SA_KEY

export function isPdfRenderConfigured(): boolean {
  return Boolean(RENDER_URL && RENDER_SECRET && SA_KEY_RAW)
}

type ServiceAccount = {
  client_email: string
  private_key: string
  token_uri?: string
}

let cachedToken: { token: string; expiresAt: number } | null = null

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf as Buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function parseServiceAccount(): ServiceAccount {
  if (!SA_KEY_RAW) {
    throw new Error('METRIK_PDF_RENDER_SA_KEY no configurada')
  }
  try {
    const sa = JSON.parse(SA_KEY_RAW)
    if (!sa.client_email || !sa.private_key) {
      throw new Error('SA key invalida — falta client_email o private_key')
    }
    return sa
  } catch (e) {
    throw new Error(`METRIK_PDF_RENDER_SA_KEY no es JSON valido: ${(e as Error).message}`)
  }
}

async function getIdToken(audience: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)

  // Cache valido por 5 min antes de expirar
  if (cachedToken && cachedToken.expiresAt - 300 > now) {
    return cachedToken.token
  }

  const sa = parseServiceAccount()
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token'

  // JWT signed con SA key, claim target_audience para obtener ID token (no access token)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
    target_audience: audience,
  }

  const headerB64 = b64urlEncode(JSON.stringify(header))
  const claimsB64 = b64urlEncode(JSON.stringify(claims))
  const signingInput = `${headerB64}.${claimsB64}`

  const signer = createSign('RSA-SHA256')
  signer.update(signingInput)
  const signature = signer.sign(sa.private_key)
  const sigB64 = b64urlEncode(signature)

  const assertion = `${signingInput}.${sigB64}`

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Token exchange falló (${res.status}): ${txt}`)
  }

  const data = (await res.json()) as { id_token?: string }
  if (!data.id_token) {
    throw new Error('Token exchange no retornó id_token')
  }

  cachedToken = { token: data.id_token, expiresAt: now + 3600 }
  return data.id_token
}

// ============================================================
// API publica: renderCotizacion
// ============================================================

export type CotizacionRenderItem = {
  numero: number
  descripcion: string
  cantidad: string
  valor_unitario: string
  valor_total: string
}

export type CotizacionRenderPayload = {
  numero_cot: string
  cliente: string
  nit_cliente: string
  proyecto: string
  fecha: string
  items: CotizacionRenderItem[]
  subtotal: string
  iva_pct: number
  iva_valor: string
  valor_total_con_iva: string
  lugar_entrega: string
  validez_dias: number
  tiempo_entrega: string
  observaciones_extra: string[]
  powered_by_metrik: boolean
}

export async function renderCotizacion(
  templateSlug: string,
  data: CotizacionRenderPayload,
): Promise<Buffer> {
  if (!isPdfRenderConfigured()) {
    throw new Error('PDF render service no configurado (faltan env vars)')
  }

  const url = `${RENDER_URL}/render/cotizacion`
  const token = await getIdToken(RENDER_URL!)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-MeTRIK-Secret': RENDER_SECRET!,
    },
    body: JSON.stringify({ template_slug: templateSlug, data }),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`PDF render falló (${res.status}): ${txt.slice(0, 300)}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ============================================================
// API publica: renderCuentaCobro
// ============================================================

export type CuentaCobroConcepto = {
  detalle: string
  monto: string  // formato '$1.750.000'
}

export type CuentaCobroRenderPayload = {
  numero: string
  lugar_emision: string
  fecha_emision_letras: string
  fecha_vencimiento_letras: string
  emisor_nombre: string
  emisor_documento: string
  emisor_documento_sin_dv: string
  emisor_regimen: string
  emisor_direccion: string
  emisor_email: string
  emisor_telefono: string
  emisor_ciiu: string
  pagador_nombre: string
  pagador_nit: string
  pagador_direccion: string
  pagador_representante: string
  pagador_email: string
  pagador_telefono: string
  concepto_titulo: string
  concepto_parrafos: string
  conceptos: CuentaCobroConcepto[]
  total_label: string
  total_formato: string
  total_letras: string
  nota_redondeo: string
  banco_nombre: string
  banco_tipo: string
  banco_numero: string
  banco_titular: string
  banco_identificacion: string
  nota_pila_html: string
  año_gravable_declaracion: string
}

export async function renderCuentaCobro(
  templateSlug: string,
  data: CuentaCobroRenderPayload,
  isDraft: boolean = false,
): Promise<Buffer> {
  if (!isPdfRenderConfigured()) {
    throw new Error('PDF render service no configurado (faltan env vars)')
  }

  const url = `${RENDER_URL}/render/cuenta-cobro`
  const token = await getIdToken(RENDER_URL!)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-MeTRIK-Secret': RENDER_SECRET!,
    },
    body: JSON.stringify({
      template_slug: templateSlug,
      is_draft: isDraft,
      data,
    }),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`PDF render cuenta-cobro falló (${res.status}): ${txt.slice(0, 300)}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ============================================================
// API publica: renderPropuestaEconomica
// ============================================================

export type PropuestaEconomicaRenderPayload = {
  cliente_nombre: string
  cliente_documento: string
  fecha_emision: string         // "11/03/2026"
  validez_desde: string         // "1 de marzo de 2026"
  validez_hasta: string         // "31 de marzo de 2026"
  plan1_valor: string           // "$850.000"
  plan1_anticipo: string        // "$425.000"
  plan1_exito_iva: string       // "$425.000"
  plan2_valor: string           // "$637.500"
  descuento_pct: string         // "25%"
  ahorro: string                // "$212.500"
  version: number               // 1, 2, 3...
}

export async function renderPropuestaEconomica(
  templateSlug: string,
  data: PropuestaEconomicaRenderPayload,
): Promise<Buffer> {
  if (!isPdfRenderConfigured()) {
    throw new Error('PDF render service no configurado (faltan env vars)')
  }

  const url = `${RENDER_URL}/render/propuesta-economica`
  const token = await getIdToken(RENDER_URL!)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-MeTRIK-Secret': RENDER_SECRET!,
    },
    body: JSON.stringify({ template_slug: templateSlug, data }),
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`PDF render propuesta-economica falló (${res.status}): ${txt.slice(0, 300)}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
