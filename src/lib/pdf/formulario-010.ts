import { PDFDocument, StandardFonts } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import { nombreOficialSeccional } from '@/lib/dian/seccionales'
import { formatearTelefonoFijo } from '@/lib/dian/indicativos'
import { drawFixed, type Cell } from './acroform'

// Sobre el PDF oficial de la DIAN (Formato 010). El fondo no se modifica.
// TODAS las casillas (datos variables + deterministas) se ESTAMPAN como texto
// plano (drawText) sobre el formato oficial: no se usan campos de formulario
// AcroForm (quedaban opacos y tapaban líneas/etiquetas del formato). El PDF sale
// plano/no editable por naturaleza; la edición vive en la plataforma.
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
  // Casilla 12 "Cód." — código oficial de la seccional (autocompletado del catálogo).
  codigo_seccional: string | null
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
  concepto: string // Casilla 2 — "3" (Concepto devolución; verificado contra el ejemplo real de Deisy)
  tipo_solicitud: string // Casilla 44 — "A solicitud de parte"
  tipo_obligacion: string // Casilla 50 — "UPME"
  concepto_saldo: string // Casilla 51 — "IVA"
  codigo_concepto_saldo?: string // Casilla 51 sub-casilla "Cód." — "175" (IVA/UPME)
  nombre_documento?: string // Casilla 57 — vacío (no diligenciable; la DIAN no lo exige aquí)
  descripcion_forma_pago?: string // Casilla 40 — "Giro cuenta" (TIDIS si > 1000 UVT; editable)
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
  // x corrido +2mm (5.669pt) a la derecha: el "3" quedaba pegado al divisor
  // central de la casilla; el shift centra el par "03" en su box (76 → 81.7).
  concepto: { x: 81.7, y: 718 },
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
  // Dirección seccional (fila y = 567.4, valor ~551). Size 7 + maxWidth 280:
  // los nombres OFICIALES son largos ("Dirección Seccional de Impuestos y Aduanas
  // de Barrancabermeja") y deben caber SIN truncarse y sin invadir la sub-casilla
  // "Cód." (label en x≈318). Size 7 para que el nombre completo entre.
  direccion_seccional: { x: 28, y: 551, maxWidth: 280, size: 7 },
  // Casilla 12 "Cód." — código de la seccional (2 dígitos), justo a la derecha del
  // label "Cód." (bbox del label xMin≈318, xMax≈330) y antes del valor de "Correo
  // electrónico" (casilla 14, valor en x≈343). Caja estrecha para no colisionar.
  codigo_seccional: { x: 331, y: 551, maxWidth: 11, size: 8 },
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
  // Casilla 40 (Descripción forma de pago) — misma fila que la 41 (y=443). Label
  // "40." en x≈26.5; el valor va debajo, izquierda, sin invadir la sub-casilla
  // "Cód." (label en x≈290). "Giro cuenta" en el ejemplo real de Deisy.
  descripcion_forma_pago: { x: 28, y: 443, maxWidth: 255 },
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
  direccion_seccional: { x: 28, y: 551, maxWidth: 280, size: 7 },
  // Casilla 12 "Cód." en hoja 2 — misma posición que en hoja 1 (bbox idéntico).
  codigo_seccional: { x: 331, y: 551, maxWidth: 11, size: 8 },
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
  // Casilla 51 sub-casilla "Cód." (label en x≈203, yMin=460) — el código del
  // concepto del saldo ("175" = IVA/UPME). Va entre el texto del concepto (termina
  // en x≈198) y la casilla 52 "Año grav." (x≈224).
  codigo_concepto_saldo_1: { x: 207, y: 455, maxWidth: 16, size: 8 },
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

// Tamaño de fuente por defecto de las casillas SIN `size` explícito. Bajarlo de 9
// a 8 compacta el texto dentro de cada casilla y elimina el "espacio en blanco
// entre líneas" que reportó Deisy (operaciones SOENA), sin descalibrar las
// posiciones Y (fijas contra el formato oficial). Las casillas que ya fijan su
// propio `size` (seccional=8, códigos=8, sub-casillas) NO se tocan.
const DEFAULT_FONT_SIZE = 8

