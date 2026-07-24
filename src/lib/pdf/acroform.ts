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

// Un grupo de celdas contiguas equiespaciadas dentro de una casilla del formato.
// `count` = cuántos caracteres consume; `xStart` = borde IZQUIERDO de la 1ª celda
// del grupo; `pitch` = paso horizontal (ancho de celda). Los grupos se estampan en
// orden, cada carácter centrado en su celda.
export type CellGroup = { count: number; xStart: number; pitch: number }

// Config del estampado por celda. `y` = baseline; `size` = tamaño de fuente.
// Dos modos:
//  - Uniforme: dar `xStart` + `pitch` (celdas equiespaciadas desde xStart).
//  - Por grupos: dar `groups` (año 4 celdas, gap, mes 2, gap, día 2, etc.), cada
//    grupo con su propio xStart/pitch. Cuando hay `groups`, `xStart`/`pitch` se ignoran.
export type CellsConfig = {
  y: number
  size: number
  xStart?: number
  pitch?: number
  groups?: CellGroup[]
}

// Estampa una cadena de caracteres, uno por celda, cada glifo CENTRADO en su celda
// (usa `font.widthOfTextAtSize` por carácter). No altera la estructura del formato;
// misma vía plana que `drawFixed`. Los caracteres que exceden las celdas disponibles
// se descartan (no invaden casillas vecinas).
//
// Centrado por celda: x_glifo = xCeldaIzq + (pitch - anchoGlifo) / 2.
export function drawCells(
  page: PDFPage,
  font: PDFFont,
  chars: string | null | undefined,
  config: CellsConfig,
  yNudge = 0,
) {
  const text = sanitize(chars)
  if (!text) return
  const { y, size } = config
  const yPos = y + yNudge

  const drawGlyph = (ch: string, xCellLeft: number, pitch: number) => {
    const w = font.widthOfTextAtSize(ch, size)
    const x = xCellLeft + (pitch - w) / 2
    page.drawText(ch, { x, y: yPos, size, font, color: rgb(0, 0, 0) })
  }

  if (config.groups && config.groups.length > 0) {
    let idx = 0
    for (const g of config.groups) {
      for (let i = 0; i < g.count && idx < text.length; i++, idx++) {
        drawGlyph(text[idx], g.xStart + i * g.pitch, g.pitch)
      }
    }
    return
  }

  // Modo uniforme.
  const xStart = config.xStart ?? 0
  const pitch = config.pitch ?? 0
  for (let i = 0; i < text.length; i++) {
    drawGlyph(text[i], xStart + i * pitch, pitch)
  }
}
