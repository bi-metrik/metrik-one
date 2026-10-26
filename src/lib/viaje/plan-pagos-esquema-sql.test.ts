import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración del plan de pagos del viajero (F2, PR 6), ejecutada en PGlite.
 *
 * Criterios: Vera §7.2.1 (un plan acordado por negocio), F2-3 (un plan fuera de la regla no se
 * acuerda sin aprobación), §2.3 bis (versiones), RLS por workspace con grant a `authenticated`
 * (la sesión lee y escribe el plan) y nada para `anon`. Y `cobros.cuenta_recaudo` no cambia lo
 * que ya existe (columna nueva en null).
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez sobre la migración:
 *   · quitar el índice `negocio_planes_pago_un_acordado` → cae «un solo acordado»;
 *   · quitar `negocio_planes_pago_fuera_de_regla_aprobado` → cae «fuera de regla sin aprobación»;
 *   · quitar el `revoke all ... from public, anon` del plan → cae «anon no la toca»;
 *   · policy con `using (true)` → cae «otro workspace no se ve».
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261012170000_plan_pagos_viajero_esquema.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const WS2 = '00000000-0000-4000-8000-0000000000a2'
const NEG = '00000000-0000-4000-8000-0000000000b1'
const NEG2 = '00000000-0000-4000-8000-0000000000b2'
const APR = '00000000-0000-4000-8000-0000000000e1'
const STAFF = '00000000-0000-4000-8000-0000000000d1'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    -- Como producción antes del 2026-08-10: toda tabla nueva nacía concedida.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create function public.current_user_workspace_id() returns uuid language sql stable
      as $$ select nullif(current_setting('app.ws', true), '')::uuid $$;
    create table public.workspaces (id uuid primary key);
    create table public.negocios (id uuid primary key, workspace_id uuid);
    create table public.cotizaciones (id uuid primary key);
    create table public.staff (id uuid primary key);
    create table public.aprobaciones_excepcion (id uuid primary key);
    create table public.cobros (id serial primary key, workspace_id uuid, monto numeric, fecha date);
    insert into public.workspaces values ('${WS}'), ('${WS2}');
    insert into public.negocios values ('${NEG}', '${WS}'), ('${NEG2}', '${WS2}');
    insert into public.staff values ('${STAFF}');
    insert into public.aprobaciones_excepcion values ('${APR}');
    insert into public.cobros (workspace_id, monto, fecha) values ('${WS}', 100, '2026-10-01');
  `)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
})

afterAll(async () => {
  await db.close()
})

async function falla(sql: string): Promise<string | null> {
  try {
    await db.exec(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const REGLA = `'{"pct_minimo":80,"dias_antes":15,"anticipo_pct":30}'::jsonb`

function plan(o: { version: number; estado?: string; dentro?: boolean; aprobacion?: string | null; negocio?: string; ws?: string }) {
  const estado = o.estado ?? 'propuesta'
  const acordado = estado === 'acordado' ? 'now()' : 'null'
  return `insert into public.negocio_planes_pago
    (workspace_id, negocio_id, version, estado, origen, total, regla, dentro_de_regla, aprobacion_id, acordado_at)
    values ('${o.ws ?? WS}', '${o.negocio ?? NEG}', ${o.version}, '${estado}', 'sugerido', 9165000, ${REGLA},
            ${o.dentro ?? true}, ${o.aprobacion ? `'${o.aprobacion}'` : 'null'}, ${acordado})`
}

describe('versiones y un solo acordado', () => {
  it('cada versión es una fila; la misma versión dos veces no', async () => {
    expect(await falla(plan({ version: 1 }))).toBeNull()
    expect(await falla(plan({ version: 1 }))).toMatch(/duplicate|unique/i)
  })

  it('un solo acordado por negocio', async () => {
    expect(await falla(plan({ version: 2, estado: 'acordado' }))).toBeNull()
    expect(await falla(plan({ version: 3, estado: 'acordado' }))).toMatch(/duplicate|unique/i)
    // Reemplazar el acordado libera el lugar para la versión nueva.
    await db.exec(`update public.negocio_planes_pago set estado = 'reemplazado' where version = 2 and negocio_id = '${NEG}'`)
    expect(await falla(plan({ version: 3, estado: 'acordado' }))).toBeNull()
  })

  it('fuera de regla sin aprobación no se acuerda; con aprobación sí', async () => {
    expect(await falla(plan({ version: 1, estado: 'acordado', dentro: false, negocio: NEG2, ws: WS2 }))).toMatch(/fuera_de_regla_aprobado/)
    expect(await falla(plan({ version: 1, estado: 'acordado', dentro: false, aprobacion: APR, negocio: NEG2, ws: WS2 }))).toBeNull()
  })

  it('acordado sin fecha y anulado sin motivo no pasan', async () => {
    expect(await falla(`insert into public.negocio_planes_pago (workspace_id, negocio_id, version, estado, origen, total, regla, dentro_de_regla)
      values ('${WS}', '${NEG}', 9, 'acordado', 'sugerido', 1, ${REGLA}, true)`)).toMatch(/acordado_con_fecha/)
    expect(await falla(`insert into public.negocio_planes_pago (workspace_id, negocio_id, version, estado, origen, total, regla, dentro_de_regla)
      values ('${WS}', '${NEG}', 10, 'anulado', 'sugerido', 1, ${REGLA}, true)`)).toMatch(/anulado_con_motivo/)
  })
})

describe('cuotas', () => {
  it('número único por plan, monto positivo; el anticipo es la 0', async () => {
    const r = await db.query<{ id: string }>(`select id from public.negocio_planes_pago where negocio_id = '${NEG}' and version = 1`)
    const id = r.rows[0].id
    const cuota = (n: number, monto: number) =>
      `insert into public.negocio_plan_cuotas (workspace_id, plan_id, numero, monto, fecha_vencimiento)
       values ('${WS}', '${id}', ${n}, ${monto}, '2026-11-19')`
    expect(await falla(cuota(0, 2750000))).toBeNull()
    expect(await falla(cuota(0, 1))).toMatch(/duplicate|unique/i)
    expect(await falla(cuota(1, 0))).toMatch(/check/i)
  })
})

describe('permisos', () => {
  it('authenticated lee y escribe; anon no toca nada', async () => {
    const r = await db.query<{ rol: string; t: string; s: boolean; i: boolean }>(`
      select rol, t,
             has_table_privilege(rol, t, 'select') as s,
             has_table_privilege(rol, t, 'insert') as i
        from unnest(array['anon', 'authenticated']) as rol,
             unnest(array['public.negocio_planes_pago', 'public.negocio_plan_cuotas']) as t`)
    for (const x of r.rows) {
      if (x.rol === 'anon') expect([x.t, x.s, x.i]).toEqual([x.t, false, false])
      else expect([x.t, x.s, x.i]).toEqual([x.t, true, true])
    }
  })

  it('otro workspace no se ve (RLS)', async () => {
    await db.exec(`grant usage on schema public to authenticated`)
    await db.exec(`set app.ws = '${WS2}'; set role authenticated;`)
    const r = await db.query<{ negocio_id: string }>(`select negocio_id from public.negocio_planes_pago`)
    await db.exec(`reset role;`)
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows.every((x) => x.negocio_id === NEG2)).toBe(true)
  })
})

describe('cobros.cuenta_recaudo', () => {
  it('columna nueva en null para lo que ya existe; texto vacío no pasa', async () => {
    const r = await db.query<{ cuenta_recaudo: string | null }>(`select cuenta_recaudo from public.cobros`)
    expect(r.rows.every((x) => x.cuenta_recaudo === null)).toBe(true)
    expect(await falla(`update public.cobros set cuenta_recaudo = '  '`)).toMatch(/check/i)
    expect(await falla(`update public.cobros set cuenta_recaudo = 'bancolombia_ahorros'`)).toBeNull()
  })
})
