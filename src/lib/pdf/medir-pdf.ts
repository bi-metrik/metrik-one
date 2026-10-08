/**
 * Dónde terminó de verdad el contenido de cada hoja de un PDF de `@react-pdf`, leído del
 * binario ya renderizado (§4.11, punto 6, del sistema visual de Trappvel: «la medición se
 * hace sobre el PDF ya renderizado, no estimando alturas»).
 *
 * Recorre los flujos de contenido EN EL ORDEN DE LAS HOJAS (el del árbol `/Pages`, no el del
 * binario: `textoDelPDF` los junta en el orden del archivo, que no es el de las páginas) y
 * sigue la matriz de transformación (`q`, `Q`, `cm`) para ubicar cada cosa que se pinta:
 * rectángulos (`re`), trazos rellenos o delineados, texto (`Tm` + `Tf`) e imágenes (`Do`).
 *
 * Devuelve, por hoja, el borde inferior del último elemento dentro de la franja de contenido
 * (sin el encabezado ni el pie fijos), y la posición de las MARCAS: rectángulos de 0,5 pt con
 * un color reservado que la plantilla pone al inicio de cada sección para saber en qué hoja
 * empezó cada una. Las coordenadas van en puntos desde el borde SUPERIOR de la hoja.
 */
import { inflateSync } from 'node:zlib'

type Matriz = [number, number, number, number, number, number]

const IDENTIDAD: Matriz = [1, 0, 0, 1, 0, 0]

const por = (m: Matriz, c: Matriz): Matriz => [
  m[0] * c[0] + m[1] * c[2], m[0] * c[1] + m[1] * c[3],
  m[2] * c[0] + m[3] * c[2], m[2] * c[1] + m[3] * c[3],
  m[4] * c[0] + m[5] * c[2] + c[4], m[4] * c[1] + m[5] * c[3] + c[5],
]

const aplicar = (m: Matriz, x: number, y: number): [number, number] => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]

/** El color reservado de una marca: rojo 255, verde 254 y el número de la marca en el azul. */
export const ROJO_MARCA = 255
export const VERDE_MARCA = 254

/** El color CSS de la marca número `id` (0 a 255). */
export function colorDeMarca(id: number): string {
  return `rgb(${ROJO_MARCA}, ${VERDE_MARCA}, ${id})`
}

export interface HojaMedida {
  /** Borde superior del primer elemento de contenido, en pt desde arriba. `null` si la hoja está vacía. */
  primero: number | null
  /** Borde inferior del último elemento de contenido, en pt desde arriba. `null` si la hoja está vacía. */
  fondo: number | null
  /**
   * Cada corrida de texto de la franja de contenido, con su línea base y su tamaño de letra,
   * en el orden en que se pinta. Con fuentes estándar el código hexadecimal ES el carácter.
   */
  textos: { texto: string; y: number; tam: number }[]
}

export interface MedidaDelPDF {
  altoHoja: number
  hojas: HojaMedida[]
  /** Hoja (desde 1) y altura de cada marca encontrada, por su número. */
  marcas: Map<number, { hoja: number; y: number }>
}

export interface FranjaDeContenido {
  /** Lo que termina por encima de esta línea es encabezado (barra y logo). */
  arriba: number
  /** Lo que empieza por debajo de esta línea es pie. */
  abajo: number
}

/** El cuerpo de un objeto indirecto `n 0 obj … endobj`, como texto latin1. */
function objeto(pdf: string, n: number): string | null {
  const re = new RegExp(`(?:^|[\\r\\n])${n} 0 obj\\b`)
  const m = re.exec(pdf)
  if (!m) return null
  const fin = pdf.indexOf('endobj', m.index)
  return pdf.slice(m.index, fin === -1 ? undefined : fin)
}

