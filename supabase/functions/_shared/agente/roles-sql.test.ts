import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { REGLAMENTO_SABOR } from './publico/reglamento-sabor'
import { REGLAMENTO_ANEXO_A } from './bandeja/reglamento-anexo-a'
import { fichasOne } from './one/reglamento'
import { fichaValida, huellaDe, huellaPublicable } from './reglamento'
import type { Ficha } from './tipos'

/**
 * La migración de roles y funciones de los asistentes (20261026183000_asistentes_roles.sql) con LOS ARCHIVOS de
 * migración en Postgres en memoria (PGlite). Spec docs/specs/2026-10-26_asistentes-roles-y-funciones.md, §2.8.
 * Lo central: la huella que calcula la base al publicar un rol tiene que ser la que calcula el arnés en TypeScript.
 */

const MIGRACION = '20261026183000_asistentes_roles.sql'
const leer = (a: string) => readFileSync(join(process.cwd(), 'supabase/migrations', a), 'utf8')
const WS = '00000000-0000-4000-8000-0000000000b1'
const WS_2 = '00000000-0000-4000-8000-0000000000b2'
const WS_3 = '00000000-0000-4000-8000-0000000000b3'
const STAFF_LILIANA = '00000000-0000-4000-8000-00000000c001'
const PERFIL_LILIANA = '00000000-0000-4000-8000-00000000d001'
const STAFF_SIN_PERFIL = '00000000-0000-4000-8000-00000000c002'
const STAFF_OTRO_WS = '00000000-0000-4000-8000-00000000c003'
const COLAB = '00000000-0000-4000-8000-00000000e001'
const COLAB_OTRO_WS = '00000000-0000-4000-8000-00000000e002'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  // Lo mínimo de las tablas que ya existen en producción y que la migración referencia.
  await db.exec(`
    set time zone 'UTC';
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.workspaces (id uuid primary key, slug text);
    insert into public.workspaces values ('${WS}', 'imperviun'), ('${WS_2}', 'sabor'), ('${WS_3}', 'sin-roles');
    create table public.staff (id uuid primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade, profile_id uuid unique);
    insert into public.staff values ('${STAFF_LILIANA}', '${WS}', '${PERFIL_LILIANA}'), ('${STAFF_SIN_PERFIL}', '${WS}', null), ('${STAFF_OTRO_WS}', '${WS_2}', null);
    create table public.wa_collaborators (id uuid primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade);
    insert into public.wa_collaborators values ('${COLAB}', '${WS}'), ('${COLAB_OTRO_WS}', '${WS_2}');
  `)
  await db.exec(leer('20261006213100_wa_conversacion.sql'))
  await db.exec(leer('20261006213200_bot_reglamento_y_uso.sql'))
  await db.exec(leer(MIGRACION))
})
afterAll(async () => { await db.close() })

