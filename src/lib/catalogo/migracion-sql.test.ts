import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de A2, ejecutada de verdad.
 *
 * Lo que esta migración promete no es documentación: es que la base **rechace** cosas que de
 * otro modo se escribirían en silencio — una versión del catálogo reescrita bajo la misma
 * etiqueta, una comisión a medias, una bitácora editada. Probar una copia del SQL o un doble
 * no probaría lo que se aplica, así que aquí se levanta Postgres en memoria (PGlite) y se
 * aplican LOS ARCHIVOS del repo tal cual.
 *
 * Se aplica primero A1 (`20260915210000_workspace_modulos`), que ya está en producción, porque
 * el último bloque de A2 le agrega la llave foránea que A1 no pudo poner.
 *
 * Qué se replica de producción, y por qué: los privilegios por defecto del esquema (toda
 * función nace ejecutable por `anon` y `authenticated`). Sin eso, la prueba de permisos pasaría
 * aunque faltaran los `revoke`, que es exactamente el gotcha #185 de este repo.
 *
 * Límites: PGlite no trae `pgcrypto`, así que `gen_random_uuid()` se resuelve con el nativo de
 * PG 13+; y las tablas de las que dependen las llaves foráneas (`workspaces`, `empresas`,
 * `negocios`, `profiles`) se crean aquí con lo mínimo, no con su esquema real.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const A1 = '20260915210000_workspace_modulos.sql'
const A2 = '20260916120000_catalogo_y_servicios_contratados.sql'

const WS = '00000000-0000-4000-8000-0000000000a1'
const WS_CLIENTE = '00000000-0000-4000-8000-0000000000a2'
const EMPRESA = '00000000-0000-4000-8000-0000000000b1'
const NEGOCIO = '00000000-0000-4000-8000-0000000000c1'
const PERFIL = '00000000-0000-4000-8000-0000000000d1'
const CANAL = '00000000-0000-4000-8000-0000000000e1'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  -- Como en produccion: el EXECUTE de authenticated y anon llega por el default del esquema.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key, slug text, modules jsonb default '{}'::jsonb);
  create table public.profiles  (id uuid primary key);
  create table public.empresas  (id uuid primary key, nombre text);
  create table public.negocios  (id uuid primary key, codigo text);

  insert into public.workspaces (id, slug, modules) values
    ('${WS}', 'metrik', '{"business": true}'::jsonb),
    ('${WS_CLIENTE}', 'termotech', '{"business": true}'::jsonb);
  insert into public.profiles (id) values ('${PERFIL}');
  insert into public.empresas (id, nombre) values ('${EMPRESA}', 'Termotech'), ('${CANAL}', 'AFI');
  insert into public.negocios (id, codigo) values ('${NEGOCIO}', 'A3 26 2');
`

let db: PGlite

/** Corre y devuelve el mensaje de error, o null si pasó. */
async function falla(sql: string): Promise<string | null> {
  try {
    await db.exec(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

/** La única vía que funciona: una llamada, dentro de su transacción. */
const registrar = (slug: string, version: number, sha: string, def = '{}') =>
  db.query<{ r: { resultado: string; version_vigente: number } }>(
    `select public.registrar_version_catalogo($1, $2, $3::jsonb, $4, $5) as r`,
    [slug, version, def, `cerebro/catalogo/servicios/${slug}.md`, sha],
  )

const DEF_CLARITY = JSON.stringify({
  nombre: 'Licencia Clarity',
  modulo: 'business',
  disparador_cobro: 'ciclo',
})

const contrato = (extra: string) => `
  insert into public.servicios_contratados
    (workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, vigente_desde ${extra ? ', comision' : ''})
  values ('${WS}', '${EMPRESA}', '${NEGOCIO}', 'licencia-clarity', 1, '2026-09-01'
          ${extra ? `, '${extra}'::jsonb` : ''});
