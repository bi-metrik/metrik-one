import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La consulta de las fichas que creó sola la tarjeta (brief del 2026-10-20, punto 2), corrida de
 * verdad en Postgres en memoria sobre las migraciones de fotos y proveedores TAL CUAL. Es de solo
 * lectura: aquí se comprueba que corre, que filtra por espacio y que separa lo que tiene rastro.
 * Fichas y líneas ficticias.
 */
const raiz = process.cwd()
const migracion = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const consulta = readFileSync(join(raiz, 'sql/proveedores/2026-10-20_fichas-creadas-solas.sql'), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000f1'
const OTRO_WS = '00000000-0000-4000-8000-0000000000f2'
const COT = '00000000-0000-4000-8000-00000000c0f1'

const BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.workspaces (id uuid primary key);
  create table public.staff (id uuid primary key, workspace_id uuid, full_name text, is_active boolean default true);
  create function public.current_user_workspace_id() returns uuid language sql stable as $$ select null::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table public.cotizaciones (id uuid primary key default gen_random_uuid(), workspace_id uuid, estado text default 'borrador');
  create table public.items (id uuid primary key default gen_random_uuid(), cotizacion_id uuid, nombre text, grupo text, es_ajuste boolean default false, tarifa_pax jsonb, subtotal numeric, created_at timestamptz default now());
  insert into public.workspaces values ('${WS}'), ('${OTRO_WS}');
  insert into public.cotizaciones (id, workspace_id) values ('${COT}', '${WS}');
`

let db: PGlite

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
    '20261019130000_proveedores_temporadas_iva.sql',
    '20261019233000_items_proveedor.sql',
  ]) await db.exec(migracion(m))
  const ficha = (ws: string, tipo: string, nombre: string, origen = 'cotizacion') =>
    db.exec(`insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre, ciudad, origen) values ('${ws}', '${tipo}', '${nombre.toLowerCase()}|santa marta', '${nombre}', 'Santa Marta', '${origen}')`)
  await ficha(WS, 'actividad', 'City Tour Ficticio')
  await ficha(WS, 'hotel', 'Hotel Ficticio Leído')
  await ficha(WS, 'actividad', 'Tour Ficticio Huérfano')
  await ficha(WS, 'hotel', 'Hotel Ficticio Importado', 'importacion')
  await ficha(OTRO_WS, 'actividad', 'City Tour Ficticio')
  const manual = { casillas: { grupo_completo: { origen: 'manual', nombre: 'City Tour Ficticio', total: 210000, moneda: 'COP' } } }
  const leido = { casillas: { grupo_completo: { nombre: 'Hotel Ficticio Leído', identidad: { hotel: 'Hotel Ficticio Leído' }, total: 900000, moneda: 'COP' } } }
  await db.exec(`insert into public.items (cotizacion_id, nombre, grupo, tarifa_pax) values
    ('${COT}', 'CITY TOUR FICTICIO', 'actividad', '${JSON.stringify(manual)}'),
    ('${COT}', 'HOTEL FICTICIO LEÍDO', 'hotel', '${JSON.stringify(leido)}')`)
})

afterAll(async () => {
  await db.close()
})

describe('fichas creadas solas por la tarjeta', () => {
  it('corre, filtra por espacio y deja fuera las importadas', async () => {
    const r = await db.query<{ nombre: string; lineas_a_mano: number; lineas_pantallazo: number; sin_rastro: boolean }>(consulta.replaceAll('<workspace_id>', WS))
    const porNombre = Object.fromEntries(r.rows.map((x) => [x.nombre, x]))
    expect(Object.keys(porNombre).sort()).toEqual(['City Tour Ficticio', 'Hotel Ficticio Leído', 'Tour Ficticio Huérfano'])
    expect(porNombre['City Tour Ficticio']).toMatchObject({ lineas_a_mano: 1, lineas_pantallazo: 0, sin_rastro: true })
    expect(porNombre['Hotel Ficticio Leído']).toMatchObject({ lineas_a_mano: 0, lineas_pantallazo: 1, sin_rastro: false })
    expect(porNombre['Tour Ficticio Huérfano']).toMatchObject({ lineas_a_mano: 0, sin_rastro: true })
  })

  it('no escribe nada', async () => {
    const antes = (await db.query<{ n: number }>('select count(*)::int as n from public.fotos_perfiles')).rows[0].n
    await db.query(consulta.replaceAll('<workspace_id>', WS))
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.fotos_perfiles')).rows[0].n).toBe(antes)
    expect(/\b(insert|update|delete|drop|alter|truncate)\b/i.test(consulta.replace(/--.*$/gm, ''))).toBe(false)
  })
})
