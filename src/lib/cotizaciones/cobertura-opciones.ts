/**
 * ¿Las opciones de una misma ranura cubren lo mismo? (§4.3 del diseño de usabilidad)
 *
 * ## El daño que para
 *
 * Alejandra cargó Avianca (Bogotá–San Andrés–Bogotá) como titular y Satena (San
 * Andrés–Providencia) como alternativa **de la misma ranura**. El motor entiende lo que
 * el modelo dice: dos líneas con el mismo `grupo` COMPITEN y solo una suma
 * (`itinerarios.ts`). Se quedó con Avianca, y el PDF salió sin el tramo a Providencia:
 * el precio incompleto y el documento impecable. Eso es lo peor que puede pasar aquí,
 * un error que no se ve.
 *
 * Desde las ranuras múltiples (2026-09-21) ese segundo tramo **sí tiene dónde ir**: es
 * otra ranura de vuelo («Vuelo 2»), que SUMA en vez de competir. El aviso sigue haciendo
 * falta porque la vía equivocada sigue existiendo —cargarlo como opción es un clic— y lo
 * único que lo delata es comparar lo que cubre cada una. Lo que cambió es la salida que
 * el texto ofrece: antes «va como componente aparte», ahora «va como ranura aparte».
 *
 * ⚠️ El aviso compara DENTRO de una ranura, nunca entre ranuras. Vuelo 1 y Vuelo 2 cubren
 * tramos distintos **a propósito**: avisar ahí saldría en cada viaje con escala y
 * enseñaría a ignorarlo. Lo garantiza `ranurasConAlternativas`, que agrupa por el texto
 * del `grupo` — «vuelo» y «vuelo 2» son dos entradas distintas.
 *
 * ## Avisa, NO bloquea
 *
 * Dos opciones que cubren cosas distintas pueden ser legítimas —un vuelo directo contra
 * uno con escala que además hace otra ciudad— y nadie puede juzgarlo desde aquí. Por eso
 * esto no es un gate: es una frase que aparece en el editor y al generar el PDF.
 *
 * ## La cobertura se LEE de la captura, nunca del nombre de la línea
 *
 * El origen y el destino salen de `items.tarifa_pax.casillas[*].identidad`, que es lo
 * que el modelo leyó **de la imagen** (`lectura-casilla.ts` deja fuera lo que se tomó
 * del ítem, a propósito). Deducirlos del nombre de la línea —«AVIANCA BOG–PUJ»— sería
 * inventar cobertura a partir de texto libre que cualquiera puede reescribir, y este
 * aviso existe justo para no afirmar de más.
 *
 * Consecuencias declaradas, y las dos son deliberadas:
 *
 *  · Una línea **sin ninguna lectura** no participa en la comparación. No es «ilegible»:
 *    es trabajo a medias. Si participara, agregar una opción dispararía el aviso en el
 *    mismo clic que la crea, y un aviso que sale siempre no lo lee nadie.
 *  · Una línea **con lectura y sin trayecto legible** sí participa, y el aviso dice que
 *    NO SE PUDO COMPARAR. Decir «cubren lo mismo» sin haberlo mirado es la afirmación
 *    que este archivo no puede hacer.
 *
 * ## Solo el vuelo declara cobertura hoy
 *
 * «Cubrir menos» es una idea con sentido en un vuelo (tramos) y no lo tiene en las demás
 * ranuras con el modelo de hoy: dos hoteles alternativos en la misma ranura son dos
 * hoteles, no medio alojamiento cada uno, y la partición de habitaciones es §4.4, otro
 * frente. Una ranura que no declara cobertura no produce aviso — ni de discrepancia ni
 * de «no se pudo comparar»—, que es lo correcto: no hay nada que comparar, no es que
 * haya fallado la lectura.
 */

import { ranurasConAlternativas, type ItemConGrupo } from './itinerarios'
import { etiquetaDeRanura, ranuraDeGrupo } from './ranuras-pantallazo'
import { leerTarifaPax, type TarifaPax } from './tarifa-pasajero'

/** Lo mínimo que hace falta de una línea para saber qué cubre. */
export interface LineaParaCobertura extends ItemConGrupo {
  nombre?: string | null
  /** `items.tarifa_pax` tal como llega de la base. Ausente = línea sin lectura. */
  tarifa_pax?: unknown
}

/** Un trayecto cubierto por la opción, con el texto tal como se leyó. */
export interface Tramo {
  desde: string
  hasta: string
}

