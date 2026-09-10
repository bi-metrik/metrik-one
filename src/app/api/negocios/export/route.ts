import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { puedeDescargarNegocios } from '@/lib/roles'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { construirExportNegocios } from '@/lib/negocios/construir-export-negocios'
import { leerIdsExport, MAX_IDS_EXPORT } from '@/lib/negocios/ids-export'

/**
 * POST /api/negocios/export  { ids: string[] }  →  negocios-{slug}-{YYYY-MM-DD}.xlsx
 *
 * Descarga de autoservicio de la tabla de `/negocios` (Acta SOENA, cláusula SEXTA
 * numeral 2). El cliente manda los ids de las filas que tiene A LA VISTA después de
 * sus filtros, y esta ruta baja exactamente esas: así lo que se descarga es lo que se
 * ve, sin reimplementar `aplicarFiltros` del lado del servidor.
 *
 * Solo lectura. No escribe nada, no hay migración.
 *
 * Quién: owner / admin / supervisor (`puedeDescargarNegocios`, fuente única con el
 * botón). La lista de negocios sale de `getNegociosV2`, que ya acota por workspace y,
 * si el rol fuera operator, por responsable; los ids que no pertenezcan a lo que ese
 * usuario puede ver se ignoran en silencio.
 *
 * El archivo lo arma `construirExportNegocios`, que comparte con la subida a Drive
 * (`subirExportNegociosADrive`): las dos superficies entregan el mismo libro porque es
 * la misma función, no dos que se parecen.
 *
 * Si CUALQUIER lectura falla, la respuesta es 500 y queda en el log con prefijo
 * `[negocios-export]`. Nunca un Excel con ceros disfrazados: un archivo a medias con
 * cara de completo es peor que ningún archivo (ver `traerTodo`).
 */

export const runtime = 'nodejs'

const PREFIJO = '[negocios-export]'

export async function POST(req: NextRequest) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return new NextResponse('No autenticado', { status: 401 })
  if (!puedeDescargarNegocios(role)) return new NextResponse('Sin permisos', { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Cuerpo inválido', { status: 400 })
  }
  const ids = leerIdsExport(body)
  if (!ids) {
    return new NextResponse(
      `Se esperaba { ids: string[] } con entre 1 y ${MAX_IDS_EXPORT} ids`,
      { status: 400 },
    )
  }

  try {
    const { buffer, slug } = await construirExportNegocios(supabase, workspaceId, ids)

    const filename = `negocios-${slug}-${todayBogotaISO()}.xlsx`
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error(`${PREFIJO} no se pudo generar el Excel`, e)
    return new NextResponse('No se pudo generar el archivo. Inténtalo de nuevo.', { status: 500 })
  }
}
