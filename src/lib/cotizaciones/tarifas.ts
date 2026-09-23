/**
 * Las TRES tarifas que se le proponen al cliente: Económica, Recomendada, Premium.
 *
 * Paso 2 de `proyectos/trappvel/clarity/docs/diseno/ranuras-y-motor-de-combinacion.md`.
 *
 * ## Qué cambia respecto de enumerar combinaciones
 *
 * Hasta hoy la tabla generaba el **producto cartesiano** de las ranuras: dos vuelos y un
 * hotel con dos opciones cada uno son ocho filas, y con el viaje a Providencia (tres
 * ranuras) el producto completo son ocho combinaciones de las que siete sobran. Lo que se
 * le manda al cliente son **tres**, con nombre, y el nombre es el que él ve.
 *
 * Una tarifa es **una variante elegida por ranura**, y su precio es la suma de todas las
 * ranuras. No es «la del medio por aritmética»: la Recomendada es la que la agencia
 * recomienda, y por eso es la que más se va a corregir a mano.
 *
 * ## Los nombres son DATO del cliente, no etiquetas internas
 *
 * Se escriben exactamente así —con tilde en «Económica»— porque **viajan al PDF**
 * (`tituloDeBloquePDF`). Cambiarlos aquí los cambia en el documento del cliente, que es
 * justo por lo que viven en un solo sitio y no repartidos por la pantalla y la acción.
 *
 * ## El hueco para el motor (§3 del diseño)
 *
 * Las tres nacen **vacías de selección** y se arman a mano. El motor de IA que propone la
 * mejor variante de cada ranura **no entra en este encargo**, y lo que se construye aquí
 * es el sitio donde va a escribir: `armarTarifas` crea las filas y una propuesta
 * automática llenaría después la elección inicial de cada una.
 *
 * ⚠️ El motor **propone, nunca decide** (§3.1). Por eso la tarifa nace vacía y no con una
 * elección por defecto: una combinación que aparece elegida sin que nadie la eligiera es
 * indistinguible de una revisada, y el candado de `va_en_propuesta` dejaría de significar
 * algo.
 */

/**
 * Los tres segmentos, en el orden en que se le presentan al cliente.
 *
 * Decisión de Mauricio del 2026-09-21: *«segmento es cada una de las tres opciones que se
 * le proponen al cliente»*. El tipo de viajero NO es el segmento: entra como contexto del
 * motor, no como eje de la propuesta.
 */
import {
  etiquetaDeRanura,
  grupoDeInstancia,
  mismaRanura,
  resolverRanura,
} from './ranuras-pantallazo'

export const NOMBRES_TARIFA = ['Económica', 'Recomendada', 'Premium'] as const

export type NombreTarifa = (typeof NOMBRES_TARIFA)[number]

/**
 * La llave con la que se reconoce una tarifa ya creada: sin tildes ni mayúsculas.
 *
 * ⚠️ Sin normalizar las tildes, una tarifa que alguien guardó como «Economica» no se
 * reconocería y `armarTarifas` crearía una segunda — dos filas para el mismo segmento,
 * con precios distintos, y ninguna forma de saber cuál es la buena. El nombre es texto
 * libre desde el paso anterior (T6) y hay que suponer que se va a escribir de varias
 * maneras.
 */
