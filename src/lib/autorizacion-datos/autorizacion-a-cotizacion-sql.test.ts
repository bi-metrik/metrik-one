import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * El SQL de configuración que mueve el gate `autorizacion_datos` de Solicitud (E1) a Cotización
 * (E2) en la línea de Trappvel, y su reversa, corridos de verdad en Postgres en memoria (PGlite)
 * sobre tablas sintéticas con los ids y textos medidos el 2026-10-21 (nada de clientes).
 */
const sql = (a: string) => readFileSync(join(process.cwd(), 'sql/trappvel', a), 'utf8')
const IDA = sql('2026-10-22_autorizacion-datos-a-cotizacion-PENDIENTE.sql')
const REVERSA = sql('2026-10-22_autorizacion-datos-a-cotizacion-REVERSA.sql')

const WS = 'cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc'
const LINEA = '42bba7b7-8ca2-41d8-93cf-ef6ab6f8f887'
const E1 = '3b6b4133-f656-4145-8e32-bf598cde68d0'
const E2 = '0138f4b0-6382-4377-b1ff-15d3e31bb051'
const BLOQUE = '01cacb65-6421-431e-859c-9d01f23f85d5'

const E1_CFG = {
  guia: { avanzar: 'Que el contacto haya firmado la autorización de datos: sin ella ONE no deja avanzar. Lo ideal es llegar con «Mínimo para cotizar» completo.' },
  gates: ['autorizacion_datos'],
  gate_messages: { 'autorizacion_datos:menores': 'Mensaje propio de menores' },
  sla_horas: 24,
}
const E2_CFG = { guia: { avanzar: 'Todo dice «Completo» y ONE no avisa que el viaje deja muy poca plata.' }, gates: ['margen_sobre_piso'] }
const DESC = 'El cliente autoriza el uso de sus datos en su link. Sin autorización el viaje no pasa a Cotización. Vale para todos sus viajes.'

let db: PGlite

async function sembrar() {
  await db.exec(`
    drop table if exists public.bloque_configs; drop table if exists public.etapas_negocio; drop table if exists public.lineas_negocio;
    create table public.lineas_negocio (id uuid primary key, workspace_id uuid not null);
    create table public.etapas_negocio (id uuid primary key, linea_id uuid not null, numero int not null, config_extra jsonb);
    create table public.bloque_configs (id uuid primary key, etapa_id uuid not null, descripcion text);
    insert into public.lineas_negocio values ('${LINEA}', '${WS}');
  `)
  await db.query('insert into public.etapas_negocio values ($1, $2, 1, $3), ($4, $2, 2, $5)', [E1, LINEA, JSON.stringify(E1_CFG), E2, JSON.stringify(E2_CFG)])
  await db.query('insert into public.bloque_configs values ($1, $2, $3)', [BLOQUE, E1, DESC])
}

const cfg = async (id: string) => (await db.query<{ c: Record<string, unknown> }>('select config_extra as c from public.etapas_negocio where id = $1', [id])).rows[0].c
const desc = async () => (await db.query<{ d: string }>('select descripcion as d from public.bloque_configs where id = $1', [BLOQUE])).rows[0].d

beforeAll(async () => { db = new PGlite() }, 30_000)
afterAll(async () => db.close())

describe('el gate de la autorización de datos pasa de Solicitud a Cotización', () => {
  it('E1 queda sin el gate, E2 lo suma sin perder el de margen, los mensajes viajan y los textos cambian', async () => {
    await sembrar()
    await db.exec(IDA)
    const e1 = await cfg(E1) as typeof E1_CFG
    const e2 = await cfg(E2) as typeof E2_CFG & { gate_messages?: Record<string, string> }
    expect(e1.gates).toEqual([])
    expect(e2.gates).toEqual(['margen_sobre_piso', 'autorizacion_datos'])
    expect(e2.gate_messages).toEqual({ 'autorizacion_datos:menores': 'Mensaje propio de menores' })
    expect(e1.gate_messages).toEqual({})
    expect(e1.sla_horas).toBe(24)
    expect(e1.guia.avanzar).toMatch(/sin ella se cotiza, pero la cotización no se envía/)
    expect(e2.guia.avanzar).toMatch(/el cliente ya autorizó sus datos/)
    expect(await desc()).toBe('El cliente autoriza el uso de sus datos en su link. Sin autorización se puede cotizar, pero la cotización no se envía al cliente. Vale para todos sus viajes.')
  }, 30_000)

  it('correrlo dos veces deja lo mismo (idempotente)', async () => {
    await sembrar()
    await db.exec(IDA)
    const una = [await cfg(E1), await cfg(E2), await desc()]
    await db.exec(IDA)
    expect([await cfg(E1), await cfg(E2), await desc()]).toEqual(una)
  }, 30_000)

  it('un texto que alguien cambió no se pisa', async () => {
    await sembrar()
    await db.query(`update public.etapas_negocio set config_extra = jsonb_set(config_extra, '{guia,avanzar}', '"Texto nuevo escrito a mano"') where id = $1`, [E1])
    await db.exec(IDA)
    expect((await cfg(E1) as typeof E1_CFG).guia.avanzar).toBe('Texto nuevo escrito a mano')
  }, 30_000)

  it('aborta si la línea no es del workspace medido', async () => {
    await sembrar()
    await db.exec(`update public.lineas_negocio set workspace_id = '00000000-0000-4000-8000-000000000000'`)
    await expect(db.exec(IDA)).rejects.toThrow(/no es del workspace/)
  }, 30_000)

  it('la reversa deja todo como estaba', async () => {
    await sembrar()
    const antes = [await cfg(E1), await cfg(E2), await desc()]
    await db.exec(IDA)
    await db.exec(REVERSA)
    const [e1, e2, d] = [await cfg(E1), await cfg(E2), await desc()]
    expect((e1 as typeof E1_CFG).gates).toEqual(['autorizacion_datos'])
    expect((e1 as typeof E1_CFG).gate_messages).toEqual(E1_CFG.gate_messages)
    expect((e1 as typeof E1_CFG).guia).toEqual((antes[0] as typeof E1_CFG).guia)
    expect((e2 as typeof E2_CFG).gates).toEqual(['margen_sobre_piso'])
    expect((e2 as typeof E2_CFG).guia).toEqual((antes[1] as typeof E2_CFG).guia)
    expect(d).toBe(antes[2])
  }, 30_000)
})
