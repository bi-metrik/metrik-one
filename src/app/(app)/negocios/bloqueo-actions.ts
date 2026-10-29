'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
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
import { aMayusculas } from '@/lib/negocios/mayusculas'
import { motivoDescuentoInvalido } from '@/lib/cotizaciones/reglas-margen'

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

  if (grupo) {
    const r = await agregarOpcionARanura(cotizacionId, normalizarGrupo(grupo) ?? grupo)
    return r.success ? { success: true, itemId: r.itemId } : { success: false, error: r.error }
  }
  const r = await crearRanuraConOpcion(cotizacionId, 'paquete')
  return r.success ? { success: true, itemId: r.itemId } : { success: false, error: r.error }
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
}

export type ResultadoPaquete =
  | { success: true; paquete: PaqueteBloqueo; costo: number | null; falta: string[] }
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
  if (!paquete.operador) paquete.operador = b.operador

  const costo = costoDelPaquete(paquete)
  const en = new Date().toISOString()
  const siguiente: TarifaPax = { ...tarifa, bloqueo: paquete, actualizadaEn: en }
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
    const comisionPct = tipo === 'publica' ? tarifa.tipoTarifa?.comisionPct ?? null : null
    siguiente.tipoTarifa = { tipo, origen: 'persona', por, en, ...(comisionPct !== null ? { comisionPct } : {}) }
    patch.margen_porcentaje = entrada.comision === 'incluida' ? 0 : null
  }
  patch.tarifa_pax = siguiente

  const { error: errUpd } = await sb.from('items').update(patch).eq('id', itemId)
  if (errUpd) return { success: false, error: errUpd.message as string }
  await recalcularTotales(item.cotizacion_id as string)
  if (cot.negocio_id) revalidatePath(`/negocios/${cot.negocio_id}`)
  return { success: true, paquete, costo: costo.total, falta: costo.falta }
}

export interface ReglasDelPaquete {
  /**
   * El descuento que el cliente ve en este paquete, con su motivo, igual que el del hotel
   * (`tarifa_pax.descuentoCliente`, `reglas-margen.ts`). `null` lo quita.
   */
  descuentoCliente?: { motivo: string; tipo: 'pct' | 'monto'; valor: number } | null
  /**
   * La comisión propia de una tarifa Pública («Incluida»): con ella el paquete entra al margen
   * global con ese margen (`tarifa_pax.tipoTarifa.comisionPct`). `null` la quita.
   */
  comisionPct?: number | null
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
  if (cambios.comisionPct !== undefined && cambios.comisionPct !== null) {
    const c = cambios.comisionPct
    if (!Number.isFinite(c) || c < 0 || c >= 100) return { success: false, error: 'La comisión va de 0 a 99,9 %.' }
    if (tarifa.tipoTarifa?.tipo !== 'publica') return { success: false, error: 'La comisión es de una tarifa con la comisión incluida (Pública). Guarda el paquete así primero.' }
  }

  const { data: perfil } = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  const por = (perfil?.full_name as string | null | undefined)?.trim() || null
  const en = new Date().toISOString()
  const siguiente: TarifaPax = { ...tarifa, actualizadaEn: en }
  if (cambios.comisionPct !== undefined && siguiente.tipoTarifa?.tipo === 'publica') {
    const { comisionPct: _antes, ...resto } = siguiente.tipoTarifa
    void _antes
    siguiente.tipoTarifa = cambios.comisionPct === null ? resto : { ...resto, comisionPct: Math.round(cambios.comisionPct * 100) / 100 }
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
