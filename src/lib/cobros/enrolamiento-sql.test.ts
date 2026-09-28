/**
 * `20260929010000_enrolamiento_cobro_por_ciclo.sql` corrida de verdad en Postgres en memoria
 * (PGlite), encima de A1 (`workspace_modulos`) y A2 (catálogo + `servicios_contratados`), que son
 * las que ya están en producción.
 *
 * Esto es plata: lo que se prueba aquí es lo que la BASE tiene que rechazar sola, aunque el servidor
 * tenga un defecto y aunque alguien escriba por SQL a mano:
 *   · la primera cuota NO puede vencer antes (ni después) del día en que termina el trial;
 *   · el trial no se puede extender: ni por un CHECK que deje pasar otro `fin_trial`, ni por UPDATE;
 *   · el mismo contrato no se enrola dos veces, y un negocio con plan no recibe otro;
 *   · un contrato que no está activo no se enrola;
 *   · la tabla y la función no son alcanzables por `anon` ni por `authenticated`.
 *
 * `planes_cobro` y `plan_cobro_cuotas` se crean aquí con las mismas columnas y CHECK que en
 * producción (`20260504100001`, `20260630000001`, `20260908120000`): sus migraciones reales
 * arrastran `cobros`, `notificaciones` y triggers que no deciden nada de lo que aquí se mide.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const A1 = '20260915210000_workspace_modulos.sql'
const A2 = '20260916120000_catalogo_y_servicios_contratados.sql'
// La llave de módulo `radar_secop` la agregan estas dos: sin ellas el CHECK del catálogo rechaza
// la ficha del Radar (lo descubrió esta prueba al correr).
const FERRETERIA = '20260924235500_modulo_ferreteria.sql'
const RADAR = '20260928180000_modulo_radar_secop.sql'
const ENROLAMIENTO = '20260929010000_enrolamiento_cobro_por_ciclo.sql'

const WS = '00000000-0000-4000-8000-00000000c001'
const EMPRESA = '00000000-0000-4000-8000-00000000c002'
const NEGOCIO = '00000000-0000-4000-8000-00000000c003'
const OTRO_NEGOCIO = '00000000-0000-4000-8000-00000000c004'
const CONTRATO = '00000000-0000-4000-8000-00000000c005'
const CONTRATO_BORRADOR = '00000000-0000-4000-8000-00000000c006'

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

  -- Copia fiel de lo que decide algo, de 20260504100001 + 20260908120000.
  create table public.planes_cobro (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    negocio_id uuid not null references public.negocios(id),
    monto numeric(15,2) not null check (monto > 0),
    frecuencia text not null check (frecuencia in ('mensual','trimestral','anual')),
    fecha_inicio date not null,
    fecha_fin date not null,
    total_cuotas integer not null check (total_cuotas > 0),
    pasarela text not null default 'manual' check (pasarela in ('wompi','manual','mixto','bold','epayco')),
    auto_renovar boolean not null default false,
    activo boolean not null default true,
    concepto_detalle_template text,
    notas text,
    created_at timestamptz default now(),
    constraint planes_cobro_fechas_ordenadas check (fecha_fin >= fecha_inicio)
  );

  -- De 20260630000001.
  create table public.plan_cobro_cuotas (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id),
    plan_cobro_id uuid not null references public.planes_cobro(id) on delete cascade,
    numero integer not null,
    tipo text not null default 'cuota' check (tipo in ('anticipo','cuota')),
    monto numeric not null check (monto > 0),
    fecha_vencimiento date not null,
    concepto_detalle text,
    unique (plan_cobro_id, numero)
  );

  -- dimpro con su id real: la migracion del modulo Ferreteria (que solo se carga para que exista
  -- la llave radar_secop en los CHECK) verifica que ese workspace sea ese slug y aborta si no.
  insert into public.workspaces (id, slug) values
    ('${WS}', 'metrik'),
    ('67f7af44-b5ac-4d5c-aa9e-44954368447c', 'dimpro');
  insert into public.profiles (id, workspace_id) values
    ('cc6f6100-4eb7-4eed-9a7c-096729f5cedf', '67f7af44-b5ac-4d5c-aa9e-44954368447c');
  insert into public.empresas (id, nombre) values ('${EMPRESA}', 'I + D FABRIACRYLICOS S.A.S');
  insert into public.negocios (id, codigo) values ('${NEGOCIO}', 'F1 26 1'), ('${OTRO_NEGOCIO}', 'F1 26 2');
`

// El catálogo y el contrato. Las dos tablas del catálogo se apuntan con una FK diferida: van en una
// transacción, como en producción.
const DATOS = `
  begin;
  insert into public.catalogo_servicios (slug, nombre, modulo, disparador_cobro, version_vigente)
    values ('radar-secop-licencia', 'Licencia Radar SECOP', 'radar_secop', 'ciclo', 1);
  insert into public.catalogo_servicios_versiones (slug, version, definicion, fuente_ruta, fuente_sha256)
    values ('radar-secop-licencia', 1, '{"parametros":{"dias_trial":{"por_defecto":5}}}'::jsonb,
            'cerebro/catalogo/servicios/radar-secop-licencia.md', repeat('a', 64));
  commit;

  insert into public.servicios_contratados
    (id, workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, parametros, estado, vigente_desde)
  values
    ('${CONTRATO}', '${WS}', '${EMPRESA}', '${NEGOCIO}', 'radar-secop-licencia', 1,
     '{"precio_mensual": 15000, "dias_trial": 5}'::jsonb, 'activo', '2026-09-29'),
    ('${CONTRATO_BORRADOR}', '${WS}', '${EMPRESA}', '${OTRO_NEGOCIO}', 'radar-secop-licencia', 1,
     '{"precio_mensual": 20000}'::jsonb, 'borrador', '2026-09-29');
`

const ANCLA = '2026-09-29T14:30:00Z'
const FIN_TRIAL = '2026-10-04'

/** El calendario que manda el servidor: 12 cuotas, la primera el día en que termina el trial. */
function cuotas(finTrial = FIN_TRIAL, monto = 15000, total = 12): unknown[] {
  const [y, m, d] = finTrial.split('-').map(Number)
  const salida: unknown[] = []
  for (let n = 0; n < total; n++) {
    const fecha = new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10)
    salida.push({ numero: n + 1, monto, fecha_vencimiento: fecha, concepto_detalle: `cuota ${n + 1}` })
  }
  return salida
}

