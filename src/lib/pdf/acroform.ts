import { PDFFont, PDFPage, rgb } from 'pdf-lib'

// Helpers compartidos para ESTAMPAR los formularios DIAN sobre el PDF oficial.
//
// Todo el texto (datos variables + casillas deterministas) se dibuja DIRECTAMENTE
// sobre la página con `drawText`, sin campos de formulario AcroForm. Los campos
// AcroForm quedaban opacos y más altos que el glifo: tapaban las líneas y
// etiquetas del formato oficial y, al aplanar, dejaban cajas blancas encima.
// Estampar texto plano no altera la estructura base del formato, y el PDF sale
// no editable por naturaleza (la edición vive en la plataforma, no en el PDF).
//
// Coordenadas en puntos, origen (0,0) = esquina inferior izquierda. `cell.y` es
// la baseline del texto; `yNudge` es el ajuste vertical de calibración por
// formato (010 = +2pt, 1668 = 0).

export type Cell = { x: number; y: number; maxWidth?: number; size?: number }

export function sanitize(v: string | null | undefined): string {
  if (v == null) return ''
  // Helvetica (WinAnsiEncoding) soporta el español; normalizamos comillas/elipsis.
  return String(v)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
}

// Estampa texto directamente sobre la página (sin campos de formulario). Es la
// ÚNICA vía de dibujado del formulario: no altera la estructura base y el PDF sale
// no editable. Recorta por `maxWidth` para no invadir casillas vecinas.
export function drawFixed(
  page: PDFPage,
  font: PDFFont,
  value: string | null | undefined,
  cell: Cell,
  yNudge = 0,
) {
  const text = sanitize(value)
  if (!text) return
  const size = cell.size ?? 9
  let toDraw = text
  if (cell.maxWidth) {
    while (toDraw.length > 0 && font.widthOfTextAtSize(toDraw, size) > cell.maxWidth) {
      toDraw = toDraw.slice(0, -1)
    }
  }
  page.drawText(toDraw, { x: cell.x, y: cell.y + yNudge, size, font, color: rgb(0, 0, 0) })
}
