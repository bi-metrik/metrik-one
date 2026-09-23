import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

/**
 * La aceptación de los términos desde el módulo, EJECUTADA contra las migraciones reales.
 *
 * Se aplican, en el orden en que llegan a producción, las migraciones que dan forma a
 * `aceptaciones_terminos` (la del bot, la de la purga), las del módulo (versiones de documentos y
 * `mis_documentos_de_servicio`) y `20260917014500`. Antes de aplicarla se siembra una aceptación
 * por WhatsApp como la de 4D SOFT: la migración tiene que dejarla válida y seguir mostrándola.
 *
 * Lo que se fija es lo que la base decide sola, aunque el servidor tuviera un defecto:
 *   - solo el dueño del espacio, y nunca el soporte de MeTRIK, deja una constancia del módulo;
 *   - la fila corresponde exactamente a una versión vigente y a un contrato de esa empresa;
 *   - lo aceptado por WhatsApp no se acepta otra vez;
 *   - la hora y la huella de la declaración las pone la base;
 *   - `mis_documentos_de_servicio` la muestra con canal 'modulo'.
 *
 * Desde `20260923220000` (los CDA) todo lo anterior corre contra el cuerpo NUEVO de la guarda, que
 * además aprende la persona designada por el contrato, y se prueba `mis_cuotas_de_servicio`. Que
 * los casos viejos sigan pasando es la prueba de que 4D SOFT (sin designación) no cambia.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (archivo: string) => readFileSync(join(MIGRACIONES, archivo), 'utf8')

const WS_METRIK = '00000000-0000-4000-8000-000000000001'
const WS_CLIENTE = '00000000-0000-4000-8000-000000000002'
const WS_AJENO = '00000000-0000-4000-8000-000000000003'
const EMP_CLIENTE = '00000000-0000-4000-8000-0000000000a1'
const EMP_AJENA = '00000000-0000-4000-8000-0000000000a2'
const NEG_CLIENTE = '00000000-0000-4000-8000-0000000000b1'
const NEG_AJENO = '00000000-0000-4000-8000-0000000000b2'
const SC_CLIENTE = '00000000-0000-4000-8000-0000000000c1'
const SC_AJENO = '00000000-0000-4000-8000-0000000000c2'
const OWNER = '00000000-0000-4000-8000-0000000000d1'
const OPERADOR = '00000000-0000-4000-8000-0000000000d2'
const SOPORTE = '00000000-0000-4000-8000-0000000000d3'
const OWNER_AJENO = '00000000-0000-4000-8000-0000000000d4'
const DESIGNADA = '00000000-0000-4000-8000-0000000000d5'
const PLAN = '00000000-0000-4000-8000-0000000000f1'
const DOC_V10 = '00000000-0000-4000-8000-0000000000e1'
const DOC_V11 = '00000000-0000-4000-8000-0000000000e2'
const DOC_FUTURA = '00000000-0000-4000-8000-0000000000e3'
const DOC_AJENA = '00000000-0000-4000-8000-0000000000e4'
const ACE_WA = 'def579c7-2eed-4fd9-bbee-2803d1f6293f'

const SHA = (c: string) => c.repeat(64)
const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex')

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

  create table public.workspaces (id uuid primary key, slug text);
  create table public.profiles (
    id uuid primary key,
    workspace_id uuid references public.workspaces(id),
    role text,
    platform_admin boolean not null default false
  );
  create table public.empresas (id uuid primary key, nombre text);
  create table public.lineas_negocio (id uuid primary key, nombre text);
  create table public.negocios (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    nombre text
  );
  create table public.cobros (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid references public.negocios(id),
    fecha date,
    monto numeric(15,2) not null default 0,
    monto_anulado numeric(15,2),
    fuente text,
    anulado_at timestamptz,
    notas text,
    siigo_recibo jsonb,
    plan_cobro_id uuid,
    numero_cuota integer,
    tipo_cobro text,
    created_at timestamptz not null default now()
  );
  create table public.catalogo_servicios (
    slug text primary key, nombre text not null, modulo text not null, disparador_cobro text not null
  );
  create table public.servicios_contratados (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    empresa_id uuid not null references public.empresas(id),
    negocio_id uuid not null references public.negocios(id),
    servicio_slug text not null references public.catalogo_servicios(slug),
    servicio_version integer not null,
    workspace_pagador_id uuid references public.workspaces(id),
    estado text not null default 'activo',
    vigente_desde date not null,
    vigente_hasta date,
    comision jsonb,
    correo_facturacion text
  );
  create table public.servicio_contratado_beneficiarios (
    servicio_contratado_id uuid not null references public.servicios_contratados(id) on delete cascade,
    workspace_id uuid not null references public.workspaces(id),
    primary key (servicio_contratado_id, workspace_id)
  );
  create table public.wa_message_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id),
    phone text not null,
    direction text not null,
    intent text,
    message_preview text,
    created_at timestamptz default now()
  );
  create table public.planes_cobro (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid not null references public.negocios(id),
    activo boolean not null default true,
    notas text
  );
  create table public.plan_cobro_cuotas (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    plan_cobro_id uuid not null references public.planes_cobro(id),
    numero integer not null,
    tipo text not null default 'cuota',
    monto numeric not null,
    fecha_vencimiento date not null,
    concepto_detalle text
  );
  create table public.bot_sessions (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    user_phone text not null,
    context jsonb default '{}',
    expires_at timestamptz default (now() + interval '5 minutes')
  );

  create function public.current_user_workspace_id() returns uuid
    language sql stable as $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;

  insert into public.workspaces (id, slug) values
    ('${WS_METRIK}', 'metrik'), ('${WS_CLIENTE}', '4d-soft'), ('${WS_AJENO}', 'ajeno');
  insert into public.profiles (id, workspace_id, role, platform_admin) values
    ('${OWNER}', '${WS_CLIENTE}', 'owner', false),
    ('${OPERADOR}', '${WS_CLIENTE}', 'operator', false),
    -- El soporte de MeTRIK visitando el espacio del cliente: owner ahí, y platform_admin.
    ('${SOPORTE}', '${WS_CLIENTE}', 'owner', true),
    ('${OWNER_AJENO}', '${WS_AJENO}', 'owner', false),
    -- La representante legal que la empresa designa: en el espacio del cliente, sin ser dueña.
    ('${DESIGNADA}', '${WS_CLIENTE}', 'operator', false);
  insert into public.empresas (id, nombre) values ('${EMP_CLIENTE}', '4D SOFT S.A.S.'), ('${EMP_AJENA}', 'Ajena SAS');
  insert into public.negocios (id, workspace_id, nombre) values
    ('${NEG_CLIENTE}', '${WS_METRIK}', 'X1 26 1 Paquete Valida API'),
    ('${NEG_AJENO}', '${WS_METRIK}', 'Z9 26 9 Contrato de otro');
  insert into public.catalogo_servicios values ('valida-api-bolsa', 'Paquete Valida API', 'valida_api', 'consumo');
  insert into public.servicios_contratados
    (id, workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, workspace_pagador_id, vigente_desde)
  values
    ('${SC_CLIENTE}', '${WS_METRIK}', '${EMP_CLIENTE}', '${NEG_CLIENTE}', 'valida-api-bolsa', 1, '${WS_CLIENTE}', date '2026-09-15'),
    ('${SC_AJENO}', '${WS_METRIK}', '${EMP_AJENA}', '${NEG_AJENO}', 'valida-api-bolsa', 1, '${WS_AJENO}', date '2026-09-15');
`

/** Lo que existe en producción ANTES de esta migración: la aceptación de 4D SOFT por WhatsApp. */
const ACEPTACION_WHATSAPP = `
  insert into public.aceptaciones_terminos
    (id, workspace_id, negocio_id, telefono, nombre_aceptante, calidad, empresa_nombre, empresa_nit,
     documento_titulo, documento_version, documento_url, documento_sha256, texto_aceptacion)
  values
    ('${ACE_WA}', '${WS_METRIK}', '${NEG_CLIENTE}', '+573000000000', 'Juan Guillermo', 'apoderado',
     '4D SOFT S.A.S.', '901220269-6', 'Términos de Uso — VALIDA', 'v1.0',
     'https://proyecto.supabase.co/storage/v1/object/sign/aceptaciones-documentos/4d-soft/v1.pdf?token=x',
     '${SHA('c')}', 'Actúo como APODERADO de 4D SOFT S.A.S. y ACEPTO.');
  update public.aceptaciones_terminos
     set estado = 'aceptado', respondido_at = '2026-09-15T13:49:21Z', reply_wamid = 'wamid.reply',
         button_id = 'terminos:acepto', payload_respuesta = '{}'::jsonb, prompt_wamid = 'wamid.prompt'
   where id = '${ACE_WA}';
`

