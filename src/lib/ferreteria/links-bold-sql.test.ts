import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración 20261029150000 en PGlite: `ferreteria_links_bold` server-only, un link por referencia y por huella, a lo
 * sumo una venta por link; `ferreteria_ventas.cantidad` con default 1 (las ventas de siempre no cambian) e Instagram
 * como canal de conversación (el CHECK de la tabla original, nombrado como lo nombra Postgres).
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261029150000_ferreteria_links_bold.sql')
const WS = '00000000-0000-4000-8000-0000000000a1'
const PUB = '00000000-0000-4000-8000-0000000000b1'
const VENTA = '00000000-0000-4000-8000-0000000000c1'

const ESQUEMA_BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.workspaces (id uuid primary key);
  create table public.ferreteria_publicaciones (id uuid primary key);
  create table public.ferreteria_ventas (id uuid primary key, precio_final numeric not null default 1);
  create table public.ferreteria_conversaciones (
    id uuid primary key default gen_random_uuid(), workspace_id uuid, clave text,
    canal text not null check (canal in ('messenger', 'whatsapp'))
  );
  insert into public.workspaces values ('${WS}');
  insert into public.ferreteria_publicaciones values ('${PUB}');
  insert into public.ferreteria_ventas (id) values ('${VENTA}');
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

const link = (ref: string, huella: string, extra: Record<string, string> = {}) => {
  const cols: Record<string, string> = {
    workspace_id: `'${WS}'`, referencia: `'${ref}'`, url: `'https://checkout.bold.co/${ref}'`, huella: `'${huella}'`, publicacion_id: `'${PUB}'`,
    cantidad: '1', precio_unitario: '250000', flete: '15000', monto: '265000', zona: `'bogota'`, ruta: `'despacho'`,
    comprador_nombre: `'Ana Pérez'`, comprador_telefono: `'3001234567'`, chatwoot_cuenta_id: '77', chatwoot_conversacion_id: '9001', canal: `'instagram'`, ...extra,
  }
  return `insert into public.ferreteria_links_bold (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})`
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
})

afterAll(async () => {
  await db.close()
})

describe('ferreteria_links_bold', () => {
  it('server-only: ni anon ni authenticated', async () => {
    const r = await db.query<{ rol: string; ok: boolean }>(
      `select r as rol, has_table_privilege(r, 'public.ferreteria_links_bold', 'select') as ok from unnest(array['anon', 'authenticated']) r`,
    )
    expect(r.rows.every((x) => !x.ok)).toBe(true)
  })

  it('un link por referencia y por huella; la referencia tiene la forma de Bold; cantidad de 1 a 3', async () => {
    expect(await falla(link('LNK_A1', 'h1'))).toBeNull()
    expect(await falla(link('LNK_A1', 'h2'))).toMatch(/referencia_unica/)
    expect(await falla(link('LNK_A2', 'h1'))).toMatch(/huella_unica/)
    expect(await falla(link('PAGO-1', 'h3'))).toMatch(/check/)
    expect(await falla(link('LNK_A3', 'h4', { cantidad: '4' }))).toMatch(/check/)
  })

  it('reclamado_at existe; borrar la venta suelta el link (on delete set null)', async () => {
    await db.query(`insert into public.ferreteria_ventas (id) values ('00000000-0000-4000-8000-0000000000c9')`)
    expect(await falla(link('LNK_D1', 'hd', { venta_id: `'00000000-0000-4000-8000-0000000000c9'`, reclamado_at: 'now()' }))).toBeNull()
    await db.query(`delete from public.ferreteria_ventas where id = '00000000-0000-4000-8000-0000000000c9'`)
    const r = await db.query<{ venta_id: string | null }>(`select venta_id from public.ferreteria_links_bold where referencia = 'LNK_D1'`)
    expect(r.rows[0].venta_id).toBeNull()
  })

  it('registrada exige venta, y una venta es de un solo link', async () => {
    expect(await falla(`update public.ferreteria_links_bold set registro = 'registrada' where referencia = 'LNK_A1'`)).toMatch(/registrada_con_venta/)
    expect(await falla(`update public.ferreteria_links_bold set registro = 'registrada', venta_id = '${VENTA}' where referencia = 'LNK_A1'`)).toBeNull()
    expect(await falla(link('LNK_B1', 'hb'))).toBeNull()
    expect(await falla(`update public.ferreteria_links_bold set venta_id = '${VENTA}' where referencia = 'LNK_B1'`)).toMatch(/venta_unica/)
  })
})

describe('ventas y conversaciones', () => {
  it('cantidad nace en 1 para las ventas de siempre y se acota', async () => {
    const r = await db.query<{ cantidad: number }>(`select cantidad from public.ferreteria_ventas where id = '${VENTA}'`)
    expect(r.rows[0].cantidad).toBe(1)
    expect(await falla(`update public.ferreteria_ventas set cantidad = 0`)).toMatch(/check/)
  })

  it('Instagram entra como canal; un canal desconocido no', async () => {
    expect(await falla(`insert into public.ferreteria_conversaciones (canal) values ('instagram')`)).toBeNull()
    expect(await falla(`insert into public.ferreteria_conversaciones (canal) values ('tiktok')`)).toMatch(/check/)
  })
})
