'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { bogotaYear } from '@/lib/dates/bogota'
import { puedeCorregirDocumentos } from '@/lib/roles'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { validateCorregir, type EstadoCotizacion } from '@/lib/cotizaciones/state-machine'
import { hayCotizacionEditableEnEtapa } from '@/lib/cotizaciones/etapa-editable'
import { formatCOP } from '@/lib/cobros/format'
import { cobradoConfirmado } from '@/lib/cobros/saldo-negocio'

export async function getCotizacionesNegocio(negocioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('cotizaciones')
    .select('id, consecutivo, modo, estado, valor_total, descripcion, created_at')
    .eq('negocio_id' as never, negocioId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function createCotizacionDetalladaNegocio(negocioId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false as const, error: 'No autenticado' }

  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  // Fallback con epoch para garantizar unicidad si el RPC falla
  const consecutivo = consecutivoRaw ?? `COT-${bogotaYear()}-${Date.now()}`

  const { data, error: dbError } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      consecutivo,
      codigo: '',
      modo: 'detallada',
      valor_total: 0,
      estado: 'borrador',
    } as never)
    .select('id')
    .single()

  if (dbError) return { success: false as const, error: dbError.message }
  if (!data) return { success: false as const, error: 'Error al crear cotización — intenta de nuevo' }

  // No revalidatePath aquí — esta función se llama desde server component render (nueva/page.tsx)
  // y Next.js 16 prohíbe revalidatePath durante render. El redirect posterior carga datos frescos.
  return { success: true as const, id: (data as { id: string }).id }
}

export async function enviarCotizacionNegocio(cotizacionId: string, negocioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false as const, error: 'No autenticado' }

  // Verificar que la cotización está en borrador
  const { data: cot, error: cotErr } = await supabase
    .from('cotizaciones')
    .select('estado')
    .eq('id', cotizacionId)
    .single()

  if (cotErr || !cot) return { success: false as const, error: 'Cotización no encontrada' }
  if ((cot as { estado: string }).estado !== 'borrador') {
    return { success: false as const, error: 'Solo se pueden enviar cotizaciones en borrador' }
  }

  // Solo 1 cotización enviada a la vez por negocio
  const { count } = await supabase
    .from('cotizaciones')
    .select('id', { count: 'exact', head: true })
    .eq('negocio_id' as never, negocioId)
    .eq('estado', 'enviada')

  if ((count ?? 0) > 0) {
    return { success: false as const, error: 'Ya hay una cotización enviada. Apruébala o recházala antes de enviar otra' }
  }

  const { error: updErr } = await supabase
    .from('cotizaciones')
    .update({ estado: 'enviada', updated_at: new Date().toISOString() } as never)
    .eq('id', cotizacionId)

  if (updErr) return { success: false as const, error: updErr.message }

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const }
}

export async function aceptarCotizacionNegocio(cotizacionId: string, negocioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false as const, error: 'No autenticado' }

  // Obtener valor_total y estado de la cotización
  const { data: cot, error: cotErr } = await supabase
    .from('cotizaciones')
    .select('valor_total, estado')
    .eq('id', cotizacionId)
    .single()

  if (cotErr || !cot) return { success: false as const, error: 'Cotización no encontrada' }
  const estadoCot = (cot as { estado: string }).estado
  if (estadoCot !== 'enviada' && estadoCot !== 'borrador') {
    return { success: false as const, error: 'Solo se pueden aprobar cotizaciones en borrador o enviadas' }
  }

  // Marcar cotización como aceptada (enviada → aceptada)
  const { error: updErr } = await supabase
    .from('cotizaciones')
    .update({ estado: 'aceptada', updated_at: new Date().toISOString() } as never)
    .eq('id', cotizacionId)

  if (updErr) return { success: false as const, error: updErr.message }

  // Actualizar precio_aprobado en negocio
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: negErr } = await (supabase as any)
    .from('negocios')
    .update({ precio_aprobado: (cot as { valor_total: number | null }).valor_total })
    .eq('id', negocioId)

  if (negErr) return { success: false as const, error: negErr.message }

  // Marcar TODOS los negocio_bloques de cotización como completo (todas las etapas)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloqueInstances } = await (supabase as any)
    .from('negocio_bloques')
    .select('id, bloque_configs!inner(bloque_definitions!inner(tipo))')
    .eq('negocio_id', negocioId)

  const cotBloqueIds = (bloqueInstances ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.bloque_configs?.bloque_definitions?.tipo === 'cotizacion')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.id as string)

  if (cotBloqueIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('negocio_bloques')
      .update({
        estado: 'completo',
        completado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', cotBloqueIds)
  }

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const }
}

