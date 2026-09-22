/**
 * La categoría del hotel en estrellas: qué cuenta como categoría.
 *
 * Brief del 2026-09-22 (`proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-estrellas-y-campos-editables.md`).
 *
 * ## De dónde sale
 *
 *  · De la captura, cuando la muestra (`detectarEstrellas`, `src/lib/ai/extraer-ranura.ts`).
 *  · De una persona, que la escribe o la corrige en la ficha de la línea (`correcciones.ts`).
 *    Manda sobre la captura, como cualquier otro campo corregido.
 *
 * ⚠️ NO sale de una búsqueda en la web, todavía. El brief la pedía con Gemini y grounding de
 * Google Search, y los términos de ese servicio (Gemini API Additional Terms, sección
 * «Grounding with Google Search») exigen mostrar el resultado JUNTO con sus Search
 * Suggestions a quien hizo la consulta, prohíben modificarlo y solo permiten guardarlo para
 * evaluar la presentación o como historial de chat. Guardar «4 estrellas» en la cotización e
 * imprimirlo en el documento de un tercero choca con las tres cosas. Queda como decisión de
 * Mauricio con Emilio; mientras tanto la ficha ofrece un enlace a una búsqueda normal de
 * Google (`busquedaDeCategoria`) y la persona escribe lo que encuentre.
 *
 * Módulo puro: lo usan el lector, la validación de lo corregido y el documento, así que los
 * tres entienden lo mismo por «categoría».
 */

/** Categoría válida: entero de 1 a 5. Lo demás no es una categoría. */
export function esCategoriaValida(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 5
}

/**
 * Las estrellas que dice un TEXTO, o `null` si el texto no dice una categoría entera.
 *
 * Acepta las formas en que se escribe una categoría: «3», «5*», «4 estrellas»,
 * «Categoría 3», «3 stars», «★★★★». Un número con decimales («4,5», «4.5») devuelve `null`:
 * es media estrella o una nota de reseña, y redondearla sería decidir la categoría por el
 * hotel.
 *
 * ⚠️ Un texto con DOS números distintos («3 o 4 estrellas») también devuelve `null`: no se
 * elige uno.
 */
export function estrellasDesdeTexto(texto: string | null | undefined): number | null {
  const t = (texto ?? '').trim()
  if (t === '') return null
  // Solo glifos de estrella: se cuentan las llenas.
  const soloGlifos = t.replace(/\s+/g, '')
  if (/^[★☆⭐]+$/u.test(soloGlifos)) {
    const llenas = (soloGlifos.match(/[★⭐]/gu) ?? []).length
    return esCategoriaValida(llenas) ? llenas : null
  }
  // Un decimal en cualquier parte descarta el texto entero.
  if (/\d\s*[.,]\s*\d/.test(t)) return null
  const numeros = [...new Set((t.match(/\d+/g) ?? []).map(Number))]
  if (numeros.length !== 1) return null
  const n = numeros[0]
  return esCategoriaValida(n) ? n : null
}

/**
 * Una búsqueda NORMAL de Google para que una persona averigüe la categoría del hotel.
 *
 * Es un enlace, no una consulta desde el servidor: lo abre quien cotiza en su navegador, lee
 * lo que encuentre y escribe la categoría a mano. Así el dato queda con origen «persona» y
 * no hay resultado de una máquina guardado en la cotización. `null` sin nombre de hotel: no
 * hay nada que buscar.
 */
export function busquedaDeCategoria(hotel: string | null | undefined, ciudad: string | null | undefined): string | null {
  const h = (hotel ?? '').trim()
  if (h === '') return null
  const q = [h, (ciudad ?? '').trim(), 'categoría estrellas'].filter(Boolean).join(' ')
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}