function plan(finTrial = FIN_TRIAL, monto = 15000, total = 12) {
  const cs = cuotas(finTrial, monto, total) as { fecha_vencimiento: string }[]
  return {
    monto,
    frecuencia: 'mensual',
    fecha_inicio: finTrial,
    fecha_fin: cs[cs.length - 1].fecha_vencimiento,
    total_cuotas: total,
    pasarela: 'bold',
    concepto_detalle_template: 'Suscripción Licencia Radar SECOP',
    notas: 'prueba',
  }
}

let db: PGlite

async function enrolar(p: {
  contrato?: string
  ancla?: string
  dias?: number
  plan?: unknown
  cuotas?: unknown[]
}): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const r = await db.query<{ enrolar_cobro_por_ciclo: Record<string, unknown> }>(
      'select public.enrolar_cobro_por_ciclo($1, $2, $3, $4, $5) as enrolar_cobro_por_ciclo',
      [p.contrato ?? CONTRATO, p.ancla ?? ANCLA, p.dias ?? 5, p.plan ?? plan(), JSON.stringify(p.cuotas ?? cuotas())],
    )
    return { ok: true, data: r.rows[0].enrolar_cobro_por_ciclo }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer(A1))
  await db.exec(leer(A2))
  await db.exec(leer(FERRETERIA))
  await db.exec(leer(RADAR))
  await db.exec(leer(ENROLAMIENTO))
  await db.exec(DATOS)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  // El acta es inmutable por trigger (eso es lo que se prueba más abajo), así que limpiar entre
  // casos exige apagarlo a mano. Que haga falta esta gimnasia es la señal de que el trigger existe.
  await db.exec(`
    alter table public.servicio_cobro_enrolamiento disable trigger trg_enrolamiento_inmutable;
    delete from public.servicio_cobro_enrolamiento;
    alter table public.servicio_cobro_enrolamiento enable trigger trg_enrolamiento_inmutable;
    delete from public.plan_cobro_cuotas;
    delete from public.planes_cobro;
  `)
})

describe('la migración no escribe nada', () => {
  it('el acta nace vacía: ningún contrato queda enrolado por aplicarla', async () => {
    const r = await db.query<{ n: number }>('select count(*)::int as n from public.servicio_cobro_enrolamiento')
    expect(r.rows[0].n).toBe(0)
  })
})

