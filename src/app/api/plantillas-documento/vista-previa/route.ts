/**
 * PDF de vista previa de una plantilla editable (Configuración → Plantillas de documentos).
 *
 * POST { tipo, contenido, negocioId? } → application/pdf. El texto es el BORRADOR que la
 * persona tiene en pantalla (no hace falta guardarlo). Con `negocioId` se imprime con los
 * datos de ese negocio; sin él, con los datos de ejemplo del catálogo.
 *
 * Solo lectura: no crea versiones de plantilla ni del formulario, no sube nada a Drive.
 * Solo para la lista de editores del workspace, igual que la pantalla.
 *
 * Es el MISMO HTML que la vista previa en vivo y que la generación (`htmlDelDocumento`).
 */
import { NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { defDe, esTipoPlantilla, type Datos } from '@/lib/plantillas-documento/catalogo'
import { MAX_CARACTERES } from '@/lib/plantillas-documento/sintaxis'
import { esEditorDePlantillas } from '@/lib/plantillas-documento/servidor'
import { datosDelNegocio } from '@/lib/plantillas-documento/datos-negocio'
import { imprimirPlantilla } from '@/lib/plantillas-documento/imprimir'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SIN_CACHE = { 'Cache-Control': 'no-store' }
const error = (mensaje: string, status: number) => NextResponse.json({ error: mensaje }, { status, headers: SIN_CACHE })

export async function POST(request: Request) {
  const { supabase, workspaceId, impersonating } = await getWorkspace()
  const { user } = await getCachedUser()
  if (!workspaceId || !user) return error('Sesión no válida. Recarga la página.', 401)
  if (impersonating || !(await esEditorDePlantillas(supabase, workspaceId, user.id))) {
    return error('No estás en la lista de personas que editan las plantillas de este espacio.', 403)
  }

  let cuerpo: { tipo?: unknown; contenido?: unknown; negocioId?: unknown }
  try {
    cuerpo = await request.json()
  } catch {
    return error('Pedido inválido.', 400)
  }
  const { tipo, contenido, negocioId } = cuerpo
  if (!esTipoPlantilla(tipo)) return error('Documento desconocido.', 400)
  if (typeof contenido !== 'string' || contenido.length > MAX_CARACTERES) return error('Plantilla inválida.', 400)

  let datos: Datos = defDe(tipo).ejemplo
  let codigo = 'EJEMPLO'
  if (typeof negocioId === 'string' && negocioId) {
    const r = await datosDelNegocio(supabase, workspaceId, negocioId, tipo)
    if (!r.ok) return error(r.error, 404)
    datos = r.datos
    codigo = r.codigo
  }

  const impreso = await imprimirPlantilla(tipo, contenido, datos, {
    fechaGeneracion: new Date().toISOString(),
    codigoNegocio: codigo,
  })
  if (!impreso.ok) return error(impreso.error, 422)
  return new NextResponse(new Uint8Array(impreso.pdf), {
    status: 200,
    headers: {
      ...SIN_CACHE,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="vista-previa-${tipo}.pdf"`,
      'X-Render-Ms': String(impreso.medidas.totalMs),
    },
  })
}
