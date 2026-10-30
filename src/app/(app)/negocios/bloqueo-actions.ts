'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
import { cerrarAccionPorPasos } from '@/lib/cotizaciones/por-pasos-cierre'
import { leerItinerarios } from '@/lib/cotizaciones/itinerarios-datos'
import { recomendadaDe } from '@/lib/cotizaciones/tarifas'
import { agregarOpcionARanura, crearRanuraConOpcion } from '@/app/(app)/negocios/ranura-actions'
import { exigirPorPasos } from '@/lib/cotizaciones/por-pasos-datos'
import { isEditable, type EstadoCotizacion } from '@/lib/cotizaciones/state-machine'
import { normalizarGrupo } from '@/lib/cotizaciones/itinerarios'
import { ranuraDeGrupo } from '@/lib/cotizaciones/ranuras-pantallazo'
import { leerTarifaPax, type TarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import { leerModalidadDelViaje } from '@/lib/cotizaciones/bloqueo-modalidad'
import { leerPantallazoDeBloqueo, type LecturaBloqueo } from '@/lib/cotizaciones/bloqueo-leer'
import { costoDelPaquete, descripcionDelPaquete, leerPaqueteBloqueo, type PaqueteBloqueo } from '@/lib/cotizaciones/bloqueo-paquete'
import { guardarImagenDeCaptura } from '@/lib/cotizaciones/imagen-captura'
import { fichaDelOperador, operadorAlGuardar, proveedorDelPaquete, type FichaDeOperador } from '@/lib/cotizaciones/bloqueo-operador'
import { aMayusculas } from '@/lib/negocios/mayusculas'
import { motivoDescuentoInvalido } from '@/lib/cotizaciones/reglas-margen'
import { comisionEscrita, conComision, motivoComisionInvalida, type ComisionEscrita } from '@/lib/cotizaciones/tarifa-publica'

/**
 * Las acciones del PAQUETE DE BLOQUEO en la cotización por pasos (brief del 2026-10-27).
 *
 * Toda acción relee en el servidor lo que decide: la cotización sigue en borrador, la forma por pasos
 * está encendida (`exigirPorPasos`), el viaje es Bloqueo y la línea es de la ranura «Paquete de
 * bloqueo». Una server action exportada es un endpoint alcanzable aunque ningún botón la invoque.
 *
 * El costo NUNCA se confía del navegador: se recalcula aquí con `costoDelPaquete` sobre el paquete
 * saneado. El margen sale de la casilla de comisión que ya existe (`tarifa-publica.ts`): comisión
 * incluida = Pública (margen 0); por incluir = Neta (hereda el de la cotización).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

const NO_ES_BLOQUEO = 'Este viaje no está marcado como Bloqueo. Márcalo en «Condiciones del viaje» y recarga la página.'

async function exigirBloqueo(supabase: Supabase, cotizacionId: string): Promise<{ ok: true; negocioId: string | null; operador: string | null } | { ok: false; error: string }> {
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { ok: false, error: guard.error }
  const { data: cot } = await supabase.from('cotizaciones').select('negocio_id').eq('id', cotizacionId).maybeSingle()
  const negocioId = (cot?.negocio_id ?? null) as string | null
  const { modalidad, error } = await leerModalidadDelViaje(supabase, negocioId)
  if (error) return { ok: false, error: 'No se pudo leer si el viaje es Bloqueo. Vuelve a intentarlo.' }
  if (!modalidad.bloqueo) return { ok: false, error: NO_ES_BLOQUEO }
  return { ok: true, negocioId, operador: modalidad.operador }
}

/** «+ Paquete»: una opción nueva en la ranura del bloqueo (la crea si no existe). */
export async function crearPaqueteBloqueo(cotizacionId: string): Promise<{ success: true; itemId: string } | { success: false; error: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const b = await exigirBloqueo(supabase, cotizacionId)
  if (!b.ok) return { success: false, error: b.error }

  const { data: filas, error: errItems } = await (supabase as Supabase)
    .from('items')
    .select('grupo, es_ajuste')
    .eq('cotizacion_id', cotizacionId)
  if (errItems) return { success: false, error: errItems.message as string }
  const grupo = ((filas ?? []) as { grupo: string | null; es_ajuste: boolean | null }[])
    .find(i => i.es_ajuste !== true && ranuraDeGrupo(i.grupo)?.slug === 'paquete_detalle')?.grupo ?? null

  const r = grupo
    ? await agregarOpcionARanura(cotizacionId, normalizarGrupo(grupo) ?? grupo)
    : await crearRanuraConOpcion(cotizacionId, 'paquete')
  if (!r.success) return { success: false, error: r.error }
  // D5 (2026-10-29): cada paquete es una opción de la propuesta, con su tarifa. Sin esto el PDF
  // mostraba solo el primero.
  const c = await cerrarAccionPorPasos(supabase, { workspaceId, cotizacionId, antes: null })
  if (!c.success) return { success: false, error: c.error }
  return { success: true, itemId: r.itemId }
}

/**
 * «Va en la propuesta» de un paquete (D5 de Mauricio, 2026-10-29): la asesora incluye o saca cada
 * paquete, sin borrarlo y de forma reversible. Es el «va en la propuesta» de la tarifa del paquete.
 *
 * La Recomendada siempre va (decisión E): sacar el paquete de la Recomendada le pasa a ella el
 * siguiente paquete que va, y el sacado queda en la tarifa de ese, fuera de la propuesta. Si es el
 * único que va, no se puede sacar.
 */
export async function paqueteEnPropuesta(itemId: string, va: boolean): Promise<{ success: true } | { success: false; error: string }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const sb = supabase as Supabase
  const { data: item } = await sb.from('items').select('id, cotizacion_id, grupo, es_ajuste, cotizaciones(estado, negocio_id)').eq('id', itemId).maybeSingle()
  if (!item) return { success: false, error: 'La línea no existe o no es de este workspace.' }
  const cot = (item.cotizaciones ?? {}) as { estado?: string }
  if (!isEditable((cot.estado ?? 'borrador') as EstadoCotizacion)) {
    return { success: false, error: 'Esta cotización ya no se edita. Duplícala para trabajar sobre una nueva.' }
  }
  if (ranuraDeGrupo(item.grupo as string | null)?.slug !== 'paquete_detalle') return { success: false, error: 'Esta línea no es un paquete de bloqueo.' }
  const cotizacionId = item.cotizacion_id as string
  const b = await exigirBloqueo(sb, cotizacionId)
  if (!b.ok) return { success: false, error: b.error }

  // Las tarifas al día primero: un paquete recién creado ya tiene la suya.
  const antes = await cerrarAccionPorPasos(sb, { workspaceId, cotizacionId, antes: null, staffId })
  if (!antes.success) return { success: false, error: antes.error }
  const tarifas = (await leerItinerarios(sb, cotizacionId)) ?? []
  const suya = tarifas.find(t => t.seleccion.includes(itemId))
  if (!suya) return { success: false, error: 'Este paquete todavía no tiene su opción en Tarifas. Recarga la página.' }
  if (suya.vaEnPropuesta === va) return { success: true }
  const rec = recomendadaDe(tarifas).fila

  if (va || suya.id !== rec?.id) {
    const { error: e } = await sb.from('cotizacion_itinerarios').update({ va_en_propuesta: va }).eq('id', suya.id)
    if (e) return { success: false, error: e.message as string }
  } else {
    // Sacar el de la Recomendada: ella toma el siguiente paquete que va.
    const otra = [...tarifas].sort((x, y) => x.orden - y.orden).find(t => t.id !== suya.id && t.vaEnPropuesta)
    if (!otra) return { success: false, error: 'Es el único paquete en la propuesta: el cliente tiene que recibir al menos uno.' }
    const deOtra = await paqueteDeTarifa(sb, otra.seleccion)
    if (!deOtra) return { success: false, error: 'No se pudo cambiar la Recomendada. Recarga la página.' }
    // El cambio de paquete entre las dos tarifas son varias escrituras sin transacción (hacerlo
    // atómico pide una función en la base). Por eso el ORDEN (QA del #1342): primero se PONE el
    // paquete nuevo en cada tarifa y después se quita el viejo. Si algo falla a mitad, ninguna
    // tarifa queda sin paquete: a lo sumo una nombra dos, y se deshace lo puesto; si tampoco se
    // puede, el plan de bloqueo (`planDeTarifasDeBloqueo`) le deja uno solo en la próxima acción.
    const puestas = [{ itinerario_id: suya.id, item_id: deOtra }, { itinerario_id: otra.id, item_id: itemId }]
    const { error: e1 } = await sb.from('itinerario_opciones').insert(puestas)
    if (e1) return { success: false, error: e1.message as string }
    const quitar = [
      () => sb.from('itinerario_opciones').delete().eq('itinerario_id', suya.id).in('item_id', [itemId]),
      () => sb.from('itinerario_opciones').delete().eq('itinerario_id', otra.id).in('item_id', [deOtra]),
    ]
    for (let i = 0; i < quitar.length; i++) {
      const { error: e } = await quitar[i]()
      if (!e) continue
      // Se deshace lo hecho, en orden inverso: lo quitado vuelve y lo puesto sale.
      if (i === 1) await sb.from('itinerario_opciones').insert([{ itinerario_id: suya.id, item_id: itemId }])
      for (const x of puestas) await sb.from('itinerario_opciones').delete().eq('itinerario_id', x.itinerario_id).in('item_id', [x.item_id])
      await cerrarAccionPorPasos(sb, { workspaceId, cotizacionId, antes: null, staffId })
      return { success: false, error: 'No se pudo cambiar la Recomendada: quedó como estaba. Vuelve a intentarlo.' }
    }
    const { error: e2 } = await sb.from('cotizacion_itinerarios').update({ va_en_propuesta: false }).eq('id', otra.id)
    if (e2) {
      // Los paquetes ya cambiaron de tarifa y los dos siguen en la propuesta: nada se perdió.
      await cerrarAccionPorPasos(sb, { workspaceId, cotizacionId, antes: null, staffId })
      return { success: false, error: 'La Recomendada pasó al otro paquete, pero este sigue en la propuesta. Vuelve a quitarlo.' }
    }
  }
  const c = await cerrarAccionPorPasos(sb, { workspaceId, cotizacionId, antes: null, staffId })
  if (!c.success) return { success: false, error: c.error }
  return { success: true }
}

