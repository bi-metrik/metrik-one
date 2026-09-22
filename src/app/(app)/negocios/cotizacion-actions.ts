'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO, bogotaYear } from '@/lib/dates/bogota'
import { type ConvencionMargen } from '@/lib/cotizaciones/precio-item'
import { calcularCascada } from '@/lib/cotizaciones/totales'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { rastroDeCambioDeMargen, type ItemParaRastro } from '@/lib/cotizaciones/rastro-margen'
import { nombreParaDuplicado } from '@/lib/cotizaciones/nombre-cotizacion'
import {
  contextoDeCotizacion,
  desmarcarLosQueYaNoPueden,
  leerAdicionalesDeItems,
  leerItinerarios,
  totalDelPrincipal,
} from '@/lib/cotizaciones/itinerarios-datos'
import { adjuntarAdicionales } from '@/lib/cotizaciones/adicionales'
import { remapearOpcionDe, itinerariosParaLaCopia } from '@/lib/cotizaciones/duplicar-opciones'
import { itemsQueAportanAlTotal, normalizarGrupo } from '@/lib/cotizaciones/itinerarios'
import { costoDeRubrosConfirmados, esConfirmado } from '@/lib/cotizaciones/rubros-sugeridos'
import { motivoParaNoSalir, revisarExcepcionTrasCambio } from '@/lib/cotizaciones/piso-salida-datos'
import { createServiceClient } from '@/lib/supabase/server'
import { esBaseIvaLinea, type BaseIvaLinea } from '@/lib/fiscal/iva-cotizacion'

export async function getCotizaciones(oportunidadId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('cotizaciones')
    .select('id, codigo, consecutivo, modo, estado, valor_total, descuento_porcentaje, descuento_valor, margen_porcentaje, costo_total, descripcion, created_at')
    .eq('oportunidad_id', oportunidadId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getCotizacion(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('cotizaciones')
    .select('*, oportunidades(id, descripcion, empresa_id, empresas(id, nombre, numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, autorretenedor))')
    .eq('id', id)
    .single()

  return data
}

export async function getCotizacionItems(cotizacionId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('items')
    .select('*, rubros(*)')
    .eq('cotizacion_id', cotizacionId)
    .order('orden')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as any[]
}

export async function createCotizacionFlash(oportunidadId: string, descripcion: string, valorTotal: number) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get consecutivo
  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const consecutivo = consecutivoRaw ?? `COT-${bogotaYear()}-0000`

  const { data, error: dbError } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      oportunidad_id: oportunidadId,
      consecutivo,
      codigo: '',
      modo: 'flash',
      descripcion: descripcion.trim(),
      valor_total: valorTotal,
      estado: 'borrador',
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath(`/pipeline/${oportunidadId}`)
  return { success: true, id: data.id }
}

export async function createCotizacionDetallada(oportunidadId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const consecutivo = consecutivoRaw ?? `COT-${bogotaYear()}-0000`

  const { data, error: dbError } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      oportunidad_id: oportunidadId,
      consecutivo,
      codigo: '',
      modo: 'detallada',
      valor_total: 0,
      estado: 'borrador',
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath(`/pipeline/${oportunidadId}`)
  return { success: true, id: data.id }
}

export async function updateCotizacion(id: string, updates: Record<string, unknown>) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Este endpoint acepta cualquier columna, así que también es una puerta a `estado`.
  // Mandar o aprobar por aquí tiene que pasar por el mismo margen mínimo que los botones.
  if (updates.estado === 'enviada' || updates.estado === 'aceptada') {
    if (!workspaceId) return { success: false, error: 'No autenticado' }
    const motivo = await motivoParaNoSalir(supabase, {
      servicio: createServiceClient, workspaceId, cotizacionId: id, staffId,
    })
    if (motivo) return { success: false, error: motivo }
  }

  const { error: dbError } = await supabase
    .from('cotizaciones')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  // Revalidar path correcto según el origen de la cotización
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cot } = await (supabase as any)
    .from('cotizaciones')
    .select('oportunidad_id, negocio_id')
    .eq('id', id)
    .single()

  if (cot?.negocio_id) {
    revalidatePath(`/negocios/${cot.negocio_id}`)
  } else if (cot?.oportunidad_id) {
    revalidatePath(`/pipeline/${cot.oportunidad_id}`)
  } else {
    revalidatePath('/pipeline')
  }
  return { success: true }
}

// ── Items CRUD ────────────────────────────────

/**
 * `grupo` es opcional: lo pasan los botones de tipo del editor («+ Vuelo», «+ Hotel»), que
 * crean la línea ya con su ranura en UN solo insert. Sin él, la línea nace sin grupo, como
 * siempre.
 */
export async function addItem(cotizacionId: string, nombre: string, precioVenta?: number, descripcion?: string, grupo?: string | null) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get max order
  const { data: existing } = await supabase
    .from('items')
    .select('orden')
    .eq('cotizacion_id', cotizacionId)
    .order('orden', { ascending: false })
    .limit(1)

  const nextOrden = (existing?.[0]?.orden ?? 0) + 1

  // El ítem nace SIN margen propio: `null` quiere decir "usa el de la cotización", que
  // es lo que se quiere el 90% de las veces. Copiarle el porcentaje al crearlo lo dejaba
  // marcado como excepción desde el primer día, y entonces subir el margen de la
  // cotización no movía ninguna línea.
  const margenInicial = null
  const grupoInicial = normalizarGrupo(grupo)

  const { data, error: dbError } = await supabase
    .from('items')
    .insert({
      cotizacion_id: cotizacionId,
      nombre: nombre.trim(),
      subtotal: 0,
      orden: nextOrden,
      margen_porcentaje: margenInicial,
      // Un precio explicito al crear lo puso quien llama, no los rubros.
      ...(precioVenta != null ? { precio_venta: precioVenta, precio_manual: true } : {}),
      ...(descripcion ? { descripcion: descripcion.trim() } : {}),
      ...(grupoInicial ? { grupo: grupoInicial } : {}),
    } as never)
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  return { success: true, id: (data as { id: string }).id }
}

