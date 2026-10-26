/**
 * `20261009160000_devoluciones_dinero.sql` corrida de verdad en Postgres en memoria (PGlite).
 *
 * Lo que la BASE tiene que garantizar sola, aunque el servidor tenga un defecto (SOE-007):
 *   · no se devuelve más de lo recaudado neto (lo cobrado menos lo ya devuelto);
 *   · la fecha no es futura y el motivo es obligatorio;
 *   · con «cerrar el caso» el negocio queda perdido en la MISMA operación, con razón e
 *     historial; un caso ya cerrado no se vuelve a cerrar;
 *   · el cobro original no cambia;
 *   · en los tableros la devolución resta en el MES de la devolución y los meses anteriores
 *     quedan idénticos;
 *   · la función solo la ejecuta service_role, y la tabla no se escribe con sesión.
 *
 * `v_cobro_valor` y las RPC de Dirección y de la serie del Comercial se cargan desde sus
 * migraciones reales; las otras cuatro RPC que la migración reescribe se cargan sin validar el
 * cuerpo (solo importa que el reemplazo de texto las encuentre). Las tablas que esas RPC leen
 * se crean con las columnas que usan.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const MIGRACION = '20261009160000_devoluciones_dinero.sql'
const HONORARIO_NETO = '20260902220053_tableros_honorario_neto_de_iva.sql'
const SERIES = '20260903140000_serie_comercial_lee_la_vista.sql'
const RESUMEN_PERFIL = '20260915030000_perfil_y_resumen_cuentan_la_venta_canonica.sql'

/** La definición de una función tal como la dejó su migración (CREATE … hasta `$function$;`). */
function funcion(archivo: string, nombre: string): string {
  const sql = leer(archivo)
  const inicio = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`)
  if (inicio < 0) throw new Error(`${nombre} no está en ${archivo}`)
  const cuerpo = sql.indexOf('$function$', inicio)
  const fin = sql.indexOf('$function$;', cuerpo + 10)
  return sql.slice(inicio, fin + '$function$;'.length)
}

function vistaCobroValor(): string {
  const sql = leer(HONORARIO_NETO)
  const inicio = sql.indexOf('CREATE OR REPLACE VIEW public.v_cobro_valor AS')
  const fin = sql.indexOf('COMMENT ON VIEW public.v_cobro_valor')
  return sql.slice(inicio, fin)
}

const WS = '00000000-0000-4000-8000-00000000d001'
const OTRO_WS = '00000000-0000-4000-8000-00000000d002'
const PERFIL = '00000000-0000-4000-8000-00000000d003'
const STAFF = '00000000-0000-4000-8000-00000000d004'
const ABIERTO = '00000000-0000-4000-8000-00000000d005'
const CERRADO = '00000000-0000-4000-8000-00000000d006'
const AJENO = '00000000-0000-4000-8000-00000000d007'
const COBRO = '00000000-0000-4000-8000-00000000d008'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key, slug text);
  create table public.profiles   (id uuid primary key, workspace_id uuid);
  create table public.staff      (id uuid primary key, workspace_id uuid, full_name text);
  create table public.negocios (
    id uuid primary key, workspace_id uuid not null, codigo text, nombre text,
    estado text not null default 'abierto', stage_actual text default 'venta',
    razon_cierre text, descripcion_cierre text, closed_at timestamptz,
    etapa_actual_id uuid, linea_id uuid, metadata jsonb default '{}'::jsonb,
    created_at timestamptz default now()
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
  -- Lo que v_cobro_valor y v_devolucion_valor leen de v_negocio_valor.
  create table public.v_negocio_valor (
    negocio_id uuid primary key, linea_id uuid, iva_frac numeric, iva_origen text,
    techo_tramo1 numeric, techo_tarifa numeric, techo_tramo2 numeric
  );
  -- Lo que leen las RPC de Dirección y de la serie mensual.
  create table public.etapas_negocio (id uuid primary key, linea_id uuid, orden int, nombre text);
  create table public.contactos (id uuid primary key, workspace_id uuid, created_at timestamptz);
  create table public.negocio_bloques (id uuid primary key, negocio_id uuid, bloque_config_id uuid, data jsonb);
  create table public.bloque_configs (id uuid primary key, slug text);
  create table public.config_metas (
    workspace_id uuid, mes date, meta_ventas_mensual numeric, meta_leads_mensual numeric,
    meta_leads_calificados_mensual numeric, meta_negocios_mensual numeric
  );
  create table public.v_venta_mes_comercial (
    workspace_id uuid, negocio_id uuid, fecha_venta date,
    honorario_sin_iva numeric, honorario_con_iva numeric
  );

  create function public.current_user_workspace_id() returns uuid language sql stable as
    $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;

  insert into public.workspaces (id, slug) values ('${WS}', 'soena'), ('${OTRO_WS}', 'otro');
  insert into public.profiles (id, workspace_id) values ('${PERFIL}', '${WS}');
  insert into public.staff (id, workspace_id, full_name) values ('${STAFF}', '${WS}', 'Daniela');
`

// Plan 50/50 de SOENA: el anticipo es tramo 1 (50 % del honorario, con IVA) + tarifa UPME.
// Tramo 1 = 500.000 con IVA, tarifa = 137.500 → anticipo 637.500, como V0494.
const DATOS = `
  insert into public.negocios (id, workspace_id, codigo, nombre, estado) values
    ('${ABIERTO}', '${WS}', 'V9001', 'CASO ABIERTO', 'abierto'),
    ('${CERRADO}', '${WS}', 'V9002', 'CASO PERDIDO', 'perdido'),
    ('${AJENO}', '${OTRO_WS}', 'X1', 'DE OTRO ESPACIO', 'abierto');
  update public.negocios set razon_cierre = 'fuera_de_perfil', closed_at = '2026-10-05T14:03:34Z'
   where id = '${CERRADO}';
  insert into public.v_negocio_valor values
    ('${ABIERTO}', null, 0.19, 'declarado', 500000, 137500, 500000),
    ('${CERRADO}', null, 0.19, 'declarado', 500000, 137500, 500000),
    ('${AJENO}',   null, 0.19, 'declarado', 500000, 137500, 500000);
  insert into public.cobros (id, workspace_id, negocio_id, monto, fecha, tipo_cobro) values
    ('${COBRO}', '${WS}', '${CERRADO}', 637500, '2026-09-09', 'anticipo'),
    (gen_random_uuid(), '${WS}', '${ABIERTO}', 637500, '2026-09-12', 'anticipo'),
    (gen_random_uuid(), '${OTRO_WS}', '${AJENO}', 637500, '2026-09-12', 'anticipo'),
    -- Cuota programada que todavía no se paga (sin fecha): no es plata que entró.
    (gen_random_uuid(), '${WS}', '${CERRADO}', 500000, null, 'programado');
`

async function montar(db: PGlite) {
  await db.exec(ESQUEMA_BASE)
  await db.exec(`create or replace view public.v_cobro_valor as ${vistaCobroValor().replace(/^CREATE OR REPLACE VIEW public\.v_cobro_valor AS/, '')}`)
  await db.exec(funcion(HONORARIO_NETO, 'get_directivo_soena'))
  await db.exec(funcion(SERIES, 'get_comercial_serie_mensual_soena'))
  // Estas cuatro solo tienen que existir con su texto real: el reemplazo las busca por firma.
  await db.exec(`set check_function_bodies = off;
    ${funcion(SERIES, 'get_comercial_serie_seccional_soena')}
    ${funcion(SERIES, 'get_comercial_serie_vendedor_soena')}
    ${funcion(RESUMEN_PERFIL, 'get_comercial_resumen_soena')}
    ${funcion(RESUMEN_PERFIL, 'get_comercial_perfil_soena')}`)
  // Se queda apagado: la migración las vuelve a crear con su texto real y aquí faltan las
  // tablas del Comercial que no deciden nada de lo que se mide. En producción se validan
  // (es lo que prueba el dry-run).
}

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await montar(db)
  await db.exec(leer(MIGRACION))
  await db.exec(DATOS)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.exec(`
    delete from public.devoluciones_dinero;
    delete from public.activity_log;
    update public.negocios set estado = 'abierto', razon_cierre = null, descripcion_cierre = null, closed_at = null
     where id = '${ABIERTO}';
    update public.negocios set estado = 'perdido', razon_cierre = 'fuera_de_perfil', descripcion_cierre = null,
           closed_at = '2026-10-05T14:03:34Z'
     where id = '${CERRADO}';
  `)
})

