import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { cuotasConEstado, type CobroRecibido, type CuotaDeServicio } from '@/lib/valida-cda/pago-pendiente'
import { contratoOnePagado, type FilaMisServicios } from './contrato-one'

/**
 * El SQL de datos de Termotech (`sql/one-licencia/2026-10-05_termotech-contrato-y-enlace-bold.sql`),
 * EJECUTADO contra las migraciones reales en PGlite. Lo aplica una persona sobre producción y ningún
 * check lo corre, así que lo que promete se prueba aquí, sobre el estado medido el 2026-10-05: plan
 * 6 × $150.000 en 'manual', cuotas 2..6 explícitas SIN la 1, y un solo cobro (la cuota 1, pagada el
 * 07-sep).
 *
 * Lo que importa de verdad es lo último: con la carga, Termotech ve por sus RPC la cuota 1 PAGADA y la
 * 2 pendiente por $150.000. Sin la fila de la cuota 1, el reparto FIFO le abona el pago de septiembre
 * a la cuota 2, y el enlace de octubre sale rechazado.
 */

const RAIZ = process.cwd()
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
const migracion = (archivo: string) => leer(join('supabase/migrations', archivo))
const CARGA = leer('sql/one-licencia/2026-10-05_termotech-contrato-y-enlace-bold.sql')
const BLOQUE = /do \$bloque\$[\s\S]*?\$bloque\$;/.exec(CARGA)?.[0] ?? ''

const WS_METRIK = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const WS_TERMOTECH = 'b4d2ace9-7141-49a6-a34e-53461b55c85b'
const EMPRESA = '8f9f75ce-0d51-463a-a886-820266f3712d'
const NEGOCIO = '43b2f059-4999-4bbd-aa59-57608c1a0616'
const PLAN = '31d4bc5f-711c-4221-a184-fec75caa70c9'
const CUOTA2 = 'f2394f81-3b7d-49a4-a74b-92c54e2a3894'
const COBRO1 = '464f66a0-473d-46ee-8561-0c731d920800'
const OMAR = '64864a69-f5b5-4f33-96bf-99fe2b3bbe4c'
const MAURICIO = 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text not null);
  create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint
    language sql as $$
      insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
      returning jobid $$;
  create function cron.unschedule(job_name text) returns boolean
    language sql as $$ delete from cron.job where jobname = job_name returning true $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false);

  create table public.workspaces (id uuid primary key, slug text, modules jsonb not null default '{}'::jsonb);
  create table public.profiles (
    id uuid primary key, workspace_id uuid references public.workspaces(id), role text, full_name text,
    platform_admin boolean not null default false
  );
  create table public.empresas (
    id uuid primary key, workspace_id uuid references public.workspaces(id),
    nombre text, razon_social text, numero_documento text
  );
  create table public.lineas_negocio (id uuid primary key, nombre text);
  create table public.negocios (
    id uuid primary key, workspace_id uuid not null references public.workspaces(id),
    empresa_id uuid references public.empresas(id), linea_id uuid references public.lineas_negocio(id),
    codigo text, nombre text
  );
  create table public.cobros (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid references public.negocios(id),
    fecha date, fecha_esperada date,
    monto numeric(15,2) not null default 0, monto_anulado numeric(15,2),
    fuente text, anulado_at timestamptz, notas text, siigo_recibo jsonb,
    plan_cobro_id uuid, numero_cuota integer, tipo_cobro text,
    revisado boolean not null default false, retencion numeric not null default 0,
    vencido boolean not null default false, created_at timestamptz not null default now()
  );
  create unique index idx_cobros_plan_cuota_unique on public.cobros (plan_cobro_id, numero_cuota)
    where plan_cobro_id is not null and numero_cuota is not null;
  create table public.planes_cobro (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid not null references public.negocios(id),
    monto numeric not null check (monto > 0),
    total_cuotas integer not null,
    pasarela text not null default 'manual'
      check (pasarela in ('wompi', 'manual', 'mixto', 'bold', 'epayco')),
    activo boolean not null default true,
    notas text,
    updated_at timestamptz default now()
  );
  create table public.plan_cobro_cuotas (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    plan_cobro_id uuid not null references public.planes_cobro(id),
    numero integer not null,
    tipo text not null default 'cuota' check (tipo in ('anticipo', 'cuota')),
    monto numeric not null check (monto > 0),
    iva numeric not null default 0,
    fecha_vencimiento date not null,
    concepto_detalle text,
    updated_at timestamptz default now(),
    unique (plan_cobro_id, numero),
    check (iva >= 0 and iva < monto)
  );
  create table public.cuentas_cobro_emitidas (id uuid primary key default gen_random_uuid(), empresa_id_pagador uuid);
  create table public.wa_message_log (
    id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id),
    phone text not null, direction text not null, intent text, message_preview text, created_at timestamptz default now()
  );
  create table public.bot_sessions (
    id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
    user_phone text not null, context jsonb default '{}', expires_at timestamptz default (now() + interval '5 minutes')
  );
  create function public.current_user_workspace_id() returns uuid
    language sql stable as $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;
