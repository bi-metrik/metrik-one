/**
 * C1 del concepto de Emilio (2026-08-31): el clasificador se conecta en modo
 * OBSERVABLE, y **ninguna ruta de compras cambia su comportamiento**.
 *
 * Verificación que pide el concepto, textual: "existe una prueba que corre el
 * flujo de compras con y sin clasificación y demuestra idéntico resultado".
 *
 * Por qué importa que esto esté probado y no solo razonado: la clasificación por
 * tier es hoy una afirmación normativa de MéTRIK sin firma jurídica. Que además
 * moviera una contratación sería MéTRIK decidiendo sobre el negocio del cliente
 * con una autoridad que todavía no tiene. La separación es lo que hace admisible
 * conectarlo ya, y lo único que la sostiene es que `severidad` siga siendo el
 * único campo del que dependen la bandeja y la auditoría.
 *
 * Las dos rutas que se comparan son las que pueden frenar o señalar una
 * contratación:
 *   - `auditarBaseDeCompras` (R5), que emite los veredictos de auditoría.
 *   - `listarTableroLiberaciones`, que decide en qué bandeja cae cada contraparte.
 *
 * VERIFICADO POR MUTACIÓN (2026-08-31):
 *   - que la auditoría lea `tier_maximo` para decidir el veredicto → cae 1
 *   - que la bandeja seleccione `tier_maximo` y degrade los medios a limpio → caen 2
 *
 * Nota sobre la segunda: para que fallara hubo que AGREGAR `tier_maximo` al
 * `select`. Hoy la consulta de la bandeja ni siquiera trae esas columnas, que es
 * una garantía más fuerte que la prueba: no puede mirar lo que no pidió.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

type Fila = Record<string, unknown>;
let fixtures: Record<string, Fila[]> = {};

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
}));
vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-alma', role: 'owner' }),
}));
vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: { id: 'user-oficial' } }),
}));
vi.mock('./_usuarios', () => ({ resolverNombresUsuarios: async () => new Map() }));
vi.mock('@/lib/dates/bogota', () => ({ todayBogotaISO: () => '2026-08-31' }));

import { auditarBaseDeCompras } from './compliance-auditoria-compras';
import { listarTableroLiberaciones } from './compliance-liberaciones';

function servicioFalso() {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = [];
      const resolver = () => (fixtures[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
      const chain = {
        select: () => chain,
        eq: (campo: string, valor: unknown) => {
          filtros.push((f) => f[campo] === valor);
          return chain;
        },
        in: () => chain,
        gte: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => chain,
        single: async () => ({ data: resolver()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: resolver()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Fila[]; error: null }) => unknown) =>
          resolve({ data: resolver(), error: null }),
      };
      return chain;
    },
  };
}

/**
 * Las mismas consultas, en dos versiones: sin clasificar (como antes del
 * 2026-08-31) y clasificadas con los valores MÁS extremos que el clasificador
 * puede producir. Si alguna ruta mirara el tier, estas dos entradas darían
 * resultados distintos.
 */
function consultas(conTier: boolean): Fila[] {
  const base = (p: Fila): Fila => ({
    workspace_id: 'ws-alma',
    severidad: 'alto',
    total_matches: 3,
    matches: [],
    created_by: 'user-analista',
    ...p,
  });

  const tier = (valores: Fila) => (conTier ? valores : {});

  return [
    base({
      id: 'c-tier1', documento_tipo: 'NIT', documento_numero: '900111111',
      nombre_consultado: 'Sancionada ONU', created_at: '2026-06-01T10:00:00.000Z',
      // El caso más grave que el clasificador puede emitir.
      ...tier({
        tier_maximo: 'tier_1', tier_sin_clasificar: false, tier_hallazgos: 3,
        tier_duplicados: 0, tier_opera: true, tier_catalogo_version: 1,
      }),
    }),
    base({
      id: 'c-medios', documento_tipo: 'NIT', documento_numero: '900222222',
      nombre_consultado: 'Solo prensa', created_at: '2026-06-02T10:00:00.000Z',
      // El más leve. Si el tier decidiera algo, esta bajaría de categoría.
      ...tier({
        tier_maximo: 'medios', tier_sin_clasificar: false, tier_hallazgos: 25,
        tier_duplicados: 0, tier_opera: true, tier_catalogo_version: 1,
      }),
    }),
    base({
      id: 'c-desconocida', documento_tipo: 'NIT', documento_numero: '900333333',
      nombre_consultado: 'Fuente nueva', created_at: '2026-06-03T10:00:00.000Z',
      ...tier({
        tier_maximo: 'sin_clasificar', tier_sin_clasificar: true, tier_hallazgos: 1,
        tier_duplicados: 0, tier_opera: false, tier_catalogo_version: 1,
        tier_fuentes_sin_clasificar: ['REGISTRO QUE NO EXISTE'],
      }),
    }),
    base({
      id: 'c-limpia', documento_tipo: 'NIT', documento_numero: '900444444',
      nombre_consultado: 'Limpia', severidad: 'sin_hallazgo', total_matches: 0,
      created_at: '2026-06-04T10:00:00.000Z',
      ...tier({ tier_maximo: null, tier_sin_clasificar: false, tier_opera: true }),
    }),
  ];
}

