/**
 * Extrae una cláusula numerada del texto de unos términos (`## 8. Confidencialidad`).
 *
 * La tarjeta «Confidencialidad» de la pestaña Documentos abre la cláusula 8 del texto aceptado
 * (§5.4): 4D SOFT no firmó un NDA aparte, la confidencialidad vive dentro de los términos
 * (spec v2 D3). Mostrar el texto de la versión ACEPTADA, y no una copia, es lo que hace que lo
 * que se lee sea lo que obliga.
 *
 * Devuelve null si la cláusula no está: una tarjeta vacía se leería como «no hay cláusula de
 * confidencialidad», que es una afirmación.
 */
export function extraerClausula(texto: string, numero: number): string | null {
  const lineas = texto.split(/\r?\n/)
  const esEncabezado = (l: string, n?: number) => {
    const m = /^#{1,6}\s*(\d+)\.\s+\S/.exec(l.trim())
    if (!m) return false
    return n === undefined ? true : Number(m[1]) === n
  }
  const inicio = lineas.findIndex((l) => esEncabezado(l, numero))
  if (inicio < 0) return null
  let fin = lineas.length
  for (let i = inicio + 1; i < lineas.length; i++) {
    if (esEncabezado(lineas[i])) {
      fin = i
      break
    }
  }
  const cuerpo = lineas.slice(inicio, fin).join('\n').trim()
  return cuerpo.length > 0 ? cuerpo : null
}
