'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { resolverDestinoCompartido } from '@/lib/negocios/casilla-compartida'
import { contextoCorreccion, registrarCorrecciones } from '@/lib/correcciones/registrar'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { SLUG_MODALIDAD } from '@/lib/cotizaciones/bloqueo-modalidad'
import { MENSAJE_SIN_CAMPO_MODALIDAD, dataConModalidad, esValorModalidad, leerCampoModalidad, valorDeModalidad, type ValorModalidad } from '@/lib/cotizaciones/modalidad-campo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

const ETIQUETA: Record<ValorModalidad, string> = { a_medida: 'A medida', bloqueo: 'Bloqueo' }

/**
 * «Marcar el viaje como Bloqueo» desde la cotización (2026-11-03, `modalidad-campo.ts`).
 *
 * Escribe SOLO `modalidad_viaje` en el bloque de datos que lo declara, con dos valores posibles.
 * Mismos permisos que la edición de un bloque: `guardEditarBloque` (rol + área + responsable, negocio
 * abierto) y el cliente con sesión (RLS), nunca service role. No cambia el estado del bloque (sigue
 * «completo» si lo estaba). Si la etapa del bloque ya pasó, deja la traza de corrección de siempre
 * (`bloque_correcciones` + timeline, causa «el dato llegó después»); si no, un evento en el timeline.
 */
export async function cambiarModalidadDelViaje(
  cotizacionId: string,
  valor: ValorModalidad,
): Promise<{ success: true } | { success: false; error: string }> {
  if (!esValorModalidad(valor)) return { success: false, error: 'Modalidad no válida.' }
  const { supabase, workspaceId, userId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const sb = supabase as Supabase

  const { data: cot, error: errCot } = await sb.from('cotizaciones').select('negocio_id').eq('id', cotizacionId).maybeSingle()
  if (errCot) return { success: false, error: 'No se pudo leer la cotización. Vuelve a intentarlo.' }
  const negocioId = (cot?.negocio_id ?? null) as string | null
  if (!negocioId) return { success: false, error: 'Esta cotización no es de un negocio.' }

  const { campo, error: errCampo } = await leerCampoModalidad(sb, negocioId)
  if (errCampo) return { success: false, error: 'No se pudo leer Condiciones del viaje. Vuelve a intentarlo.' }
  if (!campo) return { success: false, error: MENSAJE_SIN_CAMPO_MODALIDAD }

  const guard = await guardEditarBloque(campo.negocioBloqueId)
  if (!guard.ok) return { success: false, error: guard.error ?? 'Sin permiso' }

  // Bloque compartido: el dato vive en la fila del origen (como en `actualizarBloqueData`).
  const destinoId = await resolverDestinoCompartido(sb, campo.negocioBloqueId)
  let data = campo.data
  if (destinoId !== campo.negocioBloqueId) {
    const { data: fila, error: errDestino } = await sb.from('negocio_bloques').select('data').eq('id', destinoId).single()
    if (errDestino) return { success: false, error: 'No se pudo leer Condiciones del viaje. Vuelve a intentarlo.' }
    data = ((fila as { data?: Record<string, unknown> | null } | null)?.data ?? {}) as Record<string, unknown>
  }
  const antes = valorDeModalidad(data[SLUG_MODALIDAD])
  if (antes === valor) return { success: true }

  const { error: errUpd } = await sb
    .from('negocio_bloques')
    .update({ data: dataConModalidad(data, valor), updated_at: new Date().toISOString() })
    .eq('id', destinoId)
  if (errUpd) return { success: false, error: (errUpd as { message: string }).message }

  const corr = await contextoCorreccion(sb, campo.negocioBloqueId)
  if (corr?.esPostAvance) {
    await registrarCorrecciones({
      supabase: sb, workspaceId, userId, staffId,
      negocioBloqueId: destinoId,
      campos: [{ slug: SLUG_MODALIDAD, antes: antes ? ETIQUETA[antes] : null, despues: ETIQUETA[valor] }],
      causa: 'dato_posterior',
      sesionId: randomUUID(),
    })
  } else {
    await registrarActividad(sb, {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio',
      autor_id: staffId ?? null,
      campo_modificado: SLUG_MODALIDAD,
      valor_anterior: antes ? ETIQUETA[antes] : null,
      valor_nuevo: ETIQUETA[valor],
      contenido: `Modalidad del viaje: ${ETIQUETA[valor]} (desde la cotización).`,
    }, 'modalidad-viaje')
  }

  // El negocio y su cotización (la página de la cotización cuelga de esta ruta).
  revalidatePath(`/negocios/${negocioId}`, 'layout')
  return { success: true }
}
