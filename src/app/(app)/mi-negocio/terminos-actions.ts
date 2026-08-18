'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import {
  normalizarTerminos,
  type ClausulaTerminos,
  type PropuestaTerminos,
} from '@/lib/propuesta/terminos'

// Quien edita los terminos. Decision de Mauricio: solo Juan David (dueno) y
// Diana (administrador). El gate es por ROL, no por persona: si SOENA nombra
// otro administrador, tambien podra editar. Ojo con no gatear por `position`:
// Leidy Llanos tiene el mismo cargo que Diana ("Supervisor Financiero") y no
// debe poder tocar el texto legal de las propuestas.
const ROLES_QUE_EDITAN = ['owner', 'admin']

export interface TerminosPropuestaVista {
  lineaNombre: string
  terminos: PropuestaTerminos
  /** Aun no se ha guardado nada: el PDF usa los terminos por defecto del render. */
  sinConfigurar: boolean
  puedeEditar: boolean
}

/**
 * Los terminos viven en el `bloque_configs` que GENERA la propuesta, al lado de
 * `template_slug`. Las otras instancias del bloque son copias readonly heredadas
 * en etapas posteriores (`config_extra.readonly`) y no configuran nada.
 */
type BloqueGenerador = {
  id: string
  nombre: string | null
  config_extra: Record<string, unknown> | null
}

async function bloqueGenerador(
  supabase: Awaited<ReturnType<typeof getWorkspace>>['supabase'],
  workspaceId: string,
): Promise<{ error: string; bloque?: undefined } | { bloque: BloqueGenerador; error?: undefined }> {
  const { data, error } = await supabase
    .from('bloque_configs')
    .select('id, nombre, config_extra, bloque_definitions!inner(tipo)')
    .eq('workspace_id', workspaceId)
    .eq('bloque_definitions.tipo', 'propuesta_economica')

  if (error) return { error: error.message as string }
  const filas = (data ?? []) as unknown as BloqueGenerador[]
  const generadores = filas.filter((f) => (f.config_extra ?? {}).template_slug)
  if (generadores.length === 0) {
    return { error: 'Este workspace no genera propuestas con plantilla' as const }
  }
  // Si algun dia hay dos lineas que generan propuesta, esta pantalla tiene que
  // preguntar cual. Callarlo y editar la primera cambiaria el documento
  // equivocado, que es peor que no dejar editar.
  if (generadores.length > 1) {
    return { error: 'Hay mas de una propuesta configurada; esta pantalla aun no sabe cual editar' as const }
  }
  return { bloque: generadores[0] }
}

export async function getTerminosPropuesta(): Promise<
  { error: string } | TerminosPropuestaVista
> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: error ?? 'Sin workspace' }

  const res = await bloqueGenerador(supabase, workspaceId)
  if (res.error || !res.bloque) return { error: res.error ?? 'Sin propuesta configurada' }

  const configExtra = (res.bloque.config_extra ?? {}) as Record<string, unknown>
  const guardados = normalizarTerminos(configExtra.propuesta)
  return {
    lineaNombre: res.bloque.nombre ?? 'Propuesta económica',
    terminos: guardados ?? { clausulas: [], cierre: '', version: 0, updated_at: null, updated_by: null },
    sinConfigurar: guardados === null,
    puedeEditar: ROLES_QUE_EDITAN.includes(role ?? ''),
  }
}

export async function guardarTerminosPropuesta(input: {
  clausulas: ClausulaTerminos[]
  cierre: string
}): Promise<{ ok: true; version: number } | { error: string }> {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: error ?? 'Sin workspace' }
  if (!ROLES_QUE_EDITAN.includes(role ?? '')) {
    return { error: 'Solo el dueño o el administrador del workspace pueden editar los términos' }
  }

  const clausulas: ClausulaTerminos[] = (input.clausulas ?? [])
    .map((c) => ({
      titulo: (c.titulo ?? '').trim(),
      parrafos: (c.parrafos ?? [])
        .map((p) => {
          const subtitulo = (p.subtitulo ?? '').trim()
          const texto = (p.texto ?? '').trim()
          return subtitulo ? { subtitulo, texto } : { texto }
        })
        .filter((p) => p.texto || p.subtitulo),
    }))
    .filter((c) => c.titulo || c.parrafos.length > 0)

  // Guardar cero clausulas no vaciaria el documento: lo devolveria en silencio a
  // los terminos por defecto del servicio de render. Sorpresa cara en un PDF que
  // ya salio firmado, asi que se bloquea aqui.
  if (clausulas.length === 0) {
    return { error: 'Deja al menos una cláusula. Para volver al texto por defecto, avísale a MeTRIK.' }
  }
  const cierre = (input.cierre ?? '').trim()
  if (!cierre) return { error: 'El párrafo de aceptación no puede quedar vacío' }

  const res = await bloqueGenerador(supabase, workspaceId)
  if (res.error || !res.bloque) return { error: res.error ?? 'Sin propuesta configurada' }

  const configExtra = (res.bloque.config_extra ?? {}) as Record<string, unknown>
  const previos = normalizarTerminos(configExtra.propuesta)
  const version = (previos?.version ?? 0) + 1

  const propuesta: PropuestaTerminos = {
    clausulas,
    cierre,
    version,
    updated_at: new Date().toISOString(),
    updated_by: staffId ?? null,
  }

  const { error: errUpd } = await supabase
    .from('bloque_configs')
    // `config_extra` es `Json` en los tipos generados; el modelo es un objeto
    // plano serializable, pero TS no lo deduce solo.
    .update({ config_extra: { ...configExtra, propuesta } as never })
    .eq('id', res.bloque.id)
    .eq('workspace_id', workspaceId)

  if (errUpd) return { error: errUpd.message }

  revalidatePath('/mi-negocio')
  return { ok: true, version }
}
