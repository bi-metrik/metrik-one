import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

/**
 * La carga de datos de los CDA (`sql/valida-cda/`), EJECUTADA contra las migraciones reales.
 *
 * Esos dos archivos no los corre ningún check y los aplica una persona sobre producción, así que lo
 * que prometen se prueba aquí: el bloque de cada CDA no corre sin persona designada, el ensayo no
 * deja nada escrito, la carga deja contrato + módulo + términos con la huella correcta, una segunda
 * corrida no duplica, y al final la persona designada (y solo ella) puede aceptar esos términos por
 * la guarda real de la base. La plantilla de enlaces deja el botón «Pagar» donde lo lee
 * `mis_cuotas_de_servicio`, y se niega a cargar un enlace ajeno a Bold o sobre una cuota pagada.
 *
 * Las constantes de cada CDA (espacios, empresas, negocios) se leen DEL ARCHIVO y se siembran con
 * esos mismos ids: si el archivo apunta a otra cosa, la prueba se cae en la guarda correspondiente.
 */

const RAIZ = process.cwd()
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
const migracion = (archivo: string) => leer(join('supabase/migrations', archivo))

const CARGA = leer('sql/valida-cda/2026-09-23_contratos-y-terminos-cdas.sql')
const PLANTILLA = leer('sql/valida-cda/plantilla-enlace-de-pago-cuota.sql')

const WS_METRIK = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const LINEA_VALIDA = '7d9f8994-a843-4032-a632-a6286ec61d94'
const MAURICIO = 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

interface Bloque {
  sql: string
  slug: string
  ws: string
  empresa: string
  nit: string
  negocio: string
  codigo: string
  owner: string
  designada: string
  plan: string
}

function constante(sql: string, nombre: string): string {
  const m = new RegExp(`${nombre}\\s+constant (?:uuid|text) := '([^']*)'`).exec(sql)
  if (!m) throw new Error(`el bloque no declara ${nombre}`)
  return m[1]
}

const BLOQUES: Bloque[] = [...CARGA.matchAll(/do \$bloque\$[\s\S]*?\$bloque\$;/g)].map((m, i) => {
  const sql = m[0]
  const n = (i + 1).toString(16).padStart(2, '0')
  return {
    sql,
    slug: constante(sql, 'c_slug_ws'),
    ws: constante(sql, 'c_ws_cda'),
    empresa: constante(sql, 'c_empresa'),
    nit: constante(sql, 'c_nit'),
    negocio: constante(sql, 'c_negocio'),
    codigo: constante(sql, 'c_codigo'),
    owner: `00000000-0000-4000-8000-0000000d00${n}`,
    designada: `00000000-0000-4000-8000-0000000e00${n}`,
    plan: `00000000-0000-4000-8000-0000000f00${n}`,
  }
})

/** El bloque con la designada puesta y, si se pide, fuera de ensayo. Cada reemplazo, una vez. */
function preparar(b: Bloque, o: { designada?: string | null; ensayo: boolean }): string {
  let sql = b.sql
  const reemplazar = (de: string, a: string) => {
    expect(sql.split(de).length - 1).toBe(1)
    sql = sql.replace(de, a)
  }
  if (o.designada !== null) reemplazar('c_designado constant uuid := null;', `c_designado constant uuid := '${o.designada ?? b.designada}';`)
  if (!o.ensayo) reemplazar('c_ensayo constant boolean := true;', 'c_ensayo constant boolean := false;')
  return sql
}