interface Registro {
  negocio?: string
  ws?: string
  fecha?: string
  monto?: number
  motivo?: string
  cerrar?: boolean
  razon?: string | null
  label?: string | null
}

async function registrar(p: Registro = {}): Promise<Record<string, unknown>> {
  const r = await db.query<{ r: Record<string, unknown> }>(
    `select public.registrar_devolucion_dinero($1, $2, $3::date, $4, $5, $6::jsonb, $7, $8, $9, $10, $11) as r`,
    [
      p.ws ?? WS,
      p.negocio ?? CERRADO,
      p.fecha ?? '2026-10-08',
      p.monto ?? 637500,
      p.motivo ?? 'La clienta desistió y se le devolvió el anticipo',
      null,
      p.cerrar ?? false,
      p.razon === undefined ? 'desistio' : p.razon,
      p.label === undefined ? 'El cliente desistio' : p.label,
      PERFIL,
      STAFF,
    ],
  )
  return r.rows[0].r
}

async function negocio(id: string) {
  const r = await db.query<{ estado: string; razon_cierre: string | null; descripcion_cierre: string | null; closed_at: string | null }>(
    'select estado, razon_cierre, descripcion_cierre, closed_at::text from public.negocios where id = $1',
    [id],
  )
  return r.rows[0]
}

