import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib'
import fs from 'fs'
import path from 'path'

// Overlay sobre el PDF oficial de la DIAN (Formato 010). El fondo no se
// modifica: solo dibujamos texto en las coordenadas de cada casilla.
// Coordenadas en puntos, origen (0,0) = esquina inferior izquierda.

export interface Formulario010Datos {
  // Datos del solicitante (fuente: RUT)
  nit: string | null
  dv: string | null
  tipo_documento: string | null
  primer_apellido: string | null
  segundo_apellido: string | null
  primer_nombre: string | null
  otros_nombres: string | null
  razon_social: string | null
  direccion_seccional: string | null
  correo_electronico: string | null
  direccion: string | null
  telefono: string | null
  pais: string | null
  departamento: string | null
  municipio: string | null
  // Formas de pago (fuente: Certificación bancaria)
  entidad_financiera: string | null
  numero_cuenta: string | null
  tipo_cuenta: string | null
  // Saldo (fuente: Factura + Certificación UPME)
  valor_solicitado: string | null
  numero_factura: string | null
  fecha_factura: string | null
  // Firma (fuente: RUT — reemplaza CC/Cert. Rep. Legal)
  nombre_suscriptor: string | null
  tipo_doc_suscriptor: string | null
  identificacion_suscriptor: string | null
  dv_suscriptor: string | null
}

export interface Formulario010Constantes {
  // Códigos según tablas del formato 010
  concepto: string // Casilla 2 — "1" (Saldos a favor)
  tipo_solicitud: string // Casilla 44 — "A solicitud de parte"
  tipo_obligacion: string // Casilla 50 — "Impuesto sobre las Ventas"
  concepto_saldo: string // Casilla 51 — "Otros" o lo que aplique
}

const TEMPLATE_PATH = path.join(process.cwd(), 'src/lib/pdf/templates/formulario-010-dian.pdf')

// Cada casilla: coord del valor (baseline del texto en puntos).
// Regla usada: valor = label_y - 16 (caja de 24pt, label arriba, valor debajo).

type Cell = { x: number; y: number; maxWidth?: number; size?: number }

// ── Página 1 (Datos solicitante + Formas de pago + Firma) ────────────────────
const P1 = {
  // Header: Casilla 2 Concepto — label en (33.3, 721.9). Caja pequeña a la
  // derecha del label (tipo 2 dígitos). Valor centrado en esa caja.
  concepto: { x: 76, y: 718 },
  // Datos solicitante (fila y = 615.4, valor baseline ~599)
  tipo_documento: { x: 28, y: 599, maxWidth: 35 },
  nit: { x: 65, y: 599, maxWidth: 100 },
  dv: { x: 173, y: 599, maxWidth: 15 },
  primer_apellido: { x: 198, y: 599, maxWidth: 100 },
  segundo_apellido: { x: 302, y: 599, maxWidth: 100 },
  primer_nombre: { x: 409, y: 599, maxWidth: 95 },
  otros_nombres: { x: 510, y: 599, maxWidth: 85 },
  // Razón social (fila y = 591.4, valor ~575)
  razon_social: { x: 28, y: 575, maxWidth: 560 },
  // Dirección seccional (fila y = 567.4, valor ~551)
  direccion_seccional: { x: 28, y: 551, maxWidth: 280 },
  correo_electronico: { x: 343, y: 551, maxWidth: 240 },
  // Dirección y Teléfono (fila y = 543.4, valor ~527)
  direccion: { x: 28, y: 527, maxWidth: 470 },
  telefono: { x: 509, y: 527, maxWidth: 80 },
  // País / Depto / Municipio (fila y = 519.4, valor ~503)
  pais: { x: 28, y: 503, maxWidth: 160 },
  departamento: { x: 223, y: 503, maxWidth: 160 },
  municipio: { x: 414, y: 503, maxWidth: 155 },
  // Formas de pago
  entidad_financiera: { x: 313, y: 443, maxWidth: 250 },
  numero_cuenta: { x: 28, y: 419, maxWidth: 165 },
  tipo_cuenta: { x: 200, y: 419, maxWidth: 360 },
  tipo_solicitud: { x: 28, y: 395, maxWidth: 255 },
  // Firma de quien suscribe. Labels al PIE del bloque, valores van a la DERECHA
  // de cada label en la misma línea (no hay espacio para ponerlos debajo).
  firma_nombre: { x: 103, y: 145, maxWidth: 185 }, // 1001
  firma_tipo_doc: { x: 72, y: 134, maxWidth: 30 }, // 1002
  firma_identificacion: { x: 172, y: 134, maxWidth: 88 }, // 1003
  firma_dv: { x: 295, y: 134, maxWidth: 20 }, // 1004
  // 1005 (Cod Representación) y 1006 (Organización): EN BLANCO por instrucción
}

