import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de la sección Suscripción, ejecutada de verdad en PGlite: la comisión fija + porcentaje,
 * las dos funciones de licencias (que tienen que RECHAZAR tocar una cuota ya cobrada) y los permisos.
 *
 * Se aplican los archivos del repo tal cual: A1 y A2 (catálogo y contratos) y esta. Las tablas de
 * las que dependen las llaves foráneas y las funciones (`workspaces`, `profiles`, `planes_cobro`,
 * `plan_cobro_cuotas`, `cobros`, `contactos`) se crean con lo mínimo, no con su esquema real.
 * Los privilegios por defecto replican producción: toda función nace ejecutable por `anon` y
 * `authenticated`, así que la prueba de permisos fallaría si faltara un `revoke`.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000a1'
const WS_CDA = '00000000-0000-4000-8000-0000000000a2'
const EMPRESA = '00000000-0000-4000-8000-0000000000b1'
const NEGOCIO = '00000000-0000-4000-8000-0000000000c1'
const PERFIL = '00000000-0000-4000-8000-0000000000d1'
const PLAN = '00000000-0000-4000-8000-0000000000f1'
const Q1 = '00000000-0000-4000-8000-000000000011'
const Q2 = '00000000-0000-4000-8000-000000000012'
const Q3 = '00000000-0000-4000-8000-000000000013'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key, slug text, modules jsonb default '{}'::jsonb, max_seats integer not null default 1);
  create table public.profiles  (id uuid primary key);
  create table public.empresas  (id uuid primary key, nombre text);
  create table public.negocios  (id uuid primary key, codigo text);
  create table public.contactos (id uuid primary key default gen_random_uuid(), workspace_id uuid, nombre text);
  create table public.planes_cobro (id uuid primary key, workspace_id uuid, negocio_id uuid);
  create table public.plan_cobro_cuotas (
    id uuid primary key, workspace_id uuid, plan_cobro_id uuid references public.planes_cobro(id),
    numero integer, monto numeric, fecha_vencimiento date, concepto_detalle text, updated_at timestamptz default now()
  );
  create table public.cobros (id uuid primary key default gen_random_uuid(), plan_cobro_id uuid, numero_cuota integer, anulado_at timestamptz);

  insert into public.workspaces (id, slug, max_seats) values ('${WS}', 'metrik', 5), ('${WS_CDA}', 'cda-x', 2);
  insert into public.profiles (id) values ('${PERFIL}');
  insert into public.empresas (id, nombre) values ('${EMPRESA}', 'CDA X');
  insert into public.negocios (id, codigo) values ('${NEGOCIO}', 'C1 26 1');
  insert into public.planes_cobro (id, workspace_id, negocio_id) values ('${PLAN}', '${WS}', '${NEGOCIO}');
  insert into public.plan_cobro_cuotas (id, workspace_id, plan_cobro_id, numero, monto, fecha_vencimiento, concepto_detalle) values
    ('${Q1}', '${WS}', '${PLAN}', 1, 150000, '2026-09-30', 'Licencia — periodo del 23/09/2026 al 22/10/2026'),
    ('${Q2}', '${WS}', '${PLAN}', 2, 150000, '2026-10-27', 'Licencia — periodo del 23/10/2026 al 22/11/2026'),
    ('${Q3}', '${WS}', '${PLAN}', 3, 150000, '2026-11-27', 'Licencia — periodo del 23/11/2026 al 22/12/2026');
  -- La cuota 1 ya tiene su cobro programado (el enlace de pago enviado).
  insert into public.cobros (plan_cobro_id, numero_cuota) values ('${PLAN}', 1);
