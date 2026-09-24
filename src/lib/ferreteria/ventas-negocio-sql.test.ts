import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración que vuelve negocio cada venta de Ferretería, ejecutada de verdad en Postgres en
 * memoria (PGlite) sobre la del módulo. Se prueba lo que la base tiene que GARANTIZAR sola: que
 * la línea nace solo en dimpro y una sola vez, con sus tres etapas marcadas y sin avisos; que una
 * venta anticipada no puede quedar sin pago; y que un negocio no se reparte entre dos ventas.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const A1 = '20260915210000_workspace_modulos.sql'
const A2 = '20260916120000_catalogo_y_servicios_contratados.sql'
const FERRETERIA = '20260924235500_modulo_ferreteria.sql'
const VENTAS_NEGOCIO = '20260925120000_ferreteria_ventas_negocio.sql'

const DIMPRO = '67f7af44-b5ac-4d5c-aa9e-44954368447c'
const OTRO = '00000000-0000-4000-8000-0000000000a2'
const MAURICIO = 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'
const NEG_1 = '00000000-0000-4000-8000-0000000000b1'
const NEG_2 = '00000000-0000-4000-8000-0000000000b2'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key, slug text, modules jsonb default '{}'::jsonb);
  create table public.profiles  (id uuid primary key, workspace_id uuid);
  create table public.empresas  (id uuid primary key, nombre text);
  create table public.negocios  (id uuid primary key, codigo text);

  -- Forma mínima de producción (20260405000000 + tipo 'recurrente' + config_extra + stage 'cerrado').
  create table public.lineas_negocio (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id),
    nombre text not null,
    descripcion text,
    tipo text not null default 'clarity' check (tipo in ('plantilla', 'clarity', 'recurrente')),
    is_active boolean not null default true,
    config_extra jsonb not null default '{}'::jsonb
  );
  create table public.etapas_negocio (
    id uuid primary key default gen_random_uuid(),
    linea_id uuid not null references public.lineas_negocio(id) on delete cascade,
    stage text not null check (stage in ('venta', 'ejecucion', 'cobro', 'cerrado')),
    nombre text not null,
    orden integer not null default 0,
    is_active boolean not null default true,
    config_extra jsonb not null default '{}'::jsonb
  );

  create function public.current_user_workspace_id() returns uuid language sql stable as
    $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;

  insert into public.workspaces (id, slug, modules) values
    ('${DIMPRO}', 'dimpro', '{"business": true, "causacion": true}'::jsonb),
    ('${OTRO}', 'otro', '{"business": true}'::jsonb);
  insert into public.profiles (id, workspace_id) values ('${MAURICIO}', '${DIMPRO}');
  insert into public.negocios (id, codigo) values ('${NEG_1}', 'P 26 1'), ('${NEG_2}', 'P 26 2');
  -- Una plantilla global, que la migración no puede tocar.
  insert into public.lineas_negocio (workspace_id, nombre, tipo) values (null, 'Ejecuto proyectos', 'plantilla');
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

