import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

/**
 * Las tres migraciones de suscripciones multiproducto (20261016100000, …100100, …100200), EJECUTADAS en
 * PGlite sobre la cadena real de migraciones de las que dependen. Lo que se fija:
 *
 *   - las once funciones vivas se reescriben por reemplazo de texto (y un patrón ausente aborta todo);
 *   - un contrato de NEGOCIO (los 4 CDA) lee exactamente lo mismo que antes por las RPC del cliente;
 *   - la activación autogestionada crea una SUSCRIPCIÓN: ni empresa en el directorio, ni negocio, ni
 *     choque con el gate de carpeta; los Términos son de la suscripción;
 *   - la aceptación del registro, el enrolamiento y las RPC del cliente funcionan con la suscripción;
 *   - los CHECK y el trigger de coherencia rechazan lo que no cuadra;
 *   - la vista de MRR suma negocios con contrato por ciclo y suscripciones;
 *   - la reversa deja las funciones byte a byte como estaban.
 */

const RAIZ = process.cwd()
const migracion = (archivo: string) => readFileSync(join(RAIZ, 'supabase/migrations', archivo), 'utf8')
const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

const METRIK = '00000000-0000-4000-8000-00000000a001'
const LINEA = '00000000-0000-4000-8000-00000000a002'
const ETAPA = '00000000-0000-4000-8000-00000000a003'
const MAURICIO = '00000000-0000-4000-8000-00000000a009'
const OTRO_COBRADOR = '00000000-0000-4000-8000-00000000a010'

const WS_PRUEBA = '00000000-0000-4000-8000-00000000b001'
const DUENA = '00000000-0000-4000-8000-00000000b002'
const WS_DOBLE = '00000000-0000-4000-8000-00000000b005'
const DUENA_DOBLE = '00000000-0000-4000-8000-00000000b006'

