/**
 * Lo que la fila de la bandeja deja revisar ANTES de aceptar (H4, prototipo de la tarjeta del
 * 2026-09-24): el título de la captura y los campos leídos, editables en línea.
 *
 * Lo que se corrige aquí viaja con «Aceptar con cambios» y el servidor lo escribe como
 * corrección de la opción recién creada (`tarifa_pax.correcciones`), por el mismo camino que la
 * ficha de la tarjeta (`corregirCampoDeFicha`): lo que leyó la IA queda intacto en la casilla y
 * lo corregido manda encima. Por eso aquí solo entran campos corregibles (`esCorregible`): el
 * costo se ve, pero no se toca en la bandeja (se corrige en la tarjeta, en «Costo y precio»).
 *
 * Los rótulos de vuelo son los del prototipo («Vuelo», «Fecha», «Sale de ADZ», «Llega a PVA»,
 * «Costo»); los de las demás ranuras, los del catálogo de campos (los mismos de la ficha).
 *
 * Puro: sin red y sin base.
 */

import { fechaSinDiaDeLaSemana } from './anio-fecha'
import { leidosPorSlug, esCorregible } from './correcciones'
import { fechaCorta } from './detalle-viaje'
import { validarCorreccion } from './ficha-linea'
import { codigoDeLugar } from './opcion-viaje'
import { definicionDeTipo, type TipoRanura } from './ranuras-cotizacion'
import type { CampoRanura, DefinicionRanura } from './ranuras-pantallazo'
import { composicionDeLectura, describirOcupacion, formatoMonto, montoDeCosto, type LecturaCasilla } from './tarifa-pasajero'
import { leerFecha, lugarConCodigo } from '@/lib/pdf/cotizacion-trappvel-formato'

export interface CampoRevision {
  slug: string
  label: string
  /** Lo que se muestra al abrir la fila: lo leído, en la forma que se lee («23 nov 2026»). */
  valor: string
  /** El costo se ve pero no se corrige en la bandeja. */
  editable: boolean
  /** El dato hace falta y la lectura no lo trajo: se pinta en ámbar. */
  dudoso: boolean
  /** Solo en las horas que faltan: «Escríbela». */
  placeholder: string | null
}

/** Los campos que la fila muestra, en su orden, por tipo de ranura. `costo` es el costo leído. */
const CAMPOS_POR_TIPO: Record<TipoRanura, readonly string[]> = {
  vuelo: ['aerolinea', 'numero_vuelo', 'fecha_salida', 'hora_salida', 'hora_llegada', 'costo'],
  hotel: ['tipo_habitacion', 'regimen', 'check_in', 'check_out', 'politica_cancelacion', 'costo'],
  traslado: ['proveedor', 'trayecto', 'tipo_vehiculo', 'fecha_hora', 'costo'],
  actividad: ['proveedor', 'nombre', 'fecha', 'duracion', 'costo'],
}

/** Los que, vacíos, se marcan en ámbar: sin ellos la opción queda coja. */
const HACEN_FALTA = new Set(['hora_salida', 'hora_llegada'])

/** Lo que dice la fila cuando el pantallazo no trae la hora de llegada (texto del prototipo). */
export const PREGUNTA_HORA_LLEGADA = 'El pantallazo corta la hora de llegada. Escríbela y acepta; lo demás ONE ya lo leyó.'

function ranuraDeTipo(tipo: TipoRanura): DefinicionRanura | null {
  try {
    return definicionDeTipo(tipo)
  } catch {
    return null
  }
}

/** «San Andrés» desde «San Andrés (ADZ)» o «ADZ»: el lugar dicho para leer. */
function lugar(texto: string | null | undefined): string | null {
  return lugarConCodigo(texto)?.nombre ?? null
}

/** El monto con el que se costea la captura, sin el signo en pesos: «2.360.000». */
export function costoLegible(l: LecturaCasilla): string {
  const monto = montoDeCosto(l)
  if (!Number.isFinite(monto) || monto <= 0) return ''
  const moneda = (l.moneda || 'COP').toUpperCase()
  return moneda === 'COP' ? Math.round(monto).toLocaleString('es-CO') : formatoMonto(monto, moneda)
}

/** «2 adultos + 1 niño»: la ocupación que dice la propia captura, o `null`. */
export function ocupacionDeCaptura(l: LecturaCasilla): string | null {
  const c = composicionDeLectura(l)
  return c ? describirOcupacion(c, 'coma').split(', ').join(' + ') : null
}

/** Lo leído de una fecha, para leer: «23 nov 2026», o «23 nov» si no traía el año. */
function fechaParaLeer(valor: string): string {
  // El día de la semana que trae la lectura («--11-25/mie») no se lee en el campo.
  const sinDia = fechaSinDiaDeLaSemana(valor).replace(/\/[^/\d]+$/, '')
  return fechaCorta(sinDia) ?? valor
}

/**
 * El título de la fila: «Satena · San Andrés → Providencia» en un vuelo,
 * «Posada Enilda · Habitación 2 Camas · 2 adultos» en un hotel. `conPrecio` le suma el costo
 * («· $401.200»), como en la pregunta de la habitación que sobra. `null` sin nada leído.
 */