let pubId: string

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer(A1))
  await db.exec(leer(A2))
  await db.exec(leer(FERRETERIA))
  // Una venta del flujo anterior, para ver que el backfill la lee como anticipada.
  await db.exec(`
    insert into public.ferreteria_productos (id, workspace_id, sku, nombre) values ('00000000-0000-4000-8000-00000000c001', '${DIMPRO}', 'EKM80', 'Esmeril');
    insert into public.ferreteria_publicaciones (id, workspace_id, codigo, producto_id, canal, titulo, estado)
      values ('00000000-0000-4000-8000-00000000c002', '${DIMPRO}', 'MP-01', '00000000-0000-4000-8000-00000000c001', 'marketplace', 'Esmeril', 'activa');
    insert into public.ferreteria_ventas (workspace_id, publicacion_id, fecha_primer_pago, precio_final, costo_dia, ganancia, ruta)
      values ('${DIMPRO}', '00000000-0000-4000-8000-00000000c002', '2026-09-20', 120000, 80000, 26125, 'recoge');
  `)
  pubId = '00000000-0000-4000-8000-00000000c002'
  await db.exec(leer(VENTAS_NEGOCIO))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('línea Ferretería', () => {
  it('nace solo en dimpro, con las tres etapas marcadas por paso', async () => {
    const lineas = await db.query<{ workspace_id: string | null; nombre: string; modulo: string | null }>(
      `select workspace_id, nombre, config_extra->>'modulo' as modulo from public.lineas_negocio order by nombre`,
    )
    expect(lineas.rows).toEqual([
      { workspace_id: null, nombre: 'Ejecuto proyectos', modulo: null },
      { workspace_id: DIMPRO, nombre: 'Ferretería', modulo: 'ferreteria' },
    ])
    const etapas = await db.query<{ nombre: string; stage: string; orden: number; paso: string; cierre: string | null; salto: string }>(`
      select e.nombre, e.stage, e.orden, e.config_extra->>'ferreteria_paso' as paso,
             e.config_extra->>'etapa_cierre' as cierre, e.config_extra->>'saltar_si_saldo_cero' as salto
        from public.etapas_negocio e join public.lineas_negocio l on l.id = e.linea_id
       where l.workspace_id = '${DIMPRO}' order by e.orden`)
    expect(etapas.rows).toEqual([
      { nombre: 'Vendido', stage: 'ejecucion', orden: 1, paso: 'vendido', cierre: null, salto: 'false' },
      { nombre: 'Entregado', stage: 'cobro', orden: 2, paso: 'entregado', cierre: null, salto: 'false' },
      { nombre: 'Pagado', stage: 'cobro', orden: 3, paso: 'pagado', cierre: 'true', salto: 'false' },
    ])
  })

  it('ninguna etapa declara avisos: crear, mover o cerrar no le escribe a nadie', async () => {
    const r = await db.query<{ n: number }>(`
      select count(*)::int as n from public.etapas_negocio
       where config_extra ? 'avisar_al_entrar' or config_extra ? 'avisar_al_cliente'`)
    expect(r.rows[0].n).toBe(0)
  })

  it('correrla dos veces no duplica la línea', async () => {
    // Solo el bloque de datos: el de esquema no es re-ejecutable (agrega columnas) y no se pide.
    await db.exec(leer(VENTAS_NEGOCIO).split(/^-- ── 2\. Línea Ferretería de dimpro.*$/m)[1])
    const r = await db.query<{ n: number; e: number }>(`
      select (select count(*)::int from public.lineas_negocio where config_extra->>'modulo' = 'ferreteria') as n,
             (select count(*)::int from public.etapas_negocio) as e`)
    expect(r.rows[0]).toEqual({ n: 1, e: 3 })
  })
})

describe('ferreteria_ventas', () => {
  const base = (extra: string) => `
    insert into public.ferreteria_ventas
      (workspace_id, publicacion_id, fecha_venta, fecha_primer_pago, precio_final, costo_dia, ganancia, ruta, forma_pago, negocio_id)
    values ('${DIMPRO}', '${'$PUB'}', ${extra})`

  it('la venta vieja queda anticipada el día de su pago', async () => {
    const r = await db.query<{ fecha_venta: string; forma_pago: string }>(
      `select fecha_venta::text, forma_pago from public.ferreteria_ventas`,
    )
    expect(r.rows).toEqual([{ fecha_venta: '2026-09-20', forma_pago: 'anticipado' }])
  })

  it('contra entrega nace sin pago; anticipada sin pago no entra', async () => {
    expect(await falla(base(`'2026-10-01', null, 120000, 80000, 26125, 'despacho', 'contra_entrega', '${NEG_1}'`).replace('$PUB', pubId))).toBeNull()
    expect(await falla(base(`'2026-10-01', null, 120000, 80000, 26125, 'despacho', 'anticipado', null`).replace('$PUB', pubId))).toMatch(
      /ferreteria_ventas_pago_coherente/,
    )
  })

  it('un negocio es de una sola venta', async () => {
    expect(await falla(base(`'2026-10-02', '2026-10-02', 90000, 60000, 19593, 'recoge', 'anticipado', '${NEG_1}'`).replace('$PUB', pubId))).toMatch(
      /ferreteria_ventas_negocio_unico/,
    )
    expect(await falla(base(`'2026-10-02', '2026-10-02', 90000, 60000, 19593, 'recoge', 'anticipado', '${NEG_2}'`).replace('$PUB', pubId))).toBeNull()
  })

  it('forma de pago fuera del catálogo se rechaza', async () => {
    expect(await falla(base(`'2026-10-03', '2026-10-03', 90000, 60000, 19593, 'recoge', 'credito', null`).replace('$PUB', pubId))).toMatch(
      /forma_pago/,
    )
  })

  it('el navegador sigue sin poder escribir ventas', async () => {
    const r = await db.query<{ ok: boolean }>(`select has_table_privilege('authenticated', 'public.ferreteria_ventas', 'insert') as ok`)
    expect(r.rows[0].ok).toBe(false)
  })
})
