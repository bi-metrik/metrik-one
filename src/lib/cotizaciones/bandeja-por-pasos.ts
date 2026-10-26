/**
 * La bandeja de la cotización por pasos (C5), en lo que no es pintar: qué frase dice cada fila,
 * qué ofrece su menú, con qué estado llega y qué se manda al aceptar una o «los N».
 *
 * Puro: lo usa `bandeja-capturas.tsx` y se prueba sin DOM.
 */

import type { BorradorParaAceptar } from '@/app/(app)/negocios/tarifa-pax-actions'
import {
  conDecisionDelModelo,
  decisionParaAceptar,
  destinoDeReglas,
  fraseDeDestino,
  opcionalSegunLectura,
  serviciosDelMismoTipo,
  type DecisionDelModelo,
  type DestinoPorPasos,
} from './destino-por-pasos'
import type { FilaDeLoteParaEnviar } from './bandeja-red'
import type { Borrador } from './proceso-captura'
import { definicionDeTipo, type TipoRanura } from './ranuras-cotizacion'
import type { Composicion } from './tarifa-pasajero'
import type { LineaParaUbicar } from './ubicar-lectura'
import { resolverRanura } from './ranuras-pantallazo'
import { lugarDeBloqueNuevo } from './actividad-pantallazo'

export type EstadoAlAceptar = 'incluido' | 'opcional'

/** Lo que la persona eligió en el menú de la frase: un servicio de la página o una captura de la bandeja. */
export type Eleccion =
  | { como: 'nueva' }
  | { como: 'hermana'; itemId: string }
  /** «Otra opción de» una captura de la bandeja que todavía no se acepta. */
  | { como: 'hermana_de_captura'; capturaId: string; titulo: string }

/** Lo que la fila sabe decir antes de aceptar. */
export interface FraseDeFila {
  destino: DestinoPorPasos
  frase: string
  /** «Otra opción de» una captura de la bandeja: va en el lote detrás de ella. */
  capturaDestino: string | null
}

/** Una captura lista, en lo que la frase necesita. */
export interface CapturaLista {
  id: string
  titulo: string
  borrador: Borrador
}

/** El nombre del servicio nuevo, como el bloque que abriría: «Hotel en San Andrés». */
export function nombreNuevo(b: Borrador, destinoViaje: string | null): string {
  const label = definicionDeTipo(b.tipo).label
  const lugar = b.tipo === 'actividad'
    ? lugarDeBloqueNuevo(b.tipo, b.lectura, b.pistas.lugar) ?? (destinoViaje?.trim() || null)
    : b.tipo === 'traslado'
      ? lugarDeBloqueNuevo(b.tipo, b.lectura, b.pistas.lugar)
      : b.pistas.destino || b.pistas.lugar
  return `${label}${lugar ? ` en ${lugar}` : ''}`
}

/**
 * La frase de UNA fila: la de las reglas, pasada por el modelo (si respondió a tiempo en la
 * lectura) y, encima, lo que eligió la persona. Una elección que ya no vale (el servicio se borró)
 * se ignora y vuelve la de ONE.
 */
export function fraseDeFila(args: {
  captura: CapturaLista
  lineas: readonly LineaParaUbicar[]
  composicion: Composicion | null
  destinoViaje: string | null
  modelo: DecisionDelModelo | null
  eleccion: Eleccion | null
}): FraseDeFila {
  const { captura, lineas } = args
  const b = captura.borrador
  const reglas = destinoDeReglas({ tipo: b.tipo, lectura: b.lectura, pistas: b.pistas, lineas, grupoViaje: args.composicion })
  const deOne = conDecisionDelModelo({ tipo: b.tipo, reglas, lineas, modelo: args.modelo })
  const nuevo = nombreNuevo(b, args.destinoViaje)
  const e = args.eleccion
  if (e?.como === 'nueva') {
    const destino: DestinoPorPasos = { como: 'nueva', itemId: null, grupo: null, razon: 'Lo cambiaste tú.', duda: false, fuente: 'asesora' }
    return { destino, frase: fraseDeDestino(destino, nuevo, lineas), capturaDestino: null }
  }
  if (e?.como === 'hermana') {
    const s = serviciosDelMismoTipo(b.tipo, lineas).find(x => x.itemId === e.itemId)
    if (s) {
      const destino: DestinoPorPasos = { como: 'hermana', itemId: s.itemId, grupo: s.grupo, razon: 'Lo cambiaste tú.', duda: false, fuente: 'asesora' }
      return { destino, frase: fraseDeDestino(destino, nuevo, lineas), capturaDestino: null }
    }
  }
  if (e?.como === 'hermana_de_captura') {
    const destino: DestinoPorPasos = { como: 'hermana', itemId: null, grupo: null, razon: 'Lo cambiaste tú.', duda: false, fuente: 'asesora' }
    return { destino, frase: `Otra opción de: ${e.titulo}`, capturaDestino: e.capturaId }
  }
  return { destino: deOne, frase: fraseDeDestino(deOne, nuevo, lineas), capturaDestino: null }
}

