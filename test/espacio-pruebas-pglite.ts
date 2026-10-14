// ============================================================
// El clonador del espacio de pruebas contra un POSTGRES DE VERDAD (PGlite), no contra el doble.
//
// Por qué existe: los dos primeros `--apply` contra producción cayeron por cosas que el doble no
// veía (una llave foránea circular y una columna generada). Postgres las hace cumplir solo.
//
// Dos fuentes de esquema (ver `ensayo-postgres.test.ts`):
//  · `ESPACIO_PRUEBAS_ESQUEMA=<archivo.sql>`: el DDL de PRODUCCIÓN que saca
//    `scripts/espacio-pruebas-esquema-produccion.sql` (solo lectura del catálogo). Es la prueba
//    que vale antes de un `--apply`.
//  · `ESPACIO_PRUEBAS_MIGRACIONES=1`: las migraciones del repo, en orden, tolerando las que fallan.
//    APROXIMADO: en producción hay tablas que nacieron fuera de las migraciones (staff, cobros,
//    contactos viejos…) y ~300 migraciones no corren sobre una base vacía. Sirve para ver la
//    mecánica y las reglas que sí quedan (p. ej. `rubros.valor_total` GENERATED), no para dar
//    por bueno un `--apply`.
//
// El almacén de aquí se porta como PostgREST con la llave de servicio: inserta solo las columnas
// que trae el JSON (las que faltan quedan en null, como sin `Prefer: missing=default`), no lee
// `information_schema` para las generadas (el de Supabase no puede) y salta el RLS.
// ============================================================

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'

import type { Almacen, Fila, Filtro } from '../src/lib/espacio-pruebas/almacen'
import { remapear } from '../src/lib/espacio-pruebas/jsonb'

/** Lo que Supabase pone alrededor de `public`: roles, Auth, Storage, Vault, cron y net de mentira. */
export const PRELUDIO_SUPABASE = `
set time zone 'UTC';
do $$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create role authenticator nologin; create role supabase_admin nologin; create role supabase_auth_admin nologin;
  create role supabase_storage_admin nologin; create role dashboard_user nologin; create role pgbouncer nologin;
exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm;
create extension if not exists unaccent;
set search_path = public, extensions;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(), instance_id uuid, aud text, role text, email text, encrypted_password text, phone text,
  email_confirmed_at timestamptz, last_sign_in_at timestamptz, banned_until timestamptz, deleted_at timestamptz,
  raw_user_meta_data jsonb default '{}'::jsonb, raw_app_meta_data jsonb default '{}'::jsonb,
  is_anonymous boolean default false, is_sso_user boolean default false, created_at timestamptz default now(), updated_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create function auth.role() returns text language sql stable as $f$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $f$;
create function auth.email() returns text language sql stable as $f$ select nullif(current_setting('request.jwt.claim.email', true), '')::text $f$;
create function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
grant usage on schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text,
  metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(), version text);
create function storage.foldername(name text) returns text[] language sql immutable as $f$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $f$;
create function storage.filename(name text) returns text language sql immutable as $f$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $f$;
create function storage.extension(name text) returns text language sql immutable as $f$ select reverse(split_part(reverse(name), '.', 1)) $f$;

create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text not null, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create function vault.create_secret(secret text, name text default null, description text default null) returns uuid language sql as $f$ insert into vault.secrets(name, secret, description) values (name, secret, description) returning id $f$;

create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null, active boolean default true);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $f$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $f$;
create function cron.unschedule(job_name text) returns boolean language sql as $f$ delete from cron.job where jobname = job_name returning true $f$;

create schema net;
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000)
  returns bigint language sql as $f$ select 1::bigint $f$;
create schema if not exists realtime;
create publication supabase_realtime;
`

/**
 * Solo para la vía APROXIMADA de las migraciones: tablas que en producción nacieron fuera de
 * ellas y de las que cuelgan las que el clonador escribe. Columnas según `src/types/database.ts`.
 * Se crean justo después de la migración inicial.
 */