`

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer(A1))
  await db.exec(leer(A2))
  await registrar('licencia-clarity', 1, 'a'.repeat(64), DEF_CLARITY)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('la migración aplica y crea lo que dice', () => {
  it('las cinco tablas existen con RLS encendido', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace
         and relname in ('catalogo_servicios','catalogo_servicios_versiones','servicios_contratados',
                         'servicio_contratado_beneficiarios','servicios_contratados_cambios')
       order by relname`)
    expect(r.rows.map((x) => x.relname)).toEqual([
      'catalogo_servicios',
      'catalogo_servicios_versiones',
      'servicio_contratado_beneficiarios',
      'servicios_contratados',
      'servicios_contratados_cambios',
    ])
    expect(r.rows.every((x) => x.relrowsecurity)).toBe(true)
  })

  it('ninguna es legible por anon ni por authenticated', async () => {
    const r = await db.query<{ relname: string; a: boolean; b: boolean }>(`
      select relname,
             has_table_privilege('anon', c.oid, 'select') as a,
             has_table_privilege('authenticated', c.oid, 'select') as b
        from pg_class c
       where relnamespace = 'public'::regnamespace
         and relname in ('catalogo_servicios','catalogo_servicios_versiones','servicios_contratados',
                         'servicio_contratado_beneficiarios','servicios_contratados_cambios')`)
    expect(r.rows.filter((x) => x.a || x.b)).toEqual([])
  })

  it('las funciones nuevas no las ejecuta anon ni authenticated (el default sí las concede)', async () => {
    const r = await db.query<{ proname: string; a: boolean; b: boolean; s: boolean }>(`
      select proname,
             has_function_privilege('anon', p.oid, 'execute') as a,
             has_function_privilege('authenticated', p.oid, 'execute') as b,
             has_function_privilege('service_role', p.oid, 'execute') as s
        from pg_proc p
       where pronamespace = 'public'::regnamespace
         and proname in ('comision_coherente','catalogo_versiones_inmutable',
                         'servicios_cambios_inmutable','servicios_contratados_touch')`)
    expect(r.rows.length).toBe(4)
    expect(r.rows.filter((x) => x.a || x.b)).toEqual([])
    expect(r.rows.every((x) => x.s)).toBe(true)
  })

  it('cierra la llave foránea que A1 dejó abierta en workspace_modulos', async () => {
    const r = await db.query<{ conname: string }>(`
      select conname from pg_constraint
       where conrelid = 'public.workspace_modulos'::regclass
         and conname = 'workspace_modulos_servicio_fk'`)
    expect(r.rows.length).toBe(1)
  })

  it('un servicio_contratado_id inventado en workspace_modulos ya no entra', async () => {
    const e = await falla(`
      insert into public.workspace_modulos
        (workspace_id, modulo, origen, servicio_contratado_id, activo_desde, motivo, registrado_por)
      values ('${WS}', 'business', 'servicio', '00000000-0000-4000-8000-00000000ffff',
              now(), 'inventado', '${PERFIL}')`)
    expect(e).toMatch(/workspace_modulos_servicio_fk|foreign key/i)
  })
})