/** Las hojas en orden, cada una con el número de su objeto de contenido. */
function contenidosEnOrden(pdf: string): number[][] {
  // La raíz del árbol: el objeto /Pages que no tiene /Parent.
  const raices = [...pdf.matchAll(/(?:^|[\r\n])(\d+) 0 obj\s*<<([\s\S]*?)endobj/g)]
    .filter(m => /\/Type\s*\/Pages\b/.test(m[2]) && !/\/Parent\b/.test(m[2]))
  const salida: number[][] = []
  const recorrer = (n: number) => {
    const cuerpo = objeto(pdf, n)
    if (!cuerpo) return
    if (/\/Type\s*\/Pages\b/.test(cuerpo)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(cuerpo)
      for (const k of (kids?.[1] ?? '').matchAll(/(\d+)\s+0\s+R/g)) recorrer(Number(k[1]))
      return
    }
    const unico = /\/Contents\s+(\d+)\s+0\s+R/.exec(cuerpo)
    if (unico) { salida.push([Number(unico[1])]); return }
    const varios = /\/Contents\s*\[([^\]]*)\]/.exec(cuerpo)
    salida.push([...(varios?.[1] ?? '').matchAll(/(\d+)\s+0\s+R/g)].map(k => Number(k[1])))
  }
  for (const r of raices) recorrer(Number(r[1]))
  return salida
}

function flujo(buf: Buffer, pdf: string, n: number): string {
  const re = new RegExp(`(?:^|[\\r\\n])${n} 0 obj\\b`)
  const m = re.exec(pdf)
  if (!m) return ''
  const ini = pdf.indexOf('stream', m.index)
  if (ini === -1) return ''
  let inicio = ini + 'stream'.length
  if (buf[inicio] === 0x0d) inicio++
  if (buf[inicio] === 0x0a) inicio++
  const fin = pdf.indexOf('endstream', inicio)
  const crudo = buf.subarray(inicio, fin)
  try { return inflateSync(crudo).toString('latin1') } catch { return crudo.toString('latin1') }
}

/** Separa un flujo de contenido en operandos y operadores. Cadenas y arreglos van enteros. */
function fichas(c: string): string[] {
  const out: string[] = []
  let i = 0
  const n = c.length
  while (i < n) {
    const ch = c[i]
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') { i++; continue }
    if (ch === '[') {
      let prof = 0
      let j = i
      for (; j < n; j++) {
        if (c[j] === '(') { j = finDeCadena(c, j) } else if (c[j] === '[') prof++
        else if (c[j] === ']') { prof--; if (prof === 0) break }
      }
      out.push(c.slice(i, j + 1)); i = j + 1; continue
    }
    if (ch === '(') { const j = finDeCadena(c, i); out.push(c.slice(i, j + 1)); i = j + 1; continue }
    if (ch === '<' && c[i + 1] !== '<') { const j = c.indexOf('>', i); out.push(c.slice(i, j + 1)); i = j + 1; continue }
    let j = i
    while (j < n && !' \n\r\t[(<'.includes(c[j])) j++
    if (j === i) j = i + 1
    out.push(c.slice(i, j)); i = j
  }
  return out
}

function finDeCadena(c: string, desde: number): number {
  let prof = 0
  for (let j = desde; j < c.length; j++) {
    if (c[j] === '\\') { j++; continue }
    if (c[j] === '(') prof++
    else if (c[j] === ')') { prof--; if (prof === 0) return j }
  }
  return c.length - 1
}

const PINTA = new Set(['f', 'F', 'f*', 'S', 's', 'B', 'B*', 'b', 'b*'])

