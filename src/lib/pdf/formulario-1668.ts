import { PDFDocument, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import { drawCells, drawFixed, type Cell } from './acroform'

// Overlay sobre el PDF oficial de la DIAN (Formato 1668 — Información /
// Constancia de Titularidad de Cuenta Bancaria). El fondo no se modifica.
// TODAS las casillas (datos variables + deterministas) se ESTAMPAN como texto
// plano (drawText): no se usan campos de formulario AcroForm (quedaban opacos y
// tapaban líneas/etiquetas del formato). El PDF sale plano/no editable.
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
  // Entidad financiera (fila y ≈ 555). La fecha de expedición de esa misma fila NO
  // va aquí: tiene rejilla propia y se dibuja con `drawCells` (ver FECHA_EXPEDICION).
  entidad_financiera: { x: 166, y: 555, maxWidth: 400 },
  // No. Cuenta + Tipo de cuenta (fila y ≈ 531)
  numero_cuenta: { x: 26, y: 531, maxWidth: 135 },
  tipo_cuenta: { x: 166, y: 531, maxWidth: 245 },
}

// ── Casilla 24: fecha de expedición, repartida por casilla ───────────────────
//
// El formato trae rejilla de tres grupos —AAAA | MM | DD— igual que el 010. Los
// separadores dibujados se midieron sobre el formato en blanco RENDERIZADO a 600 dpi,
// contando columnas de píxeles oscuros: borde 24,18 · separadores 63,78 / 83,46 /
// 102,66 pt. De ahí salen los tres grupos y sus pasos.
//
// ⚠️ Se intentó primero con los trazos vectoriales (`pdftocairo -svg`) y esa medición
// estaba CORRIDA: daba 67,22 y 87,61 donde el render muestra 63,78 y 83,46. Con esos
// valores los dígitos caían fuera de sus casillas, y solo se vio al mirar el PDF. Si
// alguien recalibra esto, que mida sobre el render, no sobre el SVG.
const FECHA_EXPEDICION = {
  y: 555,
  size: 8,
  groups: [
    { count: 4, xStart: 24.18, pitch: 9.9 },  // AAAA (24,18 → 63,78)
    { count: 2, xStart: 63.78, pitch: 9.84 }, // MM   (63,78 → 83,46)
    { count: 2, xStart: 83.46, pitch: 9.6 },  // DD   (83,46 → 102,66)
  ],
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

// Nombre completo del suscriptor: apellidos + nombres (igual que el diligenciado
// de referencia: "TAVERA MONCALEANO DIEGO THOMAS").
function nombreCompleto(d: Formulario1668Datos): string {
  return [d.primer_apellido, d.segundo_apellido, d.primer_nombre, d.otros_nombres]
    .map(v => (v ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * Fecha de expedición en dígitos corridos `AAAAMMDD`, para repartir por casilla.
 *
 * ⚠️ El orden es AAAA-MM-DD, no DD/MM/AAAA. La casilla 24 del formato tiene rejilla
 * de tres grupos (4 + 2 + 2) igual que el 010, y hasta el 2026-08-12 esto se estampaba
 * como UNA cadena `DD/MM/AAAA` en un solo punto: los dígitos no caían en sus casillas
 * y además iban en orden invertido.
 *
 * Acepta ISO (`AAAA-MM-DD`) o ya formateada (`DD/MM/AAAA`), que es como quedaron los
 * valores escritos a mano antes de este cambio.
 */
export function digitosFecha(valor: string | null): string | null {
  if (!valor) return null
  const s = String(valor).trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}${iso[2]}${iso[3]}`
  const dmy = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/)
  if (dmy) return `${dmy[3]}${dmy[2]}${dmy[1]}`
  // Formato desconocido: no se inventa una fecha. Mejor casilla vacía que una
  // fecha equivocada en un documento que va a la DIAN.
  return null
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

  // Todo se ESTAMPA como texto plano (drawText) sobre el formato oficial. `edit`
  // (datos variables) y `fixed` (deterministas) comparten la misma vía; se
  // conservan nombres separados por legibilidad del mapeo. El 1er arg de `edit`
  // (antes el nombre del campo AcroForm) ya no se usa: se ignora.
  const edit = (_name: string, value: string | null | undefined, cell: Cell) =>
    drawFixed(page, font, value, cell)
  const fixed = (value: string | null | undefined, cell: Cell) =>
    drawFixed(page, font, value, cell)

  // ── Información Cuenta Bancaria ─────────────────────────────────────────────
  // Tipo de documento (casilla 20): DETERMINISTA "31" (NIT). Decisión de Mauricio
  // (2026-07-16): el titular se identifica con "31", no con "13" (CC). Se fija en el
  // código (como la casilla 1002 = "CC") y NO se toma de constantes.tipo_documento.
  fixed('31', INFO.tipo_documento)
  // Datos del titular (variables, editables). numero_identificacion y dv se
  // reutilizan en la sección de firma → mismo nombre de campo, queda sincronizado.
  edit('numero_identificacion', datos.numero_identificacion, INFO.numero_identificacion)
  edit('dv', datos.dv, INFO.dv)
  edit('primer_apellido', datos.primer_apellido, INFO.primer_apellido)
  edit('segundo_apellido', datos.segundo_apellido, INFO.segundo_apellido)
  edit('primer_nombre', datos.primer_nombre, INFO.primer_nombre)
  edit('otros_nombres', datos.otros_nombres, INFO.otros_nombres)
  // Razón social (casilla 11): persona natural → BLANCO determinista, sin campo.

  // Casilla 24: un dígito por casilla, AAAA MM DD (no una cadena con barras).
  drawCells(page, font, digitosFecha(datos.fecha_expedicion), FECHA_EXPEDICION)
  edit('entidad_financiera', datos.entidad_financiera, INFO.entidad_financiera)
  edit('numero_cuenta', datos.numero_cuenta, INFO.numero_cuenta)
  edit('tipo_cuenta', datos.tipo_cuenta, INFO.tipo_cuenta)

  // ── Firma de quien suscribe (titular) ───────────────────────────────────────
  edit('firma_nombre', nombreCompleto(datos), FIRMA.nombre)
  // Casilla 1002 = "CC": la firma del titular persona natural usa cédula, no el
  // código "13" de la casilla 20. Confirmado con el diligenciado de Deisy.
  fixed('CC', FIRMA.tipo_doc) // DETERMINISTA
  edit('numero_identificacion', datos.numero_identificacion, FIRMA.identificacion)
  edit('dv', datos.dv, FIRMA.dv)
  fixed(constantes.cod_representacion, FIRMA.cod_representacion) // DETERMINISTA

  // El PDF sale PLANO por naturaleza: el texto se estampó directo sobre la página,
  // sin campos de formulario. Nada queda editable en el lector y la estructura base
  // del formato queda intacta.
  return pdfDoc.save()
}
