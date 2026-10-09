/**
 * `20261009210000_venta_reembolsada_no_cuenta.sql` corrida de verdad en Postgres en memoria
 * (PGlite). SOE-007, segunda parte:
 *
 *   · una venta devuelta en su TOTALIDAD sale de `v_venta_mes_comercial`, y con ella de las
 *     ventas del mes, el valor vendido, el honorario cubierto y los «Negocios cerrados» de
 *     Dirección, en el MES DE LA VENTA;
 *   · una devolución PARCIAL no la saca;
 *   · el perdido sigue contando en la tasa de cancelación (no cuenta doble ni desaparece);
 *   · sin devoluciones, la vista queda idéntica;
 *   · el indicador de reembolsos cuenta por el mes de la DEVOLUCIÓN, sin IVA.
 *
 * `v_cobro_valor`, `v_venta_mes_comercial`, la primera parte de SOE-007 (tabla, función y
 * vistas de devolución) y las RPC de KPIs del Comercial y de Dirección se cargan desde sus
 * migraciones reales. Lo que esas vistas leen de `v_negocio_valor`, `v_negocio_bonificable`
 * y `v_negocio_comercial` va como tablas con las columnas que usan.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const MIGRACION = '20261009210000_venta_reembolsada_no_cuenta.sql'
const DEVOLUCIONES = '20261009160000_devoluciones_dinero.sql'
const HONORARIO_NETO = '20260902220053_tableros_honorario_neto_de_iva.sql'
const VENTA_CERO = '20260903120000_venta_cero_cuenta_como_cierre.sql'
const KPIS = '20261001140200_perf_fence_venta_mes_soena.sql'

/** La definición de una función tal como la dejó su migración (CREATE … hasta `$function$;`). */
function funcion(archivo: string, nombre: string): string {
  const sql = leer(archivo)
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`)
  if (inicio < 0) throw new Error(`${nombre} no está en ${archivo}`)
  const cuerpo = sql.indexOf('$function$', inicio)
  const fin = sql.indexOf('$function$;', cuerpo + 10)
  return sql.slice(inicio, fin + '$function$;'.length)
}

/** Una vista tal como la dejó su migración (CREATE … hasta su COMMENT). */
function vista(archivo: string, nombre: string): string {
  const sql = leer(archivo)
  const inicio = sql.indexOf(`CREATE OR REPLACE VIEW public.${nombre} AS`)
  const fin = sql.indexOf(`COMMENT ON VIEW public.${nombre}`, inicio)
  if (inicio < 0 || fin < 0) throw new Error(`${nombre} no está en ${archivo}`)
  return sql.slice(inicio, fin)
}

/**
 * La primera parte de SOE-007 sin el reemplazo de las seis RPC de recaudo (sección 5): aquí no
 * se cargan esas RPC y lo que se mide son las ventas, no el recaudo.
 */
function devolucionesSinRpc(): string {
  const sql = leer(DEVOLUCIONES)
  const corte = sql.indexOf('-- ── 5. Las RPC de tablero leen el recaudo neto')
  if (corte < 0) throw new Error('no encontré la sección 5 de la migración de devoluciones')
  return sql.slice(0, corte)
}

const WS = '00000000-0000-4000-8000-00000000e001'
const OTRO_WS = '00000000-0000-4000-8000-00000000e002'
const PERFIL = '00000000-0000-4000-8000-00000000e003'
const VENDEDORA = '00000000-0000-4000-8000-00000000e004'
const VENDEDOR = '00000000-0000-4000-8000-00000000e005'
// Tres ventas de septiembre, todas por el mismo anticipo que V0494 (637.500, plan 100 %).
const V0494 = '00000000-0000-4000-8000-00000000e010'
const PARCIAL = '00000000-0000-4000-8000-00000000e011'
const SIGUE = '00000000-0000-4000-8000-00000000e012'
const AJENO = '00000000-0000-4000-8000-00000000e013'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key, slug text);
  create table public.profiles   (id uuid primary key, workspace_id uuid, role text);
  create table public.staff      (id uuid primary key, workspace_id uuid, full_name text, profile_id uuid);
  create table public.negocios (
    id uuid primary key, workspace_id uuid not null, codigo text, nombre text,
    estado text not null default 'abierto', stage_actual text default 'venta',
    razon_cierre text, descripcion_cierre text, closed_at timestamptz,
    etapa_actual_id uuid, linea_id uuid, metadata jsonb default '{}'::jsonb,
    precio_aprobado numeric, origen text, contacto_id uuid,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create table public.cobros (
    id uuid primary key default gen_random_uuid(), workspace_id uuid not null, negocio_id uuid,
    monto numeric(15,2) not null, fecha date, tipo_cobro text, notas text,
    created_at timestamptz default now()
  );
  create table public.activity_log (
    id uuid primary key default gen_random_uuid(), workspace_id uuid, entidad_tipo text,
    entidad_id uuid, tipo text, autor_id uuid, contenido text, campo_modificado text,
    valor_anterior text, valor_nuevo text, created_at timestamptz default now()
  );
  -- Lo que v_cobro_valor, v_devolucion_valor y v_venta_mes_comercial leen de v_negocio_valor.
  create table public.v_negocio_valor (
    negocio_id uuid primary key, linea_id uuid, iva_frac numeric, iva_origen text,
    techo_tramo1 numeric, techo_tarifa numeric, techo_tramo2 numeric,
    valor_aprobado_total numeric, valor_aprobado_base numeric, plan_pago int
  );
  create table public.v_negocio_bonificable (negocio_id uuid primary key, bonificable boolean, orden_umbral int);
  create table public.v_negocio_comercial (negocio_id uuid primary key, comercial_staff_id uuid);
  create table public.metas_comerciales (
    workspace_id uuid, staff_id uuid, anio int, mes int, meta_num_ventas int, meta_valor numeric
  );
  -- Lo que lee la RPC de Dirección.
  create table public.etapas_negocio (id uuid primary key, linea_id uuid, orden int, nombre text);
  create table public.contactos (id uuid primary key, workspace_id uuid, created_at timestamptz);
  create table public.negocio_bloques (id uuid primary key, negocio_id uuid, bloque_config_id uuid, data jsonb);
  create table public.bloque_configs (id uuid primary key, slug text);
  create table public.config_metas (
    workspace_id uuid, mes date, meta_ventas_mensual numeric, meta_leads_mensual numeric,
    meta_leads_calificados_mensual numeric, meta_negocios_mensual numeric
  );

  create function public.current_user_workspace_id() returns uuid language sql stable as
    $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;
  create function public.hoy_bogota() returns date language sql stable as
    $$ select (now() at time zone 'America/Bogota')::date $$;

  insert into public.workspaces (id, slug) values ('${WS}', 'soena'), ('${OTRO_WS}', 'otro');
  insert into public.profiles (id, workspace_id, role) values ('${PERFIL}', '${WS}', 'owner');
  insert into public.staff (id, workspace_id, full_name) values
    ('${VENDEDORA}', '${WS}', 'Daniela'), ('${VENDEDOR}', '${WS}', 'Andrés');
`

// Plan 100 % anticipado sin tarifa, como V0494: el anticipo de 637.500 es todo tramo 1, que
// en base (sin IVA) son 535.714,29.
const DATOS = `
  insert into public.negocios (id, workspace_id, codigo, nombre, estado, precio_aprobado, updated_at, closed_at) values
    ('${V0494}',   '${WS}', 'V0494', 'CATHERINE CHACON', 'perdido', 637500, '2026-10-05T14:03:34Z', '2026-10-05T14:03:34Z'),
    ('${PARCIAL}', '${WS}', 'V9001', 'DEVOLUCION PARCIAL', 'abierto', 637500, '2026-09-12T15:00:00Z', null),
    ('${SIGUE}',   '${WS}', 'V9002', 'VENTA NORMAL', 'abierto', 637500, '2026-09-20T15:00:00Z', null),
    ('${AJENO}',   '${OTRO_WS}', 'X1', 'DE OTRO ESPACIO', 'abierto', 637500, '2026-09-12T15:00:00Z', null);
  insert into public.v_negocio_valor
    (negocio_id, linea_id, iva_frac, iva_origen, techo_tramo1, techo_tarifa, techo_tramo2,
     valor_aprobado_total, valor_aprobado_base, plan_pago) values
    ('${V0494}',   null, 0.19, 'declarado', 637500, 0, 0, 637500, 535714.29, 2),
    ('${PARCIAL}', null, 0.19, 'declarado', 637500, 0, 0, 637500, 535714.29, 2),
    ('${SIGUE}',   null, 0.19, 'declarado', 637500, 0, 0, 637500, 535714.29, 2),
    ('${AJENO}',   null, 0.19, 'declarado', 637500, 0, 0, 637500, 535714.29, 2);
  insert into public.v_negocio_bonificable values
    ('${V0494}', false, 5), ('${PARCIAL}', true, 5), ('${SIGUE}', true, 5), ('${AJENO}', true, 5);
  insert into public.v_negocio_comercial values
    ('${V0494}', '${VENDEDORA}'), ('${PARCIAL}', '${VENDEDOR}'), ('${SIGUE}', '${VENDEDORA}'), ('${AJENO}', null);
  insert into public.cobros (workspace_id, negocio_id, monto, fecha, tipo_cobro) values
    ('${WS}', '${V0494}',   637500, '2026-09-09', 'anticipo'),
    ('${WS}', '${PARCIAL}', 637500, '2026-09-12', 'anticipo'),
    ('${WS}', '${SIGUE}',   637500, '2026-09-20', 'anticipo'),
    ('${OTRO_WS}', '${AJENO}', 637500, '2026-09-12', 'anticipo');
`

async function montar(db: PGlite) {
  await db.exec(ESQUEMA_BASE)
  await db.exec(vista(HONORARIO_NETO, 'v_cobro_valor'))
  await db.exec(vista(VENTA_CERO, 'v_venta_mes_comercial'))
  await db.exec(devolucionesSinRpc())
  await db.exec(funcion(KPIS, 'get_comercial_kpis_mes_soena'))
  await db.exec(funcion(HONORARIO_NETO, 'get_directivo_soena'))
  await db.exec(DATOS)
}

let db: PGlite
/** La vista ANTES de la migración, sin devoluciones: la foto contra la que se compara. */
let ventasAntes: unknown[]

const ventasSql = 'select * from public.v_venta_mes_comercial order by negocio_id'

beforeAll(async () => {
  db = new PGlite()
  await montar(db)
  ventasAntes = (await db.query(ventasSql)).rows
  await db.exec(leer(MIGRACION))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.exec('delete from public.devoluciones_dinero; delete from public.activity_log;')
})

async function devolver(negocio: string, monto: number, fecha: string, motivo = 'La clienta desistió y se le devolvió el anticipo') {
  const r = await db.query<{ r: Record<string, unknown> }>(
    `select public.registrar_devolucion_dinero($1, $2, $3::date, $4, $5, null, false, null, null, $6, null) as r`,
    [WS, negocio, fecha, monto, motivo, PERFIL],
  )
  expect(r.rows[0].r).toMatchObject({ ok: true })
}

async function ventasDe(id: string) {
  const r = await db.query('select * from public.v_venta_mes_comercial where negocio_id = $1', [id])
  return r.rows
}

type Kpis = Record<string, number | null>

async function kpis(anio: number, mes: number): Promise<Kpis> {
  await db.exec(`set prueba.ws = '${WS}'`)
  const r = await db.query<{ k: { kpis: Kpis } }>('select public.get_comercial_kpis_mes_soena($1, $2, $3) as k', [WS, anio, mes])
  return r.rows[0].k.kpis
}

async function directivo(anio: number, mes: number) {
  await db.exec(`set prueba.ws = '${WS}'`)
  const r = await db.query<{ d: { comercial: Record<string, number> } }>(
    'select public.get_directivo_soena($1, $2, $3) as d',
    [WS, anio, mes],
  )
  return r.rows[0].d.comercial
}

interface Reembolsos {
  reembolsos: number
  negocios: number
  valor: number
  monto: number
  ventas_anuladas: number
  detalle: Array<Record<string, unknown>>
  anterior: { reembolsos: number; valor: number }
}

async function reembolsos(anio: number, mes: number, ws = WS): Promise<Reembolsos | null> {
  await db.exec(`set prueba.ws = '${WS}'`)
  const r = await db.query<{ r: Reembolsos | null }>('select public.get_reembolsos_mes_soena($1, $2, $3) as r', [ws, anio, mes])
  return r.rows[0].r
}

describe('la migración', () => {
  it('sin devoluciones la vista de ventas queda idéntica', async () => {
    const despues = (await db.query(ventasSql)).rows
    expect(despues).toEqual(ventasAntes)
    expect(despues).toHaveLength(4)
  })

  it('reescribe la vista viva y es idempotente', async () => {
    const def = async () =>
      (await db.query<{ d: string }>("select pg_get_viewdef('public.v_venta_mes_comercial'::regclass, true) as d")).rows[0].d
    const antes = await def()
    expect(antes).toContain('v_negocio_reembolso')
    await db.exec(leer(MIGRACION))
    expect(await def()).toBe(antes)
  })

  it('no le pone security_invoker a la vista de ventas (sigue corriendo como su dueño)', async () => {
    const r = await db.query<{ o: string | null }>(
      "select reloptions::text as o from pg_class where oid = 'public.v_venta_mes_comercial'::regclass",
    )
    expect(r.rows[0].o).toBeNull()
  })

  it('aborta entera si la vista viva no trae el WHERE esperado', async () => {
    const fresca = new PGlite()
    await montar(fresca)
    // Simula una versión viva distinta del repo: el WHERE final cambió.
    const def = (await fresca.query<{ d: string }>(
      "select pg_get_viewdef('public.v_venta_mes_comercial'::regclass, true) as d",
    )).rows[0].d
    await fresca.exec(
      'create or replace view public.v_venta_mes_comercial as ' +
        def.replace('WHERE cn.negocio_id IS NOT NULL OR vz.negocio_id IS NOT NULL;', 'WHERE vz.negocio_id IS NOT NULL OR cn.negocio_id IS NOT NULL;'),
    )
    await expect(fresca.exec(leer(MIGRACION))).rejects.toThrow(/cambió en producción/)
    const t = await fresca.query<{ existe: boolean }>("select to_regclass('public.v_negocio_reembolso') is not null as existe")
    expect(t.rows[0].existe).toBe(false)
    await fresca.close()
  }, 60_000)
})

describe('venta reembolsada', () => {
  it('la devolución TOTAL saca la venta del mes en que se vendió', async () => {
    const sepAntes = await kpis(2026, 9)
    const dirAntes = await directivo(2026, 9)
    expect(sepAntes.num_ventas).toBe(3)
    expect(dirAntes.negocios_cerrados).toBe(3)

    await devolver(V0494, 637500, '2026-10-08')

    expect(await ventasDe(V0494)).toHaveLength(0)
    const sep = await kpis(2026, 9)
    expect(sep.num_ventas).toBe(2)
    expect(Number(sep.valor_sin_iva)).toBeCloseTo(Number(sepAntes.valor_sin_iva) - 535714.29, 2)
    expect(Number(sep.primer_pago)).toBeCloseTo(Number(sepAntes.primer_pago) - 535714.29, 2)
    expect(sep.casos_completos).toBe(Number(sepAntes.casos_completos) - 1)
    // V0494 no era bonificable: las bonificables no cambian, la tasa sube (sale del denominador).
    expect(sep.bonificables).toBe(sepAntes.bonificables)
    expect(Number(sep.ticket_promedio)).toBe(Math.round((Number(sepAntes.valor_sin_iva) - 535714.29) / 2))
    expect((await directivo(2026, 9)).negocios_cerrados).toBe(2)
  })

  it('una devolución PARCIAL no saca la venta', async () => {
    const antes = await ventasDe(PARCIAL)
    await devolver(PARCIAL, 100000, '2026-10-08')
    expect(await ventasDe(PARCIAL)).toEqual(antes)
    expect((await kpis(2026, 9)).num_ventas).toBe(3)
  })

  it('dos parciales que completan el total sí la sacan', async () => {
    await devolver(PARCIAL, 300000, '2026-10-01')
    expect(await ventasDe(PARCIAL)).toHaveLength(1)
    await devolver(PARCIAL, 337500, '2026-10-08')
    expect(await ventasDe(PARCIAL)).toHaveLength(0)
  })

  it('el perdido sigue contando en la tasa de cancelación, y ya no también como venta', async () => {
    const octAntes = await kpis(2026, 10)
    expect(octAntes.n_perdidos).toBe(1)
    await devolver(V0494, 637500, '2026-10-08')
    const oct = await kpis(2026, 10)
    expect(oct.n_perdidos).toBe(1)
    expect(oct.tasa_cancelacion).toBe(octAntes.tasa_cancelacion)
  })

  it('las ventas de otro negocio no se mueven', async () => {
    const antes = await ventasDe(SIGUE)
    await devolver(V0494, 637500, '2026-10-08')
    expect(await ventasDe(SIGUE)).toEqual(antes)
  })
})

describe('indicador de reembolsos', () => {
  it('cuenta por el mes de la DEVOLUCIÓN, no por el de la venta', async () => {
    await devolver(V0494, 637500, '2026-10-08')
    const sep = await reembolsos(2026, 9)
    expect(sep).toMatchObject({ reembolsos: 0, valor: 0, monto: 0, detalle: [] })
    const oct = await reembolsos(2026, 10)
    expect(oct?.reembolsos).toBe(1)
    expect(Number(oct?.monto)).toBe(637500)
    // Sin IVA, como el resto del tablero.
    expect(Number(oct?.valor)).toBeCloseTo(535714.29, 2)
    expect(oct?.anterior).toEqual({ reembolsos: 0, valor: 0 })
    const nov = await reembolsos(2026, 11)
    expect(nov?.anterior.reembolsos).toBe(1)
  })

  it('trae la lista: caso, nombre, fecha, valor, motivo, cierre, si anuló la venta y comercial', async () => {
    await devolver(V0494, 637500, '2026-10-08')
    await devolver(PARCIAL, 100000, '2026-10-09', 'Cobro doble, se devuelve la diferencia')
    const oct = await reembolsos(2026, 10)
    expect(oct?.reembolsos).toBe(2)
    expect(oct?.ventas_anuladas).toBe(1)
    expect(oct?.detalle[0]).toMatchObject({
      codigo: 'V9001', nombre: 'DEVOLUCION PARCIAL', fecha: '2026-10-09',
      motivo: 'Cobro doble, se devuelve la diferencia', cierre: 'abierto',
      venta_anulada: false, responsable_id: VENDEDOR, responsable: 'Andrés',
    })
    expect(oct?.detalle[1]).toMatchObject({
      codigo: 'V0494', nombre: 'CATHERINE CHACON', fecha: '2026-10-08',
      cierre: 'ya_cerrado', venta_anulada: true, responsable: 'Daniela',
    })
  })

  it('una devolución que cerró el caso lo dice', async () => {
    const r = await db.query<{ r: Record<string, unknown> }>(
      `select public.registrar_devolucion_dinero($1, $2, '2026-10-08'::date, 637500, 'La clienta desistió del trámite', null, true, 'desistio', 'El cliente desistio', $3, null) as r`,
      [WS, SIGUE, PERFIL],
    )
    expect(r.rows[0].r).toMatchObject({ ok: true, cerro_caso: true })
    const oct = await reembolsos(2026, 10)
    expect(oct?.detalle[0]).toMatchObject({ codigo: 'V9002', cierre: 'cerro_caso', venta_anulada: true })
    await db.exec(`update public.negocios set estado = 'abierto', razon_cierre = null, descripcion_cierre = null, closed_at = null where id = '${SIGUE}'`)
  })

  it('la guarda: otro espacio no ve nada', async () => {
    await devolver(V0494, 637500, '2026-10-08')
    expect(await reembolsos(2026, 10, OTRO_WS)).toBeNull()
  })

  it('la ejecuta authenticated, no anon', async () => {
    await db.exec('set role anon')
    try {
      await expect(reembolsos(2026, 10)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
    await db.exec('set role authenticated')
    try {
      expect(await reembolsos(2026, 10)).toMatchObject({ reembolsos: 0 })
    } finally {
      await db.exec('reset role')
    }
  })
})
