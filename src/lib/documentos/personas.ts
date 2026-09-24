/**
 * Una lista de personas (nombre + documento) guardada como TEXTO en un campo extraído.
 *
 * Los campos extraídos de un documento son cadenas (`CampoResultado.value: string`), y la
 * pantalla los muestra y los corrige a mano como texto. Una lista de compradores tiene que
 * vivir en ese mismo molde: si se guardara como arreglo, la corrección manual —que es la
 * salida cuando la IA lee mal— dejaría de funcionar, y cada consumidor de `campos` tendría
 * que aprender un tipo nuevo.
 *
 * Forma canónica: `NOMBRE (documento); NOMBRE (documento)`. Se lee de vuelta con
 * tolerancia, porque una persona la edita: acepta `;` o salto de línea entre personas, y
 * el documento entre paréntesis o como la última tira de dígitos.
 */

export type Persona = { nombre: string; documento: string }

const soloDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

/** La lista, en la forma canónica que se guarda. Cadena vacía si no hay nadie. */
export function serializarPersonas(personas: ReadonlyArray<Partial<Persona> | null | undefined>): string {
  return personas
    .map(p => {
      const nombre = String(p?.nombre ?? '').replace(/\s+/g, ' ').trim()
      const documento = soloDigitos(p?.documento)
      if (!nombre && !documento) return null
      return documento ? `${nombre} (${documento})`.trim() : nombre
    })
    .filter((s): s is string => !!s)
    .join('; ')
}

/** La lista de vuelta desde el texto guardado (o corregido a mano). */
export function parsearPersonas(texto: unknown): Persona[] {
  const s = String(texto ?? '').trim()
  if (!s) return []
  return s
    .split(/[;\n]+/)
    .map(parte => parte.trim())
    .filter(Boolean)
    .map(parte => {
      const entreParentesis = parte.match(/\(([^)]*)\)/)
      if (entreParentesis) {
        return {
          nombre: parte.replace(entreParentesis[0], '').replace(/\s+/g, ' ').trim(),
          documento: soloDigitos(entreParentesis[1]),
        }
      }
      // Sin paréntesis: el documento es la última tira de dígitos (con puntos o sin ellos).
      const final = parte.match(/([\d.\s-]{5,})$/)
      if (final && soloDigitos(final[1]).length >= 5) {
        return {
          nombre: parte.slice(0, final.index).replace(/[,:\-–]+\s*$/, '').replace(/\s+/g, ' ').trim(),
          documento: soloDigitos(final[1]),
        }
      }
      return { nombre: parte.replace(/\s+/g, ' ').trim(), documento: '' }
    })
}
