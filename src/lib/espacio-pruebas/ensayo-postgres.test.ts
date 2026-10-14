import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { ORIGEN, casoDeC0, tablasDelDoble } from '../../../test/espacio-pruebas-doble'
import { almacenPglite, filasQueMencionan, levantarBase, sembrarOrigen, type BaseDePrueba, type FuenteEsquema } from '../../../test/espacio-pruebas-pglite'
import type { Almacen } from './almacen'
import { crearUsuarios, deshacer, ejecutar, planificar, purgar, type OpcionesPlan } from './plan'

/**
 * El plan completo del clonador contra POSTGRES (PGlite), no contra el doble: crear, repetir,
 * fallar a mitad y deshacer, restos de una corrida cortada, y borrar. No corre por defecto:
 *
 *   ESPACIO_PRUEBAS_ESQUEMA=/ruta/esquema-produccion.sql npx vitest run src/lib/espacio-pruebas/ensayo-postgres.test.ts
 *     → con el DDL de producción (`scripts/espacio-pruebas-esquema-produccion.sql`). La que vale.
 *   ESPACIO_PRUEBAS_MIGRACIONES=1 npx vitest run src/lib/espacio-pruebas/ensayo-postgres.test.ts
 *     → con las migraciones del repo: esquema APROXIMADO (ver `test/espacio-pruebas-pglite.ts`).
 */

const ESQUEMA = process.env.ESPACIO_PRUEBAS_ESQUEMA
const MIGRACIONES = process.env.ESPACIO_PRUEBAS_MIGRACIONES === '1'
const fuente: FuenteEsquema | null = ESQUEMA
  ? { ddl: readFileSync(ESQUEMA, 'utf8') }
  : MIGRACIONES ? { migraciones: join(process.cwd(), 'supabase/migrations'), tipos: join(process.cwd(), 'src/types/database.ts') } : null

const CORREO = 'persona@metrik.example'
const DESTINO = { origen: 'trappvel', destino: 'trappvel-pruebas', correoBase: CORREO }
const caso = casoDeC0()
const opciones = (): OpcionesPlan => ({
  origen: 'trappvel', destino: 'trappvel-pruebas', nombre: 'Viajes Prueba', correoBase: CORREO, incluirClaves: [],
  hoy: '2026-10-13', nuevoId: () => crypto.randomUUID(), caso,
})