// ── Página 2 (Datos solicitante repetidos + Titular saldo + Origen saldo) ────
const P2 = {
  // Fila superior — repite datos solicitante en y=615.4 → valor ~599
  tipo_documento: { x: 28, y: 599, maxWidth: 35 },
  nit: { x: 65, y: 599, maxWidth: 100 },
  dv: { x: 173, y: 599, maxWidth: 15 },
  primer_apellido: { x: 198, y: 599, maxWidth: 100 },
  segundo_apellido: { x: 302, y: 599, maxWidth: 100 },
  primer_nombre: { x: 409, y: 599, maxWidth: 95 },
  otros_nombres: { x: 510, y: 599, maxWidth: 85 },
  razon_social: { x: 28, y: 575, maxWidth: 560 },
  direccion_seccional: { x: 28, y: 551, maxWidth: 560 },
  // Titular del saldo (fila y=519.4 → valor ~503)
  titular_tipo_doc: { x: 28, y: 503, maxWidth: 100 },
  titular_nit: { x: 159, y: 503, maxWidth: 90 },
  titular_dv: { x: 257, y: 503, maxWidth: 20 },
  titular_nombre: { x: 282, y: 503, maxWidth: 310 },
  // Valor + Tipo obligación (y=495.4 → 479)
  valor_solicitado: { x: 28, y: 479, maxWidth: 125 },
  tipo_obligacion: { x: 159, y: 479, maxWidth: 195 },
  // Fila 1 origen saldo (y=471.4 → 455)
  concepto_saldo_1: { x: 43, y: 455, maxWidth: 155 },
  anio_gravable_1: { x: 226, y: 455, maxWidth: 40 },
  periodo_1: { x: 270, y: 455, maxWidth: 35 },
  // 54 No. documento (y=471.4 → 455) — opcional, vacío por defecto
  numero_factura_1: { x: 448, y: 458, maxWidth: 135 },
  // 56/57 No diligenciar para IVA
  // 58 Fecha documento (y=450 → 434)
  fecha_factura_1: { x: 393, y: 434, maxWidth: 70 },
  // 59 Valor solicitado por origen (y=447.4 → 431)
  valor_origen_1: { x: 471, y: 431, maxWidth: 115 },
  // 60/61/62/63 responsable (y=426 → 407): usa el mismo NIT y razón social del titular
  resp_tipo_doc_1: { x: 43, y: 407, maxWidth: 100 },
  resp_nit_1: { x: 171, y: 407, maxWidth: 105 },
  resp_dv_1: { x: 284, y: 407, maxWidth: 20 },
  resp_nombre_1: { x: 310, y: 407, maxWidth: 280 },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitize(v: string | null | undefined): string {
  if (v == null) return ''
  // pdf-lib StandardFonts (Helvetica) usa WinAnsiEncoding, soporta la mayoría
  // de caracteres del español. Reemplazamos solo caracteres fuera de ese set.
  return String(v).replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\u2026/g, '...')
}

function drawValue(page: PDFPage, font: PDFFont, value: string | null | undefined, cell: Cell) {
  const text = sanitize(value)
  if (!text) return
  const size = cell.size ?? 9
  const color = rgb(0, 0, 0)

  // Truncate si excede maxWidth (no queremos pisar la siguiente casilla).
  let toDraw = text
  if (cell.maxWidth) {
    while (toDraw.length > 0 && font.widthOfTextAtSize(toDraw, size) > cell.maxWidth) {
      toDraw = toDraw.slice(0, -1)
    }
  }
  page.drawText(toDraw, { x: cell.x, y: cell.y, size, font, color })
}

function formatCurrency(v: string | null): string | null {
  if (!v) return null
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  if (isNaN(n)) return v
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(n))
}

