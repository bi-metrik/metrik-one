/**
 * Liberación de contrapartes (R4) — cableado de las server actions.
 *
 * Lo que estas pruebas cuidan, que la regla pura no puede cuidar sola:
 *
 * 1. La identidad de la contraparte sale de la CONSULTA, no del cliente. Una
 *    liberación apuntando a otra contraparte sería la peor forma de fallar,
 *    porque la bitácora se vería impecable.
 * 2. El aislamiento por workspace se pone a mano: el service client bypasea RLS.
 * 3. Nada de esto llama a la fuente. Cada consulta a Informa/Valida es facturable
 *    contra la cuenta del cliente y decidir sobre un hallazgo ya guardado no
 *    necesita volver a preguntar.
 *
 * EL DOBLE ES CONSCIENTE DE LA TABLA **Y DE LOS FILTROS**. En R1 un test pasó
 * por la razón equivocada porque el doble devolvía lo mismo para cualquier tabla;
 * aquí el doble es un mini motor de consultas sobre fixtures: si el código deja
 * de filtrar por `workspace_id`, la fila ajena aparece y la prueba cae.
 *
 * VISTOS FALLAR (2026-08-21) — cada mutación tumbó pruebas:
 *   - quitar `.eq('workspace_id')` de la lectura de la consulta → cae "consulta de otro workspace"
 *   - quitar `.eq('workspace_id')` de la validación del control → cae "control de otro workspace"
 *   - guardar `input.consulta_id` sin resolver la consulta → cae "la identidad sale de la evidencia"
 *   - guardar el documento sin normalizar → cae "el documento se guarda canónico"
 *   - permitir decidir sobre una consulta sin hallazgo → cae "consulta sin hallazgo"
 *   - contar como pendiente una contraparte cubierta → caen las 3 del tablero
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Estado que los dobles leen ────────────────────────────────────────────

type Fila = Record<string, unknown>;
let fixtures: Record<string, Fila[]> = {};
let rolActual: string | null = 'owner';
let workspaceActual: string | null = 'ws-alma';
const HOY = '2026-08-21';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
}));

// `getCachedUser` resuelve al usuario verificando la firma del token, no
// preguntándole al servidor de Auth (ver src/lib/supabase/claims-user.ts).
vi.mock('@/lib/supabase/auth-user', () => ({
  getCachedUser: async () => ({ user: { id: 'user-oficial', email: 'oficial@alma.co' } }),
}));

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({ workspaceId: workspaceActual, role: rolActual }),
}));

vi.mock('./_usuarios', () => ({
  resolverNombresUsuarios: async () => new Map([['user-oficial', 'Yessica Vásquez']]),
}));

vi.mock('@/lib/dates/bogota', () => ({
  todayBogotaISO: () => HOY,
}));

import {
  registrarDecisionContraparte,
  listarBitacoraContraparte,
  listarTableroLiberaciones,
  listarControlesParaLiberacion,
} from './compliance-liberaciones';

// ─── Doble: mini motor de consultas sobre los fixtures ─────────────────────

let contadorInserts = 0;

function servicioFalso() {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = [];
      let orden: { campo: string; asc: boolean } | null = null;
      let tope: number | null = null;
      let insertadas: Fila[] | null = null;

      const resolver = (): Fila[] => {
        if (insertadas) return insertadas;
        let filas = (fixtures[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
        if (orden) {
          const { campo, asc } = orden;
          filas = [...filas].sort((a, b) => {
            const va = String(a[campo] ?? '');
            const vb = String(b[campo] ?? '');
            return asc ? va.localeCompare(vb) : vb.localeCompare(va);
          });
        }
        if (tope !== null) filas = filas.slice(0, tope);
        return filas;
      };

      const chain = {
        select: () => chain,
        eq: (campo: string, valor: unknown) => {
          filtros.push((f) => f[campo] === valor);
          return chain;
        },
        in: (campo: string, valores: unknown[]) => {
          filtros.push((f) => valores.includes(f[campo]));
          return chain;
        },
        order: (campo: string, opts?: { ascending?: boolean }) => {
          orden = { campo, asc: opts?.ascending !== false };
          return chain;
        },
        limit: (n: number) => {
          tope = n;
          return chain;
        },
        insert: (fila: Fila) => {
          contadorInserts += 1;
          const nueva = {
            id: `nueva-${contadorInserts}`,
            created_at: `2026-08-21T1${contadorInserts}:00:00.000Z`,
            ...fila,
          };
          (fixtures[tabla] ??= []).push(nueva);
          insertadas = [nueva];
          return chain;
        },
        maybeSingle: async () => ({ data: resolver()[0] ?? null, error: null }),
        single: async () => {
          const filas = resolver();
          return filas[0]
            ? { data: filas[0], error: null }
            : { data: null, error: { message: 'no_rows' } };
        },
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
    id: 'consulta-acme',
    workspace_id: 'ws-alma',
    nombre_consultado: 'Acme SAS',
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    severidad: 'alto',
    total_matches: 3,
    matches: [{ lista: 'OFAC', nombre: 'ACME', documento: null, fundamento: null }],
    created_at: '2026-08-10T10:00:00.000Z',
    ...p,
  };
}

function liberacion(p: Partial<Fila> = {}): Fila {
  return {
    id: 'lib-1',
    workspace_id: 'ws-alma',
    consulta_id: 'consulta-acme',
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    nombre: 'Acme SAS',
    decision: 'liberada',
    justificacion: 'Homonimia verificada con cédula.',
    vigente_desde: '2026-08-11',
    vigente_hasta: '2026-12-31',
    control_id: null,
    liberada_por: 'user-oficial',
    created_at: '2026-08-11T10:00:00.000Z',
    ...p,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  rolActual = 'owner';
  workspaceActual = 'ws-alma';
  contadorInserts = 0;
  fixtures = {
    consultas_listas_dual: [consulta()],
    compliance_liberaciones: [],
    riesgos_controles: [
      { id: 'ctl-018', workspace_id: 'ws-alma', referencia: 'CTL-018', nombre_control: 'Donaciones' },
      { id: 'ctl-ajeno', workspace_id: 'ws-otro', referencia: 'CTL-001', nombre_control: 'De otro' },
    ],
  };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const INPUT_OK = {
  consulta_id: 'consulta-acme',
  decision: 'liberada' as const,
  justificacion: 'Homonimia verificada con cédula.',
  vigente_hasta: '2026-12-31',
};

// ─── Permisos ──────────────────────────────────────────────────────────────

describe('registrarDecisionContraparte — solo el oficial decide', () => {
  it('un operador no puede registrar y no escribe nada', async () => {
    rolActual = 'operator';
    const r = await registrarDecisionContraparte(INPUT_OK);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toBe('forbidden_solo_oficial_cumplimiento');
    expect(fixtures.compliance_liberaciones).toHaveLength(0);
  });

  it('un supervisor tampoco', async () => {
    rolActual = 'supervisor';
    const r = await registrarDecisionContraparte(INPUT_OK);
    expect(r.ok).toBe(false);
    expect(fixtures.compliance_liberaciones).toHaveLength(0);
  });

  it('el oficial sí', async () => {
    const r = await registrarDecisionContraparte(INPUT_OK);
    expect(r.ok).toBe(true);
    expect(fixtures.compliance_liberaciones).toHaveLength(1);
  });
});

// ─── La evidencia manda ────────────────────────────────────────────────────

describe('registrarDecisionContraparte — la identidad sale de la evidencia', () => {
  it('la fila guarda la contraparte de la consulta, no lo que mande el cliente', async () => {
    const r = await registrarDecisionContraparte(INPUT_OK);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.documento_tipo).toBe('NIT');
    expect(r.data.documento_numero).toBe('900123456');
    expect(r.data.nombre).toBe('Acme SAS');
    expect(r.data.consulta_id).toBe('consulta-acme');
  });

  it('el documento se guarda canónico aunque la consulta lo traiga con puntos', async () => {
    fixtures.consultas_listas_dual = [consulta({ documento_numero: '900.123.456-7' })];
    const r = await registrarDecisionContraparte(INPUT_OK);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.documento_numero).toBe('9001234567');
  });

  it('la vigencia arranca hoy AUNQUE el cliente mande una fecha anterior', async () => {
    // Retrodatar una liberación cubriría contrataciones que ocurrieron sin ella:
    // el campo no viene del input, y esta prueba lo fija mandándolo igual.
    const r = await registrarDecisionContraparte({
      ...INPUT_OK,
      vigente_desde: '2026-01-01',
    } as unknown as typeof INPUT_OK);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.vigente_desde).toBe(HOY);
  });

  it('consulta de OTRO workspace no se encuentra', async () => {
    fixtures.consultas_listas_dual = [consulta({ workspace_id: 'ws-otro' })];
    const r = await registrarDecisionContraparte(INPUT_OK);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toBe('consulta_no_encontrada');
    expect(fixtures.compliance_liberaciones).toHaveLength(0);
  });

  it('consulta sin hallazgo: no hay nada que decidir', async () => {
    fixtures.consultas_listas_dual = [consulta({ severidad: 'sin_hallazgo' })];
    const r = await registrarDecisionContraparte(INPUT_OK);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toContain('consulta_sin_hallazgo');
    expect(fixtures.compliance_liberaciones).toHaveLength(0);
  });

  it('consulta hecha solo por nombre: lo dice en vez de crear una fila que no cubre a nadie', async () => {
    fixtures.consultas_listas_dual = [
      consulta({ documento_tipo: null, documento_numero: null }),
    ];
    const r = await registrarDecisionContraparte(INPUT_OK);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toContain('consulta_sin_documento');
    expect(fixtures.compliance_liberaciones).toHaveLength(0);
  });

  it('un rechazo se guarda sin vigencia', async () => {
    const r = await registrarDecisionContraparte({
      consulta_id: 'consulta-acme',
      decision: 'rechazada',
      justificacion: 'Reporte OFAC confirmado, no se contrata.',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.vigente_hasta).toBeNull();
  });

  it('la validación corre ANTES de tocar la base', async () => {
    const r = await registrarDecisionContraparte({ ...INPUT_OK, justificacion: '   ' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toBe('justificacion_requerida');
    expect(fixtures.compliance_liberaciones).toHaveLength(0);
  });
});

describe('registrarDecisionContraparte — el control citado es del workspace', () => {
  it('acepta un control propio', async () => {
    const r = await registrarDecisionContraparte({ ...INPUT_OK, control_id: 'ctl-018' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.control_id).toBe('ctl-018');
  });

  it('rechaza un control de otro workspace', async () => {
    const r = await registrarDecisionContraparte({ ...INPUT_OK, control_id: 'ctl-ajeno' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toBe('control_no_encontrado');
    expect(fixtures.compliance_liberaciones).toHaveLength(0);
  });
});

// ─── Costo ─────────────────────────────────────────────────────────────────

describe('R4 NUNCA llama a la fuente', () => {
  it('decidir sobre un hallazgo no gasta una consulta facturable', async () => {
    await registrarDecisionContraparte(INPUT_OK);
    await listarTableroLiberaciones();
    await listarBitacoraContraparte({ documento_tipo: 'NIT', documento_numero: '900123456' });
    await listarControlesParaLiberacion();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Tablero ───────────────────────────────────────────────────────────────

describe('listarTableroLiberaciones — el estado se deriva', () => {
  it('una contraparte con hallazgo y sin decisión queda pendiente', async () => {
    const r = await listarTableroLiberaciones();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.pendientes).toHaveLength(1);
    expect(r.data.pendientes[0].cobertura.motivo).toBe('sin_registro');
    expect(r.data.cubiertas).toHaveLength(0);
  });

  it('con liberación vigente pasa a cubiertas', async () => {
    fixtures.compliance_liberaciones = [liberacion()];
    const r = await listarTableroLiberaciones();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.pendientes).toHaveLength(0);
    expect(r.data.cubiertas).toHaveLength(1);
    expect(r.data.cubiertas[0].cobertura.motivo).toBe('vigente');
  });

  it('con la liberación vencida vuelve a pendientes sin que nadie la toque', async () => {
    fixtures.compliance_liberaciones = [liberacion({ vigente_hasta: '2026-08-20' })];
    const r = await listarTableroLiberaciones();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.pendientes).toHaveLength(1);
    expect(r.data.pendientes[0].cobertura.motivo).toBe('vencida');
  });

  it('un rechazo posterior deja la contraparte pendiente, no cubierta', async () => {
    fixtures.compliance_liberaciones = [
      liberacion(),
      liberacion({
        id: 'lib-2',
        decision: 'rechazada',
        vigente_hasta: null,
        created_at: '2026-08-19T10:00:00.000Z',
      }),
    ];
    const r = await listarTableroLiberaciones();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.pendientes).toHaveLength(1);
    expect(r.data.pendientes[0].cobertura.motivo).toBe('rechazada');
  });

  it('la liberación cubre aunque la consulta escriba el documento distinto', async () => {
    fixtures.consultas_listas_dual = [consulta({ documento_numero: '900.123.456' })];
    fixtures.compliance_liberaciones = [liberacion({ documento_numero: '900123456' })];
    const r = await listarTableroLiberaciones();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.cubiertas).toHaveLength(1);
  });

  it('agrupa varias consultas de la misma contraparte y decide sobre la más reciente', async () => {
    fixtures.consultas_listas_dual = [
      consulta({ id: 'consulta-vieja', created_at: '2026-06-01T10:00:00.000Z', total_matches: 1 }),
      consulta({ id: 'consulta-nueva', created_at: '2026-08-15T10:00:00.000Z', total_matches: 5 }),
    ];
    const r = await listarTableroLiberaciones();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.pendientes).toHaveLength(1);
    expect(r.data.pendientes[0].consultas).toHaveLength(2);
    expect(r.data.pendientes[0].consulta_vigente_id).toBe('consulta-nueva');
    expect(r.data.pendientes[0].total_matches).toBe(5);
  });

  it('un hallazgo sin documento se reporta aparte, NO se descarta en silencio', async () => {
    fixtures.consultas_listas_dual = [
      consulta(),
      consulta({
        id: 'consulta-solo-nombre',
        documento_tipo: null,
        documento_numero: null,
        nombre_consultado: 'Deloitte',
      }),
    ];
    const r = await listarTableroLiberaciones();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.sin_documento).toHaveLength(1);
    expect(r.data.sin_documento[0].nombre).toBe('Deloitte');
    expect(r.data.pendientes).toHaveLength(1);
  });

  it('las liberaciones de otro workspace no cubren nada aquí', async () => {
    fixtures.compliance_liberaciones = [liberacion({ workspace_id: 'ws-otro' })];
    const r = await listarTableroLiberaciones();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.pendientes).toHaveLength(1);
  });

  it('las consultas de otro workspace no aparecen', async () => {
    fixtures.consultas_listas_dual = [consulta({ workspace_id: 'ws-otro' })];
    const r = await listarTableroLiberaciones();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.pendientes).toHaveLength(0);
  });
});

// ─── Bitácora ──────────────────────────────────────────────────────────────

describe('listarBitacoraContraparte', () => {
  it('devuelve la historia completa, de la más reciente a la más antigua', async () => {
    fixtures.compliance_liberaciones = [
      liberacion({ id: 'lib-1', created_at: '2026-08-11T10:00:00.000Z' }),
      liberacion({
        id: 'lib-2',
        decision: 'rechazada',
        vigente_hasta: null,
        created_at: '2026-08-19T10:00:00.000Z',
      }),
    ];
    const r = await listarBitacoraContraparte({ documento_tipo: 'nit', documento_numero: '900.123.456' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.map((f) => f.id)).toEqual(['lib-2', 'lib-1']);
  });

  it('resuelve quién firmó y qué control se citó', async () => {
    fixtures.compliance_liberaciones = [liberacion({ control_id: 'ctl-018' })];
    const r = await listarBitacoraContraparte({ documento_tipo: 'NIT', documento_numero: '900123456' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data[0].liberada_por_nombre).toBe('Yessica Vásquez');
    expect(r.data[0].control_referencia).toBe('CTL-018');
    expect(r.data[0].control_nombre).toBe('Donaciones');
  });

  it('no devuelve la bitácora de otro workspace', async () => {
    fixtures.compliance_liberaciones = [liberacion({ workspace_id: 'ws-otro' })];
    const r = await listarBitacoraContraparte({ documento_tipo: 'NIT', documento_numero: '900123456' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data).toHaveLength(0);
  });

  it('sin documento no consulta nada', async () => {
    const r = await listarBitacoraContraparte({ documento_tipo: '', documento_numero: '' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('inalcanzable');
    expect(r.error).toBe('documento_requerido');
  });
});

describe('listarControlesParaLiberacion', () => {
  it('ofrece solo los controles del workspace', async () => {
    const r = await listarControlesParaLiberacion();
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('inalcanzable');
    expect(r.data.map((c) => c.id)).toEqual(['ctl-018']);
  });
});
