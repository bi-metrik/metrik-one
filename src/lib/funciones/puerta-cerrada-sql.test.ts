/**
 * `20261026220000_funciones_puerta_cerrada.sql` y su dry-run (`scripts/funciones-puerta-cerrada-dry-run.mjs`),
 * corridos de verdad en PGlite encima de la migración del módulo (`20261022170000_modulo_funciones.sql`, la que está en
 * producción). Guardar y leer la ficha con la puerta, y el texto de punta a punta, se prueban en `funciones-sql.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const RAIZ = process.cwd()
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
const MIGRACION = leer('supabase/migrations/20261026220000_funciones_puerta_cerrada.sql')
const WS = '00000000-0000-4000-8000-00000000f901'
const EQUIPO = '00000000-0000-4000-8000-00000000f911'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(leer('src/lib/funciones/__fixtures__/esquema-base.sql'))
  await db.exec(leer('supabase/migrations/20261021090000_asistente_chatwoot.sql'))
  await db.exec(leer('supabase/migrations/20261022170000_modulo_funciones.sql'))
  // El perfil con el que el dry-run firma la prueba de guardar (en producción, el primero del equipo).
  await db.exec(`insert into public.workspaces (id, slug) values ('${WS}', 'sabor-prueba');
                 insert into public.profiles values ('${EQUIPO}', '${WS}', 'operator');`)
})

afterAll(async () => {
  await db.close()
})

const columna = async () =>
  (await db.query(`select 1 from pg_attribute where attrelid = 'public.funcion_experiencias'::regclass
                    and attname = 'puerta_cerrada' and not attisdropped`)).rows.length

describe('migración 20261026220000: puerta_cerrada en la ficha', () => {
  it('no toca datos: sin UPDATE, INSERT, DELETE ni TRUNCATE fuera del cuerpo de las funciones', () => {
    const sinComentarios = MIGRACION.replace(/\$\$[\s\S]*?\$\$/g, '').replace(/--.*$/gm, '')
    expect(MIGRACION.match(/\$\$/g)?.length).toBe(4)
    expect(sinComentarios).not.toMatch(/\b(update|insert|delete|truncate)\b/i)
    expect(sinComentarios).toMatch(/add column puerta_cerrada boolean not null default false/)
  })

  it('el dry-run dice OK con todas las verificaciones y no deja nada escrito', async () => {
    const dry = execFileSync('node', ['scripts/funciones-puerta-cerrada-dry-run.mjs'], { cwd: RAIZ, encoding: 'utf8' })
    expect(dry).toContain(MIGRACION)
    let mensaje = ''
    try {
      await db.exec(dry)
    } catch (e) {
      mensaje = (e as Error).message
    }
    expect(mensaje).toMatch(/^DRYRUN OK /)
    expect(JSON.parse(mensaje.replace(/^DRYRUN OK /, ''))).toEqual({
      columna_default_false: true,
      columna_not_null: true,
      grants_iguales: true,
      guardar_anon: false,
      guardar_authenticated: true,
      guardar_service_role: false,
      panel_anon: false,
      panel_authenticated: true,
      panel_service_role: false,
      guardada_true: true,
      sin_llave_queda_false: true,
      llave_no_booleana_rechazada: true,
      panel_devuelve_true: true,
      filas_iguales: true,
      workspaces_con_modulo: 0,
    })
    // El raise deshace todo: ni la columna ni las filas de la prueba.
    expect(await columna()).toBe(0)
    expect((await db.query(`select count(*)::int as n from public.funcion_experiencias`)).rows).toEqual([{ n: 0 }])
  })

  it('aplicada: una ficha que ya existía queda desmarcada', async () => {
    await db.exec(`insert into public.funcion_experiencias (workspace_id, nombre) values ('${WS}', 'Cata de vinos')`)
    await db.exec(MIGRACION)
    expect(await columna()).toBe(1)
    expect((await db.query(`select puerta_cerrada from public.funcion_experiencias`)).rows).toEqual([{ puerta_cerrada: false }])
  })
})
