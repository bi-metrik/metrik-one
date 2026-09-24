/**
 * La bandeja de capturas del editor de Trappvel (P7 del caso Providencia, versión de Mauricio
 * del 2026-09-23): se pegan los pantallazos uno tras otro, cada uno se procesa en segundo
 * plano, y ONE decide solo dónde va cada uno.
 *
 * La regla de agrupación, que es lo único que aquí se decide:
 *
 *  · MISMO TIPO Y MISMA RUTA (o mismo lugar, en un hotel) → opción hermana de esa ranura.
 *  · Cualquier otra cosa → ranura nueva, que suma aparte.
 *
 * ⚠️ El detector no escribe los lugares siempre igual: medido sobre las 8 capturas del caso
 * (`providencia-deteccion.fixture.json`), Avianca sale «Bogotá (BOG)» y Wingo «Bogotá». Por
 * eso un lugar se compara por su código IATA si los dos lo traen, y si no por el nombre sin
 * tildes ni mayúsculas. Comparar el texto crudo partiría el Vuelo 1 en dos ranuras.
 *
 * Puro: sin red y sin base. Lo usa la bandeja (`bandeja-capturas.tsx`) y sus pruebas.
 */

import type { TipoRanura } from './ranuras-cotizacion'

/** Lo que el detector dijo de una captura (`detectarTipoDeCaptura`). */
export interface CapturaDetectada {
  tipo: TipoRanura
  lugar: string | null
  origen: string | null
  destino: string | null
}

/** Una ranura a la que la captura podría sumarse como opción. */
export interface RanuraCandidata {
  grupo: string
  tipo: TipoRanura
  /** El lugar de la ranura (hotel, actividad, traslado). `null` = no se sabe. */
  lugar: string | null
  /** La ruta de un vuelo. `null` = no se sabe. */
  origen: string | null
  destino: string | null
}

export type Ubicacion = { como: 'hermana'; grupo: string } | { como: 'nueva' }

interface LugarComparable {
  codigo: string | null
  nombre: string | null
}

/** «Bogotá (BOG)» → código BOG y nombre «bogota»; «Bogotá» → solo el nombre. */
export function lugarComparable(texto: string | null | undefined): LugarComparable | null {
  const t = (texto ?? '').trim()
  if (!t) return null
  const codigo = /\(([A-Za-z]{3})\)/.exec(t)?.[1]?.toUpperCase()
    ?? (/^[A-Za-z]{3}$/.test(t) ? t.toUpperCase() : null)
  const sinCodigo = t.replace(/\([^)]*\)/g, '').trim()
  const nombre = /^[A-Za-z]{3}$/.test(sinCodigo)
    ? null
    : sinCodigo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || null
  return codigo || nombre ? { codigo, nombre } : null
}

/**
 * ¿Es el mismo lugar? Con código en los dos, manda el código; si no, el nombre. `null` = no
 * se puede saber (falta uno de los dos).
 */
export function mismoLugar(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const x = lugarComparable(a)
  const y = lugarComparable(b)
  if (!x || !y) return null
  if (x.codigo && y.codigo) return x.codigo === y.codigo
  if (x.nombre && y.nombre) return x.nombre === y.nombre
  return null
}

/**
 * Dónde va una captura: hermana de la ranura del mismo tipo y la misma ruta (o lugar), o una
 * ranura nueva. Si la captura no dice su ruta o su lugar y hay UNA sola ranura de su tipo, va
 * con esa: es el caso de «otra opción del mismo hotel» con una pantalla que no dice la ciudad.
 * Con varias ranuras de su tipo y sin dato para elegir, nace una nueva: sumar donde no es se
 * cobraría dos veces menos, y una ranura de más se ve y se junta con «Pasar a otra ranura».
 */
