import type { resolverFormularioParaEdicion } from '@/lib/actions/formulario-actions'
import { pedirJson } from '@/lib/negocios/paginas-lista'

export type FormularioParaEdicion = Awaited<ReturnType<typeof resolverFormularioParaEdicion>>

/**
 * Las casillas de un bloque formulario, por `GET /api/negocios/<id>/formulario/<bloque>`.
 * Misma respuesta que la server action `resolverFormularioParaEdicion`, sin entrar en la
 * fila de server actions de Next. Sin sesión, `pedirJson` recarga la página para que la
 * tome el flujo de login; un corte de red se reintenta una vez y luego lanza.
 */
export function leerFormularioParaEdicion(negocioId: string, negocioBloqueId: string): Promise<FormularioParaEdicion> {
  return pedirJson<FormularioParaEdicion>(
    `/api/negocios/${encodeURIComponent(negocioId)}/formulario/${encodeURIComponent(negocioBloqueId)}`,
    undefined,
  )
}
