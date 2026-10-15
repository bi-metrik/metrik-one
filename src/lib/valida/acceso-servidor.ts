import 'server-only'
import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { validaCdaPermiteConsultar, validaCdaPermiteOperar } from '@/lib/valida-cda/puerta'

/**
 * Todo lo del módulo Valida (`/valida`, y su sección en el detalle del negocio de un workspace que lo
 * tenga) pasa por aquí. La sesión no basta: un workspace sin el módulo (4D SOFT, con solo
 * `valida_api`) no consulta, no lista ni descarga reportes.
 *
 * Los CDA con contrato directo con METRIK IA S.A.S. no operan hasta que la persona designada acepte
 * sus términos (cláusula 16.3), salvo dentro del plazo para aceptar, ni con más de 30 días de mora
 * (cláusula 11.3). Desde el 2026-11-05, con más de 5 días de mora no hacen CONSULTAS NUEVAS
 * (`consultaNueva`), pero listan y descargan lo ya generado (cláusula 11.1, v1.4). Un espacio sin
 * contrato de Valida (AFI, metrik) pasa igual que antes: la puerta no le aplica. Ver
 * `src/lib/valida-cda/puerta.ts`.
 *
 * Cuando el módulo pasa y la puerta CDA no, el «no» trae el `workspaceId`: el cargue masivo lo usa
 * para pausar el lote del espacio (`valida-lotes.ts`).
 */
export async function accesoValida(
  opts: { consultaNueva?: boolean } = {},
): Promise<{ ok: true; workspaceId: string } | { ok: false; error: string; workspaceId?: string }> {
  const r = await exigirModulo(REQUISITO.validaConsulta)
  if (!r.ok) return { ok: false, error: r.error === 'no_autenticado' ? 'workspace_no_encontrado' : r.error }
  const puerta = opts.consultaNueva ? await validaCdaPermiteConsultar() : await validaCdaPermiteOperar()
  if (!puerta.ok) return { ok: false, error: puerta.error, workspaceId: r.workspaceId }
  return r
}