describe.skipIf(!fuente)('el clonador contra Postgres (PGlite)', () => {
  let base: BaseDePrueba
  let a: Almacen
  let ignoradas: Set<string>
  let origenAntes: string

  /** Las filas del workspace de origen, para ver que nada lo toca. */
  const origen = async () => {
    const out: Record<string, number> = {}
    for (const [t, c] of await a.tablas()) if (c.includes('workspace_id')) out[t] = await a.contar(t, [['workspace_id', 'eq', ORIGEN.ws]])
    return JSON.stringify(out)
  }
  const aliasEnAuth = async () => Number((await base.db.query<{ n: number }>(`select count(*)::int n from auth.users where email like '%+trappvel-pruebas-%'`)).rows[0].n)

  /** Lo que hace el script con `--apply`: restos fuera, usuarios, plan, escritura. */
  async function aplicar(alm: Almacen) {
    const previo = await planificar(alm, opciones())
    if (previo.destino.restos) {
      const inf = await purgar(alm, DESTINO)
      expect(inf.pendientes).toEqual([])
    }
    const creados: string[] = []
    try {
      await crearUsuarios(alm, CORREO, 'trappvel-pruebas', creados)
      const plan = await planificar(alm, opciones())
      await ejecutar(alm, plan)
      return plan
    } catch (e) {
      const inf = await deshacer(alm, DESTINO, creados)
      throw Object.assign(new Error((e as Error).message), { inf })
    }
  }

  async function sinRastro(wsId: string) {
    expect(await a.leer('workspaces', [['slug', 'eq', 'trappvel-pruebas']])).toEqual([])
    expect(await filasQueMencionan(base.db, wsId)).toEqual({})
    expect(await aliasEnAuth()).toBe(0)
    expect(await origen()).toBe(origenAntes)
  }

  beforeAll(async () => {
    base = await levantarBase(fuente!)
    // Autoprueba de la consulta del catálogo: vuelca el DDL de ESTA base con el mismo SQL que se
    // corre en producción, para cargarlo luego con ESPACIO_PRUEBAS_ESQUEMA.
    if (process.env.ESPACIO_PRUEBAS_VOLCAR_DDL) {
      const consulta = readFileSync(join(process.cwd(), 'scripts/espacio-pruebas-esquema-produccion.sql'), 'utf8')
      const filas = (await base.db.query<{ ddl: string }>(consulta)).rows
      writeFileSync(process.env.ESPACIO_PRUEBAS_VOLCAR_DDL, filas.map(f => f.ddl).join('\n'))
    }
    const { saltadas } = await sembrarOrigen(base.db, tablasDelDoble(), [
      { id: ORIGEN.perfilDueno, correo: 'dueno@inventado.example' },
      { id: ORIGEN.perfilAsesora, correo: 'asesora@inventado.example' },
    ])
    const p = await almacenPglite(base.db, { tolerarColumnas: !ESQUEMA })
    a = p.almacen
    ignoradas = p.ignoradas
    origenAntes = await origen()
    console.log(`[ensayo] esquema: ${ESQUEMA ? `DDL ${ESQUEMA}` : 'migraciones del repo (APROXIMADO)'} · migraciones que no corrieron: ${base.fallas.length} · tablas del doble que la base no tiene: ${saltadas.join(', ') || '(ninguna)'}`)
  }, 300_000)

  it('crea el espacio completo, la segunda corrida no escribe nada, y --borrar no deja rastro', async () => {
    const plan = await aplicar(a)
    console.log(`[ensayo] avisos del plan: ${plan.informe.avisos.join(' | ') || '(ninguno)'}`)
    console.log(`[ensayo] escrito: ${plan.pasos.map(p => `${p.tipo} ${p.tabla}${p.tipo === 'insertar' ? `×${p.filas.length}` : ''}`).join(', ')}`)
    const [ws] = await a.leer('workspaces', [['slug', 'eq', 'trappvel-pruebas']])
    expect((ws.config_extra as Record<string, unknown>).clon_completo).toBe(true)
    expect(ws.linea_activa_id).toBeTruthy()
    expect(await a.contar('rubros', [['item_id', 'in', (await a.leer('items', [['cotizacion_id', 'in', (await a.leer('cotizaciones', [['workspace_id', 'eq', plan.destino.id]])).map(c => c.id)]])).map(i => i.id)]])).toBeGreaterThan(0)
    const segunda = await planificar(a, opciones())
    expect(segunda.destino.existe).toBe(true)
    expect(segunda.pasos).toEqual([])

    const inf = await purgar(a, DESTINO)
    expect(inf.pendientes).toEqual([])
    expect(inf.residuo).toEqual({})
    await sinRastro(plan.destino.id)
    if (ignoradas.size) console.log(`[ensayo] columnas que la base aproximada no tiene (ignoradas): ${[...ignoradas].join(', ')}`)
  }, 120_000)

  it('si falla a mitad (en los rubros), el deshacer termina y no deja nada', async () => {
    const roto: Almacen = { ...a, insertar: (t, f) => (t === 'rubros' ? Promise.reject(new Error('insertar rubros: corte simulado')) : a.insertar(t, f)) }
    const err = await aplicar(roto).then(() => null, (e: unknown) => e as Error & { inf: { pendientes: string[]; workspaceBorrado: boolean } })
    expect(err).toBeInstanceOf(Error)
    if (!err) return
    expect(err.message).toMatch(/corte simulado/)
    expect(err.inf.pendientes).toEqual([])
    expect(err.inf.workspaceBorrado).toBe(true)
    expect(await a.leer('workspaces', [['slug', 'eq', 'trappvel-pruebas']])).toEqual([])
    expect(await aliasEnAuth()).toBe(0)
    expect(await origen()).toBe(origenAntes)
  }, 120_000)

  it('desde los restos medidos en producción: la corrida nueva los purga y crea; --borrar deja cero', async () => {
    // Workspace marcado sin terminar, 2 perfiles y 2 alias. Nada más.
    const [restos] = (await base.db.query<{ id: string }>(`insert into public.workspaces (slug, name, config_extra)
      values ('trappvel-pruebas', 'Viajes Prueba', '{"espacio_de_pruebas": true, "clon_de": "trappvel", "grupo": "demo", "cotizacion_por_pasos": {"activo": true}}')
      returning id::text id`)).rows
    for (const sufijo of ['dueno', 'asesora']) {
      const [u] = (await base.db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id::text id`, [`persona+trappvel-pruebas-${sufijo}@metrik.example`])).rows
      await a.guardar('profiles', { id: u.id, workspace_id: restos.id, home_workspace_id: restos.id, full_name: 'Alias', role: sufijo === 'dueno' ? 'owner' : 'operator', platform_admin: false })
    }
    const previo = await planificar(a, opciones())
    expect(previo.destino.restos).toBe(restos.id)

    const plan = await aplicar(a)
    expect(plan.destino.id).not.toBe(restos.id)
    expect(await filasQueMencionan(base.db, restos.id)).toEqual({})

    const inf = await purgar(a, DESTINO)
    expect(inf.pendientes).toEqual([])
    await sinRastro(plan.destino.id)
  }, 120_000)
})
