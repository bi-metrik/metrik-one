'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getServerKey } from '@/lib/server-keys'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { extraerRanuraDesdeImagen } from '@/lib/ai/extraer-ranura'
import {
  evaluarLectura,
  montoEnCOP,
  resumenDeLinea,
  rubrosPropuestos,
  type CampoLeido,
  type FilaDesglose,
  type RubroPropuesto,
  type VeredictoLectura,
} from '@/lib/cotizaciones/lectura-pantallazo'
import { ranuraDeGrupo } from '@/lib/cotizaciones/ranuras-pantallazo'
import { isEditable, type EstadoCotizacion } from '@/lib/cotizaciones/state-machine'
import { recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'

/**
 * Cargue de pantallazo por ítem: leer una captura del proveedor y proponer su costo.
 *
 * Paso 3 del motor de cotización de Trappvel (§3).
 *
 * ## Dos acciones, y la separación es la regla R-P1
 *
 * *«El pantallazo PROPONE. Una persona confirma antes de que entren al costo.»*
 *
 *  · `leerPantallazoDeItem` NO escribe nada. Devuelve una propuesta.
 *  · `confirmarLecturaDePantallazo` escribe, con lo que la persona dejó en pantalla.
 *
 * ## La propuesta SÍ se persiste, como `rubros.sugerido = true`
 *
 * Desde `20260914230000`. Un rubro sugerido no lo suma nadie: el filtro vive en
 * `src/lib/cotizaciones/rubros-sugeridos.ts` y lo aplican los cinco que leen rubros.
 * Confirmar es ponerlo en `false`; no hay un segundo estado ni una tabla aparte.
 *
 * ⚠️ **Solo se persiste lo que está en COP.** El valor de la captura se convierte con
 * una tasa que la persona escribe DESPUÉS de leer, así que una propuesta en USD no se
 * puede guardar sin inventar la tasa o sin guardar un número cuya moneda nadie pueda
 * recuperar. Lo segundo es una mina: el día que alguien lea ese `valor_total` como
 * pesos, el costo queda ~4.000 veces corto. Cuando la captura no es COP la propuesta
 * se sostiene en pantalla y el panel lo dice.
 *
 * ⚠️ Lo que NO se persiste: los campos leídos, el desglose y los avisos. Eso es la
 * JUSTIFICACIÓN de la lectura, y su sitio es el bloque 3 del DDL, que a propósito no
 * tiene DDL escrito. Tras recargar quedan los rubros, que es la propuesta.
 *
 * ## La imagen no se persiste
 *
 * Igual que `extraerCampoDesdeImagen`. La captura de COMPRA sí es evidencia y debe
 * persistir (§4), pero eso depende de A2 y está fuera de este paso.
 */

// ── Lo que viaja a la pantalla ───────────────────────────────────────────────

export interface PropuestaPantallazo {
  ok: true
  itemId: string
  ranura: string
  ranuraLabel: string
  campos: CampoLeido[]
  desglose: FilaDesglose[]
  rubros: RubroPropuesto[]
  avisos: string[]
  /** Moneda de la captura. Si no es COP, confirmar exige tasa de cambio (R-P5). */
  moneda: string
  /** Nombre y descripción con que quedaría la línea. */
  nombre: string
  descripcion: string
  /** Unidad y cantidad de venta que se le pondrían al ítem. */
  unidad: string
  cantidad: number
  /**
   * `true` si la propuesta quedó guardada y sobrevive a una recarga.
   *
   * `false` solo cuando la captura no está en COP: ahí el valor todavía depende de una
   * tasa que nadie ha escrito. La pantalla lo dice en vez de dejar que alguien lo
   * descubra recargando.
   */
  persistida: boolean
}

export interface RechazoPantallazo {
  ok: false
  codigo: string
  motivo: string
  instruccion: string
}

export type ResultadoPantallazo = PropuestaPantallazo | RechazoPantallazo

// ── Leer ─────────────────────────────────────────────────────────────────────

/**
 * Lee la captura contra el contrato de la ranura que le toca al ítem por su `grupo`.
 *
 * ⚠️ Sin `grupo` no hay ranura y no hay lectura. No es un obstáculo accidental: sin
 * contrato el modelo devuelve lo que le parezca, y el número acaba dentro de un costo.
 */
export async function leerPantallazoDeItem(
  itemId: string,
  dataUrl: string,
): Promise<ResultadoPantallazo> {
  const { supabase, error } = await getWorkspace()
  if (error) return rechazo('AUTH', 'No autenticado', 'Vuelve a entrar y reinténtalo.')
  // Lee con la llave de Gemini de MeTRIK: la puerta de Clarity va antes de tocar el ítem.
  if (!(await exigirModulo(REQUISITO.clarity)).ok) {
    return rechazo('MODULO', MENSAJE_MODULO_NO_ACTIVO, 'Esta lectura es de Clarity.')
  }

  const item = await leerItem(supabase, itemId)
  if (!item) {
    return rechazo('ITEM', 'Ítem no encontrado', 'Recarga la cotización e inténtalo otra vez.')
  }
  if (!isEditable(item.estado)) {
    return rechazo(
      'ESTADO',
      `La cotización está en estado ${item.estado}`,
      'Esta cotización ya no se edita. Duplícala para trabajar sobre una nueva.',
    )
  }

  const ranura = ranuraDeGrupo(item.grupo)
  if (!ranura) {
    return rechazo(
      'SIN_RANURA',
      `El grupo «${item.grupo ?? ''}» no corresponde a ninguna ranura de captura`,
      'Ponle a esta línea el grupo vuelo, hotel, traslado o actividad para poder leer su pantallazo.',
    )
  }

  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl)
  if (!m) return rechazo('RX5', 'La imagen no llegó en un formato legible', 'Vuelve a pegar la captura.')

  const apiKey = getServerKey('gemini')
  if (!apiKey) {
    return rechazo('CONFIG', 'API key de Gemini no configurada', 'Avísale a MeTRIK: falta configurar la lectura de capturas.')
  }

  const lectura = await extraerRanuraDesdeImagen(Buffer.from(m[2], 'base64'), m[1], ranura, apiKey)
  if (!lectura.data) {
    // R-P7 / RX6. La llamada no terminó bien: no hay lectura que juzgar, y dar por
    // buena media respuesta es el fallo que se ve igual que un acierto.
    return rechazo(
      'RX6',
      lectura.error ?? 'La lectura no terminó',
      'No se pudo leer la captura. Vuelve a intentarlo, o carga el costo a mano.',
    )
  }

  const veredicto: VeredictoLectura = evaluarLectura(ranura, lectura.data)
  if (!veredicto.ok) {
    return { ok: false, codigo: veredicto.codigo, motivo: veredicto.motivo, instruccion: veredicto.instruccion }
  }

  const rubros = rubrosPropuestos(ranura, veredicto.campos, veredicto.desglose)
  const { nombre, descripcion } = resumenDeLinea(ranura, veredicto.campos)
  const moneda = (veredicto.campos.find(c => c.slug === 'moneda')?.valor ?? 'COP').toUpperCase()

  // R-P1 · la propuesta se guarda como SUGERIDA: visible, recuperable tras una
  // recarga, y fuera de todo costo hasta que una persona la confirme.
  const persistida = moneda === 'COP' && (await guardarSugeridos(supabase, itemId, rubros))

  return {
    ok: true,
    itemId,
    ranura: ranura.slug,
    ranuraLabel: ranura.label,
    campos: veredicto.campos,
    desglose: veredicto.desglose,
    rubros,
    avisos: veredicto.avisos,
    moneda,
    nombre,
    descripcion,
    unidad: ranura.unidadPorDefecto,
    // La cantidad de VENTA de la línea. Sale del multiplicador del primer rubro cuando
    // el precio venía por unidad; si el proveedor cotizó un total, la línea es una.
    cantidad: Math.max(1, Math.round(rubros[0]?.cantidad ?? 1)),
    persistida,
  }
}

