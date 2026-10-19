import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de fichas, temporadas e IVA (`20261019130000`), su dry-run y su reversa, corridos de
 * verdad en Postgres en memoria (PGlite) sobre las migraciones de fotos y proveedores TAL CUAL.
 */
const raiz = process.cwd()
const migracion = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const sql = (a: string) => readFileSync(join(raiz, 'sql/proveedores', a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000c1'
const OTRO_WS = '00000000-0000-4000-8000-0000000000c2'
const ANA = '00000000-0000-4000-8000-00000000c001'
const MIGRACION = '20261019130000_proveedores_temporadas_iva.sql'
const DRY_RUN = '2026-10-19_dry-run_temporadas-iva.sql'

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
const existe = async (db: PGlite, nombre: string) => (await uno<{ r: string | null }>(db, `select to_regclass('${nombre}')::text as r`)).r !== null

let db: PGlite
let perfil: string

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
  perfil = (await uno<{ id: string }>(db, `insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre, ciudad) values ('${WS}', 'hotel', 'hotel ficticio|cartagena', 'Hotel Ficticio', 'Cartagena') returning id`)).id
  await db.exec(`
    insert into public.cotizaciones (id, workspace_id) values ('00000000-0000-4000-8000-00000000c0c1', '${WS}');
    insert into public.items (cotizacion_id, subtotal) values ('00000000-0000-4000-8000-00000000c0c1', 100000);
  `)
}, 60_000)
afterAll(async () => db.close())

describe('migración de fichas, temporadas e IVA', () => {
  it('el dry-run lleva el cuerpo de la migración tal cual', () => {
    const cuerpo = (/EXECUTE \$mig\$([\s\S]*?)\$mig\$/.exec(sql(DRY_RUN))?.[1] ?? 'no está').trim()
    expect(cuerpo.length).toBeGreaterThan(3000)
    expect(migracion(MIGRACION).trim()).toBe(cuerpo)
  })

  it('el dry-run dice OK, ensaya las reglas y no deja nada escrito', async () => {
    const r = await db.exec(sql(DRY_RUN)).then(() => 'sin error', (e: Error) => e.message)
    expect(r).toMatch(/^DRY-RUN OK /)
    for (const k of ['ya_existia=f', 'nulos=t', 'ensayado=t', 'rango=t', 'fechas=t', 'anio=t', 'canal=t', 'iva=t', 'extraccion=t', 'extraccion_ws=t']) expect(r).toContain(k)
    expect(await existe(db, 'public.temporadas_agencia')).toBe(false)
    expect(await existe(db, 'public.proveedor_extracciones')).toBe(false)
  })

  it('la migración: columnas nulas, temporadas con sus reglas, IVA de línea acotado', async () => {
    await db.exec(migracion(MIGRACION))
    expect(await uno(db, `select departamento, destino, iva_declarado, tarifa_canal from public.fotos_perfiles where id = '${perfil}'`)).toEqual({ departamento: null, destino: null, iva_declarado: null, tarifa_canal: null })
    await db.exec(`update public.fotos_perfiles set departamento = 'Bolívar', destino = 'Caribe - Cartagena', iva_declarado = true, iva_incluido = false, tarifa_canal = 'neta' where id = '${perfil}'`)
    await expect(db.exec(`update public.fotos_perfiles set tarifa_canal = 'publica' where id = '${perfil}'`)).rejects.toThrow(/tarifa_canal_check/)
    // La llave sigue sin cambiar aunque cambie la ciudad (trigger de 20261018150000).
    await db.exec(`update public.fotos_perfiles set ciudad = 'Turbaco' where id = '${perfil}'`)
    expect((await uno<{ clave: string }>(db, `select clave from public.fotos_perfiles where id = '${perfil}'`)).clave).toBe('hotel ficticio|cartagena')

    await db.exec(`insert into public.temporadas_agencia (workspace_id, anio, temporada, desde, hasta) values ('${WS}', 2026, 'alta', '2026-12-15', '2027-01-15')`)
    await expect(db.exec(`insert into public.temporadas_agencia (workspace_id, anio, temporada, desde, hasta) values ('${WS}', 2026, 'pico', '2026-01-01', '2026-01-02')`)).rejects.toThrow(/temporada_check/)
    await expect(db.exec(`insert into public.temporadas_agencia (workspace_id, anio, temporada, desde, hasta) values ('${WS}', 2026, 'baja', '2026-01-01', '2027-06-01')`)).rejects.toThrow(/temporadas_agencia_fechas/)

    await db.exec(`update public.items set iva_costo_pct = 19`)
    await expect(db.exec(`update public.items set iva_costo_pct = 0`)).rejects.toThrow(/iva_costo_pct_check/)
    await db.exec(`update public.cotizaciones set costos_con_iva = true, viajero_residente = false`)

    await db.exec(`insert into public.proveedor_extracciones (workspace_id, proveedor_id, esquema_version, expediente, archivos) values ('${WS}', '${perfil}', '0.2', '{"archivos": []}', '{tar0.pdf}')`)
    await expect(db.exec(`insert into public.proveedor_extracciones (workspace_id, proveedor_id, esquema_version, expediente) values ('${WS}', '${perfil}', 'v2', '{}')`)).rejects.toThrow(/esquema_version_check/)
  })

  it('ninguna tabla nueva queda para anon; temporadas sí para la sesión, extracciones solo servidor', async () => {
    const priv = async (rol: string, tabla: string) => (await uno<{ p: boolean }>(db, `select has_table_privilege('${rol}', 'public.${tabla}', 'select') as p`)).p
    expect(await priv('anon', 'temporadas_agencia')).toBe(false)
    expect(await priv('authenticated', 'temporadas_agencia')).toBe(true)
    expect(await priv('authenticated', 'proveedor_extracciones')).toBe(false)
  })

  it('la reversa quita todo y la migración vuelve a entrar', async () => {
    await db.exec(sql('2026-10-19_reversa_temporadas-iva.sql'))
    expect(await existe(db, 'public.temporadas_agencia')).toBe(false)
    expect(await existe(db, 'public.proveedor_extracciones')).toBe(false)
    expect((await uno<{ n: number }>(db, `select count(*)::int as n from information_schema.columns where table_name = 'items' and column_name = 'iva_costo_pct'`)).n).toBe(0)
    expect((await uno<{ n: number }>(db, `select count(*)::int as n from public.fotos_perfiles`)).n).toBe(1)
    await db.exec(migracion(MIGRACION))
  })
})
