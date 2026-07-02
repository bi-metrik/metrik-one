import { PDFDocument, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import { nombreOficialSeccional } from '@/lib/dian/seccionales'
import { addEditableField, drawFixed, type Cell } from './acroform'

// Sobre el PDF oficial de la DIAN (Formato 010). El fondo no se modifica.
// Las casillas de DATOS VARIABLES (datos del solicitante, cuenta, saldo y la
// dirección seccional — que cambia según a qué DIAN se presente) se generan como
// CAMPOS de formulario EDITABLES pre-llenados; el operador ajusta lo que pida la
// seccional y aplana al imprimir. Las DETERMINISTAS (concepto 06, periodo
// bimestral, tipo doc 31, razón social en blanco, tipo solicitud/obligación)
// van como texto fijo no editable.
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
  // Códigos DANE/DIAN de ubicación (fuente: RUT) — casillas 26/27/28 sub-casilla "Cód."
  codigo_pais: string | null
  codigo_departamento: string | null
  codigo_municipio: string | null
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
  tipo_obligacion: string // Casilla 50 — "Impuesto sobre las ventas IVA"
  concepto_saldo: string // Casilla 51 — "Pago de lo no debido"
  nombre_documento?: string // Casilla 57 — "Factura electrónica de ventas"
  // ── Seccional DIAN (config-driven, opt-in; ver config_extra.seccionales) ──
  seccional_literal?: boolean // casilla 12: usar direccion_seccional tal cual (NO mapear a nombre oficial)
  mostrar_razon_social?: boolean // casilla 11: llenar razón social (solo algunas seccionales, ej. Cali)
  cod_representacion_1005?: string | null // casilla 1005 (solo algunas seccionales)
  organizacion_1006?: string | null // casilla 1006 (solo algunas seccionales)
}

const TEMPLATE_PATH = path.join(process.cwd(), 'src/lib/pdf/templates/formulario-010-dian.pdf')

// Cada casilla: coord del valor (baseline del texto en puntos).
// Regla usada: valor = label_y - 16 (caja de 24pt, label arriba, valor debajo).

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
  // Dirección seccional (fila y = 567.4, valor ~551). Size 8 + maxWidth 305:
  // los nombres oficiales son largos ("...de Barrancabermeja") y no deben truncarse.
  direccion_seccional: { x: 28, y: 551, maxWidth: 305, size: 8 },
  correo_electronico: { x: 343, y: 551, maxWidth: 240 },
  // Dirección y Teléfono (fila y = 543.4, valor ~527)
  direccion: { x: 28, y: 527, maxWidth: 470 },
  telefono: { x: 509, y: 527, maxWidth: 80 },
  // País / Depto / Municipio (fila y = 519.4, valor ~503)
  pais: { x: 28, y: 503, maxWidth: 160 },
  departamento: { x: 223, y: 503, maxWidth: 160 },
  municipio: { x: 414, y: 503, maxWidth: 155 },
  // Códigos (sub-casilla "Cód." de cada una; misma fila que el nombre)
  codigo_pais: { x: 198, y: 503, maxWidth: 22, size: 8 },
  codigo_departamento: { x: 389, y: 503, maxWidth: 22, size: 8 },
  codigo_municipio: { x: 575, y: 503, maxWidth: 32, size: 8 },
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
  // 1005 (Cod. Representación) y 1006 (Organización): solo se llenan en algunas
  // seccionales (ej. Cali). Coords calibradas con pdftotext -bbox sobre el oficial.
  firma_cod_representacion: { x: 145, y: 120, maxWidth: 40 }, // 1005
  firma_organizacion: { x: 120, y: 109, maxWidth: 180 }, // 1006
}

