/**
 * Segmento de la contraparte (R1) — parseo del lote y guarda de costo.
 *
 * Dos cosas que este módulo NO puede volver a hacer:
 *
 * 1. Saltarse una fila en silencio. Ya produjo tres falsos negativos en
 *    producción; una fila que no resuelve su segmento tiene que salir marcada
 *    con el motivo, no desaparecer del lote.
 * 2. Gastar una consulta facturable de la cuenta del cliente para después
 *    rechazarla. Por eso el segmento se valida ANTES del fetch, y estos tests
 *    afirman que `fetch` no se llamó.
 *
 * VISTOS FALLAR (2026-08-20): se movió la validación de segmento a después de
 * `consultaDual()` y cayeron los 3 tests de "no llama a la fuente"; se cambió
 * el `if (!segmento)` de fila por un `continue` silencioso y cayeron los 2 de
 * "fila inválida queda marcada".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-test' } } }),
      // `getCachedUser` resuelve al usuario verificando la firma del token
      // (`getClaims`), no preguntandole al servidor de Auth. El doble mock deja
      // el test valido con cualquiera de los dos caminos.
      getClaims: async () => ({ data: { claims: { sub: 'user-test' } }, error: null }),
    },
  }),
  createServiceClient: () => servicioFalso(),
}));

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-test', role: 'owner' }),
}));

vi.mock('./_usuarios', () => ({
  resolverNombresUsuarios: async () => new Map<string, string>(),
}));

const listarSegmentosMock = vi.fn();
vi.mock('./compliance-segmentos', () => ({
  listarSegmentos: (...args: unknown[]) => listarSegmentosMock(...args),
}));

import { prepararLoteDual, consultaDualPersistente } from './compliance-dual';

// ─── Dobles ────────────────────────────────────────────────────────────────

const CATALOGO = [
  { id: 'seg-contraparte', nombre: 'Contraparte', universo: 'contraparte', activo: true, orden: 1 },
  { id: 'seg-empleado', nombre: 'Empleado', universo: 'empleado', activo: true, orden: 2 },
];

/** Fila que devuelve `compliance_segmentos` en la validación previa al fetch. */
let filaSegmento: Record<string, unknown> | null = null;

/**
 * El doble tiene que ser consciente de la tabla: si `workspaces` no devuelve
 * `slug`, `consultaDual` aborta antes del fetch y el `not.toHaveBeenCalled()` de
 * los tests de costo pasaría por la razón equivocada — verificado moviendo la
 * validación de segmento después del fetch: con el doble ingenuo nadie se
 * enteraba.
 */
function servicioFalso() {
  return {
    from: (tabla: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: filaSegmento, error: null }),
        single: async () =>
          tabla === 'workspaces'
            ? { data: { slug: 'alma-afi' }, error: null }
            : { data: { id: 'consulta-1' }, error: null },
        insert: () => chain,
      };
      return chain;
    },
  };
}

function xlsx(filas: Array<Record<string, string>>): FormData {
  const hoja = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja, 'Consultas');
  // `type: 'array'` (ArrayBuffer) y no 'buffer': el Buffer de Node no encaja en
  // BlobPart bajo TypeScript strict.
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const fd = new FormData();
  fd.append('archivo', new File([buf], 'lote.xlsx'));
  return fd;
}

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.VALIDA_API_KEY = 'test-key';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  listarSegmentosMock.mockReset();
  listarSegmentosMock.mockResolvedValue({ ok: true, data: CATALOGO });
  filaSegmento = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── prepararLoteDual ──────────────────────────────────────────────────────