// Fecha factura → "AAAA MM DD" (casillas 58) o parsear en [anio, mes].
function parseFecha(iso: string | null): { anio: string; mes: string; dia: string; compacto: string } {
  if (!iso) return { anio: '', mes: '', dia: '', compacto: '' }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return { anio: '', mes: '', dia: '', compacto: iso }
  const anio = String(d.getUTCFullYear())
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(d.getUTCDate()).padStart(2, '0')
  return { anio, mes, dia, compacto: `${anio} ${mes} ${dia}` }
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function generarFormulario010(
  datos: Formulario010Datos,
  constantes: Formulario010Constantes,
): Promise<Uint8Array> {
  const templateBytes = fs.readFileSync(TEMPLATE_PATH)
  const pdfDoc = await PDFDocument.load(templateBytes)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pages = pdfDoc.getPages()
  const page1 = pages[0]
  const page2 = pages[1]

  const fecha = parseFecha(datos.fecha_factura)
  const valorFmt = formatCurrency(datos.valor_solicitado)

  // ── PÁGINA 1 ──────────────────────────────────────────────────────────────
  // Concepto (casilla 2) — usa Bold pequeño por estar en caja chica
  drawValue(page1, fontBold, constantes.concepto, { ...P1.concepto, size: 10 })

  // Datos solicitante
  drawValue(page1, font, datos.tipo_documento, P1.tipo_documento)
  drawValue(page1, font, datos.nit, P1.nit)
  drawValue(page1, font, datos.dv, P1.dv)
  drawValue(page1, font, datos.primer_apellido, P1.primer_apellido)
  drawValue(page1, font, datos.segundo_apellido, P1.segundo_apellido)
  drawValue(page1, font, datos.primer_nombre, P1.primer_nombre)
  drawValue(page1, font, datos.otros_nombres, P1.otros_nombres)
  drawValue(page1, font, datos.razon_social, P1.razon_social)
  drawValue(page1, font, datos.direccion_seccional, P1.direccion_seccional)
  drawValue(page1, font, datos.correo_electronico, P1.correo_electronico)
  drawValue(page1, font, datos.direccion, P1.direccion)
  drawValue(page1, font, datos.telefono, P1.telefono)
  drawValue(page1, font, datos.pais, P1.pais)
  drawValue(page1, font, datos.departamento, P1.departamento)
  drawValue(page1, font, datos.municipio, P1.municipio)

  // Formas de pago
  drawValue(page1, font, datos.entidad_financiera, P1.entidad_financiera)
  drawValue(page1, font, datos.numero_cuenta, P1.numero_cuenta)
  drawValue(page1, font, datos.tipo_cuenta, P1.tipo_cuenta)
  drawValue(page1, font, constantes.tipo_solicitud, P1.tipo_solicitud)

  // Firma de quien suscribe (1001-1004). 1005 y 1006 EN BLANCO por instrucción.
  drawValue(page1, font, datos.nombre_suscriptor, P1.firma_nombre)
  drawValue(page1, font, datos.tipo_doc_suscriptor, P1.firma_tipo_doc)
  drawValue(page1, font, datos.identificacion_suscriptor, P1.firma_identificacion)
  drawValue(page1, font, datos.dv_suscriptor, P1.firma_dv)

  // ── PÁGINA 2 ──────────────────────────────────────────────────────────────
  // Datos solicitante (repetir en hoja 2)
  drawValue(page2, font, datos.tipo_documento, P2.tipo_documento)
  drawValue(page2, font, datos.nit, P2.nit)
  drawValue(page2, font, datos.dv, P2.dv)
  drawValue(page2, font, datos.primer_apellido, P2.primer_apellido)
  drawValue(page2, font, datos.segundo_apellido, P2.segundo_apellido)
  drawValue(page2, font, datos.primer_nombre, P2.primer_nombre)
  drawValue(page2, font, datos.otros_nombres, P2.otros_nombres)
  drawValue(page2, font, datos.razon_social, P2.razon_social)
  drawValue(page2, font, datos.direccion_seccional, P2.direccion_seccional)

  // Titular del saldo (= solicitante para SOENA: el titular es la empresa)
  drawValue(page2, font, 'NIT', P2.titular_tipo_doc)
  drawValue(page2, font, datos.nit, P2.titular_nit)
  drawValue(page2, font, datos.dv, P2.titular_dv)
  drawValue(page2, font, datos.razon_social, P2.titular_nombre)

  // Valor + Tipo obligación
  drawValue(page2, font, valorFmt, P2.valor_solicitado)
  drawValue(page2, font, constantes.tipo_obligacion, P2.tipo_obligacion)

  // Fila 1 origen del saldo (factura + UPME)
  drawValue(page2, font, constantes.concepto_saldo, P2.concepto_saldo_1)
  drawValue(page2, font, fecha.anio, P2.anio_gravable_1)
  drawValue(page2, font, fecha.mes, P2.periodo_1)
  drawValue(page2, font, datos.numero_factura, P2.numero_factura_1)
  drawValue(page2, font, fecha.compacto, P2.fecha_factura_1)
  drawValue(page2, font, valorFmt, P2.valor_origen_1)

  // Responsable de la fila 1 (mismo NIT)
  drawValue(page2, font, 'NIT', P2.resp_tipo_doc_1)
  drawValue(page2, font, datos.nit, P2.resp_nit_1)
  drawValue(page2, font, datos.dv, P2.resp_dv_1)
  drawValue(page2, font, datos.razon_social, P2.resp_nombre_1)

  // Hoja 3 se deja en blanco: no aplica para devolución IVA por UPME (VE/HEV/PHEV).

  return pdfDoc.save()
}
