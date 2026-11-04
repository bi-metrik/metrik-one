import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración 20261104210000 en PGlite: las tres tablas del carrito server-only, las dos funciones del asistente
 * (`carrito_guardar_lineas`, `carrito_emitir_pago`) con sus reglas, el trigger que congela las líneas, el cambio de
 * `ferreteria_ventas` (varias ventas por negocio, una por línea) y el retiro de `ferreteria_links_bold` solo vacía.
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261104210000_carritos_asistentes.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const P1 = '00000000-0000-4000-8000-0000000000b1'
const P2 = '00000000-0000-4000-8000-0000000000b2'
const NEG = '00000000-0000-4000-8000-0000000000d1'

const esquemaBase = (linksConFila: boolean) => `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.workspaces (id uuid primary key);
  create table public.negocios (id uuid primary key);
  create table public.ferreteria_ventas (id uuid primary key default gen_random_uuid(), negocio_id uuid references public.negocios(id));
  create unique index ferreteria_ventas_negocio_unico on public.ferreteria_ventas (negocio_id) where negocio_id is not null;
  create table public.ferreteria_links_bold (id uuid primary key default gen_random_uuid());
  ${linksConFila ? 'insert into public.ferreteria_links_bold default values;' : ''}
  insert into public.workspaces values ('${WS}');
  insert into public.negocios values ('${NEG}');
`

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.query(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

const linea = (id: string, codigo: string, cantidad: number, precio: number) =>
  ({ item_tipo: 'ferreteria_publicacion', item_id: id, codigo, descripcion: `Producto ${codigo}`, cantidad, precio_unitario: precio })

async function guardar(conv: number, lineas: unknown[], abandono = '7 days'): Promise<string | null> {
  const r = await db.query<{ id: string | null }>(
    `select public.carrito_guardar_lineas('${WS}', 'ferreteria', 77, ${conv}, 'otro', null, $1::jsonb, '${abandono}'::interval) as id`,
    [JSON.stringify(lineas)],
  )
  return r.rows[0].id
}

async function carrito(id: string) {
  const r = await db.query<{ estado: string; version: number; subtotal: string; total: string | null; flete: string | null }>(
    `select estado, version, subtotal, total, flete from public.carritos where id = '${id}'`,
  )
  return r.rows[0]
}

const emitir = (id: string, version: number, ref: string, huella: string, monto = 265000, flete = 15000) =>
  `select public.carrito_emitir_pago('${WS}', '${id}', ${version}, 'bogota', 'despacho', ${flete}, 'Ana Pérez', '3001234567', 'Calle 1 # 2-3',
    '${ref}', 'https://checkout.bold.co/${ref}', '${huella}', ${monto}, now() + interval '24 hours') as id`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(esquemaBase(false))
  await db.exec(readFileSync(MIGRACION, 'utf8'))
})

afterAll(async () => {
  await db.close()
})