/** El paquete que nombra una tarifa (la opción de la ranura «Paquete de bloqueo»). */
async function paqueteDeTarifa(supabase: Supabase, seleccion: readonly string[]): Promise<string | null> {
  if (seleccion.length === 0) return null
  const { data } = await supabase.from('items').select('id, grupo').in('id', [...seleccion])
  const fila = ((data ?? []) as { id: string; grupo: string | null }[]).find(i => ranuraDeGrupo(i.grupo)?.slug === 'paquete_detalle')
  return fila?.id ?? null
}

/**
 * Lee UNO de los dos pantallazos del paquete. No escribe nada. `'detectar'`: llegó por el pegado de la
 * ventana o por «Es paquete de bloqueo» y ONE decide si es el hotel o el vuelo (`bloqueo-leer.ts`).
 */
export async function leerPantallazoBloqueo(cotizacionId: string, cual: 'hotel' | 'vuelo' | 'detectar', dataUrl: string): Promise<LecturaBloqueo> {
  if (cual !== 'hotel' && cual !== 'vuelo' && cual !== 'detectar') return { ok: false, mensaje: 'Casilla desconocida.' }
  if (!(await exigirModulo(REQUISITO.clarity)).ok) return { ok: false, mensaje: MENSAJE_MODULO_NO_ACTIVO }
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, mensaje: 'No autenticado' }
  const b = await exigirBloqueo(supabase, cotizacionId)
  if (!b.ok) return { ok: false, mensaje: b.error }
  return leerPantallazoDeBloqueo(cual, dataUrl)
}