export function tituloDeCaptura(tipo: TipoRanura, l: LecturaCasilla | null | undefined, conPrecio = false): string | null {
  if (!l) return null
  const ranura = ranuraDeTipo(tipo)
  const v = ranura ? leidosPorSlug(ranura, l.campos) : {}
  let partes: (string | null)[]
  if (tipo === 'vuelo') {
    const o = lugar(v.origen)
    const d = lugar(v.destino)
    partes = [v.aerolinea ?? null, o && d ? `${o} → ${d}` : (o ?? d)]
  } else if (tipo === 'hotel') {
    partes = [v.hotel ?? l.nombre ?? null, v.tipo_habitacion ?? null, ocupacionDeCaptura(l)]
  } else if (tipo === 'actividad') {
    partes = [v.nombre ?? l.nombre ?? null, v.proveedor ?? null]
  } else {
    partes = [v.trayecto ?? l.nombre ?? null, v.proveedor ?? null]
  }
  const precio = conPrecio ? costoLegible(l) : ''
  if (precio) partes.push(/^\d/.test(precio) ? `$${precio}` : precio)
  const t = partes.filter((p): p is string => !!p && p.trim() !== '').join(' · ')
  return t || null
}

/** Los campos de la fila, con lo leído. */
export function camposDeRevision(tipo: TipoRanura, l: LecturaCasilla): CampoRevision[] {
  const ranura = ranuraDeTipo(tipo)
  if (!ranura) return []
  const leidos = leidosPorSlug(ranura, l.campos)
  const out: CampoRevision[] = []
  for (const slug of CAMPOS_POR_TIPO[tipo]) {
    if (slug === 'costo') {
      out.push({ slug, label: 'Costo', valor: costoLegible(l), editable: false, dudoso: false, placeholder: null })
      continue
    }
    const def = ranura.campos.find(c => c.slug === slug)
    if (!def || !esCorregible(ranura, slug)) continue
    const bruto = leidos[slug] ?? ''
    const valor = bruto === '' ? '' : def.tipo === 'fecha' ? fechaParaLeer(bruto) : bruto
    const falta = valor === '' && (def.min || HACEN_FALTA.has(slug))
    out.push({
      slug,
      label: rotulo(tipo, def, leidos),
      valor,
      editable: true,
      dudoso: falta,
      placeholder: falta && slug.startsWith('hora_') ? 'Escríbela' : null,
    })
  }
  return out
}

/** Los rótulos del prototipo en el vuelo; el catálogo en lo demás. */
function rotulo(tipo: TipoRanura, def: CampoRanura, leidos: Record<string, string>): string {
  if (tipo !== 'vuelo') return def.label
  if (def.slug === 'numero_vuelo') return 'Vuelo'
  if (def.slug === 'fecha_salida') return 'Fecha'
  if (def.slug === 'hora_salida') {
    const o = codigoDeLugar(leidos.origen)
    return o ? `Sale de ${o}` : def.label
  }
  if (def.slug === 'hora_llegada') {
    const d = codigoDeLugar(leidos.destino)
    return d ? `Llega a ${d}` : def.label
  }
  return def.label
}

/** La frase que va sobre los campos, o `null`. Solo la del prototipo: la hora de llegada. */
export function preguntaDeRevision(tipo: TipoRanura, campos: readonly CampoRevision[]): string | null {
  if (tipo !== 'vuelo') return null
  return campos.some(c => c.slug === 'hora_llegada' && c.dudoso) ? PREGUNTA_HORA_LLEGADA : null
}

export interface CorreccionDeBandeja {
  slug: string
  /** Normalizado como lo guarda la lectura. `''` = la persona dejó el campo vacío a propósito. */
  valor: string
}

export type ResultadoRevision =
  | { ok: true; correcciones: CorreccionDeBandeja[] }
  | { ok: false; errores: Record<string, string> }

/** Una fecha escrita como se lee («23 nov 2026», «2026-11-23») a `AAAA-MM-DD`. */
function fechaAIso(texto: string): string | null {
  const f = leerFecha(texto.trim())
  if (!f || f.anio === null) return null
  return `${f.anio}-${String(f.mes + 1).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`
}

/**
 * Lo que cambió la persona, validado con la MISMA regla que la ficha (`validarCorreccion`).
 * Lo que no se tocó no viaja: una corrección es solo lo que alguien escribió.
 */
export function correccionesDeRevision(
  tipo: TipoRanura,
  campos: readonly CampoRevision[],
  escritos: Readonly<Record<string, string>>,
): ResultadoRevision {
  const ranura = ranuraDeTipo(tipo)
  if (!ranura) return { ok: true, correcciones: [] }
  const correcciones: CorreccionDeBandeja[] = []
  const errores: Record<string, string> = {}
  for (const c of campos) {
    if (!c.editable || !(c.slug in escritos)) continue
    const escrito = (escritos[c.slug] ?? '').trim()
    if (escrito === c.valor.trim()) continue
    const def = ranura.campos.find(d => d.slug === c.slug)
    if (!def) continue
    let entrada = escrito
    if (def.tipo === 'fecha' && escrito !== '') {
      const iso = fechaAIso(escrito)
      if (!iso) { errores[c.slug] = 'La fecha no es válida.'; continue }
      entrada = iso
    }
    const v = validarCorreccion(def, entrada)
    if (!v.ok) { errores[c.slug] = v.error; continue }
    correcciones.push({ slug: c.slug, valor: v.valor ?? '' })
  }
  return Object.keys(errores).length > 0 ? { ok: false, errores } : { ok: true, correcciones }
}
