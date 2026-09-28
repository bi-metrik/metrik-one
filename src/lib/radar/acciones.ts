'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import {
  armarEstadoEntradaPagina,
  registrarAprobacionEntrada,
  type EntradaAprobacion,
} from '@/lib/valida-api/entrada-aprobacion'
import type { EstadoEntradaPagina, ResultadoAprobarEntrada } from '@/lib/valida-api/resultados'
import { contextoRadar } from './contexto'
import { entradaDelUsuarioRadar, entradaRadarAprobada } from './entrada-servidor'

/**
 * Las acciones del Radar. Dos familias:
 *
 *   · La entrada de términos, que delega ENTERA en el motor compartido de Valida
 *     (`entrada-aprobacion.ts`) con `producto: 'radar_secop'`.
 *   · Guardar lo que el cliente decidió mirar y seguir.
 *
 * **Toda acción comprueba el módulo Y la entrada aprobada**, no solo la primera. Lo que la pantalla
 * no muestra también se niega por POST: sin esto, un cliente que no aceptó los términos podría
 * marcar procesos como seguidos llamando la acción a mano, y la cláusula del documento («el fit es
 * priorización, no un concepto jurídico») nunca se le habría mostrado.
 */

const SIN_ACCESO = 'No tienes acceso al Radar en este espacio.'
const SIN_TERMINOS = 'Acepta los términos de uso del Radar para poder usarlo.'

export async function estadoEntradaRadar(): Promise<EstadoEntradaPagina> {
  const entrada = await entradaDelUsuarioRadar()
  if (entrada.tipo !== 'ok') return { estado: 'no_disponible' }
  return armarEstadoEntradaPagina({ workspaceId: entrada.ctx.workspaceId }, entrada.estado)
}

/** El único «Acepto» de la entrada del Radar. */
export async function aprobarEntradaRadar(input: EntradaAprobacion): Promise<ResultadoAprobarEntrada> {
  const entrada = await entradaDelUsuarioRadar()
  if (entrada.tipo !== 'ok') return { ok: false, error: SIN_ACCESO }
  return registrarAprobacionEntrada(
    { workspaceId: entrada.ctx.workspaceId, usuarioId: entrada.ctx.usuarioId, producto: 'radar_secop' },
    entrada.estado,
    entrada.hoy,
    input,
  )
}

export type ResultadoRadar = { ok: true } | { ok: false; error: string }

/** La puerta que comparten las acciones de datos. */
async function puerta(): Promise<{ ok: true; workspaceId: string; usuarioId: string } | { ok: false; error: string }> {
  const ctx = await contextoRadar()
  if (ctx.tipo !== 'ok') return { ok: false, error: SIN_ACCESO }
  if (!(await entradaRadarAprobada())) return { ok: false, error: SIN_TERMINOS }
  return { ok: true, workspaceId: ctx.workspaceId, usuarioId: ctx.usuarioId }
}

export interface PerfilAGuardar {
  nombre: string
  preset: string
  seleccionados: string[]
  pesos: Record<string, number>
  exclusiones: string[]
}

/**
 * Guarda el perfil activo del workspace. Crea la fila la primera vez (con `activo = true`) y la
 * actualiza después.
 *
 * Los pesos se filtran a números finitos antes de escribir: el CHECK
 * `radar_perfiles_pesos` de la base rechaza cualquier otra cosa, y un error de la base sobre un
 * `NaN` que vino del navegador no le dice nada al usuario. La base sigue siendo la que lo hace
 * cierto; esto solo evita el mensaje inútil.
 */
export async function guardarPerfilRadar(p: PerfilAGuardar): Promise<ResultadoRadar> {
  const g = await puerta()
  if (!g.ok) return g

  const nombre = p.nombre.trim()
  if (!nombre) return { ok: false, error: 'El perfil necesita un nombre.' }

  const pesos = Object.fromEntries(
    Object.entries(p.pesos ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const { data, error: errLectura } = await svc
    .from('radar_perfiles')
    .select('id')
    .eq('workspace_id', g.workspaceId)
    .eq('activo', true)
    .maybeSingle()
  if (errLectura) return { ok: false, error: 'No se pudo leer tu perfil. Intenta de nuevo.' }

  const fila = {
    nombre,
    preset: p.preset,
    temas_sel: p.seleccionados ?? [],
    pesos,
    exclusiones: p.exclusiones ?? [],
    updated_at: new Date().toISOString(),
  }

  const existente = (data as { id: string } | null)?.id
  const { error } = existente
    ? await svc.from('radar_perfiles').update(fila).eq('id', existente).eq('workspace_id', g.workspaceId)
    : await svc
        .from('radar_perfiles')
        .insert({ ...fila, workspace_id: g.workspaceId, activo: true, creado_por: g.usuarioId })

  if (error) {
    console.error('[radar] no se pudo guardar el perfil:', error.message)
    return { ok: false, error: 'No se pudo guardar tu perfil. Intenta de nuevo.' }
  }

  revalidatePath('/radar')
  return { ok: true }
}

/**
 * Marca un proceso como seguido, oculto, o le quita la marca (`null`).
 *
 * El `notice_uid` viene del navegador y NO se valida contra `radar_procesos` a propósito: un
 * proceso que ya cerró sale del universo vigente y su marca tiene que poder seguir existiendo (por
 * eso la tabla no tiene FK). Lo que sí está acotado es el workspace, que sale del servidor.
 */
export async function marcarProcesoRadar(noticeUid: string, estado: 'sigue' | 'oculto' | null): Promise<ResultadoRadar> {
  const g = await puerta()
  if (!g.ok) return g

  const uid = (noticeUid ?? '').trim()
  if (!uid) return { ok: false, error: 'Falta el proceso que se quiere marcar.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const { data, error: errPerfil } = await svc
    .from('radar_perfiles')
    .select('id')
    .eq('workspace_id', g.workspaceId)
    .eq('activo', true)
    .maybeSingle()
  if (errPerfil) return { ok: false, error: 'No se pudo leer tu perfil. Intenta de nuevo.' }

  const perfilId = (data as { id: string } | null)?.id
  // Sin perfil guardado no hay dónde colgar la marca. Se dice, en vez de crear un perfil por el
  // hecho de haber hecho clic en una estrella.
  if (!perfilId) return { ok: false, error: 'Guarda primero tus temas: la marca se guarda en tu perfil.' }

  const { error } = estado
    ? await svc.from('radar_seguimiento').upsert(
        {
          workspace_id: g.workspaceId,
          perfil_id: perfilId,
          notice_uid: uid,
          estado,
          marcado_por: g.usuarioId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'perfil_id,notice_uid' },
      )
    : await svc.from('radar_seguimiento').delete().eq('perfil_id', perfilId).eq('notice_uid', uid)

  if (error) {
    console.error('[radar] no se pudo marcar el proceso:', error.message)
    return { ok: false, error: 'No se pudo guardar la marca. Intenta de nuevo.' }
  }

  revalidatePath('/radar')
  return { ok: true }
}