`

/** El estado de producción medido el 2026-10-05. */
const ESTADO_PRODUCCION = `
  insert into public.workspaces (id, slug, modules) values
    ('${WS_METRIK}', 'metrik', '{"business": true, "valida_consulta": true}'),
    ('${WS_TERMOTECH}', 'termotech', '{"business": true, "fab_registrar_pago": true}');
  insert into public.profiles (id, workspace_id, role, full_name, platform_admin) values
    ('${MAURICIO}', '${WS_METRIK}', 'owner', 'Mauricio', true),
    ('${OMAR}', '${WS_TERMOTECH}', 'owner', 'Omar Castro', false);
  insert into public.empresas (id, workspace_id, nombre, razon_social, numero_documento)
    values ('${EMPRESA}', '${WS_METRIK}', 'Termotech', 'TERMOTECH SAS', '902.080.631-1');
  insert into public.negocios (id, workspace_id, empresa_id, codigo, nombre)
    values ('${NEGOCIO}', '${WS_METRIK}', '${EMPRESA}', 'A3 26 2', 'Suscripción ONE — Termotech');
  insert into public.planes_cobro (id, workspace_id, negocio_id, monto, total_cuotas, pasarela, activo, notas)
    values ('${PLAN}', '${WS_METRIK}', '${NEGOCIO}', 150000, 6, 'manual', true, 'Suscripcion MeTRIK ONE Termotech');
  insert into public.plan_cobro_cuotas (id, workspace_id, plan_cobro_id, numero, monto, fecha_vencimiento) values
    ('${CUOTA2}', '${WS_METRIK}', '${PLAN}', 2, 150000, date '2026-10-05'),
    (gen_random_uuid(), '${WS_METRIK}', '${PLAN}', 3, 150000, date '2026-11-05'),
    (gen_random_uuid(), '${WS_METRIK}', '${PLAN}', 4, 150000, date '2026-12-05'),
    (gen_random_uuid(), '${WS_METRIK}', '${PLAN}', 5, 150000, date '2027-01-05'),
    (gen_random_uuid(), '${WS_METRIK}', '${PLAN}', 6, 150000, date '2027-02-05');
  insert into public.cobros (id, workspace_id, negocio_id, fecha, monto, plan_cobro_id, numero_cuota, tipo_cobro)
    values ('${COBRO1}', '${WS_METRIK}', '${NEGOCIO}', date '2026-09-07', 150000, '${PLAN}', 1, 'programado');
`

let db: PGlite

async function correr(sql: string): Promise<string> {
  try {
    await db.exec(sql)
    return ''
  } catch (e) {
    return (e as Error).message
  }
}

async function contar(tabla: string, donde = 'true'): Promise<number> {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from ${tabla} where ${donde}`)
  return r.rows[0].n
}

async function comoTermotech<T>(sql: string): Promise<T[]> {
  await db.exec(`select set_config('prueba.ws', '${WS_TERMOTECH}', false)`)
  try {
    return (await db.query<T>(sql)).rows
  } finally {
    await db.exec(`select set_config('prueba.ws', '', false)`)
  }
}

