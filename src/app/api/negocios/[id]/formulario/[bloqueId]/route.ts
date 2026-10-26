/**
 * `GET /api/negocios/<id>/formulario/<bloqueId>` — las casillas de un bloque formulario ya
 * resueltas para editar (autollenado + overrides), sus versiones, seccionales y el estado
 * de la confirmación del NIT.
 *
 * Antes el bloque las pedía al montar con la server action `resolverFormularioParaEdicion`
 * (484 llamadas en 7 días, medido 2026-10-05). Next pone las server actions en fila: esa
 * lectura retrasaba la primera acción real en la ficha. Es la MISMA función, con el mismo
 * alcance (sesión y workspace de `getWorkspace`); la casilla del NIT a ciegas sigue sin
 * viajar (#807), porque la omite la propia función. Las escrituras (guardar, generar,
 * confirmar el NIT, cambiar la seccional) siguen siendo server actions.
 *
 * Sin sesión: 401 (el cliente se va al flujo de sesión). Otro error (bloque que no existe):
 * 200 con `error`, como respondía la action, para que la pantalla diga lo mismo que antes.
 */
import { NextResponse } from 'next/server'
import { resolverFormularioParaEdicion } from '@/lib/actions/formulario-actions'
import { enPeticionDeRuta } from '@/lib/actions/memo-de-ruta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'Cache-Control': 'no-store' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; bloqueId: string }> }) {
  const { id, bloqueId } = await params
  if (!UUID.test(id) || !UUID.test(bloqueId)) {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400, headers: SIN_CACHE })
  }
  try {
    const res = await enPeticionDeRuta(() => resolverFormularioParaEdicion(bloqueId, id))
    if (res.error === 'No autenticado') {
      return NextResponse.json({ error: res.error }, { status: 401, headers: SIN_CACHE })
    }
    return NextResponse.json(res, { headers: SIN_CACHE })
  } catch (e) {
    console.error('[api/negocios/formulario]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo leer el formulario' }, { status: 500, headers: SIN_CACHE })
  }
}
