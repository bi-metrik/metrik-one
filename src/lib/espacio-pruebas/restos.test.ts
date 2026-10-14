import { describe, expect, it } from 'vitest'

import { ORIGEN, casoDeC0, crearAlmacenDoble } from '../../../test/espacio-pruebas-doble'
import type { Almacen, Fila } from './almacen'
import { COLUMNAS_GENERADAS, crearUsuarios, deshacer, ejecutar, planificar, purgar, sinGeneradas, type OpcionesPlan, type Plan } from './plan'
import { columnaGeneradaDelError, fetchConTiempo } from './red'

/**
 * Lo que mordió en el segundo `--apply` contra producción (2026-10-14):
 *  1. `rubros.valor_total` es una columna GENERADA y la semilla la escribía.
 *  2. El deshacer se quedó minutos sin imprimir nada ni terminar.
 *  3. Quedaron restos (workspace marcado de prueba, 2 perfiles, 2 alias) que la corrida
 *     siguiente tomaba por un espacio terminado.
 */

const CORREO = 'persona@metrik.example'
const DESTINO = { origen: 'trappvel', destino: 'trappvel-pruebas', correoBase: CORREO }
const DUENO = 'persona+trappvel-pruebas-dueno@metrik.example'
const ASESORA = 'persona+trappvel-pruebas-asesora@metrik.example'
const caso = casoDeC0()

function opciones(extra: Partial<OpcionesPlan> = {}): OpcionesPlan {
  let n = 0
  return {
    origen: 'trappvel', destino: 'trappvel-pruebas', nombre: 'Viajes Prueba', correoBase: CORREO, incluirClaves: [],
    hoy: '2026-10-13', nuevoId: () => `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, '0')}`, caso, ...extra,
  }
}

const filasDe = (plan: Plan, tabla: string): Fila[] =>
  plan.pasos.flatMap(p => (p.tipo === 'insertar' && p.tabla === tabla ? p.filas : p.tipo === 'guardar' && p.tabla === tabla ? [p.fila] : []))

const foto = (a: ReturnType<typeof crearAlmacenDoble>) => JSON.stringify(Object.fromEntries(Object.entries(a.estado)))

/** El estado medido en producción tras el cuelgue: workspace marcado, dos perfiles y dos alias. Nada más. */
const RESTOS = 'cccccccc-0000-4000-8000-0000000000aa'
function conRestos() {
  const a = crearAlmacenDoble({
    usuarios: [{ id: 'cccccccc-0000-4000-8000-0000000000d1', correo: DUENO }, { id: 'cccccccc-0000-4000-8000-0000000000d2', correo: ASESORA }],
  })
  const limpio = foto(a)
  a.estado.workspaces.push({
    id: RESTOS, slug: 'trappvel-pruebas', name: 'Viajes Prueba', linea_activa_id: null,
    config_extra: { espacio_de_pruebas: true, clon_de: 'trappvel', grupo: 'demo', cotizacion_por_pasos: { activo: true } },
  })
  for (const u of a.usuarios) {
    a.estado.profiles.push({ id: u.id, workspace_id: RESTOS, home_workspace_id: RESTOS, full_name: 'Alias', role: 'owner', platform_admin: false })
  }
  return { a, limpio }
}