/**
 * Suelta la aprobación de una cotización aceptada para corregirla.
 *
 * Deshace, en orden inverso, lo que hizo `aceptarCotizacionNegocio`: la cotización
 * vuelve a `borrador` (y con eso el editor la vuelve a abrir), el negocio se queda sin
 * `precio_aprobado` y los bloques de cotización vuelven a `pendiente`.
 *
 * ## Por qué existe
 *
 * `aceptada` era terminal (`isEditable` solo es cierto en `borrador`), así que el error
 * en un ítem detectado el mismo día —el caso de todos los días— solo tenía una salida:
 * duplicar la cotización, dejando dos documentos donde hubo un acuerdo.
 *
 * ## La ventana
 *
 * Solo mientras el negocio NO haya avanzado: el bloque de cotización de su etapa actual
 * tiene que estar declarado `editable`. El criterio se lee de la configuración del flujo
 * que ya existe (`hayCotizacionEditableEnEtapa`), no de una columna nueva, así que vale
 * para cualquier workspace sin migrar nada y se apaga solo cuando el caso pasa a una
 * etapa donde ese bloque es `visible`. Si ya avanzó, la salida sigue siendo duplicar:
 * aguas abajo alguien ya tomó decisiones sobre ese precio.
 *
 * ## La otra guarda: sin plata confirmada
 *
 * La misma que el límite 2 de `revertirAprobacionPropuesta`, y con el mismo criterio de
 * "pago confirmado" que usa el resto del producto: los cobros con `fecha`, contados por
 * `cobradoConfirmado`. No se reescribe la condición aquí — una copia se desincroniza, y
 * esta en particular decide plata. Con recaudo confirmado, soltar `precio_aprobado`
 * dejaría el saldo apuntando a un precio que dejó de existir; ahí también se duplica.
 *
 * En el caso diario la guarda no estorba: el negocio sigue en la etapa donde se cotiza y
 * todavía no ha entrado plata.
 *
 * ## Rastro
 *
 * Queda en `activity_log` quién la soltó y de qué valor venía. Soltar una aprobación sin
 * huella es peor que no poder soltarla: el precio del negocio cambia y su historia no lo
 * explica. Se usa `tipo: 'cambio'` sobre `campo_modificado: 'precio_aprobado'` —el mismo
 * par que `revertirAprobacionPropuesta`— porque el vocabulario de `activity_log.tipo`
 * está acotado por CHECK y agregarle un valor exige migración.
 *
 * Las validaciones viven en el SERVIDOR, no en la pantalla: esta función es un endpoint
 * alcanzable aunque el botón no se dibuje.
 */
