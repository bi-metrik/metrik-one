/**
 * Piezas PURAS del motor Chromium: no lanzan navegador ni leen disco, y por eso se
 * prueban con vitest sin nada más.
 *
 * - `incrustarFotos`: el HTML se imprime sin red (ver `render-chromium.ts`), así que toda
 *   foto viaja dentro del documento como data URL.
 * - `cssDeFuentes`: Chromium serverless no trae Inter ni Montserrat. Van embebidas.
 * - `pieDePagina`: el pie con número de página que pinta Chromium en cada hoja.
 */

export interface FuenteEmbebida {
  familia: string
  peso: number
  estilo: 'normal' | 'italic'
  /** woff2 en bruto. */
  datos: Uint8Array
}

const TIPOS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

export function tipoDeImagen(nombre: string): string | null {
  const ext = nombre.toLowerCase().split('.').pop() ?? ''
  return TIPOS[ext] ?? null
}

export function dataUrl(tipo: string, datos: Uint8Array): string {
  return `data:${tipo};base64,${Buffer.from(datos).toString('base64')}`
}

/**
 * Cambia cada `fotos/<archivo>` que aparezca como valor de atributo (`src="fotos/x.jpg"`)
 * o dentro de `url(fotos/x.jpg)` por su data URL. Lo que `leer` no encuentra se deja
 * igual y se informa en `faltantes`: el render sin red lo dejará en blanco, y el ensayo
 * tiene que decirlo en vez de imprimir un hueco callado.
 */
export function incrustarFotos(
  html: string,
  leer: (archivo: string) => Uint8Array | null,
  prefijo = 'fotos/',
): { html: string; faltantes: string[]; incrustadas: number } {
  const cache = new Map<string, string | null>()
  const faltantes = new Set<string>()
  let incrustadas = 0
  const esc = prefijo.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const patron = new RegExp(`(["'(])${esc}([A-Za-z0-9_.-]+)(?=["')])`, 'g')
  const salida = html.replace(patron, (todo, apertura: string, archivo: string) => {
    if (!cache.has(archivo)) {
      const tipo = tipoDeImagen(archivo)
      const datos = tipo ? leer(archivo) : null
      cache.set(archivo, tipo && datos ? dataUrl(tipo, datos) : null)
    }
    const url = cache.get(archivo)
    if (!url) {
      faltantes.add(archivo)
      return todo
    }
    incrustadas++
    return `${apertura}${url}`
  })
  return { html: salida, faltantes: [...faltantes], incrustadas }
}

export function cssDeFuentes(fuentes: FuenteEmbebida[]): string {
  return fuentes
    .map(
      (f) =>
        `@font-face{font-family:'${f.familia}';font-weight:${f.peso};font-style:${f.estilo};` +
        `font-display:block;src:url(${dataUrl('font/woff2', f.datos)}) format('woff2');}`,
    )
    .join('\n')
}

/** Mete un `<style>` justo después de `<head>` (o al principio si no hay `<head>`). */
export function inyectarEstilo(html: string, css: string): string {
  const estilo = `<style>${css}</style>`
  const m = /<head[^>]*>/i.exec(html)
  if (!m) return estilo + html
  const fin = m.index + m[0].length
  return html.slice(0, fin) + estilo + html.slice(fin)
}

function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Pie de cada hoja: a la izquierda los datos de la agencia, a la derecha el código y
 * «n de N». Chromium lo pinta en un contexto aparte, sin las fuentes de la página: por
 * eso lleva su propio `@font-face` (si se le pasa) y un `sans-serif` de respaldo.
 */
export function pieDePagina(opts: {
  izquierda: string
  codigo: string
  colorLinea: string
  fuente?: FuenteEmbebida | null
}): string {
  const ff = opts.fuente ? `<style>${cssDeFuentes([opts.fuente])}</style>` : ''
  const familia = opts.fuente ? `'${opts.fuente.familia}',sans-serif` : 'sans-serif'
  return (
    `${ff}<div style="width:100%;font:7pt ${familia};color:#6a6478;padding:0 13mm;display:flex;` +
    `justify-content:space-between;border-top:0.6mm solid ${escaparHtml(opts.colorLinea)}">` +
    `<span>${escaparHtml(opts.izquierda)}</span>` +
    `<span>${escaparHtml(opts.codigo)} · <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`
  )
}

/** ¿Una petición del navegador puede salir? Solo lo que ya va dentro del documento. */
export function peticionPermitida(url: string): boolean {
  return url.startsWith('data:') || url === 'about:blank' || url.startsWith('blob:')
}