/**
 * Reemplaza los rubros SUGERIDOS del ítem por los de esta lectura.
 *
 * ⚠️ Reemplaza los sugeridos y **no toca los confirmados**. Volver a pegar una captura
 * corregida es el caso normal; acumular propuestas dejaría tres versiones de la misma
 * tarifa esperando confirmación, y borrar los confirmados aquí tiraría un costo que
 * alguien ya aprobó sin que nadie lo pidiera.
 *
 * Devuelve `false` en vez de lanzar: una lectura correcta que no se pudo guardar sigue
 * siendo una lectura correcta, y el panel la muestra igual diciendo que no sobrevive a
 * una recarga. Tumbar la lectura entera por esto sería perder el trabajo hecho.
 */
async function guardarSugeridos(
  supabase: unknown,
  itemId: string,
  rubros: RubroPropuesto[],
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { error: errBorrar } = await sb
    .from('rubros')
    .delete()
    .eq('item_id', itemId)
    .eq('sugerido', true)
  if (errBorrar) {
    console.warn('[pantallazo] no se pudieron limpiar los sugeridos:', errBorrar.message)
    return false
  }
  if (rubros.length === 0) return true

  const { error: errInsertar } = await sb.from('rubros').insert(
    rubros.map((r, i) => ({
      item_id: itemId,
      // Mismo tipo que al confirmar: `rubros.tipo` no admite los conceptos del viaje.
      tipo: 'servicios_prof',
      descripcion: (r.concepto ?? '').trim() || 'Tarifa',
      cantidad: r.cantidad,
      unidad: (r.unidad ?? '').trim() || 'und',
      valor_unitario: r.valorUnitario,
      orden: i,
      sugerido: true,
    })),
  )
  if (errInsertar) {
    console.warn('[pantallazo] no se pudo guardar la propuesta:', errInsertar.message)
    return false
  }
  return true
}

