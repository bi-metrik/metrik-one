import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de F0 (servicios del viaje), ejecutada en PGlite. Criterio F0-8 de Vera: CHECK
 * ampliados LEYENDO el vivo (conservan lo que solo está en producción y fallan si la forma no es
 * la esperada), RLS por workspace en las tablas nuevas y `aprobaciones_excepcion` sin escritura
 * para `authenticated`. Más la idempotencia de la generación (F0-3) y los estados escritos (C6).
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez sobre la migración (1 roja cada una salvo la
 * del índice):
 *   · quitar el `revoke all` de aprobaciones_excepcion → cae «sin escritura para authenticated»
 *     (el esquema base imita el default viejo que concedía todo);
 *   · quitar el `revoke` de negocio_servicios → cae «anon no la toca»;
 *   · CHECK de rechazo con motivo en `true` → cae «No aprobar exige motivo»;
 *   · índice único sin `where item_id is not null` → no cambia nada observable (Postgres ya deja
 *     varios null en un único); se deja el `where` por legibilidad;
 *   · quitar `'cancelado'` del CHECK de estado → cae «estados escritos»;
 *   · reemplazar la ampliación por una lista fija → cae «conserva la categoría que solo está en
 *     producción».
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261012150000_servicios_viaje_esquema.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const WS2 = '00000000-0000-4000-8000-0000000000a2'
const NEG = '00000000-0000-4000-8000-0000000000b1'
const NEG2 = '00000000-0000-4000-8000-0000000000b2'
const ITEM = '00000000-0000-4000-8000-0000000000c1'
const ITEM2 = '00000000-0000-4000-8000-0000000000c2'
const STAFF = '00000000-0000-4000-8000-0000000000d1'

/** Lo mínimo de producción que la migración toca, con los CHECK escritos como en las migraciones. */
function esquemaBase(opts: { categoriaCheck?: string } = {}) {
  const categoriaCheck =
    opts.categoriaCheck ??
    `check (categoria in ('materiales', 'otros', 'comision', 'categoria_solo_en_produccion'))`
  return `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como producción antes del 2026-08-10: toda tabla nueva nacía concedida.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create function public.current_user_workspace_id() returns uuid language sql stable
    as $$ select nullif(current_setting('app.ws', true), '')::uuid $$;

  create table public.workspaces (id uuid primary key);
  create table public.negocios (id uuid primary key, workspace_id uuid);
  create table public.cotizaciones (id uuid primary key);
  create table public.cotizacion_itinerarios (id uuid primary key);
  create table public.items (id uuid primary key);
  create table public.empresas (id uuid primary key);
  create table public.staff (id uuid primary key);
  create table public.gastos (id serial primary key, workspace_id uuid, categoria text not null, monto numeric);
  alter table public.gastos add constraint gastos_categoria_check ${categoriaCheck};
  create table public.notificaciones (id serial primary key, tipo text not null, entidad_tipo text);
  alter table public.notificaciones add constraint notificaciones_tipo_check
    check (tipo in ('mencion', 'tipo_solo_en_produccion'));
  alter table public.notificaciones add constraint notificaciones_entidad_tipo_check
    check (entidad_tipo in ('negocio', 'cobro'));
  create table public.bloque_definitions (
    id serial primary key, codigo text unique, tipo text not null, nombre text, descripcion text,
    is_visualization boolean, can_be_gate boolean, supports_array_items boolean, default_estado text, icon_name text);
  alter table public.bloque_definitions add constraint bloque_definitions_tipo_check
    check (tipo = any (array['datos', 'cobros', 'resultado']));
  insert into public.workspaces values ('${WS}'), ('${WS2}');
  insert into public.negocios values ('${NEG}', '${WS}'), ('${NEG2}', '${WS2}');
  insert into public.items values ('${ITEM}'), ('${ITEM2}');
  insert into public.staff values ('${STAFF}');
  insert into public.gastos (workspace_id, categoria, monto) values ('${WS}', 'categoria_solo_en_produccion', 1);
  insert into public.notificaciones (tipo) values ('tipo_solo_en_produccion');
`
}

let db: PGlite

