/**
 * Contrato ONE <-> metrik-valida para el endpoint dual de listas restrictivas.
 *
 * Ejecutar con: npm test
 *
 * VISTOS FALLAR (2026-08-12). Se rompio a proposito el guard `if (!res.ok)` de
 * `jsonOrError` (cambiado a `res.status === 999`, o sea el fallo original: dejar
 * pasar un no-2xx como si fuera resultado) y cayeron 3 de 6 — los tres casos de
 * error. Los otros tres (200 con y sin hallazgos, caida de red) siguieron verdes
 * porque no dependen de ese guard. Sin esa comprobacion, un test verde no dice
 * nada: ver el gotcha del CLAUDE.md sobre la mutacion que no tumba ningun test.
 *
 * Contexto (2026-08-12): metrik-valida deja de responder siempre 200. Cuando la
 * fuente (Informa/SEIYA) falla o devuelve un payload ilegible, ahora responde
 * 502. El motivo es que un `total_matches: 0` nacido de un fallo se estaba
 * pintando como SIN HALLAZGO sobre entidades sancionadas por OFAC.
 *
 * Estos tests fijan el comportamiento de ONE, que ya esta desplegado consumiendo
 * ese endpoint: un no-2xx tiene que salir como { ok: false, error } y nunca como
 * un resultado con cero coincidencias.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// El modulo bajo prueba es una server action: se mockean sus dependencias de
// infraestructura para poder ejercitar la logica de red real.
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
  createServiceClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { slug: 'alma-afi' } }) }) }),
    }),
  }),
}));

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: 'ws-test' }),
}));

vi.mock('./_usuarios', () => ({
  resolverNombresUsuarios: async () => new Map<string, string>(),
}));

vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo());

import { consultaDual, consultaDualBatch } from './compliance-dual';
import { MODULES, reiniciarModulo } from '../../../test/exigir-modulo-doble';

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.VALIDA_API_KEY = 'test-key';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // alma-afi: Sustenta con la consulta dual, el unico workspace que la usa en produccion.
  reiniciarModulo('ws-test', { ...MODULES.almaAfi });
});

/**
 * TERCERA RONDA (2026-09-16): la consulta dual va con la llave GLOBAL de MeTRIK y se cobra.
 * La sesion no basta: la abre Sustenta con `compliance_dual_informa`.
 * VISTO FALLAR contra `origin/main`: caen los 3 casos sin modulo; quitando la guarda de
 * `consultaDual` caen 2 y la de `consultaDualBatch`, 1.
 */
describe('consultaDual — el modulo, no la sesion, abre la llave global', () => {
  it('4D SOFT (solo valida_api) no consulta', async () => {
    reiniciarModulo('ws-test', { ...MODULES.cuatroDSoft });
    const r = await consultaDual({ tipo: 'natural', identificacion: '1077089147' });
    expect(r).toEqual({ ok: false, error: 'modulo_no_activo' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('metrik, con Valida pero sin Sustenta dual, tampoco', async () => {
    reiniciarModulo('ws-test', { ...MODULES.metrik });
    const r = await consultaDual({ tipo: 'natural', nombre: 'Juan Perez' });
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ni por el lote', async () => {
    reiniciarModulo('ws-test', { ...MODULES.cuatroDSoft });
    const fd = new FormData();
    fd.set('archivo', new File([new Uint8Array([1])], 'lote.xlsx'));
    const r = await consultaDualBatch(fd);
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respuesta(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('consultaDual — contrato con metrik-valida', () => {
  it('502 de la fuente sale como error, nunca como cero coincidencias', async () => {
    fetchMock.mockResolvedValue(
      respuesta(502, {
        error: 'informa_no_disponible: parse_incompleto: SEIYA reporta alerta=SI con 1 ocurrencia(s)',
        dual_id: 'dual-123',
      }),
    );

    const r = await consultaDual({ tipo: 'juridica', identificacion: '9000156998' });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toContain('informa_no_disponible');
    expect(r).not.toHaveProperty('data');
  });

  it('401 de metrik-valida sale como error', async () => {
    fetchMock.mockResolvedValue(respuesta(401, { error: 'invalid_api_key' }));
    const r = await consultaDual({ tipo: 'natural', identificacion: '1077089147' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid_api_key');
  });

  it('no-2xx sin cuerpo JSON degrada al codigo HTTP, no a un resultado vacio', async () => {
    fetchMock.mockResolvedValue(new Response('gateway timeout', { status: 504 }));
    const r = await consultaDual({ tipo: 'natural', identificacion: '123456789' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('HTTP 504');
  });

  it('200 con hallazgos sigue funcionando igual', async () => {
    fetchMock.mockResolvedValue(
      respuesta(200, {
        dual_id: 'dual-456',
        fecha: '2026-08-12T14:37:09.484Z',
        total_matches: 1,
        matches: [
          {
            lista: 'EXCLUIDOS DE LAS LISTAS SDN Y CONSOLIDADA DE LA OFAC',
            nombre: 'A K DIFUSION SA PUBLICIDAD Y MERCADEO',
            documento: '9000156998',
            fundamento: 'COUNTER TERRORISM AND IRAN RELATED DESIGNATIONS',
          },
        ],
        estado: 'ok',
      }),
    );

    const r = await consultaDual({ tipo: 'juridica', identificacion: '9000156998' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.total_matches).toBe(1);
  });

  it('200 sin hallazgos sigue siendo un cero valido', async () => {
    fetchMock.mockResolvedValue(
      respuesta(200, { dual_id: 'dual-789', fecha: '2026-08-12T14:36:27.494Z', total_matches: 0, matches: [], estado: 'ok' }),
    );
    const r = await consultaDual({ tipo: 'natural', identificacion: '1000000001' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.total_matches).toBe(0);
  });

  it('caida de red sale como error, no como sin hallazgo', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await consultaDual({ tipo: 'natural', identificacion: '1000000001' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('ECONNREFUSED');
  });
});