export interface ImagenNueva {
  dataUrl: string
  /** La huella que devolvió la lectura: solo se guarda la imagen que se leyó. */
  huella: string | null
}

export interface EntradaPaqueteBloqueo {
  paquete: unknown
  imagenes?: { hotel?: ImagenNueva | null; vuelo?: ImagenNueva | null }
  /** La casilla de comisión: incluida (Pública, margen 0) o por incluir (Neta). Ausente = no se toca. */
  comision?: 'incluida' | 'por_incluir'
  /**
   * La comisión de la agencia de una Pública, en % o en pesos (D3, 2026-10-29), escrita en la misma
   * tarjeta antes de guardar. `undefined` = se conserva la guardada; `null` la quita.
   */
  comisionAgencia?: ComisionEscrita | null
}

export type ResultadoPaquete =
  /** `descuentoQuitado`: el motivo del descuento que se quitó al pasar a Pública (se avisa). */
  /** `fichaOperador`: el nombre de la ficha del Directorio a la que quedó ligado el operador (H-13), o `null`. */
  | { success: true; paquete: PaqueteBloqueo; costo: number | null; falta: string[]; descuentoQuitado?: string; fichaOperador?: string | null }
  | { success: false; error: string }

/**
 * «Guardar paquete»: escribe el paquete revisado en la línea (`tarifa_pax.bloqueo`), su costo en
 * `subtotal` (sin total, 0: la línea queda «sin costo» y lo dice), la descripción para el documento,
 * y el margen según la comisión. Un solo update; después, el recálculo de siempre.
 */