const TABLAS_FUERA_DE_MIGRACIONES = `
create table public.staff (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid references public.profiles(id), full_name text not null, position text, department text, contract_type text, salary numeric,
  horas_disponibles_mes numeric, phone_whatsapp text, is_active boolean default true, es_principal boolean, rol_plataforma text, tipo_acceso text,
  tipo_vinculo text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.staff_areas (staff_id uuid not null references public.staff(id) on delete cascade, area text not null, created_at timestamptz not null default now(), primary key (staff_id, area));
create table public.activity_log (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id), entidad_tipo text not null,
  entidad_id uuid not null, tipo text not null, autor_id uuid references public.staff(id), contenido text, campo_modificado text, valor_anterior text,
  valor_nuevo text, mencion_id uuid references public.staff(id), link_url text, created_at timestamptz default now());
`

export type FuenteEsquema = { ddl: string } | { migraciones: string; tipos: string }

export interface BaseDePrueba {
  db: PGlite
  /** Migraciones que no corrieron (solo en la vía aproximada). */
  fallas: string[]
}

export async function levantarBase(fuente: FuenteEsquema): Promise<BaseDePrueba> {
  const db = new PGlite({ extensions: { pg_trgm, unaccent, uuid_ossp, pgcrypto } })
  await db.exec(PRELUDIO_SUPABASE)
  const fallas: string[] = []
  if ('ddl' in fuente) {
    await db.exec(fuente.ddl)
    return { db, fallas }
  }
  const archivos = readdirSync(fuente.migraciones).filter(f => f.endsWith('.sql')).sort()
  for (const [i, f] of archivos.entries()) {
    const sql = readFileSync(join(fuente.migraciones, f), 'utf8')
    try {
      await db.exec(`begin;\n${sql}\n;commit;`)
    } catch {
      await db.exec('rollback').catch(() => {})
      try {
        await db.exec(sql.replace(/\bconcurrently\b/gi, ''))
      } catch (e) {
        fallas.push(`${f}: ${(e as Error).message}`)
      }
    }
    if (i === 0) await db.exec(TABLAS_FUERA_DE_MIGRACIONES)
  }
  await completarConLosTipos(db, fuente.tipos)
  return { db, fallas }
}

/**
 * Vía aproximada: lo que las migraciones no alcanzaron a crear (tablas y columnas) se completa con
 * la FORMA de `src/types/database.ts`, sin llaves ni CHECK. Las reglas reales son solo las que sí
 * corrieron en las migraciones.
 */
