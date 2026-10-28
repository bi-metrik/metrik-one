import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

import { politicaMargenDeLinea } from './convencion-margen'
import { POLITICA_REGLAS_POR_DEFECTO, politicaReglasDeLinea } from './reglas-margen'

/**
 * El SQL de configuración que enciende las reglas de margen en la línea de Trappvel, y su reversa,
 * corridos de verdad en Postgres en memoria (PGlite) sobre una tabla sintética con el `config_extra`
 * que describe el brief del 2026-10-27 (nada de clientes). Lo que deja se lee con las MISMAS
 * funciones que usa la app.
 */
const sql = (a: string) => readFileSync(join(process.cwd(), 'sql/trappvel', a), 'utf8')
const IDA = sql('2026-10-27_reglas-margen-PENDIENTE.sql')
const REVERSA = sql('2026-10-27_reglas-margen-REVERSA.sql')

const WS = 'cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc'
const LINEA = '42bba7b7-8ca2-41d8-93cf-ef6ab6f8f887'
const CFG = {
  margen: { convencion: 'sobre_venta', default_pct: 15, piso_pct: 5, aviso_pct: 10, provisional: true },
  recargo: { activo: false, valor: 0 },
  plan_pagos: { activo: true },
}

let db: PGlite

async function sembrar(cfg: unknown = CFG) {
  await db.exec(`
    drop table if exists public.lineas_negocio;
    create table public.lineas_negocio (id uuid primary key, workspace_id uuid not null, config_extra jsonb);
  `)
  await db.query('insert into public.lineas_negocio values ($1, $2, $3)', [LINEA, WS, JSON.stringify(cfg)])
}
const leer = async () => (await db.query<{ c: Record<string, unknown> }>('select config_extra as c from public.lineas_negocio where id = $1', [LINEA])).rows[0].c

beforeAll(async () => { db = new PGlite() }, 30_000)
afterAll(async () => db.close())

describe('el SQL de las reglas de margen de Trappvel', () => {
  it('declara las reglas con los valores del brief, sube el mínimo a 12 y no toca lo demás', async () => {
    await sembrar()
    await db.exec(IDA)
    const cfg = await leer()
    expect(politicaReglasDeLinea(cfg)).toEqual(POLITICA_REGLAS_POR_DEFECTO)
    expect(politicaMargenDeLinea(cfg)).toEqual({ convencion: 'sobre_venta', defaultPct: 15, pisoPct: 12, avisoPct: 12 })
    expect((cfg.margen as { provisional?: boolean }).provisional).toBe(true)
    expect(cfg.recargo).toEqual(CFG.recargo)
    expect(cfg.plan_pagos).toEqual(CFG.plan_pagos)
  }, 30_000)

  it('correrlo dos veces deja lo mismo (idempotente)', async () => {
    await sembrar()
    await db.exec(IDA)
    const una = await leer()
    await db.exec(IDA)
    expect(await leer()).toEqual(una)
  }, 30_000)

  it('un aviso por encima de 12 se respeta', async () => {
    await sembrar({ ...CFG, margen: { ...CFG.margen, aviso_pct: 14 } })
    await db.exec(IDA)
    expect(politicaMargenDeLinea(await leer()).avisoPct).toBe(14)
  }, 30_000)

  it('aborta si el margen no es sobre_venta', async () => {
    await sembrar({ ...CFG, margen: { ...CFG.margen, convencion: 'markup' } })
    await expect(db.exec(IDA)).rejects.toThrow(/sobre_venta/)
  }, 30_000)

  it('la reversa quita las reglas y devuelve 5 y 10', async () => {
    await sembrar()
    await db.exec(IDA)
    await db.exec(REVERSA)
    const cfg = await leer()
    expect(politicaReglasDeLinea(cfg)).toBeNull()
    expect(cfg.margen).toEqual(CFG.margen)
  }, 30_000)
})
