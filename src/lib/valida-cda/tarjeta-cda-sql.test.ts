import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/** La migración de `tarjetas_pago_cda` (20261030220000), ejecutada de verdad en PGlite. */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261030220000_valida_cda_tarjeta_epayco.sql')
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [WS_M, WS_C, SC, NEG, PLAN, DOC, ANA] = [1, 2, 3, 4, 5, 6, 7].map(ID)

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.query(sql)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

const insertar = (id: string, extra = '') =>
  `insert into public.tarjetas_pago_cda (id, workspace_id, workspace_cliente_id, servicio_contratado_id, negocio_id, plan_cobro_id,
     metodo_pago_ref, ultimos4, titular, celular, correo, cobro_desde, dia_renovacion, terminos_documento_id, terminos_vigente_desde,
     autorizacion_texto, autorizacion_sha256, usuario_id ${extra ? ', estado, cerrada_at' : ''})
   values ('${id}', '${WS_M}', '${WS_C}', '${SC}', '${NEG}', '${PLAN}', 'epayco:Cust1234:Tok12345', '1234', '{"nombre":"Ana"}', '3001234567',
     'ana@cda.co', '2026-10-30', 23, '${DOC}', '2026-12-01', 'Autorizo…', '${'a'.repeat(64)}', '${ANA}' ${extra})`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table public.workspaces (id uuid primary key);
    create table public.servicios_contratados (id uuid primary key);
    create table public.negocios (id uuid primary key);
    create table public.planes_cobro (id uuid primary key);
    create table public.documentos_contractuales_versiones (id uuid primary key);
    create table public.profiles (id uuid primary key);
    insert into public.workspaces values ('${WS_M}'), ('${WS_C}');
    insert into public.servicios_contratados values ('${SC}');
    insert into public.negocios values ('${NEG}');
    insert into public.planes_cobro values ('${PLAN}');
    insert into public.documentos_contractuales_versiones values ('${DOC}');
    insert into public.profiles values ('${ANA}');
  `)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('tarjetas_pago_cda', () => {
  it('una sola activa por contrato; una cerrada más no estorba', async () => {
    expect(await falla(insertar(ID(10)))).toBeNull()
    expect(await falla(insertar(ID(11)))).toMatch(/uq_tarjetas_pago_cda_activa|duplicate key/)
    expect(await falla(insertar(ID(12), `, 'reemplazada', now()`))).toBeNull()
  })

  it('solo guarda un puntero de ePayco, nunca una tarjeta', async () => {
    expect(await falla(insertar(ID(13)).replace('epayco:Cust1234:Tok12345', '4111111111111111'))).toMatch(/tarjetas_pago_cda_ref/)
  })

  it('lo autorizado no cambia; el cierre sí, y una tarjeta cerrada no vuelve a cobrar; no se borra', async () => {
    expect(await falla(`update public.tarjetas_pago_cda set autorizacion_texto = 'otro' where id = '${ID(10)}'`)).toMatch(/lo autorizado no cambia/)
    expect(await falla(`update public.tarjetas_pago_cda set cobro_desde = '2026-01-01' where id = '${ID(10)}'`)).toMatch(/lo autorizado no cambia/)
    expect(await falla(`update public.tarjetas_pago_cda set estado = 'quitada', cerrada_at = now(), cerrada_por = '${ANA}' where id = '${ID(10)}'`)).toBeNull()
    expect(await falla(`update public.tarjetas_pago_cda set borrado_epayco = 'ok' where id = '${ID(10)}'`)).toBeNull()
    expect(await falla(`update public.tarjetas_pago_cda set estado = 'activa', cerrada_at = null where id = '${ID(10)}'`)).toMatch(/no vuelve a cobrar/)
    expect(await falla(`delete from public.tarjetas_pago_cda where id = '${ID(10)}'`)).toMatch(/no se borra/)
  })

  it('server-only: RLS sin policy y sin privilegios para anon ni authenticated; la guarda no la ejecuta nadie más', async () => {
    const r = await db.query<{ rls: boolean; anon: boolean; auth: boolean; fanon: boolean }>(
      `select (select relrowsecurity from pg_class where oid = 'public.tarjetas_pago_cda'::regclass) rls,
              has_table_privilege('anon', 'public.tarjetas_pago_cda', 'select') anon,
              has_table_privilege('authenticated', 'public.tarjetas_pago_cda', 'select') auth,
              has_function_privilege('anon', 'public.tarjetas_pago_cda_guardas()', 'execute') fanon`,
    )
    expect(r.rows[0]).toEqual({ rls: true, anon: false, auth: false, fanon: false })
  })
})
