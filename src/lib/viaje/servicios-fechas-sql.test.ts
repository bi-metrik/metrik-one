import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de fechas de los servicios (`20261021120000_servicios_fechas_tramos.sql`), corrida
 * en PGlite encima de la de F0, DOS veces (idempotente). Datos ficticios.
 *
 * VISTO FALLAR (2026-10-21), una mutación a la vez sobre la migración:
 *   · CHECK de fin en `true` → cae «fin anterior al inicio se rechaza»;
 *   · `make_date` quitado (solo el regex) → cae «un tramo con fecha imposible no entra»;
 *   · `with (security_invoker = on)` y el `alter view` quitados → cae «la vista respeta la RLS»;
 *   · `revoke all on public.negocio_servicio_fechas` quitado → cae «anon no lee la vista».
 */

const F0 = join(process.cwd(), 'supabase/migrations/20261012150000_servicios_viaje_esquema.sql')
const MIGRACION = join(process.cwd(), 'supabase/migrations/20261021120000_servicios_fechas_tramos.sql')
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

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.exec(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const fila = (cols: Record<string, string>, ws = WS, neg = NEG) => {
  const todas: Record<string, string> = { workspace_id: `'${ws}'`, negocio_id: `'${neg}'`, tipo: `'vuelo'`, nombre: `'Vuelo de prueba'`, ...cols }
  return `insert into public.negocio_servicios (${Object.keys(todas).join(', ')}) values (${Object.values(todas).join(', ')})`
}

const TRAMOS = JSON.stringify([
  { fecha: '2026-11-10', hora_salida: '06:10', hora_llegada: '07:45', origen: 'BOG', destino: 'ADZ', aerolinea: 'Aerolínea X', numero_vuelo: 'XX100' },
  { fecha: '2026-11-15', hora_salida: '18:30', hora_llegada: null, origen: 'ADZ', destino: 'BOG' },
])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await db.exec(readFileSync(F0, 'utf8'))
  await db.exec(readFileSync(MIGRACION, 'utf8'))
  // Idempotente: la segunda corrida no falla ni duplica nada.
  await db.exec(readFileSync(MIGRACION, 'utf8'))
}, 30_000)

afterAll(async () => {
  await db.close()
})

describe('negocio_servicios: fechas', () => {
  it('fin anterior al inicio se rechaza; fin sin inicio también; fin = inicio pasa', async () => {
    expect(await falla(fila({ fecha_servicio: `'2026-11-10'`, fecha_fin: `'2026-11-09'` }))).toMatch(/negocio_servicios_fin_tras_inicio/)
    expect(await falla(fila({ fecha_fin: `'2026-11-09'` }))).toMatch(/negocio_servicios_fin_tras_inicio/)
    expect(await falla(fila({ fecha_servicio: `'2026-11-10'`, fecha_fin: `'2026-11-10'` }))).toBeNull()
    await db.exec(`delete from public.negocio_servicios`)
  })

  it('un tramo con fecha imposible, hora rota o sin fecha no entra', async () => {
    for (const malo of [
      [{ fecha: '2026-02-30' }],
      [{ fecha: '10 nov' }],
      [{ fecha: '2026-11-10', hora_salida: '25:00' }],
      [{ hora_salida: '06:10' }],
      { fecha: '2026-11-10' },
    ]) {
      expect(await falla(fila({ tramos: `'${JSON.stringify(malo)}'::jsonb` })), JSON.stringify(malo)).toMatch(/negocio_servicios_tramos_forma/)
    }
    expect(await falla(fila({ tramos: `'${TRAMOS}'::jsonb`, fecha_servicio: `'2026-11-10'`, fecha_fin: `'2026-11-15'` }))).toBeNull()
    await db.exec(`delete from public.negocio_servicios`)
  })

  it('la corrección a mano lleva cuándo', async () => {
    expect(await falla(fila({ fechas_corregidas_por: `'${STAFF}'` }))).toMatch(/negocio_servicios_correccion_con_fecha/)
    expect(await falla(fila({ fechas_corregidas_por: `'${STAFF}'`, fechas_corregidas_at: 'now()' }))).toBeNull()
    await db.exec(`delete from public.negocio_servicios`)
  })
})

describe('vista negocio_servicio_fechas', () => {
  it('un renglón por tramo, más el inicio y el fin, consultable por tipo y ventana', async () => {
    await db.exec(fila({ tramos: `'${TRAMOS}'::jsonb`, fecha_servicio: `'2026-11-10'`, hora_inicio: `'06:10'`, fecha_fin: `'2026-11-15'`, hora_fin: `'18:30'` }))
    await db.exec(fila({ tipo: `'hotel'`, nombre: `'Hotel de prueba'`, fecha_servicio: `'2026-11-10'`, fecha_fin: `'2026-11-13'` }))
    // Sin fecha: no aparece (es «Falta la fecha» en la pantalla, no un hito).
    await db.exec(fila({ tipo: `'actividad'`, nombre: `'Tour sin fecha'` }))

    const tramos = await db.query<{ tramo: number; fecha: string; hora: string | null; origen: string | null }>(`
      select tramo, to_char(fecha, 'YYYY-MM-DD') as fecha, to_char(hora, 'HH24:MI') as hora, origen
        from public.negocio_servicio_fechas
       where tipo = 'vuelo' and ancla = 'tramo' and fecha between '2026-11-14' and '2026-11-16'`)
    expect(tramos.rows).toEqual([{ tramo: 2, fecha: '2026-11-15', hora: '18:30', origen: 'ADZ' }])

    const hotel = await db.query<{ ancla: string; fecha: string }>(`
      select ancla, to_char(fecha, 'YYYY-MM-DD') as fecha from public.negocio_servicio_fechas
       where tipo = 'hotel' order by ancla desc`)
    expect(hotel.rows).toEqual([{ ancla: 'inicio', fecha: '2026-11-10' }, { ancla: 'fin', fecha: '2026-11-13' }])

    const total = await db.query<{ n: number }>(`select count(*)::int as n from public.negocio_servicio_fechas`)
    expect(total.rows[0].n).toBe(6) // vuelo: 2 tramos + inicio + fin; hotel: inicio + fin
    await db.exec(`delete from public.negocio_servicios`)
  })

  it('la vista respeta la RLS por workspace (security_invoker)', async () => {
    await db.exec(fila({ fecha_servicio: `'2026-11-10'` }))
    await db.exec(fila({ fecha_servicio: `'2026-11-11'` }, WS2, NEG2))
    const op = await db.query<{ reloptions: string[] | null }>(`select reloptions from pg_class where relname = 'negocio_servicio_fechas'`)
    expect((op.rows[0].reloptions ?? []).some(o => /^security_invoker=(on|true)$/.test(o))).toBe(true)
    await db.exec(`set app.ws = '${WS}'; set role authenticated;`)
    try {
      const r = await db.query<{ n: number }>(`select count(*)::int as n from public.negocio_servicio_fechas`)
      expect(r.rows[0].n).toBe(1)
    } finally {
      await db.exec(`reset role; reset app.ws;`)
    }
    await db.exec(`delete from public.negocio_servicios`)
  })

  it('anon no lee la vista; authenticated y service_role sí', async () => {
    const r = await db.query<{ rol: string; s: boolean }>(`
      select rol, has_table_privilege(rol, 'public.negocio_servicio_fechas', 'select') as s
        from unnest(array['anon', 'authenticated', 'service_role']) as rol order by rol`)
    expect(r.rows.map(f => [f.rol, f.s])).toEqual([['anon', false], ['authenticated', true], ['service_role', true]])
  })
})
