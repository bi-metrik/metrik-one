import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Las dos migraciones de «avanzar un cruce con motivo», ejecutadas de verdad en PGlite
 * sobre tablas con la forma de producción (solo lo que leen; ningún dato de cliente):
 *
 *   * 20261005120000: la tabla de excepciones, que la sesión LEE pero no escribe (si la
 *     sesión pudiera insertar, cualquiera se fabricaría su excepción), y el resumen de 7
 *     días por cruce;
 *   * 20261005120100 (SOENA): la lista de dos personas y la advertencia en los 4 cruces
 *     de antes de radicar, re-aplicable, sin tocar los demás cruces ni el resto del
 *     workspace; se niega a correr sin las personas o sin los cruces.
 */

const DIR = join(process.cwd(), 'supabase/migrations')
const ESQUEMA = readFileSync(join(DIR, '20261005120000_negocio_cruces_avanzados.sql'), 'utf8')
const SOENA = readFileSync(join(DIR, '20261005120100_soena_avanzar_cruces_con_motivo.sql'), 'utf8')

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const LINEA = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
const ADMIN = 'c914313f-3042-4757-92f3-e96c35b3b6d6'
const SUPERVISORA = '6f107e73-cfb7-4869-acd3-73195173f249'
const OTRO_WS = '00000000-0000-4000-8000-0000000000a1'
const NEGOCIO = '00000000-0000-4000-8000-0000000000c1'

const ANTES_DE_RADICAR = [
  'factura_compradores_vs_titularidad',
  'rut_entre_compradores',
  'rut2_entre_compradores',
  'titular_2_completo_antes_de_radicar',
]
const CRUCES = [
  { slug: 'factura_compradores_vs_titularidad', tipo: 'cantidad', bloquea_en_etapas: [6, 7] },
  { slug: 'rut_entre_compradores', tipo: 'documento_en_lista', bloquea_en_etapas: [6] },
  { slug: 'rut2_entre_compradores', tipo: 'documento_en_lista', bloquea_en_etapas: [6, 7] },
  { slug: 'certificado_personas_vs_titularidad', tipo: 'cantidad', bloquea_en_etapas: [9, 10] },
  { slug: 'certificado_valor_vs_factura', tipo: 'coincide', bloquea_en_etapas: [9, 18] },
  { slug: 'titular_2_completo_antes_de_radicar', tipo: 'requeridos', bloquea_en_etapas: [6, 7] },
]
const ADVERTENCIA =
  'Si radicas así, la UPME puede emitir el certificado incompleto y habría que pagar la tarifa otra vez'

let db: PGlite

