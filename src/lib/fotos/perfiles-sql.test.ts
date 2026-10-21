import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de los perfiles de hotel y de tour (`20261017090000`), su dry-run y su reversa,
 * corridos de verdad en Postgres en memoria (PGlite) sobre las cuatro migraciones de la biblioteca
 * cargadas TAL CUAL.
 */
const raiz = process.cwd()
const migracion = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const sql = (a: string) => readFileSync(join(raiz, 'sql/fotos', a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000a1'
const OTRO_WS = '00000000-0000-4000-8000-0000000000a2'
const MIGRACION = '20261017090000_fotos_perfiles.sql'
const DRY_RUN = '2026-10-17_dry-run_fotos-perfiles.sql'

const BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.workspaces (id uuid primary key);
  create table public.staff (id uuid primary key);
  create function public.current_user_workspace_id() returns uuid language sql stable as $$ select null::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  insert into public.workspaces values ('${WS}'), ('${OTRO_WS}');
`

const foto = (clave: string, posicion: number) => `
  insert into public.fotos_catalogo (workspace_id, tipo, clave, nombre_clave, nombre, ref, origen, revisada, posicion, principal)
  values ('${WS}', 'hotel', '${clave}', 'catalonia', 'Catalonia', 'one://fotos-catalogo/${WS}/hotel/${String(posicion).padStart(16, '0')}.jpg', 'asesora', true, ${posicion}, ${posicion === 1});
`

const existe = async (db: PGlite, nombre: string) =>
  (await db.query<{ r: string | null }>(`select to_regclass('${nombre}')::text as r`)).rows[0].r !== null

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await db.exec(migracion('20261014221500_fotos_catalogo.sql'))
  await db.exec(migracion('20261016153000_fotos_catalogo_tres_por_elemento.sql'))
  await db.exec(migracion('20261016221500_fotos_catalogo_categoria.sql'))
  await db.exec(migracion('20261016233000_fotos_catalogo_autorizacion.sql'))
  await db.exec(foto('catalonia puerta del sol|madrid', 1) + foto('catalonia puerta del sol|madrid', 2))
})
afterAll(async () => db.close())

describe('perfiles de hotel y de tour', () => {
  it('el dry-run lleva el cuerpo de la migración tal cual', () => {
    const cuerpo = (/EXECUTE \$mig\$([\s\S]*?)\$mig\$/.exec(sql(DRY_RUN))?.[1] ?? 'no está').trim()
    expect(cuerpo.length).toBeGreaterThan(1000)
    expect(migracion(MIGRACION)).toContain(cuerpo)
  })

  it('el dry-run dice OK, ensaya alias, llaves y CHECK, y no deja nada escrito', async () => {
    const r = await db.exec(sql(DRY_RUN)).then(() => 'sin error', (e: Error) => e.message)
    expect(r).toMatch(/^DRY-RUN OK /)
    for (const k of ['vista_igual=t', 'invoker=t', 'alias_ve=t', 'alias_repetido=t', 'alias_otro_tipo=t', 'orden_fuera=t']) expect(r).toContain(k)
    expect(await existe(db, 'public.fotos_perfiles')).toBe(false)
    expect(await existe(db, 'public.fotos_catalogo_por_clave')).toBe(false)
  })

  it('la migración: la vista da las fotos por la llave propia y por la de cada alias', async () => {
    await db.exec(migracion(MIGRACION))
    const perfil = (
      await db.query<{ id: string }>(
        `insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre, ciudad) values ('${WS}', 'hotel', 'catalonia puerta del sol|madrid', 'Catalonia Puerta del Sol', 'Madrid') returning id`,
      )
    ).rows[0].id
    await db.exec(
      `insert into public.fotos_perfiles_alias (workspace_id, perfil_id, tipo, clave, nombre, ciudad) values ('${WS}', '${perfil}', 'hotel', 'hotel catalonia puerta del sol madrid|madrid', 'Hotel Catalonia Puerta del Sol Madrid', 'Madrid')`,
    )
    const porClave = async (c: string) =>
      (await db.query<{ n: number }>(`select count(*)::int as n from public.fotos_catalogo_por_clave where clave_pedida = '${c}'`)).rows[0].n
    expect(await porClave('catalonia puerta del sol|madrid')).toBe(2)
    expect(await porClave('hotel catalonia puerta del sol madrid|madrid')).toBe(2)
    expect(await porClave('otro hotel|madrid')).toBe(0)
  })

  it('una llave es de un solo perfil, el alias no cruza de espacio ni de tipo y el orden va de 1 a 3', async () => {
    const perfil = (await db.query<{ id: string }>(`select id from public.fotos_perfiles limit 1`)).rows[0].id
    await expect(
      db.exec(`insert into public.fotos_perfiles_alias (workspace_id, perfil_id, tipo, clave, nombre) values ('${WS}', '${perfil}', 'hotel', 'hotel catalonia puerta del sol madrid|madrid', 'Otra vez')`),
    ).rejects.toThrow(/fotos_perfiles_alias_una_por_clave/)
    await expect(
      db.exec(`insert into public.fotos_perfiles_alias (workspace_id, perfil_id, tipo, clave, nombre) values ('${OTRO_WS}', '${perfil}', 'hotel', 'x|', 'Otro espacio')`),
    ).rejects.toThrow(/fotos_perfiles_alias_perfil_fk/)
    await expect(
      db.exec(`insert into public.fotos_perfiles_alias (workspace_id, perfil_id, tipo, clave, nombre) values ('${WS}', '${perfil}', 'actividad', 'x|', 'Otro tipo')`),
    ).rejects.toThrow(/fotos_perfiles_alias_perfil_fk/)
    await expect(db.exec(`insert into public.fotos_perfiles (workspace_id, tipo, clave, nombre) values ('${WS}', 'ciudad', 'madrid', 'Madrid')`)).rejects.toThrow(
      /fotos_perfiles_tipo_check/,
    )
    await expect(db.exec(`update public.fotos_catalogo set orden = 4`)).rejects.toThrow(/fotos_catalogo_orden_check/)
    await db.exec(`update public.fotos_catalogo set orden = posicion`)
  })

  it('la reversa quita perfiles, alias, vista y orden sin tocar las fotos', async () => {
    await db.exec(sql('2026-10-17_reversa_fotos-perfiles.sql'))
    expect(await existe(db, 'public.fotos_perfiles')).toBe(false)
    expect(await existe(db, 'public.fotos_perfiles_alias')).toBe(false)
    expect(await existe(db, 'public.fotos_catalogo_por_clave')).toBe(false)
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.fotos_catalogo')).rows[0].n).toBe(2)
  })
})