describe('una versión del catálogo es inmutable', () => {
  it('la RPC la creó, y creó su servicio en la misma transacción', async () => {
    const r = await db.query<{ n: number; nombre: string; vigente: number }>(`
      select (select count(*)::int from public.catalogo_servicios_versiones) as n,
             (select nombre from public.catalogo_servicios where slug = 'licencia-clarity') as nombre,
             (select version_vigente from public.catalogo_servicios where slug = 'licencia-clarity') as vigente`)
    expect(r.rows[0]).toEqual({ n: 1, nombre: 'Licencia Clarity', vigente: 1 })
  })

  it('fuera de una transacción NO hay orden de inserts que funcione (por eso existe la RPC)', async () => {
    // Las dos tablas se apuntan; en autocommit cada sentencia se valida sola.
    const primeroVersion = await falla(`
      insert into public.catalogo_servicios_versiones (slug, version, definicion, fuente_ruta, fuente_sha256)
      values ('licencia-sustenta', 1, '{}'::jsonb, 'cerebro/catalogo/servicios/licencia-sustenta.md', '${'d'.repeat(64)}')`)
    const primeroServicio = await falla(`
      insert into public.catalogo_servicios (slug, nombre, modulo, disparador_cobro, version_vigente)
      values ('licencia-sustenta', 'Licencia Sustenta', 'compliance', 'ciclo', 1)`)
    expect(primeroVersion).toMatch(/foreign key/i)
    expect(primeroServicio).toMatch(/foreign key/i)
  })

  it('un UPDATE se rechaza: cambiar un precio de lista exige subir la versión', async () => {
    const e = await falla(`
      update public.catalogo_servicios_versiones set definicion = '{"precio": 1}'::jsonb
       where slug = 'licencia-clarity' and version = 1`)
    expect(e).toMatch(/no se reescribe/)
  })

  it('un DELETE también', async () => {
    const e = await falla(`delete from public.catalogo_servicios_versiones where slug = 'licencia-clarity'`)
    expect(e).toMatch(/no se borra/)
  })

  it('la misma (slug, version) dos veces choca con la llave primaria', async () => {
    const e = await falla(`
      insert into public.catalogo_servicios_versiones (slug, version, definicion, fuente_ruta, fuente_sha256)
      values ('licencia-clarity', 1, '{}'::jsonb, 'cerebro/catalogo/servicios/licencia-clarity.md', '${'b'.repeat(64)}')`)
    expect(e).toMatch(/duplicate key|llave duplicada/i)
  })

  it('una huella que no es sha256 se rechaza', async () => {
    const e = await falla(`
      insert into public.catalogo_servicios_versiones (slug, version, definicion, fuente_ruta, fuente_sha256)
      values ('licencia-clarity', 2, '{}'::jsonb, 'cerebro/catalogo/servicios/licencia-clarity.md', 'corta')`)
    expect(e).toMatch(/catalogo_versiones_sha/)
  })

  it('una ruta fuera de cerebro/catalogo/servicios se rechaza', async () => {
    const e = await falla(`
      insert into public.catalogo_servicios_versiones (slug, version, definicion, fuente_ruta, fuente_sha256)
      values ('licencia-clarity', 2, '{}'::jsonb, 'otro/lugar.md', '${'c'.repeat(64)}')`)
    expect(e).toMatch(/catalogo_versiones_ruta/)
  })

  it('un servicio no puede apuntar a una versión que no llegó', async () => {
    const e = await falla(`
      insert into public.catalogo_servicios (slug, nombre, modulo, disparador_cobro, version_vigente)
      values ('licencia-sustenta', 'Licencia Sustenta', 'compliance', 'ciclo', 7)`)
    expect(e).toMatch(/version_vigente_fk|foreign key/i)
  })

  it('un módulo que ningún producto enciende se rechaza', async () => {
    const e = await falla(`
      insert into public.catalogo_servicios (slug, nombre, modulo, disparador_cobro, version_vigente)
      values ('x', 'X', 'facturacion_electronica', 'ciclo', 1)`)
    expect(e).toMatch(/catalogo_servicios_modulo/)
  })
})

describe('la comisión, si se declara, se declara entera', () => {
  const canal = `"beneficiario_empresa_id":"${CANAL}","beneficiario_nit":"901234567"`

  it('sin comisión pactada: pasa', async () => {
    expect(await falla(contrato(''))).toBeNull()
  })

  it('AFI, monto fijo de $50.000 por licencia de CDA: pasa', async () => {
    expect(await falla(contrato(`{${canal},"modo":"monto_fijo","monto_fijo":50000,"base":"cada_cobro"}`))).toBeNull()
  })

  it('promotora de 4D SOFT, 20 % sobre el paquete: pasa', async () => {
    expect(await falla(contrato(`{${canal},"modo":"porcentaje","pct":20,"base":"cada_cobro"}`))).toBeNull()
  })

  it('con fee único declarado: pasa', async () => {
    expect(
      await falla(contrato(`{${canal},"modo":"porcentaje","pct":20,"base":"primer_cobro","fee_unico":200000}`)),
    ).toBeNull()
  })

  const malas: [string, string][] = [
    ['porcentaje sin pct', `{${canal},"modo":"porcentaje","base":"cada_cobro"}`],
    ['monto fijo sin monto', `{${canal},"modo":"monto_fijo","base":"cada_cobro"}`],
    ['porcentaje en 0', `{${canal},"modo":"porcentaje","pct":0,"base":"cada_cobro"}`],
    ['porcentaje mayor que 100', `{${canal},"modo":"porcentaje","pct":120,"base":"cada_cobro"}`],
    ['monto fijo negativo', `{${canal},"modo":"monto_fijo","monto_fijo":-1,"base":"cada_cobro"}`],
    ['los dos campos a la vez', `{${canal},"modo":"monto_fijo","monto_fijo":50000,"pct":20,"base":"cada_cobro"}`],
    ['sin modo', `{${canal},"pct":20,"base":"cada_cobro"}`],
    ['modo inventado', `{${canal},"modo":"mitad","pct":20,"base":"cada_cobro"}`],
    ['base inventada', `{${canal},"modo":"porcentaje","pct":20,"base":"cuando_quiera"}`],
    ['sin NIT del canal', `{"beneficiario_empresa_id":"${CANAL}","modo":"porcentaje","pct":20,"base":"cada_cobro"}`],
    ['sin empresa del canal', `{"beneficiario_nit":"901234567","modo":"porcentaje","pct":20,"base":"cada_cobro"}`],
    ['fee único en cero', `{${canal},"modo":"porcentaje","pct":20,"base":"cada_cobro","fee_unico":0}`],
    ['pct como texto', `{${canal},"modo":"porcentaje","pct":"20","base":"cada_cobro"}`],
    ['no es un objeto', `"veinte por ciento"`],
  ]

  for (const [nombre, json] of malas) {
    it(`${nombre}: la base la rechaza`, async () => {
      // Sin este CHECK, el motor escribiría un gasto por un número inventado o por cero.
      expect(await falla(contrato(json)), nombre).toMatch(/comision_coherente/)
    })
  }
})

