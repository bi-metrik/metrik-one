import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración del motor v13 (`20261019203000`), su dry-run y su reversa, corridos de verdad en
 * Postgres en memoria (PGlite) sobre las migraciones de fotos y proveedores TAL CUAL.
 */
const raiz = process.cwd()
const migracion = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const sql = (a: string) => readFileSync(join(raiz, 'sql/proveedores', a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000d1'
const OTRO_WS = '00000000-0000-4000-8000-0000000000d2'
const ANA = '00000000-0000-4000-8000-00000000d001'
const MIGRACION = '20261019203000_proveedores_motor_v13.sql'
const DRY_RUN = '2026-10-19_dry-run_motor-v13.sql'

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
  create table public.items (id uuid primary key default gen_random_uuid(), cotizacion_id uuid, subtotal numeric);
  insert into public.workspaces values ('${WS}'), ('${OTRO_WS}');
  insert into public.staff (id, workspace_id) values ('${ANA}', '${WS}');
`

const uno = async <T>(db: PGlite, q: string) => (await db.query<T>(q)).rows[0]
const columnas = async (db: PGlite) =>
  (await uno<{ n: number }>(db, `select count(*)::int as n from information_schema.columns where table_schema = 'public' and column_name in ('vigencia_desde', 'vigencia_hasta', 'vigencia_por', 'monedas', 'tarifario_de_id', 'tarifario_establecimiento')`)).n

let db: PGlite
let cadena: string
let sucursal: string
let ajeno: string

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
  ]) await db.exec(migracion(m))
  const nueva = async (ws: string, clave: string) => (await uno<{ id: string }>(db, `insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre, ciudad) values ('${ws}', 'hotel', '${clave}', 'Hotel Ficticio', 'Cartagena') returning id`)).id
  cadena = await nueva(WS, 'cadena ficticia centro|cartagena')
  sucursal = await nueva(WS, 'cadena ficticia playa|cartagena')
  ajeno = await nueva(OTRO_WS, 'hotel ajeno|cartagena')
  await db.exec(`insert into public.proveedor_extracciones (workspace_id, proveedor_id, esquema_version, expediente) values ('${WS}', '${cadena}', '0.2', '{"archivos": []}')`)
}, 60_000)
afterAll(async () => db.close())

describe('migración del motor v13', () => {
  it('el dry-run lleva el cuerpo de la migración tal cual', () => {
    const cuerpo = (/EXECUTE \$mig\$([\s\S]*?)\$mig\$/.exec(sql(DRY_RUN))?.[1] ?? 'no está').trim()
    expect(cuerpo.length).toBeGreaterThan(2000)
    expect(migracion(MIGRACION).trim()).toBe(cuerpo)
  })

  it('el dry-run dice OK, ensaya las reglas y no deja nada escrito', async () => {
    const r = await db.exec(sql(DRY_RUN)).then(() => 'sin error', (e: Error) => e.message)
    expect(r).toMatch(/^DRY-RUN OK /)
    for (const k of ['ya_existia=f', 'revisadas_antes=0', 'nulos=t', 'ensayado=t', 'cerrar_sin_vigencia=t', 'cerrar=t', 'fechas=t', 'monedas=t', 'mismo=t', 'cadena=t', 'cadena_ws=t']) expect(r).toContain(k)
    expect(await columnas(db)).toBe(0)
  })

  it('la migración: una carga cerrada exige vigencia; monedas en {}; la cadena entre fichas del mismo espacio', async () => {
    await db.exec(migracion(MIGRACION))
    expect(await uno(db, `select vigencia_desde, vigencia_hasta, vigencia_por, monedas from public.proveedor_extracciones`)).toEqual({ vigencia_desde: null, vigencia_hasta: null, vigencia_por: null, monedas: {} })
    await expect(db.exec(`update public.proveedor_extracciones set estado = 'revisada', revisada_por = '${ANA}', revisada_at = now()`)).rejects.toThrow(/revisada_con_vigencia/)
    await db.exec(`update public.proveedor_extracciones set estado = 'revisada', revisada_por = '${ANA}', revisada_at = now(), vigencia_desde = '2027-01-01', vigencia_hasta = '2027-12-31', vigencia_por = 'persona', monedas = '{"establecimientos": {"Cadena Ficticia Playa": "USD"}}'`)
    await expect(db.exec(`update public.proveedor_extracciones set vigencia_hasta = '2026-12-31'`)).rejects.toThrow(/proveedor_extracciones_vigencia/)
    await expect(db.exec(`update public.proveedor_extracciones set vigencia_por = 'nombre_archivo'`)).rejects.toThrow(/vigencia_por_check/)
    await expect(db.exec(`update public.proveedor_extracciones set monedas = '"USD"'`)).rejects.toThrow(/monedas_check/)

    await db.exec(`update public.fotos_perfiles set tarifario_de_id = '${cadena}', tarifario_establecimiento = 'Cadena Ficticia Playa' where id = '${sucursal}'`)
    await expect(db.exec(`update public.fotos_perfiles set tarifario_de_id = id where id = '${cadena}'`)).rejects.toThrow(/no_es_el_mismo/)
    await expect(db.exec(`update public.fotos_perfiles set tarifario_de_id = '${cadena}' where id = '${ajeno}'`)).rejects.toThrow(/tarifario_de_fk/)
    // Si se borra la ficha de la cadena, la sucursal se queda sin «tarifario de» pero conserva su workspace.
    await db.exec(`delete from public.fotos_perfiles where id = '${cadena}'`)
    expect(await uno(db, `select tarifario_de_id, workspace_id from public.fotos_perfiles where id = '${sucursal}'`)).toEqual({ tarifario_de_id: null, workspace_id: WS })
  })

  it('la reversa quita todo y la migración vuelve a entrar', async () => {
    await db.exec(sql('2026-10-19_reversa_motor-v13.sql'))
    expect(await columnas(db)).toBe(0)
    expect((await uno<{ n: number }>(db, `select count(*)::int as n from public.fotos_perfiles`)).n).toBe(2)
    await db.exec(migracion(MIGRACION))
    expect(await columnas(db)).toBe(6)
  })
})
