import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración del módulo Valida API (C2), EJECUTADA.
 *
 * Leer el SQL no dice si corre ni qué deja: aquí se levanta Postgres en memoria, se aplica
 * `20260916180000_modulo_valida_api.sql` **tal cual está en el repo** y se prueban las tres
 * decisiones que la base tiene que hacer cumplir sola:
 *
 *   1. Una RPC devuelve SOLO lo del workspace de la sesión. Es el único candado entre el
 *      workspace de un cliente externo y los datos que viven en el workspace metrik.
 *   2. Quien no paga no ve la plata: un beneficiario sin `workspace_pagador_id` recibe cero
 *      cobros, no una lista recortada.
 *   3. Nada nace concedido: las dos tablas sin privilegios para `anon` ni `authenticated`, y
 *      las tres funciones sin `EXECUTE` para PUBLIC ni `anon`.
 *
 * El punto 3 se prueba con los privilegios por defecto del esquema **encendidos**, que es como
 * está producción: toda función nace ejecutable por `anon` vía PUBLIC (CLAUDE.md lo documenta
 * y no se puede arreglar desde la configuración). Sin esa línea, el `revoke` de la migración
 * pasaría la prueba estando ausente.
 *
 * Límite conocido: PGlite no tiene RLS de Supabase ni `auth.uid()`, así que
 * `current_user_workspace_id()` entra como stub sobre un GUC. Lo que se prueba es la lógica
 * del filtro, no la RLS de las tablas base — que además aquí no aplica, porque las funciones
 * son `security definer` justamente para saltársela.
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20260916180000_modulo_valida_api.sql')

const WS_METRIK = '00000000-0000-4000-8000-000000000001'
const WS_CLIENTE = '00000000-0000-4000-8000-000000000002'
const WS_AJENO = '00000000-0000-4000-8000-000000000003'
const EMP_CLIENTE = '00000000-0000-4000-8000-0000000000a1'
const EMP_AJENA = '00000000-0000-4000-8000-0000000000a2'
const NEG_CLIENTE = '00000000-0000-4000-8000-0000000000b1'
const NEG_AJENO = '00000000-0000-4000-8000-0000000000b2'
const SC_CLIENTE = '00000000-0000-4000-8000-0000000000c1'
const SC_AJENO = '00000000-0000-4000-8000-0000000000c2'
const SC_BENEF = '00000000-0000-4000-8000-0000000000c3'
const PERFIL = '00000000-0000-4000-8000-0000000000d1'

const SHA = (c: string) => c.repeat(64)

/**
 * Lo mínimo de producción que la migración toca. Las columnas son las que las funciones leen;
 * los tipos y los NOT NULL, los de la base real.
 */
