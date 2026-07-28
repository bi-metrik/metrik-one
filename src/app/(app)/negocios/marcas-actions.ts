'use server'

/**
 * Marcas de condición económica de un negocio (descuento, sin honorario, otra).
 *
 * Eje INDEPENDIENTE del origen: el origen dice de dónde vino el negocio y se
 * captura obligatoriamente al crearlo; la marca dice bajo qué condición atípica
 * se cerró, es opcional, puede haber varias y se pone o quita después.
 *
 * Viven en `negocios.metadata.marcas` (no columna) porque son opcionales, se
 * editan y su único consumidor es el conteo de la financiera ("cuántos negocios
 * cerramos con descuento este mes"). El origen sí es columna porque se filtra,
 * se cuenta y alimentará comisiones.
 *
 * Invariante: UNA marca por tipo. Volver a agregar el mismo tipo actualiza la
 * nota y re-estampa quién/cuándo. Sin esto, "cuántos negocios con descuento"
 * podría contar dos veces el mismo negocio y quitar una marca sería ambiguo.
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { puedeMarcarCondicionNegocio } from '@/lib/roles'
import {
  esMarcaCondicionValida,
  leerMarcasDeMetadata,
  type MarcaCondicion,
  type MarcaCondicionTipo,
} from '@/lib/negocios/constants'

// `negocios.metadata` se lee/escribe con el cliente sin tipar (mismo patrón
// `db()` de negocio-v2-actions.ts para el schema que no está en database.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

type Resultado = { success: boolean; error?: string }

/**
 * Contexto común: autenticación + guard de rol + carga del negocio (acotado al
 * workspace). El guard server-side es la barrera real; que la UI esconda el
 * botón es solo UX.
 */
async function ctxMarca(negocioId: string): Promise<
  | { ok: true; supabase: unknown; workspaceId: string; staffId: string | null
      marcas: MarcaCondicion[]; metadata: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  if (!puedeMarcarCondicionNegocio(role)) {
    return { ok: false, error: 'Solo dirección o un supervisor marca condiciones del negocio' }
  }

  const { data: negRow } = await db(supabase)
    .from('negocios')
    .select('metadata')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!negRow) return { ok: false, error: 'Negocio no encontrado' }

  const metadata = ((negRow as { metadata?: Record<string, unknown> | null }).metadata ?? {}) as Record<string, unknown>
  return { ok: true, supabase, workspaceId, staffId: staffId ?? null, marcas: leerMarcasDeMetadata(metadata), metadata }
}

/** Nombre de quien marca, para que la marca diga QUIÉN sin resolver joins después. */
async function nombreDeStaff(supabase: unknown, staffId: string | null): Promise<string | null> {
  if (!staffId) return null
  const { data } = await db(supabase).from('staff').select('full_name').eq('id', staffId).maybeSingle()
  return (data as { full_name: string | null } | null)?.full_name ?? null
}

/**
 * Persiste el arreglo de marcas dentro de metadata. MERGE, nunca overwrite: el
 * resto de metadata (atribución de Meta, seccional, fuente_cargue…) es dato
 * ajeno a esta acción y perderlo sería silencioso.
 *
 * Read-modify-write: dos personas marcando el MISMO negocio a la vez pueden
 * pisarse. Es aceptable (marcar es esporádico y manual) y el mismo patrón que
 * ya usa el resto de escrituras sobre metadata.
 */
async function guardarMarcas(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
  metadata: Record<string, unknown>,
  marcas: MarcaCondicion[],
): Promise<Resultado> {
  const { error } = await db(supabase)
    .from('negocios')
    .update({ metadata: { ...metadata, marcas } })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
  if (error) return { success: false, error: (error as { message: string }).message }

  revalidatePath('/negocios')
  revalidatePath(`/negocios/${negocioId}`)
  return { success: true }
}

export async function agregarMarcaNegocio(
  negocioId: string,
  tipo: string,
  nota?: string,
): Promise<Resultado> {
  if (!esMarcaCondicionValida(tipo)) return { success: false, error: `Marca no válida: ${tipo}` }

  const ctx = await ctxMarca(negocioId)
  if (!ctx.ok) return { success: false, error: ctx.error }

  const marcadoPorNombre = await nombreDeStaff(ctx.supabase, ctx.staffId)
  const nueva: MarcaCondicion = {
    tipo: tipo as MarcaCondicionTipo,
    nota: nota?.trim() ? nota.trim() : null,
    marcado_por_id: ctx.staffId,
    marcado_por_nombre: marcadoPorNombre,
    marcado_en: new Date().toISOString(),
  }
  // Una por tipo: si ya existía, esta la reemplaza (nota nueva + sello nuevo).
  const marcas = [...ctx.marcas.filter((m) => m.tipo !== nueva.tipo), nueva]

  return guardarMarcas(ctx.supabase, ctx.workspaceId, negocioId, ctx.metadata, marcas)
}

export async function quitarMarcaNegocio(negocioId: string, tipo: string): Promise<Resultado> {
  if (!esMarcaCondicionValida(tipo)) return { success: false, error: `Marca no válida: ${tipo}` }

  const ctx = await ctxMarca(negocioId)
  if (!ctx.ok) return { success: false, error: ctx.error }

  const marcas = ctx.marcas.filter((m) => m.tipo !== tipo)
  if (marcas.length === ctx.marcas.length) return { success: true } // idempotente

  return guardarMarcas(ctx.supabase, ctx.workspaceId, negocioId, ctx.metadata, marcas)
}
