'use server'

/**
 * Acciones de los hitos de gestión (Agenda, brief del 2026-10-22): hecho en un toque, deshacer,
 * «No aplica» con motivo y adjuntar (adjuntar ES marcar hecho).
 *
 * El servidor recalcula los hitos del negocio y solo acepta una llave que exista HOY con esa fecha:
 * no se guarda una marca de un hito inventado ni de una fecha vieja. Quién puede: la responsable
 * del hito, quien lleva el negocio o la dirección (owner/admin o aprobadores de la línea). La
 * pantalla solo esconde.
 *
 * El adjunto va al bucket de documentos de ONE con referencia `one://` (el mismo de los vouchers de
 * la etapa 5): no se crea ningún bucket.
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { negocioCerrado, MENSAJE_NEGOCIO_CERRADO } from '@/lib/negocios/motivo-cierre'
import { subirAOne } from '@/lib/almacenamiento/one'
import { BUCKET_DOCUMENTOS_ONE, extensionSegura, rutaEnWorkspace } from '@/lib/almacenamiento/referencia'
import { aprobadoresDeLinea, esDireccion } from '@/lib/viaje/estado-servicio'
import { hitosDelNegocio } from '@/lib/viaje/hitos-datos'
import { validarCierreHito, type LectorPasabordo } from '@/lib/viaje/hitos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (c: unknown): any => c

type Resultado = { ok: true } | { ok: false; error: string }

const MAX_ARCHIVO = 20 * 1024 * 1024
const TIPOS_ARCHIVO = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
const SIN_PERMISO = 'Este hito no es tuyo. Lo cierra quien lo tiene, quien lleva el viaje o la dirección.'

/**
 * Gancho de la lectura del pasabordo (fuera de esta ola: no se gasta cuota de ningún modelo). Cuando
 * exista, compara lo leído con el tramo y deja el aviso en ámbar si no cuadra.
 */
const LEER_PASABORDO: LectorPasabordo | null = null