const WS_CDA = '00000000-0000-4000-8000-00000000c001'
const DUENO_CDA = '00000000-0000-4000-8000-00000000c002'
const EMPRESA_CDA = '00000000-0000-4000-8000-00000000c003'
const NEGOCIO_CDA = '00000000-0000-4000-8000-00000000c004'
const CONTRATO_CDA = '00000000-0000-4000-8000-00000000c005'
const PLAN_CDA = '00000000-0000-4000-8000-00000000c006'
const DOC_CDA = '00000000-0000-4000-8000-00000000c007'

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
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);

  create table public.workspaces (
    id uuid primary key, slug text, name text, modules jsonb not null default '{}'::jsonb, config_extra jsonb,
    max_seats integer not null default 1
  );
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
  create table public.contactos (id uuid primary key default gen_random_uuid(), workspace_id uuid, nombre text);
  create table public.lineas_negocio (id uuid primary key, nombre text);
  create table public.etapas_negocio (id uuid primary key, linea_id uuid references public.lineas_negocio(id), nombre text, orden integer);
  create table public.negocios (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    empresa_id uuid references public.empresas(id),
    linea_id uuid references public.lineas_negocio(id),
    etapa_actual_id uuid, estado text, precio_estimado numeric, metadata jsonb, codigo text, nombre text
  );
  create table public.planes_cobro (
    id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid not null references public.negocios(id) on delete cascade,
    monto numeric(15,2) not null default 0, frecuencia text not null default 'mensual',
    fecha_inicio date, fecha_fin date, total_cuotas integer not null default 1,
    pasarela text not null default 'manual', referencia_wompi text, auto_renovar boolean not null default false,
    activo boolean not null default true, notas text, concepto_detalle_template text,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table public.plan_cobro_cuotas (
    id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
    plan_cobro_id uuid not null references public.planes_cobro(id), numero integer not null,
    tipo text not null default 'cuota' check (tipo in ('anticipo','cuota')),
    monto numeric not null check (monto > 0),
    fecha_vencimiento date not null, concepto_detalle text, updated_at timestamptz default now(),
    created_at timestamptz default now(),
    unique (plan_cobro_id, numero)
  );
  create table public.cobros (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid references public.negocios(id) on delete set null,
    fecha date, fecha_esperada date, monto numeric(15,2) not null default 0, monto_anulado numeric(15,2),
    fuente text, anulado_at timestamptz, notas text, siigo_recibo jsonb, plan_cobro_id uuid, numero_cuota integer,
    tipo_cobro text, revisado boolean not null default false, retencion numeric not null default 0,
    vencido boolean not null default false, created_at timestamptz not null default now()
  );
  create unique index idx_cobros_plan_cuota_unique on public.cobros (plan_cobro_id, numero_cuota)
    where plan_cobro_id is not null and numero_cuota is not null;
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

  insert into public.workspaces (id, slug, config_extra) values
    ('${METRIK}', 'metrik', '{"exigir_carpeta_local": true}'),
    ('${OTRO_COBRADOR}', 'otro-cobrador', null);
  insert into public.workspaces (id, slug, modules) values
    ('${WS_PRUEBA}', 'cda-ejemplo', '{"valida_consulta": true}'),
    ('${WS_DOBLE}', 'cda-ejemplo-2', '{"valida_consulta": true}'),
    ('${WS_CDA}', 'cda-de-hoy', '{"valida_consulta": true}');
  insert into public.profiles (id, workspace_id, role, full_name, platform_admin) values
    ('${MAURICIO}', '${METRIK}', 'owner', 'Mauricio', true),
    ('${DUENA}', '${WS_PRUEBA}', 'owner', 'gerencia', false),
    ('${DUENA_DOBLE}', '${WS_DOBLE}', 'owner', 'otra persona', false),
    ('${DUENO_CDA}', '${WS_CDA}', 'owner', 'cda', false);
  insert into public.lineas_negocio (id, nombre) values ('${LINEA}', 'Valida');
  insert into public.etapas_negocio (id, linea_id, nombre, orden) values
    ('00000000-0000-4000-8000-00000000a004', '${LINEA}', 'Venta', 1),
    ('${ETAPA}', '${LINEA}', 'Cobro', 2);
`

/** Las migraciones de las que dependen las once funciones, en su orden real. */
const CADENA = [
  '20260901000003_wa_envios.sql',
  '20260914223000_gate_carpeta_local.sql',
  '20260915040000_aceptaciones_terminos.sql',
  '20260915060000_purga_registros_bot.sql',
  '20260915210000_workspace_modulos.sql',
  '20260916120000_catalogo_y_servicios_contratados.sql',
  '20260916180000_modulo_valida_api.sql',
  '20260916213000_mis_documentos_de_servicio_por_negocio.sql',
  '20260917014500_aceptacion_terminos_en_modulo.sql',
  '20260923220000_terminos_cda_designado_y_enlace_pago.sql',
  '20260924010000_valida_cda_plazo_terminos_y_facturas_cuota.sql',
  '20260924060000_suscripcion_cda_licencias_usuarios_comision.sql',
  '20260924090000_facturas_cobro.sql',
  '20260924100000_retencion_iva_cobro.sql',
  '20260929010000_enrolamiento_cobro_por_ciclo.sql',
  '20260929030000_documentos_alcance_plantilla.sql',
  '20261007150000_terminos_modificacion_por_aviso.sql',
  '20261007210000_valida_cda_plan_anual.sql',
  '20261010090000_valida_registros.sql',
  '20261012100000_valida_activar_autogestion.sql',
  '20261014203000_terminos_aceptados_en_registro.sql',
  '20261015180000_gate_carpeta_local_exime_valida_autogestion.sql',
]

const FUNCIONES = [
  'public.mis_servicios()',
  'public.mis_cuotas_de_servicio(uuid)',
  'public.mis_cobros_de_servicio(uuid)',
  'public.mis_documentos_de_servicio()',
  'public.aceptaciones_terminos_modulo()',
  'public.aceptaciones_terminos_registro()',
  'public.documentos_versiones_inmutables()',
  'public.documentos_versiones_por_aviso()',
  'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)',
  'public.registrar_compra_licencia(uuid,uuid,date,numeric,integer,jsonb,jsonb,text)',
  'public.registrar_retiro_licencia(uuid,uuid,date,uuid[],jsonb,integer,text)',
]

const CASILLA = 'Acepto los Términos de Uso de VALIDA de mi empresa.'
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
let definicionesAntes: Record<string, string> = {}

const lit = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`

function activar(o: { ws?: string; usuario?: string; doc?: Record<string, unknown>; rut?: unknown } = {}) {
  return `select public.valida_activar_autogestion(
    '${o.ws ?? WS_PRUEBA}', '${o.usuario ?? DUENA}', '${METRIK}', '${LINEA}', '${ETAPA}',
    'valida-cda-licencia', ${lit(PARAMETROS)}, date '2026-10-25', ${lit(o.doc ?? DOC)},
    ${o.rut === undefined ? 'null' : lit(o.rut)}) as r`
}

async function r(sql: string): Promise<Record<string, unknown>> {
  return (await db.query<{ r: Record<string, unknown> }>(sql)).rows[0].r
}

async function contar(tabla: string, donde = 'true'): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n from ${tabla} where ${donde}`)).rows[0].n
}

async function falla(sql: string): Promise<string> {
  try {
    await db.exec(sql)
    return ''
  } catch (e) {
    return (e as Error).message
  }
}

async function definiciones(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const f of FUNCIONES) {
    out[f] = (await db.query<{ d: string }>(`select pg_get_functiondef('${f}'::regprocedure) as d`)).rows[0].d
  }
  return out
}

/** Lo que el cliente ve por la RPC, con la sesión del espacio `ws`. */
async function comoCliente<T>(ws: string, sql: string): Promise<T[]> {
  await db.exec(`select set_config('prueba.ws', '${ws}', false)`)
  try {
    return (await db.query<T>(sql)).rows
  } finally {
    await db.exec(`select set_config('prueba.ws', '', false)`)
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  for (const m of CADENA) {
    try {
      await db.exec(migracion(m))
    } catch (e) {
      throw new Error(`${m}: ${(e as Error).message}`)
    }
  }
  await db.exec(`select public.registrar_version_catalogo(
    'valida-cda-licencia', 1,
    '{"nombre": "Licencia Valida por CDA", "modulo": "valida_consulta", "disparador_cobro": "ciclo"}'::jsonb,
    'cerebro/catalogo/servicios/valida-cda-licencia.md', '${'a'.repeat(64)}')`)

  // Un CDA de hoy en negocios: contrato vivo, plan con dos cuotas (una pagada), documento aceptado.
  await db.exec(`
    insert into public.empresas (id, workspace_id, nombre, razon_social, numero_documento)
      values ('${EMPRESA_CDA}', '${METRIK}', 'Maxitec', 'CENTRO DE DIAGNOSTICO AUTOMOTOR MAXITEC S.A.S.', '900158425-0');
    insert into public.negocios (id, workspace_id, empresa_id, linea_id, nombre, metadata)
      values ('${NEGOCIO_CDA}', '${METRIK}', '${EMPRESA_CDA}', '${LINEA}', 'Valida CDA — Maxitec', '{"carpeta_local": "x"}');
    insert into public.servicios_contratados (id, workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, parametros,
      workspace_pagador_id, estado, vigente_desde, actualizado_por, aceptante_designado_id)
      values ('${CONTRATO_CDA}', '${METRIK}', '${EMPRESA_CDA}', '${NEGOCIO_CDA}', 'valida-cda-licencia', 1, '{}', '${WS_CDA}', 'activo',
              date '2026-09-23', '${MAURICIO}', '${DUENO_CDA}');
    insert into public.planes_cobro (id, workspace_id, negocio_id, monto, frecuencia, fecha_inicio, fecha_fin, total_cuotas, activo)
      values ('${PLAN_CDA}', '${METRIK}', '${NEGOCIO_CDA}', 150000, 'mensual', date '2026-09-23', date '2027-09-23', 12, false);
    insert into public.plan_cobro_cuotas (workspace_id, plan_cobro_id, numero, monto, fecha_vencimiento, concepto_detalle) values
      ('${METRIK}', '${PLAN_CDA}', 1, 150000, date '2026-09-30', 'Suscripción — periodo 1'),
      ('${METRIK}', '${PLAN_CDA}', 2, 150000, date '2026-10-30', 'Suscripción — periodo 2');
    insert into public.cobros (workspace_id, negocio_id, plan_cobro_id, numero_cuota, monto, fecha, tipo_cobro) values
      ('${METRIK}', '${NEGOCIO_CDA}', '${PLAN_CDA}', 1, 150000, date '2026-09-29', 'programado');
    insert into public.documentos_contractuales_versiones
      (id, workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256, vigente_desde)
      values ('${DOC_CDA}', '${METRIK}', '${LINEA}', 'terminos-suscripcion-valida-cda', 'cliente', '${EMPRESA_CDA}', 'Términos CDA', 'v1.3',
              '# CDA', '${sha256('# CDA')}', 'maxitec/v13.pdf', '${'d'.repeat(64)}', date '2026-09-24');
  `)

  // El espacio de la prueba, como lo deja `crearEspacioValida`, con Términos aceptados en el registro y tarjeta.
  const aceptado = `${TEXTO}\n\nCasilla: ${CASILLA}`
  await db.exec(`insert into public.valida_registros
    (usuario_id, correo, correo_dominio, identificacion, dv, razon_social, tipo_entidad, origen, origen_fuente,
     workspace_id, slug_creado, condiciones_version, condiciones_sha256, aceptado_at, estado, prueba_vence_en,
     metodo_pago_estado, metodo_pago_ref)
    values ('${DUENA}', 'gerencia@cdaejemplo.co', 'cdaejemplo.co', '900123456', '7', 'CDA EJEMPLO S.A.S.', 'cda', 'afi', 'ref',
     '${WS_PRUEBA}', 'cda-ejemplo', 'condiciones-2.1', '${'c'.repeat(64)}', now(), 'creado', now() + interval '7 days',
     'registrado', 'epayco:cli123:tok456')`)
  await db.exec(`update public.valida_registros set aceptado_texto = ${`'${aceptado.replace(/'/g, "''")}'`},
     condiciones_sha256 = '${sha256(aceptado)}',
     terminos_version = 'v2.0', terminos_texto = ${`'${TEXTO.replace(/'/g, "''")}'`}, terminos_sha256 = '${sha256(TEXTO)}'
     where workspace_id = '${WS_PRUEBA}'`)
  // Otro registro (el índice único de `valida_registros` no deja dos registros creados con el mismo NIT).
  await db.exec(`insert into public.valida_registros
    (usuario_id, correo, correo_dominio, identificacion, dv, razon_social, workspace_id, slug_creado,
     condiciones_sha256, aceptado_at, estado)
    values ('${DUENA_DOBLE}', 'otra@gmail.com', 'gmail.com', '900777777', '1', 'OTRO CDA S.A.S.', '${WS_DOBLE}', 'cda-ejemplo-2',
     '${'c'.repeat(64)}', now(), 'creado')`)

  definicionesAntes = await definiciones()
  await db.exec(migracion('20261016100000_suscripciones_producto.sql'))
  await db.exec(migracion('20261016100100_motor_cobro_ancla_suscripcion.sql'))
  await db.exec(migracion('20261016100200_mrr_por_producto.sql'))
  await db.exec(migracion('20261016170000_suscripcion_valida_nace_en_prueba.sql'))
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('las funciones vivas', () => {
  it('las once quedan leyendo el ancla de la suscripción', async () => {
    const despues = await definiciones()
    for (const f of FUNCIONES) {
      expect(despues[f], f).toContain('suscripcion_id')
      expect(despues[f], f).not.toBe(definicionesAntes[f])
    }
  })

  it('un patrón que no está en la definición viva aborta la migración entera', async () => {
    const otra = new PGlite()
    try {
      await otra.exec(ESQUEMA_BASE)
      for (const m of CADENA) await otra.exec(migracion(m))
      await otra.exec(migracion('20261016100000_suscripciones_producto.sql'))
      // Alguien cambió `mis_cuotas_de_servicio` en producción fuera del repo.
      const viva = (await otra.query<{ d: string }>(`select pg_get_functiondef('public.mis_cuotas_de_servicio(uuid)'::regprocedure) as d`)).rows[0].d
      await otra.exec(viva.replace('on p.negocio_id = sc.negocio_id', 'on sc.negocio_id = p.negocio_id'))
      let error = ''
      try {
        await otra.exec(migracion('20261016100100_motor_cobro_ancla_suscripcion.sql'))
      } catch (e) {
        error = (e as Error).message
      }
      expect(error).toMatch(/mis_cuotas_de_servicio\(uuid\) cambió en producción/)
      // Nada quedó a medias: ni el trigger nuevo ni las funciones anteriores cambiadas.
      const n = (await otra.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname = 'suscripcion_del_mismo_cobrador'`)).rows[0].n
      expect(n).toBe(0)
      const servicios = (await otra.query<{ d: string }>(`select pg_get_functiondef('public.mis_servicios()'::regprocedure) as d`)).rows[0].d
      expect(servicios).not.toContain('suscripcion_id')
    } finally {
      await otra.close()
    }
  }, 120_000)
})

