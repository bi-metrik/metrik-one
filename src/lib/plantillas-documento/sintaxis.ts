/**
 * Sintaxis de las plantillas editables de documentos (DJ, Relación de facturas…).
 *
 * Es CERRADA a propósito: un texto con unas pocas marcas, no un lenguaje de plantillas.
 * Todo lo que no está en esta lista es un error al guardar.
 *
 * Por renglón (bloques):
 *   `# Texto`            título grande          `## Texto`   subtítulo
 *   `| a | b |`          fila de tabla (renglones seguidos = una tabla)
 *                        `|! texto` celda de etiqueta (sombreada), `|# texto` fila de título
 *   `---`                raya de firma
 *   renglón en blanco    separa párrafos; un salto de renglón simple se respeta
 *   Una etiqueta SOLA en su renglón abre o cierra un bloque:
 *   `{{#centrado}}` `{{#justificado}}` `{{#derecha}}`  … `{{/centrado}}` etc.
 *   `{{#junto}}` … `{{/junto}}`        lo de adentro no se parte entre hojas
 *   `{{#firmas}}` … `{{/firmas}}`      se repite por titular, en columnas
 *   `{{#si condición}}` … `{{sino}}` … `{{/si}}`
 *   `{{#cada titular}}` … `{{/cada}}`
 *
 * Dentro del texto (en línea):
 *   `**negrita**`, `{{variable}}`, `{{#si condición}}…{{sino}}…{{/si}}`,
 *   `{{#cada titular}}…{{/cada}}`.
 *
 * Este módulo solo arma el árbol y reporta errores de ESTRUCTURA. Qué variables y
 * condiciones existen lo decide el catálogo (`validar.ts`).
 */

export type Inline =
  | { t: 'texto'; v: string }
  | { t: 'salto' }
  | { t: 'var'; nombre: string; linea: number }
  | { t: 'negrita'; hijos: Inline[] }
  | { t: 'si'; cond: string; linea: number; si: Inline[]; sino: Inline[] }
  | { t: 'cada'; de: string; linea: number; hijos: Inline[] }

export type TipoCelda = 'titulo' | 'etiqueta' | 'valor'
export interface Celda { tipo: TipoCelda; hijos: Inline[] }

export type Alineacion = 'centrado' | 'justificado' | 'derecha'

export type Bloque =
  | { t: 'parrafo'; linea: number; hijos: Inline[] }
  | { t: 'titulo'; nivel: 1 | 2; linea: number; hijos: Inline[] }
  | { t: 'tabla'; linea: number; filas: Celda[][] }
  | { t: 'linea_firma'; linea: number }
  | { t: 'alineado'; alin: Alineacion; linea: number; hijos: Bloque[] }
  | { t: 'junto'; linea: number; hijos: Bloque[] }
  | { t: 'firmas'; linea: number; hijos: Bloque[] }
  | { t: 'si'; cond: string; linea: number; si: Bloque[]; sino: Bloque[] }
  | { t: 'cada'; de: string; linea: number; hijos: Bloque[] }

export interface ErrorPlantilla {
  /** Renglón (1 = el primero). */
  linea: number
  mensaje: string
}

export interface Documento { bloques: Bloque[] }

/** Tope del contenido: una DJ son ~5.000 caracteres. */
export const MAX_CARACTERES = 50_000

const ALINEACIONES: Alineacion[] = ['centrado', 'justificado', 'derecha']
const BLOQUES_SOLOS = ['centrado', 'justificado', 'derecha', 'junto', 'firmas'] as const
/** Una condición o variable: minúsculas, números, guion bajo y un punto (`titular.nombre`). */
const NOMBRE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/

const ETIQUETA_SOLA = /^\{\{\s*([^{}]*?)\s*\}\}$/

type Etiqueta =
  | { k: 'abre'; nombre: string; arg: string }
  | { k: 'sino' }
  | { k: 'cierra'; nombre: string }
  | { k: 'var'; nombre: string }
  | { k: 'mala'; texto: string }

function leerEtiqueta(dentro: string): Etiqueta {
  const s = dentro.trim()
  if (s === 'sino') return { k: 'sino' }
  if (s.startsWith('#')) {
    const [nombre, ...resto] = s.slice(1).trim().split(/\s+/)
    return { k: 'abre', nombre: nombre ?? '', arg: resto.join(' ') }
  }
  if (s.startsWith('/')) return { k: 'cierra', nombre: s.slice(1).trim() }
  if (NOMBRE.test(s)) return { k: 'var', nombre: s }
  return { k: 'mala', texto: s }
}

