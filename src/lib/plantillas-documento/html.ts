/**
 * Plantilla + datos → HTML del documento. PURO: no lee disco ni red, así que corre igual
 * en el servidor (antes de Chromium) y en el navegador (vista previa en vivo). La vista
 * previa y el PDF salen de ESTA función.
 *
 * Seguridad: todo texto —el de la plantilla y el de los datos— se escapa. La plantilla no
 * puede meter etiquetas, estilos ni recursos: lo único que produce marcado es este
 * archivo. Además el documento lleva una CSP sin scripts ni red, y Chromium imprime sin
 * red (`render-chromium.ts`).
 */
import { defDe, type Contexto, type Datos, type TipoPlantilla, type Valores } from './catalogo'
import type { Bloque, Celda, Documento, Inline } from './sintaxis'
import { validarPlantilla } from './validar'

export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface Ambito {
  valores: Valores
  /** Variables y condiciones del titular en curso (`titular.*`). */
  titular: Record<string, string> | null
  indice: number
}

function condicion(nombre: string, a: Ambito): boolean {
  if (nombre === 'titular.es_primero') return a.titular != null && a.indice === 0
  if (nombre === 'titular.es_ultimo') return a.titular != null && a.indice === a.valores.titulares.length - 1
  return a.valores.conds[nombre] === true
}

function variable(nombre: string, a: Ambito): string {
  if (nombre.startsWith('titular.')) return a.titular?.[nombre] ?? ''
  return a.valores.vars[nombre] ?? ''
}

function porTitular<T>(a: Ambito, f: (sub: Ambito) => T): T[] {
  return a.valores.titulares.map((titular, indice) => f({ ...a, titular, indice }))
}

function inline(nodos: Inline[], a: Ambito): string {
  let s = ''
  for (const n of nodos) {
    switch (n.t) {
      case 'texto': s += escaparHtml(n.v); break
      case 'salto': s += '<br>'; break
      case 'var': s += escaparHtml(variable(n.nombre, a)); break
      case 'negrita': s += `<strong>${inline(n.hijos, a)}</strong>`; break
      case 'si': s += inline(condicion(n.cond, a) ? n.si : n.sino, a); break
      case 'cada': s += porTitular(a, (sub) => inline(n.hijos, sub)).join(''); break
    }
  }
  return s
}

/** ¿El HTML en línea tiene algo visible? Un párrafo que quedó vacío por un {{#si}} no deja hueco. */
const vacio = (html: string) => html.replace(/<br>/g, '').replace(/<\/?strong>/g, '').trim() === ''

/** Pesos de columna: las etiquetas más angostas que los valores (la ficha de la Relación). */
function colgroup(filas: Celda[][]): string {
  const n = Math.max(...filas.map((f) => f.length))
  if (n <= 1) return ''
  const modelo = filas.find((f) => f.length === n) ?? []
  const hayEtiquetas = modelo.some((c) => c.tipo === 'etiqueta') && modelo.some((c) => c.tipo === 'valor')
  const pesos = modelo.map((c) => (hayEtiquetas ? (c.tipo === 'etiqueta' ? 19.3 : 30.7) : 1))
  const total = pesos.reduce((x, y) => x + y, 0)
  return `<colgroup>${pesos.map((p) => `<col style="width:${((p / total) * 100).toFixed(2)}%">`).join('')}</colgroup>`
}

function tabla(filas: Celda[][], a: Ambito): string {
  const n = Math.max(...filas.map((f) => f.length))
  const cuerpo = filas
    .map((fila) => {
      const celdas = fila.map((c, i) => {
        const span = i === fila.length - 1 && fila.length < n ? ` colspan="${n - fila.length + 1}"` : ''
        const clase = c.tipo === 'titulo' ? 'c-titulo' : c.tipo === 'etiqueta' ? 'c-etiqueta' : 'c-valor'
        return `<td class="${clase}"${span}>${inline(c.hijos, a)}</td>`
      })
      return `<tr>${celdas.join('')}</tr>`
    })
    .join('')
  return `<table>${colgroup(filas)}<tbody>${cuerpo}</tbody></table>`
}

