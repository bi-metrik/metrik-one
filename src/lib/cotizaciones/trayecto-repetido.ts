/**
 * Un vuelo y un traslado que cubren el MISMO trayecto el mismo día (G1 · M9-1, QA del
 * 2026-10-29).
 *
 * En el viaje 09 el tren París→Roma y el vuelo Air France París→Roma eran alternativas, pero
 * quedaron en dos servicios de tipo distinto, los dos «Incluido»: el total cobró tren + avión
 * (+$2,1 M y +$3,3 M) y nada en la pantalla lo decía. Las opciones de un servicio son siempre
 * del mismo tipo (el tipo sale del grupo, y con él la ficha, el PDF y lo que Reservas tiene que
 * comprar), así que juntarlos como opciones no es un arreglo de pantalla: queda como decisión
 * de producto (tipo «Tren» o tipo por opción). Mientras tanto, el servicio lo DICE, en rojo, con
 * el nombre del otro: el error caro es el que no se ve.
 *
 * QA G9 (decisión 5 de Mauricio): existe el tipo «Tren» y un tren se junta como opción del vuelo
 * del mismo trayecto (`vuelosParaJuntarElTren`); cada opción sigue siendo lo que se leyó
 * (`ranuraDelItem`).
 *
 * Se compara con `mismoLugar`, el mismo de la bandeja: «Paris Gare de Lyon» y «París CDG» son
 * París; «Roma Termini» y «Roma FCO» son Roma. Sin fecha en alguno de los dos, no se afirma nada.
 *
 * Puro: sin red y sin base.
 */

import { mismoLugar } from './bandeja-capturas'
import { ranuraDelItem } from './detalle-viaje'
import { rutaDeVueloDeOpcion } from './opcion-viaje'
import { leerTarifaPax } from './tarifa-pasajero'

/** Lo que hace falta de un servicio. */
export interface ServicioParaTrayecto {
  grupo: string
  tipo: string
  nombre: string
  opciones: string[]
  estado: string
}

/** Lo que hace falta de una opción. */
export interface OpcionParaTrayecto {
  id: string
  nombre?: string | null
  grupo?: string | null
  tarifa_pax?: unknown
  tramos?: unknown
}

interface Trayecto {
  origen: string
  destino: string
  fecha: string
}

const dia = (f: string | null | undefined): string | null => /^(\d{4}-\d{2}-\d{2})/.exec((f ?? '').trim())?.[1] ?? null

/** «Paris Gare de Lyon -> Roma Termini», «Aeropuerto Orlando (MCO) - Aeropuerto Miami (MIA)». */
function puntasDeTrayecto(texto: string | null | undefined): [string, string] | null {
  const partes = (texto ?? '').split(/\s*(?:->|→|➝|=>)\s*|\s+[-–—]\s+/).map(p => p.trim()).filter(Boolean)
  return partes.length === 2 ? [partes[0], partes[1]] : null
}

function trayectoDeOpcion(tipoDelBloque: string, o: OpcionParaTrayecto): Trayecto | null {
  // QA G9 · cada opción por lo que se leyó: un tren juntado en un bloque de vuelo sigue siendo tren.
  const propia = ranuraDelItem({ nombre: o.nombre ?? null, grupo: o.grupo ?? null, tarifa_pax: o.tarifa_pax })?.slug
  const tipo = propia === 'tren_detalle' ? 'tren' : propia === 'vuelo_detalle' ? 'vuelo' : tipoDelBloque
  if (tipo === 'vuelo') {
    const r = rutaDeVueloDeOpcion({ nombre: o.nombre ?? null, grupo: o.grupo ?? null, tarifa_pax: o.tarifa_pax, tramos: o.tramos })
    const fecha = dia(r.fecha)
    return r.origen && r.destino && fecha ? { origen: r.origen, destino: r.destino, fecha } : null
  }
  if (tipo === 'traslado' || tipo === 'tren') {
    const identidad = leerTarifaPax(o.tarifa_pax).casillas?.grupo_completo?.identidad ?? {}
    const puntas = puntasDeTrayecto(identidad.trayecto)
    const fecha = dia(identidad.fecha_hora)
    return puntas && fecha ? { origen: puntas[0], destino: puntas[1], fecha } : null
  }
  return null
}

