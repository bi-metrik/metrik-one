'use server'

/**
 * Acciones del bloque «Servicios del viaje» (F0, plan post-cotización): traer las filas de la
 * cotización aceptada, editar lo básico de una fila y adjuntar su voucher o su confirmación.
 *
 * Cada acción revisa en el SERVIDOR quién la llama (Vera C15 y §7.4): editar filas es de
 * operaciones y de la dirección; adjuntar el voucher también lo puede la comercial responsable.
 * La pantalla solo esconde. Un negocio cerrado no se alimenta.
 *
 * Pagar al proveedor (`registrarPagoServicio`, con soporte, medio y titular) y las aprobaciones
 * de la dirección son de F3: aquí no se registra plata.
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { negocioCerrado, MENSAJE_NEGOCIO_CERRADO } from '@/lib/negocios/motivo-cierre'
import { subirAOne } from '@/lib/almacenamiento/one'
import { BUCKET_DOCUMENTOS_ONE, extensionSegura, rutaEnWorkspace } from '@/lib/almacenamiento/referencia'
import {
  aprobadoresDeLinea,
  puedeAdjuntarVoucher,
  puedeEditarServicios,
  puedeTraerServicios,
  serviciosViajeActivo,
  type QuienEdita,
} from '@/lib/viaje/estado-servicio'
import { generarServiciosDesdeTarifa } from '@/lib/viaje/servicios-viaje-datos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (c: unknown): any => c

const SIN_PERMISO = 'Tu rol o área no permite editar los servicios del viaje.'
const SIN_PERMISO_VOUCHER = 'Tu rol o área no permite adjuntar vouchers en este viaje.'
const APAGADO = 'Los servicios del viaje no están activos en esta línea.'

type Resultado = { ok: true } | { ok: false; error: string }

interface Contexto {
  supabase: unknown
  workspaceId: string
  staffId: string | null
  quien: QuienEdita
  activo: boolean
}

/** Sesión, módulo, negocio abierto y quién es, en una sola pasada. */
async function contextoDelNegocio(negocioId: string): Promise<Contexto | { error: string }> {
  const { supabase, workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  if (!(await exigirModulo(REQUISITO.clarity)).ok) return { error: MENSAJE_MODULO_NO_ACTIVO }

  const [negRes, respRes] = await Promise.all([
    db(supabase)
      .from('negocios')
      .select('id, estado, linea_id, lineas_negocio(config_extra)')
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
    db(supabase).from('negocio_responsables').select('staff_id').eq('negocio_id', negocioId),
  ])
  const neg = negRes.data as { estado: string | null; lineas_negocio?: unknown } | null
  if (!neg) return { error: 'Negocio no encontrado' }
  if (negocioCerrado(neg.estado)) return { error: MENSAJE_NEGOCIO_CERRADO }
  const linea = Array.isArray(neg.lineas_negocio) ? neg.lineas_negocio[0] : neg.lineas_negocio
  const config = (linea as { config_extra?: unknown } | null)?.config_extra ?? null
  const responsables = ((respRes.data ?? []) as Array<{ staff_id: string }>).map(r => r.staff_id)
  return {
    supabase,
    workspaceId,
    staffId: staffId ?? null,
    activo: serviciosViajeActivo(config),
    quien: {
      role,
      areas: (areas ?? []) as string[],
      staffId: staffId ?? null,
      aprobadores: aprobadoresDeLinea(config),
      esResponsable: !!staffId && responsables.includes(staffId),
    },
  }
}

/** La fila, de este workspace, con su negocio. */
async function servicioDe(supabase: unknown, workspaceId: string, servicioId: string) {
  const { data } = await db(supabase)
    .from('negocio_servicios')
    .select('id, negocio_id, estado')
    .eq('id', servicioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return data as { id: string; negocio_id: string; estado: string } | null
}

/**
 * «Traer los servicios de la cotización aceptada»: el mismo cálculo que corre al aceptar, para
 * cuando ese paso falló o el negocio se aceptó antes de encender la línea. Idempotente: tocarlo
 * dos veces no duplica (F0-3).
 */
export async function traerServiciosDeCotizacion(
  negocioId: string,
): Promise<{ ok: true; creadas: number } | { ok: false; error: string }> {
  const ctx = await contextoDelNegocio(negocioId)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!ctx.activo) return { ok: false, error: APAGADO }
  if (!puedeTraerServicios(ctx.quien)) return { ok: false, error: SIN_PERMISO }

  const { data: cot } = await db(ctx.supabase)
    .from('cotizaciones')
    .select('id')
    .eq('negocio_id', negocioId)
    .eq('workspace_id', ctx.workspaceId)
    .eq('estado', 'aceptada')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const cotizacionId = (cot as { id?: string } | null)?.id
  if (!cotizacionId) return { ok: false, error: 'Este negocio no tiene una cotización aceptada.' }

  const r = await generarServiciosDesdeTarifa(ctx.supabase, {
    workspaceId: ctx.workspaceId,
    negocioId,
    cotizacionId,
    staffId: ctx.staffId,
  })
  if (!r.ok) return { ok: false, error: r.error }
  if (r.apagado) return { ok: false, error: APAGADO }
  revalidatePath(`/negocios/${negocioId}`)
  return { ok: true, creadas: r.creadas }
}

export interface CambiosServicio {
  proveedor_nombre?: string | null
  localizador?: string | null
  fecha_limite_pago?: string | null
  /** Solo los estados que se escriben (Vera C6). Pagado y Confirmado salen de la plata. */
  estado?: 'por_reservar' | 'reservado' | 'cancelado'
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

function limpiarTexto(v: string | null | undefined, max: number): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t.slice(0, max)
}

/** Guardar un campo de la fila (al salir de él). */
export async function actualizarServicio(servicioId: string, cambios: CambiosServicio): Promise<Resultado> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const fila = await servicioDe(supabase, workspaceId, servicioId)
  if (!fila) return { ok: false, error: 'Servicio no encontrado' }
  const ctx = await contextoDelNegocio(fila.negocio_id)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!ctx.activo) return { ok: false, error: APAGADO }
  if (!puedeEditarServicios(ctx.quien)) return { ok: false, error: SIN_PERMISO }

  const patch: Record<string, unknown> = {}
  if ('proveedor_nombre' in cambios) patch.proveedor_nombre = limpiarTexto(cambios.proveedor_nombre, 200)
  if ('localizador' in cambios) patch.localizador = limpiarTexto(cambios.localizador, 100)
  if ('fecha_limite_pago' in cambios) {
    const f = (cambios.fecha_limite_pago ?? '').trim()
    if (f !== '' && !FECHA.test(f)) return { ok: false, error: 'La fecha límite no es válida.' }
    patch.fecha_limite_pago = f === '' ? null : f
  }
  if ('estado' in cambios) {
    if (!['por_reservar', 'reservado', 'cancelado'].includes(cambios.estado ?? '')) {
      return { ok: false, error: 'Ese estado no se escribe a mano.' }
    }
    patch.estado = cambios.estado
  }
  if (Object.keys(patch).length === 0) return { ok: true }
  patch.updated_at = new Date().toISOString()

  const { error: upErr } = await db(ctx.supabase)
    .from('negocio_servicios')
    .update(patch)
    .eq('id', servicioId)
    .eq('workspace_id', ctx.workspaceId)
  if (upErr) return { ok: false, error: upErr.message }
  revalidatePath(`/negocios/${fila.negocio_id}`)
  return { ok: true }
}

