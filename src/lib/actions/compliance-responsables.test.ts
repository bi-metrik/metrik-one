/**
 * Responsable por control + aceptación (R2) — cableado de las server actions.
 *
 * Lo que estas pruebas cuidan, que la regla pura no puede cuidar sola:
 *
 * 1. La foto de controles se arma en el SERVIDOR desde lo que la matriz dice
 *    AHORA. Si el cliente pudiera dictar el `updated_at` de la foto, declararía
 *    vigente una aceptación sobre un control que ya cambió, y la bitácora se
 *    vería impecable — la peor forma de fallar.
 * 2. El aislamiento por workspace se pone a mano: el service client bypasea RLS.
 * 3. Nada de esto llama a Informa ni a Valida. Cada consulta a la fuente es
 *    facturable contra la cuenta del cliente y nominar un responsable no
 *    necesita preguntarle nada a nadie.
 * 4. La firma en ONE está apagada y el guard vive en el servidor, no en la UI.
 *
 * EL DOBLE ES CONSCIENTE DE LA TABLA **Y DE LOS FILTROS** (mismo motor que las
 * pruebas de R4): si el código deja de filtrar por `workspace_id`, la fila ajena
 * aparece y la prueba cae. Un doble que devuelve lo mismo para cualquier
 * consulta hace pasar las pruebas por la razón equivocada.
 *
 * VISTOS FALLAR (2026-08-22) — 16 mutaciones aplicadas al código, 16 detectadas.
 * Reproducible con `node scripts/mutar-responsables-actions.mjs`:
 *
 *    1. la foto toma el `updated_at` del CLIENTE                → 2 pruebas
 *    2. la foto no filtra por cargo                             → 5 pruebas
 *    3. la lectura del cargo no filtra por workspace            → 1 prueba
 *    4. la foto de controles no filtra por workspace            → 2 pruebas
 *    5. se permite aceptar un cargo sin controles               → 2 pruebas
 *    6. el prefijo del soporte no se comprueba                  → 1 prueba
 *    7. nominar no comprueba que el cargo esté activo           → 1 prueba
 *    8. nominar acepta un cargo de otro workspace               → 1 prueba
 *    9. nominar acepta un usuario de otro workspace             → 1 prueba
 *   10. el update del control no filtra por workspace           → 1 prueba
 *   11. el tablero lee controles de todos los workspaces        → 2 pruebas
 *   12. el selector de usuarios no filtra por workspace         → 1 prueba
 *   13. la detección de cargo duplicado se salta                → 1 prueba
 *   14. `cambiarEstadoCargo` no filtra por workspace            → 1 prueba
 *   15. el guard de rol se desactiva                            → 2 pruebas
 *   16. `aceptada_por` se llena con el oficial que registra     → 1 prueba
 *
 * ⚠️ La #4 SOBREVIVIÓ en la primera corrida, y por un input de prueba
 * incompleto — el mismo modo de fallo que ya había aparecido en R4. Ningún
 * control ajeno compartía cargo con los nuestros (los ids son uuid), así que
 * quitar el filtro de workspace no cambiaba nada. Se agregó a los fixtures un
 * control de otro workspace apuntando a NUESTRO cargo y la mutación pasó a
 * tumbar 2 pruebas. Sin mutar, ese agujero se habría mergeado.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Estado que los dobles leen ────────────────────────────────────────────

type Fila = Record<string, unknown>;
let fixtures: Record<string, Fila[]> = {};
let rolActual: string | null = 'owner';
let workspaceActual: string | null = 'ws-alma';
const HOY = '2026-08-22';

const llamadasRed: string[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
}));

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

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import {
  crearCargo,
  cambiarEstadoCargo,
  nominarResponsableControl,
  registrarAceptacion,
  listarTableroResponsables,
} from './compliance-responsables';

// ─── Doble: mini motor de consultas sobre los fixtures ─────────────────────

let contadorInserts = 0;

function servicioFalso() {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = [];
      let orden: { campo: string; asc: boolean } | null = null;
      let tope: number | null = null;
      let materializadas: Fila[] | null = null;

      const resolver = (): Fila[] => {
        if (materializadas) return materializadas;
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
            created_at: `2026-08-22T1${contadorInserts}:00:00.000Z`,
            ...fila,
          };
          (fixtures[tabla] ??= []).push(nueva);
          materializadas = [nueva];
          return chain;
        },
        update: (cambios: Fila) => {
          // El update respeta los filtros que se encadenen DESPUÉS, igual que
          // PostgREST: por eso se resuelve perezosamente.
          const aplicar = () => {
            const objetivo = (fixtures[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
            for (const f of objetivo) Object.assign(f, cambios);
            return objetivo;
          };
          materializadas = null;
          const chainUpdate = {
            eq: (campo: string, valor: unknown) => {
              filtros.push((f) => f[campo] === valor);
              return chainUpdate;
            },
            select: () => chainUpdate,
            maybeSingle: async () => ({ data: aplicar()[0] ?? null, error: null }),
            single: async () => {
              const filas = aplicar();
              return filas[0] ? { data: filas[0], error: null } : { data: null, error: { message: 'no_rows' } };
            },
          };
          return chainUpdate;
        },
        maybeSingle: async () => ({ data: resolver()[0] ?? null, error: null }),
        single: async () => {
          const filas = resolver();
          return filas[0] ? { data: filas[0], error: null } : { data: null, error: { message: 'no_rows' } };
        },
        then: (resolve: (v: { data: Fila[]; error: null }) => unknown) =>
          resolve({ data: resolver(), error: null }),
      };
      return chain;
    },
  };
}

// La red no existe en estas pruebas: si algo intentara consultar a la fuente,
// quedaría anotado y la prueba de abajo lo delata.
globalThis.fetch = (async (url: unknown) => {
  llamadasRed.push(String(url));
  throw new Error('la red no está disponible en estas pruebas');
}) as typeof globalThis.fetch;

// ─── Fixtures ──────────────────────────────────────────────────────────────

const T1 = '2026-08-01T10:00:00.000Z';
const T3 = '2026-08-20T10:00:00.000Z';

function estadoBase() {
  fixtures = {
    compliance_cargos: [
      { id: 'cargo-tes', workspace_id: 'ws-alma', nombre: 'Tesorero', activo: true, orden: 0 },
      { id: 'cargo-hseq', workspace_id: 'ws-alma', nombre: 'Jefe HSEQ', activo: true, orden: 1 },
      { id: 'cargo-viejo', workspace_id: 'ws-alma', nombre: 'Cargo retirado', activo: false, orden: 2 },
      { id: 'cargo-ajeno', workspace_id: 'ws-otro', nombre: 'Tesorero', activo: true, orden: 0 },
    ],
    riesgos_controles: [
      {
        id: 'ctl-1', workspace_id: 'ws-alma', referencia: 'CTL-001', nombre_control: 'Debida diligencia',
        actividad_control: 'Verificar', periodicidad: 'continuo', tipo_control: 'preventivo',
        cargo_responsable_id: 'cargo-tes', responsable_id: null, updated_at: T1,
      },
      {
        id: 'ctl-2', workspace_id: 'ws-alma', referencia: 'CTL-002', nombre_control: 'Validación de pagos',
        actividad_control: 'Revisar', periodicidad: 'continuo', tipo_control: 'preventivo',
        cargo_responsable_id: 'cargo-tes', responsable_id: 'user-op', updated_at: T1,
      },
      {
        id: 'ctl-3', workspace_id: 'ws-alma', referencia: 'CTL-003', nombre_control: 'Capacitaciones',
        actividad_control: null, periodicidad: 'semestral', tipo_control: 'preventivo',
        cargo_responsable_id: null, responsable_id: null, updated_at: T1,
      },
      {
        id: 'ctl-ajeno', workspace_id: 'ws-otro', referencia: 'CTL-900', nombre_control: 'Ajeno',
        actividad_control: null, periodicidad: null, tipo_control: 'preventivo',
        cargo_responsable_id: 'cargo-ajeno', responsable_id: null, updated_at: T1,
      },
      {
        // Un control de OTRO workspace apuntando a NUESTRO cargo. No deberia
        // poder existir (lo impide el guard de nominacion), pero es justo el
        // estado que la segunda barrera tiene que aguantar: si algun dia esa
        // primera falla, la foto no puede llevarse un control ajeno.
        //
        // Sin esta fila, quitar el `.eq('workspace_id')` de la lectura de la
        // foto NO tumbaba ninguna prueba: los ids de cargo son uuid y ningun
        // control ajeno compartia cargo con los nuestros. La verificacion por
        // mutacion lo destapo (2026-08-22).
        id: 'ctl-ajeno-mismo-cargo', workspace_id: 'ws-otro', referencia: 'CTL-901',
        nombre_control: 'Ajeno con nuestro cargo', actividad_control: null, periodicidad: null,
        tipo_control: 'preventivo', cargo_responsable_id: 'cargo-tes', responsable_id: null,
        updated_at: T1,
      },
    ],
    compliance_aceptaciones: [],
    profiles: [
      { id: 'user-oficial', workspace_id: 'ws-alma', full_name: 'Yessica Vásquez' },
      { id: 'user-op', workspace_id: 'ws-alma', full_name: 'Camilo Ruiz' },
      { id: 'user-ajeno', workspace_id: 'ws-otro', full_name: 'Alguien Más' },
    ],
  };
}

beforeEach(() => {
  estadoBase();
  rolActual = 'owner';
  workspaceActual = 'ws-alma';
  contadorInserts = 0;
  llamadasRed.length = 0;
});

const ACEPTACION_OK = {
  cargo_id: 'cargo-tes',
  persona_nombre: 'Ana Ruiz',
  persona_documento: 'CC 1020304050',
  medio: 'documento_cargado' as const,
  soporte_path: 'ws-alma/aceptaciones/x.pdf',
};

// ─── Permisos ──────────────────────────────────────────────────────────────

describe('guard del oficial de cumplimiento', () => {
  it('un operador no puede nominar ni aceptar', async () => {
    rolActual = 'operator';
    expect(await crearCargo({ nombre: 'Tesorero 2' })).toMatchObject({ ok: false });
    expect(await registrarAceptacion(ACEPTACION_OK)).toMatchObject({ ok: false });
    expect(await listarTableroResponsables()).toMatchObject({ ok: false });
  });

  it('un supervisor tampoco: la pantalla muestra documentos de identidad', async () => {
    rolActual = 'supervisor';
    const r = await nominarResponsableControl({ control_id: 'ctl-1', cargo_responsable_id: 'cargo-tes' });
    expect(r).toMatchObject({ ok: false, error: 'forbidden_solo_oficial_cumplimiento' });
  });

  it('owner y admin sí', async () => {
    for (const rol of ['owner', 'admin']) {
      rolActual = rol;
      expect((await listarTableroResponsables()).ok).toBe(true);
    }
  });
});

// ─── Catálogo de cargos ────────────────────────────────────────────────────

describe('crearCargo', () => {
  it('crea el cargo del workspace', async () => {
    const r = await crearCargo({ nombre: 'Analista de Compras' });
    expect(r.ok).toBe(true);
    expect(fixtures.compliance_cargos.some((c) => c.nombre === 'Analista de Compras')).toBe(true);
  });

  it('⚠️ rechaza el duplicado escrito distinto, y dice cuál es', async () => {
    // Dos cargos con el mismo nombre partirían la cobertura en dos: la mitad de
    // los controles colgaría de un cargo que nunca firmó.
    const r = await crearCargo({ nombre: 'tesorero' });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/cargo_duplicado.*Tesorero/);
  });

  it('un cargo con el mismo nombre en OTRO workspace no estorba', async () => {
    workspaceActual = 'ws-otro';
    // 'ws-otro' ya tiene "Tesorero"; crear "Jefe HSEQ" allá debe funcionar
    // aunque ese nombre exista en ws-alma.
    expect((await crearCargo({ nombre: 'Jefe HSEQ' })).ok).toBe(true);
  });

  it('exige nombre', async () => {
    expect(await crearCargo({ nombre: '   ' })).toMatchObject({ ok: false, error: 'nombre_requerido' });
  });
});

describe('cambiarEstadoCargo', () => {
  it('desactiva sin borrar: la trazabilidad se queda', async () => {
    const r = await cambiarEstadoCargo({ cargo_id: 'cargo-tes', activo: false });
    expect(r.ok).toBe(true);
    expect(fixtures.compliance_cargos.find((c) => c.id === 'cargo-tes')?.activo).toBe(false);
  });

  it('no alcanza un cargo de otro workspace', async () => {
    const r = await cambiarEstadoCargo({ cargo_id: 'cargo-ajeno', activo: false });
    expect(r).toMatchObject({ ok: false, error: 'cargo_no_encontrado' });
    expect(fixtures.compliance_cargos.find((c) => c.id === 'cargo-ajeno')?.activo).toBe(true);
  });
});

// ─── Nominación ────────────────────────────────────────────────────────────

describe('nominarResponsableControl', () => {
  it('escribe cargo y usuario en el MISMO guardado', async () => {
    const r = await nominarResponsableControl({
      control_id: 'ctl-3',
      cargo_responsable_id: 'cargo-hseq',
      usuario_responsable_id: 'user-op',
    });
    expect(r.ok).toBe(true);
    const ctl = fixtures.riesgos_controles.find((c) => c.id === 'ctl-3');
    expect(ctl?.cargo_responsable_id).toBe('cargo-hseq');
    expect(ctl?.responsable_id).toBe('user-op');
  });

  it('el usuario es opcional: casi ningún control se ejecuta dentro de ONE', async () => {
    const r = await nominarResponsableControl({ control_id: 'ctl-3', cargo_responsable_id: 'cargo-hseq' });
    expect(r.ok).toBe(true);
    expect(fixtures.riesgos_controles.find((c) => c.id === 'ctl-3')?.responsable_id).toBeNull();
  });

  it('permite desnominar (cargo nulo)', async () => {
    const r = await nominarResponsableControl({ control_id: 'ctl-1', cargo_responsable_id: null });
    expect(r.ok).toBe(true);
    expect(fixtures.riesgos_controles.find((c) => c.id === 'ctl-1')?.cargo_responsable_id).toBeNull();
  });

  it('⚠️ no nomina a un cargo desactivado', async () => {
    const r = await nominarResponsableControl({ control_id: 'ctl-3', cargo_responsable_id: 'cargo-viejo' });
    expect(r).toMatchObject({ ok: false, error: 'cargo_inactivo' });
  });

  it('⚠️ no nomina a un cargo de otro workspace', async () => {
    const r = await nominarResponsableControl({ control_id: 'ctl-3', cargo_responsable_id: 'cargo-ajeno' });
    expect(r).toMatchObject({ ok: false, error: 'cargo_no_encontrado' });
  });

  it('⚠️ no nomina a un usuario de otro workspace: le daría acceso al control', async () => {
    const r = await nominarResponsableControl({
      control_id: 'ctl-3',
      cargo_responsable_id: 'cargo-hseq',
      usuario_responsable_id: 'user-ajeno',
    });
    expect(r).toMatchObject({ ok: false, error: 'usuario_no_encontrado_en_el_workspace' });
    expect(fixtures.riesgos_controles.find((c) => c.id === 'ctl-3')?.responsable_id).toBeNull();
  });

  it('no alcanza un control de otro workspace', async () => {
    const r = await nominarResponsableControl({ control_id: 'ctl-ajeno', cargo_responsable_id: 'cargo-hseq' });
    expect(r).toMatchObject({ ok: false, error: 'control_no_encontrado' });
  });
});

// ─── Aceptación ────────────────────────────────────────────────────────────

describe('registrarAceptacion', () => {
  it('⚠️ la foto sale de la BASE, no del cliente', async () => {
    const r = await registrarAceptacion(ACEPTACION_OK);
    expect(r.ok).toBe(true);
    const fila = fixtures.compliance_aceptaciones[0];
    const foto = fila.controles_snapshot as Array<Record<string, unknown>>;
    // Los dos controles del cargo, con el updated_at que la base tiene AHORA.
    expect(foto.map((c) => c.id).sort()).toEqual(['ctl-1', 'ctl-2']);
    expect(foto.every((c) => c.updated_at === T1)).toBe(true);
    expect(foto[0].referencia).toBe('CTL-001');
  });

  it('⚠️ la foto trae SOLO los controles de ese cargo', async () => {
    await registrarAceptacion({ ...ACEPTACION_OK, cargo_id: 'cargo-hseq' });
    // 'cargo-hseq' no nomina ninguno todavía → no hay nada que aceptar.
    expect(fixtures.compliance_aceptaciones).toHaveLength(0);

    await nominarResponsableControl({ control_id: 'ctl-3', cargo_responsable_id: 'cargo-hseq' });
    await registrarAceptacion({ ...ACEPTACION_OK, cargo_id: 'cargo-hseq' });
    const foto = fixtures.compliance_aceptaciones[0].controles_snapshot as Array<Record<string, unknown>>;
    expect(foto.map((c) => c.id)).toEqual(['ctl-3']);
  });

  it('⚠️ la foto solo trae controles de ESTE workspace', async () => {
    // 'cargo-ajeno' nomina ctl-ajeno en ws-otro. Desde ws-alma no se ve.
    const r = await registrarAceptacion({ ...ACEPTACION_OK, cargo_id: 'cargo-ajeno' });
    expect(r).toMatchObject({ ok: false, error: 'cargo_no_encontrado' });
  });

  it('⚠️ un control ajeno que apunte a NUESTRO cargo no entra en la foto', async () => {
    // Segunda barrera. La primera es el guard de nominacion, que impide crear
    // este estado; esta prueba existe para que la segunda no se pueda quitar
    // "porque la primera ya lo cubre".
    const r = await registrarAceptacion(ACEPTACION_OK);
    expect(r.ok).toBe(true);
    const foto = fixtures.compliance_aceptaciones[0].controles_snapshot as Array<Record<string, unknown>>;
    expect(foto.map((c) => c.id)).not.toContain('ctl-ajeno-mismo-cargo');
    expect(foto.map((c) => c.id).sort()).toEqual(['ctl-1', 'ctl-2']);
  });

  it('⚠️ un cargo sin controles no puede aceptar nada', async () => {
    const r = await registrarAceptacion({ ...ACEPTACION_OK, cargo_id: 'cargo-hseq' });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/cargo_sin_controles/);
  });

  it('⚠️ rechaza un soporte con prefijo de otro workspace', async () => {
    // El service client no pasa por RLS: sin este guard, un soporte ajeno se
    // archivaría como propio.
    const r = await registrarAceptacion({ ...ACEPTACION_OK, soporte_path: 'ws-otro/aceptaciones/x.pdf' });
    expect(r).toMatchObject({ ok: false, error: 'soporte_fuera_del_workspace' });
  });

  it('⚠️ firma_one se rechaza en el SERVIDOR, no solo en la pantalla', async () => {
    const r = await registrarAceptacion({ ...ACEPTACION_OK, medio: 'firma_one', soporte_path: null });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/firma_one_no_habilitada/);
  });

  it('quien REGISTRA no es quien firma: aceptada_por queda nulo', async () => {
    await registrarAceptacion(ACEPTACION_OK);
    const fila = fixtures.compliance_aceptaciones[0];
    expect(fila.registrada_por).toBe('user-oficial');
    expect(fila.aceptada_por).toBeNull();
    expect(fila.persona_nombre).toBe('Ana Ruiz');
  });

  it('la fecha por omisión es hoy, y una pasada se respeta', async () => {
    await registrarAceptacion(ACEPTACION_OK);
    expect(fixtures.compliance_aceptaciones[0].fecha_aceptacion).toBe(HOY);

    await registrarAceptacion({ ...ACEPTACION_OK, fecha_aceptacion: '2026-08-15' });
    expect(fixtures.compliance_aceptaciones[1].fecha_aceptacion).toBe('2026-08-15');
  });
});

// ─── El tablero ────────────────────────────────────────────────────────────

describe('listarTableroResponsables', () => {
  it('solo trae los controles del workspace, con su cargo resuelto', async () => {
    const r = await listarTableroResponsables();
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.data.controles.map((c) => c.id).sort()).toEqual(['ctl-1', 'ctl-2', 'ctl-3']);
    expect(r.data.controles.find((c) => c.id === 'ctl-1')?.cargo_nombre).toBe('Tesorero');
    expect(r.data.controles.find((c) => c.id === 'ctl-2')?.responsable_nombre).toBe('Camilo Ruiz');
  });

  it('el estado de arranque: nada aceptado', async () => {
    const r = await listarTableroResponsables();
    if (!r.ok) throw new Error(r.error);
    expect(r.data.indicadores.total).toBe(3);
    expect(r.data.indicadores.con_cargo).toBe(2);
    expect(r.data.indicadores.vigentes).toBe(0);
    expect(r.data.indicadores.sin_aceptacion).toBe(2);
    expect(r.data.indicadores.sin_cargo).toBe(1);
  });

  it('⚠️ tras aceptar, los del cargo quedan vigentes; cambiar uno lo desactualiza', async () => {
    await registrarAceptacion(ACEPTACION_OK);

    let r = await listarTableroResponsables();
    if (!r.ok) throw new Error(r.error);
    expect(r.data.indicadores.vigentes).toBe(2);
    expect(r.data.indicadores.desactualizados).toBe(0);

    // El control cambia (aquí se simula el efecto del trigger de updated_at).
    fixtures.riesgos_controles.find((c) => c.id === 'ctl-1')!.updated_at = T3;

    r = await listarTableroResponsables();
    if (!r.ok) throw new Error(r.error);
    expect(r.data.indicadores.vigentes).toBe(1);
    expect(r.data.indicadores.desactualizados).toBe(1);
    expect(r.data.controles.find((c) => c.id === 'ctl-1')?.estado.motivo).toBe('desactualizada');
  });

  it('un control nominado DESPUÉS de la carta queda fuera de ella', async () => {
    await registrarAceptacion(ACEPTACION_OK);
    await nominarResponsableControl({ control_id: 'ctl-3', cargo_responsable_id: 'cargo-tes' });

    const r = await listarTableroResponsables();
    if (!r.ok) throw new Error(r.error);
    expect(r.data.controles.find((c) => c.id === 'ctl-3')?.estado.motivo).toBe('no_incluido');
  });

  it('la bitácora nombra el cargo y a quien registró', async () => {
    await registrarAceptacion(ACEPTACION_OK);
    const r = await listarTableroResponsables();
    if (!r.ok) throw new Error(r.error);
    expect(r.data.aceptaciones[0].cargo_nombre).toBe('Tesorero');
    expect(r.data.aceptaciones[0].registrada_por_nombre).toBe('Yessica Vásquez');
  });

  it('el selector de usuarios no cruza workspaces', async () => {
    const r = await listarTableroResponsables();
    if (!r.ok) throw new Error(r.error);
    expect(r.data.usuarios.map((u) => u.id).sort()).toEqual(['user-oficial', 'user-op']);
  });
});

// ─── La restricción dura: nada de esto consulta a la fuente ────────────────

describe('cero consultas facturables', () => {
  it('ninguna acción de R2 golpea Informa ni Valida', async () => {
    await crearCargo({ nombre: 'Coordinador jurídico predial' });
    await nominarResponsableControl({ control_id: 'ctl-3', cargo_responsable_id: 'cargo-hseq' });
    await registrarAceptacion(ACEPTACION_OK);
    await listarTableroResponsables();
    expect(llamadasRed).toEqual([]);
  });
});