function plantilla(enlaces: unknown[], ensayo = false): string {
  let sql = PLANTILLA
  const de = "c_enlaces constant jsonb := '[]';"
  expect(sql.split(de).length - 1).toBe(1)
  sql = sql.replace(de, `c_enlaces constant jsonb := '${JSON.stringify(enlaces).replace(/'/g, "''")}';`)
  if (!ensayo) sql = sql.replace('c_ensayo constant boolean := true;', 'c_ensayo constant boolean := false;')
  return sql
}

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
    id uuid primary key,
    workspace_id uuid references public.workspaces(id),
    role text,
    full_name text,
    platform_admin boolean not null default false
  );
  create table public.empresas (
    id uuid primary key, workspace_id uuid references public.workspaces(id),
    nombre text, razon_social text, numero_documento text
  );
  create table public.lineas_negocio (id uuid primary key, nombre text);
  create table public.negocios (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    empresa_id uuid references public.empresas(id),
    linea_id uuid references public.lineas_negocio(id),
    codigo text,
    nombre text
  );
  create table public.cobros (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid references public.negocios(id),
    fecha date,
    fecha_esperada date,
    monto numeric(15,2) not null default 0,
    monto_anulado numeric(15,2),
    fuente text,
    anulado_at timestamptz,
    notas text,
    siigo_recibo jsonb,
    plan_cobro_id uuid,
    numero_cuota integer,
    tipo_cobro text,
    revisado boolean not null default false,
    retencion numeric not null default 0,
    vencido boolean not null default false,
    created_at timestamptz not null default now()
  );
  create unique index idx_cobros_plan_cuota_unique on public.cobros (plan_cobro_id, numero_cuota)
    where plan_cobro_id is not null and numero_cuota is not null;
  create table public.planes_cobro (
    id uuid primary key,
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid not null references public.negocios(id),
    total_cuotas integer not null,
    activo boolean not null default false,
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
  create table public.wa_message_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid references public.workspaces(id),
    phone text not null,
    direction text not null,
    intent text,
    message_preview text,
    created_at timestamptz default now()
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

  insert into public.workspaces (id, slug) values ('${WS_METRIK}', 'metrik');
  insert into public.profiles (id, workspace_id, role, full_name, platform_admin)
    values ('${MAURICIO}', '${WS_METRIK}', 'owner', 'Mauricio', true);
  insert into public.lineas_negocio (id, nombre) values ('${LINEA_VALIDA}', 'Valida');
`

function sembrarCda(b: Bloque): string {
  return `
    insert into public.workspaces (id, slug, modules) values ('${b.ws}', '${b.slug}', '{"valida_consulta": true}');
    insert into public.profiles (id, workspace_id, role, full_name) values
      ('${b.owner}', '${b.ws}', 'owner', 'Oficial de Cumplimiento'),
      ('${b.designada}', '${b.ws}', 'operator', 'Representante ${b.slug}');
    insert into public.empresas (id, workspace_id, nombre, razon_social, numero_documento)
      values ('${b.empresa}', '${WS_METRIK}', '${b.slug}', 'RAZON ${b.slug}', '${b.nit}');
    insert into public.negocios (id, workspace_id, empresa_id, linea_id, codigo, nombre)
      values ('${b.negocio}', '${WS_METRIK}', '${b.empresa}', '${LINEA_VALIDA}', '${b.codigo}', 'Valida CDA — ${b.slug}');
    insert into public.planes_cobro (id, workspace_id, negocio_id, total_cuotas)
      values ('${b.plan}', '${WS_METRIK}', '${b.negocio}', 2);
    insert into public.plan_cobro_cuotas (workspace_id, plan_cobro_id, numero, monto, fecha_vencimiento, concepto_detalle) values
      ('${WS_METRIK}', '${b.plan}', 1, 150000, date '2026-09-30', 'Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026'),
      ('${WS_METRIK}', '${b.plan}', 2, 150000, date '2026-10-27', 'Licencia VALIDA · Starter — periodo del 23/10/2026 al 22/11/2026');
  `
}

let db: PGlite

/** Corre `sql`; devuelve el mensaje de error o '' si pasó. No deshace: para eso está `ensayo`. */
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
  for (const b of BLOQUES) await db.exec(sembrarCda(b))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('el archivo de carga', () => {
  it('trae un bloque por cada uno de los 4 CDA, con sus constantes', () => {
    expect(BLOQUES.map((b) => b.slug)).toEqual(['cda-caqueta', 'cda-elcarmen', 'cda-puertotest', 'maxitec'])
    expect(new Set(BLOQUES.map((b) => b.ws)).size).toBe(4)
    expect(new Set(BLOQUES.map((b) => b.negocio)).size).toBe(4)
  })

  it('nace en ensayo y sin persona designada', () => {
    for (const b of BLOQUES) {
      expect(b.sql).toContain('c_ensayo constant boolean := true;')
      expect(b.sql).toContain('c_designado constant uuid := null;')
    }
  })
})

describe('sin persona designada no carga nada', () => {
  it('cada bloque aborta y no escribe', async () => {
    for (const b of BLOQUES) {
      const error = await correr(preparar(b, { designada: null, ensayo: false }))
      expect(error).toContain('falta la persona designada')
    }
    expect(await contar('public.servicios_contratados')).toBe(0)
    expect(await contar('public.documentos_contractuales_versiones')).toBe(0)
  })

  it('una designada de OTRO espacio tampoco sirve', async () => {
    const [caqueta, elcarmen] = BLOQUES
    const error = await correr(preparar(caqueta, { designada: elcarmen.designada, ensayo: false }))
    expect(error).toContain('no está en el espacio del CDA')
    expect(await contar('public.servicios_contratados')).toBe(0)
  })

  it('ni el soporte de MeTRIK', async () => {
    const error = await correr(preparar(BLOQUES[0], { designada: MAURICIO, ensayo: false }))
    expect(error).toContain('no está en el espacio del CDA')
  })
})

describe('el ensayo', () => {
  it('llega al final y no deja nada escrito', async () => {
    for (const b of BLOQUES) {
      const error = await correr(preparar(b, { ensayo: true }))
      expect(error).toContain(`ENSAYO OK ${b.slug}`)
      expect(error).toContain('Nada quedó escrito')
    }
    expect(await contar('public.servicios_contratados')).toBe(0)
    expect(await contar('public.servicios_contratados_cambios')).toBe(0)
    expect(await contar('public.workspace_modulos')).toBe(0)
    expect(await contar('public.documentos_contractuales_versiones')).toBe(0)
  })
})

describe('la carga', () => {
  beforeAll(async () => {
    for (const b of BLOQUES) {
      const error = await correr(preparar(b, { ensayo: false }))
      expect(error).toBe('')
    }
  })

  it('deja un contrato activo por CDA, pagado por su espacio, con su designada', async () => {
    const filas = await db.query<{ slug: string; pagador: string; designado: string; estado: string; precio: number }>(`
      select w.slug, sc.workspace_pagador_id as pagador, sc.aceptante_designado_id as designado, sc.estado,
             (sc.parametros->>'precio_mensual')::int as precio
        from public.servicios_contratados sc join public.workspaces w on w.id = sc.workspace_pagador_id
       order by w.slug`)
    expect(filas.rows).toEqual(
      BLOQUES.map((b) => ({ slug: b.slug, pagador: b.ws, designado: b.designada, estado: 'activo', precio: 150000 })),
    )
    expect(await contar('public.servicios_contratados_cambios', "campo = 'alta'")).toBe(4)
  })

  it('el módulo queda con su contrato y la proyección no cambia ningún espacio', async () => {
    expect(await contar('public.workspace_modulos', "modulo = 'valida_consulta' and origen = 'servicio' and servicio_contratado_id is not null")).toBe(4)
    for (const b of BLOQUES) {
      const r = await db.query<{ cambios: unknown[] }>(`select public.proyectar_modulos('${b.ws}')->'cambios' as cambios`)
      expect(r.rows[0].cambios).toEqual([])
    }
  })

  it('los términos de cada empresa llevan su texto, y la huella es la de ese texto', async () => {
    const docs = await db.query<{ empresa_id: string; texto_md: string; texto_sha256: string; version: string; pdf_path: string }>(
      `select empresa_id, texto_md, texto_sha256, version, pdf_path from public.documentos_contractuales_versiones`,
    )
    expect(docs.rows).toHaveLength(4)
    for (const b of BLOQUES) {
      const d = docs.rows.find((x) => x.empresa_id === b.empresa)!
      expect(d.version).toBe('v1.1')
      expect(d.pdf_path).toBe(`${b.slug}/terminos-suscripcion-valida-cda-v1.1.pdf`)
      expect(sha256(d.texto_md)).toBe(d.texto_sha256)
      expect(d.texto_md.startsWith('# TÉRMINOS DE SUSCRIPCIÓN VALIDA · LICENCIA CDA v1.1\n\n')).toBe(true)
      // Cada CDA con SUS datos, sin campos por llenar ni marcas internas de redacción.
      const nitConPuntos = b.nit.replace(/^(\d{3})(\d{3})(\d{3})-(\d)$/, '$1.$2.$3-$4')
      expect(d.texto_md).toContain(`NIT ${nitConPuntos}`)
      expect(d.texto_md).toContain(`${b.slug}.metrikone.co`)
      expect(d.texto_md).not.toMatch(/\{\{|\}\}|⚠|`|> \*\*Estado/)
      // Párrafos en una línea: el lector de ONE pinta cada salto de línea.
      expect(d.texto_md.split('\n\n').every((p) => !p.includes('\n'))).toBe(true)
    }
  })

  it('una segunda corrida no duplica: se detiene', async () => {
    const error = await correr(preparar(BLOQUES[0], { ensayo: false }))
    expect(error).toContain('ya tiene contrato')
    expect(await contar('public.servicios_contratados')).toBe(4)
  })

  it('el CDA ve sus términos y solo la persona designada puede aceptarlos', async () => {
    const b = BLOQUES[0]
    const [doc] = await comoCliente<{ documento_id: string; pdf_sha256: string; titulo: string; version: string }>(
      b.ws,
      `select documento_id, pdf_sha256, titulo, version from public.mis_documentos_de_servicio()`,
    )
    expect(doc.version).toBe('v1.1')
    const texto = await db.query<{ texto_sha256: string }>(
      `select texto_sha256 from public.documentos_contractuales_versiones where id = '${doc.documento_id}'`,
    )

    const aceptar = (usuario: string) => `
      insert into public.aceptaciones_terminos (
        workspace_id, negocio_id, canal, estado, nombre_aceptante, cedula_aceptante, calidad,
        empresa_nombre, empresa_nit, usuario_id, workspace_cliente_id, documento_version_id,
        documento_titulo, documento_version, documento_sha256, texto_documento_sha256,
        texto_aceptacion, ip, user_agent
      ) values (
        '${WS_METRIK}', '${b.negocio}', 'modulo', 'aceptado', 'Alba Yurany Rosas Escandón', '40123456',
        'representante_legal', 'RAZON ${b.slug}', '${b.nit}', '${usuario}', '${b.ws}', '${doc.documento_id}',
        '${doc.titulo}', 'v1.1', '${doc.pdf_sha256}', '${texto.rows[0].texto_sha256}',
        'Yo, Alba Yurany Rosas Escandón, identificado(a) con cédula 40123456, ACEPTO (huella SHA-256 del PDF: ${doc.pdf_sha256}).',
        '190.24.1.10', 'Mozilla/5.0'
      )`

    await db.exec('begin')
    try {
      const deOwner = await correr(aceptar(b.owner))
      expect(deOwner).toContain('la persona que la empresa designó')
    } finally {
      await db.exec('rollback')
    }
    expect(await correr(aceptar(b.designada))).toBe('')
    expect(await contar('public.aceptaciones_terminos', `usuario_id = '${b.designada}' and canal = 'modulo'`)).toBe(1)
  })
})