export function claveTarifa(nombre: string | null | undefined): string {
  return (nombre ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/**
 * Cuáles de las tres faltan por crear, dado lo que ya existe en la cotización.
 *
 * Devuelve los nombres **en el orden del catálogo**, no en el de llegada: si falta la
 * Económica y la Premium, se crean en ese orden y la tabla las lista como el cliente las
 * va a leer.
 *
 * ⚠️ NO borra ni renombra lo que ya está. Una cotización que venía del enumerado
 * cartesiano conserva sus filas: perder el nombre y la marca de algo que alguien ya
 * revisó, para dejar la tabla prolija, es exactamente el trabajo que este motor viene a
 * quitar, no a repetir.
 */
export function tarifasQueFaltan(
  nombresExistentes: readonly (string | null | undefined)[],
): NombreTarifa[] {
  const ya = new Set(nombresExistentes.map(claveTarifa).filter(k => k !== ''))
  return NOMBRES_TARIFA.filter(n => !ya.has(claveTarifa(n)))
}

/**
 * ¿Esta fila es una de las tres tarifas con nombre?
 *
 * Se usa para poder decir en pantalla cuáles son las que van al cliente y cuáles son
 * combinaciones sueltas que quedaron de antes.
 */
export function esTarifaConNombre(nombre: string | null | undefined): boolean {
  const k = claveTarifa(nombre)
  return k !== '' && NOMBRES_TARIFA.some(n => claveTarifa(n) === k)
}

// ── La Recomendada manda el documento (decisión de Mauricio, 2026-09-22) ─────

/**
 * ¿Esta fila es la tarifa llamada «Recomendada»? Con la misma llave que reconoce las
 * tres (`claveTarifa`): «Recomendada», «RECOMENDADA» y «Recomendáda» cuentan igual;
 * «La recomendada» no, porque ya no se llama así.
 */
export function esRecomendada(nombre: string | null | undefined): boolean {
  return claveTarifa(nombre) === claveTarifa('Recomendada')
}

/** Lo mínimo de una tarifa para decidir cuál manda. `FilaItinerario` lo cumple. */
export interface TarifaParaRegla {
  id: string
  nombre: string | null
  orden: number
  vaEnPropuesta: boolean
}

/**
 * La tarifa Recomendada de la cotización, y si hay más de una.
 *
 * Con dos filas llamadas «Recomendada» no hay una respuesta honesta a «cuál es»: la
 * regla no elige por su cuenta (sería decidir el total del documento por el `orden`) y
 * quien pregunta trata `repetida` como un error que alguien tiene que resolver.
 */
export function recomendadaDe<T extends TarifaParaRegla>(filas: readonly T[]): { fila: T | null; repetida: boolean } {
  const suyas = filas.filter(f => esRecomendada(f.nombre))
  if (suyas.length > 1) return { fila: null, repetida: true }
  return { fila: suyas[0] ?? null, repetida: false }
}

/**
 * Qué tarifa manda sobre `cotizaciones.valor_total`, el TOTAL del PDF y la leyenda
 * «corresponde a la opción recomendada»: la Recomendada, **sin que nadie la elija**.
 *
 * Hasta el 2026-09-22 la principal se marcaba a mano (`es_principal`) y nada la obligaba
 * a ser la Recomendada: con la Económica marcada, el documento decía «el total
 * corresponde a la opción recomendada» y el TOTAL era el de la Económica. Ahora la
 * columna `es_principal` ya no decide nada; la decide esta regla, sobre el nombre.
 *
 * Solo si **va en la propuesta** (T5 del diseño): un total que sale de una tarifa que el
 * cliente no va a ver es peor que no tener principal. Sin principal, `valor_total` cae
 * a lo de siempre —cada ranura una vez, por supuesto— y «Enviar» se rechaza
 * (`motivoSinRecomendada`).
 */
export function idDelPrincipal(filas: readonly TarifaParaRegla[]): string | null {
  if (filas.length === 0) return null
  const { fila } = recomendadaDe(filas)
  return fila && fila.vaEnPropuesta ? fila.id : null
}

/**
 * Por qué una cotización con tarifas no puede salir al cliente por la regla de la
 * Recomendada. `null` = puede (o no tiene tarifas: la lista plana sigue como hoy).
 *
 * «Tiene tarifas» es tener AL MENOS UNA fila de tarifa, marcada o no: con las tres
 * armadas y ninguna marcada, el documento imprimiría un total tomado por supuesto en
 * vez del de la Recomendada, que es justo lo que esta regla existe para impedir.
 */
export function motivoSinRecomendada(filas: readonly TarifaParaRegla[]): string | null {
  if (filas.length === 0) return null
  const { fila, repetida } = recomendadaDe(filas)
  if (repetida) {
    return 'Hay más de una tarifa llamada «Recomendada»: el documento no sabe de cuál sacar el total. Deja una sola con ese nombre.'
  }
  if (!fila) {
    return 'La cotización tiene tarifas pero ninguna se llama «Recomendada», y el total del documento sale de ella. Créala («Crear Recomendada») o devuélvele el nombre.'
  }
  if (!fila.vaEnPropuesta) {
    return 'La tarifa Recomendada no está marcada «va en propuesta», y el total del documento sale de ella. Márcala para poder enviar.'
  }
  return null
}

/**
 * ¿Renombrar esta tarifa deja dos con el mismo nombre de las tres? Devuelve el motivo
 * del rechazo, o `null` si el nombre es libre.
 *
 * Solo cuidan los TRES nombres: dos «Opción» sueltas no rompen nada, dos «Recomendada»
 * dejan el documento sin saber de cuál sale el total, y dos «Económica» hacen que
 * `armarTarifas` crea que falta la Premium.
 */
export function choqueDeNombreDeTarifa(
  nombreNuevo: string,
  idPropio: string,
  filas: readonly { id: string; nombre: string | null }[],
): string | null {
  if (!esTarifaConNombre(nombreNuevo)) return null
  const clave = claveTarifa(nombreNuevo)
  const otra = filas.find(f => f.id !== idPropio && claveTarifa(f.nombre) === clave)
  if (!otra) return null
  const canonico = NOMBRES_TARIFA.find(n => claveTarifa(n) === clave) ?? nombreNuevo.trim()
  return `Ya hay una tarifa llamada «${canonico}». Dos con el mismo nombre dejan el documento sin saber cuál es cuál.`
}

// ── Renombrar una ranura ─────────────────────────────────────────────────────

export type Renombre =
  | { ok: true; grupo: string }
  | { ok: false; motivo: 'no_es_ranura' | 'choca'; detalle: string }

/**
 * A qué `items.grupo` pasa una ranura al ponerle nombre, o por qué no se puede.
 *
 * Vive aparte de la server action porque es **la decisión**, y la decisión es la que
 * tiene que poder verse fallar en una prueba. Lo que la acción hace después —escribir el
 * grupo en todas las líneas de esa ranura— es mecánico.
 *
 * ⚠️⚠️ El peligro que ataca: renombrar la ranura y renombrar UNA línea se parecen, y no
 * son lo mismo. Si el grupo de una sola variante cambia, la ranura de dos se parte en dos
 * ranuras de una, **las dos pasan a sumar** y el total sube sin que nada falle. Por eso la
 * acción mueve todas las líneas; por eso esto rechaza el choque en vez de resolverlo solo
 * (fundir dos ranuras es el error inverso: lo que sumaba pasa a competir y el precio baja);
 * y por eso el ORDINAL no se toca.
 */
export function renombreDeRanura(
  grupoActual: string,
  nombre: string,
  gruposEnUso: readonly (string | null | undefined)[],
): Renombre {
  const actual = grupoActual.trim()
  const instancia = resolverRanura(actual)
  if (instancia === null) {
    return {
      ok: false,
      motivo: 'no_es_ranura',
      detalle: `«${actual}» no es una ranura del catálogo: su nombre se edita en el grupo de la línea`,
    }
  }

  const nuevo = grupoDeInstancia(instancia.definicion, {
    numero: instancia.numero,
    nombre,
  })

  const choca = gruposEnUso.some(g => {
    const limpio = (g ?? '').trim()
    return limpio !== '' && !mismaRanura(limpio, actual) && mismaRanura(limpio, nuevo)
  })
  if (choca) {
    return {
      ok: false,
      motivo: 'choca',
      detalle:
        `Ya hay otra ranura llamada «${etiquetaDeRanura(nuevo)}». Se fundirían en una y ` +
        `dejarían de sumar por separado.`,
    }
  }

  return { ok: true, grupo: nuevo }
}
