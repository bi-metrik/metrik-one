/**
 * Qué imagen trae un pegado (Ctrl+V) en el selector de fotos (Mauricio, 2026-10-16). Cuando la web
 * del hotel no deja leer sus fotos, la salida es abrirla, «Copiar imagen» y pegarla aquí.
 *
 * Lo que deja cada navegador al copiar una imagen:
 *   · Chrome, Edge, Safari y Firefox («Copiar imagen»): un archivo `image/png` (y a veces además
 *     `text/html` con el `<img src>`). El archivo manda.
 *   · Copiar un pedazo de página que contiene la foto, o algunos navegadores viejos: solo
 *     `text/html` con `<img src="https://…">` (o un `data:` URL). Esa URL se baja en el servidor.
 * Un texto pegado (una URL en la casilla de la página, por ejemplo) NO es una imagen: se deja pasar.
 * PURO: recibe lo que el navegador entrega en `clipboardData`.
 */

export type Pegado =
  | { tipo: 'archivo'; archivo: Blob }
  | { tipo: 'data'; dataUrl: string }
  | { tipo: 'url'; url: string }

/** Lo que se lee de `ClipboardEvent.clipboardData` (un `DataTransfer`). */
export interface Portapapeles {
  files?: ArrayLike<Blob & { type: string }> | null
  items?: ArrayLike<{ kind: string; type: string; getAsFile: () => (Blob & { type: string }) | null }> | null
  getData: (formato: string) => string
}

const DATA_IMAGEN = /^data:image\/(png|jpe?g|webp|avif);base64,[a-z0-9+/=\s]+$/i

function desescapar(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").trim()
}

/** El texto visible de un HTML (sin etiquetas, scripts ni estilos). */
function textoVisible(html: string): string {
  return desescapar(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' '),
  ).replace(/\s+/g, ' ')
}

/**
 * La primera imagen del HTML del portapapeles, si el pegado ES una imagen: el HTML trae un
 * `<img src>` utilizable y el texto plano está vacío o es la misma URL (un párrafo con una foto en
 * medio es un texto, no una imagen). PURO.
 */
export function imagenDeHtml(html: string, textoPlano: string): Pegado | null {
  const img = /<img\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+))/i.exec(html)
  if (!img) return null
  const src = desescapar(img[2] ?? img[3] ?? img[4] ?? '')
  const plano = textoPlano.trim()
  if (plano && plano !== src && textoVisible(html).length > 0) return null
  if (DATA_IMAGEN.test(src)) return { tipo: 'data', dataUrl: src }
  try {
    const u = new URL(src)
    return u.protocol === 'https:' ? { tipo: 'url', url: u.toString() } : null
  } catch {
    return null
  }
}

/** La imagen que trae el pegado, o `null` si no trae ninguna (se deja pegar el texto). PURO. */
export function imagenDelPortapapeles(dt: Portapapeles | null | undefined): Pegado | null {
  if (!dt) return null
  for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith('image/')) return { tipo: 'archivo', archivo: f }
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) return { tipo: 'archivo', archivo: f }
    }
  }
  const html = dt.getData('text/html')
  return html ? imagenDeHtml(html, dt.getData('text/plain')) : null
}

/** Un `data:` URL de imagen como Blob (en el navegador). */
export function blobDeDataUrl(dataUrl: string): Blob | null {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl.replace(/\s+/g, ''))
  if (!m) return null
  try {
    const bin = atob(m[2])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: m[1].toLowerCase() })
  } catch {
    return null
  }
}