export async function guardarPaqueteBloqueo(itemId: string, entrada: EntradaPaqueteBloqueo): Promise<ResultadoPaquete> {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const sb = supabase as Supabase
  const { data: item, error: errItem } = await sb
    .from('items')
    .select('*, cotizaciones(estado, negocio_id)')
    .eq('id', itemId)
    .maybeSingle()
  if (errItem) return { success: false, error: errItem.message as string }
  if (!item) return { success: false, error: 'La línea no existe o no es de este workspace.' }
  const cot = (item.cotizaciones ?? {}) as { estado?: string; negocio_id?: string | null }
  if (!isEditable((cot.estado ?? 'borrador') as EstadoCotizacion)) {
    return { success: false, error: 'Esta cotización ya no se edita. Duplícala para trabajar sobre una nueva.' }
  }
  if (ranuraDeGrupo(item.grupo as string | null)?.slug !== 'paquete_detalle') {
    return { success: false, error: 'Esta línea no es un paquete de bloqueo.' }
  }
  const b = await exigirBloqueo(sb, item.cotizacion_id as string)
  if (!b.ok) return { success: false, error: b.error }
  if (entrada.comision !== undefined && entrada.comision !== 'incluida' && entrada.comision !== 'por_incluir') {
    return { success: false, error: 'Elige si la comisión está incluida o por incluir.' }
  }
  if (entrada.comisionAgencia) {
    const invalida = motivoComisionInvalida(entrada.comisionAgencia)
    if (invalida) return { success: false, error: invalida }
  }

  const paquete = leerPaqueteBloqueo(entrada.paquete)
  if (!paquete) return { success: false, error: 'El paquete llegó incompleto. Recarga la página.' }
  // Las imágenes ya guardadas son las del servidor, no las que diga el navegador.
  const tarifa = leerTarifaPax(item.tarifa_pax)
  const previas = leerPaqueteBloqueo(tarifa.bloqueo)?.imagenes ?? { hotel: null, vuelo: null }
  paquete.imagenes = { ...previas }
  for (const cual of ['hotel', 'vuelo'] as const) {
    const nueva = entrada.imagenes?.[cual]
    if (!nueva?.dataUrl) continue
    const ref = await guardarImagenDeCaptura({
      workspaceId,
      negocioId: cot.negocio_id ?? null,
      cotizacionId: item.cotizacion_id as string,
      dataUrl: nueva.dataUrl,
      lectura: { huellaImagen: typeof nueva.huella === 'string' ? nueva.huella : undefined },
    })
    if (ref) paquete.imagenes[cual] = ref
  }
  // H-13 (QA del 2026-10-29): el operador es de ESTE paquete. El elegido en la tarjeta manda; si no
  // hay, el único de la solicitud. Nunca el texto que junta a varios («ALIADOS TRAVEL / TU RESERVA»).
  paquete.operador = operadorAlGuardar(paquete.operador, b.operador)
  // Y, si está en el Directorio, la línea queda ligada a su ficha (`items.proveedor_id`).
  const fichas = await fichasDeProveedores(sb, workspaceId)
  const ficha = fichaDelOperador(paquete.operador, fichas)

  const costo = costoDelPaquete(paquete)
  const en = new Date().toISOString()
  const siguiente: TarifaPax = { ...tarifa, bloqueo: paquete, actualizadaEn: en }
  let descuentoQuitado: string | undefined
  const patch: Record<string, unknown> = {
    subtotal: costo.total ?? 0,
    cantidad: 1,
    unidad: 'paquete',
    precio_manual: false,
    descripcion: aMayusculas(descripcionDelPaquete(paquete)) || null,
  }
  if (paquete.hotel.hotel) patch.nombre = aMayusculas(paquete.hotel.hotel)
  if (entrada.comision) {
    let por: string | null = null
    const { data: perfil } = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle()
    por = (perfil?.full_name as string | null | undefined)?.trim() || null
    const tipo = entrada.comision === 'incluida' ? 'publica' : 'neta'
    // La comisión propia de la tarifa (QA del 2026-10-29) es de la decisión de Pública: se queda si
    // sigue siendo Pública y se va si vuelve a Neta.
    // La comisión (en % o en pesos) es de la decisión de Pública: la escrita en la tarjeta, o la que ya
    // tenía mientras siga siéndolo.
    const comision = tipo === 'publica'
      ? (entrada.comisionAgencia !== undefined ? entrada.comisionAgencia : comisionEscrita(tarifa.tipoTarifa))
      : null
    siguiente.tipoTarifa = conComision({ tipo, origen: 'persona', por, en }, comision)
    patch.margen_porcentaje = entrada.comision === 'incluida' ? 0 : null
    // Pública = el precio público: un descuento guardado de cuando era Neta quedaría aplicado sin
    // verse (la tarjeta de la Pública muestra la comisión). Se quita y se avisa (Vera, 2026-10-29).
    if (tipo === 'publica' && siguiente.descuentoCliente) {
      descuentoQuitado = siguiente.descuentoCliente.motivo || 'sin motivo'
      delete siguiente.descuentoCliente
    }
  }
  patch.tarifa_pax = siguiente
  const previa = typeof item.proveedor_id === 'string' ? item.proveedor_id : null
  const proveedorId = proveedorDelPaquete({ ficha, previa, fichas })
  if ('proveedor_id' in item && proveedorId !== previa) patch.proveedor_id = proveedorId

  const { error: errUpd } = await sb.from('items').update(patch).eq('id', itemId)
  if (errUpd) return { success: false, error: errUpd.message as string }
  // D5 (2026-10-29): las tarifas siguen a los paquetes (cada uno con la suya); después, el total.
  const c = await cerrarAccionPorPasos(sb, { workspaceId, cotizacionId: item.cotizacion_id as string, antes: null })
  if (!c.success) return { success: false, error: c.error }
  if (cot.negocio_id) revalidatePath(`/negocios/${cot.negocio_id}`)
  return { success: true, paquete, costo: costo.total, falta: costo.falta, fichaOperador: ficha?.nombre ?? null, ...(descuentoQuitado ? { descuentoQuitado } : {}) }
}

