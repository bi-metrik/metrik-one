/**
 * La identificación del Cliente como llave blanda del autoservicio SECOP.
 *
 * Spec §0-ter («el RUT como llave de control de abuso»): la llave es **el número**, no el PDF, y un
 * número queda tomado por el primero que lo use. §0-quater la matiza: sirve, pero no es la defensa.
 *
 * ## ⚠️ El DV no se adivina. Nunca.
 *
 * La tentación obvia es normalizar «900123456-7» y «9001234567» al mismo número quitando el último
 * dígito cuando resulta ser el DV. `src/lib/dian/nit.ts` (líneas 16-34) tiene medido exactamente
 * ese defecto: adivinar el DV acierta por azar ~1 de cada 11 veces sobre cualquier identificador
 * limpio y entonces borra un dígito REAL. Sobre cédulas mutiló 14 de 290 RUT y uno se radicó así
 * ante la DIAN; sobre NIT de empresa limpios recortó el de Bancolombia.
 *
 * Aquí el daño sería peor que allá: la llave es única, así que un número mal recortado **le bloquea
 * el registro a otra empresa** cuyo NIT real coincide con el recorte. Por eso:
 *
 *   * si la persona escribe el separador (`900123456-7`, `900123456 7`), se toma lo de la izquierda;
 *   * si no lo escribe, se toman los dígitos **tal como vinieron**.
 *
 * Consecuencia aceptada y consciente: quien escriba el DV pegado y sin separador («9001234567»)
 * abre un espacio distinto del que abriría escribiéndolo con guion. Es un hueco de la llave BLANDA,
 * y §0-ter.3 ya dice que no se sobre-ingeniería: el costo de cerrarlo adivinando es mutilar números
 * buenos. Lo que sí cierra el hueco sin adivinar es el formulario: pedir el número y el DV en dos
 * campos. Eso es diseño (Noor), no una regla de aquí.
 */

/** El separador entre número y DV, en cualquiera de las formas en que la gente lo escribe. */
const SEPARADOR_DV = /[-\s.,/]/

export type ProblemaIdentificacion = 'vacia' | 'corta' | 'larga' | 'sin_digitos'

export const LARGO_MIN_ID = 5
export const LARGO_MAX_ID = 15

/**
 * Número de identificación escrito por una persona → la llave que se guarda e indexa.
 *
 * Devuelve `''` si no queda nada. Quita puntos de miles ANTES de buscar el separador de DV, porque
 * «900.123.456-7» trae los dos y el punto no separa el DV.
 */
export function normalizarIdentificacion(raw: string | null | undefined): string {
  if (!raw) return ''
  const limpio = raw.trim().replace(/\./g, '')
  // El DV va siempre al final, así que se corta por el ÚLTIMO separador y solo si lo que queda a la
  // derecha es un único dígito: en «12 345 678» (cédula con espacios) no hay DV que cortar.
  const partes = limpio.split(SEPARADOR_DV).filter((p) => p !== '')
  const ultima = partes.at(-1)
  const cuerpo = partes.length > 1 && ultima?.length === 1 ? partes.slice(0, -1).join('') : partes.join('')
  return cuerpo.replace(/\D/g, '')
}

/** `null` = sirve como llave. Los topes son de cordura, no de validación DIAN. */
export function problemaDeIdentificacion(raw: string | null | undefined): ProblemaIdentificacion | null {
  if (!raw || !raw.trim()) return 'vacia'
  const n = normalizarIdentificacion(raw)
  if (!n) return 'sin_digitos'
  if (n.length < LARGO_MIN_ID) return 'corta'
  if (n.length > LARGO_MAX_ID) return 'larga'
  return null
}

export function textoProblemaIdentificacion(p: ProblemaIdentificacion): string {
  switch (p) {
    case 'vacia':
      return 'Escribe tu NIT o número de cédula.'
    case 'sin_digitos':
      return 'El número de identificación se escribe con dígitos.'
    case 'corta':
      return 'Ese número es muy corto para ser un NIT o una cédula.'
    case 'larga':
      return 'Ese número es muy largo para ser un NIT o una cédula.'
  }
}