export async function updateItem(id: string, updates: {
  nombre?: string
  precio_venta?: number
  descuento_porcentaje?: number
  descripcion?: string | null
  cantidad?: number
  /** Margen propio de la línea. `null` la devuelve al margen de la cotización. */
  margen_porcentaje?: number | null
  precio_manual?: boolean
  /** Costo unitario escrito a mano. Solo aplica al ítem SIN rubros. */
  subtotal?: number
  /**
   * Sobre qué va el IVA de esta línea (`iva-cotizacion.ts`). `null` = sigue al workspace.
   * No mueve el precio ni la cascada: solo el IVA, y solo donde el workspace liquida el IVA
   * sobre el ingreso propio.
   */
  base_iva?: BaseIvaLinea | null
}) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Un valor fuera de los tres se rechaza en el servidor: una server action es un endpoint
  // alcanzable aunque la pantalla solo ofrezca tres opciones.
  if (updates.base_iva !== undefined && updates.base_iva !== null && !esBaseIvaLinea(updates.base_iva)) {
    return { success: false, error: 'Base de IVA desconocida' }
  }

  // El margen es el único campo del ítem que decide cuánto gana la agencia, y lo puede
  // cambiar cualquiera que abra la cotización. El valor anterior se lee ANTES de
  // pisarlo: después ya no existe en ninguna parte, y "por qué este viaje salió al 3%"
  // se queda sin respuesta. Ver `registrarCambioDeMargen`.
  const rastreaMargen = typeof updates.margen_porcentaje === 'number'
  const antes = rastreaMargen ? await leerItemParaRastro(supabase, id) : null

  const patch: Record<string, unknown> = {}
  if (updates.nombre !== undefined) patch.nombre = updates.nombre.trim()
  if (updates.precio_venta !== undefined) patch.precio_venta = updates.precio_venta
  if (updates.descuento_porcentaje !== undefined) patch.descuento_porcentaje = updates.descuento_porcentaje
  if (updates.descripcion !== undefined) patch.descripcion = updates.descripcion?.trim() || null
  if (updates.cantidad !== undefined) patch.cantidad = updates.cantidad
  if (updates.margen_porcentaje !== undefined) patch.margen_porcentaje = updates.margen_porcentaje
  if (updates.precio_manual !== undefined) patch.precio_manual = updates.precio_manual
  // Costo directo: el ítem que no se desglosa en rubros guarda su costo unitario en
  // `subtotal`, que es de donde ya lo leen `costo_total` y el presupuesto de Ejecución.
  // El guard vive abajo: con rubros, el costo lo mandan ellos.
  if (updates.subtotal !== undefined) patch.subtotal = Math.max(0, Math.round(updates.subtotal))
  if (updates.base_iva !== undefined) patch.base_iva = updates.base_iva

  // Escribir el valor unitario a mano ES declarar que el precio lo pone una persona.
  // Sin esto, el siguiente recalcularTotales lo reemplazaria por el costo de rubros
  // y el usuario veria su cifra desaparecer sin explicacion.
  if (updates.precio_venta !== undefined && updates.precio_manual === undefined) {
    patch.precio_manual = true
  }

  // Un ítem con rubros toma su costo de ellos. Escribir `subtotal` a mano ahí dejaría
  // dos costos para el mismo ítem y el recálculo pisaría uno de los dos: se rechaza en
  // el servidor en vez de confiar en que la pantalla no ofrezca el campo.
  if (patch.subtotal !== undefined) {
    // Solo los CONFIRMADOS bloquean. Un item que solo tiene la propuesta de un
    // pantallazo todavia no tiene costo por rubros, asi que escribirlo a mano vale:
    // confirmar despues reemplaza el desglose y `subtotal` vuelve a cero, que es el
    // mismo guard que ya aplica `confirmarLecturaDePantallazo`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rubrosDelItem } = await (supabase as any)
      .from('rubros')
      .select('*')
      .eq('item_id', id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const confirmados = ((rubrosDelItem ?? []) as any[]).filter(esConfirmado)
    if (confirmados.length > 0) {
      return { success: false, error: 'Este ítem tiene rubros: su costo sale de ellos, no se escribe a mano' }
    }
  }

  const { error: dbError } = await supabase
    .from('items')
    .update(patch as never)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  // Después del update, y solo si de verdad se guardó: un rastro de un cambio que la
  // base rechazó es peor que ninguno.
  if (rastreaMargen && antes && workspaceId) {
    await registrarCambioDeMargen({
      supabase,
      workspaceId,
      staffId,
      antes,
      margenNuevo: Number(updates.margen_porcentaje) || 0,
    })
  }

  return { success: true }
}

/**
 * Lee el estado previo del ítem y a qué negocio cuelga.
 *
 * Devuelve `null` si no se puede leer. El rastro es un acompañante del cambio, no su
 * condición: no poder anotarlo no puede impedir que alguien corrija un margen.
 */
async function leerItemParaRastro(
  // Mismo criterio que el resto del archivo: el cliente tipado obliga a arrastrar el
  // tipo generado del embed, que aquí no aporta nada.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  itemId: string,
): Promise<ItemParaRastro | null> {
  const { data } = await supabase
    .from('items')
    .select('nombre, margen_porcentaje, cotizaciones(negocio_id, oportunidad_id)')
    .eq('id', itemId)
    .maybeSingle()

  if (!data) return null

  // PostgREST devuelve el embed como objeto o como array de uno según cómo resuelva la
  // relación; las dos formas son válidas. Mismo caso que en `politicaMargenDelNegocio`.
  const cot = Array.isArray(data.cotizaciones) ? data.cotizaciones[0] : data.cotizaciones
  const margen = Number(data.margen_porcentaje)

  return {
    nombre: data.nombre ?? null,
    margenAnterior: Number.isFinite(margen) ? margen : null,
    negocioId: cot?.negocio_id ?? null,
    oportunidadId: cot?.oportunidad_id ?? null,
  }
}

/**
 * Deja en el timeline quién movió el margen de un ítem, de cuánto a cuánto.
 *
 * QUÉ anotar lo decide `rastroDeCambioDeMargen`, que es puro y está probado aparte.
 * Aquí solo queda el insert, que nunca lanza: `registrarActividad` garantiza que un
 * rechazo del log no tumbe la operación que lo originó, y reporta el motivo a consola.
 */
async function registrarCambioDeMargen(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  workspaceId: string
  staffId: string | null
  antes: ItemParaRastro
  margenNuevo: number
}): Promise<void> {
  const { supabase, workspaceId, staffId, antes, margenNuevo } = args

  const rastro = rastroDeCambioDeMargen(antes, margenNuevo)
  if (!rastro) return

  await registrarActividad(supabase, {
    workspace_id: workspaceId,
    entidad_tipo: rastro.entidadTipo,
    entidad_id: rastro.entidadId,
    tipo: 'cambio',
    autor_id: staffId,
    campo_modificado: 'margen_porcentaje',
    valor_anterior: rastro.valorAnterior,
    valor_nuevo: rastro.valorNuevo,
    contenido: rastro.contenido,
  }, 'updateItem')
}