async function historial(id: string) {
  const r = await db.query<{ tipo: string; campo_modificado: string | null; contenido: string; valor_nuevo: string | null; autor_id: string | null }>(
    'select tipo, campo_modificado, contenido, valor_nuevo, autor_id from public.activity_log where entidad_id = $1 order by created_at',
    [id],
  )
  return r.rows
}

async function directivo(anio: number, mes: number) {
  await db.exec(`set prueba.ws = '${WS}'`)
  const r = await db.query<{ d: { comercial: Record<string, number> } }>(
    'select public.get_directivo_soena($1, $2, $3) as d',
    [WS, anio, mes],
  )
  return r.rows[0].d.comercial
}

describe('la migración', () => {
  it('no escribe datos: la tabla nace vacía', async () => {
    const fresca = new PGlite()
    await montar(fresca)
    await fresca.exec(leer(MIGRACION))
    const r = await fresca.query<{ n: number }>('select count(*)::int as n from public.devoluciones_dinero')
    expect(r.rows[0].n).toBe(0)
    await fresca.close()
  }, 60_000)

  it('las seis RPC de recaudo leen v_recaudo_neto_valor y ya no v_cobro_valor', async () => {
    const r = await db.query<{ proname: string; nueva: boolean; vieja: boolean }>(`
      select p.proname,
             position('v_recaudo_neto_valor cv' in pg_get_functiondef(p.oid)) > 0 as nueva,
             position('v_cobro_valor cv' in pg_get_functiondef(p.oid)) > 0 as vieja
        from pg_proc p
       where p.proname in ('get_directivo_soena', 'get_comercial_serie_mensual_soena',
                           'get_comercial_serie_seccional_soena', 'get_comercial_serie_vendedor_soena',
                           'get_comercial_resumen_soena', 'get_comercial_perfil_soena')`)
    expect(r.rows).toHaveLength(6)
    for (const f of r.rows) {
      expect(f, f.proname).toMatchObject({ nueva: true, vieja: false })
    }
  })

  it('es idempotente: correr otra vez el reemplazo no cambia ninguna función', async () => {
    const antes = await db.query<{ m: string }>(
      "select string_agg(md5(pg_get_functiondef(oid)), ',' order by proname) as m from pg_proc where proname like 'get_%soena'",
    )
    const sql = leer(MIGRACION)
    await db.exec(sql.slice(sql.indexOf('do $$')))
    const despues = await db.query<{ m: string }>(
      "select string_agg(md5(pg_get_functiondef(oid)), ',' order by proname) as m from pg_proc where proname like 'get_%soena'",
    )
    expect(despues.rows[0].m).toBe(antes.rows[0].m)
  })

  it('aborta entera si una RPC viva no trae el patrón las veces esperadas', async () => {
    const fresca = new PGlite()
    await montar(fresca)
    // Simula una versión viva distinta del repo: un segundo `v_cobro_valor cv` en Dirección.
    const def = funcion(HONORARIO_NETO, 'get_directivo_soena').replace(
      'with guard as (',
      'with extra as (select 1 from v_cobro_valor cv limit 0),\nguard as (',
    )
    await fresca.exec(def)
    await expect(fresca.exec(leer(MIGRACION))).rejects.toThrow(/cambió en producción/)
    const t = await fresca.query<{ existe: boolean }>("select to_regclass('public.devoluciones_dinero') is not null as existe")
    expect(t.rows[0].existe).toBe(false)
    await fresca.close()
  }, 60_000)
})