describe('plazo para aceptar y facturas de cada cuota (20260924010000)', () => {
  it('cada contrato nace con plazo hasta el 30-sep y el CDA lo lee por mis_servicios', async () => {
    const plazos = await db.query<{ plazo: string }>(
      `select terminos_plazo_hasta::text as plazo from public.servicios_contratados order by id`,
    )
    expect(plazos.rows.map((r) => r.plazo)).toEqual(['2026-09-30', '2026-09-30', '2026-09-30', '2026-09-30'])
    const b = BLOQUES[1]
    const servicios = await comoCliente<{ modulo: string; terminos_plazo_hasta: string; es_pagador: boolean }>(
      b.ws,
      `select modulo, terminos_plazo_hasta::text as terminos_plazo_hasta, es_pagador from public.mis_servicios()`,
    )
    expect(servicios).toEqual([{ modulo: 'valida_consulta', terminos_plazo_hasta: '2026-09-30', es_pagador: true }])
  })

  it('la factura cargada sale con su cuota, solo al pagador y solo la del mismo cobrador', async () => {
    const b = BLOQUES[1]
    const sc = await db.query<{ id: string }>(`select id from public.servicios_contratados where workspace_pagador_id = '${b.ws}'`)
    const cuota = await db.query<{ id: string }>(`select id from public.plan_cobro_cuotas where plan_cobro_id = '${b.plan}' and numero = 1`)
    await db.exec(`
      insert into public.facturas_cuota (workspace_id, plan_cobro_cuota_id, numero, pdf_path, pdf_sha256)
      values ('${WS_METRIK}', '${cuota.rows[0].id}', 'FE-1', '${WS_METRIK}/facturas/${'b'.repeat(64)}.pdf', '${'b'.repeat(64)}')`)

    const filas = await comoCliente<{ cuota_id: string; numero: number; factura_numero: string | null; factura_pdf_path: string | null; factura_xml_path: string | null }>(
      b.ws,
      `select cuota_id, numero, factura_numero, factura_pdf_path, factura_xml_path from public.mis_cuotas_de_servicio('${sc.rows[0].id}')`,
    )
    expect(filas).toEqual([
      { cuota_id: cuota.rows[0].id, numero: 1, factura_numero: 'FE-1', factura_pdf_path: `${WS_METRIK}/facturas/${'b'.repeat(64)}.pdf`, factura_xml_path: null },
      expect.objectContaining({ numero: 2, factura_numero: null }),
    ])
    // Otro espacio no ve las cuotas (ni la factura) de este contrato.
    expect(await comoCliente(BLOQUES[0].ws, `select * from public.mis_cuotas_de_servicio('${sc.rows[0].id}')`)).toEqual([])
  })

  it('la factura exige un archivo, su huella con su ruta y un número limpio', async () => {
    const cuota = await db.query<{ id: string }>(`select id from public.plan_cobro_cuotas where plan_cobro_id = '${BLOQUES[2].plan}' and numero = 1`)
    const insertar = (cols: string, vals: string) =>
      correr(`insert into public.facturas_cuota (workspace_id, plan_cobro_cuota_id, numero${cols}) values ('${WS_METRIK}', '${cuota.rows[0].id}'${vals})`)
    expect(await insertar('', `, 'FE-2'`)).toContain('facturas_cuota_algun_archivo')
    expect(await insertar(', pdf_path', `, 'FE-2', 'x.pdf'`)).toContain('facturas_cuota_pdf_completo')
    expect(await insertar(', xml_path, xml_sha256', `, 'FE 2; drop', 'x.xml', '${'c'.repeat(64)}'`)).toContain('facturas_cuota_numero')
  })

  it('grants: las RPC solo para authenticated (ni anon ni PUBLIC) y la tabla para nadie', async () => {
    const r = await db.query<{ f: string; anon: boolean; auth: boolean; publico: boolean }>(`
      select p.oid::regprocedure::text as f,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             coalesce(p.proacl::text like '%,=X/%' or p.proacl::text like '{=X/%', false) as publico
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('mis_servicios', 'mis_cuotas_de_servicio')
       order by 1`)
    expect(r.rows).toEqual([
      { f: 'mis_cuotas_de_servicio(uuid)', anon: false, auth: true, publico: false },
      { f: 'mis_servicios()', anon: false, auth: true, publico: false },
    ])
    const t = await db.query<{ anon: boolean; auth: boolean; rls: boolean }>(`
      select has_table_privilege('anon', 'public.facturas_cuota', 'select') as anon,
             has_table_privilege('authenticated', 'public.facturas_cuota', 'select') as auth,
             relrowsecurity as rls
        from pg_class where oid = 'public.facturas_cuota'::regclass`)
    expect(t.rows).toEqual([{ anon: false, auth: false, rls: true }])
  })
})