export async function corregirCotizacionAceptada(cotizacionId: string, negocioId: string) {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false as const, error: 'No autenticado' }

  // Rol gerencial (owner/admin/supervisor). Se reusa el helper que ya define ese trío
  // en el producto en vez de escribir la lista otra vez: una copia se desincroniza.
  if (!puedeCorregirDocumentos(role)) {
    return { success: false as const, error: 'Solo un rol gerencial puede corregir una cotización aprobada' }
  }

  // La cotización existe, es de este negocio y de este workspace. El filtro por
  // workspace es explícito y no se delega al RLS del cliente: es el control, no un
  // efecto secundario de por dónde se leyó.
  const { data: cotRow, error: cotErr } = await supabase
    .from('cotizaciones')
    .select('id, estado, valor_total, consecutivo, negocio_id, workspace_id')
    .eq('id', cotizacionId)
    .maybeSingle()

  const cot = cotRow as {
    estado: string | null
    valor_total: number | null
    consecutivo: string | null
    negocio_id: string | null
    workspace_id: string | null
  } | null

  if (cotErr) return { success: false as const, error: cotErr.message }
  if (!cot || cot.workspace_id !== workspaceId || cot.negocio_id !== negocioId) {
    return { success: false as const, error: 'Cotización no encontrada en este negocio' }
  }

  // Etapa actual del negocio y el precio que la aprobación le fijó (se anota abajo:
  // después del update ya no se puede saber de qué valor venía).
  const { data: negRow, error: negErr } = await supabase
    .from('negocios')
    .select('etapa_actual_id, precio_aprobado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const negocio = negRow as { etapa_actual_id: string | null; precio_aprobado: number | null } | null
  if (negErr) return { success: false as const, error: negErr.message }
  if (!negocio) return { success: false as const, error: 'Negocio no encontrado' }

  // ¿Sigue parado donde la cotización se trabaja? Se traen los bloques de la etapa sin
  // filtrar por tipo ni estado y decide el helper puro: así este guard y el flag que
  // pinta el botón aplican EL MISMO criterio.
  let bloquesEtapa: Array<{ estado?: string | null; tipo?: string | null; desactivado?: boolean }> = []
  if (negocio.etapa_actual_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: configs, error: cfgErr } = await (supabase as any)
      .from('bloque_configs')
      .select('id, estado, config_extra, bloque_definitions!inner(tipo)')
      .eq('etapa_id', negocio.etapa_actual_id)
      .eq('workspace_id', workspaceId)

    // Si la config no se pudo leer, NO se asume que se puede corregir: la duda frena.
    if (cfgErr) return { success: false as const, error: 'No se pudo leer la configuración de la etapa' }

    bloquesEtapa = ((configs ?? []) as Array<Record<string, unknown>>).map((c) => ({
      estado: c.estado as string | null,
      tipo: (c.bloque_definitions as { tipo?: string } | null)?.tipo ?? null,
      desactivado: (c.config_extra as { desactivado?: boolean } | null)?.desactivado === true,
    }))
  }

  // ¿Ya entró plata? Se leen los cobros del negocio y decide el helper que define
  // "recaudo confirmado" en el producto: solo los que tienen `fecha`. Sin `.limit()`
  // a propósito — un tope haría que el monto del mensaje mienta hacia abajo.
  const { data: cobrosRows, error: cobrosErr } = await supabase
    .from('cobros')
    .select('monto, fecha')
    .eq('negocio_id', negocioId)
    .eq('workspace_id', workspaceId)

  // Si los cobros no se pudieron leer, NO se asume que no hay plata: la duda frena.
  if (cobrosErr) return { success: false as const, error: 'No se pudieron leer los pagos del negocio' }

  const recaudoConfirmado = cobradoConfirmado(
    (cobrosRows ?? []) as Array<{ monto: number | null; fecha: string | null }>,
  )

  const validacion = validateCorregir({
    currentStatus: (cot.estado ?? 'borrador') as EstadoCotizacion,
    totalPrice: cot.valor_total ?? 0,
    negocioEnEtapaEditable: hayCotizacionEditableEnEtapa(bloquesEtapa),
    recaudoConfirmado,
  })
  if (!validacion.valid) return { success: false as const, error: validacion.error ?? 'No se puede corregir' }

  const ahora = new Date().toISOString()

  // 1. La cotización vuelve a borrador → el editor la reabre.
  const { error: updCotErr } = await supabase
    .from('cotizaciones')
    .update({ estado: 'borrador', updated_at: ahora } as never)
    .eq('id', cotizacionId)
  if (updCotErr) return { success: false as const, error: updCotErr.message }

  // 2. El negocio se queda sin precio aprobado: dejarlo puesto haría que el valor a
  //    recaudar y el saldo se sigan calculando sobre un acuerdo que ya no está vigente.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updNegErr } = await (supabase as any)
    .from('negocios')
    .update({ precio_aprobado: null, updated_at: ahora })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
  if (updNegErr) return { success: false as const, error: updNegErr.message }

  // 3. Los bloques de cotización de TODAS las etapas vuelven a pendiente — espejo de
  //    `aceptarCotizacionNegocio`, que los completa todos. Si el bloque es gate, el
  //    negocio vuelve a quedar retenido hasta que se apruebe otra vez, que es lo
  //    correcto: ya no hay precio aprobado que lo sostenga.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloqueInstances } = await (supabase as any)
    .from('negocio_bloques')
    .select('id, bloque_configs!inner(bloque_definitions!inner(tipo))')
    .eq('negocio_id', negocioId)

  const cotBloqueIds = (bloqueInstances ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.bloque_configs?.bloque_definitions?.tipo === 'cotizacion')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.id as string)

  if (cotBloqueIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('negocio_bloques')
      .update({ estado: 'pendiente', completado_at: null, updated_at: ahora })
      .in('id', cotBloqueIds)
  }

  // 4. Rastro. `autor_id` es FK a staff(id), NO a profiles(id).
  const precioAnterior = negocio.precio_aprobado
  await registrarActividad(supabase, {
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio',
    autor_id: staffId ?? null,
    campo_modificado: 'precio_aprobado',
    valor_anterior: precioAnterior != null ? String(precioAnterior) : null,
    valor_nuevo: null,
    contenido: `${cot.consecutivo ? `Cotización ${cot.consecutivo}` : 'La cotización'} volvió a borrador para corregirla${
      precioAnterior != null ? ` (venía aprobada por ${formatCOP(precioAnterior)})` : ''
    }.`.slice(0, 280),
  }, 'corregirCotizacionAceptada')

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const }
}

