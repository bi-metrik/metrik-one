// ============================================================
// Actas — que parte de la transcripcion entra al acta, y de que negocio es
//
// El acta llega al correo del cliente. Todo lo que sobre en ella es un riesgo,
// no un detalle de estilo: la transcripcion del 2026-08-18 con AFI abre con
// varios minutos de audio grabado ANTES de que entrara la contraparte, en los
// que Mauricio habla de plata, de familia y de terceros. Eso no puede salir.
//
// Aqui viven las dos reglas que si se pueden decidir sin criterio:
//
//  1. Preludio. Mientras solo ha hablado una persona, todavia no hay reunion.
//     Se recorta el monologo inicial cuando es largo. No se compara contra el
//     nombre del anfitrion a proposito: quien abrio la sala cambia, y la regla
//     "un monologo no es una reunion" no depende de eso.
//
//  2. Negocio. Mauricio acordo mencionar en voz alta el negocio del que se
//     habla, para poder partir una reunion que toque dos. Esta capa NO decide:
//     cuenta menciones y entrega evidencia. La decision es del generador,
//     porque el conteo crudo se equivoca: en esa misma reunion "valida" suena
//     mas veces que "alma" y la reunion es de ALMA — "valida" salio como
//     herramienta de comparacion y una vez como verbo. Partir un acta de mas
//     manda al cliente una reunion que no tuvo; eso es peor que no partir.
//
// El descarte de lo que no viene al caso DENTRO de la conversacion (la charla
// del bebe, la convencion, la persona de la que hablaron al pasar) no es
// lexico y no se resuelve aqui: es instruccion del prompt del generador.
// ============================================================

import { normalizar, type NegocioDirectorio } from './cliente'

export interface Intervencion {
  hablante: string
  texto: string
}

const RE_INTERVENCION = /^([^:\n]{2,60}):\s+(\S.*)$/

export function parseIntervenciones(cuerpo: string): Intervencion[] {
  const out: Intervencion[] = []
  for (const linea of cuerpo.split('\n')) {
    const m = linea.match(RE_INTERVENCION)
    if (m) out.push({ hablante: m[1].trim(), texto: m[2].trim() })
  }
  return out
}

export interface Preludio {
  /** Intervenciones que si son de la reunion. */
  intervenciones: Intervencion[]
  /** Cuantas se recortaron por venir antes del segundo hablante. */
  recortadas: number
}

/**
 * Abrir la sala y saludar tambien es un monologo de una o dos frases, y ese si
 * es parte de la reunion. Por debajo de este piso no se recorta nada. El
 * preludio real del 2026-08-18 fueron 18 intervenciones seguidas.
 */
export const PRELUDIO_MINIMO_INTERVENCIONES = 5

/**
 * Recorta el monologo inicial: todo lo dicho antes de que hable alguien
 * distinto del primer hablante, cuando ese monologo pasa del piso. Si nunca
 * habla un segundo, no recorta nada — una reunion de una sola voz ya la
 * descarta `seleccion.ts` por vacia, y devolverla en blanco aqui solo
 * escondería el motivo.
 */
export function recortarPreludio(
  intervenciones: Intervencion[],
  minimo = PRELUDIO_MINIMO_INTERVENCIONES,
): Preludio {
  if (intervenciones.length === 0) return { intervenciones, recortadas: 0 }

  const primero = intervenciones[0].hablante
  const corte = intervenciones.findIndex((i) => i.hablante !== primero)
  if (corte < minimo) return { intervenciones, recortadas: 0 }

  return { intervenciones: intervenciones.slice(corte), recortadas: corte }
}

// ── Evidencia de negocio ─────────────────────────────────────────────────────

/** Palabras que no distinguen un negocio de otro dentro de la misma empresa. */
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'via', 'por', 'para', 'con', 'en'])
/** Debajo de esto una palabra empata por casualidad ("one", "afi", "sas"). */
const MINIMO_ALIAS = 4

/**
 * Palabras del nombre de un negocio que NO aparecen en el nombre de ningun
 * otro negocio candidato ni en el de la empresa. Si un negocio se queda sin
 * ninguna, no es detectable por mencion y solo puede resolverse por otra via.
 */
export function aliasDistintivos(
  negocios: NegocioDirectorio[],
  nombreEmpresa: string,
): Map<string, string[]> {
  const dela = (nombre: string) =>
    normalizar(nombre)
      .split(' ')
      .filter((t) => t.length >= MINIMO_ALIAS && !VACIAS.has(t))

  const empresa = new Set(dela(nombreEmpresa))
  const tokens = new Map(negocios.map((n) => [n.id, dela(n.nombre)]))

  const veces = new Map<string, number>()
  for (const lista of tokens.values()) {
    for (const t of new Set(lista)) veces.set(t, (veces.get(t) ?? 0) + 1)
  }

  return new Map(
    negocios.map((n) => [
      n.id,
      [...new Set(tokens.get(n.id) ?? [])].filter((t) => !empresa.has(t) && veces.get(t) === 1),
    ]),
  )
}

export interface EvidenciaNegocio {
  negocio: NegocioDirectorio
  /** Alias distintivos que suenan en la transcripcion. */
  aciertos: string[]
  /** Cuantas veces suenan en total. Es evidencia, no un veredicto. */
  menciones: number
}

/**
 * Cuenta menciones de los alias distintivos de cada negocio sobre el texto ya
 * normalizado. Devuelve solo los que suenan al menos una vez, de mas a menos.
 */
export function evidenciaDeNegocio(
  texto: string,
  negocios: NegocioDirectorio[],
  nombreEmpresa: string,
): EvidenciaNegocio[] {
  const alias = aliasDistintivos(negocios, nombreEmpresa)
  const plano = ` ${normalizar(texto)} `

  const cuenta = (aguja: string) => {
    let n = 0
    let i = plano.indexOf(` ${aguja} `)
    while (i !== -1) {
      n++
      i = plano.indexOf(` ${aguja} `, i + 1)
    }
    return n
  }

  return negocios
    .map((negocio) => {
      const aciertos: string[] = []
      let menciones = 0
      for (const a of alias.get(negocio.id) ?? []) {
        const n = cuenta(a)
        if (n > 0) {
          aciertos.push(a)
          menciones += n
        }
      }
      return { negocio, aciertos, menciones }
    })
    .filter((e) => e.menciones > 0)
    .sort((a, b) => b.menciones - a.menciones)
}