function nombreDeBloque(b: { t: string; alin?: Alineacion }): string {
  if (b.t === 'alineado') return b.alin ?? ''
  return b.t
}

// ── En línea ────────────────────────────────────────────────────────────────

type MarcoInline =
  | { t: 'raiz'; hijos: Inline[] }
  | { t: 'negrita'; hijos: Inline[]; linea: number }
  | { t: 'si'; nodo: Extract<Inline, { t: 'si' }>; enSino: boolean; linea: number }
  | { t: 'cada'; nodo: Extract<Inline, { t: 'cada' }>; linea: number }

function destino(m: MarcoInline): Inline[] {
  if (m.t === 'si') return m.enSino ? m.nodo.sino : m.nodo.si
  if (m.t === 'cada') return m.nodo.hijos
  return m.hijos
}

/**
 * Texto en línea → nodos. `lineaInicial` es el renglón del primer carácter; cada `\n`
 * del texto avanza uno (un párrafo puede ocupar varios renglones).
 */
export function parsearInline(texto: string, lineaInicial: number, errores: ErrorPlantilla[]): Inline[] {
  const raiz: MarcoInline = { t: 'raiz', hijos: [] }
  const pila: MarcoInline[] = [raiz]
  const re = /\*\*|\{\{([^{}]*)\}\}|\{\{|\}\}/g
  let ultimo = 0
  const lineaEn = (i: number) => lineaInicial + (texto.slice(0, i).match(/\n/g)?.length ?? 0)
  const top = () => pila[pila.length - 1]

  const empujarTexto = (s: string) => {
    if (!s) return
    const partes = s.split('\n')
    partes.forEach((p, i) => {
      if (i > 0) destino(top()).push({ t: 'salto' })
      if (p) destino(top()).push({ t: 'texto', v: p })
    })
  }

  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) !== null) {
    empujarTexto(texto.slice(ultimo, m.index))
    ultimo = m.index + m[0].length
    const linea = lineaEn(m.index)
    if (m[0] === '**') {
      const t = top()
      if (t.t === 'negrita') {
        pila.pop()
        destino(top()).push({ t: 'negrita', hijos: t.hijos })
      } else {
        pila.push({ t: 'negrita', hijos: [], linea })
      }
      continue
    }
    if (m[0] === '{{' || m[0] === '}}') {
      errores.push({ linea, mensaje: `Llave suelta «${m[0]}»: las etiquetas van completas, como {{variable}}.` })
      continue
    }
    const et = leerEtiqueta(m[1] ?? '')
    switch (et.k) {
      case 'var':
        destino(top()).push({ t: 'var', nombre: et.nombre, linea })
        break
      case 'mala':
        errores.push({ linea, mensaje: `Etiqueta no reconocida «{{${et.texto}}}».` })
        break
      case 'abre':
        if (et.nombre === 'si') {
          if (!NOMBRE.test(et.arg)) {
            errores.push({ linea, mensaje: `{{#si}} necesita una condición: {{#si dos_titulares}}.` })
          }
          const nodo: Extract<Inline, { t: 'si' }> = { t: 'si', cond: et.arg, linea, si: [], sino: [] }
          pila.push({ t: 'si', nodo, enSino: false, linea })
        } else if (et.nombre === 'cada') {
          const nodo: Extract<Inline, { t: 'cada' }> = { t: 'cada', de: et.arg, linea, hijos: [] }
          pila.push({ t: 'cada', nodo, linea })
        } else if ((BLOQUES_SOLOS as readonly string[]).includes(et.nombre)) {
          errores.push({ linea, mensaje: `{{#${et.nombre}}} va solo en su renglón.` })
        } else {
          errores.push({ linea, mensaje: `Bloque desconocido «{{#${et.nombre}}}».` })
        }
        break
      case 'sino': {
        const t = top()
        if (t.t === 'negrita') {
          errores.push({ linea, mensaje: 'Cierra la negrita (**) antes de {{sino}}.' })
        } else if (t.t !== 'si') {
          errores.push({ linea, mensaje: '{{sino}} sin un {{#si}} abierto en el mismo párrafo.' })
        } else if (t.enSino) {
          errores.push({ linea, mensaje: 'Un {{#si}} lleva un solo {{sino}}.' })
        } else {
          t.enSino = true
        }
        break
      }
      case 'cierra': {
        const t = top()
        if (t.t === 'negrita') {
          errores.push({ linea, mensaje: `Cierra la negrita (**) antes de {{/${et.nombre}}}.` })
        } else if ((et.nombre === 'si' && t.t === 'si') || (et.nombre === 'cada' && t.t === 'cada')) {
          pila.pop()
          destino(top()).push(t.nodo)
        } else if (et.nombre === 'si' || et.nombre === 'cada') {
          errores.push({ linea, mensaje: `{{/${et.nombre}}} sin su apertura en el mismo párrafo.` })
        } else if ((BLOQUES_SOLOS as readonly string[]).includes(et.nombre)) {
          errores.push({ linea, mensaje: `{{/${et.nombre}}} va solo en su renglón.` })
        } else {
          errores.push({ linea, mensaje: `Cierre desconocido «{{/${et.nombre}}}».` })
        }
        break
      }
    }
  }
  empujarTexto(texto.slice(ultimo))

  // Lo que quedó abierto al final del párrafo.
  while (pila.length > 1) {
    const t = pila.pop()!
    if (t.t === 'negrita') {
      errores.push({ linea: t.linea, mensaje: 'Negrita sin cerrar: falta el segundo **.' })
      destino(top()).push({ t: 'negrita', hijos: t.hijos })
    } else if (t.t !== 'raiz') {
      const nombre = t.t
      errores.push({ linea: t.linea, mensaje: `Falta {{/${nombre}}} en el mismo párrafo.` })
      destino(top()).push(t.nodo)
    }
  }
  return raiz.hijos
}

