import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { planDeActivacion, type CuotaParaActivar } from './plan-anual'

/**
 * La migración del Plan Anual (20261007090000), ejecutada de verdad en PGlite sobre las de las que
 * depende (catálogo y contratos, licencias). Las tablas de fuera (`workspaces`, `planes_cobro`,
 * `plan_cobro_cuotas`, `cobros`, …) se crean con lo mínimo, pero `plan_cobro_cuotas` con sus CHECK
 * originales SIN nombre (como en 20260630000001 y 20260924100000), que es lo que la migración tiene que
 * encontrar y reemplazar.
 *
 * Lo que se fija: los tipos y el monto en cero de las cuotas, la activación con lo que calcula
 * `planDeActivacion` (y lo que RECHAZA: una cuota que cambió, un cobro sin pagar, una cuota nueva con
 * monto), el retiro de un usuario adicional que deja en cero su cuota, la inmutabilidad de la
 * constancia y los permisos.
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
const C1 = '00000000-0000-4000-8000-000000000021'
const C2 = '00000000-0000-4000-8000-000000000022'
const C_ANUAL = '00000000-0000-4000-8000-000000000029'

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
    id uuid primary key default gen_random_uuid(), workspace_id uuid, plan_cobro_id uuid references public.planes_cobro(id),
    numero integer not null,
    tipo text not null default 'cuota' check (tipo in ('anticipo','cuota')),
    monto numeric not null check (monto > 0),
    fecha_vencimiento date not null, concepto_detalle text, updated_at timestamptz default now(),
    unique (plan_cobro_id, numero)
  );
  alter table public.plan_cobro_cuotas add column iva numeric(15,2) not null default 0;
  alter table public.plan_cobro_cuotas add constraint plan_cobro_cuotas_iva_rango check (iva >= 0 and iva < monto);
  create table public.cobros (
    id uuid primary key default gen_random_uuid(), workspace_id uuid, negocio_id uuid, plan_cobro_id uuid, numero_cuota integer,
    monto numeric, fecha date, anulado_at timestamptz, tipo_cobro text, notas text, fecha_esperada date
  );
  create unique index idx_cobros_plan_cuota_unique on public.cobros (plan_cobro_id, numero_cuota)
    where plan_cobro_id is not null and numero_cuota is not null;

  insert into public.workspaces (id, slug, max_seats) values ('${WS}', 'metrik', 5), ('${WS_CDA}', 'cda-x', 3);
  insert into public.profiles (id) values ('${PERFIL}');
  insert into public.empresas (id, nombre) values ('${EMPRESA}', 'CDA X');
  insert into public.negocios (id, codigo) values ('${NEGOCIO}', 'C1 26 1');
  insert into public.planes_cobro (id, workspace_id, negocio_id) values ('${PLAN}', '${WS}', '${NEGOCIO}');
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

const PLAZO = { desde: '2026-10-23', hasta: '2027-10-22' }

/** El plan de los CDA: cuota 1 pagada, la 2 (oct) con su enlace sin pagar, la 3 (nov) con un usuario adicional. */
async function sembrar() {
  await db.exec(`
    -- TRUNCATE y no DELETE: la constancia y la bitácora del contrato no se dejan borrar fila a fila.
    truncate public.planes_anuales_cda, public.licencias_adicionales_cargos, public.licencias_adicionales,
             public.servicios_contratados_cambios, public.cobros, public.plan_cobro_cuotas;
    insert into public.plan_cobro_cuotas (id, workspace_id, plan_cobro_id, numero, monto, fecha_vencimiento, concepto_detalle) values
      ('${Q1}', '${WS}', '${PLAN}', 1, 150000, '2026-09-30', 'Suscripción — periodo del 23/09/2026 al 22/10/2026'),
      ('${Q2}', '${WS}', '${PLAN}', 2, 150000, '2026-10-30', 'Suscripción — periodo del 23/10/2026 al 22/11/2026'),
      ('${Q3}', '${WS}', '${PLAN}', 3, 200000, '2026-11-30', 'Suscripción — periodo del 23/11/2026 al 22/12/2026 · Incluye: 1 usuario adicional');
    insert into public.cobros (id, workspace_id, negocio_id, plan_cobro_id, numero_cuota, monto, fecha, tipo_cobro) values
      ('${C1}', '${WS}', '${NEGOCIO}', '${PLAN}', 1, 150000, '2026-09-29', 'programado'),
      ('${C2}', '${WS}', '${NEGOCIO}', '${PLAN}', 2, 150000, null, 'programado'),
      ('${C_ANUAL}', '${WS}', '${NEGOCIO}', '${PLAN}', null, 1650000, '2026-10-10', 'programado');
  `)
  const cambio = await db.query<{ id: string }>(
    `insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
     values ($1, 'licencias', '{}'::jsonb, '{}'::jsonb, 'compra', $2) returning id`,
    [SC, PERFIL],
  )
  const lic = await db.query<{ id: string }>(
    `insert into public.licencias_adicionales (servicio_contratado_id, valor_mensual, fecha_compra, comprada_por, cambio_compra_id)
     values ($1, 50000, '2026-10-01', $2, $3) returning id`,
    [SC, PERFIL, cambio.rows[0].id],
  )
  await db.query(
    `insert into public.licencias_adicionales_cargos (licencia_id, plan_cobro_cuota_id, tipo, periodo_desde, periodo_hasta, dias, dias_periodo, monto)
     values ($1, '${Q3}', 'periodo', '2026-11-23', '2026-12-22', 30, 30, 50000)`,
    [lic.rows[0].id],
  )
  const pa = await db.query<{ id: string }>(
    `insert into public.planes_anuales_cda (workspace_id, workspace_cliente_id, servicio_contratado_id, negocio_id, plan_cobro_id,
       periodo_desde, periodo_hasta, monto, precio_lista, documento_slug, documento_version, documento_texto_sha256,
       texto_anexo, texto_anexo_sha256, texto_aceptacion, texto_aceptacion_sha256, usuario_id, nombre_aceptante,
       tipo_documento, numero_documento, cobro_id)
     values ('${WS}', '${WS_CDA}', $1, '${NEGOCIO}', '${PLAN}', '2026-10-23', '2027-10-22', 1650000, 1800000,
       'anexo-plan-anual-valida-cda', 'v1', $2, 'ANEXO', $2, 'Yo acepto', $2, '${PERFIL}', 'Ana Pérez', 'CC', '12345678', '${C_ANUAL}')
     returning id`,
    [SC, 'a'.repeat(64)],
  )
  return { planAnualId: pa.rows[0].id, licenciaId: lic.rows[0].id }
}

