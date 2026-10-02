'use server'

/**
 * La solicitud de viaje sin formulario: las server actions que llaman a la función edge
 * `solicitud-texto` (el MISMO motor del bot de WhatsApp, que vive en Deno).
 *
 * Server action y no route handler (decisión de Max, 2026-10-02): la pantalla ya habla con el
 * servidor así en todo el negocio, la sesión no sale del servidor (el JWT va de aquí a la función,
 * nunca al navegador) y después de «Cargar» se revalida la ruta como en cualquier otra acción.
 *
 * Las barreras de la web van ANTES de llamar: sesión y pestaña sincronizada (`getWorkspace`), el
 * mismo permiso de edición del bloque (`guardEditarBloque`) en un negocio que ya existe, y el
 * módulo Clarity para crear uno nuevo, como `crearNegocio`. La función vuelve a validar sesión,
 * rol y módulo `bandeja_solicitudes_wa` por su lado.
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { createServiceClient } from '@/lib/supabase/server'
import { confirmarSugeridoEnData } from '@/lib/negocios/sugeridos'
import { resolverDestinoCompartido } from '@/lib/negocios/casilla-compartida'
import { lineaSolicitudTexto, llamarSolicitudTexto } from '@/lib/negocios/solicitud-texto-servidor'
import type {
  ContactoElegido,
  NegocioElegido,
  QuienEscribio,
  RespuestaCargar,
  RespuestaEntender,
} from '@/lib/negocios/solicitud-texto'

type Error = { ok: false; error: string; mensaje: string }

/** Lo que se exige antes de tocar la función: sesión, no «Ver como», módulo y permiso. */
async function barrera(p: { negocioBloqueId?: string | null }): Promise<Error | null> {
  const { workspaceId, impersonating, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'no_autenticado', mensaje: 'No autenticado' }
  // «Ver como» presta los permisos de otro, pero la función actúa con la sesión real: no se mezcla.
  if (impersonating) return { ok: false, error: 'impersonando', mensaje: 'No disponible en «Ver como».' }
  if (!(await lineaSolicitudTexto(workspaceId))) return { ok: false, error: 'sin_modulo', mensaje: MENSAJE_MODULO_NO_ACTIVO }
  if (p.negocioBloqueId) {
    const g = await guardEditarBloque(p.negocioBloqueId)
    if (!g.ok) return { ok: false, error: 'sin_permiso', mensaje: g.error ?? 'Sin permiso' }
  } else if (!(await exigirModulo(REQUISITO.clarity)).ok) {
    return { ok: false, error: 'sin_modulo', mensaje: MENSAJE_MODULO_NO_ACTIVO }
  }
  return null
}

/** El negocio del bloque: la función recibe el negocio, la web autoriza por el bloque abierto. */
async function negocioDelBloque(negocioBloqueId: string): Promise<string | null> {
  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (svc.from('negocio_bloques') as any).select('negocio_id').eq('id', negocioBloqueId).maybeSingle()
  return (data?.negocio_id as string | undefined) ?? null
}

/** «Entender»: no escribe en el negocio. Con `negocioBloqueId`, entiende contra ese negocio. */
export async function entenderSolicitud(p: {
  texto: string
  quien: QuienEscribio
  negocioBloqueId?: string | null
  contactoId?: string | null
}): Promise<RespuestaEntender> {
  const b = await barrera({ negocioBloqueId: p.negocioBloqueId })
  if (b) return b
  const negocioId = p.negocioBloqueId ? await negocioDelBloque(p.negocioBloqueId) : null
  if (p.negocioBloqueId && !negocioId) return { ok: false, error: 'negocio', mensaje: 'Bloque no encontrado' }
  return llamarSolicitudTexto<RespuestaEntender>({
    op: 'entender', texto: p.texto, quien: p.quien, negocio_id: negocioId, contacto_id: p.contactoId ?? null,
  })
}

/** «Cargar»: lo entendido queda SUGERIDO en el negocio (nuevo o existente). */
export async function cargarSolicitud(p: {
  entendimientoId: string
  quitar: string[]
  negocioBloqueId?: string | null
  contacto?: ContactoElegido | null
  negocio?: NegocioElegido | null
}): Promise<RespuestaCargar> {
  const b = await barrera({ negocioBloqueId: p.negocioBloqueId })
  if (b) return b
  const r = await llamarSolicitudTexto<RespuestaCargar>({
    op: 'cargar', entendimiento_id: p.entendimientoId, quitar: p.quitar, contacto: p.contacto ?? null, negocio: p.negocio ?? null,
  })
  if (r.ok) {
    revalidatePath(`/negocios/${r.negocioId}`)
    revalidatePath('/negocios')
  }
  return r
}

/** «Descartar»: lo pegado queda descartado en la bandeja. */
export async function descartarSolicitud(p: { entendimientoId: string; negocioBloqueId?: string | null }): Promise<{ ok: boolean }> {
  const b = await barrera({ negocioBloqueId: p.negocioBloqueId })
  if (b) return { ok: false }
  const r = await llamarSolicitudTexto<{ ok: boolean }>({ op: 'descartar', entendimiento_id: p.entendimientoId })
  return { ok: r.ok === true }
}

/**
 * «Confirmar los N sugeridos»: quita la marca de todos de una vez, sin tocar los valores. Mismo
 * guard y misma escritura que `confirmarSugerido`, en una sola escritura del bloque.
 */
export async function confirmarSugeridos(negocioBloqueId: string, slugs: string[]): Promise<{ error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { error: guard.error ?? 'Sin permiso' }
  const destinoId = await resolverDestinoCompartido(supabase, negocioBloqueId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabla = () => (supabase.from('negocio_bloques') as any)
  const { data: fila, error: errLeer } = await tabla().select('data').eq('id', destinoId).single()
  if (errLeer) return { error: `No se pudo leer el bloque: ${errLeer.message}` }
  const actual = ((fila as { data: Record<string, unknown> | null } | null)?.data ?? {})
  let nueva = actual
  for (const s of slugs) nueva = confirmarSugeridoEnData(nueva, s)
  if (nueva === actual) return { error: null }
  const { error: errEsc } = await tabla().update({ data: nueva, updated_at: new Date().toISOString() }).eq('id', destinoId)
  if (errEsc) return { error: (errEsc as { message: string }).message }
  return { error: null }
}
