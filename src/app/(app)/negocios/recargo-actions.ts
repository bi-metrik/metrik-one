'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import {
  lineaDeRecargo,
  politicaRecargoDeLinea,
  recargoCorresponde,
  RECARGO_POR_DEFECTO,
  type ItemParaRecargo,
  type PoliticaRecargo,
} from '@/lib/cotizaciones/recargo-linea'
import { isEditable } from '@/lib/cotizaciones/state-machine'

/**
 * El recargo fijo, del lado del servidor.
 *
 * Regla 2 del 2026-09-14. Lo que este archivo hace es **ofrecer** y **poner**. A qué
 * vuelos aplica lo decide la línea (todos o solo internacionales, desde Mi Negocio) y el
 * criterio vive en `recargo-linea.ts`; si a ESTA cotización le va, lo decide quien
 * cotiza, apretando el botón.
 *
 * ⚠️ El recargo entra como una línea SIN COSTO y con `precio_manual = true`. Eso lo
 * vuelve INGRESO en la cascada: suma al precio y no al costo, y el margen sube
 * exactamente lo que el recargo vale. Puesto como rubro sería costo, recibiría margen
 * encima y le cobraría al cliente $117.647 por un recargo de $100.000.
 */

/** La política de recargo de la línea de un negocio. */
export async function getPoliticaRecargo(negocioId: string): Promise<PoliticaRecargo> {
  const { supabase, error } = await getWorkspace()
  if (error) return RECARGO_POR_DEFECTO

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('negocios')
    .select('lineas_negocio(config_extra)')
    .eq('id', negocioId)
    .maybeSingle()

  const linea = (data as { lineas_negocio?: unknown } | null)?.lineas_negocio
  const fila = Array.isArray(linea) ? linea[0] : linea
  return politicaRecargoDeLinea((fila as { config_extra?: unknown } | null)?.config_extra)
}

/**
 * Pone el recargo como una línea más de la cotización.
 *
 * El valor por defecto se resuelve CONTRA LA BASE, no se recibe del navegador: una
 * server action exportada es un endpoint alcanzable aunque ningún botón la invoque, y
 * lo que decide cuánto se le cobra al cliente no puede llegar por parámetro.
 *
 * Después se puede editar como cualquier línea. Es la mitad de la regla que se pidió
 * con el mismo énfasis que la otra.
 */
export async function aplicarRecargo(cotizacionId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false as const, error: 'No autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cot } = await (supabase as any)
    .from('cotizaciones')
    .select('id, negocio_id, oportunidad_id, estado')
    .eq('id', cotizacionId)
    .maybeSingle()
  if (!cot) return { success: false as const, error: 'Cotización no encontrada' }
  // Una cotización ya enviada no cambia de precio por un botón: se duplica o se corrige.
  if (!isEditable(cot.estado)) {
    return { success: false as const, error: 'Esta cotización ya no es un borrador: su precio no se cambia agregándole un recargo.' }
  }
  if (!cot.negocio_id) {
    return { success: false as const, error: 'El recargo se configura por línea de negocio, y esta cotización no cuelga de un negocio' }
  }

  const politica = await getPoliticaRecargo(cot.negocio_id as string)
  if (!politica.activo) {
    return { success: false as const, error: 'Esta línea no tiene recargo configurado. Se activa en Mi Negocio → Margen y recargo.' }
  }

  // Lo que decide la pantalla se vuelve a decidir aquí: esta acción es un endpoint
  // alcanzable aunque ningún botón la invoque, y el botón solo aparece si corresponde.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: filas, error: errItems } = await (supabase as any)
    .from('items')
    .select('id, nombre, grupo, precio_venta, cantidad, es_ajuste, tarifa_pax')
    .eq('cotizacion_id', cotizacionId)
  if (errItems) return { success: false as const, error: errItems.message as string }
  const items = (filas ?? []) as ItemParaRecargo[]
  if (lineaDeRecargo(items, politica)) {
    return { success: false as const, error: `Esta cotización ya lleva el ${politica.etiqueta.toLowerCase()}.` }
  }
  if (!recargoCorresponde(items, politica)) {
    return {
      success: false as const,
      error: politica.vuelos === 'internacionales'
        ? 'El recargo está configurado solo para vuelos internacionales, y esta cotización no lleva ninguno.'
        : 'Esta cotización no lleva ningún vuelo al que le corresponda el recargo.',
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ultimo } = await (supabase as any)
    .from('items')
    .select('orden')
    .eq('cotizacion_id', cotizacionId)
    .order('orden', { ascending: false })
    .limit(1)
  const orden = ((ultimo?.[0]?.orden as number | undefined) ?? 0) + 1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errIns } = await (supabase as any).from('items').insert({
    cotizacion_id: cotizacionId,
    nombre: politica.etiqueta,
    // ⚠️ SIN grupo. Con grupo abriría una ranura, y con dos recargos en la misma
    // ranura el motor de itinerarios cobraría uno solo (una ranura aporta una vez).
    // Sin grupo es un componente fijo: entra en todos los itinerarios y suma siempre.
    grupo: null,
    opcion_de: null,
    unidad: 'servicio',
    cantidad: 1,
    // Sin costo: es ingreso, no algo que se pague.
    subtotal: 0,
    precio_venta: politica.valor,
    // Manda el número escrito, no un margen sobre un costo que no existe.
    precio_manual: true,
    // `null`, NUNCA 0: `0` significa «esta línea va a costo», y en una línea sin costo
    // eso además no quiere decir nada. Es la trampa que ya costó una cotización entera
    // vendida a costo al duplicar.
    margen_porcentaje: null,
    descuento_porcentaje: 0,
    orden,
  })
  if (errIns) return { success: false as const, error: errIns.message }

  if (cot.negocio_id) revalidatePath(`/negocios/${cot.negocio_id}`)
  if (cot.oportunidad_id) revalidatePath(`/pipeline/${cot.oportunidad_id}`)
  return { success: true as const, valor: politica.valor, etiqueta: politica.etiqueta }
}