/** Lo que el servidor calcula para ese plan (`planDeActivacion`), en la forma de la función. */
function cambiosDelServidor() {
  const c = (id: string, numero: number, monto: number, venc: string, concepto: string, over: Partial<CuotaParaActivar> = {}): CuotaParaActivar => ({
    id, numero, tipo: 'cuota', monto, fechaVencimiento: venc, concepto, cobroVivo: null, conPlata: false, cargos: [], ...over,
  })
  const r = planDeActivacion({
    plazo: PLAZO,
    vigenteDesde: '2026-09-23',
    fechaPago: '2026-10-10',
    hayCuotasVencidas: false,
    cuotas: [
      c(Q1, 1, 150000, '2026-09-30', 'Suscripción — periodo del 23/09/2026 al 22/10/2026', { conPlata: true, cobroVivo: { id: C1, pagado: true } }),
      c(Q2, 2, 150000, '2026-10-30', 'Suscripción — periodo del 23/10/2026 al 22/11/2026', { cobroVivo: { id: C2, pagado: false } }),
      c(Q3, 3, 200000, '2026-11-30', 'Suscripción — periodo del 23/11/2026 al 22/12/2026', {
        cargos: [{ tipo: 'periodo', periodoDesde: '2026-11-23', periodoHasta: '2026-12-22', dias: 30, diasPeriodo: 30, monto: 50000 }],
      }),
    ],
  })
  if (!r.ok) throw new Error(r.motivo)
  return {
    actualizar: r.actualizar.map((x) => ({ id: x.id, monto_esperado: x.montoEsperado, tipo_esperado: x.tipoEsperado, monto: x.monto, concepto: x.concepto })),
    insertar: r.insertar.map((x) => ({ numero: x.numero, tipo: x.tipo, monto: x.monto, fecha_vencimiento: x.fechaVencimiento, concepto: x.concepto })),
    anular_cobros: r.anularCobros,
    cuota_anual: {
      numero: r.cuotaAnual.numero,
      tipo: r.cuotaAnual.tipo,
      monto: r.cuotaAnual.monto,
      fecha_vencimiento: r.cuotaAnual.fechaVencimiento,
      concepto: r.cuotaAnual.concepto,
    },
  }
}