describe('la excepción de D5 se escribe contrato por contrato', () => {
  it('un contrato nace SIN permiso de autorizar sin poder escrito', async () => {
    const r = await db.query<{ v: boolean }>(
      `select bool_and(autorizacion_sin_poder_permitida = false) as v from public.servicios_contratados`,
    )
    expect(r.rows[0].v).toBe(true)
  })
})

describe('la bitácora del contrato no se reescribe', () => {
  let contratoId: string

  beforeAll(async () => {
    const r = await db.query<{ id: string }>(`select id from public.servicios_contratados limit 1`)
    contratoId = r.rows[0].id
    await db.exec(`
      insert into public.servicios_contratados_cambios
        (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
      values ('${contratoId}', 'parametros.licencias', '3'::jsonb, '5'::jsonb,
              'Termotech sumó dos personas', '${PERFIL}')`)
  })

  it('un UPDATE se rechaza', async () => {
    const e = await falla(
      `update public.servicios_contratados_cambios set motivo = 'otro' where servicio_contratado_id = '${contratoId}'`,
    )
    expect(e).toMatch(/no se reescribe/)
  })

  it('un DELETE también', async () => {
    const e = await falla(
      `delete from public.servicios_contratados_cambios where servicio_contratado_id = '${contratoId}'`,
    )
    expect(e).toMatch(/no se reescribe/)
  })

  it('un cambio sin motivo se rechaza: qué cambió sin por qué no sirve después', async () => {
    const e = await falla(`
      insert into public.servicios_contratados_cambios
        (servicio_contratado_id, campo, motivo, registrado_por)
      values ('${contratoId}', 'precio', '   ', '${PERFIL}')`)
    expect(e).toMatch(/servicios_cambios_motivo_no_vacio/)
  })
})

describe('el contrato apunta a una versión exacta', () => {
  it('una versión que no existe se rechaza', async () => {
    const e = await falla(`
      insert into public.servicios_contratados
        (workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, vigente_desde)
      values ('${WS}', '${EMPRESA}', '${NEGOCIO}', 'licencia-clarity', 99, '2026-09-01')`)
    expect(e).toMatch(/servicios_contratados_version_fk|foreign key/i)
  })

  it('una vigencia al revés se rechaza', async () => {
    const e = await falla(`
      insert into public.servicios_contratados
        (workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, vigente_desde, vigente_hasta)
      values ('${WS}', '${EMPRESA}', '${NEGOCIO}', 'licencia-clarity', 1, '2026-09-01', '2026-08-01')`)
    expect(e).toMatch(/servicios_contratados_vigencia/)
  })

  it('un estado inventado se rechaza', async () => {
    const e = await falla(`
      insert into public.servicios_contratados
        (workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, vigente_desde, estado)
      values ('${WS}', '${EMPRESA}', '${NEGOCIO}', 'licencia-clarity', 1, '2026-09-01', 'en_veremos')`)
    expect(e).toMatch(/servicios_contratados_estado/)
  })

  it('un contrato cubre varios workspaces (A1 26 4 cubre 4 CDA)', async () => {
    const r = await db.query<{ id: string }>(`select id from public.servicios_contratados limit 1`)
    expect(
      await falla(`
        insert into public.servicio_contratado_beneficiarios (servicio_contratado_id, workspace_id)
        values ('${r.rows[0].id}', '${WS}'), ('${r.rows[0].id}', '${WS_CLIENTE}')`),
    ).toBeNull()
  })
})