describe('el enrolamiento escribe las tres cosas, una sola vez', () => {
  it('crea el plan apagado, sus 12 cuotas y el acta con el ancla', async () => {
    const r = await enrolar({})
    expect(r.ok && r.data.resultado).toBe('creado')

    const p = await db.query<{ activo: boolean; total_cuotas: number; fecha_inicio: string; monto: string; pasarela: string }>(
      'select activo, total_cuotas, fecha_inicio::text, monto::text, pasarela from public.planes_cobro',
    )
    expect(p.rows).toHaveLength(1)
    expect(p.rows[0]).toMatchObject({ activo: false, total_cuotas: 12, fecha_inicio: FIN_TRIAL, pasarela: 'bold' })

    const q = await db.query<{ n: number; primera: string }>(
      `select count(*)::int as n, min(fecha_vencimiento)::text as primera from public.plan_cobro_cuotas`,
    )
    expect(q.rows[0]).toEqual({ n: 12, primera: FIN_TRIAL })

    const a = await db.query<{ fin_trial: string; dias_trial: number }>(
      'select fin_trial::text, dias_trial from public.servicio_cobro_enrolamiento',
    )
    expect(a.rows[0]).toEqual({ fin_trial: FIN_TRIAL, dias_trial: 5 })
  })

  it('la segunda llamada responde `ya_estaba` y NO crea un segundo plan', async () => {
    const primera = await enrolar({})
    const segunda = await enrolar({})
    expect(segunda.ok && segunda.data.resultado).toBe('ya_estaba')
    expect(segunda.ok && segunda.data.plan_cobro_id).toBe(primera.ok && primera.data.plan_cobro_id)
    const p = await db.query<{ n: number }>('select count(*)::int as n from public.planes_cobro')
    expect(p.rows[0].n).toBe(1)
    const q = await db.query<{ n: number }>('select count(*)::int as n from public.plan_cobro_cuotas')
    expect(q.rows[0].n).toBe(12)
  })

  it('un negocio que ya tiene plan responde `plan_existente` y no escribe nada', async () => {
    await db.exec(`
      insert into public.planes_cobro (workspace_id, negocio_id, monto, frecuencia, fecha_inicio, fecha_fin, total_cuotas)
      values ('${WS}', '${NEGOCIO}', 15000, 'mensual', '2026-10-04', '2027-09-04', 12);
    `)
    const r = await enrolar({})
    expect(r.ok && r.data.resultado).toBe('plan_existente')
    const p = await db.query<{ n: number }>('select count(*)::int as n from public.planes_cobro')
    expect(p.rows[0].n).toBe(1)
    const a = await db.query<{ n: number }>('select count(*)::int as n from public.servicio_cobro_enrolamiento')
    expect(a.rows[0].n).toBe(0)
  })

  it('un contrato que no está activo no se enrola', async () => {
    const r = await enrolar({ contrato: CONTRATO_BORRADOR })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/está en borrador/)
  })

  it('un contrato que no existe no se enrola', async () => {
    const r = await enrolar({ contrato: '00000000-0000-4000-8000-0000000000ff' })
    expect(!r.ok && r.error).toMatch(/no existe/)
  })
})

describe('el ancla del trial: la base no deja cobrar antes del día 6', () => {
  it('la cuota 1 no puede vencer ANTES del fin del trial', async () => {
    const r = await enrolar({ plan: plan('2026-10-01'), cuotas: cuotas('2026-10-01') })
    expect(!r.ok && r.error).toMatch(/el plan arranca el .* y el trial termina el/)
    const p = await db.query<{ n: number }>('select count(*)::int as n from public.planes_cobro')
    expect(p.rows[0].n).toBe(0)
  })

  it('tampoco DESPUÉS: un trial más largo «por esta vez» se rechaza', async () => {
    const r = await enrolar({ plan: plan('2026-10-20'), cuotas: cuotas('2026-10-20') })
    expect(!r.ok && r.error).toMatch(/el trial termina el 2026-10-04/)
  })

  it('un calendario que arranca bien pero con la cuota 1 corrida se rechaza', async () => {
    // El plan dice lo correcto y las cuotas mienten: la comprobación es por cuota, no por el plan.
    const cs = cuotas() as { fecha_vencimiento: string }[]
    cs[0] = { ...cs[0], fecha_vencimiento: '2026-10-11' }
    const r = await enrolar({ cuotas: cs })
    expect(!r.ok && r.error).toMatch(/la cuota 1 vence el 2026-10-11/)
  })

  it('el día se cuenta en Bogotá: una aceptación a las 21:00 no regala un día', async () => {
    // 02:00Z del 29-sep = 21:00 del 28-sep en Bogotá → el trial termina el 3-oct, no el 4. Primero
    // el calendario que da por hecho el día UTC, que es el error fácil: la base lo rechaza.
    const malo = await enrolar({ ancla: '2026-09-29T02:00:00Z' })
    expect(!malo.ok && malo.error).toMatch(/el trial termina el 2026-10-03/)
    const r = await enrolar({ ancla: '2026-09-29T02:00:00Z', plan: plan('2026-10-03'), cuotas: cuotas('2026-10-03') })
    expect(r.ok && r.data.fin_trial).toBe('2026-10-03')
  })

  it('el CHECK del acta no admite un `fin_trial` que no salga del ancla', async () => {
    // Escribiendo por SQL a mano, saltándose la función: el trial sigue sin poder estirarse.
    const r = await db
      .exec(
        `insert into public.planes_cobro (id, workspace_id, negocio_id, monto, frecuencia, fecha_inicio, fecha_fin, total_cuotas)
         values ('00000000-0000-4000-8000-0000000000b9', '${WS}', '${NEGOCIO}', 15000, 'mensual', '2026-10-04', '2027-09-04', 12);
         insert into public.servicio_cobro_enrolamiento
           (servicio_contratado_id, workspace_id, negocio_id, plan_cobro_id, ancla_at, dias_trial, fin_trial, monto, total_cuotas)
         values ('${CONTRATO}', '${WS}', '${NEGOCIO}', '00000000-0000-4000-8000-0000000000b9',
                 '${ANCLA}', 5, '2026-11-04', 15000, 12);`,
      )
      .then(() => null)
      .catch((e: Error) => e.message)
    expect(r).toMatch(/enrolamiento_fin_trial_es_el_ancla/)
  })

  it('el acta no se puede reescribir ni borrar: el trial no se extiende por UPDATE', async () => {
    await enrolar({})
    const update = await db
      .exec(`update public.servicio_cobro_enrolamiento set fin_trial = '2026-12-04', dias_trial = 66`)
      .then(() => null)
      .catch((e: Error) => e.message)
    expect(update).toMatch(/no se reescribe ni se borra/)
    const del = await db
      .exec('delete from public.servicio_cobro_enrolamiento')
      .then(() => null)
      .catch((e: Error) => e.message)
    expect(del).toMatch(/no se reescribe ni se borra/)
  })
})