`

let db: PGlite
let SC = ''

async function falla(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const cargosQ2 = [
  { cuota_id: Q2, tipo: 'prorrata', periodo_desde: '2026-09-24', periodo_hasta: '2026-10-22', dias: 29, dias_periodo: 30, monto: 48333 },
  { cuota_id: Q2, tipo: 'periodo', periodo_desde: '2026-10-23', periodo_hasta: '2026-11-22', dias: 31, dias_periodo: 31, monto: 50000 },
  { cuota_id: Q3, tipo: 'periodo', periodo_desde: '2026-11-23', periodo_hasta: '2026-12-22', dias: 30, dias_periodo: 30, monto: 50000 },
]
const cuotasCompra = [
  { cuota_id: Q2, monto_antes: 150000, monto_nuevo: 248333, concepto_nuevo: 'Licencia · Incluye: …' },
  { cuota_id: Q3, monto_antes: 150000, monto_nuevo: 200000, concepto_nuevo: 'Licencia · Incluye: …' },
]
const COMPRA = `select public.registrar_compra_licencia($1, $2, $3::date, $4, $5, $6::jsonb, $7::jsonb, $8) as id`
const compra = (over: Partial<{ valor: number; antes: number; cargos: unknown; cuotas: unknown }> = {}) =>
  db.query<{ id: string }>(COMPRA, [
    SC,
    PERFIL,
    '2026-09-24',
    over.valor ?? 50000,
    over.antes ?? 2,
    JSON.stringify(over.cargos ?? cargosQ2),
    JSON.stringify(over.cuotas ?? cuotasCompra),
    'Solicitud expresa de un usuario adicional (cláusula 2.3)',
  ])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer('20260915210000_workspace_modulos.sql'))
  await db.exec(leer('20260916120000_catalogo_y_servicios_contratados.sql'))
  await db.exec(leer('20260924060000_suscripcion_cda_licencias_usuarios_comision.sql'))
  await db.query(`select public.registrar_version_catalogo($1, 1, $2::jsonb, $3, $4)`, [
    'valida-cda-licencia',
    JSON.stringify({ nombre: 'Licencia Valida por CDA', modulo: 'valida_consulta', disparador_cobro: 'ciclo' }),
    'cerebro/catalogo/servicios/valida-cda-licencia.md',
    'a'.repeat(64),
  ])
  const r = await db.query<{ id: string }>(`
    insert into public.servicios_contratados
      (workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, parametros, workspace_pagador_id, estado, vigente_desde)
    values ('${WS}', '${EMPRESA}', '${NEGOCIO}', 'valida-cda-licencia', 1,
            '{"precio_mensual":150000,"licencias":2,"valor_usuario_adicional":50000}'::jsonb, '${WS_CDA}', 'activo', '2026-09-23')
    returning id`)
  SC = r.rows[0].id
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('permisos', () => {
  it('las funciones nuevas solo las ejecuta service_role (el default las concedía a anon y authenticated)', async () => {
    const r = await db.query<{ proname: string; a: boolean; b: boolean; s: boolean }>(`
      select proname,
             has_function_privilege('anon', p.oid, 'execute') as a,
             has_function_privilege('authenticated', p.oid, 'execute') as b,
             has_function_privilege('service_role', p.oid, 'execute') as s
        from pg_proc p
       where pronamespace = 'public'::regnamespace
         and proname in ('registrar_compra_licencia', 'registrar_retiro_licencia', 'comision_coherente')
       order by proname`)
    expect(r.rows.map((x) => x.proname)).toEqual(['comision_coherente', 'registrar_compra_licencia', 'registrar_retiro_licencia'])
    expect(r.rows.filter((x) => x.a || x.b)).toEqual([])
    expect(r.rows.filter((x) => x.proname !== 'comision_coherente').every((x) => x.s)).toBe(true)
  })

  it('las cinco tablas tienen RLS y no las lee anon ni authenticated', async () => {
    const r = await db.query<{ relname: string; rls: boolean; a: boolean; b: boolean }>(`
      select relname, relrowsecurity as rls,
             has_table_privilege('anon', c.oid, 'select') as a,
             has_table_privilege('authenticated', c.oid, 'select') as b
        from pg_class c
       where relnamespace = 'public'::regnamespace
         and relname in ('licencias_adicionales','licencias_adicionales_cargos','usuarios_espacio_retiros',
                         'sugerencias_descartadas','interes_servicios')`)
    expect(r.rows).toHaveLength(5)
    expect(r.rows.every((x) => x.rls && !x.a && !x.b)).toBe(true)
  })
})

describe('comisión fija + porcentaje de lo adicional', () => {
  const canal = `"beneficiario_empresa_id":"ecc378c7-10c4-4984-a31d-5533a598ad71","beneficiario_nit":"902003244-6","base":"cada_cobro"`
  const ok = async (json: string) =>
    (await db.query<{ ok: boolean }>(`select public.comision_coherente($1::jsonb) as ok`, [json])).rows[0].ok

  it('la de AFI es coherente', async () => {
    expect(await ok(`{${canal},"modo":"fijo_mas_porcentaje","monto_fijo":50000,"pct":20}`)).toBe(true)
  })

  it('le falta el porcentaje o el fijo: no', async () => {
    expect(await ok(`{${canal},"modo":"fijo_mas_porcentaje","monto_fijo":50000}`)).toBe(false)
    expect(await ok(`{${canal},"modo":"fijo_mas_porcentaje","pct":20}`)).toBe(false)
    expect(await ok(`{${canal},"modo":"fijo_mas_porcentaje","monto_fijo":50000,"pct":0}`)).toBe(false)
  })

  it('los modos de antes siguen igual', async () => {
    expect(await ok(`{${canal},"modo":"monto_fijo","monto_fijo":50000}`)).toBe(true)
    expect(await ok(`{${canal},"modo":"monto_fijo","monto_fijo":50000,"pct":20}`)).toBe(false)
    expect(await ok(`{${canal},"modo":"porcentaje","pct":20}`)).toBe(true)
  })

  it('el CHECK del contrato la acepta', async () => {
    expect(
      await falla(`update public.servicios_contratados set comision = $1::jsonb where id = $2`, [
        `{${canal},"modo":"fijo_mas_porcentaje","monto_fijo":50000,"pct":20}`,
        SC,
      ]),
    ).toBeNull()
  })
})

describe('comprar una licencia adicional', () => {
  it('rechaza tocar una cuota que ya tiene cobro (se volvería a cobrar)', async () => {
    const e = await falla(COMPRA, [
      SC, PERFIL, '2026-09-24', 50000, 2,
      JSON.stringify([{ ...cargosQ2[0], cuota_id: Q1 }]),
      JSON.stringify([{ cuota_id: Q1, monto_antes: 150000, monto_nuevo: 198333, concepto_nuevo: 'x' }]),
      'm',
    ])
    expect(e).toMatch(/cuota_con_cobro/)
  })

  it('rechaza si el contrato ya no tiene las licencias que leyó el servidor', async () => {
    await expect(compra({ antes: 3 })).rejects.toThrow(/licencias_cambiaron/)
  })

  it('rechaza un valor que no es el del contrato', async () => {
    await expect(compra({ valor: 40000 })).rejects.toThrow(/valor_distinto/)
  })

  it('rechaza una cuota que no sube exactamente lo que suman sus cargos', async () => {
    await expect(
      compra({ cuotas: [{ ...cuotasCompra[0], monto_nuevo: 250000 }, cuotasCompra[1]] }),
    ).rejects.toThrow(/cargos suman/)
  })

  it('registra todo en una transacción', async () => {
    const r = await compra()
    const lic = r.rows[0].id
    const cuotas = await db.query<{ numero: number; monto: string }>(
      `select numero, monto::text from public.plan_cobro_cuotas order by numero`,
    )
    expect(cuotas.rows.map((x) => [x.numero, Number(x.monto)])).toEqual([
      [1, 150000],
      [2, 248333],
      [3, 200000],
    ])
    const sc = await db.query<{ l: number }>(`select (parametros->>'licencias')::int as l from public.servicios_contratados where id = $1`, [SC])
    expect(sc.rows[0].l).toBe(3)
    const ws = await db.query<{ m: number }>(`select max_seats as m from public.workspaces where id = '${WS_CDA}'`)
    expect(ws.rows[0].m).toBe(3)
    const bit = await db.query<{ campo: string; n: number }>(
      `select campo, (valor_nuevo->>'licencias')::int as n from public.servicios_contratados_cambios where servicio_contratado_id = $1 and campo = 'licencias'`,
      [SC],
    )
    expect(bit.rows).toEqual([{ campo: 'licencias', n: 3 }])
    const cargos = await db.query<{ n: number }>(`select count(*)::int as n from public.licencias_adicionales_cargos where licencia_id = $1`, [lic])
    expect(cargos.rows[0].n).toBe(3)
  })

  it('un segundo intento con los mismos datos rechaza: las licencias ya cambiaron (doble clic)', async () => {
    await expect(compra()).rejects.toThrow(/licencias_cambiaron/)
  })
})

describe('retirar una licencia adicional', () => {
  const RETIRO = `select public.registrar_retiro_licencia($1, $2, $3::date, $4::uuid[], $5::jsonb, $6, $7) as id`

  it('anula los cargos de periodos siguientes y baja la cuota', async () => {
    const lic = (await db.query<{ id: string }>(`select id from public.licencias_adicionales limit 1`)).rows[0].id
    const anular = (
      await db.query<{ id: string }>(
        `select id from public.licencias_adicionales_cargos where licencia_id = $1 and plan_cobro_cuota_id = $2`,
        [lic, Q3],
      )
    ).rows.map((x) => x.id)
    await db.query(RETIRO, [
      lic, PERFIL, '2026-10-30', `{${anular.join(',')}}`,
      JSON.stringify([{ cuota_id: Q3, monto_antes: 200000, monto_nuevo: 150000, concepto_nuevo: 'Licencia — periodo del 23/11/2026 al 22/12/2026' }]),
      3, 'Retiro del usuario adicional',
    ])
    const q3 = await db.query<{ monto: string }>(`select monto::text from public.plan_cobro_cuotas where id = '${Q3}'`)
    expect(Number(q3.rows[0].monto)).toBe(150000)
    const sc = await db.query<{ l: number }>(`select (parametros->>'licencias')::int as l from public.servicios_contratados where id = $1`, [SC])
    expect(sc.rows[0].l).toBe(2)

    // Dos veces no.
    expect(await falla(RETIRO, [lic, PERFIL, '2026-10-30', '{}', '[]', 2, 'x'])).toMatch(/licencia_ya_retirada/)
  })
})

describe('interés en un servicio', () => {
  it('uno por espacio y servicio: el segundo clic no crea otro', async () => {
    await db.query(`insert into public.interes_servicios (workspace_origen_id, servicio, solicitado_por) values ($1, 'sustenta', $2)`, [WS_CDA, PERFIL])
    const r = await db.query(
      `insert into public.interes_servicios (workspace_origen_id, servicio, solicitado_por) values ($1, 'sustenta', $2) on conflict do nothing returning id`,
      [WS_CDA, PERFIL],
    )
    expect(r.rows).toHaveLength(0)
  })
})