function bloques(lista: Bloque[], a: Ambito): string {
  let s = ''
  for (const b of lista) {
    switch (b.t) {
      case 'parrafo': {
        const h = inline(b.hijos, a)
        if (!vacio(h)) s += `<p>${h}</p>`
        break
      }
      case 'titulo': {
        const h = inline(b.hijos, a)
        if (!vacio(h)) s += b.nivel === 1 ? `<h1>${h}</h1>` : `<h2>${h}</h2>`
        break
      }
      case 'tabla': s += tabla(b.filas, a); break
      case 'linea_firma': s += '<hr class="raya-firma">'; break
      case 'alineado': s += `<div class="al-${b.alin}">${bloques(b.hijos, a)}</div>`; break
      case 'junto': s += `<div class="junto">${bloques(b.hijos, a)}</div>`; break
      case 'firmas': {
        const cols = porTitular(a, (sub) => `<div class="firma">${bloques(b.hijos, sub)}</div>`)
        s += `<div class="firmas firmas-${cols.length}">${cols.join('')}</div>`
        break
      }
      case 'si': s += bloques(condicion(b.cond, a) ? b.si : b.sino, a); break
      case 'cada': s += porTitular(a, (sub) => bloques(b.hijos, sub)).join(''); break
    }
  }
  return s
}

/** Familia del cuerpo: Liberation Sans (métrica de Helvetica/Arial, la del PDF de @react-pdf). */
export const FAMILIA = `'Liberation Sans', Arial, Helvetica, sans-serif`

function css(tipo: TipoPlantilla): string {
  const p = defDe(tipo).pagina
  return `
@page { size: letter; margin: ${p.margenVertical}pt ${p.margenLateral}pt; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: ${FAMILIA}; font-size: 10pt; line-height: ${p.interlineado}; color: #111827; background: #fff;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.hoja { width: 100%; }
@media screen {
  body { background: #e5e7eb; }
  .hoja { width: 8.5in; min-height: 11in; margin: 0 auto; background: #fff; padding: ${p.margenVertical}pt ${p.margenLateral}pt; }
}
p { margin: 0 0 8pt; orphans: 2; widows: 2; }
h1 { font-size: 13pt; font-weight: 700; margin: 0; line-height: 1.5; }
h2 { font-size: 10pt; font-weight: 700; margin: 0; line-height: 1.5; }
strong { font-weight: 700; }
.al-centrado { text-align: center; margin-bottom: 10pt; }
.al-justificado { text-align: justify; }
.al-derecha { text-align: right; }
.junto { break-inside: avoid; page-break-inside: avoid; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 12pt; break-inside: avoid; page-break-inside: avoid; }
td { border: 1pt solid #C9CFD6; padding: 4pt 5pt; vertical-align: middle; line-height: 1.2; font-size: 9pt; word-wrap: break-word; }
td.c-etiqueta { background: #EEF1F4; font-size: 8pt; font-weight: 700; }
td.c-titulo { background: #2D3B4A; color: #fff; font-size: 9pt; font-weight: 700; padding: 4pt 6pt; }
.firmas { display: flex; justify-content: space-between; break-inside: avoid; page-break-inside: avoid; }
.firma { width: 50%; margin-top: 14pt; }
.firmas-2 .firma { width: 47%; }
.firma p { margin: 0; }
hr.raya-firma { border: 0; border-top: 1pt solid #111827; margin: 28pt 0 2pt; height: 0; }
`
}

/** Política del documento: sin scripts, sin red; solo estilos en línea y datos embebidos. */
const CSP = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:`

export interface ResultadoHtml {
  ok: boolean
  html: string
  errores: string[]
}

/** Cuerpo (sin `<html>`) desde un documento ya validado. */
export function cuerpoDelDocumento(doc: Documento, valores: Valores): string {
  return bloques(doc.bloques, { valores, titular: null, indice: 0 })
}

/**
 * Plantilla + datos → HTML completo. Si la plantilla tiene errores de estructura o de
 * catálogo NO produce documento (`ok: false`): nunca se imprime una plantilla rota.
 */
export function htmlDelDocumento(
  tipo: TipoPlantilla,
  contenido: string,
  datos: Datos,
  ctx: Contexto,
): ResultadoHtml {
  const v = validarPlantilla(tipo, contenido)
  if (v.errores.length > 0) {
    return { ok: false, html: '', errores: v.errores.map((e) => `Renglón ${e.linea}: ${e.mensaje}`) }
  }
  const def = defDe(tipo)
  const valores = def.valores(datos, ctx)
  const html =
    `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<title>${escaparHtml(def.nombre)}</title><style>${css(tipo)}</style></head>` +
    `<body><main class="hoja">${cuerpoDelDocumento(v.doc, valores)}</main></body></html>`
  return { ok: true, html, errores: [] }
}