const ACTIVAR = `select public.activar_plan_anual_cda($1, $2, $3::jsonb) as r`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer('20260915210000_workspace_modulos.sql'))
  await db.exec(leer('20260916120000_catalogo_y_servicios_contratados.sql'))
  await db.exec(leer('20260924060000_suscripcion_cda_licencias_usuarios_comision.sql'))
  await db.exec(leer('20261007090000_valida_cda_plan_anual.sql'))
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
            '{"precio_mensual":150000,"licencias":3,"valor_usuario_adicional":50000}'::jsonb, '${WS_CDA}', 'activo', '2026-09-23')
    returning id`)
  SC = r.rows[0].id
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('las cuotas admiten el plan anual', () => {
  it('reemplaza los CHECK sin nombre de tipo y monto, y el del IVA', async () => {
    const r = await db.query<{ conname: string }>(
      `select conname from pg_constraint where conrelid = 'public.plan_cobro_cuotas'::regclass and contype = 'c' order by 1`,
    )
    expect(r.rows.map((x) => x.conname)).toEqual(['plan_cobro_cuotas_iva_rango', 'plan_cobro_cuotas_monto', 'plan_cobro_cuotas_tipo'])
  })

  it('una cuota de usuarios adicionales puede valer cero; una cuota del servicio no', async () => {
    const ins = (tipo: string, monto: number, numero: number) =>
      falla(
        `insert into public.plan_cobro_cuotas (workspace_id, plan_cobro_id, numero, tipo, monto, fecha_vencimiento) values ('${WS}', '${PLAN}', $1, $2, $3, '2027-01-30')`,
        [numero, tipo, monto],
      )
    expect(await ins('usuarios_adicionales', 0, 90)).toBeNull()
    expect(await ins('cuota', 0, 91)).toMatch(/plan_cobro_cuotas_monto/)
    expect(await ins('anual', 0, 92)).toMatch(/plan_cobro_cuotas_monto/)
    expect(await ins('usuarios_adicionales', -1, 93)).toMatch(/plan_cobro_cuotas_(monto|iva_rango)/)
    expect(await ins('mensual', 100, 94)).toMatch(/plan_cobro_cuotas_tipo/)
    expect(await ins('anual', 1650000, 95)).toBeNull()
    await db.exec(`delete from public.plan_cobro_cuotas where numero >= 90`)
  })
})

describe('activar el plan anual', () => {
  let ids: { planAnualId: string; licenciaId: string }
  beforeEach(async () => {
    ids = await sembrar()
  })

  it('aplica lo que calcula el servidor, en una transacción', async () => {
    const r = await db.query<{ r: string }>(ACTIVAR, [ids.planAnualId, C_ANUAL, JSON.stringify(cambiosDelServidor())])
    expect(r.rows[0].r).toBe('activado')

    const cuotas = await db.query<{ numero: number; tipo: string; monto: string; fecha_vencimiento: string }>(
      `select numero, tipo, monto::text, fecha_vencimiento::text from public.plan_cobro_cuotas order by numero`,
    )
    const filas = cuotas.rows.map((x) => [x.numero, x.tipo, Number(x.monto)])
    expect(filas.slice(0, 3)).toEqual([
      [1, 'cuota', 150000],
      [2, 'usuarios_adicionales', 0],
      [3, 'usuarios_adicionales', 50000],
    ])
    expect(filas.filter((f) => f[1] === 'usuarios_adicionales')).toHaveLength(12)
    expect(filas[filas.length - 1]).toEqual([14, 'anual', 1650000])
    expect(cuotas.rows[cuotas.rows.length - 1].fecha_vencimiento).toBe('2026-10-09')

    const cobros = await db.query<{ id: string; numero_cuota: number | null; anulado: boolean }>(
      `select id, numero_cuota, anulado_at is not null as anulado from public.cobros order by id`,
    )
    expect(cobros.rows).toEqual([
      { id: C1, numero_cuota: 1, anulado: false },
      // El enlace mensual de octubre, sin pagar: anulado.
      { id: C2, numero_cuota: 2, anulado: true },
      // El pago del anual, atado a su cuota.
      { id: C_ANUAL, numero_cuota: 14, anulado: false },
    ])
    const pa = await db.query<{ estado: string; fecha_pago: string }>(
      `select estado, fecha_pago::text from public.planes_anuales_cda where id = $1`,
      [ids.planAnualId],
    )
    expect(pa.rows[0]).toEqual({ estado: 'activo', fecha_pago: '2026-10-10' })

    // Idempotente: el reintento del webhook no hace nada.
    const otra = await db.query<{ r: string }>(ACTIVAR, [ids.planAnualId, C_ANUAL, JSON.stringify(cambiosDelServidor())])
    expect(otra.rows[0].r).toBe('ya_activo')
  })

  it('rechaza si una cuota cambió desde que el servidor la leyó (y no escribe nada)', async () => {
    await db.exec(`update public.plan_cobro_cuotas set monto = 160000 where id = '${Q2}'`)
    expect(await falla(ACTIVAR, [ids.planAnualId, C_ANUAL, JSON.stringify(cambiosDelServidor())])).toMatch(/cuota_cambio/)
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.plan_cobro_cuotas`)
    expect(n.rows[0].n).toBe(3)
  })

  it('rechaza si una cuota del plazo tiene un cobro PAGADO', async () => {
    await db.exec(`update public.cobros set fecha = '2026-10-05' where id = '${C2}'`)
    expect(await falla(ACTIVAR, [ids.planAnualId, C_ANUAL, JSON.stringify(cambiosDelServidor())])).toMatch(/cuota_con_cobro/)
  })

  it('rechaza si el cobro del plan no está pagado', async () => {
    await db.exec(`update public.cobros set fecha = null where id = '${C_ANUAL}'`)
    expect(await falla(ACTIVAR, [ids.planAnualId, C_ANUAL, JSON.stringify(cambiosDelServidor())])).toMatch(/no está pagado/)
  })

  it('rechaza una cuota de usuarios adicionales que no vale lo que suman sus cargos', async () => {
    const c = cambiosDelServidor()
    c.actualizar = c.actualizar.map((x) => (x.id === Q3 ? { ...x, monto: 0 } : x))
    expect(await falla(ACTIVAR, [ids.planAnualId, C_ANUAL, JSON.stringify(c)])).toMatch(/cargos de licencias suman/)
  })

  it('rechaza una cuota nueva que no nazca en cero, y una cuota anual por otro monto', async () => {
    const c = cambiosDelServidor()
    expect(
      await falla(ACTIVAR, [ids.planAnualId, C_ANUAL, JSON.stringify({ ...c, insertar: [{ ...c.insertar[0], monto: 150000 }] })]),
    ).toMatch(/en cero/)
    expect(
      await falla(ACTIVAR, [ids.planAnualId, C_ANUAL, JSON.stringify({ ...c, cuota_anual: { ...c.cuota_anual, monto: 1500000 } })]),
    ).toMatch(/no coincide/)
  })

  it('rechaza anular un cobro que no es de una cuota que cambia', async () => {
    const c = cambiosDelServidor()
    expect(await falla(ACTIVAR, [ids.planAnualId, C_ANUAL, JSON.stringify({ ...c, anular_cobros: [C2, C1] })])).toMatch(/cobros por anular/)
  })
})

