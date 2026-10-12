import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

/**
 * `valida_activar_autogestion`, EJECUTADA sobre las migraciones reales en PGlite: lo que deja, que
 * es idempotente, que no le cuelga un contrato a un NIT que ya es cliente (los 4 CDA de hoy) y que
 * rechaza una huella que no es la del texto.
 */

const RAIZ = process.cwd()
const migracion = (archivo: string) => readFileSync(join(RAIZ, 'supabase/migrations', archivo), 'utf8')
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

const METRIK = '00000000-0000-4000-8000-00000000a001'
const LINEA = '00000000-0000-4000-8000-00000000a002'
const ETAPA = '00000000-0000-4000-8000-00000000a003'
const WS_PRUEBA = '00000000-0000-4000-8000-00000000b001'
const DUENA = '00000000-0000-4000-8000-00000000b002'
const WS_OTRO = '00000000-0000-4000-8000-00000000b003'
const AJENO = '00000000-0000-4000-8000-00000000b004'
const WS_CDA = '00000000-0000-4000-8000-00000000c001'
const DUENO_CDA = '00000000-0000-4000-8000-00000000c002'
const EMPRESA_CDA = '00000000-0000-4000-8000-00000000c003'
const NEGOCIO_CDA = '00000000-0000-4000-8000-00000000c004'
const MAURICIO = '00000000-0000-4000-8000-00000000a009'

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
    id uuid primary key, workspace_id uuid references public.workspaces(id),
    role text, full_name text, platform_admin boolean not null default false
  );
  create table public.empresas (
    id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id),
    codigo text, nombre text, razon_social text, tipo_documento text, numero_documento text, email_fiscal text,
    rut_documento_url text, rut_fecha_carga timestamptz, rut_confianza_ocr numeric, rut_verificado boolean,
    custom_data jsonb, created_at timestamptz default now()
  );
  create table public.lineas_negocio (id uuid primary key, nombre text);
  create table public.negocios (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    empresa_id uuid references public.empresas(id),
    linea_id uuid references public.lineas_negocio(id),
    etapa_actual_id uuid, estado text, precio_estimado numeric, metadata jsonb, codigo text, nombre text
  );
  create table public.cobros (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid references public.negocios(id),
    fecha date, fecha_esperada date, monto numeric(15,2) not null default 0, monto_anulado numeric(15,2),
    fuente text, anulado_at timestamptz, notas text, siigo_recibo jsonb, plan_cobro_id uuid, numero_cuota integer,
    tipo_cobro text, revisado boolean not null default false, retencion numeric not null default 0,
    vencido boolean not null default false, created_at timestamptz not null default now()
  );
  create table public.planes_cobro (
    id uuid primary key, workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid not null references public.negocios(id), total_cuotas integer not null,
    activo boolean not null default false, notas text
  );
  create table public.plan_cobro_cuotas (
    id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
    plan_cobro_id uuid not null references public.planes_cobro(id), numero integer not null,
    tipo text not null default 'cuota', monto numeric not null, fecha_vencimiento date not null, concepto_detalle text
  );
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

  insert into public.workspaces (id, slug) values ('${METRIK}', 'metrik');
  insert into public.workspaces (id, slug, modules) values
    ('${WS_PRUEBA}', 'cda-ejemplo', '{"valida_consulta": true}'),
    ('${WS_OTRO}', 'otro', '{}'),
    ('${WS_CDA}', 'cda-de-hoy', '{"valida_consulta": true}');
  insert into public.profiles (id, workspace_id, role, full_name, platform_admin) values
    ('${MAURICIO}', '${METRIK}', 'owner', 'Mauricio', true),
    ('${DUENA}', '${WS_PRUEBA}', 'owner', 'gerencia', false),
    ('${AJENO}', '${WS_OTRO}', 'owner', 'otro', false),
    ('${DUENO_CDA}', '${WS_CDA}', 'owner', 'cda', false);
  insert into public.lineas_negocio (id, nombre) values ('${LINEA}', 'Valida');
