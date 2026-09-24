import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración del módulo Ferretería, ejecutada de verdad en Postgres en memoria (PGlite), sobre
 * A1 (`workspace_modulos`) y A2 (catálogo), que ya están en producción y cuyas listas de llaves
 * esta migración amplía.
 *
 * Lo que se prueba es lo que la base tiene que RECHAZAR o GARANTIZAR sola: que el navegador no
 * escriba (el piso y la bitácora dependen de eso), que la bitácora no se edite, que el SKU sea
 * exacto y que la activación en dimpro deje la fila de historia y la llave del jsonb de acuerdo.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const A1 = '20260915210000_workspace_modulos.sql'
const A2 = '20260916120000_catalogo_y_servicios_contratados.sql'
const FERRETERIA = '20260924235500_modulo_ferreteria.sql'

const DIMPRO = '67f7af44-b5ac-4d5c-aa9e-44954368447c'
const OTRO = '00000000-0000-4000-8000-0000000000a2'
const MAURICIO = 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key, slug text, modules jsonb default '{}'::jsonb);
  create table public.profiles  (id uuid primary key, workspace_id uuid);
  create table public.empresas  (id uuid primary key, nombre text);
  create table public.negocios  (id uuid primary key, codigo text);

  -- En producción lee profiles.workspace_id de auth.uid(); aquí, de una variable de sesión.
  create function public.current_user_workspace_id() returns uuid language sql stable as
    $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;

  insert into public.workspaces (id, slug, modules) values
    ('${DIMPRO}', 'dimpro', '{"business": true, "causacion": true}'::jsonb),
    ('${OTRO}', 'otro', '{"business": true}'::jsonb);
  insert into public.profiles (id, workspace_id) values ('${MAURICIO}', '${DIMPRO}');
`

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.exec(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer(A1))
  await db.exec(leer(A2))
  await db.exec(leer(FERRETERIA))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('activación en dimpro', () => {
  it('enciende la llave ferreteria sin tocar las demás', async () => {
    const r = await db.query<{ modules: Record<string, boolean> }>(`select modules from public.workspaces where id = '${DIMPRO}'`)
    expect(r.rows[0].modules).toEqual({ business: true, causacion: true, ferreteria: true })
  })

  it('deja la fila de historia en workspace_modulos', async () => {
    const r = await db.query<{ modulo: string; origen: string; activo_hasta: string | null }>(
      `select modulo, origen, activo_hasta from public.workspace_modulos where workspace_id = '${DIMPRO}'`,
    )
    expect(r.rows).toEqual([{ modulo: 'ferreteria', origen: 'interno', activo_hasta: null }])
  })

  it('la proyección y el jsonb coinciden para ferreteria', async () => {
    const r = await db.query<{ c: { modulo: string }[] }>(`select public.proyectar_modulos('${DIMPRO}')->'cambios' as c`)
    expect(r.rows[0].c.map((x) => x.modulo)).not.toContain('ferreteria')
  })

  it('las listas de llaves aceptan ferreteria y siguen rechazando lo inventado', async () => {
    expect(await falla(`insert into public.workspace_modulos (workspace_id, modulo, origen, activo_desde, motivo, registrado_por)
      values ('${OTRO}', 'inventado', 'interno', now(), 'x', '${MAURICIO}')`)).toMatch(/workspace_modulos_modulo/)
  })
})

describe('tablas', () => {
  it('las ocho existen con RLS encendido', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname like 'ferreteria\\_%' and relkind = 'r' order by relname`,
    )
    expect(r.rows.map((x) => x.relname)).toEqual([
      'ferreteria_conversaciones',
      'ferreteria_costos',
      'ferreteria_eventos',
      'ferreteria_mediciones',
      'ferreteria_productos',
      'ferreteria_publicaciones',
      'ferreteria_tokens',
      'ferreteria_ventas',
    ])
    expect(r.rows.every((x) => x.relrowsecurity)).toBe(true)
  })

  it('authenticated solo LEE (y no los tokens); anon nada', async () => {
    const r = await db.query<{ relname: string; sel: boolean; ins: boolean; upd: boolean; del: boolean; anon: boolean }>(`
      select relname,
             has_table_privilege('authenticated', oid, 'select') sel,
             has_table_privilege('authenticated', oid, 'insert') ins,
             has_table_privilege('authenticated', oid, 'update') upd,
             has_table_privilege('authenticated', oid, 'delete') del,
             has_table_privilege('anon', oid, 'select') anon
        from pg_class where relnamespace = 'public'::regnamespace and relname like 'ferreteria\\_%' and relkind = 'r'`)
    for (const f of r.rows) {
      expect(f.sel, f.relname).toBe(f.relname !== 'ferreteria_tokens')
      expect([f.ins, f.upd, f.del, f.anon], f.relname).toEqual([false, false, false, false])
    }
  })

  it('las funciones nuevas no son ejecutables por anon ni authenticated', async () => {
    const r = await db.query<{ proname: string; anon: boolean; auth: boolean }>(`
      select proname, has_function_privilege('anon', oid, 'execute') anon, has_function_privilege('authenticated', oid, 'execute') auth
        from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ferreteria_eventos_solo_agrega', 'proyectar_modulos')`)
    expect(r.rows).toHaveLength(2)
    for (const f of r.rows) expect([f.anon, f.auth], f.proname).toEqual([false, false])
  })
})

