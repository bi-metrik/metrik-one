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

/**
 * ¿Tiene forma de celular colombiano? 10 dígitos que empiezan por 3.
 *
 * Ningún documento de identidad de una persona tiene esa forma: la cédula tiene hasta 8
 * dígitos o 10 empezando por 1, el NIT de una sociedad empieza por 8 o 9, y el de una
 * persona natural es su cédula (con el DV pegado da 9 dígitos, no 10).
 *
 * Caso que lo motivó (SOENA, 24-sep): en 5 facturas la extracción puso el TELÉFONO del
 * comprador en el documento (V0027: 3173706682, V0148: 3148328022, …) y el cruce «el RUT
 * está entre los compradores» avisaba en falso. Esos compradores ya están guardados y no
 * se re-extraen, así que se corrige al LEER, no solo al extraer.
 */
export function esCelularColombiano(doc: unknown): boolean {
  return /^3\d{9}$/.test(soloDigitos(doc))
}

/** Los dígitos del documento, o '' si lo que hay es un celular. */
const documentoDe = (s: unknown) => {
  const d = soloDigitos(s)
  return esCelularColombiano(d) ? '' : d
}

/** La lista, en la forma canónica que se guarda. Cadena vacía si no hay nadie. */
export function serializarPersonas(personas: ReadonlyArray<Partial<Persona> | null | undefined>): string {
  return personas
    .map(p => {
      const nombre = String(p?.nombre ?? '').replace(/\s+/g, ' ').trim()
      const documento = documentoDe(p?.documento)
      if (!nombre && !documento) return null
      return documento ? `${nombre} (${documento})`.trim() : nombre
    })
    .filter((s): s is string => !!s)
    .join('; ')
}

/**
 * ¿Es una persona JURÍDICA? Por el documento o por el nombre.
 *
 * - Documento: el NIT de una sociedad tiene 9 dígitos y empieza por 8 o 9 (10 si trae el
 *   dígito de verificación pegado). Las cédulas colombianas tienen hasta 8 dígitos, o 10
 *   empezando por 1, así que no se confunden.
 * - Nombre: termina en una sigla societaria (S.A.S., S.A., LTDA, E.U., S.C.A., S. en C.).
 *
 * Caso que lo motivó (SOENA, V0321 y V0323): los certificados UPME de 2024 salían a la
 * persona natural Y a la sociedad del proyecto (INNVENTOR ELECTRONICS SAS, NIT
 * 901045219). La sociedad no es un segundo titular.
 */
export function esPersonaJuridica(p: { nombre?: unknown; documento?: unknown }): boolean {
  const doc = String(p.documento ?? '').replace(/\D/g, '')
  if ((doc.length === 9 || doc.length === 10) && /^[89]/.test(doc)) return true
  const nombre = ` ${String(p.nombre ?? '').toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim()} `
    .replace(/ S A S $/, ' SAS ')
    .replace(/ S A $/, ' SA ')
  return /\s(SAS|SA|LTDA|EU|SCA|S EN C|SAS BIC)\s$/.test(nombre)
}

/**
 * La lista de vuelta desde el texto guardado (o corregido a mano). Un documento con forma
 * de celular se descarta: la persona queda, sin documento.
 */
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
          documento: documentoDe(entreParentesis[1]),
        }
      }
      // Sin paréntesis: el documento es la última tira de dígitos (con puntos o sin ellos).
      const final = parte.match(/([\d.\s-]{5,})$/)
      if (final && soloDigitos(final[1]).length >= 5) {
        return {
          nombre: parte.slice(0, final.index).replace(/[,:\-–]+\s*$/, '').replace(/\s+/g, ' ').trim(),
          documento: documentoDe(final[1]),
        }
      }
      return { nombre: parte.replace(/\s+/g, ' ').trim(), documento: '' }
    })
}
