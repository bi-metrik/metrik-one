import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración que le da proveedor a la línea (`20261019233000`), su dry-run y su reversa, corridos
 * de verdad en Postgres en memoria (PGlite) sobre las migraciones de fotos y proveedores TAL CUAL.
 * Fichas ficticias.
 */
const raiz = process.cwd()
const migracion = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const sql = (a: string) => readFileSync(join(raiz, 'sql/proveedores', a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000e1'
const OTRO_WS = '00000000-0000-4000-8000-0000000000e2'
const COT = '00000000-0000-4000-8000-00000000c0e1'
const LINEA = '00000000-0000-4000-8000-0000000011e1'
const MIGRACION = '20261019233000_items_proveedor.sql'
const DRY_RUN = '2026-10-19_dry-run_items-proveedor.sql'

const BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.workspaces (id uuid primary key);
  create table public.staff (id uuid primary key, workspace_id uuid, is_active boolean default true);
  create function public.current_user_workspace_id() returns uuid language sql stable as $$ select null::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table public.cotizaciones (id uuid primary key default gen_random_uuid(), workspace_id uuid, estado text default 'borrador');
  create table public.items (id uuid primary key default gen_random_uuid(), cotizacion_id uuid, subtotal numeric, created_at timestamptz default now());
  insert into public.workspaces values ('${WS}'), ('${OTRO_WS}');
  insert into public.cotizaciones (id, workspace_id) values ('${COT}', '${WS}');
  insert into public.items (id, cotizacion_id, subtotal) values ('${LINEA}', '${COT}', 0);
`

const uno = async <T>(db: PGlite, q: string) => (await db.query<T>(q)).rows[0]
const columna = async (db: PGlite) =>
  (await uno<{ n: number }>(db, `select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'items' and column_name = 'proveedor_id'`)).n

let db: PGlite
let ficha: string
let otra: string
let ajena: string

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  for (const m of [
    '20261014221500_fotos_catalogo.sql',
    '20261016153000_fotos_catalogo_tres_por_elemento.sql',
    '20261016221500_fotos_catalogo_categoria.sql',
    '20261016233000_fotos_catalogo_autorizacion.sql',
    '20261017090000_fotos_perfiles.sql',
    '20261018150000_proveedores.sql',
  ]) await db.exec(migracion(m))
  const nueva = async (ws: string, clave: string) => (await uno<{ id: string }>(db, `insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre, ciudad) values ('${ws}', 'hotel', '${clave}', 'Hotel Ficticio', 'Cartagena') returning id`)).id
  ficha = await nueva(WS, 'hotel ficticio uno|cartagena')
  otra = await nueva(WS, 'hotel ficticio dos|cartagena')
  ajena = await nueva(OTRO_WS, 'hotel ajeno|cartagena')
}, 60_000)
afterAll(async () => db.close())

describe('migración: la línea guarda su proveedor', () => {
  it('el dry-run lleva el cuerpo de la migración tal cual', () => {
    const cuerpo = (/EXECUTE \$mig\$([\s\S]*?)\$mig\$/.exec(sql(DRY_RUN))?.[1] ?? 'no está').trim()
    expect(cuerpo.length).toBeGreaterThan(1500)
    expect(migracion(MIGRACION).trim()).toBe(cuerpo)
  })

  it('el dry-run dice OK, ensaya el trigger y no deja nada escrito', async () => {
    const r = await db.exec(sql(DRY_RUN)).then(() => 'sin error', (e: Error) => e.message)
    expect(r).toMatch(/^DRY-RUN OK /)
    for (const k of ['ya_existia=f', 'items_antes=1', 'items_despues=1', 'nulos=t', 'ensayado=t', 'mismo_ws=t', 'otro_ws=t', 'borrar=t']) expect(r).toContain(k)
    expect(await columna(db)).toBe(0)
    expect((await uno<{ n: number }>(db, `select count(*)::int as n from public.fotos_perfiles`)).n).toBe(3)
  })

  it('la migración: nace NULL; una ficha del mismo espacio entra, la de otro no; borrar la ficha suelta la línea', async () => {
    await db.exec(migracion(MIGRACION))
    expect(await uno(db, `select proveedor_id from public.items where id = '${LINEA}'`)).toEqual({ proveedor_id: null })
    await db.exec(`update public.items set proveedor_id = '${ficha}' where id = '${LINEA}'`)
    await db.exec(`update public.items set proveedor_id = '${otra}' where id = '${LINEA}'`)
    await expect(db.exec(`update public.items set proveedor_id = '${ajena}' where id = '${LINEA}'`)).rejects.toThrow(/mismo espacio/)
    await expect(db.exec(`insert into public.items (cotizacion_id, proveedor_id) values ('${COT}', '${ajena}')`)).rejects.toThrow(/mismo espacio/)
    // Otra columna de la línea se escribe sin pasar por la revisión.
    await db.exec(`update public.items set subtotal = 10 where id = '${LINEA}'`)
    await db.exec(`delete from public.fotos_perfiles where id = '${otra}'`)
    expect(await uno(db, `select proveedor_id, subtotal from public.items where id = '${LINEA}'`)).toEqual({ proveedor_id: null, subtotal: '10' })
  })

  it('la reversa quita todo y la migración vuelve a entrar', async () => {
    await db.exec(sql('2026-10-19_reversa_items-proveedor.sql'))
    expect(await columna(db)).toBe(0)
    expect((await uno<{ n: number }>(db, `select count(*)::int as n from public.items`)).n).toBe(1)
    await db.exec(migracion(MIGRACION))
    expect(await columna(db)).toBe(1)
  })
})

describe('medir de dónde sale el precio (solo lectura)', () => {
  it('cuenta tarifa extraída, ingreso manual, pantallazo, costo a mano y sin costo, solo del espacio pedido', async () => {
    const m = new PGlite()
    await m.exec(`
      create table public.cotizaciones (id uuid primary key, workspace_id uuid);
      create table public.items (id uuid primary key default gen_random_uuid(), cotizacion_id uuid, grupo text, es_ajuste boolean default false, subtotal numeric, tarifa_pax jsonb);
      insert into public.cotizaciones values ('${COT}', '${WS}'), ('00000000-0000-4000-8000-00000000c0e2', '${OTRO_WS}');
      insert into public.items (cotizacion_id, grupo, subtotal, tarifa_pax) values
        ('${COT}', 'hotel', 0, '{"casillas": {"grupo_completo": {"origen": "tarifario"}}, "tarifaExtraida": {"extraccion_id": "x"}}'),
        ('${COT}', 'hotel', 0, '{"casillas": {"grupo_completo": {"origen": "tarifario"}}}'),
        ('${COT}', 'tour', 0, '{"casillas": {"grupo_completo": {"origen": "manual"}}}'),
        ('${COT}', 'vuelo', 0, '{"casillas": {"grupo_completo": {"total": 1}}}'),
        ('${COT}', 'hotel', 0, '{"habitaciones": []}'),
        ('${COT}', 'seguro', 120000, null),
        ('${COT}', 'otro', 0, null),
        ('${COT}', null, 5, null),
        ('00000000-0000-4000-8000-00000000c0e2', 'hotel', 0, '{"casillas": {"grupo_completo": {"origen": "tarifario"}}}');
    `)
    const consulta = sql('2026-10-19_medir-origen-precio.sql').replace(/<workspace_id>/g, WS)
    const filas = (await m.query<{ origen: string; lineas: number; pct: string }>(consulta)).rows
    expect(Object.fromEntries(filas.map((f) => [f.origen, Number(f.lineas)]))).toEqual({ tarifa_extraida: 2, ingreso_manual: 1, pantallazo: 2, costo_a_mano: 1, sin_costo: 1 })
    expect(filas.find((f) => f.origen === 'tarifa_extraida')?.pct).toBe('28.6')
    await m.close()
  })
})