describe('carritos: esquema', () => {
  it('las tres tablas son server-only y las funciones no las ejecuta ni anon ni authenticated', async () => {
    for (const t of ['carritos', 'carrito_lineas', 'carrito_pagos']) {
      const r = await db.query<{ ok: boolean }>(
        `select bool_or(has_table_privilege(r, 'public.${t}', 'select')) as ok from unnest(array['anon', 'authenticated']) r`,
      )
      expect(r.rows[0].ok, t).toBe(false)
    }
    for (const f of ['carrito_guardar_lineas(uuid, text, bigint, bigint, text, bigint, jsonb, interval)', 'carrito_emitir_pago(uuid, uuid, integer, text, text, numeric, text, text, text, text, text, text, numeric, timestamptz)']) {
      const r = await db.query<{ anon: boolean; aut: boolean; svc: boolean }>(
        `select has_function_privilege('anon', 'public.${f}', 'execute') as anon, has_function_privilege('authenticated', 'public.${f}', 'execute') as aut,
                has_function_privilege('service_role', 'public.${f}', 'execute') as svc`,
      )
      expect(r.rows[0]).toEqual({ anon: false, aut: false, svc: true })
    }
  })

  it('ferreteria_links_bold vacía se retira; ferreteria_ventas admite varias ventas por negocio, una por línea', async () => {
    const t = await db.query<{ t: string | null }>(`select to_regclass('public.ferreteria_links_bold')::text as t`)
    expect(t.rows[0].t).toBeNull()
    await db.query(`insert into public.ferreteria_ventas (negocio_id) values ('${NEG}'), ('${NEG}')`)
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.ferreteria_ventas where negocio_id = '${NEG}'`)
    expect(n.rows[0].n).toBe(2)
  })

  it('la migración aborta si ferreteria_links_bold tiene filas', async () => {
    const otra = new PGlite()
    await otra.exec(esquemaBase(true))
    await expect(otra.exec(readFileSync(MIGRACION, 'utf8'))).rejects.toThrow(/ferreteria_links_bold tiene 1 filas/)
    await otra.close()
  })
})

describe('carrito_guardar_lineas', () => {
  it('crea el carrito con sus líneas; las mismas líneas no suben la versión; un cambio sí', async () => {
    const id = (await guardar(1, [linea(P1, 'MP-62', 1, 250000)]))!
    expect(await carrito(id)).toMatchObject({ estado: 'abierto', version: 1, subtotal: '250000.00', total: null })
    expect(await guardar(1, [linea(P1, 'MP-62', 1, 250000)])).toBe(id)
    expect((await carrito(id)).version).toBe(1)
    expect(await guardar(1, [linea(P1, 'MP-62', 1, 250000), linea(P2, 'MP-64', 2, 30000)])).toBe(id)
    expect(await carrito(id)).toMatchObject({ version: 2, subtotal: '310000.00' })
    const ls = await db.query<{ codigo: string; subtotal: string }>(`select codigo, subtotal from public.carrito_lineas where carrito_id = '${id}' order by orden`)
    expect(ls.rows).toEqual([{ codigo: 'MP-62', subtotal: '250000.00' }, { codigo: 'MP-64', subtotal: '60000.00' }])
  })

  it('a lo sumo un carrito vivo por conversación', async () => {
    const id = (await guardar(1, [linea(P1, 'MP-62', 1, 250000)]))!
    expect(await falla(`insert into public.carritos (workspace_id, dominio, chatwoot_cuenta_id, chatwoot_conversacion_id, canal)
      values ('${WS}', 'ferreteria', 77, 1, 'otro')`)).toMatch(/carritos_uno_vivo_por_conversacion/)
    expect(id).toBeTruthy()
  })

  it('sin líneas cancela el carrito; uno sin cambios en 7 días se abandona y empieza otro', async () => {
    const id = (await guardar(2, [linea(P1, 'MP-62', 1, 250000)]))!
    expect(await guardar(2, [])).toBe(id)
    expect((await carrito(id)).estado).toBe('cancelado')
    expect(await guardar(2, [])).toBeNull()

    const viejo = (await guardar(3, [linea(P1, 'MP-62', 1, 250000)]))!
    await db.query(`update public.carritos set actividad_at = now() - interval '8 days' where id = '${viejo}'`)
    const nuevo = await guardar(3, [linea(P2, 'MP-64', 1, 30000)])
    expect(nuevo).not.toBe(viejo)
    expect((await carrito(viejo)).estado).toBe('abandonado')
  })
})

describe('carrito_emitir_pago', () => {
  it('congela el carrito con UN flete; la misma huella devuelve el mismo pago; las líneas ya no cambian', async () => {
    const id = (await guardar(10, [linea(P1, 'MP-62', 1, 220000), linea(P2, 'MP-64', 1, 30000)]))!
    const p1 = (await db.query<{ id: string }>(emitir(id, 1, 'LNK_A1', 'h-a1'))).rows[0].id
    expect(await carrito(id)).toMatchObject({ estado: 'en_pago', flete: '15000.00', total: '265000.00' })
    expect((await db.query<{ id: string }>(emitir(id, 1, 'LNK_A1', 'h-a1'))).rows[0].id).toBe(p1)
    expect(await falla(`update public.carrito_lineas set cantidad = 3 where carrito_id = '${id}'`)).toMatch(/sus líneas no cambian/)
    expect(await falla(`delete from public.carrito_lineas where carrito_id = '${id}'`)).toMatch(/no se borran/)
    // Anotar la venta sí se puede.
    expect(await falla(`update public.carrito_lineas set venta_id = gen_random_uuid() where carrito_id = '${id}' and orden = 1`)).toBeNull()
  })

  it('otra versión no cobra; un monto que no es subtotal + flete tampoco', async () => {
    const id = (await guardar(11, [linea(P1, 'MP-62', 1, 250000)]))!
    expect(await falla(emitir(id, 9, 'LNK_B1', 'h-b1'))).toMatch(/carrito_cambio/)
    expect(await falla(emitir(id, 1, 'LNK_B1', 'h-b1', 999))).toMatch(/monto_no_cuadra/)
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.carrito_pagos where carrito_id = '${id}'`)
    expect(n.rows[0].n).toBe(0)
  })

  it('cambiar un carrito en pago lo reabre y anula su link; con un pago en curso no se toca', async () => {
    const id = (await guardar(12, [linea(P1, 'MP-62', 1, 250000)]))!
    await db.query(emitir(id, 1, 'LNK_C1', 'h-c1'))
    expect(await guardar(12, [linea(P1, 'MP-62', 1, 250000), linea(P2, 'MP-64', 1, 30000)])).toBe(id)
    expect(await carrito(id)).toMatchObject({ estado: 'abierto', version: 2, total: '295000.00' })
    const c1 = await db.query<{ estado: string; motivo: string }>(`select estado, motivo from public.carrito_pagos where referencia = 'LNK_C1'`)
    expect(c1.rows[0]).toMatchObject({ estado: 'vencido' })
    expect(c1.rows[0].motivo).toMatch(/reemplazado/)

    await db.query(emitir(id, 2, 'LNK_C2', 'h-c2', 295000))
    await db.query(`update public.carrito_pagos set estado = 'procesando' where referencia = 'LNK_C2'`)
    expect(await falla(`select public.carrito_guardar_lineas('${WS}', 'ferreteria', 77, 12, 'otro', null, '[]'::jsonb)`)).toMatch(/carrito_pagado/)
    expect(await falla(emitir(id, 2, 'LNK_C3', 'h-c3', 295000))).toMatch(/carrito_pagado/)
  })

  it('un segundo link de la misma versión reemplaza al primero; a lo sumo un pago aprobado', async () => {
    const id = (await guardar(13, [linea(P1, 'MP-62', 1, 250000)]))!
    await db.query(emitir(id, 1, 'LNK_D1', 'h-d1'))
    await db.query(emitir(id, 1, 'LNK_D2', 'h-d2'))
    const r = await db.query<{ referencia: string; estado: string }>(`select referencia, estado from public.carrito_pagos where carrito_id = '${id}' order by referencia`)
    expect(r.rows).toEqual([{ referencia: 'LNK_D1', estado: 'vencido' }, { referencia: 'LNK_D2', estado: 'creado' }])
    await db.query(`update public.carrito_pagos set estado = 'aprobado' where referencia = 'LNK_D2'`)
    expect(await falla(`update public.carrito_pagos set estado = 'aprobado' where referencia = 'LNK_D1'`)).toMatch(/carrito_pagos_un_aprobado/)
  })

  it('registrado exige negocio', async () => {
    const id = (await guardar(14, [linea(P1, 'MP-62', 1, 250000)]))!
    await db.query(emitir(id, 1, 'LNK_E1', 'h-e1'))
    expect(await falla(`update public.carritos set estado = 'registrado' where id = '${id}'`)).toMatch(/registrado_con_negocio/)
    expect(await falla(`update public.carritos set estado = 'registrado', negocio_id = '${NEG}' where id = '${id}'`)).toBeNull()
  })
})