describe('un contrato de negocio (los 4 CDA) lee lo mismo', () => {
  it('mis_servicios, mis_cuotas_de_servicio y mis_cobros_de_servicio', async () => {
    const servicios = await comoCliente<{ servicio_contratado_id: string; negocio_nombre: string; es_pagador: boolean }>(
      WS_CDA,
      'select * from public.mis_servicios()',
    )
    expect(servicios).toHaveLength(1)
    expect(servicios[0]).toMatchObject({ servicio_contratado_id: CONTRATO_CDA, negocio_nombre: 'Valida CDA — Maxitec', es_pagador: true })

    const cuotas = await comoCliente<{ numero: number }>(WS_CDA, `select * from public.mis_cuotas_de_servicio('${CONTRATO_CDA}')`)
    expect(cuotas.map((c) => c.numero)).toEqual([1, 2])

    const cobros = await comoCliente<{ concepto: string; estado: string }>(WS_CDA, `select * from public.mis_cobros_de_servicio('${CONTRATO_CDA}')`)
    expect(cobros).toEqual([expect.objectContaining({ concepto: 'Valida CDA — Maxitec', estado: 'pagado' })])

    const docs = await comoCliente<{ documento_id: string }>(WS_CDA, 'select * from public.mis_documentos_de_servicio()')
    expect(docs.map((d) => d.documento_id)).toEqual([DOC_CDA])
  })

  it('las filas de producción de hoy cumplen los CHECK nuevos (negocio y empresa, sin suscripción)', async () => {
    expect(await contar('public.servicios_contratados', 'suscripcion_id is not null')).toBe(0)
    expect(await contar('public.planes_cobro', 'negocio_id is null')).toBe(0)
  })
})

