import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de la categoría de las fotos de hotel (`20261016221500`), su dry-run y su reversa,
 * corridos de verdad en Postgres en memoria (PGlite) sobre las dos migraciones de la biblioteca
 * cargadas TAL CUAL.
 */
const raiz = process.cwd()
const migracion = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const sql = (a: string) => readFileSync(join(raiz, 'sql/fotos', a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000a1'

const BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create table public.workspaces (id uuid primary key);
  create table public.staff (id uuid primary key);
  create function public.current_user_workspace_id() returns uuid language sql stable as $$ select null::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  insert into public.workspaces values ('${WS}');
`

const fila = (posicion: number) => `
  insert into public.fotos_catalogo (workspace_id, tipo, clave, nombre_clave, nombre, ref, origen, revisada, posicion, principal)
  values ('${WS}', 'hotel', 'arts|barcelona', 'arts', 'Arts', 'one://fotos-catalogo/${WS}/hotel/${String(posicion).padStart(16, '0')}.jpg', 'asesora', true, ${posicion}, ${posicion === 1});
`

const tieneColumna = async (db: PGlite) =>
  (await db.query<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_name = 'fotos_catalogo' and column_name = 'categoria'`)).rows[0].n === 1

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await db.exec(migracion('20261014221500_fotos_catalogo.sql'))
  await db.exec(migracion('20261016153000_fotos_catalogo_tres_por_elemento.sql'))
  await db.exec(fila(1) + fila(2))
})
afterAll(async () => db.close())

describe('fotos_catalogo.categoria', () => {
  it('el dry-run dice OK y no deja nada escrito', async () => {
    const r = await db.exec(sql('2026-10-16_dry-run_fotos-catalogo-categoria.sql')).then(() => 'sin error', (e: Error) => e.message)
    expect(r).toMatch(/^DRY-RUN OK /)
    expect(r).toContain('check_valido=t')
    expect(r).toContain('check_invalido=t')
    expect(await tieneColumna(db)).toBe(false)
  })

  it('la migración agrega la columna: las filas viejas quedan sin categoría y el CHECK frena lo que no es una categoría', async () => {
    await db.exec(migracion('20261016221500_fotos_catalogo_categoria.sql'))
    const filas = (await db.query<{ categoria: string | null }>('select categoria from public.fotos_catalogo')).rows
    expect(filas).toHaveLength(2)
    expect(filas.every((f) => f.categoria === null)).toBe(true)
    await db.exec(`update public.fotos_catalogo set categoria = 'zonas_comunes' where posicion = 2`)
    await expect(db.exec(`update public.fotos_catalogo set categoria = 'no_es_hotel' where posicion = 1`)).rejects.toThrow(/fotos_catalogo_categoria_check/)
  })

  it('la reversa la quita sin tocar las fotos', async () => {
    await db.exec(sql('2026-10-16_reversa_fotos-catalogo-categoria.sql'))
    expect(await tieneColumna(db)).toBe(false)
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.fotos_catalogo')).rows[0].n).toBe(2)
  })
})