export type Cobertura =
  /** La ranura de esta línea no tiene noción de cobertura (hotel, tour, traslado). */
  | { estado: 'no_aplica' }
  /** Nadie ha cargado una captura todavía: no hay nada que leer ni que afirmar. */
  | { estado: 'sin_cargar' }
  /** Hay captura y el trayecto no se pudo leer. */
  | { estado: 'ilegible' }
  | { estado: 'leida'; tramos: Tramo[] }

/** Las ranuras que saben decir qué cubre una opción. Ver la cabecera. */
const RANURAS_CON_COBERTURA: readonly string[] = ['vuelo_detalle']

/** Las casillas se recorren en este orden: la primera que traiga el dato manda. */
const CASILLAS: readonly ('grupo_completo' | 'sin_infantes' | 'solo_adultos')[] = [
  'grupo_completo',
  'sin_infantes',
  'solo_adultos',
]

/**
 * Un campo de identidad, buscado en las casillas que la línea tenga leídas.
 *
 * Las tres casillas son capturas del MISMO producto (CC1 lo exige al aceptarlas), así
 * que cualquiera sirve; se recorren en orden estable para que dos corridas no lean
 * cosas distintas.
 */
function campoLeido(tarifa: TarifaPax, slug: string): string | null {
  for (const clave of CASILLAS) {
    const valor = tarifa.casillas?.[clave]?.identidad?.[slug]
    if (typeof valor === 'string' && valor.trim() !== '') return valor.trim()
  }
  return null
}

function hayLectura(tarifa: TarifaPax): boolean {
  return CASILLAS.some(c => tarifa.casillas?.[c] !== undefined)
}

/**
 * Qué cubre una línea.
 *
 * El regreso se deriva de `fecha_regreso`, que la ranura declara `null` cuando el viaje
 * es solo ida. Si la pantalla mostraba el regreso y no se leyó, el aviso sale igual —y
 * está bien: pide comprobar, no descuenta nada. El error caro es el contrario.
 */
export function coberturaDeLinea(linea: LineaParaCobertura): Cobertura {
  const ranura = ranuraDeGrupo(linea.grupo)
  if (ranura === null || !RANURAS_CON_COBERTURA.includes(ranura.slug)) return { estado: 'no_aplica' }

  const tarifa = leerTarifaPax(linea.tarifa_pax)
  if (!hayLectura(tarifa)) return { estado: 'sin_cargar' }

  const origen = campoLeido(tarifa, 'origen')
  const destino = campoLeido(tarifa, 'destino')
  if (origen === null || destino === null) return { estado: 'ilegible' }

  const tramos: Tramo[] = [{ desde: origen, hasta: destino }]
  if (campoLeido(tarifa, 'fecha_regreso') !== null) tramos.push({ desde: destino, hasta: origen })
  return { estado: 'leida', tramos }
}

/** Un tramo, como se le dice a una persona. */
export function textoDeTramo(t: Tramo): string {
  return `${t.desde}–${t.hasta}`
}

/**
 * La llave con la que se comparan dos tramos: sin tildes, sin mayúsculas, sin signos.
 *
 * ⚠️ La comparación es EXACTA sobre el texto normalizado: «BOG» y «Bogotá» no coinciden
 * aunque sean la misma ciudad, y eso hace saltar el aviso entre dos capturas escritas en
 * formatos distintos. Es deliberado y es el lado seguro: el aviso nombra lo que cubre
 * cada opción, así que quien lo lee ve «BOG» y «Bogotá» y lo resuelve de un vistazo.
 * Emparejarlos con reglas de parecido (prefijos, códigos IATA sin tabla) ahorraría ese
 * aviso y a cambio CALLARÍA el caso en que de verdad cubren cosas distintas — que es el
 * error silencioso que esto existe para matar.
 */
function claveTramo(t: Tramo): string {
  const k = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  return `${k(t.desde)}>${k(t.hasta)}`
}

function claveCobertura(tramos: Tramo[]): string {
  return [...tramos.map(claveTramo)].sort().join('|')
}

/** Una opción de la ranura, con lo que cubre ya resuelto. */
export interface OpcionCubierta {
  id: string
  nombre: string
  /** Los tramos, ya legibles. Vacío cuando no se pudieron leer. */
  cubre: string[]
  legible: boolean
}