const hoy = new Date().toISOString().slice(0, 10)

const VERSIONES = `
  insert into public.documentos_contractuales_versiones
    (id, workspace_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256, vigente_desde)
  values
    ('${DOC_V10}', '${WS_METRIK}', 'terminos-uso-valida', 'cliente', '${EMP_CLIENTE}', 'Términos de Uso — VALIDA', 'v1.0',
     '# Términos v1.0', '${SHA('b')}', '4d-soft/v1.pdf', '${SHA('c')}', date '2026-09-15'),
    ('${DOC_V11}', '${WS_METRIK}', 'terminos-uso-valida', 'cliente', '${EMP_CLIENTE}', 'Términos de Uso — VALIDA', 'v1.1',
     '# Términos v1.1', '${SHA('d')}', '4d-soft/v11.pdf', '${SHA('f')}', date '2026-09-01'),
    ('${DOC_FUTURA}', '${WS_METRIK}', 'terminos-uso-valida', 'cliente', '${EMP_CLIENTE}', 'Términos de Uso — VALIDA', 'v2.0',
     '# Términos v2.0', '${SHA('1')}', '4d-soft/v2.pdf', '${SHA('2')}', date '2099-01-01'),
    ('${DOC_AJENA}', '${WS_METRIK}', 'terminos-uso-valida', 'cliente', '${EMP_AJENA}', 'Términos de Uso — VALIDA', 'v1.0',
     '# Términos de otro', '${SHA('3')}', 'ajena/v1.pdf', '${SHA('4')}', date '2026-09-01');
`