describe('registrar_devolucion_dinero', () => {
  it('rechaza devolver más de lo recaudado neto y no escribe nada', async () => {
    const r = await registrar({ monto: 637501 })
    expect(r).toMatchObject({ ok: false, codigo: 'supera_neto' })
    expect(Number(r.neto)).toBe(637500)
    const n = await db.query<{ n: number }>('select count(*)::int as n from public.devoluciones_dinero')
    expect(n.rows[0].n).toBe(0)
  })

  it('rechaza fecha futura, motivo corto, monto cero y un negocio de otro espacio', async () => {
    expect(await registrar({ fecha: '2099-01-01' })).toMatchObject({ ok: false, codigo: 'fecha_futura' })
    expect(await registrar({ motivo: 'corto' })).toMatchObject({ ok: false, codigo: 'motivo_requerido' })
    expect(await registrar({ monto: 0 })).toMatchObject({ ok: false, codigo: 'monto_invalido' })
    expect(await registrar({ negocio: AJENO })).toMatchObject({ ok: false, codigo: 'negocio_no_encontrado' })
  })

  it('las parciales acumulan contra el neto', async () => {
    expect(await registrar({ monto: 300000 })).toMatchObject({ ok: true })
    const r2 = await registrar({ monto: 400000 })
    expect(r2).toMatchObject({ ok: false, codigo: 'supera_neto' })
    expect(Number(r2.neto)).toBe(337500)
    expect(await registrar({ monto: 337500 })).toMatchObject({ ok: true })
    expect(await registrar({ monto: 1 })).toMatchObject({ ok: false, codigo: 'supera_neto' })
  })

  it('sin cierre: guarda la devolución, deja el caso como estaba y queda en el historial', async () => {
    const r = await registrar({ negocio: ABIERTO, monto: 100000 })
    expect(r).toMatchObject({ ok: true, cerro_caso: false, ya_cerrado: false })
    expect(Number(r.neto_despues)).toBe(537500)
    expect((await negocio(ABIERTO)).estado).toBe('abierto')
    const h = await historial(ABIERTO)
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ tipo: 'cambio', campo_modificado: 'devolucion_dinero', valor_nuevo: '100000', autor_id: STAFF })
    expect(h[0].contenido).toContain('$100.000')
    expect(h[0].contenido).toContain('2026-10-08')
    expect(h[0].contenido).toContain('La clienta desistió')
    expect(h[0].contenido).toContain('El caso sigue en su estado')
  })

  it('con cierre sobre un caso abierto: lo cierra como perdido en la misma operación', async () => {
    const r = await registrar({ negocio: ABIERTO, cerrar: true })
    expect(r).toMatchObject({ ok: true, cerro_caso: true, ya_cerrado: false })
    const n = await negocio(ABIERTO)
    expect(n.estado).toBe('perdido')
    expect(n.razon_cierre).toBe('desistio')
    expect(n.descripcion_cierre).toContain('La clienta desistió')
    expect(n.closed_at).not.toBeNull()
    const h = await historial(ABIERTO)
    expect(h.map((x) => x.tipo).sort()).toEqual(['cambio', 'cambio_estado'])
    const cierre = h.find((x) => x.tipo === 'cambio_estado')!
    expect(cierre).toMatchObject({ valor_nuevo: 'perdido', autor_id: STAFF })
    expect(cierre.contenido).toContain('Negocio desistido. Motivo: El cliente desistio')
    const fila = await db.query<{ cerro_caso: boolean; razon_cierre: string }>(
      'select cerro_caso, razon_cierre from public.devoluciones_dinero',
    )
    expect(fila.rows[0]).toEqual({ cerro_caso: true, razon_cierre: 'desistio' })
  })

  it('con cierre sobre un caso abierto SIN razón: lo rechaza y no escribe nada', async () => {
    const r = await registrar({ negocio: ABIERTO, cerrar: true, razon: null })
    expect(r).toMatchObject({ ok: false, codigo: 'razon_requerida' })
    expect((await negocio(ABIERTO)).estado).toBe('abierto')
    expect(await historial(ABIERTO)).toHaveLength(0)
  })

  it('un caso ya cerrado no se vuelve a cerrar', async () => {
    const antes = await negocio(CERRADO)
    const r = await registrar({ negocio: CERRADO, cerrar: true, razon: null })
    expect(r).toMatchObject({ ok: true, cerro_caso: false, ya_cerrado: true })
    expect(await negocio(CERRADO)).toEqual(antes)
    const h = await historial(CERRADO)
    expect(h.map((x) => x.tipo)).toEqual(['cambio'])
    expect(h[0].contenido).toContain('ya estaba cerrado')
    const fila = await db.query<{ cerro_caso: boolean }>('select cerro_caso from public.devoluciones_dinero')
    expect(fila.rows[0].cerro_caso).toBe(false)
  })

  it('el cobro original no cambia', async () => {
    const antes = await db.query('select * from public.cobros where id = $1', [COBRO])
    await registrar({ negocio: CERRADO, cerrar: true })
    const despues = await db.query('select * from public.cobros where id = $1', [COBRO])
    expect(despues.rows).toEqual(antes.rows)
  })
})

