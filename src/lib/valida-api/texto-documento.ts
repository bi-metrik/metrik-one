/**
 * El `texto_md` de un documento contractual, partido en bloques para pintarlo como texto vivo en la
 * entrada del módulo Valida API. Puro.
 *
 * ## Por qué un lector propio y no una librería de Markdown
 *
 * El texto de los términos es el del PDF firmado, escrito con muy poco Markdown: títulos (`#`,
 * `##`), negritas (`**`), párrafos y, a lo sumo, listas con guion. Una librería completa traería
 * HTML crudo, enlaces y tablas que este texto no usa, y cualquier cosa que se pinte con
 * `dangerouslySetInnerHTML` sobre un texto legal es una superficie que no hace falta abrir. Aquí
 * el resultado son bloques de texto plano que React escapa.
 *
 * ## Lo que NO puede pasar: que se pierda texto
 *
 * Lo que la persona lee es lo que acepta. Un marcado que el lector no entienda se deja tal cual,
 * visible, en vez de descartarse: un `**` sin cerrar sale con sus asteriscos.
 */

export interface Tramo {
  texto: string
  negrita: boolean
}

export type BloqueTexto =
  | { tipo: 'titulo'; nivel: 1 | 2 | 3; tramos: Tramo[] }
  | { tipo: 'parrafo'; tramos: Tramo[] }
  | { tipo: 'lista'; items: Tramo[][] }

/** Parte una línea en tramos normales y en negrita (`**así**`). */
export function tramosDeLinea(linea: string): Tramo[] {
  const tramos: Tramo[] = []
  const negrita = /\*\*(.+?)\*\*/g
  let desde = 0
  for (const m of linea.matchAll(negrita)) {
    const inicio = m.index ?? 0
    if (inicio > desde) tramos.push({ texto: linea.slice(desde, inicio), negrita: false })
    tramos.push({ texto: m[1], negrita: true })
    desde = inicio + m[0].length
  }
  if (desde < linea.length) tramos.push({ texto: linea.slice(desde), negrita: false })
  return tramos
}

const TITULO = /^(#{1,6})\s+(.*)$/
const ITEM = /^\s*[-*]\s+(.*)$/

export function bloquesDeTexto(md: string): BloqueTexto[] {
  const bloques: BloqueTexto[] = []
  let parrafo: string[] = []
  let lista: string[] = []

  const cerrarParrafo = () => {
    if (parrafo.length > 0) bloques.push({ tipo: 'parrafo', tramos: tramosDeLinea(parrafo.join('\n')) })
    parrafo = []
  }
  const cerrarLista = () => {
    if (lista.length > 0) bloques.push({ tipo: 'lista', items: lista.map(tramosDeLinea) })
    lista = []
  }

  for (const cruda of md.replace(/\r\n?/g, '\n').split('\n')) {
    const linea = cruda.trimEnd()
    if (linea.trim() === '') {
      cerrarParrafo()
      cerrarLista()
      continue
    }
    const titulo = TITULO.exec(linea)
    if (titulo) {
      cerrarParrafo()
      cerrarLista()
      const nivel = Math.min(titulo[1].length, 3) as 1 | 2 | 3
      bloques.push({ tipo: 'titulo', nivel, tramos: tramosDeLinea(titulo[2]) })
      continue
    }
    const item = ITEM.exec(linea)
    if (item) {
      cerrarParrafo()
      lista.push(item[1])
      continue
    }
    cerrarLista()
    parrafo.push(linea)
  }
  cerrarParrafo()
  cerrarLista()
  return bloques
}