/** Mide un PDF ya renderizado. `franja` separa el contenido del encabezado y el pie fijos. */
export function medirPDF(buf: Buffer, franja: FranjaDeContenido): MedidaDelPDF {
  const pdf = buf.toString('latin1')
  const caja = /\/MediaBox\s*\[\s*[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s*\]/.exec(pdf)
  const H = caja ? Number(caja[1]) : 841.89
  const hojas: HojaMedida[] = []
  const marcas = new Map<number, { hoja: number; y: number }>()

  contenidosEnOrden(pdf).forEach((objs, idx) => {
    const c = objs.map(o => flujo(buf, pdf, o)).join('\n')
    let primero: number | null = null
    let fondo: number | null = null
    const textos: HojaMedida['textos'] = []
    const anotar = (arriba: number, abajo: number) => {
      // Encabezado y pie fijos no cuentan: solo lo que cae en la franja de contenido.
      if (abajo <= franja.arriba || arriba >= franja.abajo) return
      primero = primero === null ? arriba : Math.min(primero, arriba)
      fondo = fondo === null ? abajo : Math.max(fondo, abajo)
    }
    const desdeArriba = (m: Matriz, x: number, y: number) => H - aplicar(m, x, y)[1]

    let ctm: Matriz = IDENTIDAD
    const pila: Matriz[] = []
    let ops: string[] = []
    let relleno: number[] = []
    let camino: number[] = []
    let tm: Matriz = IDENTIDAD
    let tam = 0
    for (const f of fichas(c)) {
      const esNumero = /^-?[\d.]+$/.test(f)
      if (esNumero || f.startsWith('/') || f.startsWith('[') || f.startsWith('(') || f.startsWith('<')) { ops.push(f); continue }
      const nums = ops.map(Number)
      switch (f) {
        case 'q': pila.push(ctm); break
        case 'Q': ctm = pila.pop() ?? IDENTIDAD; break
        case 'cm': ctm = por(nums.slice(-6) as Matriz, ctm); break
        case 'scn': case 'sc': case 'rg': if (nums.length >= 3) relleno = nums.slice(-3); break
        case 're': {
          const [x, y, w, h] = nums.slice(-4)
          const ys = [desdeArriba(ctm, x, y), desdeArriba(ctm, x + w, y + h)]
          const arriba = Math.min(...ys)
          const abajo = Math.max(...ys)
          const esMarca = relleno.length === 3
            && Math.round(relleno[0] * 255) === ROJO_MARCA
            && Math.round(relleno[1] * 255) === VERDE_MARCA
            && Math.abs(w) < 1 && Math.abs(h) < 1
          if (esMarca) {
            const id = Math.round(relleno[2] * 255)
            if (!marcas.has(id)) marcas.set(id, { hoja: idx + 1, y: arriba })
          } else {
            camino.push(arriba, abajo)
          }
          break
        }
        case 'm': case 'l': {
          const [x, y] = nums.slice(-2)
          camino.push(desdeArriba(ctm, x, y))
          break
        }
        case 'c': {
          const v = nums.slice(-6)
          camino.push(desdeArriba(ctm, v[0], v[1]), desdeArriba(ctm, v[2], v[3]), desdeArriba(ctm, v[4], v[5]))
          break
        }
        case 'W': case 'W*': camino = []; break
        case 'n': camino = []; break
        case 'BT': tm = IDENTIDAD; break
        case 'Tm': tm = nums.slice(-6) as Matriz; break
        case 'Tf': tam = nums[nums.length - 1] || tam; break
        case 'TJ': case 'Tj': {
          const linea = desdeArriba(por(tm, ctm), 0, 0)
          // La línea base: el texto sube casi todo su tamaño y baja una cuarta parte.
          anotar(linea - tam * 0.8, linea + tam * 0.25)
          if (linea - tam * 0.8 < franja.abajo && linea + tam * 0.25 > franja.arriba) {
            const texto = (ops[ops.length - 1] ?? '').match(/<([0-9A-Fa-f\s]*)>/g)
              ?.map(h => h.slice(1, -1).replace(/\s+/g, '').match(/../g)?.map(b => String.fromCharCode(parseInt(b, 16))).join('') ?? '')
              .join('') ?? ''
            textos.push({ texto, y: linea, tam })
          }
          break
        }
        case 'Do': {
          const ys = [desdeArriba(ctm, 0, 0), desdeArriba(ctm, 1, 1)]
          anotar(Math.min(...ys), Math.max(...ys))
          break
        }
        default:
          if (PINTA.has(f)) {
            if (camino.length > 0) anotar(Math.min(...camino), Math.max(...camino))
            camino = []
          }
      }
      ops = []
    }
    hojas.push({ primero, fondo, textos })
  })

  return { altoHoja: H, hojas, marcas }
}