// ── Bloques ─────────────────────────────────────────────────────────────────

type Contenedor =
  | { t: 'raiz'; hijos: Bloque[] }
  | { t: 'alineado'; alin: Alineacion; linea: number; hijos: Bloque[] }
  | { t: 'junto'; linea: number; hijos: Bloque[] }
  | { t: 'firmas'; linea: number; hijos: Bloque[] }
  | { t: 'si'; cond: string; linea: number; si: Bloque[]; sino: Bloque[]; enSino: boolean }
  | { t: 'cada'; de: string; linea: number; hijos: Bloque[] }

function hijosDe(c: Contenedor): Bloque[] {
  if (c.t === 'si') return c.enSino ? c.sino : c.si
  return c.hijos
}

function aBloque(c: Exclude<Contenedor, { t: 'raiz' }>): Bloque {
  switch (c.t) {
    case 'si': return { t: 'si', cond: c.cond, linea: c.linea, si: c.si, sino: c.sino }
    case 'alineado': return { t: 'alineado', alin: c.alin, linea: c.linea, hijos: c.hijos }
    case 'junto': return { t: 'junto', linea: c.linea, hijos: c.hijos }
    case 'firmas': return { t: 'firmas', linea: c.linea, hijos: c.hijos }
    case 'cada': return { t: 'cada', de: c.de, linea: c.linea, hijos: c.hijos }
  }
}

/** Parte una fila `| a |! b |` en celdas. */
function celdasDeFila(linea: string, n: number, errores: ErrorPlantilla[]): Celda[] {
  let s = linea.trim()
  if (s.endsWith('|') && s.length > 1) s = s.slice(0, -1)
  // `|` dentro de {{…}} no existe (los nombres no lo admiten), así que partir es seguro.
  const crudas = s.split('|').slice(1)
  const celdas: Celda[] = []
  for (const cruda of crudas) {
    let tipo: TipoCelda = 'valor'
    let texto = cruda
    if (texto.startsWith('!')) { tipo = 'etiqueta'; texto = texto.slice(1) }
    else if (texto.startsWith('#')) { tipo = 'titulo'; texto = texto.slice(1) }
    celdas.push({ tipo, hijos: parsearInline(texto.trim(), n, errores) })
  }
  if (celdas.length === 0) errores.push({ linea: n, mensaje: 'Fila de tabla vacía.' })
  if (celdas.some((c) => c.tipo === 'titulo') && celdas.length > 1) {
    errores.push({ linea: n, mensaje: 'La fila de título (|#) lleva una sola celda.' })
  }
  if (celdas.length > 6) errores.push({ linea: n, mensaje: 'Una tabla lleva hasta 6 columnas.' })
  return celdas
}

