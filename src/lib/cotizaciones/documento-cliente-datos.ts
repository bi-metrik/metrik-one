/**
 * Lo que el redactor del texto para el cliente necesita leer de la base: la cotización,
 * las líneas que el documento DESCRIBE, el viaje del negocio y los nombres del cliente.
 *
 * Aparte de las server actions por la misma razón que `itinerarios-datos.ts`: un archivo
 * `'use server'` solo exporta funciones async y no se prueba sin montar la sesión. Aquí el
 * cliente de Supabase entra por parámetro.
 *
 * ⚠️ Las líneas salen de `lineasQueDescribeElDocumento`, la misma regla de la acción del
 * PDF. Si no, el texto describiría una alternativa que el documento no imprime.
 */

import { adicionalesPorItem, etiquetaDeAdicional } from './adicionales'
import { bloquesParaPDF, leerAdicionalesDeItems } from './itinerarios-datos'
import { lineasQueDescribeElDocumento } from './lineas-del-documento'
import { leerViajeDelNegocio } from './viaje-negocio'
import {
  huellaDeViaje,
  leerDocumentoCliente,
  viajeParaRedactar,
  type DocumentoCliente,
  type ItemParaRedactar,
  type ViajeParaRedactar,
} from './documento-cliente'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

export interface ContextoTextoCliente {
  cotizacionId: string
  negocioId: string | null
  estado: string | null
  /**
   * `false` si la columna `cotizaciones.documento_cliente` todavía no existe (la migración
   * no está aplicada). La cotización se lee con `select('*')` a propósito: nombrar la
   * columna devolvería un 400 y el editor dejaría de abrir.
   */
  columnaPresente: boolean
  documento: DocumentoCliente | null
  viaje: ViajeParaRedactar
  /** La huella de `viaje`, la entrada tal como la vería el modelo hoy. */
  huella: string
}

interface FilaItem {
  id?: string
  nombre?: string | null
  tarifa_pax?: unknown
  es_ajuste?: boolean | null
  grupo?: string | null
  opcion_de?: string | null
  orden?: number | null
  dia_relativo?: number | null
  entra_al_precio?: boolean | null
}

function nombresUnicos(xs: (string | null | undefined)[]): string[] {
  const vistos = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const t = typeof x === 'string' ? x.trim() : ''
    if (!t || vistos.has(t.toLowerCase())) continue
    vistos.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

/**
 * Lee todo lo que hace falta para redactar, guardar o avisar que un texto quedó viejo.
 * `null` si la cotización no existe o el RLS no la deja ver (otro workspace).
 */
export async function leerContextoTextoCliente(
  supabase: Supabase,
  cotizacionId: string,
): Promise<ContextoTextoCliente | null> {
  const { data: cot, error } = await supabase
    .from('cotizaciones')
    .select('*')
    .eq('id', cotizacionId)
    .maybeSingle()
  if (error || !cot) return null
  const fila = cot as Record<string, unknown>

  let items: FilaItem[] = []
  if (fila.modo === 'detallada') {
    const { data } = await supabase
      .from('items')
      .select('*')
      .eq('cotizacion_id', cotizacionId)
      .order('orden')
    items = (data ?? []) as FilaItem[]
  }

  const bloques = await bloquesParaPDF(supabase, cotizacionId)
  const idsDelPrincipal = bloques?.find(b => b.esPrincipal)?.itemIds ?? null
  const impresos = lineasQueDescribeElDocumento(items, idsDelPrincipal)

  // Los adicionales van DENTRO de cada vuelo u hotel, como en el PDF («Maleta 23 kg ×2»).
  const filasAdicionales = await leerAdicionalesDeItems(
    supabase,
    impresos.map(i => i.id).filter((id): id is string => Boolean(id)),
  )
  const adicionales = adicionalesPorItem(filasAdicionales)
  const paraRedactar: ItemParaRedactar[] = impresos.map(i => ({
    nombre: i.nombre ?? '',
    grupo: i.grupo ?? null,
    tarifa_pax: i.tarifa_pax,
    es_ajuste: i.es_ajuste ?? false,
    adicionales: (i.id ? adicionales.get(i.id) ?? [] : []).map(ad =>
      ad.cantidad > 1 ? `${etiquetaDeAdicional(ad)} ×${ad.cantidad}` : etiquetaDeAdicional(ad),
    ),
  }))

  const negocioId = typeof fila.negocio_id === 'string' ? fila.negocio_id : null
  const { viaje: delNegocio } = await leerViajeDelNegocio(supabase, negocioId)

  // Los nombres del cliente NO van al modelo: se usan para borrarlos del texto libre.
  let nombres: string[] = []
  if (negocioId) {
    const { data: negocio } = await supabase
      .from('negocios')
      .select('empresas(nombre, contacto_nombre), contactos(nombre)')
      .eq('id', negocioId)
      .maybeSingle()
    const empresa = (negocio?.empresas ?? null) as { nombre?: string | null; contacto_nombre?: string | null } | null
    const contacto = (negocio?.contactos ?? null) as { nombre?: string | null } | null
    nombres = nombresUnicos([empresa?.nombre, empresa?.contacto_nombre, contacto?.nombre])
  }

  const viaje = viajeParaRedactar({
    items: paraRedactar,
    destino: delNegocio.destino,
    fechas: delNegocio.fechas,
    composicion: delNegocio.composicion,
    nombresDelCliente: nombres,
  })

  return {
    cotizacionId,
    negocioId,
    estado: typeof fila.estado === 'string' ? fila.estado : null,
    columnaPresente: Object.prototype.hasOwnProperty.call(fila, 'documento_cliente'),
    documento: leerDocumentoCliente(fila.documento_cliente),
    viaje,
    huella: huellaDeViaje(viaje),
  }
}