describe('durante el plan, retirar el único usuario adicional deja su cuota en cero', () => {
  const RETIRO = `select public.registrar_retiro_licencia($1, $2, $3::date, $4::uuid[], $5::jsonb, $6, $7) as id`

  it('en una cuota de usuarios adicionales sí; en una cuota del servicio sigue sin poder', async () => {
    const { planAnualId, licenciaId } = await sembrar()
    const cargo = (await db.query<{ id: string }>(`select id from public.licencias_adicionales_cargos where licencia_id = $1`, [licenciaId])).rows[0].id
    const args = (montoNuevo: number) => [
      licenciaId, PERFIL, '2026-11-01', `{${cargo}}`,
      JSON.stringify([{ cuota_id: Q3, monto_antes: 50000, monto_nuevo: montoNuevo, concepto_nuevo: 'Usuarios adicionales · periodo del 23/11/2026 al 22/12/2026' }]),
      3, 'Retiro',
    ]
    // Antes de activar, la cuota 3 es del servicio (vale 200.000): bajar a 0 no.
    expect(
      await falla(RETIRO, [
        licenciaId, PERFIL, '2026-11-01', `{${cargo}}`,
        JSON.stringify([{ cuota_id: Q3, monto_antes: 200000, monto_nuevo: 0, concepto_nuevo: 'x' }]),
        3, 'Retiro',
      ]),
    ).toMatch(/registrar_retiro_licencia/)
    await db.query(ACTIVAR, [planAnualId, C_ANUAL, JSON.stringify(cambiosDelServidor())])
    expect(await falla(RETIRO, args(0))).toBeNull()
    const q3 = await db.query<{ monto: string }>(`select monto::text from public.plan_cobro_cuotas where id = '${Q3}'`)
    expect(Number(q3.rows[0].monto)).toBe(0)
  })
})