const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como en produccion: toda funcion nace ejecutable por anon/authenticated.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false);

  create table public.workspaces (id uuid primary key, slug text);
  create table public.profiles (id uuid primary key, workspace_id uuid references public.workspaces(id));
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
    created_at timestamptz not null default now()
  );
  create table public.aceptaciones_terminos (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    nombre_aceptante text not null,
    calidad text not null,
    documento_sha256 text not null,
    prompt_wamid text,
    estado text not null,
    created_at timestamptz not null default now()
  );
  create table public.catalogo_servicios (
    slug text primary key,
    nombre text not null,
    modulo text not null,
    disparador_cobro text not null
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

  -- Stub: en produccion resuelve el workspace del JWT de la sesion.
  create function public.current_user_workspace_id() returns uuid
    language sql stable as $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;
`

const DATOS = `
  insert into public.workspaces (id, slug) values
    ('${WS_METRIK}', 'metrik'), ('${WS_CLIENTE}', 'cliente'), ('${WS_AJENO}', 'ajeno');
  insert into public.profiles (id, workspace_id) values ('${PERFIL}', '${WS_CLIENTE}');
  insert into public.empresas (id, nombre) values
    ('${EMP_CLIENTE}', 'Cliente SAS'), ('${EMP_AJENA}', 'Ajena SAS');
  insert into public.negocios (id, workspace_id, nombre) values
    ('${NEG_CLIENTE}', '${WS_METRIK}', 'X1 26 1 Paquete Valida API'),
    ('${NEG_AJENO}', '${WS_METRIK}', 'Z9 26 9 Contrato de otro');
  insert into public.catalogo_servicios (slug, nombre, modulo, disparador_cobro) values
    ('valida-api-bolsa', 'Paquete de consultas Valida API', 'valida_api', 'consumo'),
    ('licencia-clarity', 'Licencia Clarity', 'business', 'ciclo');

  -- El contrato del cliente: el workspace del cliente PAGA.
  insert into public.servicios_contratados
    (id, workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version,
     workspace_pagador_id, estado, vigente_desde)
  values
    ('${SC_CLIENTE}', '${WS_METRIK}', '${EMP_CLIENTE}', '${NEG_CLIENTE}', 'valida-api-bolsa', 1,
     '${WS_CLIENTE}', 'activo', date '2026-09-15');

  -- Un contrato de OTRO cliente, en el mismo workspace cobrador.
  insert into public.servicios_contratados
    (id, workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version,
     workspace_pagador_id, estado, vigente_desde)
  values
    ('${SC_AJENO}', '${WS_METRIK}', '${EMP_AJENA}', '${NEG_AJENO}', 'licencia-clarity', 1,
     '${WS_AJENO}', 'activo', date '2026-09-01');

  -- Un contrato que MeTRIK paga y que cubre al cliente como beneficiario.
  insert into public.servicios_contratados
    (id, workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version,
     workspace_pagador_id, estado, vigente_desde)
  values
    ('${SC_BENEF}', '${WS_METRIK}', '${EMP_CLIENTE}', '${NEG_AJENO}', 'licencia-clarity', 1,
     null, 'activo', date '2026-08-01');
  insert into public.servicio_contratado_beneficiarios (servicio_contratado_id, workspace_id)
  values ('${SC_BENEF}', '${WS_CLIENTE}');

  -- Cobros: uno pagado del cliente, uno ANULADO (monto 0, valor en monto_anulado), y uno del ajeno.
  insert into public.cobros (id, workspace_id, negocio_id, fecha, monto, fuente, notas, siigo_recibo) values
    ('00000000-0000-4000-8000-0000000000e1', '${WS_METRIK}', '${NEG_CLIENTE}', date '2026-09-14',
     1400000, 'bold', 'nota interna que el cliente no tiene por que ver',
     '{"numero":"RC-2026-09-001","origen":"manual","storage_path":"cliente/recibos/abc.pdf"}'::jsonb);
  insert into public.cobros (id, workspace_id, negocio_id, fecha, monto, monto_anulado, anulado_at, fuente) values
    ('00000000-0000-4000-8000-0000000000e2', '${WS_METRIK}', '${NEG_CLIENTE}', date '2026-09-10',
     0, 250000, now(), 'bold');
  insert into public.cobros (id, workspace_id, negocio_id, fecha, monto, fuente) values
    ('00000000-0000-4000-8000-0000000000e3', '${WS_METRIK}', '${NEG_AJENO}', date '2026-09-12', 999999, 'bold');
`

let db: PGlite

async function comoWorkspace<T>(ws: string | null, sql: string): Promise<T[]> {
  await db.exec(`set prueba.ws = '${ws ?? ''}';`)
  const r = await db.query<T>(sql)
  return r.rows
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(DATOS)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('mis_servicios(): el cliente ve lo suyo y nada más', () => {
  it('devuelve el contrato que paga y el que lo tiene como beneficiario, no el ajeno', async () => {
    const filas = await comoWorkspace<{ servicio_contratado_id: string; es_pagador: boolean }>(
      WS_CLIENTE,
      'select servicio_contratado_id, es_pagador from public.mis_servicios()',
    )
    const ids = filas.map((f) => f.servicio_contratado_id).sort()
    expect(ids).toEqual([SC_CLIENTE, SC_BENEF].sort())
    expect(filas.find((f) => f.servicio_contratado_id === SC_CLIENTE)?.es_pagador).toBe(true)
    expect(filas.find((f) => f.servicio_contratado_id === SC_BENEF)?.es_pagador).toBe(false)
  })

  it('una sesión sin workspace no ve nada (el valor ausente nunca autoriza)', async () => {
    const filas = await comoWorkspace(null, 'select servicio_contratado_id from public.mis_servicios()')
    expect(filas).toHaveLength(0)
  })

  it('no devuelve la comisión ni la empresa del cobrador', async () => {
    // Lo que se revisa es la firma de salida de la función: esa es la lista cerrada.
    const cols = await db.query<{ nombre: string }>(
      `select unnest(p.proargnames) as nombre from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'mis_servicios'`,
    )
    const nombres = cols.rows.map((c) => c.nombre)
    expect(nombres).not.toContain('comision')
    expect(nombres).not.toContain('empresa_id')
    expect(nombres).not.toContain('correo_facturacion')
  })
})

describe('mis_cobros_de_servicio(): solo quien paga ve la plata', () => {
  it('el pagador ve sus cobros con el valor real del anulado', async () => {
    const filas = await comoWorkspace<{ cobro_id: string; monto: string; estado: string }>(
      WS_CLIENTE,
      `select cobro_id, monto::text, estado from public.mis_cobros_de_servicio('${SC_CLIENTE}')`,
    )
    expect(filas).toHaveLength(2)
    const anulado = filas.find((f) => f.estado === 'anulado')
    // `monto` vale 0 en una fila anulada desde el 2026-08-11: mostrar el 0 sin decir que
    // está anulado sería mentir por omisión.
    expect(anulado?.monto).toBe('250000.00')
    expect(filas.find((f) => f.estado === 'pagado')?.monto).toBe('1400000.00')
  })

  it('el beneficiario que NO paga recibe cero cobros', async () => {
    const filas = await comoWorkspace(
      WS_CLIENTE,
      `select cobro_id from public.mis_cobros_de_servicio('${SC_BENEF}')`,
    )
    expect(filas).toHaveLength(0)
  })

  it('pedir el contrato de otro cliente devuelve vacío, no sus cobros', async () => {
    const filas = await comoWorkspace(
      WS_CLIENTE,
      `select cobro_id from public.mis_cobros_de_servicio('${SC_AJENO}')`,
    )
    expect(filas).toHaveLength(0)
  })

  it('no expone cobros.notas', async () => {
    const cols = await db.query<{ nombre: string }>(
      `select unnest(p.proargnames) as nombre from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'mis_cobros_de_servicio'`,
    )
    expect(cols.rows.map((c) => c.nombre)).not.toContain('notas')
  })
})

describe('mis_documentos_de_servicio(): el documento va con su constancia', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into public.documentos_contractuales_versiones
        (workspace_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256, vigente_desde)
      values
        ('${WS_METRIK}', 'terminos-uso-valida', 'cliente', '${EMP_CLIENTE}', 'Términos de Uso — VALIDA',
         'v1.0', '# Términos', '${SHA('b')}', 'cliente/terminos-v1.pdf', '${SHA('c')}', date '2026-09-15'),
        ('${WS_METRIK}', 'terminos-uso-valida', 'cliente', '${EMP_AJENA}', 'Términos de Uso — VALIDA',
         'v1.0', '# Términos de otro', '${SHA('d')}', 'ajena/terminos-v1.pdf', '${SHA('e')}', date '2026-09-15');
      insert into public.aceptaciones_terminos
        (id, workspace_id, nombre_aceptante, calidad, documento_sha256, prompt_wamid, estado)
      values
        ('00000000-0000-4000-8000-0000000000f1', '${WS_METRIK}', 'Juan Guillermo', 'apoderado',
         '${SHA('c')}', 'wamid.xxx', 'aceptado');
    `)
  })

  it('devuelve el documento de su empresa, con canal whatsapp, y no el de la otra', async () => {
    const filas = await comoWorkspace<{ pdf_sha256: string; aceptado_por: string; aceptado_canal: string }>(
      WS_CLIENTE,
      'select pdf_sha256, aceptado_por, aceptado_canal from public.mis_documentos_de_servicio()',
    )
    // Lo que importa primero: el documento de la OTRA empresa no aparece.
    expect(filas.map((f) => f.pdf_sha256)).not.toContain(SHA('e'))
    // Y el suyo aparece una sola vez aunque dos contratos lo cubran.
    expect(filas).toHaveLength(1)
    expect(filas[0].pdf_sha256).toBe(SHA('c'))
    expect(filas[0].aceptado_por).toBe('Juan Guillermo')
    expect(filas[0].aceptado_canal).toBe('whatsapp')
  })

  it('no expone el teléfono ni el wamid de la aceptación', async () => {
    const cols = await db.query<{ nombre: string }>(
      `select unnest(p.proargnames) as nombre from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'mis_documentos_de_servicio'`,
    )
    const nombres = cols.rows.map((c) => c.nombre)
    expect(nombres).not.toContain('telefono')
    expect(nombres).not.toContain('prompt_wamid')
    expect(nombres).not.toContain('payload_respuesta')
  })
})

