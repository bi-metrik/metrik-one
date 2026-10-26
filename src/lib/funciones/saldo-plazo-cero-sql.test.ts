/**
 * `20261026210000_funciones_saldo_plazo_cero.sql` y su dry-run (`scripts/funciones-saldo-plazo-cero-dry-run.mjs`),
 * corridos de verdad en PGlite encima de la migración del módulo (`20261022170000_modulo_funciones.sql`, la que está en
 * producción). El comportamiento con 0 (plazo, link, `funcion_pasada`, estado) se prueba en `funciones-sql.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const RAIZ = process.cwd()
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), 'utf8')
const MIGRACION = leer('supabase/migrations/20261026210000_funciones_saldo_plazo_cero.sql')

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(leer('src/lib/funciones/__fixtures__/esquema-base.sql'))
  await db.exec(leer('supabase/migrations/20261021090000_asistente_chatwoot.sql'))
  await db.exec(leer('supabase/migrations/20261022170000_modulo_funciones.sql'))
})

afterAll(async () => {
  await db.close()
})

const checks = async () =>
  (await db.query<{ conname: string; d: string }>(
    `select conname, pg_get_constraintdef(oid) as d from pg_constraint
      where conname in ('funcion_campanas_dias_saldo_antes_check', 'funcion_reservas_dias_saldo_antes_check') order by conname`,
  )).rows

describe('migración 20261026210000: dias_saldo_antes = 0', () => {
  it('no toca datos: sin UPDATE, INSERT, DELETE ni cambio de default fuera del cuerpo de las funciones', () => {
    // El cuerpo de `funcion_guardar_campana` sí tiene insert/update (es la RPC que guarda): se mira lo demás.
    const sinComentarios = MIGRACION.replace(/\$\$[\s\S]*?\$\$/g, '').replace(/--.*$/gm, '')
    expect(MIGRACION.match(/\$\$/g)?.length).toBe(4)
    expect(sinComentarios).not.toMatch(/\b(update|insert|delete|truncate)\b/i)
    expect(sinComentarios).not.toMatch(/set default|drop default/i)
  })

  it('el dry-run dice OK con todas las verificaciones y no deja nada escrito', async () => {
    const dry = execFileSync('node', ['scripts/funciones-saldo-plazo-cero-dry-run.mjs'], { cwd: RAIZ, encoding: 'utf8' })
    expect(dry).toContain(MIGRACION)
    const antes = await checks()
    let mensaje = ''
    try {
      await db.exec(dry)
    } catch (e) {
      mensaje = (e as Error).message
    }
    expect(mensaje).toMatch(/^DRYRUN OK /)
    expect(JSON.parse(mensaje.replace(/^DRYRUN OK /, ''))).toEqual({
      plazo_cero: true,
      plazo_uno: true,
      plazo_uno_igual: true,
      checks_campanas: [true, true, true, false],
      checks_reservas: [true, true, true, false],
      guardar_solo_rango: true,
      grants_iguales: true,
      plazo_authenticated: false,
      plazo_service_role: false,
      guardar_anon: false,
      guardar_authenticated: true,
      guardar_service_role: false,
      default_es_1: true,
      filas_iguales: true,
    })
    // El raise deshace todo: los checks siguen de 1 a 30.
    expect(await checks()).toEqual(antes)
    expect(antes.map((c) => c.d)).toEqual(Array(2).fill('CHECK (((dias_saldo_antes >= 1) AND (dias_saldo_antes <= 30)))'))
  })

  it('aplicada: los checks van de 0 a 30 con el mismo nombre y el plazo 0 es la hora de inicio', async () => {
    await db.exec(MIGRACION)
    expect((await checks()).map((c) => c.d)).toEqual(Array(2).fill('CHECK (((dias_saldo_antes >= 0) AND (dias_saldo_antes <= 30)))'))
    const plazo = (await db.query<{ p: Date }>(`select funcion_plazo_saldo('2026-10-31 20:00-05', 0) as p`)).rows[0].p
    expect(plazo.toISOString()).toBe('2026-11-01T01:00:00.000Z')
  })
})