async function contexto(negocioId: string, llave: string) {
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' } as const
  if (!(await exigirModulo(REQUISITO.clarity)).ok) return { error: MENSAJE_MODULO_NO_ACTIVO } as const
  const [negRes, respRes] = await Promise.all([
    db(supabase).from('negocios').select('id, estado, linea_id, lineas_negocio(config_extra)').eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle(),
    db(supabase).from('negocio_responsables').select('staff_id').eq('negocio_id', negocioId),
  ])
  const neg = negRes.data as { estado: string | null; linea_id: string | null; lineas_negocio?: unknown } | null
  if (!neg || !neg.linea_id) return { error: 'Negocio no encontrado' } as const
  if (negocioCerrado(neg.estado)) return { error: MENSAJE_NEGOCIO_CERRADO } as const
  const linea = Array.isArray(neg.lineas_negocio) ? neg.lineas_negocio[0] : neg.lineas_negocio
  const config = (linea as { config_extra?: unknown } | null)?.config_extra ?? null
  const { hitos } = await hitosDelNegocio(db(supabase), { workspaceId, negocioId, linea: { id: neg.linea_id, config_extra: config } })
  const hito = hitos.find(h => h.llave === llave)
  if (!hito) return { error: 'Este hito ya no está: la fecha del servicio cambió o el viaje ya no lo tiene. Recarga la agenda.' } as const
  const responsablesNegocio = ((respRes.data ?? []) as Array<{ staff_id: string }>).map(r => r.staff_id)
  const puede = esDireccion({ role, staffId, aprobadores: aprobadoresDeLinea(config) })
    || (!!staffId && (hito.responsables.includes(staffId) || responsablesNegocio.includes(staffId)))
  if (!puede) return { error: SIN_PERMISO } as const
  return { supabase, workspaceId, staffId: staffId ?? null, hito } as const
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filtroLlave(q: any, h: { negocioId: string; servicioId: string | null; tramo: number | null; hitoId: string; fechaAncla: string | null }) {
  let r = q.eq('negocio_id', h.negocioId).eq('hito_id', h.hitoId).eq('fecha_objetivo', h.fechaAncla)
  r = h.servicioId ? r.eq('servicio_id', h.servicioId) : r.is('servicio_id', null)
  r = h.tramo !== null ? r.eq('tramo', h.tramo) : r.is('tramo', null)
  return r
}

async function guardar(
  ctx: { supabase: unknown; workspaceId: string; staffId: string | null; hito: Awaited<ReturnType<typeof hitosDelNegocio>>['hitos'][number] },
  estado: 'hecho' | 'no_aplica',
  nota: string | null,
  evidenciaRef: string | null,
): Promise<Resultado> {
  const h = ctx.hito
  const ahora = new Date().toISOString()
  const { error } = await db(ctx.supabase).from('negocio_hitos').upsert(
    {
      workspace_id: ctx.workspaceId,
      negocio_id: h.negocioId,
      servicio_id: h.servicioId,
      tramo: h.tramo,
      hito_id: h.hitoId,
      fecha_objetivo: h.fechaAncla,
      estado,
      nota,
      evidencia_ref: evidenciaRef ?? h.marca?.evidencia_ref ?? null,
      hecho_por: ctx.staffId,
      hecho_at: ahora,
      updated_at: ahora,
    },
    { onConflict: 'negocio_id,servicio_id,tramo,hito_id,fecha_objetivo' },
  )
  if (error) {
    if (/negocio_hitos_no_aplica_con_motivo/.test(error.message)) return { ok: false, error: 'Escribe por qué no aplica.' }
    return { ok: false, error: error.message }
  }
  revalidatePath('/negocios')
  revalidatePath(`/negocios/${h.negocioId}`)
  return { ok: true }
}

/** «Hecho» (un toque, o con la nota que el hito pide) o «No aplica» (con motivo). */
export async function marcarHito(input: { negocioId: string; llave: string; estado: 'hecho' | 'no_aplica'; nota?: string | null }): Promise<Resultado> {
  if (input.estado !== 'hecho' && input.estado !== 'no_aplica') return { ok: false, error: 'Estado no reconocido' }
  const ctx = await contexto(input.negocioId, input.llave)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const v = validarCierreHito(ctx.hito, { estado: input.estado, nota: input.nota ?? null, conAdjunto: false })
  if (!v.ok) return v
  return guardar(ctx, input.estado, v.nota, null)
}

/** «Deshacer»: borra la marca. Lo que se cerró solo (documentos, confirmación) no se deshace aquí. */
export async function deshacerHito(input: { negocioId: string; llave: string }): Promise<Resultado> {
  const ctx = await contexto(input.negocioId, input.llave)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  if (!ctx.hito.marca) return { ok: false, error: 'No hay nada que deshacer.' }
  const { error } = await filtroLlave(db(ctx.supabase).from('negocio_hitos').delete().eq('workspace_id', ctx.workspaceId), ctx.hito)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/negocios')
  revalidatePath(`/negocios/${ctx.hito.negocioId}`)
  return { ok: true }
}

/**
 * Adjuntar el pasabordo, el voucher de la asistencia o el comprobante del pre-registro: adjuntar
 * marca el hito hecho (sin un segundo botón). FormData: `negocioId`, `llave`, `file`.
 */
export async function adjuntarHito(formData: FormData): Promise<Resultado> {
  const negocioId = String(formData.get('negocioId') ?? '')
  const llave = String(formData.get('llave') ?? '')
  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { ok: false, error: 'Sin archivo' }
  if (file.size > MAX_ARCHIVO) return { ok: false, error: 'El archivo supera 20 MB' }
  if (!TIPOS_ARCHIVO.includes(file.type)) return { ok: false, error: 'Solo foto (JPEG, PNG, WebP, HEIC) o PDF' }
  const ctx = await contexto(negocioId, llave)
  if ('error' in ctx) return { ok: false, error: ctx.error as string }
  const v = validarCierreHito(ctx.hito, { estado: 'hecho', nota: ctx.hito.marca?.nota ?? null, conAdjunto: true })
  if (!v.ok) return v
  const ext = extensionSegura(file.name.split('.').pop() ?? '') || (file.type === 'application/pdf' ? 'pdf' : 'jpg')
  let referencia: string
  try {
    const subido = await subirAOne({
      bucket: BUCKET_DOCUMENTOS_ONE,
      path: rutaEnWorkspace(ctx.workspaceId, 'negocios', negocioId, 'hitos', `${ctx.hito.hitoId}${ctx.hito.tramo ? `-t${ctx.hito.tramo}` : ''}-${Date.now()}.${ext}`),
      cuerpo: file,
      mime: file.type,
      upsert: false,
    })
    referencia = subido.referencia
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (LEER_PASABORDO && ctx.hito.hitoId === 'checkin_vuelo') {
    // Fuera de esta ola: aquí iría el aviso «el pasabordo dice 27 oct y el vuelo es 28 oct».
    await LEER_PASABORDO(referencia).catch(() => null)
  }
  return guardar(ctx, 'hecho', v.nota, referencia)
}