export function ubicarCaptura(captura: CapturaDetectada, ranuras: readonly RanuraCandidata[]): Ubicacion {
  const delTipo = ranuras.filter(r => r.tipo === captura.tipo)
  if (delTipo.length === 0) return { como: 'nueva' }

  const conDato = captura.tipo === 'vuelo'
    ? captura.origen !== null || captura.destino !== null
    : captura.lugar !== null
  if (!conDato) return delTipo.length === 1 ? { como: 'hermana', grupo: delTipo[0].grupo } : { como: 'nueva' }

  for (const r of delTipo) {
    if (captura.tipo === 'vuelo') {
      const o = mismoLugar(captura.origen, r.origen)
      const d = mismoLugar(captura.destino, r.destino)
      if (o === true && d === true) return { como: 'hermana', grupo: r.grupo }
    } else if (mismoLugar(captura.lugar, r.lugar) === true) {
      return { como: 'hermana', grupo: r.grupo }
    }
  }
  return { como: 'nueva' }
}

// ── El estado de cada captura en la bandeja ──────────────────────────────────

export type EstadoCaptura =
  | 'mirando'
  | 'leyendo'
  | 'lista'
  | 'eligiendo_opcion'
  | 'eligiendo_tipo'
  | 'rechazada'
  | 'aceptada'
  | 'borrada'

/**
 * La línea de estado del encabezado del paso Componentes (P7): «3 bloques · 2 completos · 1
 * requiere atención». Un bloque está completo cuando todas sus opciones tienen costo; el que
 * no, requiere atención con su motivo.
 */
/**
 * ¿El aviso de la lectura solo informa lo que ONE ya hizo, sin pedir nada? Hoy, el de los
 * impuestos que se pagan en destino (`lectura-pantallazo.ts`, 7.3): queda en «Se paga en el
 * destino» y en el documento. Un aviso así no deja la opción ni el bloque por atender (H5).
 */
export function esAvisoSoloInformativo(aviso: string | null | undefined): boolean {
  return !!aviso && aviso.startsWith('Impuestos y tasas a pagar en destino:') && aviso.includes('van al cliente como nota, no al costo')
}

export interface EstadoDeBloque {
  grupo: string
  etiqueta: string
  completo: boolean
  motivo: string | null
  /**
   * Lo que dice el ⚠ del bloque al pasar el mouse (H5): de qué se trata, en pocas palabras.
   * `null` si el bloque está completo.
   */
  aviso: string | null
  /** El detalle que abre el ⚠: qué pasa y qué hacer, en palabras llanas. */
  explicacion: string | null
  /** La opción que hay que abrir para arreglarlo («Ver la opción»). `null` si son varias. */
  opcionId: string | null
}

export function estadoDeBloque(
  bloque: { grupo: string; etiqueta: string },
  opciones: readonly { id?: string; nombre: string; conCosto: boolean; sinConfirmar: boolean; alerta: string | null }[],
): EstadoDeBloque {
  const sinCosto = opciones.filter(o => !o.conCosto)
  const sinConfirmar = opciones.filter(o => o.sinConfirmar)
  const conAlerta = opciones.find(o => o.alerta)
  const motivo = sinConfirmar.length > 0
    ? sinConfirmar.length === 1
      ? `${sinConfirmar[0].nombre}: falta confirmar lo leído`
      : `${sinConfirmar.length} opciones sin confirmar`
    : sinCosto.length > 0
      ? sinCosto.length === 1 ? `${sinCosto[0].nombre}: sin costo` : `${sinCosto.length} opciones sin costo`
      : conAlerta
        ? `${conAlerta.nombre}: ${conAlerta.alerta}`
        : null
  let aviso: string | null = null
  let explicacion: string | null = null
  let opcionId: string | null = null
  if (sinConfirmar.length > 0) {
    aviso = 'Falta confirmar el costo'
    explicacion = sinConfirmar.length === 1
      ? `ONE leyó el pantallazo de ${sinConfirmar[0].nombre}, pero su costo todavía no entró a la cotización. Ábrela y termina lo que le falta.`
      : `${sinConfirmar.length} opciones tienen el pantallazo leído y el costo sin confirmar. Ábrelas y termina lo que les falta.`
    opcionId = sinConfirmar.length === 1 ? sinConfirmar[0].id ?? null : null
  } else if (sinCosto.length > 0) {
    aviso = 'Falta el costo'
    explicacion = sinCosto.length === 1
      ? `${sinCosto[0].nombre} no tiene costo: pega su pantallazo o escríbelo a mano.`
      : `${sinCosto.length} opciones no tienen costo: pega su pantallazo o escríbelo a mano.`
    opcionId = sinCosto.length === 1 ? sinCosto[0].id ?? null : null
  } else if (conAlerta) {
    aviso = 'Hay algo por revisar'
    explicacion = `${conAlerta.nombre}: ${conAlerta.alerta}`
    opcionId = conAlerta.id ?? null
  }
  return { grupo: bloque.grupo, etiqueta: bloque.etiqueta, completo: motivo === null, motivo, aviso, explicacion, opcionId }
}