/** Carga fichas en `bot_parametros` columna por columna, como las semillas (`publico/semilla-sql.ts`). */
async function cargarFichas(ws: string | null, bot: string, fichas: Ficha[]) {
  for (const f of fichas) {
    await db.query(
      `insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [ws, bot, f.clave, f.tipo, f.carga, f.cuando ?? null, f.hacer, f.herramientas ?? null, f.prioridad ?? null, f.fuente || null, f.valores ? JSON.stringify(f.valores) : null],
    )
  }
}
const borrarFichas = (bot: string) => db.query('delete from public.bot_parametros where bot = $1', [bot])
const versiones = async (ws: string, bot: string) =>
  (await db.query<{ n: number }>('select count(*)::int as n from public.bot_reglamentos where workspace_id = $1 and bot = $2', [ws, bot])).rows[0].n
const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]

const banco = (huella: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ pasa: true, k: 3, fecha: '2026-10-26T12:00:00Z', huella_fichas: huella, ...extra })

const fichaRol = (funciones: unknown[], extra: Partial<Ficha> = {}): Ficha =>
  ({ clave: 'rol.funciones', tipo: 'alcance', carga: 'siempre', hacer: 'Funciones del rol.', valores: { funciones }, ...extra })

// ─────────────────────────────────────────────────────────────────────────────

describe('creación limpia', () => {
  const TABLAS = ['asistente_funciones_empresa', 'asistente_roles', 'asistente_asignaciones', 'asistente_escalamientos', 'asistente_calificaciones', 'asistente_preferencias']
  it('crea las seis tablas con RLS y sin nada para anon ni authenticated', async () => {
    for (const t of TABLAS) {
      const r = await uno<{ rls: boolean; anon: boolean; auth: boolean; serv: boolean }>(
        `select c.relrowsecurity as rls,
                has_table_privilege('anon', c.oid, 'select') as anon,
                has_table_privilege('authenticated', c.oid, 'select') as auth,
                has_table_privilege('service_role', c.oid, 'select') as serv
         from pg_class c where c.oid = ('public.' || $1)::regclass`, [t])
      expect(r, t).toEqual({ rls: true, anon: false, auth: false, serv: true })
    }
  })
  it('ninguna función nueva la ejecuta anon ni authenticated', async () => {
    const r = await db.query<{ f: string; anon: boolean; auth: boolean }>(
      `select p.oid::regprocedure::text as f, has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'asistente\\_%'`)
    expect(r.rows.map((x) => x.f.split('(')[0]).sort()).toEqual(['asistente_asignaciones_validar', 'asistente_huella_fichas', 'asistente_json_canonico', 'asistente_publicar_rol', 'asistente_resolver_rol', 'asistente_roles_puntero_valido'])
    for (const x of r.rows) expect(x, x.f).toMatchObject({ anon: false, auth: false })
  })
})

describe('la huella: base (asistente_huella_fichas) contra arnés (huellaPublicable)', () => {
  const casos: Array<[string, Ficha[]]> = [
    ['Sabor (reglamento-sabor.ts)', REGLAMENTO_SABOR],
    ['bandeja Trappvel (Anexo A)', REGLAMENTO_ANEXO_A],
    ['ONE (fichasOne)', fichasOne('Imperviun')],
    ['bordes', [
      { clave: 'g.a_b', tipo: 'guia', carga: 'siempre', hacer: 'comillas " barra \\ salto\nfin\ttab \u0001 ñ á 🎬 «x»' },
      { clave: 'g.a.c', tipo: 'guia', carga: 'indice', cuando: 'siempre', hacer: 'h', herramientas: [], prioridad: -3 },
      { clave: 'G.mayus', tipo: 'guia', carga: 'siempre', hacer: 'h', fuente: 'kickoff' },
      fichaRol(['equipo.gastos', 'comun.persona'], { valores: { funciones: ['equipo.gastos'], abono: 100000, iva: 0.19, nulo: null, anidado: { b: [1, null, true, 'x'], a: { z: null, y: 2.5 } }, vacio: {} } }),
    ]],
  ]
  for (const [nombre, fichas] of casos) {
    it(`coinciden: ${nombre}`, async () => {
      const bot = `rol:prueba_huella`
      await borrarFichas(bot)
      await cargarFichas(WS_3, bot, fichas)
      const id = (await uno<{ id: string }>(`select public.bot_publicar_reglamento($1, $2, 'max') as id`, [WS_3, bot])).id
      const v = await uno<{ fichas: unknown[]; base: string; huella: string }>(
        'select fichas, huella, public.asistente_huella_fichas(fichas) as base from public.bot_reglamentos where id = $1', [id])
      const delCodigo = await huellaPublicable(fichas)
      const leidas = await huellaPublicable(v.fichas.map(fichaValida).filter((f): f is Ficha => !!f))
      expect(v.base).toBe(delCodigo)
      expect(leidas).toBe(delCodigo)
      // Por qué no se compara la columna `huella`: ni la de `bot_publicar_reglamento` ni `huellaDe` son reproducibles en el otro lado.
      expect(v.huella).not.toBe(delCodigo)
      expect(await huellaDe(fichas)).not.toBe(v.huella)
    })
  }
  it('escrito a mano en la base: fuente vacía y números con decimales de sobra dan la misma huella que en el código', async () => {
    // jsonb conserva la escala (100000.0, 2.50) y un INSERT directo puede dejar fuente ''. JavaScript no ve ninguna de las dos.
    const sql = `[{"clave":"g.x","tipo":"guia","carga":"siempre","hacer":"h","fuente":"","valores":{"abono":100000.0,"iva":0.190,"y":2.50,"neg":-3.0}}]`
    const ts: Ficha[] = [{ clave: 'g.x', tipo: 'guia', carga: 'siempre', hacer: 'h', fuente: '', valores: { abono: 100000, iva: 0.19, y: 2.5, neg: -3 } }]
    const r = await uno<{ h: string }>(`select public.asistente_huella_fichas($1::jsonb) as h`, [sql])
    expect(r.h).toBe(await huellaPublicable(ts))
  })
  it('cambiar una letra de una ficha cambia la huella', async () => {
    const a = REGLAMENTO_SABOR
    const b = a.map((f, i) => (i === 3 ? { ...f, hacer: f.hacer + '.' } : f))
    expect(await huellaPublicable(b)).not.toBe(await huellaPublicable(a))
    const r = await uno<{ a: string; b: string }>(
      `select public.asistente_huella_fichas($1::jsonb) as a, public.asistente_huella_fichas($2::jsonb) as b`,
      [JSON.stringify(a), JSON.stringify(b)])
    expect(r.a).toBe(await huellaPublicable(a))
    expect(r.b).toBe(await huellaPublicable(b))
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('checks de las tablas', () => {
  it('asistente_funciones_empresa: solo claves del catálogo con familia, y parámetros objeto', async () => {
    await db.query(`insert into public.asistente_funciones_empresa (workspace_id, funcion, prendida_por) values ($1, 'equipo.gastos', 'max')`, [WS])
    for (const mala of ['comun.persona', 'nucleo.responder', 'gastos', 'equipo.Gastos', 'equipo.', 'otra.cosa']) {
      await expect(db.query(`insert into public.asistente_funciones_empresa (workspace_id, funcion, prendida_por) values ($1, $2, 'max')`, [WS, mala]), mala).rejects.toThrow(/asistente_funciones_empresa_clave/)
    }
    await expect(db.query(`insert into public.asistente_funciones_empresa (workspace_id, funcion, prendida_por, parametros) values ($1, 'equipo.citas', 'max', '[]')`, [WS])).rejects.toThrow(/parametros/)
    await expect(db.query(`insert into public.asistente_funciones_empresa (workspace_id, funcion, prendida_por) values ($1, 'equipo.gastos', 'max')`, [WS])).rejects.toThrow(/duplicate key/)
  })
  it('asistente_roles: familia, canal, forma de la clave y nada activo sin publicar', async () => {
    const ins = (clave: string, familia: string, canal: string, activo = false) => db.query(
      `insert into public.asistente_roles (workspace_id, clave, familia, canal, activo) values ($1, $2, $3, $4, $5)`, [WS, clave, familia, canal, activo])
    await expect(ins('x', 'proveedores', 'wa_one')).rejects.toThrow(/asistente_roles_familia/)
    await expect(ins('x', 'equipo', 'telegram')).rejects.toThrow(/asistente_roles_canal/)
    await expect(ins('Mano Derecha', 'equipo', 'wa_one')).rejects.toThrow(/asistente_roles_clave_forma/)
    await expect(ins('x', 'equipo', 'wa_one', true)).rejects.toThrow(/asistente_roles_activo_publicado/)
    await ins('mano_derecha', 'equipo', 'wa_one')
    await expect(ins('mano_derecha', 'clientes', 'chatwoot')).rejects.toThrow(/duplicate key/)
  })
})

describe('el puntero del rol (trigger asistente_roles_puntero_valido)', () => {
  let delRol: string, otroWs: string, otroRol: string, otroBot: string
  beforeAll(async () => {
    await db.query(`insert into public.asistente_roles (workspace_id, clave, familia, canal) values ($1, 'recolector', 'equipo', 'wa_one'), ($2, 'recolector', 'equipo', 'wa_one')`, [WS, WS_2])
    const f: Ficha[] = [{ clave: 'g.x', tipo: 'guia', carga: 'siempre', hacer: 'x' }]
    await cargarFichas(null, 'rol:recolector', f)
    await cargarFichas(null, 'rol:mano_derecha', f)
    await cargarFichas(null, 'publico', f)
    const pub = async (ws: string, bot: string) => (await uno<{ id: string }>(`select public.bot_publicar_reglamento($1, $2, 'max') as id`, [ws, bot])).id
    delRol = await pub(WS, 'rol:recolector')
    otroWs = await pub(WS_2, 'rol:recolector')
    otroRol = await pub(WS, 'rol:mano_derecha')
    otroBot = await pub(WS, 'publico')
  })
  const mover = (id: string) => db.query(`update public.asistente_roles set reglamento_id = $2 where workspace_id = $1 and clave = 'recolector'`, [WS, id])
  it('rechaza una versión de otro workspace, de otro rol o de otro bot', async () => {
    await expect(mover(otroWs)).rejects.toThrow(/no es una version del rol recolector/)
    await expect(mover(otroRol)).rejects.toThrow(/no es una version del rol recolector/)
    await expect(mover(otroBot)).rejects.toThrow(/no es una version del rol recolector/)
  })
  it('acepta su propia versión, refresca updated_at y deja prender el rol', async () => {
    const antes = await uno<{ u: string }>(`select updated_at::text as u from public.asistente_roles where workspace_id = $1 and clave = 'recolector'`, [WS])
    await db.query(`select pg_sleep(0.01)`)
    await mover(delRol)
    await db.query(`update public.asistente_roles set activo = true where workspace_id = $1 and clave = 'recolector'`, [WS])
    const r = await uno<{ reglamento_id: string; activo: boolean; u: string }>(`select reglamento_id, activo, updated_at::text as u from public.asistente_roles where workspace_id = $1 and clave = 'recolector'`, [WS])
    expect(r).toMatchObject({ reglamento_id: delRol, activo: true })
    expect(r.u).not.toBe(antes.u)
  })
  it('cambiar la clave de un rol con puntero también se revisa', async () => {
    await expect(db.query(`update public.asistente_roles set clave = 'otro' where workspace_id = $1 and clave = 'recolector'`, [WS])).rejects.toThrow(/no es una version del rol otro/)
  })
})

describe('asignaciones: llaves, vigencia y una vigente por sujeto', () => {
  let rolMano: string, rolOtroWs: string
  beforeAll(async () => {
    rolMano = (await uno<{ id: string }>(`select id from public.asistente_roles where workspace_id = $1 and clave = 'mano_derecha'`, [WS])).id
    rolOtroWs = (await uno<{ id: string }>(`select id from public.asistente_roles where workspace_id = $1 and clave = 'recolector'`, [WS_2])).id
  })
  beforeEach(async () => { await db.query('delete from public.asistente_asignaciones') })
  const asignar = ({ rol_id, ...c }: Record<string, unknown>) => {
    const k = Object.keys(c)
    return db.query(
      `insert into public.asistente_asignaciones (workspace_id, rol_id, asignado_por, ${k.join(', ')}) values ($1, $2, 'max', ${k.map((_, i) => `$${i + 3}`).join(', ')})`,
      [WS, rol_id ?? rolMano, ...k.map((x) => c[x])],
    )
  }
  it('una llave por tipo de sujeto', async () => {
    await expect(asignar({ sujeto_tipo: 'staff' })).rejects.toThrow(/una_llave/)
    await expect(asignar({ sujeto_tipo: 'staff', staff_id: STAFF_LILIANA, cargo: 'owner' })).rejects.toThrow(/una_llave/)
    await expect(asignar({ sujeto_tipo: 'cargo', staff_id: STAFF_LILIANA })).rejects.toThrow(/una_llave/)
    await expect(asignar({ sujeto_tipo: 'inbox', cargo: 'owner' })).rejects.toThrow(/una_llave/)
    await expect(asignar({ sujeto_tipo: 'persona', staff_id: STAFF_LILIANA })).rejects.toThrow(/asistente_asignaciones_tipo/)
    await asignar({ sujeto_tipo: 'staff', staff_id: STAFF_LILIANA })
    await asignar({ sujeto_tipo: 'colaborador', collaborator_id: COLAB })
    await asignar({ sujeto_tipo: 'cargo', cargo: 'owner' })
    await asignar({ sujeto_tipo: 'inbox', inbox: 'cw:12:345' })
    await asignar({ sujeto_tipo: 'inbox', inbox: 'wa:1234567890' })
  })
  it('cargo de la lista de ONE e inbox con su origen', async () => {
    await expect(asignar({ sujeto_tipo: 'cargo', cargo: 'gerente' })).rejects.toThrow(/asistente_asignaciones_cargo/)
    for (const mal of ['345', 'cw:345', 'ig:1', 'wa:+57315', 'cw:a:1']) {
      await expect(asignar({ sujeto_tipo: 'inbox', inbox: mal }), mal).rejects.toThrow(/asistente_asignaciones_inbox/)
    }
  })
  it('staff, colaborador y rol tienen que ser del mismo workspace', async () => {
    await expect(asignar({ sujeto_tipo: 'staff', staff_id: STAFF_OTRO_WS })).rejects.toThrow(/no es de este workspace/)
    await expect(asignar({ sujeto_tipo: 'colaborador', collaborator_id: COLAB_OTRO_WS })).rejects.toThrow(/no es de este workspace/)
    await expect(asignar({ sujeto_tipo: 'cargo', cargo: 'owner', rol_id: rolOtroWs })).rejects.toThrow(/asistente_asignaciones_rol/)
  })
  it('vigencia: hasta después de desde', async () => {
    await expect(asignar({ sujeto_tipo: 'cargo', cargo: 'owner', desde: '2026-10-26', hasta: '2026-10-26' })).rejects.toThrow(/vigencia/)
    await expect(asignar({ sujeto_tipo: 'cargo', cargo: 'owner', desde: '2026-10-26', hasta: '2026-10-01' })).rejects.toThrow(/vigencia/)
  })
  it('una sola vigente por sujeto: ni dos abiertas ni dos que se crucen; seguidas sí', async () => {
    await asignar({ sujeto_tipo: 'staff', staff_id: STAFF_LILIANA, desde: '2026-10-01' })
    await expect(asignar({ sujeto_tipo: 'staff', staff_id: STAFF_LILIANA, desde: '2026-12-01' })).rejects.toThrow(/se cruza|duplicate key/)
    await expect(asignar({ sujeto_tipo: 'staff', staff_id: STAFF_LILIANA, desde: '2026-09-01', hasta: '2026-10-02' })).rejects.toThrow(/se cruza/)
    await asignar({ sujeto_tipo: 'staff', staff_id: STAFF_LILIANA, desde: '2026-09-01', hasta: '2026-10-01' })
    // Cerrar la vigente y abrir la siguiente justo donde termina.
    await db.query(`update public.asistente_asignaciones set hasta = '2026-11-01' where hasta is null`)
    await asignar({ sujeto_tipo: 'staff', staff_id: STAFF_LILIANA, desde: '2026-11-01' })
    // Otro sujeto no choca.
    await asignar({ sujeto_tipo: 'staff', staff_id: STAFF_SIN_PERFIL, desde: '2026-10-01' })
    // El índice único también ataja dos abiertas aunque se salte el trigger.
    await db.query('alter table public.asistente_asignaciones disable trigger asistente_asignaciones_validar')
    await expect(asignar({ sujeto_tipo: 'staff', staff_id: STAFF_LILIANA, desde: '2027-01-01' })).rejects.toThrow(/duplicate key/)
    await db.query('alter table public.asistente_asignaciones enable trigger asistente_asignaciones_validar')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('asistente_publicar_rol', () => {
  const BOT = 'rol:asesor_vendedor'
  const FICHAS: Ficha[] = [
    { clave: 'perfil', tipo: 'perfil', carga: 'siempre', hacer: 'Eres el asesor.', valores: { nombre: 'Agus' } },
    fichaRol(['clientes.ficha', 'clientes.reglas', 'comun.persona']),
    { clave: 'g.tono', tipo: 'estilo', carga: 'siempre', hacer: 'Cálido y corto.' },
  ]
  let huella: string
  beforeAll(async () => {
    await db.query(`insert into public.asistente_roles (workspace_id, clave, familia, canal) values ($1, 'asesor_vendedor', 'clientes', 'chatwoot')`, [WS_2])
    await db.query(`insert into public.asistente_funciones_empresa (workspace_id, funcion, prendida_por) values ($1, 'clientes.ficha', 'max'), ($1, 'clientes.reglas', 'max')`, [WS_2])
    await cargarFichas(WS_2, BOT, FICHAS)
    huella = await huellaPublicable(FICHAS)
  })
  const publicar = (b: string | null, rol = 'asesor_vendedor', ws = WS_2) =>
    db.query<{ id: string }>(`select public.asistente_publicar_rol($1, $2, 'max', $3::jsonb) as id`, [ws, rol, b])

  it('rechaza un banco que no pasa, con k < 3, sin fecha o sin huella, y no deja versión', async () => {
    const antes = await versiones(WS_2, BOT)
    const malos: Array<string | null> = [
      null,
      '[]',
      banco(huella, { pasa: false }),
      banco(huella, { pasa: 'true' }),
      banco(huella, { k: 2 }),
      banco(huella, { k: '3' }),
      banco(huella, { k: undefined }),
      banco(huella, { fecha: undefined }),
      banco('abc'),
    ]
    for (const b of malos) await expect(publicar(b), String(b)).rejects.toThrow(/no se publica sin un banco/)
    expect(await versiones(WS_2, BOT)).toBe(antes)
  })
  it('rechaza un rol no registrado', async () => {
    await expect(publicar(banco(huella), 'mano_derecha')).rejects.toThrow(/no esta registrado/)
  })
  it('rechaza una huella distinta y revierte la versión', async () => {
    const antes = await versiones(WS_2, BOT)
    await expect(publicar(banco(await huellaPublicable(FICHAS.map((f) => (f.clave === 'g.tono' ? { ...f, hacer: 'Frío.' } : f)))))).rejects.toThrow(/cambiaron despues de la prueba/)
    await expect(publicar(banco(await huellaPublicable(FICHAS.slice(0, 2))))).rejects.toThrow(/cambiaron despues de la prueba/)
    expect(await versiones(WS_2, BOT)).toBe(antes)
  })
  it('rechaza una función no prendida (o apagada) y revierte la versión', async () => {
    const antes = await versiones(WS_2, BOT)
    await db.query(`update public.asistente_funciones_empresa set activa = false where workspace_id = $1 and funcion = 'clientes.reglas'`, [WS_2])
    await expect(publicar(banco(huella))).rejects.toThrow(/no tiene prendidas: \{clientes.reglas\}/)
    await db.query(`update public.asistente_funciones_empresa set activa = true where workspace_id = $1 and funcion = 'clientes.reglas'`, [WS_2])
    // Prendida en OTRO workspace no cuenta.
    await db.query(`delete from public.asistente_funciones_empresa where workspace_id = $1 and funcion = 'clientes.ficha'`, [WS_2])
    await db.query(`insert into public.asistente_funciones_empresa (workspace_id, funcion, prendida_por) values ($1, 'clientes.ficha', 'max') on conflict do nothing`, [WS])
    await expect(publicar(banco(huella))).rejects.toThrow(/no tiene prendidas: \{clientes.ficha\}/)
    await db.query(`insert into public.asistente_funciones_empresa (workspace_id, funcion, prendida_por) values ($1, 'clientes.ficha', 'max')`, [WS_2])
    expect(await versiones(WS_2, BOT)).toBe(antes)
  })
  it('rechaza un rol sin rol.funciones o con funciones mal formadas', async () => {
    const bot = 'rol:sin_funciones'
    await db.query(`insert into public.asistente_roles (workspace_id, clave, familia, canal) values ($1, 'sin_funciones', 'clientes', 'chatwoot'), ($1, 'raro', 'clientes', 'chatwoot')`, [WS_2])
    const sin: Ficha[] = [FICHAS[0]]
    await cargarFichas(WS_2, bot, sin)
    await expect(publicar(banco(await huellaPublicable(sin)), 'sin_funciones')).rejects.toThrow(/no trae la ficha rol.funciones/)
    const raro: Ficha[] = [FICHAS[0], fichaRol(['clientes.ficha', 'pagos', 3])]
    await cargarFichas(WS_2, 'rol:raro', raro)
    await expect(publicar(banco(await huellaPublicable(raro)), 'raro')).rejects.toThrow(/forma invalida en el rol raro: \{pagos,3\}/)
    expect(await versiones(WS_2, bot)).toBe(0)
    expect(await versiones(WS_2, 'rol:raro')).toBe(0)
  })
  it('publica con un banco que pasa: guarda el banco, no exige las comunes y no mueve el puntero', async () => {
    const r = await publicar(banco(huella, { k: 5 }))
    const v = await uno<{ version: number; banco: { k: number }; bot: string }>('select version, banco, bot from public.bot_reglamentos where id = $1', [r.rows[0].id])
    expect(v).toMatchObject({ version: 1, bot: BOT, banco: { k: 5 } })
    const rol = await uno<{ reglamento_id: string | null }>(`select reglamento_id from public.asistente_roles where workspace_id = $1 and clave = 'asesor_vendedor'`, [WS_2])
    expect(rol.reglamento_id).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('asistente_resolver_rol (la lectura del componedor)', () => {
  const ids: Record<string, string> = {}
  type Res = { usa_roles: boolean; rol: null | { clave: string; por: string; activo: boolean; reglamento_id: string | null; version: number | null; funciones: Array<{ funcion: string; parametros: Record<string, unknown> }>; funciones_apagadas: string[] } }
  const resolver = async (a: { canal?: string; staff?: string | null; colaborador?: string | null; cargo?: string | null; inbox?: string | null; ws?: string } = {}) =>
    (await uno<{ r: Res }>(`select public.asistente_resolver_rol($1, $2, $3, $4, $5, $6) as r`,
      [a.ws ?? WS, a.canal ?? 'wa_one', a.staff ?? null, a.colaborador ?? null, a.cargo ?? null, a.inbox ?? null])).r

  beforeAll(async () => {
    await db.query('delete from public.asistente_asignaciones')
    // Imperviun: mano derecha publicada con tres funciones (una apagada en la empresa) y el recolector ya publicado.
    await db.query(`insert into public.asistente_funciones_empresa (workspace_id, funcion, prendida_por, parametros) values
      ($1, 'equipo.gastos_obra', 'max', '{"rubros": true}'), ($1, 'equipo.facturas', 'max', '{}'), ($1, 'recolector.llegada_obra', 'max', '{"max_obras_dia": 2}')
      on conflict do nothing`, [WS])
    await db.query(`update public.asistente_funciones_empresa set activa = false where workspace_id = $1 and funcion = 'equipo.gastos'`, [WS])
    const mano: Ficha[] = [fichaRol(['equipo.gastos_obra', 'equipo.gastos', 'comun.persona', 'equipo.facturas'])]
    await cargarFichas(WS, 'rol:mano_derecha', mano)
    await db.query(`update public.bot_parametros set activo = false where bot = 'rol:mano_derecha' and workspace_id is null`)
    await db.query(`update public.asistente_funciones_empresa set activa = true where workspace_id = $1 and funcion = 'equipo.gastos'`, [WS])
    const idMano = (await uno<{ id: string }>(`select public.asistente_publicar_rol($1, 'mano_derecha', 'max', $2::jsonb) as id`, [WS, banco(await huellaPublicable(mano))])).id
    await db.query(`update public.asistente_funciones_empresa set activa = false where workspace_id = $1 and funcion = 'equipo.gastos'`, [WS])
    await db.query(`update public.asistente_roles set reglamento_id = $2, activo = true where workspace_id = $1 and clave = 'mano_derecha'`, [WS, idMano])
    // Un rol de Chatwoot en el mismo workspace, para el filtro por canal.
    await db.query(`insert into public.asistente_roles (workspace_id, clave, familia, canal) values ($1, 'atencion', 'clientes', 'chatwoot')`, [WS])
    for (const r of (await db.query<{ id: string; clave: string }>('select id, clave from public.asistente_roles where workspace_id = $1', [WS])).rows) ids[r.clave] = r.id
    const asignar = (rol: string, tipo: string, col: string, val: string, desde = '2026-10-01', hasta: string | null = null) => db.query(
      `insert into public.asistente_asignaciones (workspace_id, rol_id, sujeto_tipo, ${col}, desde, hasta, asignado_por) values ($1, $2, $3, $4, $5, $6, 'max')`,
      [WS, ids[rol], tipo, val, desde, hasta])
    await asignar('mano_derecha', 'staff', 'staff_id', STAFF_LILIANA)
    await asignar('recolector', 'colaborador', 'collaborator_id', COLAB)
    await asignar('recolector', 'cargo', 'cargo', 'operator')
    await asignar('mano_derecha', 'cargo', 'cargo', 'owner', '2020-01-01', '2026-01-01')  // vencida
    await asignar('recolector', 'cargo', 'cargo', 'admin', '2099-01-01')                // futura
    await asignar('recolector', 'inbox', 'inbox', 'wa:999')
    await asignar('atencion', 'inbox', 'inbox', 'cw:1:7')
  })

  it('un workspace sin roles en el canal: enrutamiento de hoy', async () => {
    expect(await resolver({ ws: WS_3, cargo: 'owner' })).toEqual({ usa_roles: false, rol: null })
    expect(await resolver({ ws: WS_2, canal: 'wa_propio', cargo: 'owner' })).toEqual({ usa_roles: false, rol: null })
  })
  it('con roles pero sin asignación que cubra al remitente: usa_roles y rol null', async () => {
    expect(await resolver({ cargo: 'contador' })).toEqual({ usa_roles: true, rol: null })
    expect(await resolver({ staff: STAFF_OTRO_WS })).toEqual({ usa_roles: true, rol: null })
  })
  it('staff por su perfil o por su id, con las funciones del rol ∩ las prendidas, en el orden del rol', async () => {
    for (const staff of [PERFIL_LILIANA, STAFF_LILIANA]) {
      const r = await resolver({ staff, cargo: 'operator', inbox: 'wa:999' })
      expect(r.usa_roles).toBe(true)
      // Versión 2: la 1 la publicó la prueba del puntero con una ficha global.
      expect(r.rol).toMatchObject({ clave: 'mano_derecha', por: 'staff', activo: true, version: 2 })
      expect(r.rol!.funciones).toEqual([
        { funcion: 'equipo.gastos_obra', parametros: { rubros: true } },
        { funcion: 'comun.persona', parametros: {} },
        { funcion: 'equipo.facturas', parametros: {} },
      ])
      expect(r.rol!.funciones_apagadas).toEqual(['equipo.gastos'])
    }
  })
  it('persona, luego cargo, luego inbox', async () => {
    expect((await resolver({ colaborador: COLAB, cargo: 'owner', inbox: 'wa:999' })).rol).toMatchObject({ clave: 'recolector', por: 'colaborador' })
    expect((await resolver({ staff: STAFF_SIN_PERFIL, cargo: 'operator', inbox: 'wa:999' })).rol).toMatchObject({ clave: 'recolector', por: 'cargo' })
    expect((await resolver({ cargo: 'supervisor', inbox: 'wa:999' })).rol).toMatchObject({ clave: 'recolector', por: 'inbox' })
  })
  it('solo lo vigente hoy: ni lo vencido ni lo futuro', async () => {
    expect((await resolver({ cargo: 'owner' })).rol).toBeNull()
    expect((await resolver({ cargo: 'admin' })).rol).toBeNull()
  })
  it('solo roles del canal del turno', async () => {
    expect((await resolver({ canal: 'chatwoot', inbox: 'cw:1:7', cargo: 'operator' })).rol).toMatchObject({ clave: 'atencion', por: 'inbox' })
    expect((await resolver({ canal: 'wa_one', inbox: 'cw:1:7' })).rol).toBeNull()
  })
  it('un rol apagado o sin publicar se devuelve igual, sin funciones, y decide el canal', async () => {
    const r = (await resolver({ canal: 'chatwoot', inbox: 'cw:1:7' })).rol!
    expect(r).toMatchObject({ activo: false, reglamento_id: null, version: null, funciones: [], funciones_apagadas: [] })
  })
})

describe('borrar un workspace', () => {
  it('se lleva en cascada roles, versiones, asignaciones y funciones', async () => {
    await db.query('delete from public.workspaces where id = $1', [WS])
    for (const t of ['asistente_roles', 'asistente_asignaciones', 'asistente_funciones_empresa', 'bot_reglamentos']) {
      expect((await uno<{ n: number }>(`select count(*)::int as n from public.${t} where workspace_id = $1`, [WS])).n, t).toBe(0)
    }
  })
})
