import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de `valida_registros`, ejecutada de verdad en PGlite.
 *
 *   * es server-only (ni `anon` ni `authenticated` la leen): la marca de origen no la edita el cliente;
 *   * una prueba por NIT y por correo, y un intento NO quema el NIT;
 *   * un `creado` exige espacio, NIT, razón social y la aceptación con su huella;
 *   * la marca de origen es coherente con la señal que la decidió;
 *   * el método de pago nace `no_requerido` (la prueba es sin tarjeta hasta ePayco).
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261010090000_valida_registros.sql')
const WS1 = '00000000-0000-4000-8000-0000000000b1'
const WS2 = '00000000-0000-4000-8000-0000000000b2'
const WS3 = '00000000-0000-4000-8000-0000000000b3'
const HUELLA = 'a'.repeat(64)

const ESQUEMA_BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.workspaces (id uuid primary key);
  insert into public.workspaces values ('${WS1}'), ('${WS2}'), ('${WS3}');
`

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.query(sql)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

function creado(correo: string, nit: string, ws: string, slug: string, extra = '') {
  return `insert into public.valida_registros
    (correo, correo_dominio, identificacion, razon_social, workspace_id, slug_creado,
     condiciones_sha256, aceptado_at, estado ${extra ? ', origen, origen_fuente' : ''})
   values ('${correo}', split_part('${correo}', '@', 2), '${nit}', 'CDA ${slug} S.A.S.', '${ws}', '${slug}',
     '${HUELLA}', now(), 'creado' ${extra})`
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('valida_registros', () => {
  it('nace con RLS y sin una sola policy (deny-all)', async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.valida_registros'::regclass`,
    )
    expect(rls.rows[0].relrowsecurity).toBe(true)
    const pol = await db.query<{ n: number }>(`select count(*)::int n from pg_policies where tablename = 'valida_registros'`)
    expect(pol.rows[0].n).toBe(0)
  })

  it('ni anon ni authenticated la leen ni la escriben; service_role sí', async () => {
    const r = await db.query<{ rol: string; lee: boolean; escribe: boolean; cambia: boolean }>(
      `select rol,
              has_table_privilege(rol, 'public.valida_registros', 'select') lee,
              has_table_privilege(rol, 'public.valida_registros', 'insert') escribe,
              has_table_privilege(rol, 'public.valida_registros', 'update') cambia
         from (values ('anon'), ('authenticated'), ('service_role')) v(rol)`,
    )
    const por = Object.fromEntries(r.rows.map((f) => [f.rol, f]))
    for (const rol of ['anon', 'authenticated']) {
      expect(por[rol]).toMatchObject({ lee: false, escribe: false, cambia: false })
    }
    expect(por.service_role).toMatchObject({ lee: true, escribe: true, cambia: true })
  })

  it('una prueba por NIT', async () => {
    await db.exec(creado('gerencia@cdauno.co', '900111222', WS1, 'cda-uno'))
    const e = await falla(creado('otra@gmail.com', '900111222', WS2, 'cda-uno-bis'))
    expect(e).toMatch(/valida_registros_identificacion_creada|duplicate key/i)
  })

  it('una prueba por correo, sin distinguir mayúsculas', async () => {
    const e = await falla(creado('GERENCIA@CdaUno.co', '900333444', WS2, 'cda-dos'))
    expect(e).toMatch(/valida_registros_correo_creado|duplicate key/i)
  })

  it('un intento o un rechazo NO queman el NIT', async () => {
    await db.exec(
      `insert into public.valida_registros (correo, correo_dominio, identificacion, estado)
       values ('a@gmail.com', 'gmail.com', '900555666', 'intento'),
              ('b@gmail.com', 'gmail.com', '900555666', 'rechazado')`,
    )
    expect(await falla(creado('c@gmail.com', '900555666', WS2, 'cda-tres'))).toBeNull()
  })

  it('un creado sin aceptación, sin huella o sin razón social no entra', async () => {
    const sinAceptar = await falla(
      `insert into public.valida_registros (correo, correo_dominio, identificacion, razon_social, workspace_id, slug_creado, condiciones_sha256, estado)
       values ('d@x.co', 'x.co', '900777888', 'X S.A.S.', '${WS3}', 'x', '${HUELLA}', 'creado')`,
    )
    expect(sinAceptar).toMatch(/valida_registros_creado_tiene_espacio/)
    const sinRazon = await falla(
      `insert into public.valida_registros (correo, correo_dominio, identificacion, workspace_id, slug_creado, condiciones_sha256, aceptado_at, estado)
       values ('e@x.co', 'x.co', '900777888', '${WS3}', 'x', '${HUELLA}', now(), 'creado')`,
    )
    expect(sinRazon).toMatch(/valida_registros_creado_tiene_espacio/)
    const huellaMala = await falla(
      `insert into public.valida_registros (correo, correo_dominio, condiciones_sha256, estado)
       values ('f@x.co', 'x.co', 'no-es-hex', 'intento')`,
    )
    expect(huellaMala).toMatch(/condiciones_sha256_check/)
  })

  it('la marca de origen tiene que cuadrar con su señal', async () => {
    expect(await falla(creado('afi@x.co', '901000001', WS3, 'afi-ok', ", 'afi', 'ref'"))).toBeNull()
    const afiSinSenal = await falla(
      `insert into public.valida_registros (correo, correo_dominio, origen, estado) values ('g@x.co', 'x.co', 'afi', 'intento')`,
    )
    expect(afiSinSenal).toMatch(/valida_registros_origen_coherente/)
    const directoConSenal = await falla(
      `insert into public.valida_registros (correo, correo_dominio, origen, origen_fuente, estado)
       values ('h@x.co', 'x.co', 'directo', 'codigo_afi', 'intento')`,
    )
    expect(directoConSenal).toMatch(/valida_registros_origen_coherente/)
    const pautaSinUtm = await falla(
      `insert into public.valida_registros (correo, correo_dominio, origen, origen_fuente, estado)
       values ('i@x.co', 'x.co', 'pauta', 'ref', 'intento')`,
    )
    expect(pautaSinUtm).toMatch(/valida_registros_origen_coherente/)
  })

  it('por defecto: origen directo y método de pago no requerido', async () => {
    const r = await db.query<{ origen: string; origen_fuente: string; metodo_pago_estado: string }>(
      `select origen, origen_fuente, metodo_pago_estado from public.valida_registros where correo = 'gerencia@cdauno.co'`,
    )
    expect(r.rows[0]).toEqual({ origen: 'directo', origen_fuente: 'ninguna', metodo_pago_estado: 'no_requerido' })
  })

  it('solo los tres estados del flujo y los tres tipos de entidad', async () => {
    expect(
      await falla(`insert into public.valida_registros (correo, correo_dominio, estado) values ('j@x.co', 'x.co', 'pendiente')`),
    ).toMatch(/valida_registros_estado_check/)
    expect(
      await falla(
        `insert into public.valida_registros (correo, correo_dominio, tipo_entidad, estado) values ('k@x.co', 'x.co', 'banco', 'intento')`,
      ),
    ).toMatch(/valida_registros_tipo_entidad_check/)
  })

  // La receta de limpieza que quedó en el encabezado de la migración: probada, no supuesta.
  it('borrar el espacio de un creado falla hasta pasarlo a rechazado, y eso libera el NIT', async () => {
    const e = await falla(`delete from public.workspaces where id = '${WS1}'`)
    expect(e).toMatch(/valida_registros_creado_tiene_espacio/)
    await db.exec(`update public.valida_registros set estado = 'rechazado', motivo = 'espacio_limpiado' where workspace_id = '${WS1}'`)
    expect(await falla(`delete from public.workspaces where id = '${WS1}'`)).toBeNull()
    await db.exec(`insert into public.workspaces values ('${WS1}')`)
    expect(await falla(creado('nuevo@cdauno.co', '900111222', WS1, 'cda-uno-otra-vez'))).toBeNull()
  })
})
