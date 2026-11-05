import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La guarda de misma empresa (20261105170000_guarda_misma_empresa.sql) con EL ARCHIVO de migración en Postgres en
 * memoria (PGlite). Por cada relación: padre de otra empresa falla con MK002, padre de la misma empresa pasa,
 * cambiar el padre a uno de otra empresa falla y padre nulo pasa. Además, el costo de un insert masivo.
 */

const MIGRACION = '20261105170000_guarda_misma_empresa.sql'
const leer = (a: string) => readFileSync(join(process.cwd(), 'supabase/migrations', a), 'utf8')
const WS_A = '00000000-0000-4000-8000-0000000000a1'
const WS_B = '00000000-0000-4000-8000-0000000000b1'
const NEG_A = '00000000-0000-4000-8000-00000000a0a1'
const NEG_A2 = '00000000-0000-4000-8000-00000000a0a2'
const NEG_B = '00000000-0000-4000-8000-00000000b0b1'
const CON_A = '00000000-0000-4000-8000-00000000c0a1'
const CON_B = '00000000-0000-4000-8000-00000000c0b1'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create table public.workspaces (id uuid primary key);
    insert into public.workspaces values ('${WS_A}'), ('${WS_B}');
    create table public.contactos (id uuid primary key, workspace_id uuid not null references public.workspaces(id));
    insert into public.contactos values ('${CON_A}', '${WS_A}'), ('${CON_B}', '${WS_B}');
    create table public.negocios (id uuid primary key, workspace_id uuid not null references public.workspaces(id),
      contacto_id uuid references public.contactos(id));
    insert into public.negocios values ('${NEG_A}', '${WS_A}', '${CON_A}'), ('${NEG_A2}', '${WS_A}', null), ('${NEG_B}', '${WS_B}', '${CON_B}');
    create table public.gastos (id serial primary key, workspace_id uuid not null, negocio_id uuid references public.negocios(id), monto int);
    create table public.cobros (id serial primary key, workspace_id uuid not null, negocio_id uuid references public.negocios(id), monto int);
    create table public.activity_log (id serial primary key, workspace_id uuid not null, entidad_tipo text not null, entidad_id uuid not null, contenido text);
    create table public.contacto_perfil_hechos (id serial primary key, workspace_id uuid not null, contacto_id uuid not null references public.contactos(id), texto text);
  `)
  await db.exec(leer(MIGRACION))
}, 30_000)
afterAll(async () => { await db.close() })

async function codigoDe(sql: string, p: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, p)
    return null
  } catch (e) {
    return (e as { code?: string }).code ?? 'sin-codigo'
  }
}

const CASOS = [
  { tabla: 'gastos', col: 'negocio_id', propio: NEG_A, otro: NEG_B, nulo: true },
  { tabla: 'cobros', col: 'negocio_id', propio: NEG_A, otro: NEG_B, nulo: true },
  { tabla: 'contacto_perfil_hechos', col: 'contacto_id', propio: CON_A, otro: CON_B, nulo: false },
] as const

describe('guarda de misma empresa', () => {
  for (const c of CASOS) {
    describe(`${c.tabla}.${c.col}`, () => {
      it('rechaza con MK002 un padre de otra empresa', async () => {
        expect(await codigoDe(`insert into public.${c.tabla} (workspace_id, ${c.col}) values ($1, $2)`, [WS_A, c.otro])).toBe('MK002')
      })
      it('acepta un padre de la misma empresa', async () => {
        expect(await codigoDe(`insert into public.${c.tabla} (workspace_id, ${c.col}) values ($1, $2)`, [WS_A, c.propio])).toBeNull()
      })
      it('rechaza cambiar el padre a uno de otra empresa', async () => {
        const { rows } = await db.query<{ id: number }>(`insert into public.${c.tabla} (workspace_id, ${c.col}) values ($1, $2) returning id`, [WS_A, c.propio])
        expect(await codigoDe(`update public.${c.tabla} set ${c.col} = $1 where id = $2`, [c.otro, rows[0].id])).toBe('MK002')
      })
      it('rechaza mover la fila a otra empresa dejando el padre', async () => {
        const { rows } = await db.query<{ id: number }>(`insert into public.${c.tabla} (workspace_id, ${c.col}) values ($1, $2) returning id`, [WS_A, c.propio])
        expect(await codigoDe(`update public.${c.tabla} set workspace_id = $1 where id = $2`, [WS_B, rows[0].id])).toBe('MK002')
      })
      if (c.nulo) {
        it('acepta padre nulo', async () => {
          expect(await codigoDe(`insert into public.${c.tabla} (workspace_id, ${c.col}) values ($1, null)`, [WS_A])).toBeNull()
        })
      }
    })
  }

  describe('negocios.contacto_id', () => {
    it('rechaza un contacto de otra empresa al crear y al cambiar', async () => {
      expect(await codigoDe(`insert into public.negocios (id, workspace_id, contacto_id) values (gen_random_uuid(), $1, $2)`, [WS_A, CON_B])).toBe('MK002')
      expect(await codigoDe(`update public.negocios set contacto_id = $1 where id = $2`, [CON_B, NEG_A2])).toBe('MK002')
    })
    it('acepta un contacto de la misma empresa y sin contacto', async () => {
      expect(await codigoDe(`insert into public.negocios (id, workspace_id, contacto_id) values (gen_random_uuid(), $1, $2)`, [WS_A, CON_A])).toBeNull()
      expect(await codigoDe(`insert into public.negocios (id, workspace_id) values (gen_random_uuid(), $1)`, [WS_A])).toBeNull()
    })
  })

  describe('activity_log.entidad_id cuando entidad_tipo = negocio', () => {
    it('rechaza la actividad sobre un negocio de otra empresa', async () => {
      expect(await codigoDe(`insert into public.activity_log (workspace_id, entidad_tipo, entidad_id) values ($1, 'negocio', $2)`, [WS_A, NEG_B])).toBe('MK002')
    })
    it('acepta la del negocio propio', async () => {
      expect(await codigoDe(`insert into public.activity_log (workspace_id, entidad_tipo, entidad_id) values ($1, 'negocio', $2)`, [WS_A, NEG_A])).toBeNull()
    })
    it('no revisa otros tipos de entidad, aunque el id coincida con un negocio de otra empresa', async () => {
      expect(await codigoDe(`insert into public.activity_log (workspace_id, entidad_tipo, entidad_id) values ($1, 'workspace', $2)`, [WS_A, NEG_B])).toBeNull()
    })
    it('rechaza volver negocio una actividad que apunta a otra empresa', async () => {
      const { rows } = await db.query<{ id: number }>(`insert into public.activity_log (workspace_id, entidad_tipo, entidad_id) values ($1, 'contacto', $2) returning id`, [WS_A, NEG_B])
      expect(await codigoDe(`update public.activity_log set entidad_tipo = 'negocio' where id = $1`, [rows[0].id])).toBe('MK002')
    })
  })

  it('el mensaje nombra la tabla, la columna y el padre', async () => {
    await expect(db.query(`insert into public.gastos (workspace_id, negocio_id) values ($1, $2)`, [WS_A, NEG_B]))
      .rejects.toThrow('guarda de misma empresa: gastos.negocio_id apunta a negocios de otra empresa')
  })

  it('nadie fuera del dueño puede ejecutar la función', async () => {
    const { rows } = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.guarda_misma_empresa()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.guarda_misma_empresa()', 'execute') as auth`)
    expect(rows[0]).toEqual({ anon: false, auth: false })
  })

  it('costo: 5.000 gastos y 5.000 actividades en un insert cada uno', async () => {
    const medir = async (sql: string) => { const t = performance.now(); await db.exec(sql); return Math.round(performance.now() - t) }
    const gastos = `insert into public.gastos (workspace_id, negocio_id, monto) select '${WS_A}', '${NEG_A}', g from generate_series(1, 5000) g`
    const actividades = `insert into public.activity_log (workspace_id, entidad_tipo, entidad_id, contenido) select '${WS_A}', 'negocio', '${NEG_A}', 'x' from generate_series(1, 5000) g`
    const conGuarda = { gastos: await medir(gastos), actividades: await medir(actividades) }
    await db.exec(`alter table public.gastos disable trigger guarda_misma_empresa_negocio; alter table public.activity_log disable trigger guarda_misma_empresa_negocio;`)
    const sinGuarda = { gastos: await medir(gastos), actividades: await medir(actividades) }
    await db.exec(`alter table public.gastos enable trigger guarda_misma_empresa_negocio; alter table public.activity_log enable trigger guarda_misma_empresa_negocio;`)
    console.log('[guarda-misma-empresa] ms por 5.000 filas', { conGuarda, sinGuarda })
    expect(conGuarda.gastos).toBeGreaterThan(0)
  }, 60_000)
})