async function completarConLosTipos(db: PGlite, rutaTipos: string) {
  const src = readFileSync(rutaTipos, 'utf8')
  const tablas = src.slice(src.indexOf('    Tables: {'), src.indexOf('    Views: {'))
  const partes = tablas.split(/\n {6}(\w+): \{\n {8}Row: \{/)
  // Texto aunque se llame `*_id`: hay ids que no son uuid (carpetas de Drive, wamid).
  const tipoSql = (_col: string, ts: string) => {
    const t = ts.replace(/\s*\|\s*null/, '').trim()
    if (t.endsWith('[]')) return 'text[]'
    if (t === 'number') return 'numeric'
    if (t === 'boolean') return 'boolean'
    if (t === 'Json') return 'jsonb'
    return 'text'
  }
  const existentes = await columnas(db)
  for (let i = 1; i < partes.length; i += 2) {
    const tabla = partes[i]
    const fila = partes[i + 1].slice(0, partes[i + 1].indexOf('\n        }'))
    const cols = [...fila.matchAll(/\n {10}(\w+): ([^\n]+)/g)].map(m => [m[1], tipoSql(m[1], m[2])] as const)
    const ya = new Set((existentes.get(tabla) ?? []).map(c => c.c))
    if (!existentes.has(tabla)) {
      const defs = cols.map(([c, t]) => `${q(c)} ${t}${c === 'id' ? ' primary key default gen_random_uuid()::text' : ''}`)
      await db.exec(`create table public.${q(tabla)} (${defs.join(', ')})`)
      continue
    }
    for (const [c, t] of cols) if (!ya.has(c)) await db.exec(`alter table public.${q(tabla)} add column ${q(c)} ${t}`)
  }
}

const q = (id: string) => `"${id.replace(/"/g, '""')}"`

/** Las columnas de cada tabla de `public` y si aceptan null / tienen default (para sembrar el origen). */
async function columnas(db: PGlite) {
  const r = await db.query<{ t: string; c: string; nulo: string; def: string | null; gen: string; tipo: string; udt: string }>(`
    select table_name t, column_name c, is_nullable nulo, column_default def, is_generated gen, data_type tipo, udt_name udt
    from information_schema.columns c
    where table_schema = 'public' and exists (select 1 from information_schema.tables x where x.table_schema = 'public' and x.table_name = c.table_name and x.table_type = 'BASE TABLE')
    order by table_name, ordinal_position`)
  const m = new Map<string, typeof r.rows>()
  for (const f of r.rows) m.set(f.t, [...(m.get(f.t) ?? []), f])
  return m
}

/**
 * El almacén sobre PGlite, con la forma de PostgREST + llave de servicio. `tolerarColumnas`
 * (solo vía aproximada) quita las columnas que la tabla no tiene y las anota en `ignoradas`.
 */
export async function almacenPglite(db: PGlite, opts: { tolerarColumnas?: boolean } = {}) {
  const cols = await columnas(db)
  const ignoradas = new Set<string>()
  const llamadas: string[] = []

  const donde = (filtros: Filtro[], desde = 1) => {
    const params: unknown[] = []
    const partes = filtros.map(([col, op, v]) => {
      params.push(op === 'eq' ? String(v) : (v as unknown[]).map(String))
      return op === 'eq' ? `${q(col)}::text = $${desde + params.length - 1}::text` : `${q(col)}::text = any($${desde + params.length - 1}::text[])`
    })
    return { sql: partes.length ? `where ${partes.join(' and ')}` : '', params }
  }
  const propias = (tabla: string, claves: string[]) => {
    const existen = new Set((cols.get(tabla) ?? []).map(c => c.c))
    if (!opts.tolerarColumnas) return claves
    return claves.filter(k => existen.has(k) || (ignoradas.add(`${tabla}.${k}`), false))
  }
  const normalizar = (f: Record<string, unknown>): Fila =>
    Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v]))

  const almacen: Almacen = {
    async leer(tabla, filtros) {
      const w = donde(filtros)
      return (await db.query<Record<string, unknown>>(`select * from public.${q(tabla)} ${w.sql}`, w.params)).rows.map(normalizar)
    },
    async contar(tabla, filtros) {
      const w = donde(filtros)
      return Number((await db.query<{ n: number }>(`select count(*)::int n from public.${q(tabla)} ${w.sql}`, w.params)).rows[0].n)
    },
    async insertar(tabla, filas) {
      llamadas.push(`insertar ${tabla}`)
      const claves = propias(tabla, [...new Set(filas.flatMap(f => Object.keys(f)))])
      if (!claves.length) return
      const lista = claves.map(q).join(', ')
      try {
        await db.query(`insert into public.${q(tabla)} (${lista}) select ${lista} from jsonb_populate_recordset(null::public.${q(tabla)}, $1::jsonb)`, [JSON.stringify(filas)])
      } catch (e) {
        throw new Error(`insertar ${tabla}: ${(e as Error).message}`)
      }
    },
    async actualizar(tabla, id, patch) {
      llamadas.push(`actualizar ${tabla}`)
      const claves = propias(tabla, Object.keys(patch))
      if (!claves.length) return
      const lista = claves.map(q).join(', ')
      try {
        await db.query(`update public.${q(tabla)} set (${lista}) = (select ${lista} from jsonb_populate_record(null::public.${q(tabla)}, $1::jsonb)) where id::text = $2`, [JSON.stringify(patch), id])
      } catch (e) {
        throw new Error(`actualizar ${tabla}: ${(e as Error).message}`)
      }
    },
    async guardar(tabla, fila, conflicto = 'id') {
      llamadas.push(`guardar ${tabla}`)
      const claves = propias(tabla, Object.keys(fila))
      const lista = claves.map(q).join(', ')
      const set = claves.filter(c => c !== conflicto).map(c => `${q(c)} = excluded.${q(c)}`).join(', ')
      try {
        await db.query(`insert into public.${q(tabla)} (${lista}) select ${lista} from jsonb_populate_record(null::public.${q(tabla)}, $1::jsonb)
          on conflict (${q(conflicto)}) do ${set ? `update set ${set}` : 'nothing'}`, [JSON.stringify(fila)])
      } catch (e) {
        throw new Error(`guardar ${tabla}: ${(e as Error).message}`)
      }
    },
    async borrar(tabla, filtros) {
      llamadas.push(`borrar ${tabla}`)
      const w = donde(filtros)
      try {
        const r = await db.query(`delete from public.${q(tabla)} ${w.sql}`, w.params)
        return { borradas: r.affectedRows ?? 0, error: null }
      } catch (e) {
        const err = e as { code?: string; message: string }
        return { borradas: 0, error: { code: err.code, message: err.message } }
      }
    },
    async tablas() {
      return new Map([...cols].map(([t, c]) => [t, c.map(x => x.c)]))
    },
    async buscarUsuario(correo) {
      const r = await db.query<{ id: string }>('select id::text id from auth.users where lower(email) = lower($1)', [correo])
      return r.rows[0]?.id ?? null
    },
    async crearUsuario(correo, nombre) {
      const r = await db.query<{ id: string }>(`insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values (lower($1), now(), jsonb_build_object('full_name', $2::text)) returning id::text id`, [correo, nombre])
      return r.rows[0].id
    },
    async borrarUsuario(id) {
      // GoTrue borra la fila de auth.users; si un perfil la referencia sin cascada, falla igual que aquí.
      await db.query('delete from auth.users where id::text = $1', [id])
    },
    async archivos(prefijo) {
      const r = await db.query<{ bucket: string; ruta: string }>('select bucket_id bucket, name ruta from storage.objects where name like $1', [`${prefijo}%`])
      return r.rows
    },
    async borrarArchivos(lista) {
      for (const o of lista) await db.query('delete from storage.objects where bucket_id = $1 and name = $2', [o.bucket, o.ruta])
    },
  }
  return { almacen, ignoradas, llamadas, columnas: cols }
}

