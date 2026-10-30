/**
 * Las migraciones de las plantillas editables corridas en Postgres en memoria (PGlite):
 *   · 20261029203000_plantillas_documento.sql (tablas, RLS, grants)
 *   · 20261029203100_plantillas_documento_soena_v1.sql (editores y versión 1 de SOENA)
 *   · 20261030120000_plantillas_documento_soena_dj_v2.sql (DJ v2 de Deisy: sin «valor aproximado»)
 *
 * Lo que la BASE garantiza aunque alguien se salte la server action y llame a PostgREST:
 *   · solo una persona de la lista inserta versiones o activa;
 *   · una versión no se edita ni se borra;
 *   · la versión activa es del mismo workspace y del mismo tipo;
 *   · nadie lee las plantillas de otro workspace.
 * Y de la siembra: los cuatro editores (sin Leidy), la versión 1 idéntica a `v1.ts` salvo la
 * frase del CUARTO que la v2 quitó, la versión 2 de la DJ idéntica a `v1.ts`, nada activo,
 * idempotente, y aborta si un nombre no aparece exactamente una vez.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { DJ_V1, RELACION_V1 } from './v1'

const leer = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8')
const DDL = leer('20261029203000_plantillas_documento.sql')
const SIEMBRA = leer('20261029203100_plantillas_documento_soena_v1.sql')
const DJ_V2 = leer('20261030120000_plantillas_documento_soena_dj_v2.sql')

/** La frase que la plantilla v2 de Deisy (2026-10-29) quitó del CUARTO. */
const FRASE_QUITADA = ', (valor aproximado como lo establece el artículo 577 del Estatuto Tributario)'
const DJ_SEMBRADA_EN_V1 = DJ_V1.replace(
  'por valor de {{iva_solicitado}}, correspondiente',
  `por valor de {{iva_solicitado}}${FRASE_QUITADA}, correspondiente`,
)

const SOENA = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const OTRO = '00000000-0000-4000-8000-0000000000aa'
const P = {
  deisy: '00000000-0000-4000-8000-0000000c0001',
  daniela: '00000000-0000-4000-8000-0000000c0002',
  diana: '00000000-0000-4000-8000-0000000c0003',
  juan: '00000000-0000-4000-8000-0000000c0004',
  leidy: '00000000-0000-4000-8000-0000000c0005',
  ajeno: '00000000-0000-4000-8000-0000000c0006',
}

const ESQUEMA = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant usage on schema public to authenticated;

  create table public.workspaces (id uuid primary key, name text);
  insert into public.workspaces values ('${SOENA}', 'SOENA'), ('${OTRO}', 'Otro');
  create table public.profiles (id uuid primary key, workspace_id uuid not null, full_name text, role text);
  insert into public.profiles values
    ('${P.deisy}', '${SOENA}', 'Deisy Ramírez', 'supervisor'),
    ('${P.daniela}', '${SOENA}', 'Daniela Játiva', 'admin'),
    ('${P.diana}', '${SOENA}', 'Diana Parra', 'admin'),
    ('${P.juan}', '${SOENA}', 'Juan David Bruce', 'owner'),
    ('${P.leidy}', '${SOENA}', 'Leidy Llanos', 'supervisor'),
    ('${P.ajeno}', '${OTRO}', 'Persona de otro espacio', 'owner');
  grant select on public.profiles to authenticated;

  create function public.current_user_workspace_id() returns uuid language sql stable security definer as
    $$ select workspace_id from public.profiles where id = auth.uid() $$;
  grant execute on function public.current_user_workspace_id() to authenticated;
