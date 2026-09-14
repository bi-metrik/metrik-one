'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getServerKey } from '@/lib/server-keys'
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
 * ⚠️ **La propuesta no se persiste en ningún estado intermedio, a propósito.** El
 * diseño dice «crea rubros en estado sugerido», y `rubros` no tiene esa columna:
 * agregarla es una migración que hoy no se puede aplicar, y un rubro sugerido guardado
 * contra una base sin la columna entraría al costo como uno confirmado — exactamente
 * lo que R-P1 prohíbe. Sostener la propuesta en pantalla cumple la invariante que
 * importa (nadie toca el costo hasta que una persona confirme) sin esa deuda. Lo que
 * se pierde: recargar la página descarta la propuesta y hay que volver a pegar. Eso
 * cuesta una captura; lo otro cuesta el margen.
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
  }
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
      // ⚠️ `rubros.tipo` tiene un CHECK de seis valores y `'tarifa'` no está entre
      // ellos: la base lo rechazaría con 23514. El concepto del diseño (tarifa /
      // impuestos / fee del proveedor) vive en la descripción; `servicios_prof` es el
      // tipo del catálogo que corresponde al costo de un proveedor de servicios.
      tipo: 'servicios_prof',
      descripcion: r.concepto,
      cantidad: r.cantidad,
      unidad: r.unidad,
      valor_unitario: r.valorCOP,
      orden: i,
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