const MAX_ARCHIVO = 20 * 1024 * 1024
const TIPOS_ARCHIVO = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']

/**
 * Adjuntar el voucher o la confirmación del proveedor final, como ARCHIVO (pegado, foto o
 * subido): queda en Storage con una referencia `one://`, nunca un link pegado (F0-6).
 *
 * FormData: `servicioId`, `campo` ('voucher' | 'confirmacion') y `file`.
 */
export async function adjuntarArchivoServicio(formData: FormData): Promise<Resultado> {
  const servicioId = String(formData.get('servicioId') ?? '')
  const campo = String(formData.get('campo') ?? '')
  const file = formData.get('file') as File | null
  if (campo !== 'voucher' && campo !== 'confirmacion') return { ok: false, error: 'Adjunto no reconocido' }
  if (!file || file.size === 0) return { ok: false, error: 'Sin archivo' }
  if (file.size > MAX_ARCHIVO) return { ok: false, error: 'El archivo supera 20 MB' }
  if (!TIPOS_ARCHIVO.includes(file.type)) return { ok: false, error: 'Solo foto (JPEG, PNG, WebP, HEIC) o PDF' }

  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const fila = await servicioDe(supabase, workspaceId, servicioId)
  if (!fila) return { ok: false, error: 'Servicio no encontrado' }
  const ctx = await contextoDelNegocio(fila.negocio_id)
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!ctx.activo) return { ok: false, error: APAGADO }
  const permitido = campo === 'voucher' ? puedeAdjuntarVoucher(ctx.quien) : puedeEditarServicios(ctx.quien)
  if (!permitido) return { ok: false, error: campo === 'voucher' ? SIN_PERMISO_VOUCHER : SIN_PERMISO }

  const ext = extensionSegura(file.name.split('.').pop() ?? '') || (file.type === 'application/pdf' ? 'pdf' : 'jpg')
  let referencia: string
  try {
    const subido = await subirAOne({
      bucket: BUCKET_DOCUMENTOS_ONE,
      path: rutaEnWorkspace(ctx.workspaceId, 'negocios', fila.negocio_id, 'servicios', servicioId, `${campo}-${Date.now()}.${ext}`),
      cuerpo: file,
      mime: file.type,
      upsert: false,
    })
    referencia = subido.referencia
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const ahora = new Date().toISOString()
  const patch: Record<string, unknown> = campo === 'voucher'
    ? { voucher_ref: referencia, updated_at: ahora }
    : { confirmacion_ref: referencia, confirmado_at: ahora, updated_at: ahora }
  const { error: upErr } = await db(ctx.supabase)
    .from('negocio_servicios')
    .update(patch)
    .eq('id', servicioId)
    .eq('workspace_id', ctx.workspaceId)
  if (upErr) return { ok: false, error: upErr.message }
  revalidatePath(`/negocios/${fila.negocio_id}`)
  return { ok: true }
}