const mismoTrayecto = (a: Trayecto, b: Trayecto) =>
  a.fecha === b.fecha && mismoLugar(a.origen, b.origen) === true && mismoLugar(a.destino, b.destino) === true

/** Los transportes del trayecto: vuelo, tren y traslado. */
const CON_TRAYECTO: ReadonlySet<string> = new Set(['vuelo', 'tren', 'traslado'])

/**
 * ¿Dos servicios cubren el mismo trayecto el mismo día? (QA G9, M9-1: «Juntar como opción de…»
 * entre un tren y un vuelo). `true` solo si alguna opción de cada uno lo muestra; sin ruta o sin
 * fecha leída en alguno, `false`: no se junta a ciegas.
 */
export function mismoTrayectoEntre(
  a: Pick<ServicioParaTrayecto, 'tipo' | 'opciones'>,
  b: Pick<ServicioParaTrayecto, 'tipo' | 'opciones'>,
  opcion: (id: string) => OpcionParaTrayecto | undefined,
): boolean {
  const de = (s: Pick<ServicioParaTrayecto, 'tipo' | 'opciones'>) => s.opciones
    .map(id => opcion(id))
    .filter((o): o is OpcionParaTrayecto => !!o)
    .map(o => trayectoDeOpcion(s.tipo, o))
    .filter((t): t is Trayecto => !!t)
  const ta = de(a)
  const tb = de(b)
  return ta.some(x => tb.some(y => mismoTrayecto(x, y)))
}

/**
 * Los vuelos de los que un tren puede ser opción (M9-1 · decisión 5 de Mauricio): los del mismo
 * trayecto el mismo día. Para un servicio que no es tren, ninguno. El tren se junta EN el vuelo
 * (el vuelo es el bloque que la tarifa cruza), nunca al revés.
 */
export function vuelosParaJuntarElTren<S extends Pick<ServicioParaTrayecto, 'grupo' | 'tipo' | 'opciones'>>(
  tren: S,
  servicios: readonly S[],
  opcion: (id: string) => OpcionParaTrayecto | undefined,
): S[] {
  if (tren.tipo !== 'tren') return []
  return servicios.filter(s => s.tipo === 'vuelo' && s.grupo !== tren.grupo && mismoTrayectoEntre(tren, s, opcion))
}

/**
 * El aviso de cada servicio incluido que repite el trayecto de otro de OTRO tipo (vuelo contra
 * traslado), por grupo. Vacío = nada que avisar.
 */
export function avisosDeTrayectoRepetido(
  servicios: readonly ServicioParaTrayecto[],
  opcion: (id: string) => OpcionParaTrayecto | undefined,
): Map<string, string> {
  const conTrayecto = servicios
    .filter(s => s.estado === 'incluido' && CON_TRAYECTO.has(s.tipo))
    .map(s => ({
      s,
      trayectos: s.opciones
        .map(id => opcion(id))
        .filter((o): o is OpcionParaTrayecto => !!o)
        .map(o => trayectoDeOpcion(s.tipo, o))
        .filter((t): t is Trayecto => !!t),
    }))
  const avisos = new Map<string, string>()
  for (const a of conTrayecto) {
    for (const b of conTrayecto) {
      if (a.s.grupo === b.s.grupo || a.s.tipo === b.s.tipo || avisos.has(a.s.grupo)) continue
      if (!a.trayectos.some(x => b.trayectos.some(y => mismoTrayecto(x, y)))) continue
      const trenYVuelo = (a.s.tipo === 'tren' && b.s.tipo === 'vuelo') || (a.s.tipo === 'vuelo' && b.s.tipo === 'tren')
      avisos.set(
        a.s.grupo,
        trenYVuelo
          ? `Mismo trayecto y mismo día que «${b.s.nombre}»: si son alternativas, se están cobrando los dos. Junta el tren como opción del vuelo (⋯ del tren → «Juntar como opción de…») o deja en «No va» el que no va.`
          : `Mismo trayecto y mismo día que «${b.s.nombre}»: si son alternativas, se están cobrando los dos. Deja en «No va» el que no va.`,
      )
    }
  }
  return avisos
}
