/**
 * R5 — cableado de la auditoría por cruce con la base de compras.
 *
 * Lo que estas pruebas cuidan, que la regla pura no puede cuidar sola:
 *
 * 1. El aislamiento por workspace se pone a mano: el service client bypasea RLS.
 *    Una consulta de otro cliente que "justificara" una compra sería la peor
 *    forma de fallar, porque el informe se vería impecable.
 * 2. Las filas que no se pueden leer se REPORTAN, no se descartan. Un archivo
 *    con 40 fechas ilegibles no puede salir "sin hallazgos".
 * 3. Nada de esto llama a la fuente: auditar el pasado no gasta cuota del cliente.
 *
 * El doble es un mini motor de consultas sobre fixtures, consciente de la tabla
 * y de los filtros: si el código deja de filtrar por `workspace_id`, la fila
 * ajena aparece y la prueba cae.
 *
 * VERIFICADO POR MUTACIÓN (2026-08-31) — cada mutación tumbó pruebas:
 *   - quitar `.eq('workspace_id')` de las consultas → cae "no cruza con otro workspace"
 *   - descartar en silencio las filas sin documento → cae "las inválidas cuentan en el total"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

type Fila = Record<string, unknown>;
let fixtures: Record<string, Fila[]> = {};
let rolActual: string | null = 'owner';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
}));

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-alma', role: rolActual }),
}));

vi.mock('./_usuarios', () => ({
  resolverNombresUsuarios: async () =>
    new Map([
      ['user-analista', 'Analista de Compras'],
      ['user-oficial', 'Yessica Vásquez'],
    ]),
}));

import {
  auditarBaseDeCompras,
  generarPlantillaAuditoriaCompras,
} from './compliance-auditoria-compras';

function servicioFalso() {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = [];
      const resolver = (): Fila[] => (fixtures[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
      const chain = {
        select: () => chain,
        eq: (campo: string, valor: unknown) => {
          filtros.push((f) => f[campo] === valor);
          return chain;
        },
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (v: { data: Fila[]; error: null }) => unknown) =>
          resolve({ data: resolver(), error: null }),
      };
      return chain;
    },
  };
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

function consulta(p: Partial<Fila> = {}): Fila {
  return {
    id: 'consulta-1',
    workspace_id: 'ws-alma',
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    severidad: 'alto',
    total_matches: 3,
    created_at: '2026-06-01T10:00:00.000Z',
    created_by: 'user-analista',
    ...p,
  };
}

function liberacion(p: Partial<Fila> = {}): Fila {
  return {
    id: 'lib-1',
    workspace_id: 'ws-alma',
    consulta_id: 'consulta-1',
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    nombre: 'Acme SAS',
    decision: 'liberada',
    justificacion: 'Homonimia verificada.',
    vigente_desde: '2026-06-02',
    vigente_hasta: '2026-12-31',
    control_id: null,
    liberada_por: 'user-oficial',
    created_at: '2026-06-02T10:00:00.000Z',
    ...p,
  };
}

/** Arma un XLSX en memoria con el shape de la plantilla. */
function archivo(filas: Array<Record<string, string>>): FormData {
  const hoja = XLSX.utils.json_to_sheet(filas, {
    header: ['documento_tipo', 'documento', 'nombre', 'fecha', 'referencia', 'comprador', 'valor'],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja, 'Compras');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const fd = new FormData();
  fd.append('archivo', new File([new Uint8Array(buf)], 'compras.xlsx'));
  return fd;
}

const COMPRA_OK = {
  documento_tipo: 'NIT',
  documento: '900123456',
  nombre: 'Acme SAS',
  fecha: '15/06/2026',
  referencia: 'OC-1001',
  comprador: 'Juan Pérez',
  valor: '12000000',
};

beforeEach(() => {
  fixtures = {
    consultas_listas_dual: [consulta()],
    compliance_liberaciones: [],
  };
  rolActual = 'owner';
  fetchMock.mockReset();
});

// ─── Guard ─────────────────────────────────────────────────────────────────

describe('la auditoría es del oficial de cumplimiento', () => {
  it('un operador no puede correrla', async () => {
    rolActual = 'operator';
    const r = await auditarBaseDeCompras(archivo([COMPRA_OK]));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toBe('forbidden_solo_oficial_cumplimiento');
  });

  it('tampoco puede bajar la plantilla', async () => {
    rolActual = 'read_only';
    const r = await generarPlantillaAuditoriaCompras();
    expect(r.ok).toBe(false);
  });
});

// ─── Costo ─────────────────────────────────────────────────────────────────

describe('R5 NUNCA llama a la fuente', () => {
  it('auditar el pasado no gasta una consulta facturable', async () => {
    await auditarBaseDeCompras(archivo([COMPRA_OK]));
    await generarPlantillaAuditoriaCompras();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── El cruce ──────────────────────────────────────────────────────────────

describe('auditarBaseDeCompras', () => {
  it('con hallazgo y sin liberación: hallazgo de auditoría', async () => {
    const r = await auditarBaseDeCompras(archivo([COMPRA_OK]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.resumen.hallazgos).toBe(1);
    expect(r.data.filas[0].veredicto).toBe('hallazgo_sin_liberacion');
    expect(r.data.filas[0].consulto).toBe('Analista de Compras');
    expect(r.data.filas[0].compra.referencia).toBe('OC-1001');
  });

  it('con liberación previa vigente: sin hallazgo, y dice quién liberó', async () => {
    fixtures.compliance_liberaciones = [liberacion()];
    const r = await auditarBaseDeCompras(archivo([COMPRA_OK]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.resumen.hallazgos).toBe(0);
    expect(r.data.filas[0].veredicto).toBe('cubierta');
    expect(r.data.filas[0].libero).toBe('Yessica Vásquez');
    expect(r.data.filas[0].liberacion_vigente_hasta).toBe('2026-12-31');
  });

  // El caso que define R5: liberar al cierre del periodo no limpia el informe.
  it('una liberación firmada después de la compra no la limpia', async () => {
    fixtures.compliance_liberaciones = [
      liberacion({ created_at: '2026-07-20T10:00:00.000Z' }),
    ];
    const r = await auditarBaseDeCompras(archivo([COMPRA_OK]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.filas[0].veredicto).toBe('hallazgo_sin_liberacion');
  });

  it('una contraparte que nunca se consultó sale como sin consulta previa', async () => {
    const r = await auditarBaseDeCompras(
      archivo([{ ...COMPRA_OK, documento: '901999999', nombre: 'Nueva SAS' }]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.filas[0].veredicto).toBe('sin_consulta');
  });

  it('no cruza con las consultas de otro workspace', async () => {
    fixtures.consultas_listas_dual = [
      consulta({ workspace_id: 'ws-otro', severidad: 'sin_hallazgo', total_matches: 0 }),
    ];
    const r = await auditarBaseDeCompras(archivo([COMPRA_OK]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.filas[0].veredicto).toBe('sin_consulta');
  });

  it('no toma liberaciones de otro workspace', async () => {
    fixtures.compliance_liberaciones = [liberacion({ workspace_id: 'ws-otro' })];
    const r = await auditarBaseDeCompras(archivo([COMPRA_OK]));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.filas[0].veredicto).toBe('hallazgo_sin_liberacion');
  });

  it('lo peor va primero en el informe', async () => {
    fixtures.consultas_listas_dual = [
      consulta(),
      consulta({ id: 'c-2', documento_numero: '900222222' }),
    ];
    fixtures.compliance_liberaciones = [
      liberacion({ id: 'l-2', documento_numero: '900222222', decision: 'rechazada', vigente_hasta: null }),
    ];
    const r = await auditarBaseDeCompras(
      archivo([COMPRA_OK, { ...COMPRA_OK, documento: '900222222' }]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.filas.map((f) => f.veredicto)).toEqual([
      'contratada_pese_a_rechazo',
      'hallazgo_sin_liberacion',
    ]);
  });
});

// ─── Filas que no se pueden leer ───────────────────────────────────────────

describe('las filas ilegibles se reportan, no se descartan', () => {
  it('una fecha ilegible sale con su número de fila y su motivo', async () => {
    const r = await auditarBaseDeCompras(
      archivo([{ ...COMPRA_OK, fecha: 'junio' }, COMPRA_OK]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.invalidas).toHaveLength(1);
    expect(r.data.invalidas[0].posicion).toBe(2);
    expect(r.data.invalidas[0].motivo).toContain('fecha_ilegible');
    expect(r.data.invalidas[0].eco).toContain('Acme SAS');
  });

  it('las inválidas cuentan en el total: el archivo no se audita a medias en silencio', async () => {
    const r = await auditarBaseDeCompras(
      archivo([{ ...COMPRA_OK, documento: '' }, COMPRA_OK]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.resumen.total_filas).toBe(2);
    expect(r.data.resumen.filas_invalidas).toBe(1);
    expect(r.data.filas).toHaveLength(1);
  });

  it('un archivo sin filas es error, no un informe vacío', async () => {
    const r = await auditarBaseDeCompras(archivo([]));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toBe('xlsx_vacio');
  });

  it('un archivo que no es XLSX es error', async () => {
    const fd = new FormData();
    fd.append('archivo', new File(['no soy un excel'], 'x.txt'));
    const r = await auditarBaseDeCompras(fd);
    expect(r.ok).toBe(false);
  });
});

// ─── Plantilla ─────────────────────────────────────────────────────────────

describe('generarPlantillaAuditoriaCompras', () => {
  it('emite las columnas que el parser lee', async () => {
    const r = await generarPlantillaAuditoriaCompras();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');

    const wb = XLSX.read(Buffer.from(r.data.base64, 'base64'), { type: 'buffer' });
    expect(wb.SheetNames).toContain('Compras');
    const headers = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Compras'], { header: 1 })[0];
    expect(headers).toEqual([
      'documento_tipo', 'documento', 'nombre', 'fecha', 'referencia', 'comprador', 'valor',
    ]);
  });

  // Las dos puntas tienen que hablar el mismo idioma: si la plantilla cambia y
  // el parser no, el oficial sube el archivo que le dimos y sale todo inválido.
  it('lo que emite la plantilla lo puede leer el parser', async () => {
    const r = await generarPlantillaAuditoriaCompras();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');

    const wb = XLSX.read(Buffer.from(r.data.base64, 'base64'), { type: 'buffer' });
    const hoja = wb.Sheets['Compras'];
    XLSX.utils.sheet_add_json(hoja, [COMPRA_OK], { skipHeader: true, origin: -1 });
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const fd = new FormData();
    fd.append('archivo', new File([new Uint8Array(buf)], 'compras.xlsx'));
    const auditoria = await auditarBaseDeCompras(fd);
    expect(auditoria.ok).toBe(true);
    if (!auditoria.ok) throw new Error('inalcanzable');
    expect(auditoria.data.invalidas).toHaveLength(0);
    expect(auditoria.data.filas).toHaveLength(1);
  });
});