describe('la activación autogestionada crea una suscripción', () => {
  let res: Record<string, unknown>

  beforeAll(async () => {
    res = await r(activar({ rut: { veredicto: 'coincide', documento_path: 'rut/x.pdf', confianza: 0.93 } }))
  })

  it('responde activado con el contrato y la suscripción', () => {
    expect(res).toMatchObject({ ok: true, resultado: 'activado' })
    expect(res.suscripcion_id).toEqual(expect.any(String))
    expect(res).not.toHaveProperty('negocio_id')
  })

  it('no crea empresa en el directorio ni negocio (ni choca con el gate de carpeta de metrik)', async () => {
    expect(await contar('public.negocios')).toBe(1)
    expect(await contar('public.empresas')).toBe(1)
  })

  it('la suscripción guarda la empresa declarada, el RUT, el origen comercial, la tarjeta y los Términos', async () => {
    const s = (await db.query<Record<string, unknown>>(`select * from public.suscripciones_producto where id = '${res.suscripcion_id}'`)).rows[0]
    expect(s).toMatchObject({
      workspace_id: METRIK,
      producto: 'valida',
      workspace_cliente_id: WS_PRUEBA,
      nombre: 'Valida — CDA EJEMPLO S.A.S.',
      razon_social: 'CDA EJEMPLO S.A.S.',
      numero_documento: '900123456',
      dv: '7',
      correo_facturacion: 'gerencia@cdaejemplo.co',
      rut_veredicto: 'coincide',
      empresa_verificada: true,
      plan_slug: 'valida-cda-licencia',
      estado: 'activa',
      origen_comercial: 'afi',
      origen_fuente: 'ref',
      metodo_pago_pasarela: 'epayco',
      metodo_pago_ref: 'epayco:cli123:tok456',
      terminos_version: 'v2.0',
      terminos_sha256: sha256(TEXTO),
    })
    expect(s.terminos_documento_id).toEqual(expect.any(String))
    expect(s.metadata).toMatchObject({ origen: 'valida_autogestion', workspace_one: 'cda-ejemplo' })
    expect(await contar('public.suscripciones_producto_eventos', `suscripcion_id = '${res.suscripcion_id}' and tipo = 'alta'`)).toBe(1)
  })

  it('el contrato cuelga de la suscripción, sin negocio ni empresa; los Términos son de la suscripción', async () => {
    const sc = (await db.query<Record<string, unknown>>(`select * from public.servicios_contratados where id = '${res.contrato_id}'`)).rows[0]
    expect(sc).toMatchObject({ negocio_id: null, empresa_id: null, suscripcion_id: res.suscripcion_id, workspace_pagador_id: WS_PRUEBA, aceptante_designado_id: DUENA })
    const d = (await db.query<Record<string, unknown>>(`select * from public.documentos_contractuales_versiones where id = '${res.documento_id}'`)).rows[0]
    expect(d).toMatchObject({ alcance: 'cliente', empresa_id: null, suscripcion_id: res.suscripcion_id })
    expect(await contar('public.workspace_modulos', `servicio_contratado_id = '${res.contrato_id}'`)).toBe(1)
  })

  it('el segundo clic es ya_activo y no escribe', async () => {
    const otra = await r(activar())
    expect(otra).toMatchObject({ ok: true, resultado: 'ya_activo', contrato_id: res.contrato_id })
    expect(await contar('public.suscripciones_producto', `workspace_cliente_id = '${WS_PRUEBA}'`)).toBe(1)
  })

  it('un NIT con otra suscripción viva de Valida no recibe otra', async () => {
    // Una suscripción viva de ese NIT en otro espacio (p. ej. un registro anterior ya retirado).
    await db.exec(`insert into public.suscripciones_producto (workspace_id, producto, workspace_cliente_id, nombre, razon_social,
      numero_documento, plan_slug) values ('${METRIK}', 'valida', '${WS_CDA}', 'Valida — OTRO', 'OTRO CDA S.A.S.', '900777777', 'valida-cda-licencia')`)
    try {
      const otra = await r(activar({ ws: WS_DOBLE, usuario: DUENA_DOBLE, doc: { ...DOC, pdf_sha256: 'e'.repeat(64) } }))
      expect(otra).toEqual({ ok: false, error: 'nit_con_contrato' })
    } finally {
      await db.exec(`update public.suscripciones_producto set estado = 'cancelada', cancelada_at = now() where workspace_cliente_id = '${WS_CDA}'`)
    }
  })

  it('el NIT de un CDA de hoy (en negocios) sigue frenando', async () => {
    await db.exec(`update public.valida_registros set identificacion = '900158425', dv = '0' where workspace_id = '${WS_DOBLE}'`)
    const otra = await r(activar({ ws: WS_DOBLE, usuario: DUENA_DOBLE, doc: { ...DOC, pdf_sha256: 'e'.repeat(64) } }))
    expect(otra).toEqual({ ok: false, error: 'nit_con_contrato' })
    await db.exec(`update public.valida_registros set identificacion = '900777777', dv = '1' where workspace_id = '${WS_DOBLE}'`)
  })

  it('el cliente ve su contrato, sus Términos y, aceptados en el registro, la constancia', async () => {
    const servicios = await comoCliente<{ servicio_contratado_id: string; negocio_nombre: string }>(WS_PRUEBA, 'select * from public.mis_servicios()')
    expect(servicios).toEqual([expect.objectContaining({ servicio_contratado_id: res.contrato_id, negocio_nombre: 'Valida — CDA EJEMPLO S.A.S.' })])

    const reg = (await db.query<{ id: string }>(`select id from public.valida_registros where workspace_id = '${WS_PRUEBA}'`)).rows[0]
    await db.exec(`insert into public.aceptaciones_terminos (
        canal, estado, workspace_id, suscripcion_id, workspace_cliente_id, usuario_id, valida_registro_id,
        documento_version_id, documento_titulo, documento_version, documento_sha256, texto_documento_sha256,
        texto_aceptacion, nombre_aceptante, calidad, empresa_nombre, empresa_nit, expira_at)
      values ('registro', 'aceptado', '${METRIK}', '${res.suscripcion_id}', '${WS_PRUEBA}', '${DUENA}', '${reg.id}',
        '${res.documento_id}', '${DOC.titulo}', 'v2.0', '${DOC.pdf_sha256}', '${DOC.texto_sha256}',
        '${CASILLA}', 'x', 'autorizado', 'CDA EJEMPLO S.A.S.', '900123456', now() + interval '1 day')`)
    // La segunda (otra corrida del cron) rebota por la guarda de la base.
    const doble = await falla(`insert into public.aceptaciones_terminos (
        canal, estado, workspace_id, suscripcion_id, workspace_cliente_id, usuario_id, valida_registro_id,
        documento_version_id, documento_titulo, documento_version, documento_sha256, texto_documento_sha256,
        texto_aceptacion, nombre_aceptante, calidad, empresa_nombre, empresa_nit, expira_at)
      values ('registro', 'aceptado', '${METRIK}', '${res.suscripcion_id}', '${WS_PRUEBA}', '${DUENA}', '${reg.id}',
        '${res.documento_id}', '${DOC.titulo}', 'v2.0', '${DOC.pdf_sha256}', '${DOC.texto_sha256}',
        '${CASILLA}', 'x', 'autorizado', 'CDA EJEMPLO S.A.S.', '900123456', now() + interval '1 day')`)
    expect(doble).toMatch(/ya tiene aceptación registrada/)

    const docs = await comoCliente<{ documento_id: string; aceptado_at: string | null; aceptado_por: string }>(
      WS_PRUEBA,
      'select * from public.mis_documentos_de_servicio()',
    )
    expect(docs).toHaveLength(1)
    expect(docs[0].documento_id).toBe(res.documento_id)
    expect(docs[0].aceptado_at).not.toBeNull()
    expect(docs[0].aceptado_por).toBe('gerencia@cdaejemplo.co')

    // El CDA de hoy NO ve el documento de la suscripción, ni la suscripción el del CDA.
    const delCda = await comoCliente<{ documento_id: string }>(WS_CDA, 'select * from public.mis_documentos_de_servicio()')
    expect(delCda.map((d) => d.documento_id)).toEqual([DOC_CDA])
  })

  it('el enrolamiento crea el plan colgado de la suscripción, y el cliente ve su cuota y su cobro', async () => {
    const hoy = (await db.query<{ d: string }>(`select ((now() at time zone 'America/Bogota')::date)::text as d`)).rows[0].d
    const enr = await r(`select public.enrolar_cobro_por_ciclo('${res.contrato_id}', now(), 0,
      ${lit({ monto: 150000, frecuencia: 'mensual', fecha_inicio: hoy, fecha_fin: hoy, total_cuotas: 1, pasarela: 'bold' })},
      ${lit([{ numero: 1, monto: 150000, fecha_vencimiento: hoy, concepto_detalle: 'Valida — mes 1' }])}) as r`)
    expect(enr).toMatchObject({ resultado: 'creado' })
    const plan = (await db.query<Record<string, unknown>>(`select * from public.planes_cobro where id = '${enr.plan_cobro_id}'`)).rows[0]
    expect(plan).toMatchObject({ negocio_id: null, suscripcion_id: res.suscripcion_id, workspace_id: METRIK })
    const acta = (await db.query<Record<string, unknown>>(`select * from public.servicio_cobro_enrolamiento where servicio_contratado_id = '${res.contrato_id}'`)).rows[0]
    expect(acta).toMatchObject({ negocio_id: null, suscripcion_id: res.suscripcion_id })
    // Idempotente.
    const otra = await r(`select public.enrolar_cobro_por_ciclo('${res.contrato_id}', now(), 0,
      ${lit({ monto: 150000, frecuencia: 'mensual', fecha_inicio: hoy, fecha_fin: hoy, total_cuotas: 1 })},
      ${lit([{ numero: 1, monto: 150000, fecha_vencimiento: hoy }])}) as r`)
    expect(otra).toMatchObject({ resultado: 'ya_estaba' })

    await db.exec(`insert into public.cobros (workspace_id, suscripcion_id, plan_cobro_id, numero_cuota, monto, fecha, tipo_cobro)
      values ('${METRIK}', '${res.suscripcion_id}', '${enr.plan_cobro_id}', 1, 150000, current_date, 'programado')`)
    const cuotas = await comoCliente<{ numero: number; concepto: string }>(WS_PRUEBA, `select * from public.mis_cuotas_de_servicio('${res.contrato_id}')`)
    expect(cuotas).toEqual([expect.objectContaining({ numero: 1, concepto: 'Valida — mes 1' })])
    const cobros = await comoCliente<{ concepto: string; estado: string }>(WS_PRUEBA, `select * from public.mis_cobros_de_servicio('${res.contrato_id}')`)
    expect(cobros).toEqual([expect.objectContaining({ concepto: 'Valida — CDA EJEMPLO S.A.S.', estado: 'pagado' })])
    // Los cobros del CDA no se cuelan en la suscripción ni al revés.
    const delCda = await comoCliente<{ concepto: string }>(WS_CDA, `select * from public.mis_cobros_de_servicio('${CONTRATO_CDA}')`)
    expect(delCda).toHaveLength(1)
  })

  it('la vista de MRR suma el CDA (contrato por ciclo) y la suscripción, por producto', async () => {
    const det = (await db.query<{ fuente: string; producto: string; clase: string; mrr_cop: string; cuenta_en_mrr: boolean }>(
      `select fuente, producto, clase, mrr_cop::text, cuenta_en_mrr from public.v_mrr_por_producto order by fuente`,
    )).rows
    expect(det).toEqual([
      { fuente: 'negocio', producto: 'valida', clase: 'contrato_ciclo', mrr_cop: '150000', cuenta_en_mrr: true },
      { fuente: 'suscripcion', producto: 'valida', clase: 'suscripcion', mrr_cop: '150000', cuenta_en_mrr: true },
    ])
    const res2 = (await db.query<{ producto: string; fuente: string; mrr_cop: string }>(
      `select producto, fuente, mrr_cop::text from public.v_mrr_por_producto_resumen order by fuente`,
    )).rows
    expect(res2).toEqual([
      { producto: 'valida', fuente: 'negocio', mrr_cop: '150000' },
      { producto: 'valida', fuente: 'suscripcion', mrr_cop: '150000' },
    ])
  })
})

