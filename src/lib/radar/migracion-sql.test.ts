/**
 * La migración del módulo Radar SECOP, corrida de verdad en Postgres en memoria (PGlite), encima de
 * A1 (`workspace_modulos`), A2 (catálogo) y la de Ferretería, que son las que ya están en
 * producción y cuyas listas de llaves esta migración amplía.
 *
 * Lo que se prueba es lo que la base tiene que RECHAZAR o GARANTIZAR sola, que es lo que la lectura
 * del SQL no muestra:
 *   · que el navegador no pueda escribir el barrido (lo escribe el cron);
 *   · que el CHECK de `pesos` rechace de verdad, incluido el caso del NULL que deja pasar;
 *   · que no pueda haber dos perfiles activos en el mismo workspace;
 *   · que el upsert por `notice_uid` sea idempotente;
 *   · que la migración NO encienda el módulo en ningún workspace ni escriba una sola fila.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const A1 = '20260915210000_workspace_modulos.sql'
const A2 = '20260916120000_catalogo_y_servicios_contratados.sql'
const FERRETERIA = '20260924235500_modulo_ferreteria.sql'
const RADAR = '20260928180000_modulo_radar_secop.sql'

const DIMPRO = '67f7af44-b5ac-4d5c-aa9e-44954368447c'
const OTRO = '00000000-0000-4000-8000-0000000000a2'
const MAURICIO = 'cc6f6100-4eb7-4eed-9a7c-096729f5cedf'
// Dos espacios con `modules` vacío, para que la proyección hable SOLO de la llave nueva: en un
// espacio con `business: true` en el jsonb y sin fila en workspace_modulos, `cambios` trae también
// `business`, que es correcto y no es lo que esta prueba mide.
const RADAR_WS_1 = '00000000-0000-4000-8000-0000000000b1'
const RADAR_WS_2 = '00000000-0000-4000-8000-0000000000b2'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key, slug text, modules jsonb default '{}'::jsonb);
  create table public.profiles  (id uuid primary key, workspace_id uuid);
  create table public.empresas  (id uuid primary key, nombre text);
  create table public.negocios  (id uuid primary key, codigo text);

  create function public.current_user_workspace_id() returns uuid language sql stable as
    $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;

  insert into public.workspaces (id, slug, modules) values
    ('${DIMPRO}', 'dimpro', '{"business": true}'::jsonb),
    ('${OTRO}', 'otro', '{"business": true}'::jsonb),
    ('${RADAR_WS_1}', 'radar-1', '{}'::jsonb),
    ('${RADAR_WS_2}', 'radar-2', '{}'::jsonb);
  insert into public.profiles (id, workspace_id) values ('${MAURICIO}', '${DIMPRO}');
`

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.exec(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer(A1))
  await db.exec(leer(A2))
  await db.exec(leer(FERRETERIA))
  await db.exec(leer(RADAR))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('la migración no escribe datos ni enciende nada', () => {
  it('las cuatro tablas nacen vacías', async () => {
    for (const t of ['radar_procesos', 'radar_perfiles', 'radar_temas', 'radar_seguimiento']) {
      const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${t}`)
      expect(r.rows[0].n, t).toBe(0)
    }
  })

  it('ningún workspace queda con el módulo: el de Fabri todavía no existe', async () => {
    const jsonb = await db.query<{ n: number }>(
      `select count(*)::int as n from public.workspaces where coalesce(modules->'radar_secop' = 'true'::jsonb, false)`,
    )
    expect(jsonb.rows[0].n).toBe(0)
    const fila = await db.query<{ n: number }>(
      `select count(*)::int as n from public.workspace_modulos where modulo = 'radar_secop'`,
    )
    expect(fila.rows[0].n).toBe(0)
  })

  it('no toca las llaves que ya tenían los workspaces', async () => {
    const r = await db.query<{ modules: Record<string, boolean> }>(
      `select modules from public.workspaces where id = '${OTRO}'`,
    )
    expect(r.rows[0].modules).toEqual({ business: true })
  })
})

describe('la llave radar_secop entra a las tres listas', () => {
  it('workspace_modulos la acepta y sigue rechazando una inventada', async () => {
    await db.exec(
      `insert into public.workspace_modulos (workspace_id, modulo, origen, activo_desde, motivo, registrado_por)
       values ('${RADAR_WS_1}', 'radar_secop', 'interno', now(), 'prueba', '${MAURICIO}')`,
    )
    const err = await falla(
      `insert into public.workspace_modulos (workspace_id, modulo, origen, activo_desde, motivo, registrado_por)
       values ('${RADAR_WS_1}', 'radar_inventado', 'interno', now(), 'prueba', '${MAURICIO}')`,
    )
    expect(err).toContain('workspace_modulos_modulo')
    // Sin limpiar: `workspace_modulos` es historia y un trigger de A1 prohíbe borrarla («ciérrala
    // con activo_hasta»). Por eso cada prueba usa su propio espacio.
  })

  it('proyectar_modulos ya la conoce: la fila vigente aparece como cambio', async () => {
    await db.exec(
      `insert into public.workspace_modulos (workspace_id, modulo, origen, activo_desde, motivo, registrado_por)
       values ('${RADAR_WS_2}', 'radar_secop', 'interno', now(), 'prueba', '${MAURICIO}')`,
    )
    const r = await db.query<{ c: { modulo: string; hoy: boolean; proyectado: boolean }[] }>(
      `select public.proyectar_modulos('${RADAR_WS_2}')->'cambios' as c`,
    )
    // Antes de esta migración `radar_secop` no estaba en `v_claves_modulo` y la proyección la
    // habría ignorado en silencio: la llave nueva no se habría encendido nunca.
    expect(r.rows[0].c).toEqual([{ modulo: 'radar_secop', hoy: false, proyectado: true }])
  })

  it('catalogo_servicios acepta un servicio del módulo radar_secop', async () => {
    const err = await falla(`
      begin;
      insert into public.catalogo_servicios (slug, nombre, modulo, disparador_cobro, version_vigente)
        values ('radar-secop-licencia', 'Licencia Radar SECOP', 'radar_secop', 'ciclo', 1);
      insert into public.catalogo_servicios_versiones (slug, version, definicion, fuente_ruta, fuente_sha256)
        values ('radar-secop-licencia', 1, '{"tratamiento_iva": "excluido"}'::jsonb,
                'cerebro/catalogo/servicios/radar-secop-licencia.md', repeat('a', 64));
      commit;
    `)
    expect(err).toBeNull()
    const r = await db.query<{ modulo: string; disparador_cobro: string }>(
      `select modulo, disparador_cobro from public.catalogo_servicios where slug = 'radar-secop-licencia'`,
    )
    expect(r.rows[0]).toEqual({ modulo: 'radar_secop', disparador_cobro: 'ciclo' })
  })
})

describe('privilegios: el barrido lo escribe el cron, no el navegador', () => {
  it('anon no lee nada y authenticated lee las cuatro', async () => {
    const r = await db.query<{ t: string; anon: boolean; auth: boolean }>(`
      select c.relname as t,
             has_table_privilege('anon', c.oid, 'select') as anon,
             has_table_privilege('authenticated', c.oid, 'select') as auth
        from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relname like 'radar\\_%' and c.relkind = 'r'
       order by 1
    `)
    expect(r.rows).toHaveLength(4)
    expect(r.rows.filter((x) => x.anon)).toEqual([])
    expect(r.rows.filter((x) => !x.auth)).toEqual([])
  })

  it('authenticated NO puede escribir radar_procesos y SÍ las otras tres', async () => {
    const r = await db.query<{ t: string; ins: boolean; upd: boolean; del: boolean }>(`
      select c.relname as t,
             has_table_privilege('authenticated', c.oid, 'insert') as ins,
             has_table_privilege('authenticated', c.oid, 'update') as upd,
             has_table_privilege('authenticated', c.oid, 'delete') as del
        from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relname like 'radar\\_%' and c.relkind = 'r'
       order by 1
    `)
    const porTabla = Object.fromEntries(r.rows.map((x) => [x.t, x]))
    expect(porTabla.radar_procesos).toEqual({ t: 'radar_procesos', ins: false, upd: false, del: false })
    for (const t of ['radar_perfiles', 'radar_temas', 'radar_seguimiento']) {
      expect(porTabla[t], t).toEqual({ t, ins: true, upd: true, del: true })
    }
  })

  it('las cuatro tienen RLS encendido', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relname like 'radar\\_%' and relkind = 'r' order by 1`,
    )
    expect(r.rows.filter((x) => !x.relrowsecurity)).toEqual([])
  })
})

describe('radar_procesos', () => {
  const inserta = (uid: string, extra = '') =>
    `insert into public.radar_procesos (notice_uid, referencia, objeto ${extra ? `, ${extra.split('=')[0]}` : ''})
     values ('${uid}', 'REF-1', 'OBJETO' ${extra ? `, ${extra.split('=')[1]}` : ''})`

  it('el upsert por notice_uid es idempotente: dos barridos no duplican', async () => {
    await db.exec(inserta('CO1.NTC.1'))
    await db.exec(`
      insert into public.radar_procesos (notice_uid, referencia, objeto, visto_at)
      values ('CO1.NTC.1', 'REF-1 (Presentación de oferta)', 'OBJETO NUEVO', now())
      on conflict (notice_uid) do update
        set referencia = excluded.referencia, objeto = excluded.objeto, visto_at = excluded.visto_at
    `)
    const r = await db.query<{ n: number; referencia: string }>(
      `select count(*)::int as n, max(referencia) as referencia from public.radar_procesos where notice_uid = 'CO1.NTC.1'`,
    )
    expect(r.rows[0].n).toBe(1)
    expect(r.rows[0].referencia).toBe('REF-1 (Presentación de oferta)')
  })

  it('un notice_uid vacío o con espacios alrededor se rechaza', async () => {
    expect(await falla(inserta(''))).toContain('radar_procesos_uid_no_vacio')
    expect(await falla(inserta(' CO1.NTC.2 '))).toContain('radar_procesos_uid_no_vacio')
  })

  it('el objeto no pasa de 600 y el valor no es negativo', async () => {
    const largo = await falla(
      `insert into public.radar_procesos (notice_uid, objeto) values ('CO1.NTC.3', repeat('A', 601))`,
    )
    expect(largo).toContain('radar_procesos_objeto_largo')
    const negativo = await falla(
      `insert into public.radar_procesos (notice_uid, valor) values ('CO1.NTC.4', -1)`,
    )
    expect(negativo).toContain('radar_procesos_valor_no_negativo')
  })

  it('un proceso sin presupuesto ni fecha de cierre entra: es un sondeo, no un error', async () => {
    expect(
      await falla(`insert into public.radar_procesos (notice_uid, valor, fecha_cierre) values ('CO1.NTC.5', 0, null)`),
    ).toBeNull()
  })
})

describe('radar_perfiles', () => {
  async function perfil(ws: string, nombre: string, activo = false, pesos = '{}'): Promise<string> {
    const r = await db.query<{ id: string }>(
      `insert into public.radar_perfiles (workspace_id, nombre, preset, activo, pesos)
       values ('${ws}', '${nombre}', 'fabri', ${activo}, '${pesos}'::jsonb) returning id`,
    )
    return r.rows[0].id
  }

  it('el CHECK de pesos rechaza un valor no numérico (el caso del NULL que deja pasar)', async () => {
    // Sin el `coalesce(..., false)` de la migración, `jsonb_typeof(e.value) <> 'number'` sobre un
    // valor ausente daría NULL, el `not exists` daría NULL y el CHECK ACEPTARÍA esta fila.
    const err = await falla(
      `insert into public.radar_perfiles (workspace_id, nombre, pesos)
       values ('${DIMPRO}', 'malo', '{"acrilico": "diez"}'::jsonb)`,
    )
    expect(err).toContain('radar_perfiles_pesos')

    const nulo = await falla(
      `insert into public.radar_perfiles (workspace_id, nombre, pesos)
       values ('${DIMPRO}', 'malo2', '{"acrilico": null}'::jsonb)`,
    )
    expect(nulo).toContain('radar_perfiles_pesos')
  })

  it('un pesos que no es objeto se rechaza, y el vacío pasa', async () => {
    expect(
      await falla(`insert into public.radar_perfiles (workspace_id, nombre, pesos)
                   values ('${DIMPRO}', 'arreglo', '[1,2]'::jsonb)`),
    ).toContain('radar_perfiles_pesos')
    await expect(perfil(DIMPRO, 'vacio-ok', false, '{}')).resolves.toBeTruthy()
    await expect(perfil(DIMPRO, 'pesos-ok', false, '{"acrilico": 10, "audiovisual": -8}')).resolves.toBeTruthy()
  })

  it('solo UN perfil activo por workspace, y otro workspace no estorba', async () => {
    await perfil(DIMPRO, 'el-activo', true)
    const err = await falla(
      `insert into public.radar_perfiles (workspace_id, nombre, activo) values ('${DIMPRO}', 'otro-activo', true)`,
    )
    expect(err).toMatch(/uq_radar_perfiles_activo|duplicate key/)
    // El mismo nombre en OTRO workspace sí entra: la unicidad es por espacio.
    expect(await falla(`insert into public.radar_perfiles (workspace_id, nombre, activo) values ('${OTRO}', 'el-activo', true)`)).toBeNull()
  })

  it('el nombre no se repite dentro del workspace ni queda en blanco', async () => {
    expect(await falla(`insert into public.radar_perfiles (workspace_id, nombre) values ('${DIMPRO}', 'el-activo')`))
      .toContain('radar_perfiles_nombre_unico')
    expect(await falla(`insert into public.radar_perfiles (workspace_id, nombre) values ('${DIMPRO}', '   ')`))
      .toContain('radar_perfiles_nombre_no_vacio')
  })
})

describe('radar_temas y radar_seguimiento', () => {
  let perfilId = ''

  beforeAll(async () => {
    const r = await db.query<{ id: string }>(
      `insert into public.radar_perfiles (workspace_id, nombre) values ('${OTRO}', 'para-temas') returning id`,
    )
    perfilId = r.rows[0].id
  })

  it('un tema propio exige id en kebab, al menos un término y peso en rango', async () => {
    const ok = `insert into public.radar_temas (workspace_id, perfil_id, tema_id, nombre, peso, terminos)
                values ('${OTRO}', '${perfilId}', 'mi-nicho', 'Mi nicho', 6, array['DRONE'])`
    expect(await falla(ok)).toBeNull()

    expect(
      await falla(`insert into public.radar_temas (workspace_id, perfil_id, tema_id, nombre, peso, terminos)
                   values ('${OTRO}', '${perfilId}', 'Mi Nicho', 'x', 1, array['A'])`),
    ).toContain('radar_temas_id_kebab')

    expect(
      await falla(`insert into public.radar_temas (workspace_id, perfil_id, tema_id, nombre, peso, terminos)
                   values ('${OTRO}', '${perfilId}', 'sin-terminos', 'x', 1, '{}')`),
    ).toContain('radar_temas_terminos_no_vacio')

    expect(
      await falla(`insert into public.radar_temas (workspace_id, perfil_id, tema_id, nombre, peso, terminos)
                   values ('${OTRO}', '${perfilId}', 'peso-loco', 'x', 99, array['A'])`),
    ).toContain('radar_temas_peso_rango')
  })

  it('el mismo tema_id no se repite dentro del perfil', async () => {
    expect(
      await falla(`insert into public.radar_temas (workspace_id, perfil_id, tema_id, nombre, peso, terminos)
                   values ('${OTRO}', '${perfilId}', 'mi-nicho', 'Otro', 3, array['B'])`),
    ).toContain('radar_temas_unico_por_perfil')
  })

  it('un proceso está seguido u oculto, no las dos cosas', async () => {
    await db.exec(`insert into public.radar_seguimiento (workspace_id, perfil_id, notice_uid, estado)
                   values ('${OTRO}', '${perfilId}', 'CO1.NTC.9', 'sigue')`)
    expect(
      await falla(`insert into public.radar_seguimiento (workspace_id, perfil_id, notice_uid, estado)
                   values ('${OTRO}', '${perfilId}', 'CO1.NTC.9', 'oculto')`),
    ).toContain('radar_seguimiento_unico')
    expect(
      await falla(`insert into public.radar_seguimiento (workspace_id, perfil_id, notice_uid, estado)
                   values ('${OTRO}', '${perfilId}', 'CO1.NTC.10', 'tal-vez')`),
    ).toContain('radar_seguimiento_estado')
  })

  it('la marca sigue a un proceso que NO está en radar_procesos', async () => {
    // A propósito: no hay FK. Un proceso que cerró sale del dataset y la marca tiene que
    // sobrevivir, o se le borra al cliente la razón por la que lo estaba mirando.
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from public.radar_procesos where notice_uid = 'CO1.NTC.9'`,
    )
    expect(r.rows[0].n).toBe(0)
  })

  it('borrar el perfil se lleva sus temas y sus marcas', async () => {
    await db.exec(`delete from public.radar_perfiles where id = '${perfilId}'`)
    const temas = await db.query<{ n: number }>(
      `select count(*)::int as n from public.radar_temas where perfil_id = '${perfilId}'`,
    )
    const marcas = await db.query<{ n: number }>(
      `select count(*)::int as n from public.radar_seguimiento where perfil_id = '${perfilId}'`,
    )
    expect(temas.rows[0].n).toBe(0)
    expect(marcas.rows[0].n).toBe(0)
  })
})

describe('el RLS aísla de verdad (probado como authenticated, no como dueño)', () => {
  it('un workspace no ve ni cambia el perfil de otro, y el barrido lo ven los dos', async () => {
    await db.exec(`insert into public.radar_perfiles (workspace_id, nombre) values ('${DIMPRO}', 'de-dimpro')`)
    await db.exec(`insert into public.radar_perfiles (workspace_id, nombre) values ('${OTRO}', 'de-otro')`)

    await db.exec(`set role authenticated; select set_config('prueba.ws', '${DIMPRO}', false);`)
    const mios = await db.query<{ nombre: string }>(`select nombre from public.radar_perfiles order by 1`)
    expect(mios.rows.map((x) => x.nombre)).not.toContain('de-otro')
    expect(mios.rows.map((x) => x.nombre)).toContain('de-dimpro')

    // Un UPDATE al perfil ajeno no falla: no encuentra la fila. Lo que importa es que no la cambie.
    await db.exec(`update public.radar_perfiles set nombre = 'robado' where nombre = 'de-otro'`)

    // El barrido es compartido: se ve desde cualquier workspace.
    const barrido = await db.query<{ n: number }>(`select count(*)::int as n from public.radar_procesos`)
    expect(barrido.rows[0].n).toBeGreaterThan(0)

    await db.exec(`reset role;`)
    const ajeno = await db.query<{ n: number }>(
      `select count(*)::int as n from public.radar_perfiles where nombre = 'de-otro'`,
    )
    expect(ajeno.rows[0].n).toBe(1)
  })

  it('no se puede insertar un perfil en el workspace de otro', async () => {
    await db.exec(`set role authenticated; select set_config('prueba.ws', '${DIMPRO}', false);`)
    const err = await falla(`insert into public.radar_perfiles (workspace_id, nombre) values ('${OTRO}', 'colado')`)
    expect(err).toMatch(/row-level security|policy/i)
    await db.exec(`reset role;`)
  })
})
