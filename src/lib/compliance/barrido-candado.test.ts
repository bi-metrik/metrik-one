import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * QA ALMA 2026-10-12, M1: el botón "Correr ahora" no tomaba candado, y botón y
 * cron a la vez consultaban y cobraban dos veces lo mismo. El candado vive en
 * `ejecutarBarrido`, que llaman los dos.
 *
 * VERIFICADO POR MUTACIÓN
 *
 *  1. no se mira el resultado de `tomar_candado` (el segundo barrido corre
 *     igual) -> cae 1
 *  2. si `tomar_candado` falla se barre sin candado (falla abierto) -> cae 1
 *  3. el candado no se suelta al terminar (una segunda corrida en serie el
 *     mismo día queda bloqueada 5 minutos) -> cae 1
 */

const rpc = vi.fn();
const updates: Array<{ tabla: string; valores: Record<string, unknown> }> = [];

function cadena(tabla: string) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'in', 'is', 'not', 'range']) q[m] = self;
  q.update = (valores: Record<string, unknown>) => {
    updates.push({ tabla, valores });
    return q;
  };
  q.then = (res: (v: unknown) => unknown) => res({ data: null, error: null });
  q.maybeSingle = async () => {
    // La config del workspace: no adoptado → nada que barrer más allá del registro.
    throw new Error('corta-aqui');
  };
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ rpc, from: (t: string) => cadena(t) }),
}));

import { BarridoEnCurso, claveCandadoBarrido, ejecutarBarrido } from './barrido';

describe('candado del barrido', () => {
  beforeEach(() => {
    rpc.mockReset();
    updates.length = 0;
  });

  it('la llave es por workspace y día', () => {
    expect(claveCandadoBarrido('ws-1', '2026-10-14')).toBe('barrido-compliance:ws-1:2026-10-14');
    expect(claveCandadoBarrido('ws-1', '2026-10-14')).not.toBe(claveCandadoBarrido('ws-2', '2026-10-14'));
  });

  it('si otro barrido tiene el candado, no barre', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(ejecutarBarrido('ws-1', '2026-10-14')).rejects.toBeInstanceOf(BarridoEnCurso);
    expect(rpc).toHaveBeenCalledWith('tomar_candado', {
      p_clave: 'barrido-compliance:ws-1:2026-10-14',
      p_segundos: expect.any(Number),
    });
    // Ni siquiera se soltó: no era suyo.
    expect(updates).toHaveLength(0);
  });

  it('si no se puede tomar el candado, no barre (falla cerrado)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'base caída' } });
    await expect(ejecutarBarrido('ws-1', '2026-10-14')).rejects.toThrow('barrido_sin_candado');
  });

  it('suelta el candado al terminar, aunque el barrido falle', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(ejecutarBarrido('ws-1', '2026-10-14')).rejects.toThrow('corta-aqui');
    const soltado = updates.find((u) => u.tabla === 'claves_idempotencia');
    expect(soltado).toBeDefined();
    expect(new Date(String(soltado!.valores.vence_at)).getTime()).toBeLessThanOrEqual(Date.now());
  });
});
