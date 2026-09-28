import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de `ferreteria_pagos_wompi`, ejecutada en PGlite: server-only (ni `anon` ni
 * `authenticated` la leen ni la escriben), la llave de idempotencia (transacción, estado), una
 * transacción = a lo sumo una venta, y la ampliación del CHECK de `notificaciones.tipo` que se
 * hace LEYENDO el que está en la base (conserva un tipo que las migraciones no conocen).
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20260928170500_ferreteria_pagos_wompi.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const PUB = '00000000-0000-4000-8000-0000000000b1'
const VENTA = '00000000-0000-4000-8000-0000000000c1'
const VENTA2 = '00000000-0000-4000-8000-0000000000c2'

const ESQUEMA_BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como producción antes del 2026-08-10: toda tabla nueva nacía concedida. La migración tiene que revocar.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.workspaces (id uuid primary key);
  create table public.ferreteria_publicaciones (id uuid primary key);
  create table public.ferreteria_ventas (id uuid primary key);
  create table public.notificaciones (id serial primary key, tipo text not null);
  -- Un tipo que las migraciones de este repo no listan: la ampliación tiene que conservarlo.
  alter table public.notificaciones add constraint notificaciones_tipo_check
    check (tipo = any (array['mencion', 'tipo_solo_en_produccion']::text[]));
  insert into public.workspaces values ('${WS}');
  insert into public.ferreteria_publicaciones values ('${PUB}');
  insert into public.ferreteria_ventas values ('${VENTA}'), ('${VENTA2}');
  insert into public.notificaciones (tipo) values ('tipo_solo_en_produccion');
`

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.query(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const insertar = (tx: string, estado: string, extra = '') =>
  `insert into public.ferreteria_pagos_wompi (workspace_id, transaccion_id, estado_wompi, entorno, payload ${extra ? `, ${extra.split('=')[0]}` : ''})
   values ('${WS}', '${tx}', '${estado}', 'prod', '{}'::jsonb ${extra ? `, ${extra.split('=')[1]}` : ''})`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
})

afterAll(async () => {
  await db.close()
})

describe('ferreteria_pagos_wompi', () => {
  it('RLS encendido y server-only: ni anon ni authenticated la leen ni la escriben', async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'ferreteria_pagos_wompi'`)
    expect(rls.rows[0].relrowsecurity).toBe(true)
    const r = await db.query<{ rol: string; s: boolean; i: boolean; u: boolean }>(`
      select rol,
             has_table_privilege(rol, 'public.ferreteria_pagos_wompi', 'select') as s,
             has_table_privilege(rol, 'public.ferreteria_pagos_wompi', 'insert') as i,
             has_table_privilege(rol, 'public.ferreteria_pagos_wompi', 'update') as u
        from unnest(array['anon', 'authenticated']) as rol`)
    for (const f of r.rows) {
      expect([f.s, f.i, f.u], f.rol).toEqual([false, false, false])
    }
  })

  it('un evento repetido (misma transacción y estado) choca; otro estado de la misma transacción entra', async () => {
    expect(await falla(insertar('tx-1', 'DECLINED'))).toBeNull()
    expect(await falla(insertar('tx-1', 'DECLINED'))).toMatch(/ferreteria_pagos_wompi_evento_unico/)
    expect(await falla(insertar('tx-1', 'APPROVED'))).toBeNull()
  })

  it('una venta no se amarra a dos transacciones, y «registrada» exige venta', async () => {
    expect(await falla(insertar('tx-2', 'APPROVED', `venta_id='${VENTA}'`))).toBeNull()
    expect(await falla(insertar('tx-3', 'APPROVED', `venta_id='${VENTA}'`))).toMatch(/ferreteria_pagos_wompi_venta_unica/)
    expect(await falla(insertar('tx-4', 'APPROVED', `registro='registrada'`))).toMatch(/ferreteria_pagos_wompi_registrada_con_venta/)
  })

  it('rechaza estados, entornos y registros que no existen', async () => {
    expect(await falla(insertar('tx-5', 'PAGADO'))).toMatch(/check/)
    expect(await falla(insertar('tx-6', 'APPROVED', `registro='inventado'`))).toMatch(/check/)
    expect(
      await falla(`insert into public.ferreteria_pagos_wompi (workspace_id, transaccion_id, estado_wompi, entorno, payload)
                   values ('${WS}', 'tx-7', 'APPROVED', 'staging', '{}'::jsonb)`),
    ).toMatch(/check/)
  })
})

describe('notificaciones.tipo', () => {
  it('admite ferreteria_pago y conserva los tipos que ya estaban, incluido uno que solo existe en la base', async () => {
    expect(await falla(`insert into public.notificaciones (tipo) values ('ferreteria_pago')`)).toBeNull()
    expect(await falla(`insert into public.notificaciones (tipo) values ('mencion')`)).toBeNull()
    expect(await falla(`insert into public.notificaciones (tipo) values ('tipo_solo_en_produccion')`)).toBeNull()
    expect(await falla(`insert into public.notificaciones (tipo) values ('otro')`)).toMatch(/notificaciones_tipo_check/)
  })

  it('correrla dos veces no vuelve a tocar el CHECK', async () => {
    await db.exec(`drop table public.ferreteria_pagos_wompi`)
    await db.exec(readFileSync(MIGRACION, 'utf8'))
    const r = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notificaciones_tipo_check'`,
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].def.match(/ferreteria_pago/g)).toHaveLength(1)
  })
})
