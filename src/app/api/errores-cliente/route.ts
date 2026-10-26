import { NextResponse } from 'next/server'
import { versionDelBuild } from '@/lib/version/build'
import { leerReporte, MAX_BYTES_REPORTE } from '@/lib/errores-cliente/reporte'

// Recibe lo que rompio en el navegador (`error.tsx`, `global-error.tsx`) y lo deja en los
// logs de Vercel como una linea `[error-cliente]` con nivel error. No guarda nada.
//
// Publica a proposito, como `/api/version`: `global-error` puede saltar sin sesion, y el
// middleware la deja pasar antes de `updateSession` (sin redirigir a /login ni exigir
// workspace). No expone nada: siempre responde 204/400/413 sin cuerpo.

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // Un cuerpo que se declara grande se rechaza ANTES de leerlo.
  const declarado = Number(request.headers.get('content-length'))
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_REPORTE) {
    return new NextResponse(null, { status: 413 })
  }
  const cuerpo = await request.text()
  const r = leerReporte(cuerpo, request.headers.get('content-length'))
  if (!r.ok) return new NextResponse(null, { status: r.status })

  // Un `recuperado: true` no es un error: cierra el episodio de uno de red que se curo solo.
  // Misma etiqueta (se buscan juntos), nivel warning para no inflar la cuenta de errores.
  const linea = JSON.stringify({ ...r.reporte, versionServidor: versionDelBuild() })
  if (r.reporte.recuperado || r.reporte.bandeja?.recuperado) console.warn('[error-cliente]', linea)
  else console.error('[error-cliente]', linea)
  return new NextResponse(null, { status: 204 })
}
