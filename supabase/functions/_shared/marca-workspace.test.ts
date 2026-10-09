import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARCA_POR_DEFECTO, marcaDelWorkspace } from './marca-workspace';

// Columnas reales de `workspaces` (src/types/database.ts). El falso se comporta como
// PostgREST: una columna que no existe devuelve error 42703 y `data` null. Asi la prueba
// mata el bug de SOE-010 (pedir `nombre`), no solo el mapeo de la respuesta.
const COLUMNAS = new Set(['id', 'name', 'slug', 'config_extra', 'modules']);

function falso(fila: Record<string, unknown> | null) {
  const pedidas: string[] = [];
  const supabase = {
    from(tabla: string) {
      expect(tabla).toBe('workspaces');
      let cols: string[] = [];
      const q = {
        select(s: string) {
          cols = s.split(',').map((c) => c.trim());
          pedidas.push(s);
          return q;
        },
        eq() {
          return q;
        },
        async maybeSingle() {
          const mala = cols.find((c) => !COLUMNAS.has(c));
          if (mala) {
            return { data: null, error: { code: '42703', message: `column workspaces.${mala} does not exist` } };
          }
          if (!fila) return { data: null, error: null };
          return { data: Object.fromEntries(cols.map((c) => [c, fila[c]])), error: null };
        },
      };
      return q;
    },
  };
  return { supabase, pedidas };
}

describe('marcaDelWorkspace', () => {
  afterEach(() => vi.restoreAllMocks());

  it('la marca sale del name del workspace (SOENA) y trae config_extra', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = falso({ id: 'w1', name: ' SOENA ', config_extra: { email_respuesta: 'hola@soena.co' } });
    const r = await marcaDelWorkspace(supabase, 'w1');
    expect(r.marca).toBe('SOENA');
    expect(r.configExtra).toEqual({ email_respuesta: 'hola@soena.co' });
    expect(espia).not.toHaveBeenCalled();
  });

  it('sin nombre cae al respaldo neutro', async () => {
    const { supabase } = falso({ id: 'w1', name: '  ', config_extra: null });
    expect((await marcaDelWorkspace(supabase, 'w1')).marca).toBe(MARCA_POR_DEFECTO);
  });

  it('sin workspace_id no consulta', async () => {
    const { supabase, pedidas } = falso(null);
    expect((await marcaDelWorkspace(supabase, null)).marca).toBe(MARCA_POR_DEFECTO);
    expect(pedidas).toEqual([]);
  });

  it('un error de la consulta se registra, no se traga', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }),
      }),
    };
    const r = await marcaDelWorkspace(supabase, 'w1');
    expect(r).toEqual({ marca: MARCA_POR_DEFECTO, configExtra: null });
    expect(espia).toHaveBeenCalledOnce();
    expect(String(espia.mock.calls[0][0])).toContain('w1');
  });
});