describe('documentos_contractuales_versiones: lo firmado no se reescribe', () => {
  it('rechaza cambiar el texto de una versión', async () => {
    await expect(
      db.exec(`update public.documentos_contractuales_versiones
                  set texto_md = 'otra cosa' where pdf_sha256 = '${SHA('c')}'`),
    ).rejects.toThrow(/inmutable/)
  })

  it('rechaza borrarla', async () => {
    await expect(
      db.exec(`delete from public.documentos_contractuales_versiones where pdf_sha256 = '${SHA('c')}'`),
    ).rejects.toThrow(/inmutable/)
  })

  it('deja mover vigente_hasta: retirar de circulación no es negar que existió', async () => {
    await db.exec(`update public.documentos_contractuales_versiones
                      set vigente_hasta = date '2026-12-31' where pdf_sha256 = '${SHA('c')}'`)
    const r = await db.query<{ vigente_hasta: Date | null }>(
      `select vigente_hasta from public.documentos_contractuales_versiones where pdf_sha256 = '${SHA('c')}'`,
    )
    expect(r.rows[0].vigente_hasta).not.toBeNull()
  })

  it('rechaza alcance cliente sin empresa Y alcance plantilla con empresa', async () => {
    const sinEmpresa = `insert into public.documentos_contractuales_versiones
        (workspace_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256, vigente_desde)
      values ('${WS_METRIK}', 'x', 'cliente', null, 't', 'v1', 'm', '${SHA('1')}', 'p', '${SHA('2')}', current_date)`
    await expect(db.exec(sinEmpresa)).rejects.toThrow(/empresa_coherente/)

    const plantillaConEmpresa = `insert into public.documentos_contractuales_versiones
        (workspace_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256, vigente_desde)
      values ('${WS_METRIK}', 'y', 'plantilla', '${EMP_CLIENTE}', 't', 'v1', 'm', '${SHA('3')}', 'p', '${SHA('4')}', current_date)`
    await expect(db.exec(plantillaConEmpresa)).rejects.toThrow(/empresa_coherente/)
  })
})