function declaracion(o: { nombre?: string; cedula?: string; pdf?: string } = {}) {
  const nombre = o.nombre ?? 'Johann Manuel Valbuena Alfonso'
  const cedula = o.cedula ?? '79123456'
  const pdf = o.pdf ?? SHA('f')
  return `Yo, ${nombre}, identificado(a) con cédula ${cedula}, actúo como REPRESENTANTE LEGAL de 4D SOFT S.A.S. (NIT 901220269-6). ACEPTO los Términos de Uso — VALIDA v1.1 (huella SHA-256 del PDF: ${pdf}).`
}

/** Fila del canal módulo con todo lo obligatorio; `extra` pisa columnas con expresiones SQL. */
function insertModulo(extra: Record<string, string> = {}) {
  const cols: Record<string, string> = {
    workspace_id: `'${WS_METRIK}'`,
    negocio_id: `'${NEG_CLIENTE}'`,
    canal: `'modulo'`,
    estado: `'aceptado'`,
    nombre_aceptante: `'Johann Manuel Valbuena Alfonso'`,
    cedula_aceptante: `'79123456'`,
    calidad: `'representante_legal'`,
    empresa_nombre: `'4D SOFT S.A.S.'`,
    empresa_nit: `'901220269-6'`,
    usuario_id: `'${OWNER}'`,
    workspace_cliente_id: `'${WS_CLIENTE}'`,
    documento_version_id: `'${DOC_V11}'`,
    documento_titulo: `'Términos de Uso — VALIDA'`,
    documento_version: `'v1.1'`,
    documento_sha256: `'${SHA('f')}'`,
    texto_documento_sha256: `'${SHA('d')}'`,
    texto_aceptacion: `'${declaracion()}'`,
    ip: `'190.24.1.10'`,
    user_agent: `'Mozilla/5.0'`,
    ...extra,
  }
  return `insert into public.aceptaciones_terminos (${Object.keys(cols).join(', ')})
          values (${Object.values(cols).join(', ')})`
}

let db: PGlite

