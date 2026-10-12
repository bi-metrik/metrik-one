import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { fechasExcelAISO } from './fechas-excel';

/** Escribe y vuelve a leer, como pasa con un archivo guardado en Excel. */
function hojaConFecha(formato: string) {
  const ws = XLSX.utils.aoa_to_sheet([['relacion_desde', 'documento', 'texto'], [46326, 1012345678, '2026-10-31']]);
  ws.B2 = { t: 'n', v: 1012345678 };
  (ws.A2 as XLSX.CellObject).z = formato;
  const buf = XLSX.write({ SheetNames: ['S'], Sheets: { S: ws } }, { type: 'buffer', bookType: 'xlsx' });
  return XLSX.read(buf, { type: 'buffer', cellNF: true }).Sheets.S;
}

describe('fechasExcelAISO', () => {
  it.each(['d/mm/yyyy', 'm/d/yy', 'yyyy-mm-dd'])('una celda de fecha con formato %s sale AAAA-MM-DD', (formato) => {
    const hoja = hojaConFecha(formato);
    fechasExcelAISO(hoja);
    const [fila] = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { raw: false });
    expect(fila.relacion_desde).toBe('2026-10-31');
  });

  it('no toca números que no son fechas ni textos', () => {
    const hoja = hojaConFecha('d/mm/yyyy');
    fechasExcelAISO(hoja);
    const [fila] = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { raw: false });
    expect(fila.documento).toBe('1012345678');
    expect(fila.texto).toBe('2026-10-31');
  });

  it('sin la conversión, el formato regional llega ambiguo (lo que fallaba)', () => {
    const [fila] = XLSX.utils.sheet_to_json<Record<string, unknown>>(hojaConFecha('d/mm/yyyy'), { raw: false });
    expect(fila.relacion_desde).toBe('31/10/2026');
  });
});