describe('el calendario que la base rechaza', () => {
  it('sin cuotas no hay nada que cobrar', async () => {
    const r = await enrolar({ cuotas: [], plan: { ...plan(), total_cuotas: 0 } })
    expect(!r.ok && r.error).toMatch(/el calendario trae 0 cuotas/)
  })

  it('el plan y el calendario tienen que decir el mismo número de cuotas', async () => {
    const r = await enrolar({ cuotas: cuotas(FIN_TRIAL, 15000, 6) })
    expect(!r.ok && r.error).toMatch(/el plan dice 12 cuotas y el calendario trae 6/)
  })

  it('los números van de 1 a N, en orden', async () => {
    const cs = cuotas() as { numero: number }[]
    cs[3] = { ...cs[3], numero: 9 }
    const r = await enrolar({ cuotas: cs })
    expect(!r.ok && r.error).toMatch(/la cuota en la posición 4 dice número 9/)
  })

  it('una cuota en cero no pasa', async () => {
    const cs = cuotas() as { monto: number }[]
    cs[2] = { ...cs[2], monto: 0 }
    const r = await enrolar({ cuotas: cs })
    expect(!r.ok && r.error).toMatch(/la cuota 3 no tiene monto/)
  })

  it('dos cuotas que vencen el mismo día no pasan', async () => {
    const cs = cuotas() as { fecha_vencimiento: string }[]
    cs[1] = { ...cs[1], fecha_vencimiento: FIN_TRIAL }
    const r = await enrolar({ cuotas: cs })
    expect(!r.ok && r.error).toMatch(/la cuota 2 no vence después de la anterior/)
  })

  it('sin ancla no se enrola', async () => {
    const r = await db
      .query('select public.enrolar_cobro_por_ciclo($1, null, 5, $2, $3)', [CONTRATO, plan(), JSON.stringify(cuotas())])
      .then(() => null)
      .catch((e: Error) => e.message)
    expect(r).toMatch(/sin ancla ni días de trial/)
  })
})

describe('quién alcanza esto', () => {
  it('ni `anon` ni `authenticated` leen el acta ni ejecutan la función', async () => {
    const t = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_table_privilege('anon', 'public.servicio_cobro_enrolamiento', 'select') as anon,
              has_table_privilege('authenticated', 'public.servicio_cobro_enrolamiento', 'select') as auth`,
    )
    expect(t.rows[0]).toEqual({ anon: false, auth: false })

    const f = await db.query<{ anon: boolean; auth: boolean }>(
      `select has_function_privilege('anon', 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', 'execute') as auth`,
    )
    expect(f.rows[0]).toEqual({ anon: false, auth: false })
  })

  it('el acta tiene RLS encendido', async () => {
    const r = await db.query<{ rls: boolean }>(
      `select relrowsecurity as rls from pg_class
        where relnamespace = 'public'::regnamespace and relname = 'servicio_cobro_enrolamiento'`,
    )
    expect(r.rows[0].rls).toBe(true)
  })
})