/** Envuelve un almacén para anotar el orden de las llamadas y meterle fallas. */
function espiar(a: Almacen, fallas: Partial<Record<'archivos' | 'borrarUsuario' | 'insertarRubros', () => Promise<never>>> = {}) {
  const orden: string[] = []
  const espia: Almacen = {
    ...a,
    leer: (t, f) => a.leer(t, f),
    contar: (t, f) => a.contar(t, f),
    actualizar: (t, i, p) => a.actualizar(t, i, p),
    guardar: (t, f, c) => a.guardar(t, f, c),
    tablas: () => a.tablas(),
    buscarUsuario: c => a.buscarUsuario(c),
    crearUsuario: (c, n) => a.crearUsuario(c, n),
    borrarArchivos: l => a.borrarArchivos(l),
    async insertar(t, filas) {
      if (t === 'rubros' && fallas.insertarRubros) return fallas.insertarRubros()
      return a.insertar(t, filas)
    },
    async borrar(t, f) {
      const r = await a.borrar(t, f)
      if (t === 'profiles' || t === 'workspaces') orden.push(`${t}${r.error ? ' (error)' : ''}`)
      return r
    },
    async borrarUsuario(id) {
      orden.push('auth')
      if (fallas.borrarUsuario) return fallas.borrarUsuario()
      return a.borrarUsuario(id)
    },
    async archivos(p) {
      orden.push('storage')
      if (fallas.archivos) return fallas.archivos()
      return a.archivos(p)
    },
  }
  return { espia, orden }
}

describe('columnas generadas', () => {
  it('el doble rechaza escribir una columna generada con el mensaje de Postgres', async () => {
    const a = crearAlmacenDoble()
    await expect(a.insertar('rubros', [{ id: 'r1', item_id: null, valor_total: 10 }])).rejects.toThrow('cannot insert a non-DEFAULT value into column "valor_total"')
    await expect(a.insertar('rubros', [{ id: 'r1', item_id: null, valor_total: null }])).rejects.toThrow(/non-DEFAULT value into column "valor_total"/)
    await expect(a.actualizar('rubros', 'r1', { valor_total: 3 })).rejects.toThrow('column "valor_total" can only be updated to DEFAULT')
    expect(a.estado.rubros).toEqual([])
  })

  it('el plan no escribe rubros.valor_total y los rubros entran', async () => {
    const a = crearAlmacenDoble()
    await crearUsuarios(a, CORREO, 'trappvel-pruebas')
    const plan = await planificar(a, opciones())
    const rubros = filasDe(plan, 'rubros')
    expect(rubros.length).toBeGreaterThan(0)
    expect(rubros.some(r => 'valor_total' in r)).toBe(false)
    await ejecutar(a, plan)
    expect(a.estado.rubros.length).toBe(rubros.length)
  })

  it('la lista medida cubre rubros y la limpieza alcanza inserts, upserts y updates', () => {
    expect(COLUMNAS_GENERADAS.rubros).toContain('valor_total')
    const pasos = sinGeneradas([
      { tipo: 'insertar', tabla: 'rubros', filas: [{ id: 'a', valor_total: 1, cantidad: 1 }] },
      { tipo: 'guardar', tabla: 'rubros', fila: { id: 'b', valor_total: 1 } },
      { tipo: 'actualizar', tabla: 'rubros', id: 'c', patch: { valor_total: 1 } },
      { tipo: 'actualizar', tabla: 'rubros', id: 'd', patch: { valor_total: 1, cantidad: 2 } },
    ], COLUMNAS_GENERADAS)
    expect(pasos).toEqual([
      { tipo: 'insertar', tabla: 'rubros', filas: [{ id: 'a', cantidad: 1 }] },
      { tipo: 'guardar', tabla: 'rubros', fila: { id: 'b' } },
      { tipo: 'actualizar', tabla: 'rubros', id: 'd', patch: { cantidad: 2 } },
    ])
  })

  it('suma las que el almacén sepa leer (defensa genérica)', async () => {
    const a = crearAlmacenDoble()
    await crearUsuarios(a, CORREO, 'trappvel-pruebas')
    const plan = await planificar({ ...a, generadas: async () => ({ items: ['cantidad'] }) }, opciones())
    expect(filasDe(plan, 'items').some(i => 'cantidad' in i)).toBe(false)
  })

  it('reconoce la columna en el error de la base (insert y update)', () => {
    expect(columnaGeneradaDelError('cannot insert a non-DEFAULT value into column "valor_total"')).toBe('valor_total')
    expect(columnaGeneradaDelError('column "nivel_riesgo" can only be updated to DEFAULT')).toBe('nivel_riesgo')
    expect(columnaGeneradaDelError('duplicate key value violates unique constraint')).toBeNull()
  })
})