/** Corre `sql` en una transacción que se deshace. Devuelve el mensaje de error, o '' si pasó. */
async function ensayo(sql: string): Promise<string> {
  await db.exec('begin')
  try {
    await db.exec(sql)
    return ''
  } catch (e) {
    return (e as Error).message
  } finally {
    await db.exec('rollback')
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer('20260901000003_wa_envios.sql'))
  await db.exec(leer('20260915040000_aceptaciones_terminos.sql'))
  await db.exec(ACEPTACION_WHATSAPP)
  await db.exec(leer('20260915060000_purga_registros_bot.sql'))
  await db.exec(leer('20260916180000_modulo_valida_api.sql'))
  await db.exec(leer('20260916213000_mis_documentos_de_servicio_por_negocio.sql'))
  await db.exec(VERSIONES)
  await db.exec(leer('20260917014500_aceptacion_terminos_en_modulo.sql'))
  await db.exec(leer('20260923220000_terminos_cda_designado_y_enlace_pago.sql'))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('lo que ya existía sigue igual', () => {
  it('la aceptación por WhatsApp queda con canal whatsapp y la migración no la rechaza', async () => {
    const r = await db.query<{ canal: string; estado: string }>(
      `select canal, estado from public.aceptaciones_terminos where id = '${ACE_WA}'`,
    )
    expect(r.rows).toEqual([{ canal: 'whatsapp', estado: 'aceptado' }])
  })

  it('el canal whatsapp sigue exigiendo teléfono, URL y la respuesta completa de Meta', async () => {
    const base = (extra: string) => `insert into public.aceptaciones_terminos
        (workspace_id, telefono, nombre_aceptante, calidad, empresa_nombre, documento_titulo, documento_version,
         documento_url, documento_sha256, texto_aceptacion ${extra ? ', estado, respondido_at' : ''})
      values ('${WS_METRIK}', %TEL%, 'X', 'apoderado', 'E', 'T', 'v', %URL%, '${SHA('9')}', 'acepto'
              ${extra})`
    const sinTelefono = base('').replace('%TEL%', 'null').replace('%URL%', `'https://x.co/a.pdf'`)
    expect(await ensayo(sinTelefono)).toMatch(/telefono_por_canal/)
    const sinUrl = base('').replace('%TEL%', `'+573000000001'`).replace('%URL%', 'null')
    expect(await ensayo(sinUrl)).toMatch(/url_por_canal/)
    const aceptadoSinWamid = base(`, 'aceptado', now()`).replace('%TEL%', `'+573000000001'`).replace('%URL%', `'https://x.co/a.pdf'`)
    expect(await ensayo(aceptadoSinWamid)).toMatch(/respuesta_completa/)
  })
})

describe('aceptar desde el módulo', () => {
  it('el dueño del espacio acepta la versión vigente: la base pone la hora y la huella de la declaración', async () => {
    expect(await ensayo(`${insertModulo()};`)).toBe('')

    await db.exec('begin')
    try {
      await db.exec(`${insertModulo()};`)
      const r = await db.query<{ estado: string; respondido: boolean; huella: string }>(
        `select estado, respondido_at is not null as respondido, texto_aceptacion_sha256 as huella
           from public.aceptaciones_terminos where canal = 'modulo'`,
      )
      expect(r.rows).toEqual([{ estado: 'aceptado', respondido: true, huella: sha256(declaracion()) }])

      await db.exec(`set prueba.ws = '${WS_CLIENTE}'`)
      const docs = await db.query<{ version: string; aceptado_por: string | null; aceptado_canal: string | null }>(
        `select version, aceptado_por, case when aceptado_at is null then null else aceptado_canal end as aceptado_canal
           from public.mis_documentos_de_servicio() order by version`,
      )
      // La v1.0 conserva la constancia de WhatsApp, la v1.1 muestra la del módulo, y la v2.0
      // (aún no vigente) se lista sin constancia.
      expect(docs.rows).toEqual([
        { version: 'v1.0', aceptado_por: 'Juan Guillermo', aceptado_canal: 'whatsapp' },
        { version: 'v1.1', aceptado_por: 'Johann Manuel Valbuena Alfonso', aceptado_canal: 'modulo' },
        { version: 'v2.0', aceptado_por: null, aceptado_canal: null },
      ])
    } finally {
      await db.exec('rollback')
    }
  })

  it('una hora o una huella mandadas desde fuera se ignoran: las escribe la base', async () => {
    await db.exec('begin')
    try {
      await db.exec(`${insertModulo({ respondido_at: `'2001-01-01T00:00:00Z'`, texto_aceptacion_sha256: `'${SHA('0')}'` })};`)
      const r = await db.query<{ viejo: boolean; huella: string }>(
        `select respondido_at < '2020-01-01' as viejo, texto_aceptacion_sha256 as huella
           from public.aceptaciones_terminos where canal = 'modulo'`,
      )
      expect(r.rows).toEqual([{ viejo: false, huella: sha256(declaracion()) }])
    } finally {
      await db.exec('rollback')
    }
  })

  it('un operador del espacio no acepta', async () => {
    expect(await ensayo(`${insertModulo({ usuario_id: `'${OPERADOR}'` })};`)).toMatch(/solo el dueño/)
  })

  it('el soporte de MeTRIK no acepta por el cliente, aunque figure como owner del espacio', async () => {
    expect(await ensayo(`${insertModulo({ usuario_id: `'${SOPORTE}'` })};`)).toMatch(/soporte de MeTRIK/)
  })

  it('el dueño de OTRO espacio no acepta por este cliente', async () => {
    expect(await ensayo(`${insertModulo({ usuario_id: `'${OWNER_AJENO}'` })};`)).toMatch(/solo el dueño/)
  })

  it('lo ya aceptado por WhatsApp no se vuelve a aceptar', async () => {
    const v10 = insertModulo({
      documento_version_id: `'${DOC_V10}'`,
      documento_version: `'v1.0'`,
      documento_sha256: `'${SHA('c')}'`,
      texto_documento_sha256: `'${SHA('b')}'`,
      texto_aceptacion: `'${declaracion({ pdf: SHA('c') })}'`,
    })
    expect(await ensayo(`${v10};`)).toMatch(/ya tiene aceptación registrada/)
  })

  it('dos aceptaciones de la misma versión: la segunda rebota', async () => {
    expect(await ensayo(`${insertModulo()}; ${insertModulo()};`)).toMatch(/ya tiene aceptación registrada|duplicate key/)
  })

  it('una huella que no es la de la versión se rechaza', async () => {
    expect(await ensayo(`${insertModulo({ texto_documento_sha256: `'${SHA('e')}'` })};`)).toMatch(/no coincide con la versión/)
    expect(await ensayo(`${insertModulo({ documento_version: `'v9.9'` })};`)).toMatch(/no coincide con la versión/)
  })

  it('una versión que aún no rige no se acepta', async () => {
    const futura = insertModulo({
      documento_version_id: `'${DOC_FUTURA}'`,
      documento_version: `'v2.0'`,
      documento_sha256: `'${SHA('2')}'`,
      texto_documento_sha256: `'${SHA('1')}'`,
      texto_aceptacion: `'${declaracion({ pdf: SHA('2') })}'`,
    })
    expect(await ensayo(`${futura};`)).toMatch(/no está vigente/)
    expect(hoy < '2099-01-01').toBe(true)
  })

  it('el negocio tiene que ser de un contrato de esa empresa que cubra al cliente', async () => {
    // Negocio de un contrato de OTRA empresa y de OTRO espacio pagador.
    expect(await ensayo(`${insertModulo({ negocio_id: `'${NEG_AJENO}'` })};`)).toMatch(/no es de un contrato/)
    // Versión de otra empresa sobre el negocio del cliente.
    const ajena = insertModulo({
      documento_version_id: `'${DOC_AJENA}'`,
      documento_version: `'v1.0'`,
      documento_sha256: `'${SHA('4')}'`,
      texto_documento_sha256: `'${SHA('3')}'`,
      texto_aceptacion: `'${declaracion({ pdf: SHA('4') })}'`,
    })
    expect(await ensayo(`${ajena};`)).toMatch(/no es de un contrato/)
  })

  it('la declaración tiene que nombrar a la persona, su cédula y la huella del PDF', async () => {
    const sinCedula = `Yo, Johann Manuel Valbuena Alfonso, ACEPTO los términos (huella ${SHA('f')}).`
    expect(await ensayo(`${insertModulo({ texto_aceptacion: `'${sinCedula}'` })};`)).toMatch(/tiene que nombrar/)
    const sinHuella = `Yo, Johann Manuel Valbuena Alfonso, cédula 79123456, ACEPTO los términos.`
    expect(await ensayo(`${insertModulo({ texto_aceptacion: `'${sinHuella}'` })};`)).toMatch(/tiene que nombrar/)
  })

  it('sin cédula, con una calidad que no obliga a la empresa o con datos de WhatsApp, no entra', async () => {
    expect(await ensayo(`${insertModulo({ cedula_aceptante: 'null' })};`)).toMatch(/modulo_completa|tiene que nombrar/)
    // La declaración nombra la cédula con puntos, así que la guarda la deja pasar y la frena el CHECK.
    const conPuntos = insertModulo({
      cedula_aceptante: `'79.123.456'`,
      texto_aceptacion: `'${declaracion({ cedula: '79.123.456' })}'`,
    })
    expect(await ensayo(`${conPuntos};`)).toMatch(/aceptaciones_terminos_cedula/)
    expect(await ensayo(`${insertModulo({ calidad: `'autorizado'` })};`)).toMatch(/modulo_completa/)
    expect(await ensayo(`${insertModulo({ telefono: `'+573000000009'` })};`)).toMatch(/modulo_completa/)
    expect(await ensayo(`${insertModulo({ estado: `'pendiente'` })};`)).toMatch(/modulo_completa/)
  })

  it('una constancia del módulo es inmutable: ni sus datos ni su canal cambian', async () => {
    const r = await ensayo(`
      ${insertModulo()};
      update public.aceptaciones_terminos set nombre_aceptante = 'Otra persona' where canal = 'modulo';
    `)
    expect(r).toMatch(/no se modifica/)
    const canal = await ensayo(`
      ${insertModulo()};
      update public.aceptaciones_terminos set canal = 'whatsapp' where canal = 'modulo';
    `)
    expect(canal).toMatch(/no se modifica|el canal no cambia/)
  })
})

describe('la persona que el contrato designa (CDA)', () => {
  const designar = (perfil: string) =>
    `update public.servicios_contratados set aceptante_designado_id = '${perfil}' where id = '${SC_CLIENTE}';`

  it('ella acepta aunque no sea la dueña del espacio', async () => {
    expect(await ensayo(`${designar(DESIGNADA)} ${insertModulo({ usuario_id: `'${DESIGNADA}'` })};`)).toBe('')
  })

  it('con alguien designado, el dueño ya no acepta', async () => {
    expect(await ensayo(`${designar(DESIGNADA)} ${insertModulo()};`)).toMatch(/la empresa designó/)
  })

  it('con alguien designado, un operador cualquiera tampoco', async () => {
    expect(await ensayo(`${designar(DESIGNADA)} ${insertModulo({ usuario_id: `'${OPERADOR}'` })};`)).toMatch(
      /la empresa designó/,
    )
  })

  it('la persona designada acepta desde el espacio del cliente, no desde otro', async () => {
    // Designada, pero su perfil vive en otro espacio: la constancia diría que aceptó desde aquí.
    expect(await ensayo(`${designar(OWNER_AJENO)} ${insertModulo({ usuario_id: `'${OWNER_AJENO}'` })};`)).toMatch(
      /la empresa designó/,
    )
  })

  it('designar al soporte de MeTRIK no lo habilita', async () => {
    expect(await ensayo(`${designar(SOPORTE)} ${insertModulo({ usuario_id: `'${SOPORTE}'` })};`)).toMatch(
      /soporte de MeTRIK/,
    )
  })

  it('sin designación sigue la regla del dueño (4D SOFT no cambia)', async () => {
    expect(await ensayo(`${insertModulo({ usuario_id: `'${DESIGNADA}'` })};`)).toMatch(/solo el dueño/)
    expect(await ensayo(`${insertModulo()};`)).toBe('')
  })
})

describe('mis_cuotas_de_servicio: las cuotas y su enlace, solo para quien paga', () => {
  // El enlace vive en el cobro programado de la cuota (donde el ciclo de suscripciones anota el
  // intento de la pasarela). La cuota 2 tiene uno ANULADO: no ofrece enlace. La 3, uno sin enlace.
  const SEMBRAR = `
    insert into public.planes_cobro (id, workspace_id, negocio_id, activo, notas)
    values ('${PLAN}', '${WS_METRIK}', '${NEG_CLIENTE}', false, 'nota interna que el cliente no ve');
    insert into public.plan_cobro_cuotas (workspace_id, plan_cobro_id, numero, monto, fecha_vencimiento, concepto_detalle)
    values
      ('${WS_METRIK}', '${PLAN}', 3, 150000, date '2026-11-27', 'Licencia VALIDA · Starter, periodo del 23/11/2026 al 22/12/2026'),
      ('${WS_METRIK}', '${PLAN}', 2, 150000, date '2026-10-27', 'Licencia VALIDA · Starter, periodo del 23/10/2026 al 22/11/2026'),
      ('${WS_METRIK}', '${PLAN}', 1, 150000, date '2026-09-30', 'Licencia VALIDA · Starter, periodo del 23/09/2026 al 22/10/2026');
    insert into public.cobros (id, workspace_id, negocio_id, plan_cobro_id, numero_cuota, tipo_cobro, monto, notas, enlace_pago_url, enlace_pago_expira, anulado_at)
    values
      (gen_random_uuid(), '${WS_METRIK}', '${NEG_CLIENTE}', '${PLAN}', 1, 'programado', 150000, 'nota interna',
       'https://checkout.bold.co/payment/LNK_PRUEBA', '2026-09-30T23:59:00-05:00', null),
      (gen_random_uuid(), '${WS_METRIK}', '${NEG_CLIENTE}', '${PLAN}', 2, 'programado', 0, 'anulado',
       'https://checkout.bold.co/payment/LNK_VIEJO', null, now()),
      (gen_random_uuid(), '${WS_METRIK}', '${NEG_CLIENTE}', '${PLAN}', 3, 'programado', 150000, null, null, null, null);
  `

  async function cuotasComo(ws: string | null, extra = '') {
    await db.exec('begin')
    try {
      await db.exec(SEMBRAR + extra)
      await db.exec(`set prueba.ws = '${ws ?? ''}'`)
      const r = await db.query<Record<string, unknown>>(
        `select * from public.mis_cuotas_de_servicio('${SC_CLIENTE}')`,
      )
      return r.rows
    } finally {
      await db.exec('rollback')
      await db.exec(`set prueba.ws = ''`)
    }
  }

  it('el espacio que paga ve sus cuotas en orden de vencimiento, con lista cerrada de campos', async () => {
    const filas = await cuotasComo(WS_CLIENTE)
    const campos = ['concepto', 'enlace_pago_expira', 'enlace_pago_url', 'fecha_vencimiento', 'monto', 'numero', 'tipo']
    expect(filas.map((f) => Object.keys(f).sort())).toEqual([campos, campos, campos])
    expect(filas.map((f) => [f.numero, f.enlace_pago_url])).toEqual([
      [1, 'https://checkout.bold.co/payment/LNK_PRUEBA'],
      [2, null],
      [3, null],
    ])
    expect(filas[0].enlace_pago_expira).not.toBeNull()
  })

  it('otro espacio, con el id del contrato ajeno, no ve nada', async () => {
    expect(await cuotasComo(WS_AJENO)).toEqual([])
  })

  it('un beneficiario que no paga no ve la plata', async () => {
    const extra = `insert into public.servicio_contratado_beneficiarios values ('${SC_CLIENTE}', '${WS_AJENO}');`
    expect(await cuotasComo(WS_AJENO, extra)).toEqual([])
  })

  it('sin sesión no devuelve nada', async () => {
    expect(await cuotasComo(null)).toEqual([])
  })

  it('el enlace tiene que ser https y sin espacios', async () => {
    const cuota = (url: string) => `
      insert into public.cobros (id, workspace_id, negocio_id, tipo_cobro, monto, enlace_pago_url)
      values (gen_random_uuid(), '${WS_METRIK}', '${NEG_CLIENTE}', 'programado', 150000, '${url}');`
    expect(await ensayo(cuota('http://checkout.bold.co/payment/LNK_1'))).toMatch(/enlace_pago_https/)
    expect(await ensayo(cuota('https://checkout.bold.co/pay ment'))).toMatch(/enlace_pago_https/)
    expect(await ensayo(cuota('javascript:alert(1)'))).toMatch(/enlace_pago_https/)
    expect(await ensayo(cuota('https://checkout.bold.co/payment/LNK_1'))).toBe('')
  })

  it('la ejecuta authenticated y no anon', async () => {
    const r = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.mis_cuotas_de_servicio(uuid)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.mis_cuotas_de_servicio(uuid)', 'execute') as auth`,
    )
    expect(r.rows[0]).toEqual({ anon: false, auth: true })
  })
})

describe('nada nace concedido', () => {
  it('la guarda del módulo no la ejecuta anon ni authenticated', async () => {
    const r = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.aceptaciones_terminos_modulo()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.aceptaciones_terminos_modulo()', 'execute') as auth`,
    )
    expect(r.rows[0]).toEqual({ anon: false, auth: false })
  })

  it('la tabla sigue siendo server-only', async () => {
    const r = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_table_privilege('anon', 'public.aceptaciones_terminos', 'select') as anon,
              has_table_privilege('authenticated', 'public.aceptaciones_terminos', 'select') as auth`,
    )
    expect(r.rows[0]).toEqual({ anon: false, auth: false })
  })
})