describe('las guardas', () => {
  it('un contrato no cuelga de los dos, ni de ninguno; uno de suscripción no lleva empresa', async () => {
    const s = (await db.query<{ id: string }>(`select id from public.suscripciones_producto where workspace_cliente_id = '${WS_PRUEBA}'`)).rows[0].id
    const base = `insert into public.servicios_contratados (workspace_id, empresa_id, negocio_id, suscripcion_id, servicio_slug, servicio_version,
      parametros, estado, vigente_desde, actualizado_por) values`
    expect(await falla(`${base} ('${METRIK}', '${EMPRESA_CDA}', '${NEGOCIO_CDA}', '${s}', 'valida-cda-licencia', 1, '{}', 'borrador', current_date, '${MAURICIO}')`)).toMatch(/servicios_contratados_ancla/)
    expect(await falla(`${base} ('${METRIK}', null, null, null, 'valida-cda-licencia', 1, '{}', 'borrador', current_date, '${MAURICIO}')`)).toMatch(/servicios_contratados_ancla/)
    expect(await falla(`${base} ('${METRIK}', '${EMPRESA_CDA}', null, '${s}', 'valida-cda-licencia', 1, '{}', 'borrador', current_date, '${MAURICIO}')`)).toMatch(/servicios_contratados_empresa_por_ancla/)
  })

  it('un cobro no es de un negocio y de una suscripción a la vez', async () => {
    const s = (await db.query<{ id: string }>(`select id from public.suscripciones_producto where workspace_cliente_id = '${WS_PRUEBA}'`)).rows[0].id
    expect(await falla(`insert into public.cobros (workspace_id, negocio_id, suscripcion_id, monto) values ('${METRIK}', '${NEGOCIO_CDA}', '${s}', 1)`)).toMatch(/cobros_ancla/)
  })

  it('la suscripción es del mismo espacio cobrador que el plan, el cobro y el contrato', async () => {
    const s = (await db.query<{ id: string }>(`select id from public.suscripciones_producto where workspace_cliente_id = '${WS_PRUEBA}'`)).rows[0].id
    expect(await falla(`insert into public.cobros (workspace_id, suscripcion_id, monto) values ('${OTRO_COBRADOR}', '${s}', 1)`)).toMatch(/no es del espacio cobrador/)
    expect(await falla(`insert into public.planes_cobro (workspace_id, suscripcion_id, monto) values ('${OTRO_COBRADOR}', '${s}', 1)`)).toMatch(/no es del espacio cobrador/)
  })

  it('una suscripción no cambia de espacio ni de producto, y la bitácora no se reescribe', async () => {
    const s = (await db.query<{ id: string }>(`select id from public.suscripciones_producto where workspace_cliente_id = '${WS_PRUEBA}'`)).rows[0].id
    expect(await falla(`update public.suscripciones_producto set workspace_cliente_id = '${WS_DOBLE}' where id = '${s}'`)).toMatch(/no cambian/)
    expect(await falla(`update public.suscripciones_producto set producto = 'sustenta' where id = '${s}'`)).toMatch(/no cambian/)
    expect(await falla(`delete from public.suscripciones_producto_eventos`)).toMatch(/solo se agrega/)
  })

  it('un documento de suscripción no se pasa a otra suscripción', async () => {
    expect(await falla(`update public.documentos_contractuales_versiones set suscripcion_id = null, empresa_id = '${EMPRESA_CDA}' where suscripcion_id is not null`)).toMatch(/inmutable/)
  })

  it('las tablas nuevas y las vistas no las lee nadie con sesión', async () => {
    for (const t of ['suscripciones_producto', 'suscripciones_producto_eventos', 'v_mrr_por_producto', 'v_mrr_por_producto_resumen']) {
      for (const rol of ['anon', 'authenticated']) {
        const p = (await db.query<{ p: boolean }>(`select has_table_privilege('${rol}', 'public.${t}', 'select') as p`)).rows[0].p
        expect(p, `${rol} ${t}`).toBe(false)
      }
    }
    for (const f of ['suscripcion_del_mismo_cobrador()', 'suscripciones_producto_touch()', 'suscripciones_producto_eventos_inmutable()']) {
      for (const rol of ['anon', 'authenticated']) {
        const p = (await db.query<{ p: boolean }>(`select has_function_privilege('${rol}', 'public.${f}', 'execute') as p`)).rows[0].p
        expect(p, `${rol} ${f}`).toBe(false)
      }
    }
  })
})

