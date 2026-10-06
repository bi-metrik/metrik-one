/**
 * `POST /api/red/eventos` — lo que mide el piloto de red en el navegador (pulso, cortes y
 * fallas por superficie). Ver `src/lib/red/pulso.ts` y el brief del 2026-10-06
 * (`proyectos/soena/ve/2026-10-06_brief-max-piloto-red-documentos.md`).
 *
 * Deja UNA línea `[red-piloto]` por lote en los logs de Vercel, con:
 * - el workspace (del subdominio, nunca del cuerpo) y solo si está en el piloto;
 * - la persona (`staff.id`) SOLO si está en la lista explícita `PERSONAS_MEDIDAS`; el resto va
 *   sin identificador;
 * - el operador (sistema autónomo), resuelto por DNS desde la IP, que NO se registra;
 * - ciudad y región que pone Vercel, y el tipo de dispositivo.
 *
 * Exige sesión: es lo que impide que cualquiera llene la medición. Sin sesión el middleware
 * responde 307 a /login y el navegador conserva el lote para la próxima.
 *
 * Contar: `node scripts/red-resumen.mjs --bajar 2d` (deduplica por `id` de evento).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { usuarioDesdeToken } from '@/lib/supabase/claims-user'
import { leerLoteRed } from '@/lib/red/eventos-servidor'
import { MAX_BYTES_LOTE_RED } from '@/lib/red/eventos'
import { esPilotoRed, personaMedida } from '@/lib/red/piloto'
import { ipDelCliente, operadorDeIp } from '@/lib/red/operador'
import { tipoDeDispositivo } from '@/lib/rum/beacon'
import { versionDelBuild } from '@/lib/version/build'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIN_CUERPO = { 'Cache-Control': 'no-store' }

function decodificar(v: string | null): string | undefined {
  if (!v) return undefined
  try {
    return decodeURIComponent(v).slice(0, 80)
  } catch {
    return v.slice(0, 80)
  }
}

export async function POST(request: Request) {
  const slug = request.headers.get('x-tenant-slug')
  // Fuera del piloto no se registra nada (204: el navegador vacía su bandeja y no insiste).
  if (!esPilotoRed(slug)) return new NextResponse(null, { status: 204, headers: SIN_CUERPO })

  const declarado = Number(request.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_LOTE_RED) {
    return new NextResponse(null, { status: 413, headers: SIN_CUERPO })
  }
  const lote = leerLoteRed(await request.text())
  if (!lote.ok) return new NextResponse(null, { status: lote.status, headers: SIN_CUERPO })

  const supabase = await createClient()
  const { user: usuario } = await usuarioDesdeToken(supabase)
  if (!usuario) return new NextResponse(null, { status: 401, headers: SIN_CUERPO })

  const [staff, operador] = await Promise.all([
    supabase
      .from('staff')
      .select('id, full_name, workspaces!staff_workspace_id_fkey(slug)')
      .eq('profile_id', usuario.id)
      .maybeSingle()
      .then((r) => r.data as { id: string; full_name: string; workspaces: { slug: string } | null } | null),
    operadorDeIp(ipDelCliente(request.headers)),
  ])

  // La persona solo se identifica si su staff es DE ESTE workspace y está en la lista.
  const persona = staff && staff.workspaces?.slug === slug ? personaMedida(slug, staff.full_name) : null

  const linea = {
    ws: slug,
    persona,
    persona_id: persona ? staff!.id : null,
    operador: operador?.marca ?? null,
    asn: operador?.asn ?? null,
    asn_nombre: operador?.nombre ?? null,
    ciudad: decodificar(request.headers.get('x-vercel-ip-city')),
    region: request.headers.get('x-vercel-ip-country-region')?.slice(0, 10),
    pais: request.headers.get('x-vercel-ip-country')?.slice(0, 4),
    dispositivo: tipoDeDispositivo(request.headers.get('user-agent')),
    recibido: Date.now(),
    descartados: lote.descartados || undefined,
    eventos: lote.eventos,
    versionServidor: versionDelBuild(),
  }
  console.log('[red-piloto]', JSON.stringify(linea))
  return new NextResponse(null, { status: 204, headers: SIN_CUERPO })
}