describe('restos de una corrida que falló', () => {
  it('el plan los reconoce (sin la marca clon_completo) y no los toma por un espacio terminado', async () => {
    const { a } = conRestos()
    const plan = await planificar(a, opciones())
    expect(plan.destino.restos).toBe(RESTOS)
    expect(plan.destino.existe).toBe(false)
    expect(plan.destino.id).not.toBe(RESTOS)
    expect(filasDe(plan, 'lineas_negocio').length).toBeGreaterThan(0) // se recopia la configuración
    expect(plan.informe.avisos.join(' ')).toMatch(/restos/)
    await expect(ejecutar(a, plan)).rejects.toThrow(/restos/)
  })

  it('--borrar --apply deja cero restos partiendo del estado medido en producción', async () => {
    const { a, limpio } = conRestos()
    const inf = await purgar(a, DESTINO)
    expect(inf.workspaceBorrado).toBe(true)
    expect(inf.usuariosBorrados).toHaveLength(2)
    expect(inf.pendientes).toEqual([])
    expect(a.usuarios).toEqual([])
    expect(foto(a)).toBe(limpio)
  })

  it('una corrida nueva los purga y crea el espacio completo, sin intervención manual', async () => {
    const { a } = conRestos()
    // Lo que hace el script con --apply.
    const previo = await planificar(a, opciones())
    expect(previo.destino.restos).toBe(RESTOS)
    const inf = await purgar(a, DESTINO)
    expect(inf.pendientes).toEqual([])
    await crearUsuarios(a, CORREO, 'trappvel-pruebas')
    const plan = await planificar(a, opciones())
    expect(plan.destino.restos).toBeNull()
    await ejecutar(a, plan)
    const ws = a.estado.workspaces.find(w => w.slug === 'trappvel-pruebas')!
    expect((ws.config_extra as Record<string, unknown>).clon_completo).toBe(true)
    expect(a.estado.workspaces.some(w => w.id === RESTOS)).toBe(false)
    const otra = await planificar(a, opciones())
    expect(otra.destino.existe).toBe(true)
    expect(otra.pasos).toEqual([])
  })

  it('la marca va en el último paso: una corrida cortada a mitad deja restos reconocibles', async () => {
    const a = crearAlmacenDoble()
    const { espia } = espiar(a, { insertarRubros: () => Promise.reject(new Error('insertar rubros: se cayó la red')) })
    await crearUsuarios(espia, CORREO, 'trappvel-pruebas')
    const plan = await planificar(espia, opciones())
    const ultimo = plan.pasos.at(-1)!
    expect(ultimo.tipo === 'actualizar' && ultimo.tabla === 'workspaces' && (ultimo.patch.config_extra as Record<string, unknown>).clon_completo).toBe(true)
    await expect(ejecutar(espia, plan)).rejects.toThrow(/rubros/)
    const siguiente = await planificar(a, opciones())
    expect(siguiente.destino.restos).toBe(plan.destino.id)
  })

  it('--borrar sin workspace limpia los alias huérfanos y no toca uno parado en otro workspace', async () => {
    const a = crearAlmacenDoble({
      usuarios: [{ id: 'cccccccc-0000-4000-8000-0000000000d1', correo: DUENO }, { id: ORIGEN.perfilAsesora, correo: ASESORA }],
    })
    a.estado.profiles.push({ id: 'cccccccc-0000-4000-8000-0000000000d1', workspace_id: null, full_name: 'Alias huérfano' })
    const inf = await purgar(a, DESTINO)
    expect(inf.usuariosBorrados).toEqual(['cccccccc-0000-4000-8000-0000000000d1'])
    expect(a.estado.profiles.some(p => p.id === 'cccccccc-0000-4000-8000-0000000000d1')).toBe(false)
    expect(a.usuarios.map(u => u.id)).toEqual([ORIGEN.perfilAsesora])
    expect(a.estado.profiles.some(p => p.id === ORIGEN.perfilAsesora)).toBe(true)
    expect(inf.pendientes.join(' ')).toMatch(/otro workspace/)
  })
})