/** Una entrada del menú de la frase. */
export interface EntradaDeMenu {
  etiqueta: string
  eleccion: Eleccion
}

/**
 * El menú de la frase (M3): «Suma aparte (servicio nuevo)» y «Otra opción de: …» SOLO con
 * servicios del mismo tipo, los de la página y los de las otras filas de la bandeja que van como
 * servicio nuevo.
 */
export function menuDeFila(captura: CapturaLista, lineas: readonly LineaParaUbicar[], otras: readonly { captura: CapturaLista; frase: FraseDeFila }[]): EntradaDeMenu[] {
  const tipo: TipoRanura = captura.borrador.tipo
  const menu: EntradaDeMenu[] = [{ etiqueta: 'Suma aparte (servicio nuevo)', eleccion: { como: 'nueva' } }]
  for (const s of serviciosDelMismoTipo(tipo, lineas)) {
    menu.push({ etiqueta: `Otra opción de: ${s.etiqueta}`, eleccion: { como: 'hermana', itemId: s.itemId } })
  }
  for (const o of otras) {
    if (o.captura.id === captura.id || o.captura.borrador.tipo !== tipo || o.frase.destino.como !== 'nueva') continue
    menu.push({
      etiqueta: `Otra opción de: ${o.captura.titulo} (en la bandeja)`,
      eleccion: { como: 'hermana_de_captura', capturaId: o.captura.id, titulo: o.captura.titulo },
    })
  }
  return menu
}

/**
 * Con qué estado llega (decisión M, P11): «Incluido», salvo un pantallazo que diga que es
 * opcional. Solo un servicio NUEVO de traslado o actividad lo tiene; lo que se suma a otro toma el
 * del servicio. `null` = el desplegable no aplica.
 */
export function estadoInicial(b: Borrador, destino: DestinoPorPasos): { estado: EstadoAlAceptar; motivo: string | null } | null {
  if (destino.como !== 'nueva' || (b.tipo !== 'traslado' && b.tipo !== 'actividad')) return null
  const motivo = opcionalSegunLectura(b.tipo, b.lectura)
  return { estado: motivo ? 'opcional' : 'incluido', motivo }
}

/** El cuerpo de «Aceptar» de una fila, con lo que dice su frase. */
export function cuerpoDeAceptar(
  b: Borrador,
  frase: FraseDeFila,
  extra: { imagen: string | null; correcciones: BorradorParaAceptar['correcciones']; idAceptacion: string; destinoId?: string | null },
): BorradorParaAceptar {
  const d = decisionParaAceptar(frase.destino)
  return {
    tipo: b.tipo, lecturaJson: b.lecturaJson, firma: b.firma, pistas: b.pistas,
    decision: frase.capturaDestino ? 'hermana' : d.decision,
    destinoId: frase.capturaDestino ? (extra.destinoId ?? null) : d.destinoId,
    imagen: extra.imagen, correcciones: extra.correcciones, idAceptacion: extra.idAceptacion,
  }
}

/**
 * Las filas de «Aceptar los N», en el orden en que se PEGARON (la bandeja muestra lo nuevo arriba):
 * así una captura que es «Otra opción de» otra de la bandeja va detrás de ella.
 */
export function filasDelLote(listas: readonly {
  id: string
  borrador: Borrador
  frase: FraseDeFila
  estado: EstadoAlAceptar | null
  imagen: string | null
  /** «Otra opción de» una captura que YA se aceptó: la opción que dejó. */
  destinoAceptado?: string | null
}[]): FilaDeLoteParaEnviar[] {
  const enOrden = [...listas].reverse()
  const ids = new Set(enOrden.map(l => l.id))
  return enOrden.map(l => ({
    id: l.id,
    borrador: cuerpoDeAceptar(l.borrador, l.frase, { imagen: l.imagen, correcciones: null, idAceptacion: l.id, destinoId: l.destinoAceptado ?? null }),
    ...(l.estado ? { estado: l.estado } : {}),
    ...(l.frase.capturaDestino && ids.has(l.frase.capturaDestino) ? { destinoCaptura: l.frase.capturaDestino } : {}),
  }))
}

/**
 * Re-verificación D · el pantallazo de una opción BORRADA vuelve a la bandeja sabiendo dónde
 * estaba: si su pista no trae lugar, se toma del servicio del que salió («Traslado en San Andrés»
 * → «San Andrés»). Sin esto la frase decía «Suma aparte: Traslado», sin el lugar. Un vuelo no se
 * nombra por lugar; una pista que ya trae lugar no se toca.
 */
export function pistasConLugarDelServicio(
  pistas: { lugar: string | null; origen: string | null; destino: string | null },
  grupo: string | null | undefined,
): { lugar: string | null; origen: string | null; destino: string | null } {
  if (pistas.lugar) return pistas
  const inst = resolverRanura(grupo ?? null)
  if (!inst || inst.definicion.slug === 'vuelo_detalle') return pistas
  const m = /\ben\s+(.+)$/i.exec((inst.nombre ?? '').trim())
  return m ? { ...pistas, lugar: m[1].trim() } : pistas
}