describe('la plantilla de enlaces de pago', () => {
  const futuro = new Date(Date.now() + 7 * 86_400_000).toISOString()
  const bold = 'https://checkout.bold.co/payment/LNK_PRUEBA'

  it('vacía no corre', async () => {
    expect(await correr(PLANTILLA)).toContain('c_enlaces está vacío')
  })

  it('el ensayo no deja nada', async () => {
    const error = await correr(plantilla([{ espacio: 'cda-caqueta', cuota: 1, url: bold, expira: futuro }], true))
    expect(error).toContain('ENSAYO OK: 1 cobros programados nuevos')
    expect(await contar('public.cobros')).toBe(0)
  })

  it('crea el cobro programado de la cuota con el enlace, y el CDA lo ve en su cuota', async () => {
    expect(await correr(plantilla([{ espacio: 'cda-caqueta', cuota: 1, url: bold, expira: futuro }]))).toBe('')
    const b = BLOQUES[0]
    const cobro = await db.query<{ monto: string; fecha_esperada: string; tipo_cobro: string; fecha: string | null }>(
      `select monto::text, fecha_esperada::text, tipo_cobro, fecha from public.cobros where plan_cobro_id = '${b.plan}' and numero_cuota = 1`,
    )
    expect(cobro.rows).toEqual([{ monto: '150000.00', fecha_esperada: '2026-09-30', tipo_cobro: 'programado', fecha: null }])

    const sc = await db.query<{ id: string }>(`select id from public.servicios_contratados where workspace_pagador_id = '${b.ws}'`)
    const cuotas = await comoCliente<{ numero: number; enlace_pago_url: string | null }>(
      b.ws,
      `select numero, enlace_pago_url from public.mis_cuotas_de_servicio('${sc.rows[0].id}')`,
    )
    expect(cuotas).toEqual([
      { numero: 1, enlace_pago_url: bold },
      { numero: 2, enlace_pago_url: null },
    ])
  })

  it('cargar otra vez la misma cuota cambia el enlace, no crea otro cobro', async () => {
    const nuevo = 'https://checkout.bold.co/payment/LNK_NUEVO'
    const error = await correr(plantilla([{ espacio: 'cda-caqueta', cuota: 1, url: nuevo, expira: futuro }]))
    expect(error).toBe('')
    const r = await db.query<{ enlace_pago_url: string }>(`select enlace_pago_url from public.cobros`)
    expect(r.rows).toEqual([{ enlace_pago_url: nuevo }])
  })

  it('rechaza un enlace que no es de Bold, uno disfrazado y uno vencido', async () => {
    const fila = (url: string, expira = futuro) => [{ espacio: 'cda-elcarmen', cuota: 1, url, expira }]
    expect(await correr(plantilla(fila('https://pagos.otro.co/x')))).toContain('no es de Bold')
    expect(await correr(plantilla(fila('https://bold.co@otro.sitio/x')))).toContain('no es de Bold')
    expect(await correr(plantilla(fila('https://bold.co.otro.sitio/x')))).toContain('no es de Bold')
    expect(await correr(plantilla(fila('https://usuario@checkout.bold.co/x')))).toContain('no es de Bold')
    expect(await correr(plantilla(fila('http://checkout.bold.co/x')))).toContain('no es de Bold')
    expect(await correr(plantilla(fila(bold, '2020-01-01T00:00:00Z')))).toContain('ya venció')
    expect(await contar('public.cobros', `numero_cuota = 1 and plan_cobro_id = '${BLOQUES[1].plan}'`)).toBe(0)
  })

  it('no carga un enlace sobre una cuota ya pagada', async () => {
    await db.exec(`update public.cobros set fecha = date '2026-09-25' where plan_cobro_id = '${BLOQUES[0].plan}' and numero_cuota = 1`)
    const error = await correr(plantilla([{ espacio: 'cda-caqueta', cuota: 1, url: bold, expira: futuro }]))
    expect(error).toContain('ya está pagada')
  })
})