/**
 * El rastro de cambios de margen, para poder LEERLO.
 *
 * `registrarCambioDeMargen` lo escribe desde el 2026-09-11 y hasta hoy no lo mostraba
 * ninguna pantalla: medido contra producción el 2026-09-14, `activity_log` tiene CERO
 * filas con `campo_modificado = 'margen_porcentaje'` en los 17 workspaces. O sea que
 * "el dato ya está en base" era cierto como mecanismo y falso como hecho — lo que se
 * puede leer aquí es lo que pase de ahora en adelante.
 *
 * ⚠️ El rastro cuelga del NEGOCIO (o de la oportunidad), no de la cotización:
 * `activity_log` no tiene `cotizacion_id`. Así que esta lista cubre los cambios de
 * margen de TODAS las cotizaciones del mismo negocio, y la pantalla tiene que decirlo.
 * Filtrarla por los nombres de los ítems de esta cotización sería peor: los nombres se
 * repiten entre variantes del mismo viaje y el filtro escondería cambios reales.
 *
 * Devuelve el error en vez de una lista vacía: un `?? []` convertiría un fallo de
 * permisos en "nadie ha tocado el margen", que es la afirmación contraria.
 */
export async function getRastroDeMargen(cotizacionId: string): Promise<
  | { ok: true; entradas: RastroMargenEntrada[]; alcance: 'negocio' | 'oportunidad' }
  | { ok: false; error: string }
> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }

  const { data: cot, error: cotErr } = await supabase
    .from('cotizaciones')
    .select('negocio_id, oportunidad_id, workspace_id')
    .eq('id', cotizacionId)
    .maybeSingle()

  if (cotErr) return { ok: false, error: cotErr.message }
  const fila = cot as { negocio_id: string | null; oportunidad_id: string | null; workspace_id: string | null } | null
  // El filtro por workspace es explícito, no un efecto secundario del RLS.
  if (!fila || fila.workspace_id !== workspaceId) return { ok: false, error: 'Cotización no encontrada' }

  const entidadId = fila.negocio_id ?? fila.oportunidad_id
  const alcance = fila.negocio_id ? ('negocio' as const) : ('oportunidad' as const)
  if (!entidadId) return { ok: true, entradas: [], alcance }

  const { data, error: logErr } = await supabase
    .from('activity_log')
    .select('id, contenido, valor_anterior, valor_nuevo, created_at, autor:staff!activity_log_autor_id_fkey(full_name)')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', alcance)
    .eq('entidad_id', entidadId)
    .eq('campo_modificado', 'margen_porcentaje')
    .order('created_at', { ascending: false })
    .limit(50)

  if (logErr) return { ok: false, error: logErr.message }

  const entradas = ((data ?? []) as unknown as RastroMargenFila[]).map((f) => {
    // El embed llega como objeto o como array de uno según cómo resuelva PostgREST la
    // relación. Mismo caso que en `politicaMargenDelNegocio`.
    const autor = Array.isArray(f.autor) ? f.autor[0] : f.autor
    return {
      id: f.id,
      contenido: f.contenido ?? '',
      valorAnterior: f.valor_anterior ?? null,
      valorNuevo: f.valor_nuevo ?? null,
      creadoEn: f.created_at,
      autor: autor?.full_name ?? null,
    }
  })

  return { ok: true, entradas, alcance }
}

/** Una línea del rastro, ya lista para pintar. */
export interface RastroMargenEntrada {
  id: string
  contenido: string
  valorAnterior: string | null
  valorNuevo: string | null
  creadoEn: string
  /** `null` cuando el cambio quedó sin autor (proceso automático o staff borrado). */
  autor: string | null
}

type RastroMargenFila = {
  id: string
  contenido: string | null
  valor_anterior: string | null
  valor_nuevo: string | null
  created_at: string
  autor: { full_name: string | null } | { full_name: string | null }[] | null
}

export async function deleteItem(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Fetch item details before deleting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item } = await (supabase as any)
    .from('items')
    .select('cotizacion_id, servicio_origen_id, subtotal, es_ajuste')
    .eq('id', id)
    .single()

  if (!item) return { success: false, error: 'Item no encontrado' }

  // Never allow deleting the adjustment item directly
  if (item.es_ajuste) return { success: false, error: 'El item de ajuste se gestiona automáticamente' }

  // Check if there's an active adjustment item for this cotizacion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ajusteItems } = await (supabase as any)
    .from('items')
    .select('id')
    .eq('cotizacion_id', item.cotizacion_id)
    .eq('es_ajuste', true)
    .limit(1)
  const hayAjuste = (ajusteItems ?? []).length > 0

  // Determine how much to subtract from valor_total:
  // 1. If item has servicio_origen_id → use that service's precio_estandar
  // 2. Fallback → use the item's subtotal (cost-based estimate)
  let precioRestar = 0
  if (!hayAjuste) {
    if (item.servicio_origen_id) {
      const { data: servicio } = await supabase
        .from('servicios')
        .select('precio_estandar')
        .eq('id', item.servicio_origen_id)
        .single()
      precioRestar = servicio?.precio_estandar ?? (item.subtotal ?? 0)
    } else {
      precioRestar = item.subtotal ?? 0
    }
  }

  const { error: dbError } = await supabase
    .from('items')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  if (hayAjuste) {
    // Re-reconcile: recalcularTotales will update the adjustment item
    // (caller should call recalcularTotales after deleteItem)
  } else if (precioRestar > 0) {
    // No adjustment item: subtract from valor_total manually
    const { data: cot } = await supabase
      .from('cotizaciones')
      .select('valor_total')
      .eq('id', item.cotizacion_id)
      .single()

    const newValor = Math.max(0, (cot?.valor_total ?? 0) - precioRestar)
    await supabase
      .from('cotizaciones')
      .update({ valor_total: newValor })
      .eq('id', item.cotizacion_id)
  }

  // Borrar una LINEA puede romper un itinerario: sus vinculos se van por cascada, y
  // el que la tenia elegida queda sin resolver esa ranura. Si ademas iba en la
  // propuesta, sale de ella aqui — un itinerario incompleto no puede llegar al
  // cliente (R2), y esta es la unica puerta que lo puede dejar asi sin que nadie
  // toque la tabla de combinaciones.
  //
  // ⚠️ Borrar el TITULAR se lleva sus opciones por `on delete cascade` de
  // `items.opcion_de`: la ranura entera desaparece y los itinerarios vuelven a estar
  // completos sin ella. Es el desenlace correcto y no hace falta nada mas.
  const desmarcados = await desmarcarLosQueYaNoPueden(supabase, item.cotizacion_id)

  return { success: true, desmarcados }
}

