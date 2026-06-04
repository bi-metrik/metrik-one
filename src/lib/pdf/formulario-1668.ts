import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib'
import fs from 'fs'
import path from 'path'

// Overlay sobre el PDF oficial de la DIAN (Formato 1668 — Información /
// Constancia de Titularidad de Cuenta Bancaria). El fondo no se modifica:
// solo dibujamos texto en las coordenadas de cada casilla.
// Coordenadas en puntos, origen (0,0) = esquina inferior izquierda.
//
// Calibradas contra el PDF diligenciado de referencia (Diego Tavera) con
// `pdftotext -bbox`: y_pdflib = 792 - yMax_bbox (página 612 x 792, letter).
//
// Las casillas del funcionario autorizado (984-997), el Cód. de seccional y el
// No. de formulario (4) las diligencia el BANCO — no se tocan aquí.

export interface Formulario1668Datos {
  // Titular de la cuenta (fuente: RUT)
  numero_identificacion: string | null // casilla 18 + 1003
  dv: string | null // casilla 6 + 1004
  primer_apellido: string | null // casilla 7
  segundo_apellido: string | null // casilla 8
  primer_nombre: string | null // casilla 9
  otros_nombres: string | null // casilla 10
  razon_social: string | null // casilla 11 (vacío para persona natural)
  // Cuenta bancaria (fuente: Certificación bancaria)
  fecha_expedicion: string | null // casilla 24 (opcional — la puede poner el banco)
  entidad_financiera: string | null // casilla 25
  numero_cuenta: string | null // casilla 26
  tipo_cuenta: string | null // casilla 27
}

export interface Formulario1668Constantes {
  tipo_documento: string // casilla 20 + 1002 — "13" (Cédula de Ciudadanía)
  cod_representacion: string // casilla 1005 — "01"
}

const TEMPLATE_PATH = path.join(process.cwd(), 'src/lib/pdf/templates/formulario-1668-dian.pdf')

type Cell = { x: number; y: number; maxWidth?: number; size?: number }

// ── Sección "Información Cuenta Bancaria" ────────────────────────────────────
// Fila de identificación: valor baseline y ≈ 603 (label_y 614 - 11).
const INFO = {
  tipo_documento: { x: 28, y: 603, maxWidth: 30 },
  numero_identificacion: { x: 62, y: 603, maxWidth: 115 },
  dv: { x: 186, y: 603, maxWidth: 14 },
  primer_apellido: { x: 204, y: 603, maxWidth: 95 },
  segundo_apellido: { x: 304, y: 603, maxWidth: 95 },
  primer_nombre: { x: 404, y: 603, maxWidth: 95 },
  otros_nombres: { x: 504, y: 603, maxWidth: 100 },
  // Razón social (fila y ≈ 579). Vacía para persona natural.
  razon_social: { x: 26, y: 579, maxWidth: 560 },
  // Fecha expedición + Entidad financiera (fila y ≈ 555)
  fecha_expedicion: { x: 26, y: 555, maxWidth: 130 },
  entidad_financiera: { x: 166, y: 555, maxWidth: 400 },
  // No. Cuenta + Tipo de cuenta (fila y ≈ 531)
  numero_cuenta: { x: 26, y: 531, maxWidth: 135 },
  tipo_cuenta: { x: 166, y: 531, maxWidth: 245 },
}

// ── Sección "Firma de quien suscribe el documento" ───────────────────────────
// Labels al pie (1001-1005); los valores van a la DERECHA de cada label.
const FIRMA = {
  nombre: { x: 106, y: 73, maxWidth: 180 }, // 1001 Apellidos y nombres
  tipo_doc: { x: 63, y: 63, maxWidth: 25 }, // 1002 Tipo documento
  identificacion: { x: 145, y: 61, maxWidth: 100 }, // 1003 No. Identif.
  dv: { x: 285, y: 61, maxWidth: 25 }, // 1004 DV
  cod_representacion: { x: 104, y: 51, maxWidth: 40 }, // 1005 Cód. Representación
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(v: string | null | undefined): string {
  if (v == null) return ''
  // pdf-lib StandardFonts (Helvetica / WinAnsiEncoding) soporta el español.
  return String(v).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
}

function drawValue(page: PDFPage, font: PDFFont, value: string | null | undefined, cell: Cell) {
  const text = sanitize(value)
  if (!text) return
  const size = cell.size ?? 9
  const color = rgb(0, 0, 0)

  // Truncar si excede maxWidth (no pisar la casilla siguiente).
  let toDraw = text
  if (cell.maxWidth) {
    while (toDraw.length > 0 && font.widthOfTextAtSize(toDraw, size) > cell.maxWidth) {
      toDraw = toDraw.slice(0, -1)
    }
  }
  page.drawText(toDraw, { x: cell.x, y: cell.y, size, font, color })
}

// Nombre completo del suscriptor: apellidos + nombres (igual que el diligenciado
// de referencia: "TAVERA MONCALEANO DIEGO THOMAS").
function nombreCompleto(d: Formulario1668Datos): string {
  return [d.primer_apellido, d.segundo_apellido, d.primer_nombre, d.otros_nombres]
    .map(v => (v ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

// Fecha de expedición → DD/MM/AAAA. Acepta ISO (YYYY-MM-DD) o ya formateada.
function formatFecha(iso: string | null): string | null {
  if (!iso) return null
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return iso // ya viene en otro formato (DD/MM/AAAA) → tal cual
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function generarFormulario1668(
  datos: Formulario1668Datos,
  constantes: Formulario1668Constantes,
): Promise<Uint8Array> {
  const templateBytes = fs.readFileSync(TEMPLATE_PATH)
  const pdfDoc = await PDFDocument.load(templateBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const page = pdfDoc.getPages()[0]

  // ── Información Cuenta Bancaria ─────────────────────────────────────────────
  drawValue(page, font, constantes.tipo_documento, INFO.tipo_documento)
  drawValue(page, font, datos.numero_identificacion, INFO.numero_identificacion)
  drawValue(page, font, datos.dv, INFO.dv)
  drawValue(page, font, datos.primer_apellido, INFO.primer_apellido)
  drawValue(page, font, datos.segundo_apellido, INFO.segundo_apellido)
  drawValue(page, font, datos.primer_nombre, INFO.primer_nombre)
  drawValue(page, font, datos.otros_nombres, INFO.otros_nombres)
  drawValue(page, font, datos.razon_social, INFO.razon_social)

  drawValue(page, font, formatFecha(datos.fecha_expedicion), INFO.fecha_expedicion)
  drawValue(page, font, datos.entidad_financiera, INFO.entidad_financiera)
  drawValue(page, font, datos.numero_cuenta, INFO.numero_cuenta)
  drawValue(page, font, datos.tipo_cuenta, INFO.tipo_cuenta)

  // ── Firma de quien suscribe (titular) ───────────────────────────────────────
  drawValue(page, font, nombreCompleto(datos), FIRMA.nombre)
  drawValue(page, font, constantes.tipo_documento, FIRMA.tipo_doc)
  drawValue(page, font, datos.numero_identificacion, FIRMA.identificacion)
  drawValue(page, font, datos.dv, FIRMA.dv)
  drawValue(page, font, constantes.cod_representacion, FIRMA.cod_representacion)

  return pdfDoc.save()
}
