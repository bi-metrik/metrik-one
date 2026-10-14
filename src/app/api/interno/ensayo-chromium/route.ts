/**
 * Ensayo de Chromium en Vercel (PR 0 de la propuesta de Trappvel, 2026-10-14).
 *
 * Responde la pregunta «¿el PDF del prototipo se puede imprimir dentro de una función de
 * Vercel?» con números: tiempo por fase (arranque en frío incluido), memoria y peso.
 * No lo usa ninguna pantalla y no toca el PDF de @react-pdf.
 *
 * - `GET`              → imprime el fixture (`src/lib/pdf/chromium/ensayo/doc.html`) y
 *                        devuelve el PDF; las medidas van en la cabecera `x-ensayo-medidas`.
 * - `GET ?formato=json` → solo las medidas y el entorno de la función, en JSON.
 * - `POST` (cuerpo = HTML) → imprime ese HTML. Solo platform admin.
 *
 * Acceso: ver `accesoAlEnsayo`. En un preview el GET queda abierto (detrás del SSO de
 * Vercel) para poder medirlo con `vercel curl` sin sesión de ONE.
 */
import os from 'node:os'
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { usuarioDesdeToken } from '@/lib/supabase/claims-user'
import { accesoAlEnsayo, MAX_BYTES_HTML_ENSAYO } from '@/lib/pdf/chromium/acceso-ensayo'
import { htmlDelEnsayo } from '@/lib/pdf/chromium/ensayo'
import { imprimirHtmlAPdf } from '@/lib/pdf/chromium/render-chromium'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SIN_CACHE = { 'Cache-Control': 'no-store' }

/** Momento en que este módulo se cargó: si es reciente, la instancia arrancó en frío. */
const CARGADO_EN = Date.now()
let impresiones = 0

async function esPlatformAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { user } = await usuarioDesdeToken(supabase)
  if (!user) return false
  // No se usa `leerPlatformAdmin`: ese asume «sí» si no puede leer (lado seguro para negar
  // un permiso del dueño). Aquí el lado seguro es el contrario: sin lectura, no hay acceso.
  const { data, error } = await createServiceClient()
    .from('profiles')
    .select('platform_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (error || !data) return false
  return data.platform_admin === true
}

async function autorizar(request: Request): Promise<NextResponse | null> {
  if (accesoAlEnsayo({ vercelEnv: process.env.VERCEL_ENV, metodo: request.method }) === 'abierto') return null
  if (await esPlatformAdmin()) return null
  return NextResponse.json({ error: 'Solo platform admin' }, { status: 404, headers: SIN_CACHE })
}

function entorno() {
  return {
    vercelEnv: process.env.VERCEL_ENV ?? null,
    region: process.env.VERCEL_REGION ?? null,
    node: process.version,
    cpus: os.cpus().length,
    memoriaTotalMb: Math.round(os.totalmem() / 1024 / 1024),
    instanciaCargadaHaceMs: Date.now() - CARGADO_EN,
    impresionesEnEstaInstancia: impresiones,
  }
}

async function imprimir(html: string, pie?: string) {
  impresiones++
  return imprimirHtmlAPdf(html, { pie })
}

export async function GET(request: Request) {
  const negado = await autorizar(request)
  if (negado) return negado

  const ensayo = htmlDelEnsayo()
  try {
    const { pdf, medidas } = await imprimir(ensayo.html, ensayo.pie)
    const cuerpo = {
      medidas,
      fotosIncrustadas: ensayo.fotosIncrustadas,
      fotosFaltantes: ensayo.fotosFaltantes,
      entorno: entorno(),
    }
    console.log('[ensayo-chromium]', JSON.stringify(cuerpo))
    if (new URL(request.url).searchParams.get('formato') === 'json') {
      return NextResponse.json(cuerpo, { headers: SIN_CACHE })
    }
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        ...SIN_CACHE,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="ensayo-chromium.pdf"',
        'x-ensayo-medidas': JSON.stringify(cuerpo),
      },
    })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    console.error('[ensayo-chromium] falló', mensaje)
    return NextResponse.json({ error: mensaje.slice(0, 500), entorno: entorno() }, { status: 500, headers: SIN_CACHE })
  }
}

export async function POST(request: Request) {
  const negado = await autorizar(request)
  if (negado) return negado

  const declarado = Number(request.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_HTML_ENSAYO) {
    return NextResponse.json({ error: 'HTML demasiado grande' }, { status: 413, headers: SIN_CACHE })
  }
  const html = await request.text()
  if (!html.trim() || Buffer.byteLength(html) > MAX_BYTES_HTML_ENSAYO) {
    return NextResponse.json({ error: 'HTML vacío o demasiado grande' }, { status: 400, headers: SIN_CACHE })
  }
  try {
    const { pdf, medidas } = await imprimir(html)
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        ...SIN_CACHE,
        'Content-Type': 'application/pdf',
        'x-ensayo-medidas': JSON.stringify({ medidas, entorno: entorno() }),
      },
    })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: mensaje.slice(0, 500) }, { status: 500, headers: SIN_CACHE })
  }
}
