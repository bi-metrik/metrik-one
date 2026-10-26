/**
 * Reporte Supertransporte — el Excel de soporte: el listado nominal detrás de cada cifra.
 *
 * Es la evidencia que exige la CE 054 ("contar con los soportes"): la Superintendencia
 * puede pedirlos. Una hoja de resumen con las cifras tal como salen en el tablero y una
 * hoja por literal con las contrapartes que las forman.
 *
 * Las fechas van como TEXTO AAAA-MM-DD: el serial de fecha de SheetJS depende de la zona
 * del runtime (ver `lib/negocios/export-excel-libro.ts`) y aquí la fecha es dato de
 * evidencia, no algo sobre lo que se calcule.
 *
 * El enlace al PDF de soporte es ABSOLUTO (subdominio del workspace) y sigue exigiendo
 * sesión: el archivo se puede reenviar, el acceso no.
 */
import * as XLSX from 'xlsx'
import type { FilaConocimiento, LiteralReporte, ReporteSupertransporte } from './conteo'
import { etiquetaFecha } from './periodos'

export function enlaceSoporte(baseUrl: string, consultaId: string): string {
  return `${baseUrl}/api/compliance/listas/soporte/${consultaId}`
}

function valorLiteral(l: LiteralReporte): string | number {
  if (l.valor === null) return 'Sin dato'
  return l.unidad === 'porcentaje' ? `${l.valor} %` : l.valor
}

function hojaConEnlaces(filas: Record<string, string | number>[], columnaEnlace: string): XLSX.WorkSheet {
  const ws = XLSX.utils.json_to_sheet(filas)
  if (filas.length === 0) return ws
  const col = Object.keys(filas[0]).indexOf(columnaEnlace)
  if (col < 0) return ws
  for (let r = 1; r <= filas.length; r++) {
    const celda = ws[XLSX.utils.encode_cell({ c: col, r })]
    if (celda && typeof celda.v === 'string' && celda.v) {
      celda.l = { Target: celda.v, Tooltip: 'Abrir el soporte en ONE' }
    }
  }
  return ws
}

function filasConsulta(filas: FilaConocimiento[], baseUrl: string) {
  return filas.map((f) => ({
    'Tipo doc.': f.documento_tipo,
    Documento: f.documento_numero,
    Nombre: f.nombre,
    Segmento: f.segmento,
    Fecha: f.fecha,
    Resultado: f.resultado,
    Tier: f.tier,
    Listas: f.listas,
    'Consultas en el periodo': f.consultas,
    'Soporte (PDF)': enlaceSoporte(baseUrl, f.consulta_id),
  }))
}

/** Arma el libro y devuelve el buffer .xlsx. */
export function construirLibroSupertransporte(
  r: ReporteSupertransporte,
  opciones: { baseUrl: string; workspaceNombre: string; generado: string },
): Buffer<ArrayBuffer> {
  const wb = XLSX.utils.book_new()
  const p = r.periodo

  // ── Resumen ──
  const cabecera: (string | number)[][] = [
    ['Reporte Supertransporte — información objetiva SARLAFT/RMS (CE 20265330000054 num. 5.3.1.3, mod. CE 20265330000134)'],
    ['Espacio', opciones.workspaceNombre],
    ['Periodo', p.etiqueta],
    ['Desde', p.desde],
    ['Hasta', p.hasta],
    ...(p.fechaLimite ? [['Fecha límite de radicación', etiquetaFecha(p.fechaLimite)]] : []),
    ...(p.enCurso ? [['Atención', 'El periodo no ha cerrado: las cifras van a cambiar.']] : []),
    ['Generado', opciones.generado],
    ['Excluidas', `${r.excluidas.metrik} consulta(s) de MéTRIK (pruebas) y ${r.excluidas.error} con error`],
    [],
    ['Literal', 'Qué pide', 'Cifra', ...r.segmentos, 'Causa / nota', 'Detalle'],
  ]
  for (const l of r.literales) {
    cabecera.push([
      l.letra,
      l.titulo,
      valorLiteral(l),
      ...r.segmentos.map((s) => {
        const d = l.desglose.find((x) => x.segmento === s)
        if (!d || d.valor === null) return 'Sin dato'
        return l.unidad === 'porcentaje' ? `${d.valor} %` : d.valor
      }),
      l.causa ?? '',
      l.detalle.join(' | '),
    ])
  }
  cabecera.push([], ['Mes', 'Desde', 'Hasta', 'Consultas', 'Contrapartes distintas', 'Con coincidencia devuelta', ...r.segmentos])
  for (const m of r.mensual) {
    cabecera.push([m.mes, m.desde, m.hasta, m.consultas, m.contrapartes, m.conCoincidencia, ...r.segmentos.map((s) => m.porSegmento[s] ?? 0)])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cabecera), 'Resumen')

  // ── a. Relación vigente ──
  XLSX.utils.book_append_sheet(
    wb,
    r.nominal.relacion.length > 0
      ? XLSX.utils.json_to_sheet(r.nominal.relacion.map((f) => ({
          'Tipo doc.': f.documento_tipo,
          Documento: f.documento_numero,
          Nombre: f.nombre,
          Segmento: f.segmento,
          Tipo: f.tipo,
          'Relación desde': f.relacion_desde,
          'Relación hasta': f.relacion_hasta,
        })))
      : XLSX.utils.aoa_to_sheet([[r.literales.find((l) => l.letra === 'a')?.causa ?? 'Sin contrapartes vigentes en el periodo.']]),
    'a Relacion vigente',
  )

  // ── c. Conocimiento ──
  XLSX.utils.book_append_sheet(
    wb,
    hojaConEnlaces(filasConsulta(r.nominal.conocimiento, opciones.baseUrl), 'Soporte (PDF)'),
    'c Conocimiento',
  )

  // ── d. Debida diligencia ──
  XLSX.utils.book_append_sheet(
    wb,
    r.nominal.diligencia.length > 0
      ? XLSX.utils.json_to_sheet(r.nominal.diligencia.map((f) => ({
          'Tipo doc.': f.documento_tipo,
          Documento: f.documento_numero,
          Nombre: f.nombre,
          Segmento: f.segmento,
          Estado: f.estado,
          Fecha: f.fecha,
        })))
      : XLSX.utils.aoa_to_sheet([['Sin expedientes de vinculación en el periodo.']]),
    'd Debida diligencia',
  )

  // ── e. Coincidencias ──
  XLSX.utils.book_append_sheet(
    wb,
    hojaConEnlaces(filasConsulta(r.nominal.coincidencias, opciones.baseUrl), 'Soporte (PDF)'),
    'e Coincidencias',
  )

  // ── Excluidas ──
  XLSX.utils.book_append_sheet(
    wb,
    hojaConEnlaces(
      r.nominal.excluidas.map((f) => ({
        Fecha: f.fecha,
        Documento: f.documento_numero,
        Nombre: f.nombre,
        Motivo: f.motivo,
        'Soporte (PDF)': enlaceSoporte(opciones.baseUrl, f.consulta_id),
      })),
      'Soporte (PDF)',
    ),
    'Excluidas',
  )

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/** Nombre del archivo: `reporte-supertransporte_2026-08-01_2026-09-30.xlsx`. */
export function nombreArchivoSupertransporte(r: ReporteSupertransporte): string {
  return `reporte-supertransporte_${r.periodo.desde}_${r.periodo.hasta}.xlsx`
}