// ── Add from servicio catalog (deep copy) ─────────

export async function addItemFromServicio(cotizacionId: string, servicioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get the servicio template
  const { data: servicio } = await supabase
    .from('servicios')
    .select('nombre, precio_estandar, rubros_template')
    .eq('id', servicioId)
    .single()

  if (!servicio) return { success: false, error: 'Servicio no encontrado' }

  // Get max order
  const { data: existing } = await supabase
    .from('items')
    .select('orden')
    .eq('cotizacion_id', cotizacionId)
    .order('orden', { ascending: false })
    .limit(1)

  const nextOrden = (existing?.[0]?.orden ?? 0) + 1

  const rubrosTemplate = servicio.rubros_template as {
    tipo: string; descripcion?: string; cantidad: number; unidad: string; valor_unitario: number
  }[] | null

  // Calculate subtotal from rubros or use precio_estandar
  const subtotal = rubrosTemplate && rubrosTemplate.length > 0
    ? rubrosTemplate.reduce((sum, r) => sum + (r.cantidad * r.valor_unitario), 0)
    : (servicio.precio_estandar ?? 0)

  const precioVenta = servicio.precio_estandar ?? subtotal

  // El precio del catalogo lo fijo una persona en Config -> Mis servicios, asi que
  // nace como precio manual y recalcularTotales no lo reemplaza por el costo de los
  // rubros. Es el comportamiento que ya tenia antes del margen por rubros. Si el
  // servicio no declara precio, el item queda derivable desde sus rubros.
  const precioDelCatalogo = (servicio.precio_estandar ?? 0) > 0

  // Create item (store servicio_origen_id so deleteItem can reverse the valor_total change)
  const { data: newItem, error: itemError } = await supabase
    .from('items')
    .insert({
      cotizacion_id: cotizacionId,
      nombre: servicio.nombre,
      subtotal,
      orden: nextOrden,
      servicio_origen_id: servicioId,
      precio_venta: precioVenta,
      precio_manual: precioDelCatalogo,
    } as never)
    .select('id')
    .single()

  if (itemError) return { success: false, error: itemError.message }

  // Deep copy rubros from template
  if (rubrosTemplate && rubrosTemplate.length > 0 && newItem) {
    const rubrosToInsert = rubrosTemplate.map(r => ({
      item_id: newItem.id,
      tipo: r.tipo,
      descripcion: r.descripcion || null,
      cantidad: r.cantidad,
      unidad: r.unidad,
      valor_unitario: r.valor_unitario,
    }))
    await supabase.from('rubros').insert(rubrosToInsert)
  }

  // Check if there's an active adjustment item — if so, don't manually adjust valor_total
  // (recalcularTotales, called by the frontend after this, will re-reconcile)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ajusteItems } = await (supabase as any)
    .from('items')
    .select('id')
    .eq('cotizacion_id', cotizacionId)
    .eq('es_ajuste', true)
    .limit(1)
  const hayAjuste = (ajusteItems ?? []).length > 0

  if (!hayAjuste && precioVenta > 0) {
    const { data: cot } = await supabase
      .from('cotizaciones')
      .select('valor_total')
      .eq('id', cotizacionId)
      .single()

    await supabase
      .from('cotizaciones')
      .update({ valor_total: (cot?.valor_total ?? 0) + precioVenta })
      .eq('id', cotizacionId)
  }

  return { success: true, id: newItem?.id }
}

// ── Rubros CRUD ────────────────────────────────

export async function addRubro(itemId: string, rubro: {
  tipo: string
  descripcion?: string
  cantidad: number
  unidad: string
  valor_unitario: number
}) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { data, error: dbError } = await supabase
    .from('rubros')
    .insert({
      item_id: itemId,
      tipo: rubro.tipo,
      descripcion: rubro.descripcion?.trim() || null,
      cantidad: rubro.cantidad,
      unidad: rubro.unidad,
      valor_unitario: rubro.valor_unitario,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }
  return { success: true, id: data.id }
}

export async function updateRubro(id: string, updates: Record<string, unknown>) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // ⚠️ `sugerido` NO se escribe por aquí. Confirmar una propuesta es un acto con su
  // propia accion (`confirmarRubrosSugeridos`), que ademas reemplaza el desglose y
  // recalcula. Dejarlo entrar en este saco abriria una puerta trasera al costo desde
  // un endpoint que acepta cualquier columna.
  const { sugerido: _sugerido, ...permitidos } = updates as Record<string, unknown> & { sugerido?: unknown }
  void _sugerido

  const { error: dbError } = await supabase
    .from('rubros')
    .update(permitidos)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }
  return { success: true }
}

export async function deleteRubro(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('rubros')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }
  return { success: true }
}

// ── State transitions ────────────────────────────

export async function enviarCotizacion(id: string) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Bajo el margen mínimo, sin la autorización del dueño, no sale (decisión del
  // 2026-09-22). En el servidor: el botón es solo la puerta visible.
  const motivo = await motivoParaNoSalir(supabase, {
    servicio: createServiceClient, workspaceId, cotizacionId: id, staffId,
  })
  if (motivo) return { success: false, error: motivo }

  // Get cotización to find oportunidad_id y negocio_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cot } = await (supabase as any)
    .from('cotizaciones')
    .select('oportunidad_id, negocio_id, valor_total')
    .eq('id', id)
    .single()

  if (!cot) return { success: false, error: 'Cotización no encontrada' }

  // Check if there's already an "enviada" cotización for this negocio/oportunidad
  const parentField = cot.negocio_id ? 'negocio_id' : 'oportunidad_id'
  const parentId = cot.negocio_id ?? cot.oportunidad_id

  const { data: existente } = await supabase
    .from('cotizaciones')
    .select('consecutivo')
    .eq(parentField as never, parentId)
    .eq('estado', 'enviada')
    .maybeSingle()

  if (existente) {
    return {
      success: false,
      error: `Ya hay una cotización enviada. Apruébala o recházala antes de enviar otra.`,
    }
  }

  const { error: dbError } = await supabase
    .from('cotizaciones')
    .update({
      estado: 'enviada',
      fecha_envio: new Date().toISOString(),
      fecha_validez: todayBogotaISO(new Date(Date.now() + 30 * 86400000)),
    } as never)
    .eq('id', id)
    .eq('estado', 'borrador')

  if (dbError) return { success: false, error: dbError.message }

  if (cot.negocio_id) {
    revalidatePath(`/negocios/${cot.negocio_id}`)
  } else {
    revalidatePath('/pipeline')
  }
  return { success: true }
}