// Aplica el tamaño compacto por defecto solo cuando la casilla no fija uno propio.
const compact = (cell: Cell): Cell => (cell.size == null ? { ...cell, size: DEFAULT_FONT_SIZE } : cell)

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

  const pages = pdfDoc.getPages()
  const page1 = pages[0]
  const page2 = pages[1]

  // Todo se ESTAMPA como texto plano (drawText) sobre el formato oficial: `edit*`
  // (datos variables) y `fixed*` (deterministas) comparten la misma vía. Se
  // conservan nombres separados por legibilidad del mapeo de casillas. El +2pt
  // (Y_NUDGE) de calibración del 010 se aplica a todo. `compact()` aplica el
  // tamaño de fuente compacto (8pt) a las casillas que no fijan uno propio. El 1er
  // arg de `edit*` (antes el nombre del campo AcroForm) ya no se usa: se ignora.
  const edit1 = (_name: string, value: string | null | undefined, cell: Cell) =>
    drawFixed(page1, font, value, compact(cell), Y_NUDGE)
  const edit2 = (_name: string, value: string | null | undefined, cell: Cell) =>
    drawFixed(page2, font, value, compact(cell), Y_NUDGE)
  const fixed1 = (value: string | null | undefined, cell: Cell, f = font) =>
    drawFixed(page1, f, value, compact(cell), Y_NUDGE)
  const fixed2 = (value: string | null | undefined, cell: Cell, f = font) =>
    drawFixed(page2, f, value, compact(cell), Y_NUDGE)

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

  // Casilla 20 (tipo de documento del solicitante). Default "31" (NIT) — el ejemplo
  // real de Deisy (persona natural) va con "31", no con cédula. HONRA el override
  // del operador si lo cambia a otro código.
  const tipoDocSolicitante = (datos.tipo_documento && datos.tipo_documento.trim()) || '31'

  // ── PÁGINA 1 ──────────────────────────────────────────────────────────────
  // Concepto (casilla 2) — DETERMINISTA, Bold pequeño por estar en caja chica.
  // La casilla es de 2 dígitos: se rellena con cero a la izquierda ("3" → "03").
  fixed1(constantes.concepto ? constantes.concepto.padStart(2, '0') : constantes.concepto, { ...P1.concepto, size: 10 }, fontBold)

  // Datos solicitante (casilla 20). Default "13" (Cédula); override del operador
  // manda. Ver `tipoDocSolicitante` arriba.
  fixed1(tipoDocSolicitante, P1.tipo_documento)
  edit1('nit', datos.nit, P1.nit)
  edit1('dv', datos.dv, P1.dv)
  edit1('primer_apellido', datos.primer_apellido, P1.primer_apellido)
  edit1('segundo_apellido', datos.segundo_apellido, P1.segundo_apellido)
  edit1('primer_nombre', datos.primer_nombre, P1.primer_nombre)
  edit1('otros_nombres', datos.otros_nombres, P1.otros_nombres)
  // Razón social (casilla 11): SIEMPRE en blanco. SOENA opera 100% personas
  // naturales; ninguna seccional (tampoco Cali) la diligencia. Confirmado por Deisy
  // (2026-07-16): todas las seccionales son iguales.
  edit1('direccion_seccional', seccionalOficial, P1.direccion_seccional)
  // Casilla 12 "Cód." — código oficial de la seccional (autocompletado).
  edit1('codigo_seccional', datos.codigo_seccional, P1.codigo_seccional)
  edit1('correo_electronico', datos.correo_electronico, P1.correo_electronico)
  edit1('direccion', datos.direccion, P1.direccion)
  // Casilla 25 (Teléfono) — línea fija con indicativo de ciudad delante ("601 …").
  edit1('telefono', formatearTelefonoFijo(datos.telefono, datos.codigo_departamento), P1.telefono)
  edit1('pais', datos.pais, P1.pais)
  edit1('departamento', datos.departamento, P1.departamento)
  edit1('municipio', datos.municipio, P1.municipio)
  edit1('codigo_pais', datos.codigo_pais, P1.codigo_pais)
  edit1('codigo_departamento', datos.codigo_departamento, P1.codigo_departamento)
  edit1('codigo_municipio', datos.codigo_municipio, P1.codigo_municipio)

  // Formas de pago
  // Casilla 40 (Descripción forma de pago) — DETERMINISTA config-driven ("Giro
  // cuenta"). Editable vía override si el caso es TIDIS (> 1000 UVT).
  if (constantes.descripcion_forma_pago) fixed1(constantes.descripcion_forma_pago, P1.descripcion_forma_pago)
  edit1('entidad_financiera', datos.entidad_financiera, P1.entidad_financiera)
  edit1('numero_cuenta', datos.numero_cuenta, P1.numero_cuenta)
  edit1('tipo_cuenta', datos.tipo_cuenta, P1.tipo_cuenta)
  fixed1(constantes.tipo_solicitud, P1.tipo_solicitud) // DETERMINISTA

  // Firma de quien suscribe (1001-1004) = el solicitante. 1005/1006 EN BLANCO.
  // Casilla 1002 = "31" (tipo doc de la firma): en el ejemplo real de Deisy el
  // suscriptor firma con el código NIT ("31"), no "CC". DETERMINISTA.
  edit1('nombre_completo', nombreTitular, P1.firma_nombre)
  fixed1('31', P1.firma_tipo_doc) // DETERMINISTA
  edit1('nit', datos.nit, P1.firma_identificacion)
  edit1('dv', datos.dv, P1.firma_dv)
  // 1005 (Cod. Representación) y 1006 (Organización): SIEMPRE en blanco. Persona
  // natural a nombre propio NO diligencia representación ni organización (instructivo
  // DIAN). Confirmado por Deisy (2026-07-16): Cali ya no es excepción.

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
  // Razón social (casilla 11): SIEMPRE en blanco (persona natural).
  edit2('direccion_seccional', seccionalOficial, P2.direccion_seccional)
  // Casilla 12 "Cód." — código oficial de la seccional (faltaba en hoja 2).
  edit2('codigo_seccional', datos.codigo_seccional, P2.codigo_seccional)

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
  fixed2(constantes.concepto_saldo, P2.concepto_saldo_1) // Casilla 51 texto ("IVA") DETERMINISTA
  // Casilla 51 sub-casilla "Cód." — "175" (IVA/UPME). DETERMINISTA config-driven.
  if (constantes.codigo_concepto_saldo) fixed2(constantes.codigo_concepto_saldo, P2.codigo_concepto_saldo_1)
  edit2('anio_gravable', fecha.anio, P2.anio_gravable_1)
  // Casilla 53 (Período) — FIJO "1" (sin cero a la izquierda; NO es el bimestre
  // calculado de la fecha de factura).
  fixed2('1', P2.periodo_1)
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

  // El PDF sale PLANO por naturaleza: el texto se estampó directo sobre la página,
  // no hay campos de formulario que aplanar ni apariencias que regenerar. Nada
  // queda editable en el lector (la edición vive en la plataforma) y la estructura
  // base del formato queda intacta.
  return pdfDoc.save()
}