`

let db: PGlite

/** Corre `sql` como `authenticated` con la sesión de `uid`. */
async function comoUsuario<T = Record<string, unknown>>(uid: string, sql: string, params: unknown[] = []) {
  await db.exec(`set role authenticated; select set_config('prueba.uid', '${uid}', false);`)
  try {
    return await db.query<T>(sql, params)
  } finally {
    await db.exec(`reset role; select set_config('prueba.uid', '', false);`)
  }
}

async function versionDe(tipo: string, ws = SOENA): Promise<string> {
  const r = await db.query<{ id: string }>(
    `select id from public.plantillas_documento_versiones where workspace_id = $1 and tipo = $2 order by version_n limit 1`,
    [ws, tipo],
  )
  return r.rows[0].id
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(DDL)
  await db.exec(SIEMBRA)
  await db.exec(DJ_V2)
})
afterAll(async () => { await db.close() })

describe('siembra de SOENA', () => {
  it('deja a las cuatro personas de la lista, sin Leidy', async () => {
    const r = await db.query<{ user_id: string }>(
      `select user_id from public.plantillas_documento_editores where workspace_id = $1 order by user_id`, [SOENA])
    expect(r.rows.map((x) => x.user_id)).toEqual([P.deisy, P.daniela, P.diana, P.juan])
  })

  it('v1 = la plantilla del 28-oct, v2 de la DJ = v1.ts byte a byte, y no queda nada activo', async () => {
    const r = await db.query<{ tipo: string; version_n: number; contenido: string; nota: string }>(
      `select tipo, version_n, contenido, nota from public.plantillas_documento_versiones
       where workspace_id = $1 order by tipo, version_n`, [SOENA])
    expect(r.rows.map((x) => [x.tipo, x.version_n])).toEqual([
      ['declaracion-juramentada', 1], ['declaracion-juramentada', 2], ['relacion-facturas', 1],
    ])
    expect(DJ_SEMBRADA_EN_V1).not.toBe(DJ_V1)
    expect(r.rows[0].contenido).toBe(DJ_SEMBRADA_EN_V1)
    expect(r.rows[1].contenido).toBe(DJ_V1)
    expect(r.rows[1].contenido).not.toMatch(/aproximado|577/)
    expect(r.rows[1].nota).toMatch(/^Plantilla v2 de Deisy 2026-10-29: sin "valor aproximado"/)
    expect(r.rows[2].contenido).toBe(RELACION_V1)
    expect(RELACION_V1).not.toMatch(/aproximado|577/)
    const activas = await db.query(`select 1 from public.plantillas_documento_activas`)
    expect(activas.rows).toHaveLength(0)
  })

  it('es idempotente', async () => {
    await db.exec(SIEMBRA)
    await db.exec(DJ_V2)
    const v = await db.query(`select 1 from public.plantillas_documento_versiones where workspace_id = $1`, [SOENA])
    const e = await db.query(`select 1 from public.plantillas_documento_editores where workspace_id = $1`, [SOENA])
    expect(v.rows).toHaveLength(3)
    expect(e.rows).toHaveLength(4)
  })

  it('la v2 de la DJ aborta si SOENA no tiene la versión 1', async () => {
    const otra = new PGlite()
    try {
      await otra.exec(ESQUEMA)
      await otra.exec(DDL)
      await expect(otra.exec(DJ_V2)).rejects.toThrow(/aplicar antes 20261029203100/)
      const v = await otra.query(`select 1 from public.plantillas_documento_versiones`)
      expect(v.rows).toHaveLength(0)
    } finally {
      await otra.close()
    }
   }, 30_000)

  it('aborta si un nombre no aparece exactamente una vez', async () => {
    const otra = new PGlite()
    try {
      await otra.exec(ESQUEMA)
      await otra.exec(`update public.profiles set full_name = 'Diana P.' where id = '${P.diana}'`)
      await otra.exec(DDL)
      await expect(otra.exec(SIEMBRA)).rejects.toThrow(/Diana Parra encontrado 0 veces/)
      const v = await otra.query(`select 1 from public.plantillas_documento_editores`)
      expect(v.rows).toHaveLength(0)
    } finally {
      await otra.close()
    }
  })
})

describe('RLS: solo la lista escribe', () => {
  const insertarVersion = (uid: string, ws = SOENA, n = 3) =>
    comoUsuario(uid,
      `insert into public.plantillas_documento_versiones (workspace_id, tipo, version_n, contenido, creada_por)
       values ($1, 'declaracion-juramentada', $2, 'texto', $3) returning id`, [ws, n, uid])

  it('una persona de la lista crea una versión', async () => {
    const r = await insertarVersion(P.deisy)
    expect(r.rows).toHaveLength(1)
  })

  it('Leidy (supervisor, fuera de la lista) no puede crear versiones', async () => {
    await expect(insertarVersion(P.leidy, SOENA, 4)).rejects.toThrow(/row-level security/)
  })

  it('nadie crea versiones a nombre de otra persona', async () => {
    await expect(comoUsuario(P.deisy,
      `insert into public.plantillas_documento_versiones (workspace_id, tipo, version_n, contenido, creada_por)
       values ($1, 'declaracion-juramentada', 5, 'x', $2)`, [SOENA, P.juan])).rejects.toThrow(/row-level security/)
  })

  it('una versión no se edita ni se borra, ni siquiera desde la lista', async () => {
    await expect(comoUsuario(P.juan, `update public.plantillas_documento_versiones set contenido = 'otro'`))
      .rejects.toThrow(/permission denied/)
    await expect(comoUsuario(P.juan, `delete from public.plantillas_documento_versiones`))
      .rejects.toThrow(/permission denied/)
  })

  it('la lista no se cambia desde la app', async () => {
    await expect(comoUsuario(P.juan,
      `insert into public.plantillas_documento_editores (workspace_id, user_id) values ($1, $2)`, [SOENA, P.leidy]))
      .rejects.toThrow(/permission denied/)
  })

  it('activar: la lista sí, Leidy no', async () => {
    const v1 = await versionDe('declaracion-juramentada')
    await expect(comoUsuario(P.leidy,
      `insert into public.plantillas_documento_activas (workspace_id, tipo, version_id, activada_por)
       values ($1, 'declaracion-juramentada', $2, $3)`, [SOENA, v1, P.leidy])).rejects.toThrow(/row-level security/)

    await comoUsuario(P.daniela,
      `insert into public.plantillas_documento_activas (workspace_id, tipo, version_id, activada_por)
       values ($1, 'declaracion-juramentada', $2, $3)
       on conflict (workspace_id, tipo) do update set version_id = excluded.version_id,
         activada_por = excluded.activada_por, activada_at = now()`, [SOENA, v1, P.daniela])
    const r = await db.query<{ version_id: string }>(`select version_id from public.plantillas_documento_activas`)
    expect(r.rows).toEqual([{ version_id: v1 }])

    // Leidy tampoco puede cambiar la activa existente.
    const otra = await comoUsuario(P.leidy,
      `update public.plantillas_documento_activas set activada_por = $1 returning 1`, [P.leidy])
    expect(otra.rows).toHaveLength(0)
  })

  it('la activa apunta a una versión del mismo tipo', async () => {
    const rel = await versionDe('relacion-facturas')
    await expect(comoUsuario(P.juan,
      `update public.plantillas_documento_activas set version_id = $1, activada_por = $2
       where tipo = 'declaracion-juramentada'`, [rel, P.juan])).rejects.toThrow(/foreign key/)
  })

  it('otro workspace no ve nada de SOENA', async () => {
    for (const t of ['plantillas_documento_versiones', 'plantillas_documento_activas', 'plantillas_documento_editores']) {
      const r = await comoUsuario(P.ajeno, `select 1 from public.${t}`)
      expect(r.rows, t).toHaveLength(0)
    }
  })

  it('anon no tiene acceso', async () => {
    await db.exec(`set role anon`)
    try {
      await expect(db.query(`select 1 from public.plantillas_documento_versiones`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec(`reset role`)
    }
  })
})
