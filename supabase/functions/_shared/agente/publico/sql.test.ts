import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { fichaValida } from '../reglamento'
import { semillaSqlSabor } from './semilla-sql'
import { REGLAMENTO_SABOR } from './reglamento-sabor'
import { sistemaPublico } from './prompt'
import { CONFIG_POR_DEFECTO } from '../config'

/**
 * La migración del asistente público (`chatwoot_conversacion`, `chatwoot_consentimientos`) y la semilla de PRUEBA del
 * reglamento de Sabor, con LOS ARCHIVOS en Postgres en memoria (PGlite). Nada toca producción.
 */

const raiz = process.cwd()
const leer = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const MIGRACION = '20261021090000_asistente_chatwoot.sql'
const WS = '00000000-0000-4000-8000-0000000000b1'
const WS_PRUEBA = '00000000-0000-4000-8000-0000000000b2'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    set time zone 'UTC';
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.workspaces (id uuid primary key, slug text, config_extra jsonb);
    insert into public.workspaces values ('${WS}', 'sabor', '{}'), ('${WS_PRUEBA}', 'sabor-pruebas', '{"espacio_de_pruebas": true}');
  `)
  await db.exec(leer('20261006213100_wa_conversacion.sql'))
  await db.exec(leer('20261006213200_bot_reglamento_y_uso.sql'))
})
afterAll(async () => { await db.close() })

/** El ensayo que va en el PR: la migración entera dentro de un DO que termina en excepción (todo se revierte). */
export function dryRun(sql: string): string {
  return `do $dry$\nbegin\n  execute $mig$\n${sql}\n$mig$;\n  raise exception 'dry-run OK: la migración corre entera (se revierte)';\nend\n$dry$;`
}

describe('migración 20261021090000 (asistente sobre Chatwoot)', () => {
  it('el ensayo DO $dry$ corre la migración entera y no deja nada', async () => {
    await expect(db.exec(dryRun(leer(MIGRACION)))).rejects.toThrow(/dry-run OK/)
    const r = await db.query<{ n: number }>(`select count(*)::int as n from pg_class where relname in ('chatwoot_conversacion', 'chatwoot_consentimientos')`)
    expect(r.rows[0].n).toBe(0)
  })

  it('se aplica y crea las dos tablas con RLS, sin grants a anon ni authenticated', async () => {
    await db.exec(leer(MIGRACION))
    const t = await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname in ('chatwoot_conversacion', 'chatwoot_consentimientos') order by relname`)
    expect(t.rows).toEqual([{ relname: 'chatwoot_consentimientos', relrowsecurity: true }, { relname: 'chatwoot_conversacion', relrowsecurity: true }])
    const g = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.role_table_grants where table_name like 'chatwoot_%' and grantee in ('anon', 'authenticated')`)
    expect(g.rows[0].n).toBe(0)
    // wa_conversacion (Trappvel) no cambia.
    const c = await db.query<{ n: number }>(`select count(*)::int as n from information_schema.columns where table_name = 'wa_conversacion'`)
    expect(c.rows[0].n).toBeGreaterThan(0)
  })

  const entrante = (id: number) => db.query(
    `insert into public.chatwoot_conversacion (workspace_id, cuenta_id, conversacion_id, canal, direccion, clase, texto, chatwoot_message_id) values ($1, 77, 9001, 'instagram', 'entrante', 'escrito', 'hola', $2)`,
    [WS, id],
  )

  it('el mismo mensaje de Chatwoot no entra dos veces (reintento del webhook)', async () => {
    await entrante(1)
    await expect(entrante(1)).rejects.toThrow(/duplicate key|chatwoot_conversacion_mensaje/)
  })

  it('una ranura por turno: el mismo turno no publica dos veces la misma cosa', async () => {
    const turno = '00000000-0000-4000-8000-00000000c001'
    const salida = () => db.query(
      `insert into public.chatwoot_conversacion (workspace_id, cuenta_id, conversacion_id, canal, direccion, clase, texto, turno_id, ranura, estado) values ($1, 77, 9001, 'instagram', 'saliente', 'bot', 'hola', $2, 'respuesta', 'generado')`,
      [WS, turno],
    )
    await salida()
    await expect(salida()).rejects.toThrow(/duplicate key|ranura_turno/)
  })

  it('un entrante no lleva estado de publicación, y un saliente sí', async () => {
    await expect(db.query(`insert into public.chatwoot_conversacion (workspace_id, cuenta_id, conversacion_id, canal, direccion, clase, estado) values ($1, 77, 1, 'instagram', 'entrante', 'escrito', 'publicado')`, [WS])).rejects.toThrow(/check/)
    await expect(db.query(`insert into public.chatwoot_conversacion (workspace_id, cuenta_id, conversacion_id, canal, direccion, clase, ranura) values ($1, 77, 1, 'instagram', 'saliente', 'bot', 'respuesta')`, [WS])).rejects.toThrow(/check/)
  })

  it('la prueba de un consentimiento no se edita, y exige huella sha256', async () => {
    const h = 'a'.repeat(64)
    await db.query(`insert into public.chatwoot_consentimientos (workspace_id, cuenta_id, conversacion_id, canal, tipo, respuesta, texto_clave, texto_version, texto_huella, mensaje_texto, chatwoot_message_id) values ($1, 77, 9001, 'instagram', 'general', 'si', 'rf.autorizacion', 'v1', $2, 'Sí', 5)`, [WS, h])
    await expect(db.query(`update public.chatwoot_consentimientos set respuesta = 'no'`)).rejects.toThrow(/inmutable/)
    await expect(db.query(`insert into public.chatwoot_consentimientos (workspace_id, cuenta_id, conversacion_id, canal, tipo, respuesta, texto_clave, texto_version, texto_huella) values ($1, 77, 9001, 'instagram', 'aviso', 'si', 'rf.bienvenida', 'v1', $2)`, [WS, h])).rejects.toThrow(/check/)
    await expect(db.query(`insert into public.chatwoot_consentimientos (workspace_id, cuenta_id, conversacion_id, canal, tipo, respuesta, texto_clave, texto_version, texto_huella) values ($1, 77, 9001, 'instagram', 'general', 'si', 'rf.autorizacion', 'v1', 'corta')`, [WS])).rejects.toThrow(/check/)
    // Supresión de datos: se puede borrar.
    await db.query(`delete from public.chatwoot_consentimientos where workspace_id = $1`, [WS])
  })
})

describe('semilla de PRUEBA del reglamento de Sabor', () => {
  const SEMILLA = readFileSync(join(raiz, 'sql/sabor/2026-10-21_reglamento-asistente-PRUEBA.sql'), 'utf8')

  it('el archivo es exactamente la salida del generador', () => {
    expect(SEMILLA.trimEnd()).toBe(semillaSqlSabor().trimEnd())
  })

  it('se niega a correr en un workspace que no es de pruebas', async () => {
    await expect(db.exec(SEMILLA.replaceAll('<WORKSPACE_DE_PRUEBA>', WS))).rejects.toThrow(/espacio_de_pruebas/)
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.bot_parametros where workspace_id = $1`, [WS])
    expect(r.rows[0].n).toBe(0)
  })

  it('en el de pruebas publica la versión 1, con fichas válidas y el prompt armado desde la base', async () => {
    await db.exec(SEMILLA.replaceAll('<WORKSPACE_DE_PRUEBA>', WS_PRUEBA))
    const r = await db.query<{ version: number; fichas: unknown[] }>(`select version, fichas from public.bot_reglamentos where workspace_id = $1 and bot = 'asistente-publico'`, [WS_PRUEBA])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].version).toBe(1)
    const fichas = r.rows[0].fichas.map(fichaValida)
    expect(fichas.every(Boolean)).toBe(true)
    expect(fichas).toHaveLength(REGLAMENTO_SABOR.length)
    const sis = sistemaPublico({ id: 'x', version: 1, huella: 'h', fichas: fichas as NonNullable<ReturnType<typeof fichaValida>>[] }, CONFIG_POR_DEFECTO)
    expect(sis).toContain('<reglas_que_no_ceden>')
    // El catálogo y las respuestas fijas nunca entran al sistema.
    expect(sis).not.toContain('95000')
    expect(sis).not.toContain('Calle Falsa')
    expect(sis).not.toContain('Un momento, tu respuesta')
  })
})
