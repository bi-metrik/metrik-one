import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de moneda y tipo «Tren» (`20261029221700_viaje_moneda_servicios_y_tren.sql`, QA G9),
 * corrida en PGlite encima de F0 y de las fechas, DOS veces (idempotente). Datos ficticios.
 */

const F0 = join(process.cwd(), 'supabase/migrations/20261012150000_servicios_viaje_esquema.sql')
const FECHAS = join(process.cwd(), 'supabase/migrations/20261021120000_servicios_fechas_tramos.sql')
const MIGRACION = join(process.cwd(), 'supabase/migrations/20261029221700_viaje_moneda_servicios_y_tren.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const WS2 = '00000000-0000-4000-8000-0000000000a2'
const NEG = '00000000-0000-4000-8000-0000000000b1'
const NEG2 = '00000000-0000-4000-8000-0000000000b2'
const STAFF = '00000000-0000-4000-8000-0000000000d1'

/** Lo mínimo que tocan las dos migraciones (mismo esquema base que la prueba de F0). */
const BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como producción antes del 2026-08-10: toda tabla o vista nueva nacía concedida.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create function public.current_user_workspace_id() returns uuid language sql stable
    as $$ select nullif(current_setting('app.ws', true), '')::uuid $$;
  create table public.workspaces (id uuid primary key);
  create table public.negocios (id uuid primary key, workspace_id uuid);
  create table public.cotizaciones (id uuid primary key);
  create table public.cotizacion_itinerarios (id uuid primary key);
  create table public.items (id uuid primary key);
  create table public.empresas (id uuid primary key);
  create table public.staff (id uuid primary key);
  create table public.gastos (id serial primary key, workspace_id uuid, categoria text not null, monto numeric);
  alter table public.gastos add constraint gastos_categoria_check check (categoria in ('otros', 'materiales'));
  create table public.notificaciones (id serial primary key, tipo text not null, entidad_tipo text);
  alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo in ('mencion', 'sistema'));
  alter table public.notificaciones add constraint notificaciones_entidad_tipo_check check (entidad_tipo in ('negocio', 'cobro'));
  create table public.bloque_definitions (
    id serial primary key, codigo text unique, tipo text not null, nombre text, descripcion text,
    is_visualization boolean, can_be_gate boolean, supports_array_items boolean, default_estado text, icon_name text);
  alter table public.bloque_definitions add constraint bloque_definitions_tipo_check check (tipo = any (array['datos', 'cobros']));
  insert into public.workspaces values ('${WS}'), ('${WS2}');
  insert into public.negocios values ('${NEG}', '${WS}'), ('${NEG2}', '${WS2}');
  insert into public.staff values ('${STAFF}');
`

/** `cotizacion_ranuras` como la dejó 20261027174500 (solo lo que toca la migración). */
const RANURAS = `
  create table public.cotizacion_ranuras (id serial primary key, tipo text not null);
  alter table public.cotizacion_ranuras add constraint cotizacion_ranuras_tipo_check
    check (tipo in ('vuelo', 'hotel', 'actividad', 'traslado', 'otro', 'paquete'));
  insert into public.cotizacion_ranuras (tipo) values ('vuelo'), ('paquete');