export async function aceptarCotizacion(id: string) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const motivo = await motivoParaNoSalir(supabase, {
    servicio: createServiceClient, workspaceId, cotizacionId: id, staffId,
  })
  if (motivo) return { success: false, error: motivo }

  const { error: dbError } = await supabase
    .from('cotizaciones')
    .update({ estado: 'aceptada' })
    .eq('id', id)
    .eq('estado', 'enviada')

  if (dbError) return { success: false, error: dbError.message }

  // Get oportunidad_id for chaining accept → win → project
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('oportunidad_id')
    .eq('id', id)
    .single()

  revalidatePath('/pipeline')
  return {
    success: true,
    shouldWin: true,
    oportunidadId: cot?.oportunidad_id ?? null,
  }
}

export async function rechazarCotizacion(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('cotizaciones')
    .update({ estado: 'rechazada' })
    .eq('id', id)
    .eq('estado', 'enviada')

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/pipeline')
  return { success: true }
}

export async function duplicarCotizacion(id: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get original
  const { data: original } = await supabase
    .from('cotizaciones')
    .select('oportunidad_id, modo, descripcion, valor_total, margen_porcentaje, costo_total')
    .eq('id', id)
    .single()

  if (!original) return { success: false, error: 'Cotizacion no encontrada' }

  // Get extra fields separately
  const { data: discountData } = await supabase
    .from('cotizaciones')
    .select('*')
    .eq('id', id)
    .single()
  const descPct = discountData?.descuento_porcentaje ?? 0
  const descVal = discountData?.descuento_valor ?? 0
  const negocioIdOrig = discountData?.negocio_id ?? null
  // `convencion_margen` y `margen_default_pct` existen en la base pero no en los tipos
  // generados; `piso_margen_pct` y `aviso_margen_pct` puede que ni existan todavía
  // (migración `20260914160000`). El `select('*')` de arriba las trae si están.
  const politicaOriginal = (discountData ?? {}) as Record<string, unknown>

  // Get new consecutivo
  const { data: dupConsRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const dupCons = dupConsRaw ?? `COT-${bogotaYear()}-0000`

  // El nombre NO se hereda tal cual: dos cotizaciones con la misma etiqueta son
  // exactamente lo que la comercial no puede distinguir en la lista, que es el
  // problema que esto viene a resolver. Se resuelve contra los hermanos del mismo
  // contenedor — el negocio, o la oportunidad cuando la cotización cuelga de una.
  let hermanos: { descripcion: string | null }[] = []
  if (negocioIdOrig) {
    const { data } = await supabase
      .from('cotizaciones')
      .select('descripcion')
      .eq('negocio_id', negocioIdOrig)
    hermanos = data ?? []
  } else if (original.oportunidad_id) {
    const { data } = await supabase
      .from('cotizaciones')
      .select('descripcion')
      .eq('oportunidad_id', original.oportunidad_id)
    hermanos = data ?? []
  }
  const descripcionCopia = nombreParaDuplicado(
    original.descripcion,
    hermanos.map(h => h.descripcion),
  )

  // ⚠️ Insert DIRECTO. Hasta el 2026-09-14 esto pasaba por `insertarCotizacionTolerante`,
  // que reintentaba sin las columnas de umbral si la migración no estaba aplicada. La
  // migración `20260914160000_cotizaciones_umbrales_margen.sql` YA está aplicada en
  // producción (comprobado leyendo `piso_margen_pct` y `aviso_margen_pct` por PostgREST)
  // y esta base es la única que el producto usa, así que la tolerancia solo servía para
  // tragarse un `42703` real como «nació sin congelar» — el fallo mudo que ella misma
  // decía combatir. La pieza se borró, como decía su propio comentario.
  // Los tipos generados de `cotizaciones` todavia no declaran `piso_margen_pct` ni
  // `aviso_margen_pct` (falta regenerar `database.ts`), asi que el cliente tipado
  // rechaza el objeto entero.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newCot, error: dbError } = await (supabase as any).from('cotizaciones').insert({
      workspace_id: workspaceId,
      oportunidad_id: original.oportunidad_id,
      consecutivo: dupCons,
      codigo: '',
      modo: original.modo,
      descripcion: descripcionCopia,
      valor_total: original.valor_total,
      margen_porcentaje: original.margen_porcentaje,
      costo_total: original.costo_total,
      estado: 'borrador',
      duplicada_de: id,
      descuento_porcentaje: descPct,
      descuento_valor: descVal,
      negocio_id: negocioIdOrig,
      aiu_admin_pct: discountData?.aiu_admin_pct ?? null,
      aiu_imprevistos_pct: discountData?.aiu_imprevistos_pct ?? null,
      // ⚠️ La política de margen se COPIA, no se vuelve a resolver contra la línea:
      // duplicar es corregir el mismo documento y tiene que cotizar con las mismas
      // reglas. Sin esto la copia caía al default de la columna (`markup`) y, con
      // una línea en `sobre_venta`, un costo de 1.000.000 al 15% pasaba de
      // 1.176.471 a 1.150.000 sin que nada en pantalla lo explicara.
      convencion_margen: politicaOriginal.convencion_margen ?? null,
      margen_default_pct: politicaOriginal.margen_default_pct ?? null,
      // Los umbrales congelados viajan igual. `discountData` sale de un `select('*')`,
      // así que mientras la migración no esté aplicada estas dos claves valen `null`
      // y la copia cae a la política de su línea, como hoy.
      piso_margen_pct: politicaOriginal.piso_margen_pct ?? null,
      aviso_margen_pct: politicaOriginal.aviso_margen_pct ?? null,
  }).select('id').single()

  if (dbError) return { success: false, error: dbError.message }

  // If detallada, duplicate items + rubros
  if (original.modo === 'detallada' && newCot) {
    // `select('*')` y no una lista de columnas: `grupo`, `opcion_de` y `unidad` las
    // agrega la migracion `20260914200000` y nombrarlas devolveria un 400 mientras no
    // este aplicada — o sea que duplicar dejaria de funcionar. La migracion
    // `20260914200000` SI esta aplicada hoy; el `select('*')` se queda porque es la
    // forma barata de no depender de eso en cada entorno.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: items } = await (supabase as any)
      .from('items')
      .select('*, rubros(*)')
      .eq('cotizacion_id', id)
      .order('orden')

    // Viejo id -> nuevo id. `items.opcion_de` es FK a la propia tabla y
    // `itinerario_opciones.item_id` apunta aqui: sin este mapa la copia quedaria
    // apuntando a los items del ORIGINAL, que no falla y mueve las combinaciones de
    // la cotizacion de la que salio.
    const mapaItems = new Map<string, string>()

    for (const item of items ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newItem } = await (supabase as any)
        .from('items')
        .insert({
          cotizacion_id: newCot.id,
          nombre: item.nombre,
          descripcion: item.descripcion ?? null,
          subtotal: item.subtotal,
          orden: item.orden,
          precio_venta: item.precio_venta ?? 0,
          descuento_porcentaje: item.descuento_porcentaje ?? 0,
          es_ajuste: item.es_ajuste ?? false,
          cantidad: item.cantidad ?? 1,
          // Sin heredar estas dos, la copia perderia el precio que alguien escribio:
          // nace con precio_manual = false y el primer recalculo la baja al costo.
          //
          // ⚠️ `?? null`, NUNCA `?? 0`. `margen_porcentaje` es NULLABLE y `null`
          // significa "usa el de la cotización"; 0 significa "esta línea va a costo".
          // Con `?? 0` toda línea que heredaba el margen se duplicaba marcada como
          // excepción al 0%, así que la copia salía vendida al costo y subir el
          // margen de la cotización ya no movía ninguna línea.
          margen_porcentaje: item.margen_porcentaje ?? null,
          precio_manual: item.precio_manual ?? false,
          // La ranura viaja con la linea. Sin `grupo` la copia perderia las
          // alternativas: tres vuelos pasarian de competir entre si a sumarse los
          // tres. `opcion_de` se repone en la segunda pasada, cuando el mapa este
          // completo: el titular puede venir DESPUES de su opcion en el orden.
          grupo: item.grupo ?? null,
          unidad: item.unidad ?? null,
          // El día, el check de la sugerencia y el segundo interruptor viajan con la
          // línea. Sin `entra_al_precio`, una sugerencia fuera del precio nacería
          // cobrando en la copia y su total saldría más alto que el del original.
          // Solo se nombran si la lectura los trajo: con `select('*')` una columna sin
          // aplicar llega `undefined`, y nombrarla en el insert tumbaría el duplicado.
          ...(item.dia_relativo !== undefined ? { dia_relativo: item.dia_relativo } : {}),
          ...(item.mostrar_en_sugeridos !== undefined ? { mostrar_en_sugeridos: item.mostrar_en_sugeridos } : {}),
          ...(item.entra_al_precio !== undefined ? { entra_al_precio: item.entra_al_precio } : {}),
          // La tarifa por pasajero viaja con la línea: sin ella la copia conservaría los
          // rubros por adulto y niño pero perdería el reparto que imprime el PDF, y las
          // lecturas de donde salió cada número.
          ...(item.tarifa_pax !== undefined ? { tarifa_pax: item.tarifa_pax } : {}),
          // La base del IVA de la línea viaja con ella: sin esto la copia de una línea
          // comisionable volvería a cobrarle IVA al viajero.
          ...(item.base_iva !== undefined ? { base_iva: item.base_iva } : {}),
        })
        .select('id')
        .single()

      if (newItem) mapaItems.set(item.id as string, newItem.id as string)

      if (newItem && item.rubros) {
        // Solo los CONFIRMADOS. Una propuesta de pantallazo sin confirmar es una
        // pregunta abierta sobre ESA cotizacion; llevarla a la copia le mete a
        // alguien una decision que nunca pidio, y ademas nacería sin la captura que
        // la origino.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rubrosToInsert = ((item.rubros ?? []) as any[]).filter(esConfirmado).map(r => ({
          item_id: newItem.id,
          tipo: r.tipo,
          descripcion: r.descripcion,
          cantidad: r.cantidad,
          unidad: r.unidad,
          valor_unitario: r.valor_unitario,
        }))
        if (rubrosToInsert.length > 0) {
          await supabase.from('rubros').insert(rubrosToInsert)
        }
      }
    }

    // Segunda pasada: el vinculo entre opcion y titular, ya en el mundo de la copia.
    for (const patch of remapearOpcionDe((items ?? []) as { id: string; opcion_de?: string | null }[], mapaItems)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('items').update({ opcion_de: patch.opcionDe }).eq('id', patch.nuevoId)
    }

    // Los itinerarios. Si la migracion no esta aplicada, `leerItinerarios` devuelve
    // `null` y no hay nada que copiar: la copia queda como hoy.
    const itinerariosOriginales = await leerItinerarios(supabase, id)
    if (itinerariosOriginales && itinerariosOriginales.length > 0) {
      const copias = itinerariosParaLaCopia(
        itinerariosOriginales.map(it => ({
          id: it.id,
          nombre: it.nombre,
          orden: it.orden,
          va_en_propuesta: it.vaEnPropuesta,
          es_principal: it.esPrincipal,
          seleccion: it.seleccion,
        })),
        mapaItems,
        newCot.id,
        workspaceId,
      )
      for (const copia of copias) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: nuevoItin } = await (supabase as any)
          .from('cotizacion_itinerarios')
          .insert(copia.cabecera)
          .select('id')
          .single()
        if (nuevoItin && copia.seleccion.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from('itinerario_opciones')
            .insert(copia.seleccion.map(itemId => ({ itinerario_id: nuevoItin.id, item_id: itemId })))
        }
      }
    }
  }

  if (original.oportunidad_id) revalidatePath(`/pipeline/${original.oportunidad_id}`)
  if (negocioIdOrig) revalidatePath(`/negocios/${negocioIdOrig}`)
  return { success: true, id: newCot?.id }
}