describe('la suscripción nace EN PRUEBA en el registro y la activación pasa ESA fila a activa (20261016170000)', () => {
  const DOC_DOBLE = { ...DOC, pdf_sha256: 'f'.repeat(64), pdf_path: 'cda-ejemplo-2/terminos.pdf' }
  let prueba: string

  beforeAll(async () => {
    // Lo que deja `asegurarSuscripcionEnPrueba` al registrarse (con service_role).
    prueba = (await db.query<{ id: string }>(`insert into public.suscripciones_producto (workspace_id, producto, workspace_cliente_id,
      nombre, razon_social, numero_documento, dv, correo_facturacion, plan_slug, estado, prueba_desde, prueba_hasta,
      origen_comercial, valida_registro_id, metadata)
      select '${METRIK}', 'valida', r.workspace_id, 'Valida — ' || r.razon_social, r.razon_social, r.identificacion, r.dv, r.correo,
        'valida-cda-licencia', 'prueba', r.aceptado_at, now() + interval '7 days', r.origen, r.id, '{"origen": "valida_autogestion"}'
      from public.valida_registros r where r.workspace_id = '${WS_DOBLE}' and r.estado = 'creado'
      returning id`)).rows[0].id
  })

  it('el estado «prueba» lo admite la tabla, y la fila es la única viva del espacio', async () => {
    expect(await contar('public.suscripciones_producto', `workspace_cliente_id = '${WS_DOBLE}' and estado <> 'cancelada'`)).toBe(1)
    // Una segunda en prueba del mismo espacio choca con «una viva por espacio y producto».
    const e = await falla(`insert into public.suscripciones_producto (workspace_id, producto, workspace_cliente_id, nombre, razon_social,
      numero_documento, plan_slug, estado) values ('${METRIK}', 'valida', '${WS_DOBLE}', 'Valida — X', 'X', '900777777', 'valida-cda-licencia', 'prueba')`)
    expect(e).toMatch(/uq_suscripciones_producto_viva/)
  })

  it('los tres caminos (consulta 11, «Activar plan», día 7) dejan UNA suscripción: la misma fila, ahora activa', async () => {
    // Los tres llaman a la misma RPC (`activarPlanDelEspacio`); sin la migración, la fila en prueba haría
    // responder `nit_con_contrato` a su propia activación.
    const primero = await r(activar({ ws: WS_DOBLE, usuario: DUENA_DOBLE, doc: DOC_DOBLE }))
    expect(primero).toMatchObject({ ok: true, resultado: 'activado', suscripcion_id: prueba })
    const segundo = await r(activar({ ws: WS_DOBLE, usuario: DUENA_DOBLE, doc: { ...DOC_DOBLE, pdf_sha256: '9'.repeat(64) } }))
    const tercero = await r(activar({ ws: WS_DOBLE, usuario: DUENA_DOBLE, doc: { ...DOC_DOBLE, pdf_sha256: '8'.repeat(64) } }))
    expect(segundo).toMatchObject({ ok: true, resultado: 'ya_activo', contrato_id: primero.contrato_id })
    expect(tercero).toMatchObject({ ok: true, resultado: 'ya_activo', contrato_id: primero.contrato_id })
    expect(await contar('public.suscripciones_producto', `workspace_cliente_id = '${WS_DOBLE}'`)).toBe(1)
    const s = (await db.query<Record<string, unknown>>(`select * from public.suscripciones_producto where id = '${prueba}'`)).rows[0]
    expect(s).toMatchObject({ estado: 'activa', razon_social: 'OTRO CDA S.A.S.', numero_documento: '900777777', terminos_version: 'v2.0' })
    expect(s.activada_at).not.toBeNull()
    expect(s.prueba_hasta).not.toBeNull()
    expect(s.terminos_documento_id).toEqual(expect.any(String))
    const sc = (await db.query<Record<string, unknown>>(`select * from public.servicios_contratados where id = '${primero.contrato_id}'`)).rows[0]
    expect(sc).toMatchObject({ suscripcion_id: prueba, negocio_id: null, empresa_id: null })
    expect(await contar('public.suscripciones_producto_eventos', `suscripcion_id = '${prueba}' and tipo = 'alta'`)).toBe(1)
  })

  it('la reversa devuelve la definición de 20261016100100', async () => {
    const otra = new PGlite()
    try {
      await otra.exec(ESQUEMA_BASE)
      for (const m of CADENA) await otra.exec(migracion(m))
      await otra.exec(migracion('20261016100000_suscripciones_producto.sql'))
      await otra.exec(migracion('20261016100100_motor_cobro_ancla_suscripcion.sql'))
      const firma = `'public.valida_activar_autogestion(uuid,uuid,uuid,uuid,uuid,text,jsonb,date,jsonb,jsonb)'::regprocedure`
      const def = async () => (await otra.query<{ d: string }>(`select pg_get_functiondef(${firma}) as d`)).rows[0].d
      const antes = await def()
      await otra.exec(migracion('20261016170000_suscripcion_valida_nace_en_prueba.sql'))
      expect(await def()).not.toBe(antes)
      for (const rol of ['anon', 'authenticated']) {
        const p = (await otra.query<{ p: boolean }>(`select has_function_privilege('${rol}', ${firma}, 'execute') as p`)).rows[0].p
        expect(p, rol).toBe(false)
      }
      await otra.exec(readFileSync(join(RAIZ, 'sql/suscripciones-producto/reversa-20261016-170000.sql'), 'utf8'))
      expect(await def()).toBe(antes)
    } finally {
      await otra.close()
    }
  }, 120_000)
})

