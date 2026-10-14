import * as XLSX from 'xlsx';

/**
 * Excel convierte en fecha lo que se teclea como 2026-10-31 en una celda
 * General, y con `raw: false` SheetJS la devuelve en el formato regional
 * (31/10/2026 o 10/31/26), que el parser rechaza con razón porque no puede
 * saber si es día o mes. Una celda de fecha, en cambio, no es ambigua: trae el
 * número de serie. Se pasa a AAAA-MM-DD antes de leer la hoja.
 *
 * El libro se tiene que leer con `cellNF: true`: sin eso SheetJS no guarda el
 * formato de la celda y una fecha no se distingue de un número.
 */
export function fechasExcelAISO(hoja: XLSX.WorkSheet | undefined): void {
  if (!hoja) return;
  for (const ref of Object.keys(hoja)) {
    if (ref.startsWith('!')) continue;
    const celda = hoja[ref] as XLSX.CellObject;
    const esFecha =
      celda.t === 'd' || (celda.t === 'n' && typeof celda.z === 'string' && XLSX.SSF.is_date(celda.z));
    if (!esFecha) continue;
    const p = celda.t === 'd'
      ? null
      : XLSX.SSF.parse_date_code(celda.v as number);
    const iso = p
      ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`
      : celda.v instanceof Date
        ? celda.v.toISOString().slice(0, 10)
        : null;
    if (!iso) continue;
    hoja[ref] = { t: 's', v: iso, w: iso };
  }
}
