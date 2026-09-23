/**
 * Los términos y condiciones de la cotización de viaje (Trappvel): las reglas de la reserva
 * que el asesor revisa en el panel «Texto para el cliente» y que el PDF imprime al cierre,
 * antes de la firma.
 *
 * Decisión de Mauricio (2026-09-23, hallazgos 34 y 35 del ensayo): el cuadro se queda,
 * nace prellenado con las condiciones de siempre y el asesor puede cambiarlas o agregar.
 *
 * ## De dónde sale cada cosa
 *
 * - Lo que se imprime: `cotizaciones.terminos_condiciones`, por cotización (ya existía).
 * - Las condiciones de siempre: `lineas_negocio.config_extra.terminos_base`, por línea, al
 *   lado de `recargo` y `margen`. NO es «Mi negocio → Términos de la propuesta»: ese vive en
 *   el `bloque_configs` de la propuesta de Clarity y no tiene que ver con esta cotización.
 * - El prellenado es una COPIA que se propone al abrir el panel de un borrador sin términos
 *   (`terminosAlAbrir`). Si el texto base cambia después, las cotizaciones ya guardadas no
 *   cambian: el PDF nunca lee el texto base.
 *
 * ## El formato que se escribe
 *
 * Texto plano en un textarea, con la forma que ya usa Trappvel en sus cotizaciones reales
 * (`proyectos/trappvel/clarity/docs/diseno/terminos-base-trappvel.md`):
 *
 *     Condiciones generales
 *     - Las cancelaciones pueden generar penalidades…
 *
 *     Medios de pago
 *     - Consignación o transferencia a nombre de…:
 *       - Banco de Bogotá, cuenta de ahorros 708030895
 *
 * Un renglón suelto seguido de viñetas es un subtítulo; `- ` (o `•`, `*`, `·`, `–`) es una
 * viñeta; con sangría, una viñeta de segundo nivel. Lo demás sale como párrafo, tal cual.
 * Por eso al guardar se respetan los saltos de línea y la sangría: aplanar el texto se
 * comería la sub-lista de cuentas.
 */

/** Tope del texto guardado. Holgado: las condiciones de Trappvel ocupan ~900 caracteres. */
export const LIMITE_TERMINOS = 4000

/**
 * Los términos tal como se guardan: sin espacios al final de cada renglón, sin más de un
 * renglón en blanco seguido, sin renglones en blanco al principio ni al final, con tope.
 * La sangría del comienzo de cada renglón se conserva. `null` si no queda nada.
 */
export function normalizarTerminos(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
  if (!t.trim()) return null
  return t.length > LIMITE_TERMINOS ? t.slice(0, LIMITE_TERMINOS).trimEnd() : t
}

/**
 * Lo que el cuadro de términos muestra al abrir el panel.
 *
 * - Con términos guardados, esos: son de ESTA cotización.
 * - Sin términos, en un borrador, el texto base de la línea como propuesta (`propuesto`):
 *   el asesor lo ve escrito y lo guarda con el resto del bloque. Hasta entonces no está
 *   guardado y el PDF sale sin él; por eso se marca.
 * - Sin términos en una cotización que ya no es borrador, nada: proponer algo que no se
 *   puede guardar haría creer que el documento lo lleva.
 */
export function terminosAlAbrir(p: {
  terminos: string | null
  terminosBase: string | null
  editable: boolean
}): { valor: string; propuesto: boolean } {
  const guardados = normalizarTerminos(p.terminos)
  if (guardados) return { valor: guardados, propuesto: false }
  const base = p.editable ? normalizarTerminos(p.terminosBase) : null
  return base ? { valor: base, propuesto: true } : { valor: '', propuesto: false }
}

// ── Del texto al documento ────────────────────────────────────────────────────

export type BloqueDeTerminos =
  | { tipo: 'subtitulo'; texto: string }
  | { tipo: 'vineta'; nivel: 1 | 2; texto: string }
  | { tipo: 'parrafo'; texto: string }

/** Una viñeta: el marcador y un espacio. Los números («1.») no son viñeta: salen tal cual. */
const VINETA = /^[-*•·‣◦–—]\s+/

/** La sangría de un renglón, en espacios (un tabulador cuenta 4). */
function sangria(linea: string): number {
  const m = /^[ \t]*/.exec(linea)?.[0] ?? ''
  return m.replace(/\t/g, '    ').length
}

/** Un renglón suelto que puede ser subtítulo: corto y sin punto final («Medios de pago:» sí). */
function puedeSerSubtitulo(t: string): boolean {
  return t.length <= 80 && !/[.;,]$/.test(t)
}

/**
 * Los términos en bloques para imprimir. Puro a propósito: aquí se decide qué es subtítulo,
 * qué es viñeta y qué es párrafo, y eso se prueba sin renderizar.
 *
 * - Un renglón con marcador es viñeta; con dos espacios o más de sangría, de segundo nivel.
 * - Un renglón con sangría y SIN marcador, justo debajo de una viñeta, la continúa: es la
 *   misma frase partida a mano.
 * - Un renglón sin marcador ni sangría es subtítulo si lo que sigue es una viñeta y parece
 *   un rótulo (corto, sin punto final; los dos puntos del final se quitan). Si no, párrafo.
 * - Los renglones en blanco solo separan: no imprimen nada.
 */
export function estructurarTerminos(texto: string | null | undefined): BloqueDeTerminos[] {
  const t = normalizarTerminos(texto)
  if (!t) return []
  const lineas = t.split('\n')
  const bloques: BloqueDeTerminos[] = []

  const esVineta = (l: string) => VINETA.test(l.trim())
  const siguienteConTexto = (i: number): string | null => {
    for (let j = i + 1; j < lineas.length; j++) if (lineas[j].trim()) return lineas[j]
    return null
  }

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i]
    const limpia = linea.trim()
    if (!limpia) continue

    if (esVineta(linea)) {
      const textoVineta = limpia.replace(VINETA, '').trim()
      if (textoVineta) bloques.push({ tipo: 'vineta', nivel: sangria(linea) >= 2 ? 2 : 1, texto: textoVineta })
      continue
    }

    const previo = bloques[bloques.length - 1]
    const renglonAnteriorConTexto = i > 0 && lineas[i - 1].trim() !== ''
    if (sangria(linea) >= 2 && previo?.tipo === 'vineta' && renglonAnteriorConTexto) {
      previo.texto = `${previo.texto} ${limpia}`
      continue
    }

    const siguiente = siguienteConTexto(i)
    if (siguiente !== null && esVineta(siguiente) && puedeSerSubtitulo(limpia)) {
      const rotulo = limpia.replace(/:+$/, '').trim()
      if (rotulo) {
        bloques.push({ tipo: 'subtitulo', texto: rotulo })
        continue
      }
    }
    bloques.push({ tipo: 'parrafo', texto: limpia })
  }
  return bloques
}