/** «3 bloques · 2 completos · 1 requiere atención». */
export function resumenDeBloques(estados: readonly EstadoDeBloque[]): string {
  const n = estados.length
  const completos = estados.filter(e => e.completo).length
  const atencion = n - completos
  const partes = [
    `${n} ${n === 1 ? 'bloque' : 'bloques'}`,
    `${completos} ${completos === 1 ? 'completo' : 'completos'}`,
  ]
  if (atencion > 0) partes.push(`${atencion} ${atencion === 1 ? 'requiere' : 'requieren'} atención`)
  return partes.join(' · ')
}

// ── Lo que la lectura dejó en la opción ──────────────────────────────────────

/**
 * La opción tal como quedó guardada después de leer su captura: lo que la ficha de la bandeja
 * necesita para pintarse sin esperar a que la página vuelva a traer las líneas.
 *
 * ⚠️ La ficha sale de AQUÍ y no de la lista de líneas de la página: el refresco que la trae
 * puede llegar tarde (las acciones del servidor van en fila), y mientras tanto la bandeja
 * decía «La lectura no dejó datos para la ficha» sobre una lectura completa (COT-2026-0011).
 */
export interface OpcionLeida {
  id: string
  nombre: string | null
  grupo: string | null
  tarifa_pax: unknown
  tramos: unknown
  cargo_destino_valor: number | string | null
  cargo_destino_moneda: string | null
}

/** Arma la opción desde la fila de `items` (con `select('*')`: las columnas nuevas pueden faltar). */
export function opcionLeidaDeFila(fila: Record<string, unknown> | null | undefined): OpcionLeida | null {
  if (!fila || typeof fila.id !== 'string') return null
  return {
    id: fila.id,
    nombre: typeof fila.nombre === 'string' ? fila.nombre : null,
    grupo: typeof fila.grupo === 'string' ? fila.grupo : null,
    tarifa_pax: fila.tarifa_pax ?? null,
    tramos: fila.tramos ?? null,
    cargo_destino_valor: (fila.cargo_destino_valor as number | string | null | undefined) ?? null,
    cargo_destino_moneda: typeof fila.cargo_destino_moneda === 'string' ? fila.cargo_destino_moneda : null,
  }
}

// ── El pie de la bandeja: los pantallazos que ya están en la cotización ──────

/**
 * Una llave por pantallazo que ya vive en Componentes: cada habitación de una opción, o su
 * casilla si no tiene habitaciones (con habitaciones, la casilla del grupo ES la primera
 * habitación y no se cuenta dos veces). La llave es la huella de la imagen cuando la lectura
 * la trae; una lectura anterior a las huellas cuenta igual, con una llave propia.
 *
 * El pie de la bandeja dice cuántos hay, sin contar los que la bandeja ya muestra aceptados.
 */
export function pantallazosEnCotizacion(items: readonly { id: string; tarifa_pax?: unknown; es_ajuste?: boolean | null }[]): string[] {
  const llaves: string[] = []
  for (const it of items) {
    if (it.es_ajuste === true || !it.tarifa_pax || typeof it.tarifa_pax !== 'object') continue
    const t = it.tarifa_pax as { casillas?: Record<string, unknown>; habitaciones?: { lectura?: unknown }[] }
    const habs = Array.isArray(t.habitaciones) ? t.habitaciones : []
    const lecturas: unknown[] = habs.length > 0 ? habs.map(h => h?.lectura) : Object.values(t.casillas ?? {})
    lecturas.forEach((l, i) => {
      if (!l || typeof l !== 'object') return
      const huella = (l as { huellaImagen?: unknown }).huellaImagen
      llaves.push(typeof huella === 'string' && huella ? huella : `${it.id}:${i}`)
    })
  }
  return [...new Set(llaves)]
}
