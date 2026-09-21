/**
 * Control humano de transcripción a ciegas del NIT, antes de generar un formulario DIAN.
 *
 * Un NIT mal extraído llega a la DIAN sin revisión. El barrido de los 342 RUT de SOENA
 * (2026-09-21, banco en `proyectos/soena/ve/qa/extraccion-rut-2026-09-21/`) encontró tres
 * casos en producción —V0216, V0382, V0446— y midió que **ningún control automático de
 * los que existen hoy los ve**:
 *
 *  - Las tres parejas NIT/DV eran consistentes por módulo 11. El DV no es control.
 *  - En V0446 el dígito de más estaba en `nit` y en `numero_identificacion` a la vez,
 *    porque salen de la misma lectura. El cruce entre campos no es control.
 *  - Los tres traían `confidence: 0.98`. La confianza del modelo no es control.
 *  - En V0446 un operador ya había corregido el DV a mano en el formulario sin notar el
 *    7 repetido en el NIT. **Mirar el número en pantalla no es control.**
 *
 * Lo único que los encontró fue leer la casilla 5 del documento por segunda vez, de forma
 * independiente. Por eso esto es una **transcripción a ciegas** y no un «confirmo»: el
 * operador teclea el número mirando el RUT y el servidor compara contra lo guardado. Un
 * checkbox no habría atrapado V0446 — de hecho, el operador ya había mirado ese número.
 *
 * ## La confirmación es del NEGOCIO, y es un CONJUNTO de NIT
 *
 * Decisión de Mauricio (2026-09-21): una sola confirmación sirve para los cuatro bloques
 * de 010/1668 del negocio. **Cuatro repeticiones del mismo acto son fatiga, y la fatiga
 * entrena a teclear sin mirar el documento** — o sea que el control se vuelve decorativo
 * por la misma razón por la que lo sería enmascarar la casilla con CSS.
 *
 * Pero no se guarda UN nit: se guarda un **mapa de NIT confirmados**. Hoy cada bloque
 * puede imprimir un número distinto (un override en la casilla, o un 1668 que lea de otra
 * fuente), y con un solo valor confirmar el bloque raro **desconfirmaría a los otros
 * tres**: un ping-pong en el que nunca se pueden generar los cuatro. Con el mapa, cada
 * bloque pregunta por el número que ÉL va a imprimir:
 *
 *  - Los cuatro imprimen lo mismo → una confirmación los cubre a los cuatro.
 *  - Uno imprime otro número → solo ESE pide lo suyo, y al confirmarlo se suma al mapa
 *    sin tocar la entrada que cubre a los demás.
 *  - Cambia el NIT del `rut` → ningún bloque encuentra su número → se cierran los cuatro.
 *
 * ## Dos decisiones que hacen que el control no se pueda vaciar
 *
 * 1. **La confirmación se ata al VALOR, no a la fecha.** La llave del mapa ES el NIT en
 *    dígitos. No hay caducidad que calibrar: si el número que se va a imprimir no está en
 *    el mapa, se pide; si está, alguien lo leyó del documento y eso sigue siendo cierto.
 *
 * 2. **El criterio de qué casilla lleva el NIT es el MISMO que el de la guarda del DV
 *    pegado** (`casillasConNit`, en `./guarda-nit-formulario`). Copiarlo aquí sería una
 *    segunda lista que se desincroniza en cuanto alguien agregue un template: el síntoma
 *    sería un formulario que el DV protege y la transcripción no, o al revés.
 *
 * Puro: quien llama resuelve los valores con `resolverCamposFuente` + overrides, igual que
 * la guarda del DV. Sin acceso a datos.
 */

import { casillasConNit, type CampoFuenteMinimo } from './guarda-nit-formulario'

export type { CampoFuenteMinimo }

/**
 * Clave bajo la que vive el mapa dentro de `negocios.metadata`. Exportada para que el
 * código y cualquier siembra usen el mismo literal en vez de dos copias del string.
 */
export const CLAVE_CONFIRMACION_NIT = 'confirmacion_nit'