`

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.exec(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const servicio = (cols: Record<string, string>) => {
  const todas: Record<string, string> = { workspace_id: `'${WS}'`, negocio_id: `'${NEG}'`, tipo: `'hotel'`, nombre: `'Hotel de prueba'`, ...cols }
  return `insert into public.negocio_servicios (${Object.keys(todas).join(', ')}) values (${Object.values(todas).join(', ')})`
}
const gasto = (cols: Record<string, string>) => {
  const todas: Record<string, string> = { workspace_id: `'${WS}'`, categoria: `'otros'`, monto: '100', ...cols }
  return `insert into public.gastos (${Object.keys(todas).join(', ')}) values (${Object.values(todas).join(', ')})`
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await db.exec(RANURAS)
  await db.exec(readFileSync(F0, 'utf8'))
  await db.exec(readFileSync(FECHAS, 'utf8'))
  // Una fila de antes: la migración no la toca.
  await db.exec(servicio({ costo_cotizado: '8650260' }))
  await db.exec(gasto({ monto: '8817012' }))
  await db.exec(readFileSync(MIGRACION, 'utf8'))
  // Idempotente: la segunda corrida no falla ni duplica nada.
  await db.exec(readFileSync(MIGRACION, 'utf8'))
}, 30_000)

afterAll(async () => {
  await db.close()
})

describe('moneda en servicios y pagos (H6-1, H9-1, H6-3)', () => {
  it('las filas de antes quedan en pesos (null), sin tocarlas', async () => {
    const s = await db.query<{ moneda: string | null; costo_moneda: string | null; tasa_cotizada: string | null; costo_cotizado: string }>(
      'select moneda, costo_moneda, tasa_cotizada, costo_cotizado from public.negocio_servicios')
    expect(s.rows).toHaveLength(1)
    expect(s.rows[0].moneda).toBeNull()
    expect(s.rows[0].costo_moneda).toBeNull()
    expect(s.rows[0].tasa_cotizada).toBeNull()
    expect(Number(s.rows[0].costo_cotizado)).toBe(8650260)
    const g = await db.query<{ moneda: string | null; monto_moneda: string | null; tasa_cambio: string | null }>('select moneda, monto_moneda, tasa_cambio from public.gastos')
    expect(g.rows).toEqual([{ moneda: null, monto_moneda: null, tasa_cambio: null }])
  })

  it('el servicio guarda moneda, monto y tasa juntos; ni COP ni a medias', async () => {
    expect(await falla(servicio({ moneda: `'USD'`, costo_moneda: '2084.40', tasa_cotizada: '4150' }))).toBeNull()
    expect(await falla(servicio({ moneda: `'USD'` }))).toMatch(/negocio_servicios_moneda_coherente/)
    expect(await falla(servicio({ moneda: `'COP'`, costo_moneda: '1', tasa_cotizada: '1' }))).toMatch(/negocio_servicios_moneda_coherente/)
    expect(await falla(servicio({ moneda: `'usd'`, costo_moneda: '1', tasa_cotizada: '4150' }))).toMatch(/negocio_servicios_moneda_coherente/)
    expect(await falla(servicio({ moneda: `'EUR'`, costo_moneda: '0', tasa_cotizada: '4500' }))).toMatch(/negocio_servicios_moneda_coherente/)
    expect(await falla(servicio({ tasa_cotizada: '4150' }))).toMatch(/negocio_servicios_moneda_coherente/)
  })

  it('el pago guarda moneda, monto en la moneda y TRM juntos', async () => {
    expect(await falla(gasto({ moneda: `'USD'`, monto_moneda: '2084.40', tasa_cambio: '4230' }))).toBeNull()
    expect(await falla(gasto({ moneda: `'USD'`, tasa_cambio: '4230' }))).toMatch(/gastos_moneda_coherente/)
    expect(await falla(gasto({ moneda: `'COP'`, monto_moneda: '1', tasa_cambio: '1' }))).toMatch(/gastos_moneda_coherente/)
    expect(await falla(gasto({ tasa_cambio: '4230' }))).toMatch(/gastos_moneda_coherente/)
  })
})

describe('tipo «Tren» (M9-1)', () => {
  it('negocio_servicios acepta tren y sigue aceptando los de antes', async () => {
    for (const tipo of ['vuelo', 'hotel', 'traslado', 'actividad', 'asistencia', 'otro', 'tren']) {
      expect(await falla(servicio({ tipo: `'${tipo}'` })), tipo).toBeNull()
    }
    expect(await falla(servicio({ tipo: `'bus'` }))).toMatch(/negocio_servicios_tipo_check/)
  })

  it('cotizacion_ranuras acepta tren, conserva sus filas y un solo CHECK de tipo', async () => {
    expect(await falla(`insert into public.cotizacion_ranuras (tipo) values ('tren')`)).toBeNull()
    expect(await falla(`insert into public.cotizacion_ranuras (tipo) values ('bus')`)).toMatch(/cotizacion_ranuras_tipo_check/)
    const n = await db.query<{ n: number }>(`select count(*)::int n from pg_constraint where conrelid = 'public.cotizacion_ranuras'::regclass and contype = 'c'`)
    expect(n.rows[0].n).toBe(1)
    const t = await db.query<{ tipo: string }>('select tipo from public.cotizacion_ranuras order by id')
    expect(t.rows.map(r => r.tipo)).toEqual(['vuelo', 'paquete', 'tren'])
  })
})
