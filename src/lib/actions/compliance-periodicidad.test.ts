/**
 * R2 — cableado de la configuración de periodicidad.
 *
 * Lo que estas pruebas cuidan, que la regla pura no puede cuidar sola:
 *
 * 1. La política es del oficial de cumplimiento. Un operador que pudiera alargar
 *    la vigencia apagaría la vigilancia sin que nadie lo note.
 * 2. Los niveles que el workspace no configuró se completan con la sugerencia y
 *    se dicen como tales. Devolver huecos dejaría sin vigencia a toda consulta
 *    de ese nivel, o sea la sacaría del barrido en silencio.
 * 3. El aislamiento por workspace se pone a mano: el service client bypasea RLS.
 *
 * VERIFICADO POR MUTACIÓN (2026-08-31):
 *   - dejar pasar el rol no-oficial → caen 2
 *   - devolver solo las filas guardadas, sin completar con el sugerido → caen 2
 *   - quitar `.eq('workspace_id')` de la carga → cae 1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
let fixtures: Record<string, Fila[]> = {};
let rolActual: string | null = 'owner';
let ultimoUpsert: Fila | null = null;

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => servicioFalso() }));
vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-alma', role: rolActual }),
}));
vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: { id: 'user-oficial' } }),
}));

import {
  cargarConfigPeriodicidad,
  guardarPeriodicidad,
  listarPeriodicidad,
} from './compliance-periodicidad';
import { DEFAULT_SUGERIDO, NIVELES } from '@/lib/compliance/periodicidad';

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
        upsert: async (fila: Fila) => {
          ultimoUpsert = fila;
          return { error: null };
        },
        then: (resolve: (v: { data: Fila[]; error: null }) => unknown) =>
          resolve({ data: resolver(), error: null }),
      };
      return chain;
    },
  };
}

beforeEach(() => {
  fixtures = { compliance_periodicidad_config: [] };
  rolActual = 'owner';
  ultimoUpsert = null;
});

describe('la periodicidad la fija el oficial de cumplimiento', () => {
  it('un operador no puede verla', async () => {
    rolActual = 'operator';
    const r = await listarPeriodicidad();
    expect(r.ok).toBe(false);
  });

  it('un supervisor no puede cambiarla', async () => {
    rolActual = 'supervisor';
    const r = await guardarPeriodicidad({ nivel: 'tier_1', meses: 24 });
    expect(r.ok).toBe(false);
    expect(ultimoUpsert).toBeNull();
  });
});

describe('listarPeriodicidad', () => {
  it('sin nada guardado devuelve los siete niveles, marcados como sugeridos', async () => {
    const r = await listarPeriodicidad();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data).toHaveLength(NIVELES.length);
    expect(r.data.every((f) => f.es_sugerido)).toBe(true);
    expect(r.data.find((f) => f.nivel === 'sin_hallazgo')?.meses).toBe(12);
  });

  it('lo guardado manda sobre el sugerido, y deja de marcarse como sugerido', async () => {
    fixtures.compliance_periodicidad_config = [
      { workspace_id: 'ws-alma', nivel: 'tier_1', meses: 1, updated_at: '2026-08-31T10:00:00.000Z' },
    ];
    const r = await listarPeriodicidad();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    const fila = r.data.find((f) => f.nivel === 'tier_1');
    expect(fila?.meses).toBe(1);
    expect(fila?.es_sugerido).toBe(false);
    // Los demás siguen completos: un hueco sacaría esas consultas del barrido.
    expect(r.data.every((f) => typeof f.meses === 'number')).toBe(true);
  });

  it('no lee la configuración de otro workspace', async () => {
    fixtures.compliance_periodicidad_config = [
      { workspace_id: 'ws-otro', nivel: 'tier_1', meses: 48, updated_at: '2026-08-31T10:00:00.000Z' },
    ];
    const r = await listarPeriodicidad();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.find((f) => f.nivel === 'tier_1')?.meses).toBe(DEFAULT_SUGERIDO.tier_1);
  });
});

describe('guardarPeriodicidad', () => {
  it('guarda un valor válido con quién lo cambió', async () => {
    const r = await guardarPeriodicidad({ nivel: 'medios', meses: '18' });
    expect(r.ok).toBe(true);
    expect(ultimoUpsert).toMatchObject({
      workspace_id: 'ws-alma', nivel: 'medios', meses: 18, actualizado_por: 'user-oficial',
    });
  });

  it('rechaza un nivel que no existe en el catálogo', async () => {
    const r = await guardarPeriodicidad({ nivel: 'riesgo_alto', meses: 3 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toBe('nivel_invalido');
    expect(ultimoUpsert).toBeNull();
  });

  // Cero meses volvería el motor de R3 un gasto infinito contra la cuenta del
  // cliente; un número absurdo apagaría la vigilancia. Ninguno llega a la base.
  it('rechaza cero y el absurdo antes de tocar la base', async () => {
    expect((await guardarPeriodicidad({ nivel: 'tier_1', meses: 0 })).ok).toBe(false);
    expect((await guardarPeriodicidad({ nivel: 'tier_1', meses: 999 })).ok).toBe(false);
    expect(ultimoUpsert).toBeNull();
  });
});

describe('cargarConfigPeriodicidad — lo que consume la regla', () => {
  it('siempre entrega los siete niveles completos', async () => {
    const config = await cargarConfigPeriodicidad('ws-alma');
    for (const n of NIVELES) expect(typeof config[n]).toBe('number');
  });

  it('lo guardado sobrescribe el sugerido', async () => {
    fixtures.compliance_periodicidad_config = [
      { workspace_id: 'ws-alma', nivel: 'sin_hallazgo', meses: 6 },
    ];
    expect((await cargarConfigPeriodicidad('ws-alma')).sin_hallazgo).toBe(6);
  });
});
