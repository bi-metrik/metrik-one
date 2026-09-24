/**
 * Lo que la bandeja sabe decir de una captura leída que todavía NO está en Componentes (H2 de
 * la prueba del 2026-09-24): a dónde va a ir si se acepta y si se parece a algo que ya estaba.
 *
 * La lectura vive en la fila como borrador firmado; aquí se arma, SIN tocar la base, la opción
 * que la fila pinta (`opcionDeBorrador`) y se la compara contra la cotización que se ve. El
 * servidor vuelve a ubicarla al aceptar, contra la cotización de ese momento, con la misma
 * función (`ubicarLectura`): lo que diga aquí es el pronóstico, lo que decida allá es lo que
 * queda. Por eso «Aceptar» responde con el sitio real («Agregada a Hotel en Providencia ·
 * Opción 2») y la fila no promete nada que el servidor no vaya a cumplir.
 *
 * Puro.
 */

import type { OpcionLeida } from './bandeja-capturas'
import { camposDeLectura } from './campos-de-lectura'
import { compararConExistentes, nombreDeOpcion, opcionCorta, type OpcionComparable, type Ubicacion } from './captura-repetida'
import type { Borrador, Revision } from './proceso-captura'
import { definicionDeTipo, type TipoRanura } from './ranuras-cotizacion'
import { etiquetaDeRanura } from './ranuras-pantallazo'
import type { Composicion, LecturaCasilla } from './tarifa-pasajero'
import { ubicarLectura, type DestinoDeLectura, type LineaParaUbicar } from './ubicar-lectura'

/** El id de una opción que solo existe en la bandeja. Nunca llega a la base. */
export const PREFIJO_BORRADOR = 'borrador:'

export const esIdDeBorrador = (id: string | null | undefined): boolean => !!id && id.startsWith(PREFIJO_BORRADOR)

/**
 * La opción como quedaría en Componentes, para pintar la ficha y comparar. `grupo`: la ranura
 * donde caería; sin ranura todavía, el tipo (que resuelve la misma definición).
 */
export function opcionDeBorrador(capId: string, tipo: TipoRanura, lectura: LecturaCasilla, grupo?: string | null): OpcionLeida {
  const g = grupo || tipo
  const tarifaPax = { casillas: { grupo_completo: lectura } }
  const fila = { nombre: lectura.nombre || null, grupo: g, tramos: null, cargo_destino_valor: null, cargo_destino_moneda: null }
  const derivados = camposDeLectura(fila, tarifaPax)
  return {
    id: `${PREFIJO_BORRADOR}${capId}`,
    nombre: lectura.nombre || null,
    grupo: g,
    tarifa_pax: tarifaPax,
    tramos: derivados.tramos ?? null,
    cargo_destino_valor: (derivados.cargo_destino_valor ?? null) as number | null,
    cargo_destino_moneda: (derivados.cargo_destino_moneda ?? null) as string | null,
  }
}

/** A dónde iría, dicho como se lee en Componentes. */
export function textoDeDestino(
  d: DestinoDeLectura,
  tipo: TipoRanura,
  pistas: { lugar: string | null; origen: string | null; destino: string | null },
  ubicaciones: Readonly<Record<string, Ubicacion>>,
): string {
  if (d.como === 'habitacion') return `Habitación de ${nombreDeOpcion(d.itemId, ubicaciones, etiquetaDeRanura(d.grupo))}`
  if (d.como === 'hermana') return `Otra opción de ${etiquetaDeRanura(d.grupo)}`
  const lugar = pistas.destino || pistas.lugar
  return `${definicionDeTipo(tipo).label}${lugar ? ` en ${lugar}` : ''} · nuevo`
}

export function revisarBorrador(a: {
  capId: string
  borrador: Borrador
  /** Las líneas de la cotización que se ve: contra ellas se ubica. */
  lineas: readonly (LineaParaUbicar & OpcionComparable)[]
  /** Lo que se compara (P10): las líneas y los borradores vivos de las otras capturas. */
  comparables: readonly OpcionComparable[]
  composicion: Composicion | null
  ubicaciones: Readonly<Record<string, Ubicacion>>
  /** `false` cuando el asesor pidió procesarla igual: no se le vuelve a preguntar. */
  comparar: boolean
}): Revision {
  const { capId, borrador, ubicaciones } = a
  const destino = ubicarLectura({
    tipo: borrador.tipo,
    lectura: borrador.lectura,
    pistas: borrador.pistas,
    lineas: a.lineas,
    grupoViaje: a.composicion,
  })
  const leida = opcionDeBorrador(capId, borrador.tipo, borrador.lectura, destino.como === 'nueva' ? null : destino.grupo)
  const donde = textoDeDestino(destino, borrador.tipo, borrador.pistas, ubicaciones)
  const como = destino.como

  // R8, regla 6: el grupo ya está cubierto en la opción de ese hotel. Se pregunta.
  if (destino.como === 'habitacion' && destino.sobra) {
    return {
      leida,
      donde,
      como,
      pregunta: { fase: 'parecida', conItemId: destino.itemId, donde: nombreDeOpcion(destino.itemId, ubicaciones, etiquetaDeRanura(destino.grupo)), habitacion: true },
    }
  }
  if (!a.comparar) return { leida, donde, como }
  const r = compararConExistentes(leida, a.comparables)
  if (!r) return { leida, donde, como }
  const conBorrador = esIdDeBorrador(r.con.id)
  // «Reemplazar el precio» necesita una opción que YA esté en Componentes: contra otra captura
  // de la bandeja no hay nada que reemplazar todavía.
  if (r.tipo === 'otro_precio' && conBorrador) return { leida, donde, como }
  const dondeCon = conBorrador ? 'otra captura de esta bandeja' : nombreDeOpcion(r.con.id, ubicaciones)
  return r.tipo === 'parecida'
    ? { leida, donde, como, pregunta: { fase: 'parecida', conItemId: r.con.id, donde: dondeCon } }
    : { leida, donde, como, pregunta: { fase: 'otro_precio', conItemId: r.con.id, donde: dondeCon, corta: opcionCorta(r.con.id, ubicaciones) } }
}