const real = () => {
  const de = 'c_ensayo constant boolean := true;'
  expect(BLOQUE.split(de).length - 1).toBe(1)
  return BLOQUE.replace(de, 'c_ensayo constant boolean := false;')
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(migracion('20260915210000_workspace_modulos.sql'))
  await db.exec(migracion('20260916120000_catalogo_y_servicios_contratados.sql'))
  await db.exec(`select public.registrar_version_catalogo(
    'licencia-clarity', 1,
    '{"nombre": "Licencia Clarity", "modulo": "business", "disparador_cobro": "ciclo"}'::jsonb,
    'cerebro/catalogo/servicios/licencia-clarity.md', '${'a'.repeat(64)}')`)
  await db.exec(migracion('20260901000003_wa_envios.sql'))
  await db.exec(migracion('20260915040000_aceptaciones_terminos.sql'))
  await db.exec(migracion('20260915060000_purga_registros_bot.sql'))
  await db.exec(migracion('20260916180000_modulo_valida_api.sql'))
  await db.exec(migracion('20260916213000_mis_documentos_de_servicio_por_negocio.sql'))
  await db.exec(migracion('20260917014500_aceptacion_terminos_en_modulo.sql'))
  await db.exec(migracion('20260923220000_terminos_cda_designado_y_enlace_pago.sql'))
  await db.exec(migracion('20260924010000_valida_cda_plazo_terminos_y_facturas_cuota.sql'))
}, 60_000)

beforeEach(async () => {
  // Cada caso arranca del estado de producción.
  await db.exec(`
    alter table public.servicios_contratados_cambios disable trigger user;
    delete from public.servicios_contratados_cambios;
    alter table public.servicios_contratados_cambios enable trigger user;
    delete from public.servicios_contratados;
    delete from public.cuentas_cobro_emitidas;
    delete from public.cobros;
    delete from public.plan_cobro_cuotas;
    delete from public.planes_cobro;
    delete from public.negocios;
    delete from public.empresas;
    delete from public.profiles;
    delete from public.workspaces;
  `)
  await db.exec(ESTADO_PRODUCCION)
})

afterAll(async () => {
  await db?.close()
})

