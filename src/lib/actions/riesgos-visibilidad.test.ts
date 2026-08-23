/**
 * Visibilidad de controles para el rol operador — la regresión que R2 podía causar.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. Antes de R2, `getControles()` filtraba con
 * `query.eq('responsable_id', userId)` y `getControl()` comprobaba
 * `control.responsable_id !== userId`: la misma regla escrita dos veces. R2
 * agrega `cargo_responsable_id` (el cargo que RESPONDE) junto a `responsable_id`
 * (el usuario que OPERA), y mover la responsabilidad al cargo sin tocar el
 * filtro habría dejado a los operadores sin ver ningún control — sin error, sin
 * aviso, con la pantalla vacía.
 *
 * La decisión que estas pruebas congelan: **el operador ve por USUARIO, no por
 * cargo**. Nominar un cargo dice quién responde ante un auditor; no reparte
 * accesos. Derivarlo del cargo exigiría un vínculo persona↔cargo, o sea darle
 * cuenta de ONE a cada responsable, que es justo lo que el dictamen descarta
 * (el módulo expone quién quedó reportado en listas restrictivas).
 *
 * EL DOBLE ES CONSCIENTE DE LA TABLA Y DE LOS FILTROS: es un mini motor sobre
 * fixtures. Si el código deja de filtrar, la fila ajena aparece y la prueba cae.
 * Un doble que devuelve lo mismo para cualquier consulta haría pasar estas
 * pruebas por la razón equivocada.
 *
 * VISTOS FALLAR (2026-08-23) — 6 mutaciones aplicadas al código, 6 detectadas.
 * Reproducible con `node scripts/mutar-visibilidad-operador.mjs`:
 *
 *   1. filtrar por `cargo_responsable_id` en vez de `responsable_id` → 2 pruebas
 *   2. quitar el filtro del listado (el operador ve todo)            → 4 pruebas
 *   3. quitar el guard del detalle                                   → 3 pruebas
 *   4. el detalle mira el cargo en vez del usuario                   → 2 pruebas
 *   5. dejar pasar la sesión sin `userId` en el listado              → 1 prueba
 *   6. aplicar el filtro también a owner/admin                       → 2 pruebas
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
let fixtures: Record<string, Fila[]> = {};
let rolActual = 'operator';
let userActual: string | null = 'user-op';

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: servicioFalso(),
    workspaceId: 'ws-alma',
    userId: userActual,
    role: rolActual,
    error: null,
  }),
}));

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: servicioFalso(),
    workspaceId: 'ws-alma',
    userId: userActual,
    role: rolActual,
    error: null,
  }),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ redirect: () => {} }));

import { getControles, getControl } from './riesgos';

// ─── Doble: mini motor de consultas sobre los fixtures ─────────────────────

function servicioFalso() {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = [];
      let orden: { campo: string; asc: boolean } | null = null;

      const resolver = (): Fila[] => {
        let filas = (fixtures[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
        if (orden) {
          const { campo, asc } = orden;
          filas = [...filas].sort((a, b) => {
            const va = String(a[campo] ?? '');
            const vb = String(b[campo] ?? '');
            return asc ? va.localeCompare(vb) : vb.localeCompare(va);
          });
        }
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
        single: async () => {
          const filas = resolver();
          return filas[0] ? { data: filas[0], error: null } : { data: null, error: { message: 'no_rows' } };
        },
        maybeSingle: async () => ({ data: resolver()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Fila[]; error: null }) => unknown) =>
          resolve({ data: resolver(), error: null }),
      };
      return chain;
    },
  };
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const CARGO_DEL_OPERADOR = 'cargo-tesorero';

beforeEach(() => {
  rolActual = 'operator';
  userActual = 'user-op';
  fixtures = {
    riesgos_controles: [
      {
        // MÍO: soy el usuario responsable. Lo tengo que ver.
        id: 'ctl-mio', workspace_id: 'ws-alma', referencia: 'CTL-001',
        nombre_control: 'Validación de pagos', responsable_id: 'user-op',
        cargo_responsable_id: CARGO_DEL_OPERADOR, responsable: { full_name: 'Camilo Ruiz' },
      },
      {
        // SOLO NOMINADO AL CARGO, sin usuario. Aunque fuera "mi" cargo, no lo veo:
        // nominar no es ejecutar. Es la fila que distingue las dos reglas.
        id: 'ctl-solo-cargo', workspace_id: 'ws-alma', referencia: 'CTL-002',
        nombre_control: 'Debida diligencia', responsable_id: null,
        cargo_responsable_id: CARGO_DEL_OPERADOR, responsable: null,
      },
      {
        // De otro usuario. Nunca.
        id: 'ctl-ajeno', workspace_id: 'ws-alma', referencia: 'CTL-003',
        nombre_control: 'Capacitaciones', responsable_id: 'user-otro',
        cargo_responsable_id: 'cargo-hseq', responsable: { full_name: 'Otra Persona' },
      },
      {
        // Huérfano: sin usuario y sin cargo.
        id: 'ctl-huerfano', workspace_id: 'ws-alma', referencia: 'CTL-004',
        nombre_control: 'Monitoreo', responsable_id: null,
        cargo_responsable_id: null, responsable: null,
      },
    ],
    control_causa: [],
    riesgo_causas: [],
    riesgos: [],
  };
});

// ─── El listado ────────────────────────────────────────────────────────────

describe('getControles — visibilidad del operador', () => {
  it('⚠️ el operador ve SOLO los controles donde es el usuario responsable', async () => {
    const r = await getControles();
    expect(r.map((c: { id: string }) => c.id)).toEqual(['ctl-mio']);
  });

  it('⚠️ nominar el cargo NO le muestra el control: nominar no reparte accesos', async () => {
    // `ctl-solo-cargo` cuelga del mismo cargo que `ctl-mio`. Si la visibilidad
    // colgara del cargo, aparecería — y eso obligaría a darle cuenta de ONE a
    // cada responsable, que es lo que el dictamen descarta.
    const r = await getControles();
    expect(r.map((c: { id: string }) => c.id)).not.toContain('ctl-solo-cargo');
  });

  it('no ve el control de otro usuario ni los huérfanos', async () => {
    const r = await getControles();
    const ids = r.map((c: { id: string }) => c.id);
    expect(ids).not.toContain('ctl-ajeno');
    expect(ids).not.toContain('ctl-huerfano');
  });

  it('el contador se rige por la misma regla que el operador', async () => {
    rolActual = 'contador';
    const r = await getControles();
    expect(r.map((c: { id: string }) => c.id)).toEqual(['ctl-mio']);
  });

  it('⚠️ owner y admin ven TODOS los controles, sin filtro de responsable', async () => {
    // El filtro es del operador. Aplicárselo al oficial le escondería la matriz
    // que él mismo administra.
    for (const rol of ['owner', 'admin']) {
      rolActual = rol;
      const r = await getControles();
      expect(r).toHaveLength(4);
    }
  });

  it('sin usuario en sesión el operador no ve nada', async () => {
    userActual = null;
    expect(await getControles()).toEqual([]);
  });

  it('read_only ve todo: es el auditor', async () => {
    rolActual = 'read_only';
    expect(await getControles()).toHaveLength(4);
  });
});

// ─── El detalle (la puerta que se abre tecleando la URL) ───────────────────

describe('getControl — el detalle aplica la MISMA regla', () => {
  it('el operador abre el suyo', async () => {
    const r = await getControl('ctl-mio');
    expect(r?.control.id).toBe('ctl-mio');
  });

  it('⚠️ no puede abrir por URL el que solo está nominado a su cargo', async () => {
    // Si el listado y el detalle se desincronizaran, este sería el síntoma:
    // un control que la lista no muestra pero la URL sí abre.
    expect(await getControl('ctl-solo-cargo')).toBeNull();
  });

  it('no puede abrir el de otro usuario', async () => {
    expect(await getControl('ctl-ajeno')).toBeNull();
  });

  it('owner sí abre cualquiera', async () => {
    rolActual = 'owner';
    expect((await getControl('ctl-ajeno'))?.control.id).toBe('ctl-ajeno');
  });

  it('sin usuario en sesión no abre nada', async () => {
    userActual = null;
    expect(await getControl('ctl-mio')).toBeNull();
  });
});