// ── Página 2 (Datos solicitante repetidos + Titular saldo + Origen saldo) ────
const P2 = {
  // El "Espacio reservado para la DIAN" (encabezado hoja 2) lo llena la DIAN: no se
  // dibuja nada ahí. (Antes caía el "06" del concepto por error — reporte de Deisy.)
  // Fila superior — repite datos solicitante en y=615.4 → valor ~599
  tipo_documento: { x: 28, y: 599, maxWidth: 35 },
  nit: { x: 65, y: 599, maxWidth: 100 },
  dv: { x: 173, y: 599, maxWidth: 15 },
  primer_apellido: { x: 198, y: 599, maxWidth: 100 },
  segundo_apellido: { x: 302, y: 599, maxWidth: 100 },
  primer_nombre: { x: 409, y: 599, maxWidth: 95 },
  otros_nombres: { x: 510, y: 599, maxWidth: 85 },
  razon_social: { x: 28, y: 575, maxWidth: 560 },
  direccion_seccional: { x: 28, y: 551, maxWidth: 560, size: 8 },
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
  // Casilla 55 (No. documento que origina el saldo) — la DIAN exige aquí el
  // número de factura de venta del vehículo. La 54 (No. doc/acto, x≈308) queda
  // vacía: solo aplica a pago en exceso aduanero.
  numero_factura_1: { x: 448, y: 458, maxWidth: 135 },
  // 56 Descripción: NO se diligencia para IVA.
  // 57 Nombre del documento de reconocimiento (fila inferior, izq. de la fecha):
  // la DIAN exige "Factura electrónica de ventas".
  nombre_documento_1: { x: 245, y: 434, maxWidth: 140, size: 7 },
  // 58 Fecha documento (y=450 → 434)
  fecha_factura_1: { x: 393, y: 434, maxWidth: 70 },
  // 59 Valor solicitado por origen (y=447.4 → 431)
  valor_origen_1: { x: 471, y: 431, maxWidth: 115 },
  // Casilla 45 sub-casilla "Cód." del tipo de documento del titular (entre el
  // campo "NIT" y el número de identificación). bbox: Cód. en xMin≈135, fila y≈503.
  titular_tipo_doc_cod: { x: 136, y: 503, maxWidth: 18, size: 9 },
  // 60/61/62/63 responsable (y=426 → 407): usa el mismo NIT y razón social del titular
  resp_tipo_doc_1: { x: 43, y: 407, maxWidth: 100 },
  // Casilla 60 sub-casilla "Cód." del tipo de documento responsable. bbox: Cód.
  // en xMin≈147, fila y≈407.
  resp_tipo_doc_cod_1: { x: 148, y: 407, maxWidth: 18, size: 9 },
  resp_nit_1: { x: 171, y: 407, maxWidth: 105 },
  resp_dv_1: { x: 284, y: 407, maxWidth: 20 },
  resp_nombre_1: { x: 310, y: 407, maxWidth: 280 },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Las casillas del 010 se calibraron con un nudge vertical de +2pt sobre la
// baseline; lo conservamos para que el texto fijo caiga donde la DIAN ya aprobó.
const Y_NUDGE = 2

function formatCurrency(v: string | null): string | null {
  if (!v) return null
  const n = Number(String(v).replace(/[^\d.-]/g, ''))
  if (isNaN(n)) return v
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Math.round(n))
}