/** Una confirmación ya leída. `nit` se DERIVA de la llave del mapa, no se guarda aparte. */
export interface ConfirmacionNit {
  /** El NIT confirmado, en dígitos. Es la llave bajo la que vive. */
  nit: string
  /** `staff.id` de quien tecleó. Puede ser null (siembra, o script sin sesión). */
  por: string | null
  /** Nombre legible, para que el registro se pueda leer sin resolver ids. */
  por_nombre: string | null
  /** ISO de cuándo se confirmó. Informativo: NO decide la vigencia. */
  at: string
}

/** El mapa completo, indexado por NIT en dígitos. */
export type ConfirmacionesNit = Record<string, ConfirmacionNit>

export const MENSAJE_SIN_CONFIRMAR =
  'Antes de generar hay que confirmar el NIT: escribe la casilla 5 del RUT mirando el documento'

export const MENSAJE_OTRO_NIT =
  'El NIT que este formulario va a imprimir no es el que se confirmó: escribe la casilla 5 del RUT mirando el documento'

export const MENSAJE_NIT_AMBIGUO =
  'Este formulario imprime más de un NIT distinto y no se puede confirmar con un solo número: revisa la configuración del bloque'

export const MENSAJE_NO_COINCIDE = 'El número que escribiste no coincide con el NIT guardado'

/**
 * Solo dígitos. El formato (`40.771.100`, `40771100`, `40 771 100`) no es el dato: lo que
 * identifica a una persona ante la DIAN es la secuencia de dígitos. Comparar el texto
 * crudo convertiría un punto de más en un falso «no coincide», y el operador aprendería
 * a ignorar el control.
 */
export function digitosDeNit(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '')
}

/**
 * ¿Los dos valores son el mismo NIT? Un vacío NO coincide con nada, ni con otro vacío:
 * un control que se satisface con la ausencia del dato no es un control.
 */
export function mismoNit(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = digitosDeNit(a)
  const db = digitosDeNit(b)
  return da !== '' && da === db
}

/**
 * Los NIT DISTINTOS que el formulario va a imprimir, en dígitos y sin vacíos.
 *
 * Es una lista y no un valor porque el criterio (`casillasConNit`) admite varias casillas:
 * hoy el 010 y el 1668 tienen una cada uno, las dos desde `rut.nit`, pero un template con
 * dos comparecientes tendría dos. Devolver la lista deja que el llamador decida en vez de
 * que esta función elija una en silencio.
 */
export function nitsDelFormulario(
  template: string,
  campos: CampoFuenteMinimo[],
  datosFinal: Record<string, string | null>,
): string[] {
  const vistos = new Set<string>()
  for (const c of casillasConNit(template, campos)) {
    const d = digitosDeNit(datosFinal[c.slug])
    if (d !== '') vistos.add(d)
  }
  return [...vistos]
}

/**
 * El NIT que ESTE bloque va a imprimir y por tanto hay que confirmar, o null si no aplica.
 *
 * `ambiguo` separa «este formulario no lleva NIT» (y entonces la transcripción no aplica)
 * de «lleva dos NIT distintos» (y entonces una sola confirmación no puede cubrirlos). Los
 * dos casos devuelven `nit: null` y se ven igual desde afuera si no se mira la bandera.
 */
export function nitAConfirmar(
  template: string,
  campos: CampoFuenteMinimo[],
  datosFinal: Record<string, string | null>,
): { nit: string | null; ambiguo: boolean } {
  const nits = nitsDelFormulario(template, campos, datosFinal)
  if (nits.length === 1) return { nit: nits[0], ambiguo: false }
  return { nit: null, ambiguo: nits.length > 1 }
}

/**
 * La confirmación de un NIT concreto dentro del mapa del negocio, o null.
 *
 * Solo el valor decide. Sin fecha de vencimiento: una confirmación de hace tres meses
 * sobre un NIT que no ha cambiado sigue describiendo el mismo acto (alguien leyó ese
 * número en el documento), y el bloque que hoy va a imprimir otro número simplemente no
 * la encuentra.
 */
export function confirmacionDe(
  confirmaciones: ConfirmacionesNit | null | undefined,
  nitEsperado: string | null,
): ConfirmacionNit | null {
  if (!confirmaciones || !nitEsperado) return null
  return confirmaciones[digitosDeNit(nitEsperado)] ?? null
}