export interface AvisoCobertura {
  grupo: string
  /**
   * Cómo se llama la ranura de cara a quien cotiza: «Vuelo», «Vuelo 2 · San Andrés a
   * Providencia».
   *
   * ⚠️ Es la etiqueta de la INSTANCIA, no el tipo. Con dos ranuras de vuelo en la misma
   * cotización, decir «las opciones de vuelo» deja sin saber en cuál de las dos está el
   * problema, que es justo lo que este aviso viene a que se pueda revisar.
   */
  ranura: string
  /**
   * `difieren`: las opciones no cubren lo mismo, y se nombra qué cubre cada una.
   * `no_comparable`: de alguna no se pudo leer el trayecto, así que no se afirma nada.
   */
  motivo: 'difieren' | 'no_comparable'
  opciones: OpcionCubierta[]
  /**
   * La frase, armada aquí.
   *
   * ⚠️ Una sola redacción para las dos superficies (el banner del editor y el aviso al
   * generar el PDF). Escrita dos veces, la pantalla y el documento dirían cosas distintas
   * del mismo problema — que es la trampa que este repo ya pagó con el copy que describía
   * un cálculo que todavía no existía.
   */
  texto: string
}

function nombreDe(linea: LineaParaCobertura): string {
  const n = (linea.nombre ?? '').trim()
  return n === '' ? 'Sin nombre' : n
}

function listaConY(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? ''
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/**
 * Los avisos de cobertura de una cotización. Vacío = todo en orden, o nada que comparar.
 *
 * ⚠️ Quién compite en cada ranura lo decide `ranurasConAlternativas`, el mismo helper que
 * usa el total. Reimplementarlo aquí dejaría el aviso mirando un juego de líneas distinto
 * del que de verdad va a descartar una: el aviso hablaría de una opción que el total ya
 * no considera, o callaría sobre la que sí.
 */
export function avisosDeCobertura(lineas: LineaParaCobertura[]): AvisoCobertura[] {
  const porId = new Map(lineas.map(l => [l.id, l]))
  const avisos: AvisoCobertura[] = []

  for (const ranura of ranurasConAlternativas(lineas)) {
    const def = ranuraDeGrupo(ranura.grupo)
    if (def === null || !RANURAS_CON_COBERTURA.includes(def.slug)) continue
    // La INSTANCIA, no el tipo: «Vuelo 2 · San Andrés a Providencia».
    const etiqueta = etiquetaDeRanura(ranura.grupo)

    const participan = ranura.candidatos
      .map(id => porId.get(id))
      .filter((l): l is LineaParaCobertura => l !== undefined)
      .map(l => ({ linea: l, cobertura: coberturaDeLinea(l) }))
      // Una línea que nadie ha cargado no es evidencia de nada.
      .filter(c => c.cobertura.estado === 'ilegible' || c.cobertura.estado === 'leida')

    if (participan.length < 2) continue

    const opciones: OpcionCubierta[] = participan.map(c => ({
      id: c.linea.id,
      nombre: nombreDe(c.linea),
      cubre: c.cobertura.estado === 'leida' ? c.cobertura.tramos.map(textoDeTramo) : [],
      legible: c.cobertura.estado === 'leida',
    }))

    const ilegibles = opciones.filter(o => !o.legible)
    if (ilegibles.length > 0) {
      const cuales = listaConY(ilegibles.map(o => `«${o.nombre}»`))
      avisos.push({
        grupo: ranura.grupo,
        ranura: etiqueta,
        motivo: 'no_comparable',
        opciones,
        texto:
          `No se pudo comparar qué cubre cada opción de «${etiqueta}»: de ${cuales} no se leyó el ` +
          `trayecto (origen y destino). Compruébalo antes de imprimir, porque solo una opción ` +
          `entra al precio final.`,
      })
      continue
    }

    const claves = new Set(
      participan.map(c => (c.cobertura.estado === 'leida' ? claveCobertura(c.cobertura.tramos) : '')),
    )
    if (claves.size <= 1) continue

    const detalle = opciones
      .map(o => `«${o.nombre}» cubre ${listaConY(o.cubre)}`)
      .join('; ')
    avisos.push({
      grupo: ranura.grupo,
      ranura: etiqueta,
      motivo: 'difieren',
      opciones,
      texto:
        `Las opciones de «${etiqueta}» no cubren lo mismo: ${detalle}. Solo una entra al precio ` +
        `final y las demás quedan para comparar. Si es otro tramo del mismo viaje, va como ` +
        `ranura aparte (botón «+ Vuelo»), no como opción.`,
    })
  }

  return avisos
}