describe('la constancia y los permisos', () => {
  it('lo aceptado no se cambia ni se borra', async () => {
    const { planAnualId } = await sembrar()
    expect(await falla(`update public.planes_anuales_cda set texto_anexo = 'otro' where id = $1`, [planAnualId])).toMatch(/no cambia/)
    expect(await falla(`update public.planes_anuales_cda set nombre_aceptante = 'Otra Persona' where id = $1`, [planAnualId])).toMatch(/no cambia/)
    expect(await falla(`delete from public.planes_anuales_cda where id = $1`, [planAnualId])).toMatch(/no se borra/)
    // El estado sí se mueve.
    expect(await falla(`update public.planes_anuales_cda set estado = 'sin_efecto' where id = $1`, [planAnualId])).toBeNull()
  })

  it('una sola elección esperando pago por contrato', async () => {
    await sembrar()
    const e = await falla(
      `insert into public.planes_anuales_cda (workspace_id, workspace_cliente_id, servicio_contratado_id, negocio_id, plan_cobro_id,
         periodo_desde, periodo_hasta, monto, precio_lista, documento_slug, documento_version, documento_texto_sha256,
         texto_anexo, texto_anexo_sha256, texto_aceptacion, texto_aceptacion_sha256, usuario_id, nombre_aceptante,
         tipo_documento, numero_documento)
       values ('${WS}', '${WS_CDA}', $1, '${NEGOCIO}', '${PLAN}', '2026-10-23', '2027-10-22', 1650000, 1800000,
         'anexo-plan-anual-valida-cda', 'v1', $2, 'ANEXO', $2, 'Yo acepto', $2, '${PERFIL}', 'Ana Pérez', 'CC', '12345678')`,
      [SC, 'a'.repeat(64)],
    )
    expect(e).toMatch(/uq_planes_anuales_elegido/)
  })

  it('la tabla y las funciones son de service_role', async () => {
    const t = await db.query<{ rls: boolean; a: boolean; b: boolean }>(`
      select relrowsecurity as rls,
             has_table_privilege('anon', c.oid, 'select') as a,
             has_table_privilege('authenticated', c.oid, 'select') as b
        from pg_class c where oid = 'public.planes_anuales_cda'::regclass`)
    expect(t.rows[0]).toEqual({ rls: true, a: false, b: false })
    const f = await db.query<{ proname: string; a: boolean; b: boolean }>(`
      select proname,
             has_function_privilege('anon', p.oid, 'execute') as a,
             has_function_privilege('authenticated', p.oid, 'execute') as b
        from pg_proc p
       where pronamespace = 'public'::regnamespace
         and proname in ('activar_plan_anual_cda', 'registrar_retiro_licencia', 'planes_anuales_cda_guardas')`)
    expect(f.rows).toHaveLength(3)
    expect(f.rows.filter((x) => x.a || x.b)).toEqual([])
  })
})