describe('el deshacer siempre termina y dice qué quedó', () => {
  it('borra perfiles, luego el workspace, luego las cuentas de Auth', async () => {
    const { a, limpio } = conRestos()
    const { espia, orden } = espiar(a)
    const inf = await deshacer(espia, DESTINO, [])
    expect(orden).toEqual(['storage', 'profiles', 'profiles', 'workspaces', 'auth', 'auth'])
    expect(inf.pendientes).toEqual([])
    expect(foto(a)).toBe(limpio)
  })

  it('si Storage y Auth fallan, igual borra filas, perfiles y workspace, y lo anota como pendiente', async () => {
    const { a } = conRestos()
    const { espia } = espiar(a, {
      archivos: () => Promise.reject(new Error('Sin respuesta en 30 s: POST /storage/v1/object/list/x')),
      borrarUsuario: () => Promise.reject(new Error('Sin respuesta en 30 s: DELETE /auth/v1/admin/users/x')),
    })
    const inf = await deshacer(espia, DESTINO, [])
    expect(inf.workspaceBorrado).toBe(true)
    expect(a.estado.workspaces.some(w => w.id === RESTOS)).toBe(false)
    expect(a.estado.profiles.some(p => p.workspace_id === RESTOS)).toBe(false)
    expect(inf.usuariosBorrados).toEqual([])
    expect(inf.pendientes).toHaveLength(3) // archivos + 2 cuentas
    expect(inf.pendientes.join('\n')).toMatch(/archivos: Sin respuesta/)
    expect(inf.pendientes.join('\n')).toMatch(/cuenta .* en Auth: Sin respuesta/)
    // La cuenta que quedó es un alias huérfano: la próxima corrida (o --borrar) la limpia.
    const otra = await purgar(a, DESTINO)
    expect(otra.usuariosBorrados).toHaveLength(2)
    expect(a.usuarios).toEqual([])
  })

  it('no lanza aunque la purga se caiga al empezar', async () => {
    const { a } = conRestos()
    const roto: Almacen = { ...a, tablas: () => Promise.reject(new Error('OpenAPI de PostgREST: 503')) }
    const inf = await deshacer(roto, DESTINO, [])
    expect(inf.errores.purgar).toMatch(/503/)
    expect(inf.pendientes.join(' ')).toMatch(/se cortó/)
  })
})

describe('techo por llamada HTTP', () => {
  it('una llamada que nunca responde se vuelve un error con la ruta', async () => {
    const colgada = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, rechazar) => init?.signal?.addEventListener('abort', () => rechazar(init.signal!.reason)))) as typeof fetch
    const f = fetchConTiempo(30, colgada)
    await expect(f('https://doble.example/storage/v1/object/list/b?x=1', { method: 'POST' })).rejects.toThrow('Sin respuesta en 0 s: POST https://doble.example/storage/v1/object/list/b')
  })

  it('respeta la señal de quien llama y deja pasar las respuestas a tiempo', async () => {
    const f = fetchConTiempo(1000, (async () => new Response('ok')) as typeof fetch)
    expect(await (await f('https://doble.example/x')).text()).toBe('ok')
    const propia = new AbortController()
    const g = fetchConTiempo(10_000, ((_: unknown, init?: RequestInit) =>
      new Promise((_r, rechazar) => init?.signal?.addEventListener('abort', () => rechazar(new Error('abortada por quien llama'))))) as typeof fetch)
    const p = g('https://doble.example/y', { signal: propia.signal })
    propia.abort()
    await expect(p).rejects.toThrow('abortada por quien llama')
  })
})