describe('prepararLoteDual — columna segmento', () => {
  it('resuelve el segmento contra el catálogo del workspace', async () => {
    const r = await prepararLoteDual(
      xlsx([{ tipo: 'juridica', identificacion: '900123456', nombre: 'Acme SAS', segmento: 'Contraparte' }]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.filas[0].error).toBeNull();
    expect(r.data.filas[0].input.segmento_id).toBe('seg-contraparte');
  });

  it('acepta la celda escrita con otra caja o con tildes', async () => {
    const r = await prepararLoteDual(
      xlsx([{ tipo: 'natural', identificacion: '1077089147', nombre: 'Juan Pérez', segmento: '  EMPLEADO ' }]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.filas[0].error).toBeNull();
    expect(r.data.filas[0].input.segmento_id).toBe('seg-empleado');
  });

  it('fila sin segmento queda marcada como error, no se salta', async () => {
    const r = await prepararLoteDual(
      xlsx([{ tipo: 'natural', identificacion: '123', nombre: 'Sin Segmento', segmento: '' }]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.filas).toHaveLength(1);
    expect(r.data.filas[0].error).toContain('fila_sin_segmento');
    expect(r.data.filas[0].input.segmento_id).toBeNull();
  });

  it('segmento desconocido dice cuál era y qué se esperaba', async () => {
    const r = await prepararLoteDual(
      xlsx([{ tipo: 'natural', identificacion: '123', nombre: 'X', segmento: 'Cliente VIP' }]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    const err = r.data.filas[0].error ?? '';
    expect(err).toContain('segmento_invalido');
    expect(err).toContain('Cliente VIP');
    expect(err).toContain('Contraparte');
    expect(err).toContain('Empleado');
  });

  it('una fila mala no invalida las buenas del mismo archivo', async () => {
    const r = await prepararLoteDual(
      xlsx([
        { tipo: 'natural', identificacion: '111', nombre: 'Buena', segmento: 'Empleado' },
        { tipo: 'natural', identificacion: '222', nombre: 'Mala', segmento: 'Inexistente' },
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.total).toBe(2);
    expect(r.data.filas[0].error).toBeNull();
    expect(r.data.filas[1].error).toContain('segmento_invalido');
  });

  it('catálogo vacío corta el cargue completo con instrucción, no fila por fila', async () => {
    listarSegmentosMock.mockResolvedValue({ ok: true, data: [] });
    const r = await prepararLoteDual(
      xlsx([{ tipo: 'natural', identificacion: '123', nombre: 'X', segmento: 'Contraparte' }]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toContain('catalogo_segmentos_vacio');
  });

  it('parsear NUNCA llama a la fuente', async () => {
    await prepararLoteDual(
      xlsx([{ tipo: 'natural', identificacion: '123', nombre: 'X', segmento: 'Contraparte' }]),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── consultaDualPersistente: el segmento se valida antes de gastar ────────

describe('consultaDualPersistente — el segmento se valida antes de consultar', () => {
  it('sin segmento no consulta y lo dice', async () => {
    const r = await consultaDualPersistente({ tipo: 'natural', identificacion: '123', segmento_id: null });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toBe('segmento_requerido');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('segmento que no existe en el workspace no consulta', async () => {
    filaSegmento = null;
    const r = await consultaDualPersistente({
      tipo: 'natural',
      identificacion: '123',
      segmento_id: 'seg-de-otro-workspace',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toBe('segmento_no_encontrado');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('segmento desactivado no consulta y nombra cuál es', async () => {
    filaSegmento = { id: 'seg-viejo', nombre: 'Aliado', universo: 'contraparte', activo: false, orden: 3 };
    const r = await consultaDualPersistente({
      tipo: 'natural',
      identificacion: '123',
      segmento_id: 'seg-viejo',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toContain('segmento_inactivo');
    expect(r.error).toContain('Aliado');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fila de lote que ya venía inválida se registra con su motivo y no consulta', async () => {
    const r = await consultaDualPersistente(
      { tipo: 'natural', identificacion: '123', segmento_id: null },
      { tipo: 'masiva_item', lote_id: 'lote-1', error_fila: 'segmento_invalido "Cliente VIP"' },
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toContain('Cliente VIP');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