describe('documentos_aceptaciones_usuario: una por usuario y versión', () => {
  const insertar = (version: string, extra: { documento_sha256?: string; aviso?: string | null } = {}) => {
    const aviso = extra.aviso === null ? 'null' : `'${extra.aviso ?? SHA('9')}'`
    const doc = extra.documento_sha256 === undefined ? 'null' : `'${extra.documento_sha256}'`
    return `insert into public.documentos_aceptaciones_usuario
      (workspace_id, usuario_id, documento_slug, documento_version, documento_sha256, aviso_texto_sha256)
      values ('${WS_CLIENTE}', '${PERFIL}', 'politica-datos-valida', '${version}', ${doc}, ${aviso})`
  }

  it('la segunda aceptación de la misma versión rebota', async () => {
    await db.exec(insertar('1.4'))
    await expect(db.exec(insertar('1.4'))).rejects.toThrow(/aceptaciones_usuario_unica|duplicate key/)
  })

  it('una versión nueva SÍ entra: es otro consentimiento', async () => {
    await db.exec(insertar('1.5'))
    const r = await db.query<{ n: string }>(
      `select count(*)::text as n from public.documentos_aceptaciones_usuario`,
    )
    expect(r.rows[0].n).toBe('2')
  })

  it('sin la huella del aviso no hay prueba de qué se aceptó: se rechaza', async () => {
    await expect(db.exec(insertar('1.6', { aviso: null }))).rejects.toThrow(/aviso_texto_sha256|not-null|null value/)
  })

  it('rechaza una huella que no es un sha256, en el documento y en el aviso', async () => {
    await expect(db.exec(insertar('2.0', { documento_sha256: 'no-es-una-huella' }))).rejects.toThrow(
      /aceptaciones_usuario_sha/,
    )
    await expect(db.exec(insertar('2.1', { aviso: 'tampoco' }))).rejects.toThrow(/aceptaciones_usuario_aviso_sha/)
  })
})