describe('tableros: la devolución resta en el mes en que ocurrió', () => {
  it('Dirección: septiembre queda igual y octubre baja el primer pago neto de IVA', async () => {
    const sepAntes = await directivo(2026, 9)
    const octAntes = await directivo(2026, 10)
    // Dos anticipos de 637.500: tramo 1 de 500.000 con IVA cada uno → 420.168,07 de base.
    expect(Number(sepAntes.primer_pago)).toBeCloseTo(2 * 420168.07, 2)
    expect(Number(octAntes.primer_pago)).toBe(0)

    await registrar({ negocio: CERRADO, monto: 637500, fecha: '2026-10-08' })

    expect(await directivo(2026, 9)).toEqual(sepAntes)
    const oct = await directivo(2026, 10)
    expect(Number(oct.primer_pago)).toBeCloseTo(-420168.07, 2)
    expect(Number(oct.ventas_totales)).toBeCloseTo(-420168.07, 2)
    // Ventas (cohorte) no cambia: no se toca v_venta_mes_comercial.
    expect(oct.negocios_cerrados).toBe(octAntes.negocios_cerrados)
  })

  it('se devuelve desde arriba: una parcial sale primero de la tarifa UPME', async () => {
    await registrar({ negocio: CERRADO, monto: 100000 })
    const r = await db.query<{ a_tramo1: string; a_tarifa: string; a_tramo1_base: string }>(
      'select a_tramo1, a_tarifa, a_tramo1_base from public.v_devolucion_valor',
    )
    expect(Number(r.rows[0].a_tarifa)).toBe(100000)
    expect(Number(r.rows[0].a_tramo1)).toBe(0)
    expect(Number((await directivo(2026, 10)).primer_pago)).toBe(0)

    await registrar({ negocio: CERRADO, monto: 100000, fecha: '2026-10-09' })
    const r2 = await db.query<{ a_tramo1: string; a_tarifa: string }>(
      "select a_tramo1, a_tarifa from public.v_devolucion_valor where fecha = '2026-10-09'",
    )
    // Quedaban 37.500 de tarifa; el resto sale del tramo 1.
    expect(Number(r2.rows[0].a_tarifa)).toBe(37500)
    expect(Number(r2.rows[0].a_tramo1)).toBe(62500)
  })

  it('serie mensual del Comercial: el recaudo de octubre baja y el de septiembre no', async () => {
    await db.exec(`set prueba.ws = '${WS}'`)
    const serie = async () => {
      const r = await db.query<{ s: { serie: Array<{ anio: number; mes: number; honorario_recaudado: number; tarifa_recaudada: number }> } }>(
        'select public.get_comercial_serie_mensual_soena($1, 36) as s',
        [WS],
      )
      return r.rows[0].s.serie.filter((p) => p.anio === 2026 && (p.mes === 9 || p.mes === 10))
    }
    const antes = await serie()
    await registrar({ negocio: CERRADO, monto: 637500, fecha: '2026-10-08' })
    const despues = await serie()
    const sep = (s: typeof antes) => s.find((p) => p.mes === 9)
    const oct = (s: typeof antes) => s.find((p) => p.mes === 10)
    expect(sep(despues)).toEqual(sep(antes))
    expect(oct(antes)).toBeDefined()
    expect(Number(oct(despues)!.honorario_recaudado) - Number(oct(antes)!.honorario_recaudado)).toBeCloseTo(-420168.07, 2)
    expect(Number(oct(despues)!.tarifa_recaudada) - Number(oct(antes)!.tarifa_recaudada)).toBe(-137500)
  })
})