async function cruces(): Promise<Array<Record<string, unknown>>> {
  const r = await db.query<{ c: Array<Record<string, unknown>> }>(
    `select config_extra->'cruces' as c from lineas_negocio where id = $1`, [LINEA])
  return r.rows[0].c
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table workspaces (id uuid primary key, config_extra jsonb);
    create table staff (id uuid primary key, workspace_id uuid, full_name text, is_active boolean);
    create table negocios (id uuid primary key, workspace_id uuid, codigo text);
    create table etapas_negocio (id uuid primary key);
    create table lineas_negocio (id uuid primary key, workspace_id uuid not null, config_extra jsonb);
    create function current_user_workspace_id() returns uuid language sql stable as $$ select '${WS}'::uuid $$;
    insert into workspaces values
      ('${WS}', '{"omitir_gate": {"staff_ids": ["${ADMIN}"]}, "otra": 1}'),
      ('${OTRO_WS}', '{}');
    insert into staff values
      ('${ADMIN}', '${WS}', 'Administradora', true),
      ('${SUPERVISORA}', '${WS}', 'Supervisora', true);
    insert into negocios values ('${NEGOCIO}', '${WS}', 'V0001');
    insert into lineas_negocio values ('${LINEA}', '${WS}', jsonb_build_object('cruces', '${JSON.stringify(CRUCES)}'::jsonb, 'otra', 1));
  `)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('20261005120000 (tabla de excepciones y resumen)', () => {
  it('aplica, y aplicada dos veces no rompe', async () => {
    await db.exec(ESQUEMA)
    await db.exec(ESQUEMA)
  })

  it('la sesión no puede escribir excepciones', async () => {
    await db.exec('set role authenticated')
    await expect(db.query(
      `insert into negocio_cruces_avanzados (workspace_id, negocio_id, cruce_slug, huella, mensaje, motivo, autor_id)
       values ($1, $2, 'x', 'h', 'm', 'Un motivo de una frase completa.', $3)`, [WS, NEGOCIO, ADMIN],
    )).rejects.toThrow(/permission denied/)
    await db.exec('reset role')
  })

  it('el motivo tiene que ser una frase', async () => {
    await expect(db.query(
      `insert into negocio_cruces_avanzados (workspace_id, negocio_id, cruce_slug, huella, mensaje, motivo, autor_id)
       values ($1, $2, 'x', 'h', 'm', '  corto  ', $3)`, [WS, NEGOCIO, ADMIN],
    )).rejects.toThrow(/check/)
  })

  it('el resumen cuenta por cruce los últimos 7 días, con quién y el motivo', async () => {
    await db.query(
      `insert into negocio_cruces_avanzados (workspace_id, negocio_id, cruce_slug, huella, mensaje, motivo, autor_id, created_at)
       values ($1, $2, 'certificado_valor_vs_factura', 'h1', 'm', 'El proveedor confirmó el valor.', $3, now()),
              ($1, $2, 'certificado_valor_vs_factura', 'h2', 'm', 'Otra vez el mismo proveedor.', $4, now()),
              ($1, $2, 'certificado_valor_vs_factura', 'h0', 'm', 'Hace más de una semana ya.', $3, now() - interval '8 days')`,
      [WS, NEGOCIO, ADMIN, SUPERVISORA],
    )
    const r = await db.query<{ cruce_slug: string; avances: number; negocios: number; autores: string; detalle: Array<{ motivo: string }> }>(
      `select * from v_cruces_avanzados_7d where workspace_id = $1`, [WS])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ cruce_slug: 'certificado_valor_vs_factura', avances: 2, negocios: 1 })
    expect(r.rows[0].autores.split(', ').sort()).toEqual(['Administradora', 'Supervisora'])
    expect(r.rows[0].detalle.map(d => d.motivo).sort()).toEqual(['El proveedor confirmó el valor.', 'Otra vez el mismo proveedor.'])
  })
})

describe('20261005120100 (configuración de SOENA)', () => {
  it('aplica, y aplicada dos veces deja lo mismo', async () => {
    await db.exec(SOENA)
    const una = await cruces()
    const ws1 = (await db.query(`select config_extra from workspaces where id = $1`, [WS])).rows
    await db.exec(SOENA)
    expect(await cruces()).toEqual(una)
    expect((await db.query(`select config_extra from workspaces where id = $1`, [WS])).rows).toEqual(ws1)
  })

  it('declara las dos personas sin tocar el resto del workspace', async () => {
    const r = await db.query<{ c: Record<string, unknown> }>(`select config_extra as c from workspaces where id = $1`, [WS])
    expect(r.rows[0].c).toEqual({
      omitir_gate: { staff_ids: [ADMIN] },
      otra: 1,
      avanzar_cruces: { staff_ids: [ADMIN, SUPERVISORA] },
    })
    const otro = await db.query<{ c: Record<string, unknown> }>(`select config_extra as c from workspaces where id = $1`, [OTRO_WS])
    expect(otro.rows[0].c).toEqual({})
  })

  it('la advertencia queda en los 4 de antes de radicar y en ninguno más, sin reordenar', async () => {
    const c = await cruces()
    expect(c.map(x => x.slug)).toEqual(CRUCES.map(x => x.slug))
    for (const x of c) {
      if (ANTES_DE_RADICAR.includes(x.slug as string)) expect(x.advertencia).toBe(ADVERTENCIA)
      else expect(x).not.toHaveProperty('advertencia')
      // El resto de la definición, tal cual.
      const antes = CRUCES.find(y => y.slug === x.slug)
      expect(x.bloquea_en_etapas).toEqual(antes?.bloquea_en_etapas)
    }
  })

  it('se niega a correr si una de las dos personas no está activa', async () => {
    await db.exec(`update staff set is_active = false where id = '${SUPERVISORA}'`)
    await expect(db.exec(SOENA)).rejects.toThrow(/personas autorizadas/)
    await db.exec(`update staff set is_active = true where id = '${SUPERVISORA}'`)
  })
})
