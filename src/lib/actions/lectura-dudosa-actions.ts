'use server'

/**
 * Corregir con un clic una lectura dudosa al valor de la mayoría.
 *
 * El navegador solo dice QUÉ voto y QUÉ fuente; el valor nuevo NO viaja desde el
 * navegador: el servidor vuelve a evaluar el voto contra los datos de HOY y escribe lo
 * que la mayoría dice en ese momento. Si entre que se pintó la tarjeta y el clic alguien
 * ya corrigió, o el voto dejó de estar en disputa, no se escribe nada.
 *
 * La escritura va por `actualizarCampoDocumento`, la misma puerta de la corrección a
 * mano: el mismo guard de área, la misma marca «Editado · nombre» y, si el bloque es de
 * una etapa ya superada, el mismo registro en `bloque_correcciones` con causa «error de
 * captura» (la IA leyó mal y nadie lo vio: es un error de captura del documento).
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { actualizarCampoDocumento } from '@/lib/actions/documento-actions'
import type { CampoExtraccion } from '@/lib/ai/extract-fields'
import { nuevaSesionId } from '@/lib/correcciones/causas'
import { parsearPersonas, serializarPersonas } from '@/lib/documentos/personas'
import { votoDelNegocio } from '@/lib/negocios/datos-clave-servidor'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

export async function corregirLecturaDudosa(
  negocioId: string,
  votoSlug: string,
  clave: string,
): Promise<{ success: boolean; error?: string; valor?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, linea_id, etapa_actual_id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!negocio?.linea_id) return { success: false, error: 'Negocio no encontrado' }

  const { data: linea } = await db(supabase)
    .from('lineas_negocio')
    .select('config_extra')
    .eq('id', negocio.linea_id)
    .maybeSingle()

  const voto = await votoDelNegocio(supabase, {
    negocioId,
    lineaId: negocio.linea_id,
    etapaActualId: negocio.etapa_actual_id ?? null,
    etapaOrden: null,
    configLinea: (linea?.config_extra as Record<string, unknown> | null) ?? null,
  }, votoSlug)
  if (!voto) return { success: false, error: 'Ese dato ya no se compara en este negocio.' }
  const fuente = voto.fuentes.find(f => f.clave === clave)
  if (!fuente || fuente.estado !== 'dudosa' || !voto.valor) {
    return { success: false, error: 'Esta lectura ya no está en disputa. Recarga la página para ver el estado actual.' }
  }
  if (fuente.valor === voto.valor) return { success: true, valor: voto.valor }

  // La fila ORIGEN del bloque (las copias heredadas no tienen slug y no se escriben).
  const { data: bloques } = await db(supabase)
    .from('negocio_bloques')
    .select('id, data, bloque_configs!inner(slug, config_extra, etapas_negocio!inner(linea_id))')
    .eq('negocio_id', negocioId)
    .eq('bloque_configs.slug', fuente.bloque_slug)
    .eq('bloque_configs.etapas_negocio.linea_id', negocio.linea_id)
  const bloque = ((bloques ?? []) as Array<{
    id: string
    data: Record<string, unknown> | null
    bloque_configs: { config_extra: Record<string, unknown> | null }
  }>)[0]
  if (!bloque) return { success: false, error: 'No se encontró el documento que hay que corregir.' }

  const camposExtraccion = (bloque.bloque_configs.config_extra?.campos_extraccion ?? []) as CampoExtraccion[]
  let valorNuevo = voto.valor
  if (fuente.persona !== null) {
    // Una persona dentro de una lista: se cambia SU documento y el resto queda igual.
    const campos = (bloque.data?.campos ?? {}) as Record<string, { value?: unknown }>
    const personas = parsearPersonas(campos[fuente.field]?.value)
    if (!personas[fuente.persona]) return { success: false, error: 'La lista de personas cambió. Recarga la página.' }
    personas[fuente.persona] = { ...personas[fuente.persona], documento: voto.valor }
    valorNuevo = serializarPersonas(personas)
  }

  const res = await actualizarCampoDocumento(
    bloque.id,
    negocioId,
    fuente.field,
    valorNuevo,
    camposExtraccion,
    { causa: 'error_captura', sesion_id: nuevaSesionId() },
  )
  if (!res.success) return { success: false, error: res.error ?? 'No se pudo corregir.' }
  return { success: true, valor: voto.valor }
}