function archivoCompras(): FormData {
  const filas = [
    { documento_tipo: 'NIT', documento: '900111111', nombre: 'Sancionada ONU', fecha: '15/06/2026' },
    { documento_tipo: 'NIT', documento: '900222222', nombre: 'Solo prensa', fecha: '15/06/2026' },
    { documento_tipo: 'NIT', documento: '900333333', nombre: 'Fuente nueva', fecha: '15/06/2026' },
    { documento_tipo: 'NIT', documento: '900444444', nombre: 'Limpia', fecha: '15/06/2026' },
  ];
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

beforeEach(() => {
  fixtures = { consultas_listas_dual: [], compliance_liberaciones: [] };
});

describe('C1 — la clasificación se observa, no decide', () => {
  it('la auditoría de contrataciones da el mismo resultado con y sin tier', async () => {
    fixtures.consultas_listas_dual = consultas(false);
    const sinTier = await auditarBaseDeCompras(archivoCompras());

    fixtures.consultas_listas_dual = consultas(true);
    const conTier = await auditarBaseDeCompras(archivoCompras());

    expect(sinTier.ok && conTier.ok).toBe(true);
    if (!sinTier.ok || !conTier.ok) throw new Error('inalcanzable');

    expect(conTier.data.filas.map((f) => f.veredicto))
      .toEqual(sinTier.data.filas.map((f) => f.veredicto));
    expect(conTier.data.resumen).toEqual(sinTier.data.resumen);
  });

  it('la bandeja del oficial da el mismo resultado con y sin tier', async () => {
    fixtures.consultas_listas_dual = consultas(false);
    const sinTier = await listarTableroLiberaciones();

    fixtures.consultas_listas_dual = consultas(true);
    const conTier = await listarTableroLiberaciones();

    expect(sinTier.ok && conTier.ok).toBe(true);
    if (!sinTier.ok || !conTier.ok) throw new Error('inalcanzable');

    const resumen = (d: typeof sinTier.data) => ({
      sin_cobertura: d.sin_cobertura_vigente.map((c) => c.documento_numero),
      sin_decidir: d.hallazgos_sin_decidir.map((c) => c.documento_numero),
      excepciones: d.excepciones_vigentes.map((c) => c.documento_numero),
      rechazadas: d.rechazadas.map((c) => c.documento_numero),
      vigilancia: d.vigilancia_continua,
      indicadores: d.indicadores,
    });
    expect(resumen(conTier.data)).toEqual(resumen(sinTier.data));
  });

  // El Tier 1 y las menciones de prensa siguen cayendo en la MISMA bandeja: hoy
  // el tier no reordena nada. Si esto cambia sin pasar por el bloque B del
  // concepto, esta prueba se cae y obliga a mirar por qué.
  it('un Tier 1 y una consulta de puros medios siguen en la misma bandeja', async () => {
    fixtures.consultas_listas_dual = consultas(true);
    const r = await listarTableroLiberaciones();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    const enCola = r.data.hallazgos_sin_decidir.map((c) => c.documento_numero);
    expect(enCola).toContain('900111111'); // tier_1
    expect(enCola).toContain('900222222'); // medios
  });
});