// ── Reconciliación automática de ajuste ────────────────────────

export async function reconciliarAjuste(cotizacionId: string, valorTotalDeseado: number) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  if (valorTotalDeseado < 0) return { success: false, error: 'El valor total no puede ser negativo' }

  // 1. Get all items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase as any)
    .from('items')
    .select('id, precio_venta, descuento_porcentaje, es_ajuste, orden, cantidad')
    .eq('cotizacion_id', cotizacionId)

  // 2. Sum net of regular items (es_ajuste = false)
  let sumaNetaRegulares = 0
  let ajusteExistenteId: string | null = null
  let maxOrden = 0
  for (const item of items ?? []) {
    if (item.es_ajuste) {
      ajusteExistenteId = item.id
    } else {
      const pv = Number(item.precio_venta) || 0
      const cant = Number(item.cantidad) || 1
      const dp = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0))
      sumaNetaRegulares += pv * cant * (1 - dp / 100)
    }
    if ((item.orden ?? 0) > maxOrden) maxOrden = item.orden ?? 0
  }

  // 3. Difference
  const diferencia = Math.round(valorTotalDeseado - sumaNetaRegulares)

  // 4-6. Handle adjustment item
  if (diferencia === 0) {
    // Remove adjustment if exists
    if (ajusteExistenteId) {
      await supabase.from('items').delete().eq('id', ajusteExistenteId)
    }
  } else {
    const nombre = diferencia > 0 ? 'Administración e imprevistos' : 'Descuento comercial'
    if (ajusteExistenteId) {
      // Update existing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('items')
        .update({ precio_venta: diferencia, nombre } as never)
        .eq('id', ajusteExistenteId)
    } else {
      // Insert new
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('items')
        .insert({
          cotizacion_id: cotizacionId,
          nombre,
          subtotal: 0,
          orden: maxOrden + 1,
          precio_venta: diferencia,
          descuento_porcentaje: 0,
          es_ajuste: true,
        })
    }
  }

  // 7. Set valor_total to desired value
  await supabase
    .from('cotizaciones')
    .update({ valor_total: valorTotalDeseado } as never)
    .eq('id', cotizacionId)

  return { success: true }
}