// ── Confirmar ────────────────────────────────────────────────────────────────

export interface RubroAConfirmar {
  concepto: string
  cantidad: number
  unidad: string
  /** En la moneda de la captura. La conversión a COP la hace el servidor. */
  valorUnitario: number
}

/**
 * Escribe lo confirmado: los rubros del ítem y cómo queda descrita la línea.
 *
 * ⚠️ Los valores se recalculan y se validan AQUÍ, no se confían del navegador. Una
 * server action exportada es un endpoint alcanzable aunque ningún botón la invoque, y
 * lo que entra por aquí es el costo con el que se mide el margen.
 *
 * ⚠️ **Reemplaza los rubros del ítem, no los suma.** Volver a pegar una captura
 * corregida es el caso normal (el proveedor cambió la tarifa); acumular dejaría el
 * costo al doble sin que nada lo señale.
 */
export async function confirmarLecturaDePantallazo(args: {
  itemId: string
  nombre: string
  descripcion: string
  unidad: string
  cantidad: number
  moneda: string
  /** Tasa de cambio a COP. Obligatoria cuando la moneda no es COP (R-P5). */
  tasaCambio: number | null
  rubros: RubroAConfirmar[]
}): Promise<{ success: boolean; error?: string }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const item = await leerItem(supabase, args.itemId)
  if (!item) return { success: false, error: 'Ítem no encontrado' }
  if (!isEditable(item.estado)) {
    return { success: false, error: 'Esta cotización ya no se edita' }
  }

  const moneda = (args.moneda || 'COP').toUpperCase()
  if (args.rubros.length === 0) {
    return { success: false, error: 'No hay ningún costo que guardar' }
  }

  // R-P5: sin tasa, un valor en USD escrito como COP subestima el costo ~4.000 veces.
  // El servidor no inventa una tasa y tampoco deja pasar la conversión sin ella.
  const convertidos: { concepto: string; cantidad: number; unidad: string; valorCOP: number }[] = []
  for (const r of args.rubros) {
    const valorCOP = montoEnCOP(r.valorUnitario, moneda, args.tasaCambio)
    if (valorCOP === null) {
      return {
        success: false,
        error: `El precio está en ${moneda} y falta la tasa de cambio a pesos. Escríbela para poder guardar el costo.`,
      }
    }
    if (!Number.isFinite(r.cantidad) || r.cantidad <= 0) {
      return { success: false, error: `La cantidad de «${r.concepto}» tiene que ser mayor que cero` }
    }
    convertidos.push({
      concepto: (r.concepto ?? '').trim() || 'Tarifa',
      cantidad: r.cantidad,
      unidad: (r.unidad ?? '').trim() || 'und',
      valorCOP,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { error: errBorrar } = await sb.from('rubros').delete().eq('item_id', args.itemId)
  if (errBorrar) return { success: false, error: errBorrar.message }

  const { error: errInsertar } = await sb.from('rubros').insert(
    convertidos.map((r, i) => ({
      item_id: args.itemId,
      // ⚠️ Escrito cuando el CHECK de `rubros.tipo` tenía seis valores. Desde el
      // 2026-09-14 admite `tarifa`, `impuestos` y `fee_proveedor` (`TIPOS_RUBRO_VIAJE`),
      // y la tarifa por pasajero ya escribe `tarifa`. Este cargue de un solo total no
      // lo usa ninguna pantalla desde el #763 y se deja como estaba.
      tipo: 'servicios_prof',
      descripcion: r.concepto,
      cantidad: r.cantidad,
      unidad: r.unidad,
      valor_unitario: r.valorCOP,
      orden: i,
      // Explícito aunque el default de la columna ya sea `false`: esta es LA línea
      // que hace que lo confirmado entre al costo, y no puede quedar implícita.
      sugerido: false,
    })),
  )
  if (errInsertar) return { success: false, error: errInsertar.message }

  const nombre = args.nombre.trim()
  const { error: errItem } = await sb
    .from('items')
    .update({
      ...(nombre ? { nombre } : {}),
      descripcion: args.descripcion.trim() || null,
      unidad: args.unidad.trim() || null,
      cantidad: Math.max(1, Math.round(args.cantidad)),
      // El costo lo mandan los rubros: `subtotal` queda en cero para que no queden dos
      // costos para el mismo ítem. Es el mismo guard que ya aplica `updateItem`.
      subtotal: 0,
    })
    .eq('id', args.itemId)
  if (errItem) return { success: false, error: errItem.message }

  // R-P8: el precio del ítem lo deriva el motor desde los rubros. El pantallazo no
  // escribe `subtotal` ni `precio_venta`.
  await recalcularTotales(item.cotizacionId)

  if (item.negocioId) revalidatePath(`/negocios/${item.negocioId}`)
  return { success: true }
}

// ── La propuesta que ya estaba guardada ──────────────────────────────────────

/**
 * Confirma la propuesta que sobrevivió a una recarga: `sugerido` pasa a `false`.
 *
 * Es el camino del que vuelve a la pantalla y encuentra su propuesta ahí. NO toca el
 * nombre ni la descripción del ítem: los textos que proponía la lectura no se
 * persisten (ver el encabezado), y escribir algo inventado sobre lo que el usuario ya
 * tenía sería peor que no escribir nada.
 *
 * ⚠️ El costo lo mandan los rubros, así que `subtotal` vuelve a cero: es el mismo
 * guard que aplica `confirmarLecturaDePantallazo` y el que impide que un ítem tenga
 * dos costos y el recálculo pise uno de los dos.
 */
export async function confirmarRubrosSugeridos(
  itemId: string,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const item = await leerItem(supabase, itemId)
  if (!item) return { success: false, error: 'Ítem no encontrado' }
  if (!isEditable(item.estado)) {
    return { success: false, error: 'Esta cotización ya no se edita' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: sugeridos, error: errLeer } = await sb
    .from('rubros')
    .select('id')
    .eq('item_id', itemId)
    .eq('sugerido', true)
  if (errLeer) return { success: false, error: errLeer.message }
  if (!sugeridos || sugeridos.length === 0) {
    return { success: false, error: 'No hay ninguna propuesta pendiente en esta línea' }
  }

  // Los confirmados que ya había se van: la propuesta REEMPLAZA el desglose, igual que
  // al confirmar una lectura fresca. Dejar los dos sumaría la tarifa dos veces.
  const { error: errBorrar } = await sb
    .from('rubros')
    .delete()
    .eq('item_id', itemId)
    .eq('sugerido', false)
  if (errBorrar) return { success: false, error: errBorrar.message }

  const { error: errConfirmar } = await sb
    .from('rubros')
    .update({ sugerido: false })
    .eq('item_id', itemId)
    .eq('sugerido', true)
  if (errConfirmar) return { success: false, error: errConfirmar.message }

  const { error: errItem } = await sb.from('items').update({ subtotal: 0 }).eq('id', itemId)
  if (errItem) return { success: false, error: errItem.message }

  await recalcularTotales(item.cotizacionId)
  if (item.negocioId) revalidatePath(`/negocios/${item.negocioId}`)
  return { success: true }
}

/**
 * Descarta la propuesta sin confirmarla. Borra SOLO los sugeridos.
 *
 * Hace falta porque una propuesta persistida que no se puede quitar es un pendiente
 * eterno: quien lee mal una captura tiene que poder dejar la línea como estaba.
 */
export async function descartarPropuestaDePantallazo(
  itemId: string,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const item = await leerItem(supabase, itemId)
  if (!item) return { success: false, error: 'Ítem no encontrado' }
  if (!isEditable(item.estado)) {
    return { success: false, error: 'Esta cotización ya no se edita' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errBorrar } = await (supabase as any)
    .from('rubros')
    .delete()
    .eq('item_id', itemId)
    .eq('sugerido', true)
  if (errBorrar) return { success: false, error: errBorrar.message }

  // No se recalcula nada: un sugerido nunca estuvo en el costo, así que quitarlo no
  // mueve un peso. Recalcular aquí solo escondería un defecto si alguna vez entrara.
  if (item.negocioId) revalidatePath(`/negocios/${item.negocioId}`)
  return { success: true }
}

// ── Interno ──────────────────────────────────────────────────────────────────

function rechazo(codigo: string, motivo: string, instruccion: string): RechazoPantallazo {
  return { ok: false, codigo, motivo, instruccion }
}

async function leerItem(
  supabase: unknown,
  itemId: string,
): Promise<{ grupo: string | null; cotizacionId: string; estado: EstadoCotizacion; negocioId: string | null } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('items')
    .select('id, grupo, cotizacion_id, cotizaciones(estado, negocio_id)')
    .eq('id', itemId)
    .maybeSingle()
  if (!data) return null
  const cot = (data.cotizaciones ?? {}) as { estado?: string; negocio_id?: string | null }
  return {
    grupo: (data.grupo ?? null) as string | null,
    cotizacionId: data.cotizacion_id as string,
    estado: (cot.estado ?? 'borrador') as EstadoCotizacion,
    negocioId: cot.negocio_id ?? null,
  }
}
