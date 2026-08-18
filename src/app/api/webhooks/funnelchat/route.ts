import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Receptor de lo que FunnelChat manda hacia ONE.
//
// Estado: es una BITACORA, no todavia una integracion. Registra lo que llega y no
// escribe nada del negocio. Existe para resolver por envio real una contradiccion
// que el soporte no resolvio: el 2026-08-14 FunnelChat respondio que no puede
// enviar datos salientes desde las automatizaciones de los flujos (nota del
// 2026-05-04), mientras su documentacion describe un paso de peticion HTTP dentro
// de los flujos. Si una fila aparece aqui, la funcion existe.
//
// ⚠️ Se registra ANTES de validar el token. Un 401 que no deja rastro vuelve
// indistinguibles "no llego nada" y "llego y lo rechace", y esa ambiguedad es
// justo lo que hace inutil la prueba. El veredicto viaja en `autenticado`.
//
// ⚠️ Responde 200 aunque el token no sirva, para que la rama de exito del flujo
// se encienda y quien lo configura vea que el envio salio. El cuerpo dice la
// verdad (`autenticado: false`), y una fila sin autenticar no habilita nada.
//
// El token vive en `workspaces.config_extra.funnelchat.webhook_token` (server-only,
// mismo trato que las credenciales de Siigo) y ademas identifica al workspace: es
// lo unico que trae la peticion para saber de quien es.

const MAX_BYTES = 64 * 1024

/** Cabeceras que nunca se guardan: llevan la credencial. */
const HEADERS_SENSIBLES = new Set([
  'authorization',
  'x-metrik-token',
  'x-api-key',
  'cookie',
])

function headersSeguros(request: NextRequest): Record<string, string> {
  const out: Record<string, string> = {}
  request.headers.forEach((valor, nombre) => {
    const k = nombre.toLowerCase()
    out[k] = HEADERS_SENSIBLES.has(k) ? '[redactado]' : valor
  })
  return out
}

/** El token puede venir por cabecera o por query. La cabecera es la via buena; la
 *  query queda como respaldo porque una herramienta ajena puede no dejar poner
 *  cabeceras, y quedarse sin prueba por ese detalle seria absurdo. Nunca se guarda. */
function leerToken(request: NextRequest): string | null {
  const h =
    request.headers.get('x-metrik-token') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null
  if (h) return h.trim() || null
  const q = request.nextUrl.searchParams.get('token')
  return q?.trim() || null
}

async function registrar(request: NextRequest, crudo: string) {
  // funnelchat_eventos aun no esta en los tipos generados (database.ts). Cast puntual,
  // mismo patron que el receptor de kyc. Pendiente: regenerar tipos + re-agregar aliases.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any

  let payload: Record<string, unknown>
  try {
    const parsed = crudo ? JSON.parse(crudo) : {}
    payload =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { _valor: parsed }
  } catch {
    // Un cuerpo que no es JSON tambien se guarda: saber QUE mando es parte de la
    // prueba, y descartarlo dejaria la fila diciendo que no llego nada.
    payload = { _raw: crudo.slice(0, MAX_BYTES) }
  }

  const token = leerToken(request)
  let workspaceId: string | null = null
  let motivo: string | null = null

  if (!token) {
    motivo = 'sin token'
  } else {
    const { data, error } = await supabase
      .from('workspaces')
      .select('id')
      .eq('config_extra->funnelchat->>webhook_token', token)
      .maybeSingle()
    if (error) {
      // El error de la consulta NO se descarta: sin esto, un fallo de base se
      // leeria como "token invalido" y mandaria a revisar la configuracion de
      // FunnelChat, que estaria bien.
      motivo = `no se pudo resolver el token: ${error.message}`
    } else if (data) {
      workspaceId = (data as { id: string }).id
    } else {
      motivo = 'token no reconocido'
    }
  }

  const { data: fila } = await supabase
    .from('funnelchat_eventos')
    .insert({
      workspace_id: workspaceId,
      metodo: request.method,
      content_type: request.headers.get('content-type'),
      headers: headersSeguros(request),
      payload,
      bytes: crudo.length,
      autenticado: workspaceId !== null,
      motivo,
    })
    .select('id')
    .single()

  return {
    ok: true,
    autenticado: workspaceId !== null,
    motivo,
    evento_id: (fila as { id: string } | null)?.id ?? null,
  }
}

export async function POST(request: NextRequest) {
  const crudo = await request.text()
  if (crudo.length > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'cuerpo_demasiado_grande' }, { status: 413 })
  }
  return NextResponse.json(await registrar(request, crudo))
}

// FunnelChat tambien ofrece GET en su paso de peticion HTTP. Se acepta para que la
// prueba no dependa de acertar el metodo a la primera.
export async function GET(request: NextRequest) {
  return NextResponse.json(await registrar(request, ''))
}
