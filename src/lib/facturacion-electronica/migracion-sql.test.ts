/**
 * `20261014233000_facturacion_electronica_automatica.sql` corrida de verdad en Postgres en memoria
 * (PGlite): el consecutivo se asigna una vez, no se repite, respeta el tope y no cruza modos; la llave
 * deja una fila por pago; las tablas quedan cerradas a anon y authenticated; y el aviso al equipo
 * cabe en `notificaciones`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACION = readFileSync(join(process.cwd(), 'supabase/migrations/20261014233000_facturacion_electronica_automatica.sql'), 'utf8')

const WS = '00000000-0000-4000-8000-00000000f001'
const COBRO_1 = '00000000-0000-4000-8000-00000000f011'
const COBRO_2 = '00000000-0000-4000-8000-00000000f012'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.workspaces (id uuid primary key);
  create table public.cobros (id uuid primary key, workspace_id uuid not null);
  create table public.notificaciones (
    id uuid primary key default gen_random_uuid(),
    tipo text not null,
    constraint notificaciones_tipo_check check (tipo in ('cuota_por_vencer', 'aprobacion_pendiente'))
  );
`

let db: PGlite

async function emision(cobro: string, modo = 'Production', tipo = 'factura', origen: string | null = null): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.facturas_electronicas (workspace_id, cobro_id, tipo, llave, modo, factura_origen_id, concepto_nota)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [WS, cobro, tipo, `${tipo}:${cobro}:${modo}:${Math.random()}`, modo, origen, origen ? '2' : null],
  )
  return r.rows[0].id
}

async function asignar(id: string): Promise<{ prefijo: string; consecutivo: number }> {
  const r = await db.query<{ prefijo: string; consecutivo: string }>('select * from public.facturacion_asignar_consecutivo($1)', [id])
  return { prefijo: r.rows[0].prefijo, consecutivo: Number(r.rows[0].consecutivo) }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(MIGRACION)
})

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  await db.exec(`
    delete from public.facturas_electronicas;
    delete from public.facturacion_numeracion;
    delete from public.cobros;
    delete from public.workspaces;
    insert into public.workspaces values ('${WS}');
    insert into public.cobros values ('${COBRO_1}', '${WS}'), ('${COBRO_2}', '${WS}');
  `)
})

describe('facturacion_asignar_consecutivo', () => {
  it('sin numeración cargada: sin_numeracion', async () => {
    const id = await emision(COBRO_1)
    await expect(asignar(id)).rejects.toThrow(/sin_numeracion/)
  })

  it('da el siguiente, lo deja en la fila y no lo repite', async () => {
    await db.exec(`insert into public.facturacion_numeracion values ('${WS}', 'Production', 'factura', 'FE', 7, 1000, now())`)
    const a = await emision(COBRO_1)
    const b = await emision(COBRO_2)
    expect(await asignar(a)).toEqual({ prefijo: 'FE', consecutivo: 7 })
    expect(await asignar(b)).toEqual({ prefijo: 'FE', consecutivo: 8 })
    const fila = await db.query<{ numero: string; consecutivo: string }>('select numero, consecutivo from public.facturas_electronicas where id = $1', [a])
    expect({ ...fila.rows[0], consecutivo: Number(fila.rows[0].consecutivo) }).toEqual({ numero: 'FE7', consecutivo: 7 })
  })

  it('una emisión con número recibe EL MISMO otra vez (reintento)', async () => {
    await db.exec(`insert into public.facturacion_numeracion values ('${WS}', 'Production', 'factura', 'FE', 7, 1000, now())`)
    const a = await emision(COBRO_1)
    await asignar(a)
    expect(await asignar(a)).toEqual({ prefijo: 'FE', consecutivo: 7 })
    const n = await db.query<{ siguiente: string }>('select siguiente from public.facturacion_numeracion')
    expect(Number(n.rows[0].siguiente)).toBe(8)
  })

  it('respeta el tope de la resolución', async () => {
    await db.exec(`insert into public.facturacion_numeracion values ('${WS}', 'Production', 'factura', 'FE', 1000, 1000, now())`)
    expect((await asignar(await emision(COBRO_1))).consecutivo).toBe(1000)
    await expect(asignar(await emision(COBRO_2))).rejects.toThrow(/rango_agotado/)
  })

  it('un modo no gasta los números de otro', async () => {
    await db.exec(`
      insert into public.facturacion_numeracion values ('${WS}', 'Production', 'factura', 'FE', 7, 1000, now());
      insert into public.facturacion_numeracion values ('${WS}', 'Test', 'factura', 'SETP', 990000001, 995000000, now());
    `)
    expect(await asignar(await emision(COBRO_1, 'Test'))).toEqual({ prefijo: 'SETP', consecutivo: 990000001 })
    expect(await asignar(await emision(COBRO_1, 'Production'))).toEqual({ prefijo: 'FE', consecutivo: 7 })
  })

  it('la nota crédito tiene su propia serie', async () => {
    await db.exec(`
      insert into public.facturacion_numeracion values ('${WS}', 'Production', 'factura', 'FE', 7, 1000, now());
      insert into public.facturacion_numeracion values ('${WS}', 'Production', 'nota_credito', 'NC', 1, null, now());
    `)
    const f = await emision(COBRO_1)
    await asignar(f)
    expect(await asignar(await emision(COBRO_1, 'Production', 'nota_credito', f))).toEqual({ prefijo: 'NC', consecutivo: 1 })
  })
})

describe('facturas_electronicas', () => {
  it('la llave deja UNA fila por pago y modo', async () => {
    await db.query(`insert into public.facturas_electronicas (workspace_id, cobro_id, tipo, llave, modo) values ($1, $2, 'factura', $3, 'Production')`, [WS, COBRO_1, `factura:${COBRO_1}:Production`])
    const otra = await db.query(
      `insert into public.facturas_electronicas (workspace_id, cobro_id, tipo, llave, modo) values ($1, $2, 'factura', $3, 'Production')
       on conflict (llave) do nothing returning id`,
      [WS, COBRO_1, `factura:${COBRO_1}:Production`],
    )
    expect(otra.rows).toHaveLength(0)
  })

  it('emitida exige CUFE de 96 hex, número y fecha', async () => {
    const id = await emision(COBRO_1)
    await expect(db.query(`update public.facturas_electronicas set estado = 'emitida' where id = $1`, [id])).rejects.toThrow()
    await expect(db.query(`update public.facturas_electronicas set cufe = 'abc' where id = $1`, [id])).rejects.toThrow()
    await db.query(
      `update public.facturas_electronicas set estado = 'emitida', cufe = $2, numero = 'FE7', fecha_emision = '2026-10-20', prefijo = 'FE', consecutivo = 7 where id = $1`,
      [id, 'a'.repeat(96)],
    )
  })

  it('una nota crédito sin factura de origen no entra', async () => {
    await expect(
      db.query(`insert into public.facturas_electronicas (workspace_id, cobro_id, tipo, llave, modo) values ($1, $2, 'nota_credito', 'nota:sin-origen-x', 'Production')`, [WS, COBRO_1]),
    ).rejects.toThrow()
  })

  it('un cobro con documento no se borra', async () => {
    await emision(COBRO_1)
    await expect(db.query('delete from public.cobros where id = $1', [COBRO_1])).rejects.toThrow()
  })

  it('cerradas a anon y authenticated; la función solo para service_role', async () => {
    const t = await db.query<{ acl: string | null }>(
      `select relacl::text as acl from pg_class where oid in ('public.facturas_electronicas'::regclass, 'public.facturacion_numeracion'::regclass)`,
    )
    for (const r of t.rows) {
      expect(r.acl ?? '').not.toMatch(/anon=|authenticated=/)
    }
    const f = await db.query<{ acl: string }>(`select proacl::text as acl from pg_proc where proname = 'facturacion_asignar_consecutivo'`)
    expect(f.rows[0].acl).toContain('service_role=X')
    expect(f.rows[0].acl).not.toMatch(/anon=|authenticated=|[{,]=X/)
  })
})

describe('notificaciones', () => {
  it('el aviso al equipo cabe, sin perder los tipos que ya había', async () => {
    await db.exec(`insert into public.notificaciones (tipo) values ('factura_electronica'), ('cuota_por_vencer')`)
    await expect(db.exec(`insert into public.notificaciones (tipo) values ('otro')`)).rejects.toThrow()
  })

  it('aplicarla dos veces no duplica el tipo', async () => {
    const antes = await db.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'notificaciones_tipo_check'`)
    await db.exec(MIGRACION.slice(MIGRACION.indexOf('-- ── 4. El aviso al equipo')))
    const despues = await db.query<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'notificaciones_tipo_check'`)
    expect(despues.rows[0].d).toBe(antes.rows[0].d)
  })
})
