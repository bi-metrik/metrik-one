'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { canEditBloque, type Area, type Role, type UserContext } from '@/lib/permissions/can-edit'
import { createServiceClient } from '@/lib/supabase/server'
import {
  BUCKET_DOCUMENTOS_SERVICIO,
  marcaReciboManual,
  problemaCargaRecibo,
  rutaRecibo,
} from '@/lib/valida-api/recibo-manual'

/**
 * `cargarReciboManual`: un recibo de caja hecho a mano se carga sobre el COBRO que respalda.
 *
 * Spec v2 §4.4, conservada por la spec 2026-09-15 §5.4 y §5.6. El primero es el RC-2026-09-001
 * de 4D SOFT, sobre el cobro `bold-TXRRP7Q95ZJ` del negocio X1 26 1.
 *
 * ## Barreras, en orden
 *
 *   1. Área financiera (el mismo criterio de `recibos-control-actions.ts`): el recaudo es suyo.
 *   2. El cobro es del workspace de la sesión. Se lee con el cliente de servicio, así que el
 *      filtro por `workspace_id` es lo único que impide tocar un cobro de otro cliente: el id
 *      llega del navegador.
 *   3. No está anulado y no tiene ya un recibo. Un recibo sobre un cobro anulado respalda
 *      dinero que ya no cuenta; uno sobre un cobro que ya tiene recibo lo pisaría.
 *   4. La escritura es CONDICIONAL (`siigo_recibo is null`): si otra persona cargó uno entre la
 *      lectura y la escritura, esta no lo pisa. Leer y después escribir sin la condición es el
 *      read-modify-write que ya costó marcas perdidas en este repo.
 *
 * El PDF va al bucket privado `documentos-servicio`, nunca a Drive (ver `recibo-manual.ts`).
 */

export type ResultadoReciboManual = { ok: true; numero: string } | { ok: false; error: string }

async function ctxFinanciero(): Promise<
  { ok: true; workspaceId: string; staffId: string | null } | { ok: false; error: string }
> {
  const { workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  if (!canEditBloque(user, { stage: 'cobro' }, [])) {
    return { ok: false, error: 'Solo el área financiera carga recibos' }
  }
  return { ok: true, workspaceId, staffId: staffId ?? null }
}

export async function cargarReciboManual(formData: FormData): Promise<ResultadoReciboManual> {
  const ctx = await ctxFinanciero()
  if (!ctx.ok) return { ok: false, error: ctx.error }
  const { workspaceId, staffId } = ctx

  const cobroId = String(formData.get('cobro_id') ?? '').trim()
  const numero = String(formData.get('numero') ?? '')
  const archivo = formData.get('archivo')
  if (!cobroId) return { ok: false, error: 'Falta el cobro' }

  const descriptor = archivo instanceof File ? { nombre: archivo.name, tipo: archivo.type, tamano: archivo.size } : null
  const problema = problemaCargaRecibo(numero, descriptor)
  if (problema) return { ok: false, error: problema }

  const svc = createServiceClient()
  // `database.ts` no conoce `cobros.anulado_at` ni `cobros.siigo_recibo` (deuda de tipos ya
  // documentada): la consulta se tipa a mano en `FilaCobro`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = svc as any
  type FilaCobro = {
    id: string
    negocio_id: string | null
    monto: number | null
    anulado_at: string | null
    siigo_recibo: { numero?: string } | null
  }
  const { data: cobroCrudo, error: errorCobro } = await db
    .from('cobros')
    .select('id, negocio_id, monto, anulado_at, siigo_recibo')
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (errorCobro) return { ok: false, error: `No se pudo leer el cobro: ${errorCobro.message}` }
  const cobro = cobroCrudo as FilaCobro | null
  // Mismo mensaje si no existe o es de otro workspace: no se confirma la existencia de un id ajeno.
  if (!cobro) return { ok: false, error: 'Cobro no encontrado' }
  if (cobro.anulado_at) return { ok: false, error: 'El cobro está anulado: no se le carga recibo' }
  const previo = cobro.siigo_recibo
  if (previo?.numero) return { ok: false, error: `Ese cobro ya tiene el recibo ${previo.numero}` }

  const buffer = Buffer.from(await (archivo as File).arrayBuffer())
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const ruta = rutaRecibo(workspaceId, sha256)

  const subida = await svc.storage.from(BUCKET_DOCUMENTOS_SERVICIO).upload(ruta, buffer, {
    contentType: 'application/pdf',
    upsert: false,
  })
  // Por huella: si ya existe, es EL MISMO archivo, y reusarlo es correcto.
  if (subida.error && !/exists|duplicate/i.test(subida.error.message)) {
    return { ok: false, error: `No se pudo guardar el PDF: ${subida.error.message}` }
  }

  let nombre: string | null = null
  if (staffId) {
    const { data: st } = await svc.from('staff').select('full_name').eq('id', staffId).maybeSingle()
    nombre = (st?.full_name as string | null) ?? null
  }

  const marca = marcaReciboManual({
    numero,
    valor: Number(cobro.monto ?? 0),
    workspaceId,
    sha256,
    ahoraIso: new Date().toISOString(),
    por: nombre,
  })

  const { data: escritos, error: errorEscritura } = await db
    .from('cobros')
    .update({ siigo_recibo: marca })
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)
    .is('siigo_recibo', null)
    .select('id')
  if (errorEscritura) return { ok: false, error: `No se pudo registrar el recibo: ${errorEscritura.message}` }
  if (!escritos || escritos.length === 0) {
    return { ok: false, error: 'Otra persona cargó un recibo en ese cobro mientras tanto. Recarga la pantalla.' }
  }

  if (staffId && cobro.negocio_id) {
    await registrarActividad(
      svc,
      {
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: cobro.negocio_id,
        tipo: 'sistema',
        autor_id: staffId, // FK a staff(id), NO a profiles
        // `activity_log.contenido` tiene CHECK de 280 caracteres.
        contenido: `Recibo ${marca.numero} cargado a mano sobre un cobro (origen: manual)`.slice(0, 280),
      },
      'cargarReciboManual',
    )
  }

  revalidatePath('/conciliacion')
  if (cobro.negocio_id) revalidatePath(`/negocios/${cobro.negocio_id}`)
  return { ok: true, numero: marca.numero }
}
