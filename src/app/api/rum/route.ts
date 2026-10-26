import { NextResponse } from 'next/server'
import { versionDelBuild } from '@/lib/version/build'
import { leerBeacon, MAX_BYTES_RUM, tipoDeDispositivo } from '@/lib/rum/beacon'
import { extractSlug } from '@/lib/tenant/extract-slug'

// Recibe la medicion del navegador (`components/rum/rum-red.tsx`): web vitals y duracion
// de las navegaciones suaves, un beacon por ciclo de pagina. La deja en los logs de Vercel
// como UNA linea `[rum]` con nivel info. No guarda nada.
//
// Consultar: `vercel logs --environment production --since 72h --query rum --limit 20000 --json
//   | node scripts/rum-p75.mjs` (el `--query` no acepta corchetes: el script filtra el prefijo).
// Los logs repiten filas: deduplicar por el `id` del log antes de contar. Las vitales de
// la carga (LCP, FCP, TTFB) pueden venir en varios ciclos de una misma `carga`: quedarse
// con la ultima por `carga` + metrica.
//
// Publica a proposito, como `/api/errores-cliente`: el beacon sale al cerrar la pestaña y
// puede llegar con la sesion vencida. El middleware la deja pasar antes de `updateSession`.
// El workspace sale del host (nunca del cuerpo) y no se registra usuario, IP ni query.

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const declarado = Number(request.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_RUM) {
    return new NextResponse(null, { status: 413 })
  }
  const cuerpo = await request.text()
  const r = leerBeacon(cuerpo, request.headers.get('content-length'))
  if (!r.ok) return new NextResponse(null, { status: r.status })

  const host = request.headers.get('host') ?? ''
  const linea = JSON.stringify({
    ...r.beacon,
    ws: extractSlug(host),
    dispositivo: tipoDeDispositivo(request.headers.get('user-agent')),
    versionServidor: versionDelBuild(),
  })
  console.log('[rum]', linea)
  return new NextResponse(null, { status: 204 })
}