describe('la reversa', () => {
  it('deja las once funciones como estaban y el esquema sin las columnas nuevas', async () => {
    const otra = new PGlite()
    try {
      await otra.exec(ESQUEMA_BASE)
      for (const m of CADENA) await otra.exec(migracion(m))
      const antes: Record<string, string> = {}
      for (const f of FUNCIONES) antes[f] = (await otra.query<{ d: string }>(`select pg_get_functiondef('${f}'::regprocedure) as d`)).rows[0].d
      await otra.exec(migracion('20261016100000_suscripciones_producto.sql'))
      await otra.exec(migracion('20261016100100_motor_cobro_ancla_suscripcion.sql'))
      await otra.exec(migracion('20261016100200_mrr_por_producto.sql'))
      await otra.exec(readFileSync(join(RAIZ, 'sql/suscripciones-producto/reversa-20261016.sql'), 'utf8'))
      await otra.exec(migracion('20261012100000_valida_activar_autogestion.sql'))
      for (const f of FUNCIONES) {
        const d = (await otra.query<{ d: string }>(`select pg_get_functiondef('${f}'::regprocedure) as d`)).rows[0].d
        expect(d, f).toBe(antes[f])
      }
      const cols = (await otra.query<{ n: number }>(`select count(*)::int as n from information_schema.columns where column_name = 'suscripcion_id'`)).rows[0].n
      expect(cols).toBe(0)
      const nn = (await otra.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns where table_name = 'servicios_contratados' and column_name in ('negocio_id', 'empresa_id')`,
      )).rows
      expect(nn.every((c) => c.is_nullable === 'NO')).toBe(true)
    } finally {
      await otra.close()
    }
  }, 120_000)
})
