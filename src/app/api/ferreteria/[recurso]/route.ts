import { NextRequest, NextResponse } from 'next/server'
import { atenderPeticion } from '@/lib/ferreteria/api'
import { repoSupabase } from '@/lib/ferreteria/repo-supabase'

// Endpoint del módulo Ferretería para el agente de MeTRIK y el cron del Mac.
// Contrato: `src/lib/ferreteria/api.ts` y `docs/specs/2026-09-24_modulo-ferreteria-dimpro.md` §5.
// La lógica vive en `src/lib`: un route.ts de Next no puede exportar helpers.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function atender(request: NextRequest, recurso: string, metodo: 'GET' | 'POST') {
  // Un cuerpo que no es JSON queda en null y lo rechaza el contrato (400) DESPUÉS de autenticar:
  // sin token, la respuesta es 401 pase lo que pase con el cuerpo.
  let cuerpo: unknown = null
  if (metodo === 'POST') cuerpo = await request.json().catch(() => null)
  try {
    const r = await atenderPeticion(repoSupabase(), {
      metodo,
      recurso,
      authorization: request.headers.get('authorization'),
      cuerpo,
      ahora: new Date().toISOString(),
    })
    return NextResponse.json(r.cuerpo, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[api/ferreteria]', recurso, e)
    return NextResponse.json(
      { error: { codigo: 'error_interno', mensaje: 'No se pudo completar la operación. Reintenta.' } },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ recurso: string }> }) {
  return atender(request, (await params).recurso, 'GET')
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ recurso: string }> }) {
  return atender(request, (await params).recurso, 'POST')
}