describe('nada nace concedido', () => {
  it('las dos tablas nuevas no son legibles por anon ni authenticated', async () => {
    for (const tabla of ['documentos_contractuales_versiones', 'documentos_aceptaciones_usuario']) {
      const r = await db.query<{ anon: boolean; auth: boolean }>(
        `select has_table_privilege('anon', 'public.${tabla}', 'select') as anon,
                has_table_privilege('authenticated', 'public.${tabla}', 'select') as auth`,
      )
      expect(r.rows[0], tabla).toEqual({ anon: false, auth: false })
    }
  })

  it('las dos tablas tienen RLS encendido', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in ('documentos_contractuales_versiones','documentos_aceptaciones_usuario')`,
    )
    expect(r.rows).toHaveLength(2)
    for (const fila of r.rows) expect(fila.relrowsecurity, fila.relname).toBe(true)
  })

  it('las tres RPC no las ejecuta anon, y sí authenticated', async () => {
    const firmas = [
      'public.mis_servicios()',
      'public.mis_cobros_de_servicio(uuid)',
      'public.mis_documentos_de_servicio()',
    ]
    for (const f of firmas) {
      const r = await db.query<{ anon: boolean; auth: boolean }>(
        `select has_function_privilege('anon', '${f}', 'execute') as anon,
                has_function_privilege('authenticated', '${f}', 'execute') as auth`,
      )
      // `revoke from anon` a secas NO basta: anon llega por PUBLIC. Por eso la migración
      // nombra a los dos, y esto es lo que lo comprueba.
      expect(r.rows[0], f).toEqual({ anon: false, auth: true })
    }
  })

  it('el trigger de inmutabilidad tampoco es ejecutable por nadie de fuera', async () => {
    const r = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.documentos_versiones_inmutables()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.documentos_versiones_inmutables()', 'execute') as auth`,
    )
    expect(r.rows[0]).toEqual({ anon: false, auth: false })
  })

  it('el bucket de documentos del cliente nace privado', async () => {
    const r = await db.query<{ public: boolean }>(
      `select public from storage.buckets where id = 'documentos-servicio'`,
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].public).toBe(false)
  })
})