`

const TEXTO = '# TÉRMINOS DE USO DE VALIDA\n\nEL CLIENTE: CDA EJEMPLO S.A.S., NIT 900.123.456-7.'
const DOC = {
  slug: 'terminos-uso-valida-autogestion',
  titulo: 'Términos de Uso de VALIDA',
  version: 'v2.0',
  texto_md: TEXTO,
  texto_sha256: sha256(TEXTO),
  pdf_path: 'cda-ejemplo/terminos-uso-valida-autogestion-v2.0.pdf',
  pdf_sha256: 'b'.repeat(64),
}
const PARAMETROS = { precio_mensual: 150000, licencias: 2, dias_trial: 0, limite_consultas_mes: 3000 }

let db: PGlite

function activar(o: { ws?: string; usuario?: string; slug?: string; doc?: Record<string, unknown>; rut?: unknown } = {}) {
  const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `select public.valida_activar_autogestion(
    '${o.ws ?? WS_PRUEBA}', '${o.usuario ?? DUENA}', '${METRIK}', '${LINEA}', '${ETAPA}',
    '${o.slug ?? 'valida-cda-licencia'}', ${lit(PARAMETROS)}, date '2026-10-25', ${lit(o.doc ?? DOC)},
    ${o.rut === undefined ? 'null' : lit(o.rut)}) as r`
}

async function r(sql: string): Promise<Record<string, unknown>> {
  return ((await db.query<{ r: Record<string, unknown> }>(sql)).rows[0].r)
}

async function contar(tabla: string, donde = 'true'): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n from ${tabla} where ${donde}`)).rows[0].n
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(migracion('20260915210000_workspace_modulos.sql'))
  await db.exec(migracion('20260916120000_catalogo_y_servicios_contratados.sql'))
  await db.exec(`select public.registrar_version_catalogo(
    'valida-cda-licencia', 1,
    '{"nombre": "Licencia Valida por CDA", "modulo": "valida_consulta", "disparador_cobro": "ciclo"}'::jsonb,
    'cerebro/catalogo/servicios/valida-cda-licencia.md', '${'a'.repeat(64)}')`)
  await db.exec(migracion('20260901000003_wa_envios.sql'))
  await db.exec(migracion('20260915040000_aceptaciones_terminos.sql'))
  await db.exec(migracion('20260915060000_purga_registros_bot.sql'))
  await db.exec(migracion('20260916180000_modulo_valida_api.sql'))
  await db.exec(migracion('20260916213000_mis_documentos_de_servicio_por_negocio.sql'))
  await db.exec(migracion('20260917014500_aceptacion_terminos_en_modulo.sql'))
  await db.exec(migracion('20260923220000_terminos_cda_designado_y_enlace_pago.sql'))
  await db.exec(migracion('20260924010000_valida_cda_plazo_terminos_y_facturas_cuota.sql'))
  await db.exec(migracion('20261010090000_valida_registros.sql'))
  await db.exec(migracion('20261012100000_valida_activar_autogestion.sql'))

  // El espacio de la prueba, como lo deja `crearEspacioValida`.
  await db.exec(`insert into public.valida_registros
    (usuario_id, correo, correo_dominio, identificacion, dv, razon_social, tipo_entidad, origen, origen_fuente,
     workspace_id, slug_creado, condiciones_version, condiciones_sha256, aceptado_at, estado)
    values ('${DUENA}', 'gerencia@cdaejemplo.co', 'cdaejemplo.co', '900123456', '7', 'CDA EJEMPLO S.A.S.', 'cda', 'afi', 'ref',
     '${WS_PRUEBA}', 'cda-ejemplo', 'condiciones-1.0+aviso-1.0', '${'c'.repeat(64)}', now(), 'creado')`)

  // Un CDA de hoy, con contrato vivo, que se registró a probar con su NIT (900158425-0).
  await db.exec(`
    insert into public.empresas (id, workspace_id, nombre, razon_social, numero_documento)
      values ('${EMPRESA_CDA}', '${METRIK}', 'Maxitec', 'CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S.', '900158425-0');
    insert into public.negocios (id, workspace_id, empresa_id, linea_id, nombre)
      values ('${NEGOCIO_CDA}', '${METRIK}', '${EMPRESA_CDA}', '${LINEA}', 'Valida CDA — Maxitec');
    insert into public.servicios_contratados (workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, parametros,
      workspace_pagador_id, estado, vigente_desde, actualizado_por)
      values ('${METRIK}', '${EMPRESA_CDA}', '${NEGOCIO_CDA}', 'valida-cda-licencia', 1, '{}', '${WS_CDA}', 'activo', date '2026-09-23', '${MAURICIO}');
    insert into public.workspaces (id, slug, modules) values ('00000000-0000-4000-8000-00000000d001', 'prueba-maxitec', '{"valida_consulta": true}');
    insert into public.profiles (id, workspace_id, role) values ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000d001', 'owner');
    insert into public.valida_registros
      (usuario_id, correo, correo_dominio, identificacion, dv, razon_social, workspace_id, slug_creado,
       condiciones_sha256, aceptado_at, estado)
      values ('00000000-0000-4000-8000-00000000d002', 'maxitec.prueba@gmail.com', 'gmail.com', '900158425', '0',
       'CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S.', '00000000-0000-4000-8000-00000000d001', 'prueba-maxitec',
       '${'c'.repeat(64)}', now(), 'creado');
  `)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('valida_activar_autogestion', () => {
  it('es server-only: ni anon ni authenticated la ejecutan', async () => {
    const q = await db.query<{ anon: boolean; auth: boolean }>(`select
      has_function_privilege('anon', 'public.valida_activar_autogestion(uuid, uuid, uuid, uuid, uuid, text, jsonb, date, jsonb, jsonb)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.valida_activar_autogestion(uuid, uuid, uuid, uuid, uuid, text, jsonb, date, jsonb, jsonb)', 'execute') as auth`)
    expect(q.rows[0]).toEqual({ anon: false, auth: false })
  })

  it('rechaza sin registro, con un usuario de otro espacio, con otra ficha o con una huella que no es la del texto', async () => {
    expect(await r(activar({ ws: WS_OTRO, usuario: AJENO }))).toEqual({ ok: false, error: 'sin_registro' })
    expect(await r(activar({ usuario: AJENO }))).toEqual({ ok: false, error: 'usuario_ajeno' })
    expect(await r(activar({ slug: 'no-existe' }))).toEqual({ ok: false, error: 'ficha_invalida' })
    expect(await r(activar({ doc: { ...DOC, texto_sha256: 'd'.repeat(64) } }))).toEqual({ ok: false, error: 'documento_invalido' })
    expect(await contar('public.servicios_contratados', `workspace_pagador_id = '${WS_PRUEBA}'`)).toBe(0)
  })

  it('deja empresa, negocio, términos de la empresa, contrato con designada y plazo, bitácora y módulo', async () => {
    const res = await r(activar({ rut: { veredicto: 'coincide', documento_path: 'metrik/rut.pdf', confianza: 0.93 } }))
    expect(res).toMatchObject({ ok: true, resultado: 'activado', empresa_nueva: true })

    const e = (await db.query<Record<string, unknown>>(`select * from public.empresas where id = '${res.empresa_id}'`)).rows[0]
    expect(e).toMatchObject({ workspace_id: METRIK, razon_social: 'CDA EJEMPLO S.A.S.', numero_documento: '900123456-7', rut_verificado: true })

    const sc = (await db.query<Record<string, unknown>>(`select * from public.servicios_contratados where id = '${res.contrato_id}'`)).rows[0]
    expect(sc).toMatchObject({
      workspace_id: METRIK,
      workspace_pagador_id: WS_PRUEBA,
      servicio_slug: 'valida-cda-licencia',
      servicio_version: 1,
      estado: 'activo',
      aceptante_designado_id: DUENA,
      correo_facturacion: 'gerencia@cdaejemplo.co',
      comision: null,
    })
    expect(sc.parametros).toEqual({ ...PARAMETROS, origen: 'afi', origen_fuente: 'ref' })

    const doc = (await db.query<Record<string, unknown>>(`select * from public.documentos_contractuales_versiones where id = '${res.documento_id}'`)).rows[0]
    expect(doc).toMatchObject({ alcance: 'cliente', empresa_id: res.empresa_id, texto_sha256: sha256(TEXTO), version: 'v2.0' })

    expect(await contar('public.servicio_contratado_beneficiarios', `servicio_contratado_id = '${res.contrato_id}' and workspace_id = '${WS_PRUEBA}'`)).toBe(1)
    expect(await contar('public.servicios_contratados_cambios', `servicio_contratado_id = '${res.contrato_id}' and campo = 'alta'`)).toBe(1)
    expect(await contar('public.workspace_modulos', `workspace_id = '${WS_PRUEBA}' and modulo = 'valida_consulta' and activo_hasta is null and servicio_contratado_id = '${res.contrato_id}'`)).toBe(1)
    expect(await contar('public.negocios', `id = '${res.negocio_id}' and workspace_id = '${METRIK}' and linea_id = '${LINEA}'`)).toBe(1)
  })

  it('es idempotente: el segundo clic responde ya_activo sin escribir', async () => {
    const antes = await contar('public.servicios_contratados')
    const res = await r(activar())
    expect(res).toMatchObject({ ok: true, resultado: 'ya_activo' })
    expect(await contar('public.servicios_contratados')).toBe(antes)
    expect(await contar('public.negocios', `metadata->>'workspace_one' = 'cda-ejemplo'`)).toBe(1)
  })

  it('NO le cuelga otro contrato a un NIT que ya es cliente con contrato vivo (un CDA de hoy)', async () => {
    const antes = await contar('public.servicios_contratados')
    const res = await r(
      activar({
        ws: '00000000-0000-4000-8000-00000000d001',
        usuario: '00000000-0000-4000-8000-00000000d002',
        doc: { ...DOC, pdf_sha256: 'e'.repeat(64) },
      }),
    )
    expect(res).toEqual({ ok: false, error: 'nit_con_contrato' })
    expect(await contar('public.servicios_contratados')).toBe(antes)
  })
})