/** Las fichas de proveedor (no hoteles ni actividades) del Directorio del espacio. Si falla, ninguna. */
async function fichasDeProveedores(sb: Supabase, workspaceId: string): Promise<FichaDeOperador[]> {
  const { data, error } = await sb
    .from('fotos_perfiles')
    .select('id, nombre, tipo_proveedor')
    .eq('workspace_id', workspaceId)
    .eq('tipo', 'proveedor')
    .limit(500)
  if (error) return []
  return (data ?? []) as FichaDeOperador[]
}

/**
 * Los operadores del Directorio (fichas de operador o mayorista), para elegir el de cada paquete en
 * la tarjeta (H-13). Solo nombres: la tarjeta no necesita más.
 */
export async function operadoresDelDirectorio(): Promise<string[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []
  const fichas = await fichasDeProveedores(supabase as Supabase, workspaceId)
  return fichas
    .filter(f => f.tipo_proveedor === 'operador' || f.tipo_proveedor === 'mayorista')
    .map(f => (f.nombre ?? '').trim())
    .filter(Boolean)
    .sort((x, y) => x.localeCompare(y, 'es'))
}

export interface ReglasDelPaquete {
  /**
   * El descuento que el cliente ve en este paquete, con su motivo, igual que el del hotel
   * (`tarifa_pax.descuentoCliente`, `reglas-margen.ts`). `null` lo quita.
   */
  descuentoCliente?: { motivo: string; tipo: 'pct' | 'monto'; valor: number } | null
  /**
   * La comisión de una tarifa Pública, en % (`tarifa_pax.tipoTarifa.comisionPct`). Obligatoria para
   * enviar (D3, 2026-10-29). `null` la quita.
   */
  comisionPct?: number | null
  /** La misma comisión en PESOS por todo el paquete (`comisionMonto`, D3). Excluye a `comisionPct`. */
  comisionMonto?: number | null
}