describe('el SQL de Termotech', () => {
  it('nace en ensayo: valida todo, termina en ENSAYO OK y no deja nada escrito', async () => {
    expect(BLOQUE).toContain('c_ensayo constant boolean := true;')
    const error = await correr(BLOQUE)
    expect(error).toMatch(/ENSAYO OK: contrato .*, cuota 1 .*, conceptos llenados 5, designada Omar Castro/)
    expect(await contar('public.servicios_contratados')).toBe(0)
    expect(await contar('public.plan_cobro_cuotas')).toBe(5)
    expect(await contar('public.planes_cobro', "pasarela = 'manual' and activo")).toBe(1)
  })

  it('la carga deja contrato, bitácora, cuota 1, conceptos y el plan en bold sin emisor', async () => {
    expect(await correr(real())).toBe('')
    const [sc] = (
      await db.query<{ servicio_slug: string; estado: string; workspace_pagador_id: string; aceptante_designado_id: string; parametros: Record<string, number>; comision: unknown }>(
        `select servicio_slug, estado, workspace_pagador_id, aceptante_designado_id, parametros, comision from public.servicios_contratados`,
      )
    ).rows
    expect(sc).toEqual({
      servicio_slug: 'licencia-clarity',
      estado: 'activo',
      workspace_pagador_id: WS_TERMOTECH,
      aceptante_designado_id: OMAR,
      parametros: { precio_mensual: 150000, dia_cobro: 5 },
      comision: null,
    })
    expect(await contar('public.servicios_contratados_cambios', "campo = 'alta'")).toBe(1)
    expect(await contar('public.planes_cobro', "pasarela = 'bold' and not activo")).toBe(1)
    const cuotas = (
      await db.query<{ numero: number; concepto_detalle: string }>(
        `select numero, concepto_detalle from public.plan_cobro_cuotas order by numero`,
      )
    ).rows
    expect(cuotas.map((c) => c.numero)).toEqual([1, 2, 3, 4, 5, 6])
    expect(cuotas[0].concepto_detalle).toBe('Suscripción MeTRIK ONE · Termotech — periodo del 05/09/2026 al 04/10/2026')
    expect(cuotas[1].concepto_detalle).toBe('Suscripción MeTRIK ONE · Termotech — periodo del 05/10/2026 al 04/11/2026')
    expect(cuotas[5].concepto_detalle).toBe('Suscripción MeTRIK ONE · Termotech — periodo del 05/02/2027 al 04/03/2027')
    // Nada de cobros nuevos: el enlace lo crea el cron o el botón, no este SQL.
    expect(await contar('public.cobros')).toBe(1)
  })

  it('Termotech ve por sus RPC la cuota 1 pagada y la 2 pendiente por $150.000', async () => {
    expect(await correr(real())).toBe('')
    const servicios = await comoTermotech<FilaMisServicios>('select * from public.mis_servicios()')
    const contrato = contratoOnePagado(servicios)
    expect(contrato).not.toBeNull()

    const cuotas = await comoTermotech<{ cuota_id: string; numero: number; tipo: string; monto: string; fecha_vencimiento: string; concepto: string }>(
      `select * from public.mis_cuotas_de_servicio('${contrato!.servicio_contratado_id}')`,
    )
    const cobros = await comoTermotech<{ monto: string; estado: string }>(
      `select * from public.mis_cobros_de_servicio('${contrato!.servicio_contratado_id}')`,
    )
    const estado = cuotasConEstado({
      cuotas: cuotas.map(
        (c): CuotaDeServicio => ({
          cuotaId: c.cuota_id,
          numero: c.numero,
          tipo: c.tipo,
          monto: Number(c.monto),
          fechaVencimiento: new Date(c.fecha_vencimiento).toISOString().slice(0, 10),
          concepto: c.concepto,
          enlacePagoUrl: null,
          enlacePagoExpira: null,
        }),
      ),
      cobros: cobros.map((c): CobroRecibido => ({ monto: Number(c.monto), estado: c.estado as CobroRecibido['estado'] })),
      hoy: '2026-10-05',
      ahoraISO: '2026-10-05T15:00:00Z',
    })
    expect(estado.map((c) => [c.numero, c.estado, c.saldo])).toEqual([
      [1, 'pagada', 0],
      [2, 'pendiente', 150000],
      [3, 'pendiente', 150000],
      [4, 'pendiente', 150000],
      [5, 'pendiente', 150000],
      [6, 'pendiente', 150000],
    ])
  })

  it('control: sin la fila de la cuota 1, el pago de septiembre cubre la 2 y el enlace de octubre no sale', () => {
    const cuota = (numero: number, fecha: string): CuotaDeServicio => ({
      numero, tipo: 'cuota', monto: 150000, fechaVencimiento: fecha, concepto: null, enlacePagoUrl: null, enlacePagoExpira: null,
    })
    const estado = cuotasConEstado({
      cuotas: [cuota(2, '2026-10-05'), cuota(3, '2026-11-05')],
      cobros: [{ monto: 150000, estado: 'pagado' }],
      hoy: '2026-10-05',
      ahoraISO: '2026-10-05T15:00:00Z',
    })
    expect(estado[0]).toMatchObject({ numero: 2, estado: 'pagada', saldo: 0 })
  })

  it('una segunda corrida no duplica: aborta antes de escribir', async () => {
    expect(await correr(real())).toBe('')
    expect(await correr(real())).toMatch(/ya no dice manual|ya tiene un contrato vivo/)
    expect(await contar('public.servicios_contratados')).toBe(1)
    expect(await contar('public.plan_cobro_cuotas')).toBe(6)
  })

  it('si ya se le emitió una cuenta de cobro a Termotech, aborta: serían dos cobros por la misma cuota', async () => {
    await db.exec(`insert into public.cuentas_cobro_emitidas (empresa_id_pagador) values ('${EMPRESA}')`)
    expect(await correr(real())).toMatch(/ya tiene una cuenta de cobro emitida/)
    expect(await contar('public.servicios_contratados')).toBe(0)
  })

  it('si octubre ya empezó a cobrarse por otro lado (un cobro de otra cuota), aborta', async () => {
    await db.exec(`insert into public.cobros (workspace_id, negocio_id, monto, plan_cobro_id, numero_cuota, tipo_cobro)
      values ('${WS_METRIK}', '${NEGOCIO}', 150000, '${PLAN}', 2, 'programado')`)
    expect(await correr(real())).toMatch(/se esperaba solo el de la cuota 1/)
    expect(await contar('public.plan_cobro_cuotas')).toBe(5)
  })
})