// ── Recalcular totales ────────────────────────

/**
 * Rehacer los números de una cotización: costo de cada línea, precio de cada línea y
 * los totales de la cascada. Toda la aritmética vive en `calcularCascada`, para que el
 * servidor y la pantalla no puedan discrepar sobre cuánto vale la cotización.
 */
export async function recalcularTotales(cotizacionId: string) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Recalcular corre después de cada cambio de precio, costo o margen: es el momento en
  // que una autorización del dueño bajo el mínimo puede dejar de valer, y se anota
  // aquí, con quien hizo el cambio como autor. Sin autorización vigente es una consulta.
  // Nunca tumba el recálculo: corre después de un cambio que ya se guardó.
  const revisarExcepcion = async () => {
    if (!workspaceId) return
    try {
      await revisarExcepcionTrasCambio(supabase, {
        servicio: createServiceClient, workspaceId, cotizacionId, staffId,
      })
    } catch (e) {
      console.error('[recalcularTotales] no se pudo revisar la excepción de margen:', e instanceof Error ? e.message : String(e))
    }
  }

  // Los parámetros de la cascada se leen de la fila, no de la línea de negocio: se
  // congelan al crear la cotización y no se resincronizan, para que reconfigurar la
  // línea no le mueva el precio a una cotización ya enviada al cliente.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cot } = await (supabase as any)
    .from('cotizaciones')
    .select('convencion_margen, aiu_admin_pct, aiu_imprevistos_pct, margen_porcentaje, margen_default_pct, descuento_porcentaje')
    .eq('id', cotizacionId)
    .maybeSingle()

  // `select('*')` y no la lista de columnas: `grupo`, `opcion_de` y `orden` los agrega
  // la migración `20260914200000`, y nombrarlos devolvería un 400 mientras no esté
  // aplicada — o sea que el editor dejaría de recalcular en cada tecla. Misma
  // tolerancia que `contextoDeCotizacion`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase as any)
    .from('items')
    // `rubros(*)` y no la lista de columnas: `sugerido` lo agrega
    // `20260914230000` y nombrarlo devolveria un 400 mientras no este aplicada.
    // Un rubro son cinco numeros y un texto corto: traerlo entero no cuesta nada.
    .select('*, rubros(*)')
    .eq('cotizacion_id', cotizacionId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filas = (items ?? []) as any[]
  // Los adicionales de cada variante (`adicionales.ts`). Consulta aparte y tolerante: sin
  // la tabla devuelve vacío y esta función recalcula exactamente lo que recalculaba antes.
  const filasAdicionales = await leerAdicionalesDeItems(
    supabase,
    filas.map(f => f.id as string),
  )
  const paraCascadaSinAdic = filas.map(item => {
    // R-P1 · los rubros SUGERIDOS no entran al costo hasta que alguien confirme.
    const { numeroDeRubros, costoDeRubros } = costoDeRubrosConfirmados(item.rubros)
    return {
      id: item.id as string,
      es_ajuste: item.es_ajuste,
      cantidad: item.cantidad,
      subtotal: item.subtotal,
      numeroDeRubros,
      costoDeRubros,
      descuento_porcentaje: item.descuento_porcentaje,
      margen_porcentaje: item.margen_porcentaje,
      precio_venta: item.precio_venta,
      precio_manual: item.precio_manual,
    }
  })
  // El MISMO emparejamiento que usa `contextoDeCotizacion`: por id de variante. Escrito
  // dos veces, la pantalla y el recálculo podrían cobrarle la maleta a líneas distintas.
  const paraCascada = adjuntarAdicionales(paraCascadaSinAdic, filasAdicionales)
  const params = {
    administrativosPct: (Number(cot?.aiu_admin_pct) || 0) + (Number(cot?.aiu_imprevistos_pct) || 0),
    // Con el default de la línea de negocio como respaldo: ver `cotizacion-editor`.
    margenPct: cot?.margen_porcentaje ?? cot?.margen_default_pct,
    descuentoComercialPct: cot?.descuento_porcentaje,
    convencionMargen: (cot?.convencion_margen ?? null) as ConvencionMargen | null,
  }

  // ⚠️ DOS cascadas, y la diferencia es deliberada.
  //
  //  · `cascada` corre sobre TODAS las líneas y es la que escribe el precio unitario
  //    de cada una. Una alternativa que no aporta al total igual necesita su precio:
  //    es justo el número con el que alguien la compara contra la otra.
  //  · `cascadaTotal` corre solo sobre las que APORTAN (R-A1) y es la que fija el
  //    total. Sin esta separación, una ranura con dos vuelos cobraba los dos.
  //
  // Con una sola ranura y sin alternativas las dos son idénticas, que es R6.
  const cascada = calcularCascada(paraCascada, params)

  for (const linea of cascada.lineas) {
    const fila = filas.find(f => f.id === linea.id)
    if (!fila || fila.es_ajuste) continue
    // `items.precio_venta` es UNITARIO: la plantilla del PDF lo multiplica por la
    // cantidad. Guardar aquí el total de la línea la duplicaría en el documento.
    const cantidad = Number(fila.cantidad) || 1
    const patch: Record<string, unknown> = { subtotal: linea.costoUnitario }
    if (linea.costoLinea > 0 && fila.precio_manual !== true) {
      patch.precio_venta = Math.round(linea.precioLinea / cantidad)
    }
    await supabase.from('items').update(patch as never).eq('id', fila.id)
  }

  // LEGADO: cotización con ítem de cuadre, donde alguien fijó el valor total a mano.
  // Ahí el total no se deriva: manda el número que se escribió, y el ítem de ajuste
  // absorbe la diferencia. Sin esto, recalcular le movería el total a una cotización
  // ya enviada al cliente.
  // R-A1 · el total suma cada ranura UNA vez. Sin ranuras con alternativas, `aportan`
  // es exactamente el juego completo de líneas y esto es un no-op (R6).
  //
  // Una sugerencia FUERA DEL PRECIO tampoco aporta: no suma al total ni mete su costo a
  // `costo_total`. Su precio unitario sí se escribe arriba (la cascada por línea corre
  // sobre todas), porque es justo el número que el documento le muestra al cliente.
  const aportan = new Set(
    itemsQueAportanAlTotal(
      filas.map(f => ({
        id: f.id as string,
        grupo: f.grupo ?? null,
        opcion_de: f.opcion_de ?? null,
        es_ajuste: f.es_ajuste ?? false,
        orden: f.orden ?? 0,
        dia_relativo: f.dia_relativo ?? null,
        entra_al_precio: f.entra_al_precio ?? null,
      })),
    ),
  )
  const cascadaTotal = calcularCascada(
    paraCascada.filter(i => aportan.has(i.id)),
    params,
  )

  const ajuste = filas.find(f => f.es_ajuste)
  if (ajuste) {
    const { data: fijado } = await supabase
      .from('cotizaciones')
      .select('valor_total')
      .eq('id', cotizacionId)
      .single()
    const valorFijado = fijado?.valor_total ?? 0
    // Las que APORTAN, no todas: con dos alternativas en la misma ranura, sumarlas
    // las dos dejaba la diferencia corta y el ítem de cuadre absorbía un vuelo entero.
    // Sin ranuras con alternativas es la misma suma de siempre.
    // ⚠️ `precioConAdicionales`, no `precioLinea`: la maleta extra es precio real de la
    // línea. Con el base, el ítem de cuadre absorbería el adicional entero como si fuera
    // un descuento comercial.
    const sumaRegulares = cascadaTotal.lineas
      .filter(l => l.id !== ajuste.id)
      .reduce((s, l) => s + l.precioConAdicionales, 0)
    const diferencia = Math.round(valorFijado - sumaRegulares)

    if (diferencia === 0) {
      await supabase.from('items').delete().eq('id', ajuste.id)
    } else {
      const nombre = diferencia > 0 ? 'Administración e imprevistos' : 'Descuento comercial'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('items')
        .update({ precio_venta: diferencia, nombre } as never)
        .eq('id', ajuste.id)
    }

    await supabase
      .from('cotizaciones')
      .update({ costo_total: cascadaTotal.costoDirecto } as never)
      .eq('id', cotizacionId)

    await revisarExcepcion()
    return { success: true, costoTotal: cascadaTotal.costoDirecto, valorVenta: valorFijado }
  }

  // R5 · con itinerarios, el total de la cotizacion es el del itinerario PRINCIPAL,
  // no la suma de todos los items: sumarlos todos cobraria AVIANCA y WINGO a la vez.
  //
  // ⚠️ R6 · sin itinerarios —o sin ninguno marcado principal— `totalDelPrincipal`
  // devuelve `null` y esto cae EXACTAMENTE al comportamiento de siempre. Es el corte
  // que deja intactas a Termotech, Arca, WMC y a las cotizaciones que ya existen: no
  // hay un flag que alguien pueda encender por error, hay una fila que no existe.
  //
  // ⚠️ La cotizacion, sus items y sus itinerarios se leen UNA vez y se pasan a los
  // dos helpers. Esta funcion corre en cada tecla del editor: releerlos por cada uno
  // eran cuatro idas y vueltas mas por recalculo, en la pantalla mas pesada.
  const ctxItin = await contextoDeCotizacion(supabase, cotizacionId)
  const filasItin = ctxItin ? await leerItinerarios(supabase, cotizacionId) : null
  const principal = ctxItin ? await totalDelPrincipal(supabase, cotizacionId, ctxItin, filasItin) : null

  await supabase
    .from('cotizaciones')
    .update({
      costo_total: principal ? principal.costoDirecto : cascadaTotal.costoDirecto,
      valor_total: principal ? principal.precioVenta : cascadaTotal.precioVenta,
      descuento_valor: cascadaTotal.descuentoComercial,
    } as never)
    .eq('id', cotizacionId)

  // §2.6.5 · ninguna edicion puede dejar un itinerario por debajo del piso duro Y
  // marcado para propuesta. Recalcular es justo el momento en que los costos se
  // movieron, asi que es aqui donde se revisa — no en cada boton de la pantalla, que
  // es como se olvida uno.
  const desmarcados = ctxItin && filasItin && filasItin.length > 0
    ? await desmarcarLosQueYaNoPueden(supabase, cotizacionId, { ctx: ctxItin, filas: filasItin })
    : []

  await revisarExcepcion()

  return {
    success: true,
    costoTotal: principal ? principal.costoDirecto : cascadaTotal.costoDirecto,
    valorVenta: principal ? principal.precioVenta : cascadaTotal.precioVenta,
    desmarcados,
  }
}

// ── AIU (Admin + Imprevistos sobre costos) ────────────────────

/**
 * Administración e imprevistos, en % sobre el costo directo.
 *
 * Antes esto creaba un ítem de cuadre con el AIU adentro, y el cliente veía una línea
 * "Administración e imprevistos" que no había pedido. Ahora es un escalón de la
 * cascada: se guardan los porcentajes y `recalcularTotales` reparte el peso sobre el
 * costo de cada línea, que es donde el margen lo puede ver.
 */
export async function aplicarAIU(cotizacionId: string, adminPct: number | null, imprevPct: number | null) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('cotizaciones')
    .update({ aiu_admin_pct: adminPct, aiu_imprevistos_pct: imprevPct } as never)
    .eq('id', cotizacionId)

  await recalcularTotales(cotizacionId)
  return { success: true }
}