describe('registrar_version_catalogo: atómica e idempotente', () => {
  const DEF_CDA = JSON.stringify({
    nombre: 'Licencia Valida por CDA',
    modulo: 'valida_consulta',
    disparador_cobro: 'ciclo',
  })

  it('una versión nueva se crea y devuelve `creada`', async () => {
    const r = await registrar('valida-cda-licencia', 1, 'f'.repeat(64), DEF_CDA)
    expect(r.rows[0].r).toMatchObject({ resultado: 'creada', version_vigente: 1 })
  })

  it('el mismo envío otra vez devuelve `ya_estaba` y no duplica', async () => {
    // La Action corre en cada push a main: reenviar lo mismo tiene que ser inocuo.
    const r = await registrar('valida-cda-licencia', 1, 'f'.repeat(64), DEF_CDA)
    expect(r.rows[0].r.resultado).toBe('ya_estaba')
    const n = await db.query<{ n: number }>(
      `select count(*)::int as n from public.catalogo_servicios_versiones where slug = 'valida-cda-licencia'`,
    )
    expect(n.rows[0].n).toBe(1)
  })

  it('la misma versión con OTRA huella devuelve conflicto y NO pisa lo publicado', async () => {
    // La regla que protege a los contratos vivos: cambiar el precio obliga a subir la versión.
    const otro = JSON.stringify({
      nombre: 'Licencia Valida por CDA (precio nuevo)',
      modulo: 'valida_consulta',
      disparador_cobro: 'ciclo',
    })
    const r = await registrar('valida-cda-licencia', 1, '9'.repeat(64), otro)
    expect(r.rows[0].r).toMatchObject({ resultado: 'conflicto_huella' })
    const q = await db.query<{ sha: string; nombre: string }>(`
      select v.fuente_sha256 as sha, s.nombre
        from public.catalogo_servicios_versiones v
        join public.catalogo_servicios s using (slug)
       where v.slug = 'valida-cda-licencia' and v.version = 1`)
    expect(q.rows[0].sha).toBe('f'.repeat(64))
    expect(q.rows[0].nombre).toBe('Licencia Valida por CDA')
  })

  it('una versión mayor sube el puntero vigente', async () => {
    const r = await registrar('valida-cda-licencia', 2, '1'.repeat(64), DEF_CDA)
    expect(r.rows[0].r).toMatchObject({ resultado: 'creada', version_vigente: 2 })
  })

  it('una versión MENOR se guarda pero el puntero vigente NO retrocede', async () => {
    // Un push viejo o una rama mezclada al revés no puede hacer que un contrato nuevo nazca
    // con condiciones más viejas que las publicadas.
    const r = await registrar('valida-cda-licencia', 1, 'f'.repeat(64), DEF_CDA)
    expect(r.rows[0].r.version_vigente).toBe(2)
  })

  it('un módulo inválido en la definición rebota, sin dejar la versión suelta', async () => {
    let e: string | null = null
    try {
      await registrar('x-invalido', 1, '2'.repeat(64), JSON.stringify({
        nombre: 'X',
        modulo: 'inventado',
        disparador_cobro: 'ciclo',
      }))
    } catch (err) {
      e = (err as Error).message
    }
    expect(e).toMatch(/catalogo_servicios_modulo/)
    const n = await db.query<{ n: number }>(
      `select count(*)::int as n from public.catalogo_servicios_versiones where slug = 'x-invalido'`,
    )
    expect(n.rows[0].n).toBe(0)
  })
})