async function falla(sql: string, en: PGlite = db): Promise<string | null> {
  try {
    await en.exec(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const servicio = (opts: { ws?: string; neg?: string; item?: string | null; estado?: string; tipo?: string } = {}) => `
  insert into public.negocio_servicios (workspace_id, negocio_id, item_id, tipo, nombre, estado)
  values ('${opts.ws ?? WS}', '${opts.neg ?? NEG}', ${opts.item === null ? 'null' : `'${opts.item ?? ITEM}'`},
          '${opts.tipo ?? 'hotel'}', 'Hotel de prueba', '${opts.estado ?? 'por_reservar'}')`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(esquemaBase())
  await db.exec(readFileSync(MIGRACION, 'utf8'))
})

afterAll(async () => {
  await db.close()
})

describe('negocio_servicios', () => {
  it('un ítem, una fila por negocio: generar dos veces no duplica (F0-3)', async () => {
    expect(await falla(servicio())).toBeNull()
    expect(await falla(servicio())).toMatch(/negocio_servicios_item_unico/)
    // Las filas a mano (sin ítem) no chocan entre sí.
    expect(await falla(servicio({ item: null }))).toBeNull()
    expect(await falla(servicio({ item: null }))).toBeNull()
    await db.exec(`delete from public.negocio_servicios`)
  })

  it('estados escritos: solo por reservar, reservado y cancelado; pagado y confirmado se derivan (C6)', async () => {
    for (const ok of ['por_reservar', 'reservado', 'cancelado']) {
      expect(await falla(servicio({ item: null, estado: ok })), ok).toBeNull()
    }
    for (const no of ['pagado', 'confirmado', 'esperando']) {
      expect(await falla(servicio({ item: null, estado: no })), no).toMatch(/check/)
    }
    // Una cortesía va como gasto `cortesia_viaje`, no como servicio (§7.2.2).
    expect(await falla(servicio({ item: null, tipo: 'cortesia' }))).toMatch(/check/)
    await db.exec(`delete from public.negocio_servicios`)
  })

  it('comisión: un estado sin valor esperado no entra (C13)', async () => {
    expect(await falla(`insert into public.negocio_servicios (workspace_id, negocio_id, tipo, nombre, comision_estado)
      values ('${WS}', '${NEG}', 'actividad', 'Tour', 'por_cobrar')`)).toMatch(/comision_coherente/)
    expect(await falla(`insert into public.negocio_servicios (workspace_id, negocio_id, tipo, nombre, comision_esperada, comision_estado)
      values ('${WS}', '${NEG}', 'actividad', 'Tour', 45000, 'por_cobrar')`)).toBeNull()
    await db.exec(`delete from public.negocio_servicios`)
  })

  it('RLS por workspace: la sesión de un workspace no ve ni escribe filas de otro', async () => {
    await db.exec(servicio({ item: ITEM }))
    await db.exec(servicio({ ws: WS2, neg: NEG2, item: ITEM2 }))
    await db.exec(`set app.ws = '${WS}'; set role authenticated;`)
    try {
      const r = await db.query<{ n: number }>(`select count(*)::int as n from public.negocio_servicios`)
      expect(r.rows[0].n).toBe(1)
      expect(await falla(servicio({ ws: WS2, neg: NEG2, item: null }))).toMatch(/row-level security/)
    } finally {
      await db.exec(`reset role; reset app.ws;`)
    }
    await db.exec(`delete from public.negocio_servicios`)
  })

  it('anon no la toca aunque el default viejo se la concediera; authenticated sí (con RLS)', async () => {
    const r = await db.query<{ rol: string; s: boolean; i: boolean }>(`
      select rol, has_table_privilege(rol, 'public.negocio_servicios', 'select') as s,
                  has_table_privilege(rol, 'public.negocio_servicios', 'insert') as i
        from unnest(array['anon', 'authenticated']) as rol order by rol`)
    expect(r.rows.map(f => [f.rol, f.s, f.i])).toEqual([
      ['anon', false, false],
      ['authenticated', true, true],
    ])
  })
})

describe('gastos', () => {
  it('conserva la categoría que solo está en producción y admite las dos de viaje', async () => {
    expect(await falla(`insert into public.gastos (workspace_id, categoria) values ('${WS}', 'categoria_solo_en_produccion')`)).toBeNull()
    expect(await falla(`insert into public.gastos (workspace_id, categoria) values ('${WS}', 'proveedor_viaje')`)).toBeNull()
    expect(await falla(`insert into public.gastos (workspace_id, categoria) values ('${WS}', 'cortesia_viaje')`)).toBeNull()
    expect(await falla(`insert into public.gastos (workspace_id, categoria) values ('${WS}', 'inventada')`)).toMatch(/gastos_categoria_check/)
  })

  it('el titular del medio es empresa o personal', async () => {
    expect(await falla(`insert into public.gastos (workspace_id, categoria, titular_medio) values ('${WS}', 'otros', 'tercero')`)).toMatch(/check/)
    expect(await falla(`insert into public.gastos (workspace_id, categoria, titular_medio, medio_pago) values ('${WS}', 'otros', 'personal', 'tarjeta-edgar')`)).toBeNull()
  })

  it('si el CHECK vivo tiene otra forma, la migración se detiene en vez de reescribirlo', async () => {
    const otra = new PGlite()
    try {
      await otra.exec(esquemaBase({ categoriaCheck: `check (length(categoria) > 0)` }))
      expect(await falla(readFileSync(MIGRACION, 'utf8'), otra)).toMatch(/forma inesperada de gastos_categoria_check/)
    } finally {
      await otra.close()
    }
  })
})

describe('aprobaciones_excepcion', () => {
  const pedir = (estado = 'solicitada', extra = '') => `
    insert into public.aprobaciones_excepcion (workspace_id, negocio_id, entidad_tipo, entidad_id, tipo, estado, huella ${extra ? ', motivo, decidida_por, decidida_at' : ''})
    values ('${WS}', '${NEG}', 'servicio', '${ITEM}', 'medio_personal', '${estado}', 'monto=1180000' ${extra})`

  it('sin escritura para authenticated ni anon: solo lee authenticated (F0-8)', async () => {
    const r = await db.query<{ rol: string; s: boolean; i: boolean; u: boolean; d: boolean }>(`
      select rol,
             has_table_privilege(rol, 'public.aprobaciones_excepcion', 'select') as s,
             has_table_privilege(rol, 'public.aprobaciones_excepcion', 'insert') as i,
             has_table_privilege(rol, 'public.aprobaciones_excepcion', 'update') as u,
             has_table_privilege(rol, 'public.aprobaciones_excepcion', 'delete') as d
        from unnest(array['anon', 'authenticated']) as rol order by rol`)
    expect(r.rows.map(f => [f.rol, f.s, f.i, f.u, f.d])).toEqual([
      ['anon', false, false, false, false],
      ['authenticated', true, false, false, false],
    ])
  })

  it('una sola pedida o vigente por entidad y tipo; una rechazada no estorba la siguiente', async () => {
    expect(await falla(pedir())).toBeNull()
    expect(await falla(pedir())).toMatch(/aprobaciones_excepcion_vigente/)
    await db.exec(`update public.aprobaciones_excepcion set estado = 'rechazada', motivo = 'no', decidida_por = '${STAFF}', decidida_at = now()`)
    expect(await falla(pedir())).toBeNull()
    await db.exec(`delete from public.aprobaciones_excepcion`)
  })

  it('«No aprobar» exige motivo y autor', async () => {
    expect(await falla(pedir('rechazada', `, '  ', '${STAFF}', now()`))).toMatch(/rechazo_con_motivo/)
    expect(await falla(pedir('aprobada'))).toMatch(/decision_con_autor/)
    expect(await falla(pedir('rechazada', `, 'Sin anticipo todavía', '${STAFF}', now()`))).toBeNull()
    await db.exec(`delete from public.aprobaciones_excepcion`)
  })
})

describe('notificaciones y bloque', () => {
  it('admite los tipos y entidades nuevos sin perder lo que había', async () => {
    expect(await falla(`insert into public.notificaciones (tipo, entidad_tipo) values ('tipo_solo_en_produccion', 'negocio')`)).toBeNull()
    expect(await falla(`insert into public.notificaciones (tipo, entidad_tipo) values ('pago_proveedor_por_vencer', 'servicio')`)).toBeNull()
    expect(await falla(`insert into public.notificaciones (tipo, entidad_tipo) values ('aprobacion_pendiente', 'plan_pago')`)).toBeNull()
    expect(await falla(`insert into public.notificaciones (tipo) values ('inventado')`)).toMatch(/notificaciones_tipo_check/)
  })

  it('crea la definición del bloque «servicios» con su código', async () => {
    const r = await db.query<{ codigo: string; nombre: string }>(`select codigo, nombre from public.bloque_definitions where tipo = 'servicios'`)
    expect(r.rows).toEqual([{ codigo: 'B32', nombre: 'Servicios del viaje' }])
    expect(await falla(`insert into public.bloque_definitions (tipo) values ('inventado')`)).toMatch(/bloque_definitions_tipo_check/)
  })
})