/** Por qué este bloque no se puede generar todavía. `null` = se puede. */
export type MotivoFaltaNit = 'ambiguo' | 'sin_confirmar' | 'otro_nit'

/**
 * ¿Por qué falta la confirmación de ESTE bloque? Es el criterio ÚNICO: de aquí salen
 * tanto el mensaje del servidor como el texto que pinta la pantalla.
 *
 * Los tres motivos son distintos a propósito: «nunca se confirmó nada en este negocio»,
 * «hay confirmaciones pero ninguna es de este número» y «el formulario tiene dos NIT»
 * piden tres acciones diferentes, y un solo mensaje genérico obligaría al operador a
 * adivinar cuál de las tres le pasó.
 *
 * `otro_nit` es el que nace con el mapa: alguien confirmó hace un minuto en el formulario
 * de al lado y aquí se le vuelve a pedir. Si la pantalla no dice que **este** bloque
 * imprime OTRO número, esa segunda petición se lee como un defecto del sistema y el
 * operador aprende a teclear sin mirar, que es justo lo que el control existe para evitar.
 *
 * Un formulario SIN NIT (otros templates, o el NIT todavía vacío) pasa sin confirmar: ahí
 * no hay nada que transcribir, y el faltante lo reporta el control de campos faltantes con
 * un mensaje que sí dice qué hacer.
 */
export function motivoFaltaConfirmacionNit(
  template: string,
  campos: CampoFuenteMinimo[],
  datosFinal: Record<string, string | null>,
  confirmaciones: ConfirmacionesNit | null | undefined,
): MotivoFaltaNit | null {
  const { nit, ambiguo } = nitAConfirmar(template, campos, datosFinal)
  if (ambiguo) return 'ambiguo'
  if (nit === null) return null
  if (confirmacionDe(confirmaciones, nit)) return null
  const hayAlguna = Object.keys(confirmaciones ?? {}).length > 0
  return hayAlguna ? 'otro_nit' : 'sin_confirmar'
}

const MENSAJE_POR_MOTIVO: Record<MotivoFaltaNit, string> = {
  ambiguo: MENSAJE_NIT_AMBIGUO,
  otro_nit: MENSAJE_OTRO_NIT,
  sin_confirmar: MENSAJE_SIN_CONFIRMAR,
}

/** El mensaje que ve quien intenta generar sin confirmar, o null si puede generar. */
export function faltaConfirmacionNit(
  template: string,
  campos: CampoFuenteMinimo[],
  datosFinal: Record<string, string | null>,
  confirmaciones: ConfirmacionesNit | null | undefined,
): string | null {
  const motivo = motivoFaltaConfirmacionNit(template, campos, datosFinal, confirmaciones)
  return motivo === null ? null : MENSAJE_POR_MOTIVO[motivo]
}

/**
 * Normaliza `negocios.metadata.confirmacion_nit`, que es jsonb libre, al mapa tipado.
 *
 * **La llave manda.** Se normaliza a dígitos y, si no queda ninguno, la entrada se
 * descarta. Eso hace que un objeto con la forma equivocada —por ejemplo una confirmación
 * suelta `{ nit, por, at }` escrita a mano, cuyas llaves son palabras— se lea como mapa
 * VACÍO y el control retenga, en vez de colarse como confirmación válida. El lado seguro
 * de un control es retener.
 *
 * Un `nit` dentro del valor se ignora: la llave ya lo dice, y tener el dato en dos sitios
 * es tener dos sitios que se pueden contradecir.
 */
export function leerConfirmaciones(raw: unknown): ConfirmacionesNit {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const salida: ConfirmacionesNit = {}
  for (const [llave, valor] of Object.entries(raw as Record<string, unknown>)) {
    const nit = digitosDeNit(llave)
    if (nit === '') continue
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) continue
    const o = valor as Record<string, unknown>
    salida[nit] = {
      nit,
      por: typeof o.por === 'string' ? o.por : null,
      por_nombre: typeof o.por_nombre === 'string' ? o.por_nombre : null,
      at: typeof o.at === 'string' ? o.at : '',
    }
  }
  return salida
}