describe('reglas que garantiza la base', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into public.ferreteria_productos (id, workspace_id, sku, nombre) values
        ('10000000-0000-4000-8000-000000000001', '${DIMPRO}', 'EKM80', 'Esmeril'),
        ('10000000-0000-4000-8000-000000000002', '${DIMPRO}', 'EKM80-B', 'Esmeril banco');
      insert into public.ferreteria_publicaciones (id, workspace_id, codigo, producto_id, titulo, precio, estado) values
        ('20000000-0000-4000-8000-000000000001', '${DIMPRO}', 'MP-01', '10000000-0000-4000-8000-000000000001', 'Esmeril', 120000, 'activa');
      insert into public.ferreteria_eventos (workspace_id, publicacion_id, tipo, autor_tipo) values
        ('${DIMPRO}', '20000000-0000-4000-8000-000000000001', 'creada', 'agente');
    `)
  })

  it('el SKU es exacto: EKM80 y EKM80-B conviven, un duplicado no', async () => {
    expect(await falla(`insert into public.ferreteria_productos (workspace_id, sku, nombre) values ('${DIMPRO}', 'EKM80', 'x')`)).toMatch(
      /ferreteria_productos_sku_unico/,
    )
    expect(await falla(`insert into public.ferreteria_productos (workspace_id, sku, nombre) values ('${DIMPRO}', ' EKM81', 'x')`)).not.toBeNull()
  })

  it('la bitácora no se edita ni se borra', async () => {
    expect(await falla(`update public.ferreteria_eventos set motivo = 'x'`)).toMatch(/solo se agrega/)
    expect(await falla(`delete from public.ferreteria_eventos`)).toMatch(/solo se agrega/)
  })

  it('pendiente_en_canal y pendiente_desde van juntos', async () => {
    expect(await falla(`update public.ferreteria_publicaciones set pendiente_en_canal = true where codigo = 'MP-01'`)).toMatch(
      /ferreteria_publicaciones_pendiente_coherente/,
    )
  })

  it('estado y línea con vocabulario cerrado', async () => {
    expect(await falla(`update public.ferreteria_publicaciones set estado = 'publicada' where codigo = 'MP-01'`)).not.toBeNull()
    expect(await falla(`update public.ferreteria_publicaciones set linea = 'otra' where codigo = 'MP-01'`)).not.toBeNull()
  })

  it('una medición por publicación y día', async () => {
    await db.exec(`insert into public.ferreteria_mediciones (workspace_id, publicacion_id, fecha, clics_acumulados)
      values ('${DIMPRO}', '20000000-0000-4000-8000-000000000001', '2026-10-01', 10)`)
    expect(await falla(`insert into public.ferreteria_mediciones (workspace_id, publicacion_id, fecha, clics_acumulados)
      values ('${DIMPRO}', '20000000-0000-4000-8000-000000000001', '2026-10-01', 12)`)).toMatch(/ferreteria_mediciones_dia_unico/)
  })

  it('la lectura de authenticated queda acotada a su workspace', async () => {
    await db.exec(`set role authenticated; select set_config('prueba.ws', '${OTRO}', false);`)
    const ajeno = await db.query<{ n: number }>(`select count(*)::int n from public.ferreteria_publicaciones`)
    await db.exec(`select set_config('prueba.ws', '${DIMPRO}', false);`)
    const propio = await db.query<{ n: number }>(`select count(*)::int n from public.ferreteria_publicaciones`)
    await db.exec(`reset role;`)
    expect(ajeno.rows[0].n).toBe(0)
    expect(propio.rows[0].n).toBe(1)
  })
})