export function parsearPlantilla(contenido: string): { doc: Documento; errores: ErrorPlantilla[] } {
  const errores: ErrorPlantilla[] = []
  if (contenido.length > MAX_CARACTERES) {
    errores.push({ linea: 1, mensaje: `La plantilla pasa de ${MAX_CARACTERES.toLocaleString('es-CO')} caracteres.` })
  }
  const lineas = contenido.replace(/\r\n?/g, '\n').split('\n')
  const raiz: Contenedor = { t: 'raiz', hijos: [] }
  const pila: Contenedor[] = [raiz]
  const top = () => pila[pila.length - 1]

  let parrafo: { linea: number; textos: string[] } | null = null
  let tabla: Extract<Bloque, { t: 'tabla' }> | null = null

  const cerrarParrafo = () => {
    if (parrafo) {
      const hijos = parsearInline(parrafo.textos.join('\n'), parrafo.linea, errores)
      hijosDe(top()).push({ t: 'parrafo', linea: parrafo.linea, hijos })
      parrafo = null
    }
  }
  const cerrarTodo = () => { cerrarParrafo(); tabla = null }

  lineas.forEach((cruda, i) => {
    const n = i + 1
    const linea = cruda.replace(/\s+$/, '')
    const recortada = linea.trim()

    // ¿Etiqueta de bloque sola en su renglón?
    const sola = ETIQUETA_SOLA.exec(recortada)
    if (sola) {
      const et = leerEtiqueta(sola[1] ?? '')
      if (et.k === 'abre' || et.k === 'sino' || et.k === 'cierra') {
        cerrarTodo()
        if (et.k === 'abre') {
          if ((ALINEACIONES as string[]).includes(et.nombre)) {
            pila.push({ t: 'alineado', alin: et.nombre as Alineacion, linea: n, hijos: [] })
          } else if (et.nombre === 'junto') {
            pila.push({ t: 'junto', linea: n, hijos: [] })
          } else if (et.nombre === 'firmas') {
            pila.push({ t: 'firmas', linea: n, hijos: [] })
          } else if (et.nombre === 'si') {
            if (!NOMBRE.test(et.arg)) errores.push({ linea: n, mensaje: '{{#si}} necesita una condición: {{#si dos_titulares}}.' })
            pila.push({ t: 'si', cond: et.arg, linea: n, si: [], sino: [], enSino: false })
          } else if (et.nombre === 'cada') {
            pila.push({ t: 'cada', de: et.arg, linea: n, hijos: [] })
          } else {
            errores.push({ linea: n, mensaje: `Bloque desconocido «{{#${et.nombre}}}».` })
          }
        } else if (et.k === 'sino') {
          const t = top()
          if (t.t !== 'si') errores.push({ linea: n, mensaje: '{{sino}} sin un {{#si}} abierto.' })
          else if (t.enSino) errores.push({ linea: n, mensaje: 'Un {{#si}} lleva un solo {{sino}}.' })
          else t.enSino = true
        } else {
          const t = top()
          const esperado = t.t === 'raiz' ? null : nombreDeBloque(t)
          if (t.t === 'raiz') {
            errores.push({ linea: n, mensaje: `{{/${et.nombre}}} sin su apertura.` })
          } else if (esperado !== et.nombre) {
            errores.push({ linea: n, mensaje: `Se esperaba {{/${esperado}}} (abierto en el renglón ${t.linea}) y llegó {{/${et.nombre}}}.` })
          } else {
            pila.pop()
            hijosDe(top()).push(aBloque(t))
          }
        }
        return
      }
    }

    if (recortada === '') { cerrarTodo(); return }

    if (/^#{1,2}\s/.test(recortada)) {
      cerrarTodo()
      const nivel = recortada.startsWith('## ') ? 2 : 1
      const texto = recortada.replace(/^#{1,2}\s+/, '')
      hijosDe(top()).push({ t: 'titulo', nivel, linea: n, hijos: parsearInline(texto, n, errores) })
      return
    }

    if (recortada.startsWith('|')) {
      cerrarParrafo()
      if (!tabla) {
        tabla = { t: 'tabla', linea: n, filas: [] }
        hijosDe(top()).push(tabla)
      }
      tabla.filas.push(celdasDeFila(recortada, n, errores))
      return
    }

    if (/^-{3,}$/.test(recortada)) {
      cerrarTodo()
      hijosDe(top()).push({ t: 'linea_firma', linea: n })
      return
    }

    tabla = null
    if (!parrafo) parrafo = { linea: n, textos: [] }
    parrafo.textos.push(recortada)
  })
  cerrarTodo()

  while (pila.length > 1) {
    const t = pila.pop() as Exclude<Contenedor, { t: 'raiz' }>
    errores.push({ linea: t.linea, mensaje: `Falta cerrar {{/${nombreDeBloque(t)}}} (abierto en el renglón ${t.linea}).` })
    hijosDe(top()).push(aBloque(t))
  }

  return { doc: { bloques: raiz.hijos }, errores }
}
