/**
 * `20261012234500_contacto_perfil_hechos.sql` corrida de verdad en Postgres en memoria (PGlite).
 *
 * Lo que se prueba (las invariantes que viven en la base, no en el código):
 *   · el contacto tiene que ser del workspace de la fila;
 *   · sin autorización vigente (`vigente.generales`) no nace ningún hecho ni se confirma un sugerido; descartar sí;
 *   · nace sugerido o confirmado, nunca descartado; un descartado no vuelve; lo que dice el hecho no se reescribe;
 *   · la sesión (`authenticated`) ve y escribe solo su workspace, y no puede borrar;
 *   · anon no tiene nada.
 *
 * Límite conocido: PGlite no tiene `auth.uid()`: `current_user_workspace_id()` entra como stub sobre un GUC, y la RPC
 * `autorizacion_datos_estado` (migración 20261008230000, donde vive la regla de vigencia) como stub sobre una tabla de
 * prueba que dice qué contacto autorizó. Lo que se prueba es que el trigger la consulta y obedece `vigente.generales`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACION = readFileSync(join(process.cwd(), 'supabase/migrations/20261012234500_contacto_perfil_hechos.sql'), 'utf8')

const WS = '00000000-0000-4000-8000-00000000f001'
const WS_OTRO = '00000000-0000-4000-8000-00000000f002'
const AUTORIZO = '00000000-0000-4000-8000-00000000f011'
const NO_AUTORIZO = '00000000-0000-4000-8000-00000000f012'
const DE_OTRO = '00000000-0000-4000-8000-00000000f013'
const STAFF = '00000000-0000-4000-8000-00000000f021'

const ESQUEMA = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create table public.workspaces (id uuid primary key, slug text);
  create table public.contactos (id uuid primary key, workspace_id uuid not null, nombre text);
  create table public.staff (id uuid primary key, workspace_id uuid, full_name text);

  create function public.current_user_workspace_id() returns uuid
    language sql stable as $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;

  -- Stub de la RPC de vigencia: quién autorizó lo dice esta tabla.
  create table public._autorizados (workspace_id uuid, contacto_id uuid);
  create function public.autorizacion_datos_estado(p_workspace_id uuid, p_contacto_id uuid) returns jsonb
    language sql stable as $$
      select jsonb_build_object('existe', true, 'vigente', jsonb_build_object('generales',
        exists (select 1 from public._autorizados a where a.workspace_id = p_workspace_id and a.contacto_id = p_contacto_id)))
    $$;
  revoke execute on function public.autorizacion_datos_estado(uuid, uuid) from public, anon, authenticated;

  insert into public.workspaces values ('${WS}', 'agencia'), ('${WS_OTRO}', 'otra');
  insert into public.contactos values
    ('${AUTORIZO}', '${WS}', 'MAURICIO MORENO'), ('${NO_AUTORIZO}', '${WS}', 'VIVIANA PAZ'), ('${DE_OTRO}', '${WS_OTRO}', 'DE OTRO');
  insert into public.staff values ('${STAFF}', '${WS}', 'Comercial');
  insert into public._autorizados values ('${WS}', '${AUTORIZO}'), ('${WS_OTRO}', '${DE_OTRO}');
`

let db: PGlite

const insertar = (p: { ws?: string; contacto?: string; estado?: string; texto?: string; origen?: string }) => db.query<{ id: string; confirmado_at: string | null }>(
  `insert into public.contacto_perfil_hechos (workspace_id, contacto_id, dimension, texto, estado, origen_tipo, origen_ref, creado_por)
   values ($1, $2, 'preferencias', $3, $4, $5, 'fila-1', '${STAFF}') returning id, confirmado_at`,
  [p.ws ?? WS, p.contacto ?? AUTORIZO, p.texto ?? `le gusta la comida italiana ${Math.random()}`, p.estado ?? 'sugerido', p.origen ?? 'bot_explicito'],
)

async function error(f: () => Promise<unknown>): Promise<string> {
  try {
    await f()
  } catch (e) {
    return (e as Error).message
  }
  return 'sin error'
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(MIGRACION)
})

afterAll(async () => {
  await db.close()
})

describe('contacto_perfil_hechos — invariantes en la base', () => {
  it('con autorización vigente nace sugerido o confirmado (confirmado con su fecha)', async () => {
    const s = await insertar({ estado: 'sugerido' })
    expect(s.rows).toHaveLength(1)
    const c = await insertar({ estado: 'confirmado' })
    expect(c.rows[0].confirmado_at).not.toBeNull()
  })

  it('sin autorización vigente no nace nada, ni sugerido', async () => {
    expect(await error(() => insertar({ contacto: NO_AUTORIZO, estado: 'sugerido' }))).toContain('perfil_sin_autorizacion')
    expect(await error(() => insertar({ contacto: NO_AUTORIZO, estado: 'confirmado' }))).toContain('perfil_sin_autorizacion')
  })

  it('el contacto tiene que ser del workspace de la fila', async () => {
    expect(await error(() => insertar({ ws: WS, contacto: DE_OTRO }))).toContain('perfil_contacto_fuera_del_workspace')
  })

  it('no nace descartado; el vocabulario de dimensión y origen es cerrado', async () => {
    expect(await error(() => insertar({ estado: 'descartado' }))).toContain('perfil_nace_descartado')
    expect(await error(() => insertar({ origen: 'conversacion' }))).toMatch(/check|violates/i)
    expect(await error(() => db.query(
      `insert into public.contacto_perfil_hechos (workspace_id, contacto_id, dimension, texto, origen_tipo, origen_ref)
       values ('${WS}', '${AUTORIZO}', 'gustos', 'x', 'manual', 'u')`,
    ))).toMatch(/check|violates/i)
    // origen_ref obligatorio.
    expect(await error(() => db.query(
      `insert into public.contacto_perfil_hechos (workspace_id, contacto_id, dimension, texto, origen_tipo, origen_ref)
       values ('${WS}', '${AUTORIZO}', 'otro', 'x', 'manual', '  ')`,
    ))).toMatch(/check|violates/i)
  })

  it('el mismo texto vivo no se repite en el contacto', async () => {
    await insertar({ texto: 'viaja siempre con la mamá' })
    expect(await error(() => insertar({ texto: 'Viaja siempre con la mamá ' }))).toMatch(/unique|duplicate/i)
  })

  it('transiciones: sugerido → confirmado → descartado; un descartado no vuelve', async () => {
    const { rows: [h] } = await insertar({})
    await db.query(`update public.contacto_perfil_hechos set estado = 'confirmado', confirmado_por = '${STAFF}' where id = $1`, [h.id])
    await db.query(`update public.contacto_perfil_hechos set estado = 'descartado', descartado_por = '${STAFF}' where id = $1`, [h.id])
    const { rows: [d] } = await db.query<{ estado: string; descartado_at: string | null }>('select estado, descartado_at from public.contacto_perfil_hechos where id = $1', [h.id])
    expect(d).toMatchObject({ estado: 'descartado' })
    expect(d.descartado_at).not.toBeNull()
    expect(await error(() => db.query(`update public.contacto_perfil_hechos set estado = 'confirmado' where id = $1`, [h.id]))).toContain('perfil_transicion_invalida')
    expect(await error(() => db.query(`update public.contacto_perfil_hechos set estado = 'sugerido' where id = $1`, [h.id]))).toContain('perfil_transicion_invalida')
  })

  it('lo que dice el hecho y de dónde salió no se reescribe', async () => {
    const { rows: [h] } = await insertar({})
    expect(await error(() => db.query(`update public.contacto_perfil_hechos set texto = 'otra cosa' where id = $1`, [h.id]))).toContain('perfil_hecho_inmutable')
    expect(await error(() => db.query(`update public.contacto_perfil_hechos set origen_ref = 'otra' where id = $1`, [h.id]))).toContain('perfil_hecho_inmutable')
    expect(await error(() => db.query(`update public.contacto_perfil_hechos set contacto_id = '${NO_AUTORIZO}' where id = $1`, [h.id]))).toContain('perfil_hecho_inmutable')
  })

  it('si la autorización se cae, el sugerido no se confirma, pero sí se descarta', async () => {
    const { rows: [h] } = await insertar({ texto: 'prefiere hoteles pequeños' })
    await db.exec(`delete from public._autorizados where contacto_id = '${AUTORIZO}'`)
    try {
      expect(await error(() => db.query(`update public.contacto_perfil_hechos set estado = 'confirmado' where id = $1`, [h.id]))).toContain('perfil_sin_autorizacion')
      await db.query(`update public.contacto_perfil_hechos set estado = 'descartado' where id = $1`, [h.id])
    } finally {
      await db.exec(`insert into public._autorizados values ('${WS}', '${AUTORIZO}')`)
    }
  })
})

describe('contacto_perfil_hechos — la sesión y anon', () => {
  it('privilegios: authenticated lee, inserta y actualiza; no borra. anon nada', async () => {
    const { rows: [p] } = await db.query<Record<string, boolean>>(`select
      has_table_privilege('authenticated', 'public.contacto_perfil_hechos', 'select') as sel,
      has_table_privilege('authenticated', 'public.contacto_perfil_hechos', 'insert') as ins,
      has_table_privilege('authenticated', 'public.contacto_perfil_hechos', 'update') as upd,
      has_table_privilege('authenticated', 'public.contacto_perfil_hechos', 'delete') as del,
      has_table_privilege('anon', 'public.contacto_perfil_hechos', 'select') as anon_sel,
      has_function_privilege('anon', 'public.contacto_perfil_hechos_guardas()', 'execute') as anon_fn,
      has_function_privilege('authenticated', 'public.contacto_perfil_hechos_guardas()', 'execute') as auth_fn`)
    expect(p).toEqual({ sel: true, ins: true, upd: true, del: false, anon_sel: false, anon_fn: false, auth_fn: false })
  })

  it('la sesión ve solo su workspace y no escribe en otro', async () => {
    await db.exec(`insert into public.contacto_perfil_hechos (workspace_id, contacto_id, dimension, texto, origen_tipo, origen_ref)
      values ('${WS_OTRO}', '${DE_OTRO}', 'otro', 'de otro workspace', 'manual', 'u')`)
    await db.exec(`set prueba.ws = '${WS}'; set role authenticated;`)
    try {
      const { rows } = await db.query<{ workspace_id: string }>('select workspace_id from public.contacto_perfil_hechos')
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r) => r.workspace_id === WS)).toBe(true)
      expect(await error(() => db.query(
        `insert into public.contacto_perfil_hechos (workspace_id, contacto_id, dimension, texto, origen_tipo, origen_ref)
         values ('${WS_OTRO}', '${DE_OTRO}', 'otro', 'colado', 'manual', 'u')`,
      ))).toMatch(/row-level security|policy/i)
      // La sesión inserta en su workspace (el trigger corre como su dueño y consulta la vigencia).
      const { rows: [n] } = await db.query<{ id: string }>(
        `insert into public.contacto_perfil_hechos (workspace_id, contacto_id, dimension, texto, origen_tipo, origen_ref)
         values ('${WS}', '${AUTORIZO}', 'identidad', 'vive en Medellín', 'manual', 'usuario:u1') returning id`,
      )
      expect(await error(() => db.query('delete from public.contacto_perfil_hechos where id = $1', [n.id]))).toMatch(/permission denied/i)
    } finally {
      await db.exec('reset role; reset prueba.ws;')
    }
  })
})
