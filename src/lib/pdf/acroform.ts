import { PDFForm, PDFFont, PDFPage, rgb } from 'pdf-lib'

// Helpers compartidos para construir formularios DIAN como AcroForm EDITABLE.
//
// Idea: las casillas de DATOS VARIABLES (extraídos del RUT/Factura/Certificación,
// y los que cambian según la seccional DIAN) se renderizan como CAMPOS de
// formulario pre-llenados → el operador (Deisy) puede ajustarlos en su lector y
// aplanar al imprimir. Las casillas DETERMINISTAS (concepto 06, periodo
// bimestral, tipo de documento, razón social en blanco) se siguen dibujando con
// `drawFixed` (texto fijo, no editable) para que nadie rompa la validez DIAN.
//
// Coordenadas en puntos, origen (0,0) = esquina inferior izquierda. `cell.y` es
// la baseline donde hoy cae el `drawText` del overlay; el rect del campo se
// posiciona para que el texto pre-llenado quede a esa misma altura.

export type Cell = { x: number; y: number; maxWidth?: number; size?: number }

export function sanitize(v: string | null | undefined): string {
  if (v == null) return ''
  // Helvetica (WinAnsiEncoding) soporta el español; normalizamos comillas/elipsis.
  return String(v)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
}

// Texto fijo NO editable (casillas deterministas). Equivalente al `drawText` que
// usaban los overlays previos.
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

// Offset vertical del rect respecto a la baseline. El texto dentro de un campo
// se asienta con un pequeño padding; bajar el rect ~2.5pt deja el glifo sobre la
// línea de la casilla (equivalente al Y_NUDGE=2 del overlay original).
const RECT_Y_OFFSET = -2.5
const RECT_PADDING_H = 4 // alto extra del rect sobre el tamaño de fuente

// Campo de formulario EDITABLE, pre-llenado. Reutiliza el campo si ya existe un
// `name` igual (mismo dato repetido en varias casillas/páginas) agregándole otro
// widget → editar una casilla actualiza todas las que comparten el dato.
export function addEditableField(
  form: PDFForm,
  font: PDFFont,
  page: PDFPage,
  name: string,
  value: string | null | undefined,
  cell: Cell,
  // Nudge vertical extra del formato (el 010 se calibró con +2pt sobre la
  // baseline; el 1668 con 0). Mantiene el texto editable alineado con el fijo.
  yExtra = 0,
) {
  const size = cell.size ?? 9
  const width = cell.maxWidth ?? 90
  const height = size + RECT_PADDING_H
  const y = cell.y + RECT_Y_OFFSET + yExtra

  const existing = form.getFields().find((f) => f.getName() === name)
  const tf = existing ? form.getTextField(name) : form.createTextField(name)
  // `addToPage` crea el widget + la apariencia (DA) → debe ir ANTES de setText /
  // setFontSize (que requieren un DA existente). Sin backgroundColor ni
  // borderColor el campo es transparente y no tapa el fondo oficial del formato.
  tf.addToPage(page, {
    x: cell.x,
    y,
    width,
    height,
    borderWidth: 0,
    textColor: rgb(0, 0, 0),
    font,
  })
  if (!existing) {
    tf.setFontSize(size)
    tf.setText(sanitize(value))
  }
}