/** Un valor de relleno para una columna NOT NULL sin default que la fila sembrada no trae. */
function relleno(tipo: string, udt: string, enums: Map<string, string[]>): unknown {
  if (enums.has(udt)) return enums.get(udt)![0]
  if (tipo === 'ARRAY') return []
  if (tipo === 'uuid') return '00000000-0000-4000-8000-00000000f111'
  if (tipo === 'boolean') return false
  if (/int|numeric|double|real/.test(tipo)) return 0
  if (tipo === 'jsonb' || tipo === 'json') return {}
  if (tipo === 'date') return '2026-01-01'
  if (tipo.startsWith('timestamp')) return '2026-01-01T00:00:00Z'
  return 'x'
}

/**
 * Siembra el workspace de ORIGEN inventado (las tablas del doble) sin disparar triggers ni llaves
 * (`session_replication_role = replica`): es el punto de partida, no lo que se prueba. Rellena
 * las NOT NULL que el doble no trae y salta tablas y columnas que la base no tiene.
 */
export async function sembrarOrigen(db: PGlite, tablas: Record<string, Fila[]>, usuarios: { id: string; correo: string }[]) {
  const cols = await columnas(db)
  const enums = new Map<string, string[]>()
  for (const r of (await db.query<{ t: string; l: string }>(`select t.typname t, e.enumlabel l from pg_enum e join pg_type t on t.oid = e.enumtypid order by e.enumsortorder`)).rows) {
    enums.set(r.t, [...(enums.get(r.t) ?? []), r.l])
  }
  const saltadas: string[] = []
  const mapa = new Map<string, string>()
  await db.exec(`set session_replication_role = replica`)
  try {
    for (const u of usuarios) await db.query('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [u.id, u.correo])
    for (const [tabla, filas] of Object.entries(tablas)) {
      const c = cols.get(tabla)
      if (!c) {
        if (filas.length) saltadas.push(tabla)
        continue
      }
      const existen = new Set(c.map(x => x.c))
      for (const original of filas) {
        const f = remapear(original, mapa) as Fila
        const fila: Fila = Object.fromEntries(Object.entries(f).filter(([k]) => existen.has(k) && !c.find(x => x.c === k && x.gen === 'ALWAYS')))
        for (const x of c) if (x.nulo === 'NO' && x.def == null && x.gen !== 'ALWAYS' && fila[x.c] == null) fila[x.c] = relleno(x.tipo, x.udt, enums)
        for (let intento = 0; ; intento++) {
          const lista = Object.keys(fila).map(q).join(', ')
          try {
            await db.query(`insert into public.${q(tabla)} (${lista}) select ${lista} from jsonb_populate_record(null::public.${q(tabla)}, $1::jsonb)`, [JSON.stringify(fila)])
            break
          } catch (e) {
            const restriccion = (e as { constraint?: string }).constraint
            // Catálogo global que la base ya trae (p. ej. `bloque_definitions` por tipo): se usa la
            // fila que ya está y sus referencias se cambian por su id.
            if ((e as { code?: string }).code === '23505' && restriccion && fila.id) {
              const [ix] = (await db.query<{ d: string }>(`select pg_get_indexdef(i.indexrelid) d from pg_index i join pg_class c on c.oid = i.indexrelid where c.relname = $1`, [restriccion])).rows
              const claves = /\(([^)]+)\)/.exec(ix?.d ?? '')?.[1].split(',').map(s => s.trim().replace(/"/g, '')) ?? []
              if (claves.length && !claves.includes('id')) {
                const w = claves.map((k, n) => `${q(k)}::text = $${n + 1}::text`).join(' and ')
                const [ya] = (await db.query<{ id: string }>(`select id::text id from public.${q(tabla)} where ${w}`, claves.map(k => String(fila[k])))).rows
                if (ya) {
                  mapa.set(String(fila.id).toLowerCase(), ya.id)
                  break
                }
              }
            }
            // El doble es inventado: si un CHECK de la base no acepta su valor, se toma el primero
            // que el CHECK nombra para esa columna. Solo al sembrar el origen.
            if (!restriccion || intento > 5) throw new Error(`sembrar ${tabla}: ${(e as Error).message}`)
            const [def] = (await db.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = $1 and conrelid = $2::regclass`, [restriccion, `public.${tabla}`])).rows
            const col = def && Object.keys(fila).find(k => new RegExp(`\\b${k}\\b`).test(def.d))
            const literal = def && /'([^']*)'/.exec(def.d)?.[1]
            if (!col || literal == null || fila[col] === literal) {
              saltadas.push(`${tabla} (una fila: ${restriccion})`)
              break
            }
            fila[col] = literal
          }
        }
      }
    }
  } finally {
    await db.exec(`set session_replication_role = origin`)
  }
  return { saltadas, mapa }
}

/** Toda fila de `public` que menciona el id (en cualquier columna de texto/uuid/jsonb): debe dar cero tras borrar. */
export async function filasQueMencionan(db: PGlite, id: string): Promise<Record<string, number>> {
  const cols = await columnas(db)
  const out: Record<string, number> = {}
  for (const [t, c] of cols) {
    const candidatas = c.filter(x => ['uuid', 'text', 'jsonb', 'character varying', 'ARRAY'].includes(x.tipo) && x.gen !== 'ALWAYS')
    if (!candidatas.length) continue
    const cond = candidatas.map(x => `${q(x.c)}::text like $1`).join(' or ')
    const n = Number((await db.query<{ n: number }>(`select count(*)::int n from public.${q(t)} where ${cond}`, [`%${id}%`])).rows[0].n)
    if (n) out[t] = n
  }
  return out
}