/**
 * «Comisión de esta tarifa» y «+ Descuento para el cliente» del paquete (decisión de Mauricio del
 * 2026-10-29): lo mismo que `ajustarOpcion` hace con el hotel, sobre la línea del paquete. Sin
 * migración: vive en `tarifa_pax`. Después, el recálculo de siempre (el piso de hotel aplica igual:
 * el paquete se margina como hotel).
 */
export async function ajustarReglasDelPaquete(itemId: string, cambios: ReglasDelPaquete): Promise<{ success: true } | { success: false; error: string }> {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const sb = supabase as Supabase
  const { data: item, error: errItem } = await sb
    .from('items')
    .select('*, cotizaciones(estado, negocio_id)')
    .eq('id', itemId)
    .maybeSingle()
  if (errItem) return { success: false, error: errItem.message as string }
  if (!item) return { success: false, error: 'La línea no existe o no es de este workspace.' }
  const cot = (item.cotizaciones ?? {}) as { estado?: string; negocio_id?: string | null }
  if (!isEditable((cot.estado ?? 'borrador') as EstadoCotizacion)) {
    return { success: false, error: 'Esta cotización ya no se edita. Duplícala para trabajar sobre una nueva.' }
  }
  if (ranuraDeGrupo(item.grupo as string | null)?.slug !== 'paquete_detalle') {
    return { success: false, error: 'Esta línea no es un paquete de bloqueo.' }
  }
  const b = await exigirBloqueo(sb, item.cotizacion_id as string)
  if (!b.ok) return { success: false, error: b.error }

  const tarifa = leerTarifaPax(item.tarifa_pax)
  if (cambios.descuentoCliente) {
    const motivo = motivoDescuentoInvalido(cambios.descuentoCliente)
    if (motivo) return { success: false, error: motivo }
  }
  const comision: ComisionEscrita | null | undefined = cambios.comisionMonto !== undefined
    ? (cambios.comisionMonto === null ? null : { tipo: 'monto', valor: cambios.comisionMonto })
    : cambios.comisionPct !== undefined
      ? (cambios.comisionPct === null ? null : { tipo: 'pct', valor: cambios.comisionPct })
      : undefined
  if (comision) {
    const invalida = motivoComisionInvalida(comision)
    if (invalida) return { success: false, error: invalida }
    if (tarifa.tipoTarifa?.tipo !== 'publica') return { success: false, error: 'La comisión es de una tarifa Pública. Guarda el paquete así primero.' }
  }
  if (cambios.descuentoCliente && tarifa.tipoTarifa?.tipo === 'publica') {
    return { success: false, error: 'Una tarifa con la comisión incluida va al precio público: el descuento es de una tarifa por incluir (Neta).' }
  }

  const { data: perfil } = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  const por = (perfil?.full_name as string | null | undefined)?.trim() || null
  const en = new Date().toISOString()
  const siguiente: TarifaPax = { ...tarifa, actualizadaEn: en }
  if (comision !== undefined && siguiente.tipoTarifa?.tipo === 'publica') {
    siguiente.tipoTarifa = conComision(siguiente.tipoTarifa, comision)
  }
  if (cambios.descuentoCliente !== undefined) {
    if (cambios.descuentoCliente === null) delete siguiente.descuentoCliente
    else {
      const d = cambios.descuentoCliente
      siguiente.descuentoCliente = {
        motivo: d.motivo.trim(),
        tipo: d.tipo,
        valor: d.tipo === 'pct' ? Math.round(d.valor * 100) / 100 : Math.round(d.valor),
        por,
        en,
      }
    }
  }
  const { error: errUpd } = await sb.from('items').update({ tarifa_pax: siguiente }).eq('id', itemId)
  if (errUpd) return { success: false, error: errUpd.message as string }
  await recalcularTotales(item.cotizacion_id as string)
  if (cot.negocio_id) revalidatePath(`/negocios/${cot.negocio_id}`)
  return { success: true }
}