export async function rechazarCotizacionNegocio(cotizacionId: string, negocioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false as const, error: 'No autenticado' }

  const { error: updErr } = await supabase
    .from('cotizaciones')
    .update({ estado: 'rechazada' } as never)
    .eq('id', cotizacionId)

  if (updErr) return { success: false as const, error: updErr.message }

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const }
}

export async function eliminarCotizacionBorrador(cotizacionId: string, negocioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false as const, error: 'No autenticado' }

  // Verificar que la cotización está en borrador
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('estado')
    .eq('id', cotizacionId)
    .single()

  if (!cot) return { success: false as const, error: 'Cotización no encontrada' }
  if ((cot as { estado: string }).estado !== 'borrador') {
    return { success: false as const, error: 'Solo se pueden eliminar cotizaciones en borrador' }
  }

  // Eliminar items y sus rubros primero (cascade no está configurado)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase as any)
    .from('items')
    .select('id')
    .eq('cotizacion_id', cotizacionId)

  if (items && items.length > 0) {
    const itemIds = items.map((i: { id: string }) => i.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('quote_items').delete().in('item_id', itemIds)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('items').delete().eq('cotizacion_id', cotizacionId)
  }

  const { error: delErr } = await supabase
    .from('cotizaciones')
    .delete()
    .eq('id', cotizacionId)

  if (delErr) return { success: false as const, error: delErr.message }

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const }
}

export async function duplicarCotizacionNegocio(cotizacionId: string, negocioId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false as const, error: 'No autenticado' }

  // Leer cotización original
  const { data: original, error: origErr } = await supabase
    .from('cotizaciones')
    .select('modo, descripcion, valor_total')
    .eq('id', cotizacionId)
    .single()

  if (origErr || !original) return { success: false as const, error: 'Cotización no encontrada' }

  // Nuevo consecutivo
  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const consecutivo = consecutivoRaw ?? `COT-${bogotaYear()}-${Date.now()}`

  const { data, error: dbError } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      consecutivo,
      codigo: '',
      modo: original.modo,
      descripcion: original.descripcion,
      valor_total: original.valor_total,
      estado: 'borrador',
    } as never)
    .select('id')
    .single()

  if (dbError) return { success: false as const, error: dbError.message }

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const, id: (data as { id: string }).id }
}