// Fecha factura → "AAAA MM DD" (casillas 58) o parsear en [anio, mes].
// bimestre (casilla 53): IVA es bimestral. Ene-Feb=1 ... Nov-Dic=6 = ceil(mes/2).
function parseFecha(iso: string | null): { anio: string; mes: string; dia: string; bimestre: string; compacto: string } {
  if (!iso) return { anio: '', mes: '', dia: '', bimestre: '', compacto: '' }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return { anio: '', mes: '', dia: '', bimestre: '', compacto: iso }
  const anio = String(d.getUTCFullYear())
  const mesNum = d.getUTCMonth() + 1
  const mes = String(mesNum).padStart(2, '0')
  const dia = String(d.getUTCDate()).padStart(2, '0')
  const bimestre = String(Math.ceil(mesNum / 2)).padStart(2, '0') // casilla 53: 2 dígitos ("04")
  return { anio, mes, dia, bimestre, compacto: `${anio} ${mes} ${dia}` }
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
  const form = pdfDoc.getForm()

  const pages = pdfDoc.getPages()
  const page1 = pages[0]
  const page2 = pages[1]

  // Atajos: `edit*` = campo editable pre-llenado (con el +2pt de calibración del
  // 010); `fixed*` = texto determinista no editable (mismo nudge). Nombres de
  // campo compartidos → un dato repetido en varias casillas queda sincronizado.
  const edit1 = (name: string, value: string | null | undefined, cell: Cell) =>
    addEditableField(form, font, page1, name, value, cell, Y_NUDGE)
  const edit2 = (name: string, value: string | null | undefined, cell: Cell) =>
    addEditableField(form, font, page2, name, value, cell, Y_NUDGE)
  const fixed1 = (value: string | null | undefined, cell: Cell, f = font) =>
    drawFixed(page1, f, value, cell, Y_NUDGE)
  const fixed2 = (value: string | null | undefined, cell: Cell, f = font) =>
    drawFixed(page2, f, value, cell, Y_NUDGE)

  const fecha = parseFecha(datos.fecha_factura)
  const valorFmt = formatCurrency(datos.valor_solicitado)
  // Casilla 12 — la seccional. Si la línea usa config de seccionales (seccional_literal),
  // el valor ya viene resuelto literal del preset (tal cual el documento de Deisy) y NO
  // se mapea. Si no, se normaliza lo extraído del RUT contra el catálogo oficial.
  const seccionalOficial = constantes.seccional_literal
    ? (datos.direccion_seccional ?? '')
    : nombreOficialSeccional(datos.direccion_seccional)

  // SOENA opera 100% personas naturales: la casilla 11 (Razón social) SIEMPRE va en
  // BLANCO (determinista, sin heurística → sin campo). Se llenan las casillas 7-10
  // (nombres). El titular del saldo / responsable llevan el nombre completo (campo
  // "apellidos y nombres o razón social"); si faltaran los nombres, cae a razon_social.
  const nombreCompleto = [datos.primer_nombre, datos.otros_nombres, datos.primer_apellido, datos.segundo_apellido]
    .filter(Boolean)
    .join(' ')
  const nombreTitular = nombreCompleto || datos.razon_social

  // Casilla 20 (tipo de documento del solicitante). Default "13" (Cédula de
  // Ciudadanía), pero HONRA el override del operador: si Deisy lo cambia a "31"
  // (NIT) el PDF lo respeta. Antes estaba fijo en "13" e ignoraba su edición.
  const tipoDocSolicitante = (datos.tipo_documento && datos.tipo_documento.trim()) || '13'

  // ── PÁGINA 1 ──────────────────────────────────────────────────────────────
  // Concepto (casilla 2) — DETERMINISTA, Bold pequeño por estar en caja chica.
  fixed1(constantes.concepto, { ...P1.concepto, size: 10 }, fontBold)

  // Datos solicitante (casilla 20). Default "13" (Cédula); override del operador
  // manda. Ver `tipoDocSolicitante` arriba.
  fixed1(tipoDocSolicitante, P1.tipo_documento)
  edit1('nit', datos.nit, P1.nit)
  edit1('dv', datos.dv, P1.dv)
  edit1('primer_apellido', datos.primer_apellido, P1.primer_apellido)
  edit1('segundo_apellido', datos.segundo_apellido, P1.segundo_apellido)
  edit1('primer_nombre', datos.primer_nombre, P1.primer_nombre)
  edit1('otros_nombres', datos.otros_nombres, P1.otros_nombres)
  // Razón social (casilla 11): en blanco salvo que la seccional lo exija (ej. Cali).
  if (constantes.mostrar_razon_social && datos.razon_social) edit1('razon_social', datos.razon_social, P1.razon_social)
  edit1('direccion_seccional', seccionalOficial, P1.direccion_seccional)
  edit1('correo_electronico', datos.correo_electronico, P1.correo_electronico)
  edit1('direccion', datos.direccion, P1.direccion)
  edit1('telefono', datos.telefono, P1.telefono)
  edit1('pais', datos.pais, P1.pais)
  edit1('departamento', datos.departamento, P1.departamento)
  edit1('municipio', datos.municipio, P1.municipio)
  edit1('codigo_pais', datos.codigo_pais, P1.codigo_pais)
  edit1('codigo_departamento', datos.codigo_departamento, P1.codigo_departamento)
  edit1('codigo_municipio', datos.codigo_municipio, P1.codigo_municipio)

  // Formas de pago
  edit1('entidad_financiera', datos.entidad_financiera, P1.entidad_financiera)
  edit1('numero_cuenta', datos.numero_cuenta, P1.numero_cuenta)
  edit1('tipo_cuenta', datos.tipo_cuenta, P1.tipo_cuenta)
  fixed1(constantes.tipo_solicitud, P1.tipo_solicitud) // DETERMINISTA

  // Firma de quien suscribe (1001-1004) = el solicitante. 1005/1006 EN BLANCO.
  // Casilla 1002 = "CC" (tipo doc de la firma): el suscriptor persona natural firma
  // con su cédula, no con el código NIT. Confirmado con el diligenciado de Deisy.
  edit1('nombre_completo', nombreTitular, P1.firma_nombre)
  fixed1('CC', P1.firma_tipo_doc) // DETERMINISTA
  edit1('nit', datos.nit, P1.firma_identificacion)
  edit1('dv', datos.dv, P1.firma_dv)
  // 1005 (Cod. Representación) / 1006 (Organización): solo algunas seccionales (ej. Cali).
  if (constantes.cod_representacion_1005) fixed1(constantes.cod_representacion_1005, P1.firma_cod_representacion)
  if (constantes.organizacion_1006) edit1('organizacion_1006', constantes.organizacion_1006, P1.firma_organizacion)

  // ── PÁGINA 2 ──────────────────────────────────────────────────────────────
  // El "Espacio reservado para la DIAN" (encabezado hoja 2) lo diligencia la DIAN,
  // NO el solicitante: no se imprime nada ahí (antes caía el "06" por error).

  // Datos solicitante (repetir en hoja 2). Casilla 20: mismo criterio que hoja 1
  // (default "13", override manda).
  fixed2(tipoDocSolicitante, P2.tipo_documento)
  edit2('nit', datos.nit, P2.nit)
  edit2('dv', datos.dv, P2.dv)
  edit2('primer_apellido', datos.primer_apellido, P2.primer_apellido)
  edit2('segundo_apellido', datos.segundo_apellido, P2.segundo_apellido)
  edit2('primer_nombre', datos.primer_nombre, P2.primer_nombre)
  edit2('otros_nombres', datos.otros_nombres, P2.otros_nombres)
  // Razón social (casilla 11): en blanco salvo que la seccional lo exija (ej. Cali).
  if (constantes.mostrar_razon_social && datos.razon_social) edit2('razon_social', datos.razon_social, P2.razon_social)
  edit2('direccion_seccional', seccionalOficial, P2.direccion_seccional)

  // Titular del saldo (= solicitante). Casilla 45: la palabra "NIT" en el campo +
  // el código "31" en la sub-casilla "Cód." (persona natural responde por la
  // obligación tributaria con su NIT). DETERMINISTA. Confirmado con el ejemplo de Deisy.
  fixed2('NIT', P2.titular_tipo_doc)
  fixed2('31', P2.titular_tipo_doc_cod)
  edit2('nit', datos.nit, P2.titular_nit)
  edit2('dv', datos.dv, P2.titular_dv)
  edit2('nombre_completo', nombreTitular, P2.titular_nombre)

  // Valor + Tipo obligación (constante DETERMINISTA)
  edit2('valor', valorFmt, P2.valor_solicitado)
  fixed2(constantes.tipo_obligacion, P2.tipo_obligacion)

  // Fila 1 origen del saldo (factura + UPME)
  fixed2(constantes.concepto_saldo, P2.concepto_saldo_1) // DETERMINISTA
  edit2('anio_gravable', fecha.anio, P2.anio_gravable_1)
  fixed2(fecha.bimestre, P2.periodo_1) // casilla 53 periodo bimestral: BLINDADO
  edit2('numero_factura', datos.numero_factura, P2.numero_factura_1)
  // Casilla 57 — nombre del documento que origina el saldo (constante DETERMINISTA)
  if (constantes.nombre_documento) fixed2(constantes.nombre_documento, P2.nombre_documento_1)
  edit2('fecha_factura', fecha.compacto, P2.fecha_factura_1)
  edit2('valor', valorFmt, P2.valor_origen_1)

  // Responsable de la fila 1 (casillas 60-63): "NIT" en el campo + "31" en la
  // sub-casilla "Cód." DETERMINISTA + cédula + DV + nombre (hoy = el mismo
  // solicitante; con 2º solicitante se separará).
  fixed2('NIT', P2.resp_tipo_doc_1)
  fixed2('31', P2.resp_tipo_doc_cod_1)
  edit2('nit', datos.nit, P2.resp_nit_1)
  edit2('dv', datos.dv, P2.resp_dv_1)
  edit2('nombre_completo', nombreTitular, P2.resp_nombre_1)

  // Hoja 3 se deja en blanco: no aplica para devolución IVA por UPME (VE/HEV/PHEV).

  // Regenera apariencias con la fuente embebida (texto pre-llenado visible en
  // cualquier lector, sin depender de NeedAppearances).
  form.updateFieldAppearances(font)

  return pdfDoc.save()
}
