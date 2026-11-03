import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de los hitos (`20261022090000_negocio_hitos.sql`), corrida en PGlite encima de F0 y
 * de la de fechas de los servicios (#1236), DOS veces (idempotente). Más el ensayo en seco con el
 * archivo real dentro de `DO … RAISE EXCEPTION` (lo que correría Mik en producción). Datos ficticios.
 *
 * VISTO FALLAR (2026-10-22), una mutación a la vez sobre la migración:
 *   · `nulls not distinct` quitado → cae «una marca por hito y fecha, con servicio y tramo nulos»;
 *   · CHECK de «No aplica» en `true` → cae «“No aplica” sin motivo se rechaza»;
 *   · `create policy` quitada → cae «RLS por workspace»;
 *   · el bloque de tipos de notificación quitado → cae «agrega los tipos nuevos sin perder los vivos».
 */

const F0 = join(process.cwd(), 'supabase/migrations/20261012150000_servicios_viaje_esquema.sql')
const FECHAS = join(process.cwd(), 'supabase/migrations/20261021120000_servicios_fechas_tramos.sql')
const MIGRACION = join(process.cwd(), 'supabase/migrations/20261022090000_negocio_hitos.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const WS2 = '00000000-0000-4000-8000-0000000000a2'
const NEG = '00000000-0000-4000-8000-0000000000b1'
const NEG2 = '00000000-0000-4000-8000-0000000000b2'
const SVC = '00000000-0000-4000-8000-0000000000c1'
const STAFF = '00000000-0000-4000-8000-0000000000d1'

const BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como producción desde el 2026-08-10: una tabla nueva no concede nada a anon ni authenticated.
  alter default privileges in schema public grant all on tables to service_role;
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
  -- Un tipo de otro PR abierto (#1153) ya aplicado: tiene que sobrevivir.
  alter table public.notificaciones add constraint notificaciones_tipo_check check (tipo in ('mencion', 'sistema', 'factura_electronica'));
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

const marca = (cols: Record<string, string>, ws = WS, neg = NEG) => {
  const todas: Record<string, string> = { workspace_id: `'${ws}'`, negocio_id: `'${neg}'`, hito_id: `'reconfirmar_hotel'`, fecha_objetivo: `'2026-11-15'`, estado: `'hecho'`, ...cols }
  return `insert into public.negocio_hitos (${Object.keys(todas).join(', ')}) values (${Object.values(todas).join(', ')})`
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await db.exec(readFileSync(F0, 'utf8'))
  await db.exec(readFileSync(FECHAS, 'utf8'))
  await db.exec(`insert into public.negocio_servicios (id, workspace_id, negocio_id, tipo, nombre) values ('${SVC}', '${WS}', '${NEG}', 'hotel', 'Hotel de prueba')`)
}, 30_000)

afterAll(async () => {
  await db.close()
})

describe('ensayo en seco (lo que corre Mik en producción)', () => {
  it('el archivo real dentro de DO … RAISE EXCEPTION corre entero y no deja nada', async () => {
    const sql = readFileSync(MIGRACION, 'utf8')
    const err = await falla(`do $dry$ begin\n${sql}\nraise exception 'dry-run ok'; end $dry$;`)
    expect(err).toMatch(/dry-run ok/)
    const r = await db.query<{ t: string | null }>(`select to_regclass('public.negocio_hitos')::text as t`)
    expect(r.rows[0].t).toBeNull()
  })
})

describe('negocio_hitos', () => {
  beforeAll(async () => {
    await db.exec(readFileSync(MIGRACION, 'utf8'))
    // Idempotente: la segunda corrida no falla ni duplica nada.
    await db.exec(readFileSync(MIGRACION, 'utf8'))
  })

  it('agrega los tipos nuevos sin perder los vivos (ni el de otro PR)', async () => {
    const r = await db.query<{ d: string }>(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'notificaciones_tipo_check'`)
    for (const t of ['mencion', 'sistema', 'factura_electronica', 'agenda_del_dia', 'hito_vencido']) expect(r.rows[0].d).toContain(`'${t}'`)
    expect(r.rows[0].d.match(/'agenda_del_dia'/g)).toHaveLength(1)
    expect(await falla(`insert into public.notificaciones (tipo) values ('agenda_del_dia'), ('hito_vencido')`)).toBeNull()
    expect(await falla(`insert into public.notificaciones (tipo) values ('otro_tipo')`)).toMatch(/notificaciones_tipo_check/)
  })

  it('una marca por hito y fecha, con servicio y tramo nulos; otra fecha es otra marca', async () => {
    expect(await falla(marca({}))).toBeNull()
    expect(await falla(marca({}))).toMatch(/negocio_hitos_una_vez/)
    expect(await falla(marca({ fecha_objetivo: `'2026-11-22'` }))).toBeNull()
    expect(await falla(marca({ servicio_id: `'${SVC}'` }))).toBeNull()
    expect(await falla(marca({ servicio_id: `'${SVC}'` }))).toMatch(/negocio_hitos_una_vez/)
    expect(await falla(marca({ servicio_id: `'${SVC}'`, tramo: '1', hito_id: `'checkin_vuelo'` }))).toBeNull()
    expect(await falla(marca({ servicio_id: `'${SVC}'`, tramo: '2', hito_id: `'checkin_vuelo'` }))).toBeNull()
    await db.exec(`delete from public.negocio_hitos`)
  })

  it('el upsert de la acción (ON CONFLICT con las cinco columnas) actualiza la misma marca', async () => {
    const up = (estado: string, nota: string) => `insert into public.negocio_hitos (workspace_id, negocio_id, servicio_id, tramo, hito_id, fecha_objetivo, estado, nota)
      values ('${WS}', '${NEG}', null, null, 'pedir_documentos', '2026-10-01', '${estado}', '${nota}')
      on conflict (negocio_id, servicio_id, tramo, hito_id, fecha_objetivo) do update set estado = excluded.estado, nota = excluded.nota`
    await db.exec(up('hecho', 'uno'))
    await db.exec(up('no_aplica', 'el cliente los mandó por correo'))
    const r = await db.query<{ n: number; estado: string }>(`select count(*)::int as n, max(estado) as estado from public.negocio_hitos`)
    expect(r.rows[0]).toEqual({ n: 1, estado: 'no_aplica' })
    await db.exec(`delete from public.negocio_hitos`)
  })

  it('«No aplica» sin motivo se rechaza; estado y adjunto con forma', async () => {
    expect(await falla(marca({ estado: `'no_aplica'` }))).toMatch(/negocio_hitos_no_aplica_con_motivo/)
    expect(await falla(marca({ estado: `'no_aplica'`, nota: `'   '` }))).toMatch(/negocio_hitos_no_aplica_con_motivo/)
    expect(await falla(marca({ estado: `'pendiente'` }))).toMatch(/negocio_hitos_estado_check/)
    expect(await falla(marca({ evidencia_ref: `'https://otro.sitio/x.pdf'` }))).toMatch(/negocio_hitos_evidencia_ref_check/)
    expect(await falla(marca({ hito_id: `'Mal Id'` }))).toMatch(/negocio_hitos_hito_id_check/)
    expect(await falla(marca({ estado: `'no_aplica'`, nota: `'El cliente lo hizo'`, evidencia_ref: `'one://documentos-one/ws/x.pdf'` }))).toBeNull()
    await db.exec(`delete from public.negocio_hitos`)
  })

  it('borrar el servicio borra sus marcas (reproceso)', async () => {
    await db.exec(`insert into public.negocio_servicios (id, workspace_id, negocio_id, tipo, nombre) values ('00000000-0000-4000-8000-0000000000c2', '${WS}', '${NEG}', 'actividad', 'Tour')`)
    await db.exec(marca({ servicio_id: `'00000000-0000-4000-8000-0000000000c2'`, hito_id: `'detalles_tour'`, nota: `'8:00 muelle'` }))
    await db.exec(`delete from public.negocio_servicios where id = '00000000-0000-4000-8000-0000000000c2'`)
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.negocio_hitos`)
    expect(r.rows[0].n).toBe(0)
  })

  it('RLS por workspace: cada quien ve y escribe solo lo suyo', async () => {
    await db.exec(marca({}))
    await db.exec(marca({}, WS2, NEG2))
    await db.exec(`set app.ws = '${WS}'; set role authenticated;`)
    try {
      const r = await db.query<{ n: number }>(`select count(*)::int as n from public.negocio_hitos`)
      expect(r.rows[0].n).toBe(1)
      expect(await falla(marca({ fecha_objetivo: `'2026-12-01'` }, WS2, NEG2))).toMatch(/row-level security/)
      expect(await falla(marca({ fecha_objetivo: `'2026-12-01'` }))).toBeNull()
    } finally {
      await db.exec(`reset role; reset app.ws;`)
    }
    await db.exec(`delete from public.negocio_hitos`)
  })

  it('grants: authenticated y service_role sí; anon nada', async () => {
    const r = await db.query<{ rol: string; s: boolean; i: boolean }>(`
      select rol, has_table_privilege(rol, 'public.negocio_hitos', 'select') as s, has_table_privilege(rol, 'public.negocio_hitos', 'insert') as i
        from unnest(array['anon', 'authenticated', 'service_role']) as rol order by rol`)
    expect(r.rows.map(f => [f.rol, f.s, f.i])).toEqual([['anon', false, false], ['authenticated', true, true], ['service_role', true, true]])
  })
})