describe('permisos', () => {
  it('la función no la ejecutan anon ni authenticated; service_role sí', async () => {
    for (const rol of ['anon', 'authenticated']) {
      await db.exec(`set role ${rol}`)
      await expect(registrar()).rejects.toThrow(/permission denied/)
      await db.exec('reset role')
    }
    await db.exec('set role service_role')
    try {
      expect(await registrar({ monto: 1000 })).toMatchObject({ ok: true })
    } finally {
      await db.exec('reset role')
    }
  })

  it('con sesión la tabla se lee solo del propio espacio y no se escribe', async () => {
    await registrar({ monto: 1000 })
    await db.exec(`set role authenticated; set prueba.ws = '${WS}'`)
    try {
      const propia = await db.query<{ n: number }>('select count(*)::int as n from public.devoluciones_dinero')
      expect(propia.rows[0].n).toBe(1)
      await db.exec(`set prueba.ws = '${OTRO_WS}'`)
      const ajena = await db.query<{ n: number }>('select count(*)::int as n from public.devoluciones_dinero')
      expect(ajena.rows[0].n).toBe(0)
      await expect(
        db.query(
          `insert into public.devoluciones_dinero (workspace_id, negocio_id, fecha, monto, motivo)
           values ('${OTRO_WS}', '${AJENO}', '2026-10-01', 10, 'motivo suficientemente largo')`,
        ),
      ).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role; set prueba.ws = '${WS}'`)
    }
  })
})
