import { describe, expect, it } from 'vitest'

import { casoDeC0, crearAlmacenDoble } from '../../../test/espacio-pruebas-doble'
import { buscarIdDeAuthPorCorreo } from './auth'
import { crearUsuarios, planificar } from './plan'

const URL_AUTH = 'https://doble.supabase.example'
const LLAVE = 'llave-de-servicio-del-doble'
const CORREO = 'persona@metrik.example'

type FilaAuth = { id: string; email: string; banned_until?: string }

/** `LIKE` de PostgreSQL: `%` cualquier tramo, `_` un carácter. Sensible a mayúsculas. */
const like = (texto: string, patron: string) =>
  new RegExp(`^${patron.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 's').test(texto)

/**
 * GoTrue de mentira con el defecto de producción: una fila de otro cliente con
 * `banned_until = 'infinity'` que el escáner no sabe leer. Toda consulta que la alcance responde
 * 500 «Database error finding users»; `filter` la deja fuera porque filtra ANTES de escanear.
 * Lee las filas de `filas()` para ver los usuarios que el doble va creando.
 */
function gotrueRoto(filas: () => FilaAuth[]) {
  const llamadas: string[] = []
  const f = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(entrada))
    llamadas.push(u.search)
    const h = new Headers(init?.headers)
    if (u.pathname !== '/auth/v1/admin/users' || h.get('apikey') !== LLAVE) return new Response('{}', { status: 401 })
    const filtro = u.searchParams.get('filter')
    const escaneadas = filtro ? filas().filter(x => like(x.email, `%${filtro}%`)) : filas()
    if (escaneadas.some(x => x.banned_until === 'infinity')) {
      return new Response(JSON.stringify({ code: 500, msg: 'Database error finding users' }), { status: 500 })
    }
    const porPagina = Number(u.searchParams.get('per_page') ?? 50)
    const pagina = Number(u.searchParams.get('page') ?? 1)
    const users = escaneadas.slice((pagina - 1) * porPagina, pagina * porPagina).map(x => ({ id: x.id, email: x.email }))
    return new Response(JSON.stringify({ users, aud: 'authenticated' }), { status: 200 })
  }) as typeof fetch
  return { f, llamadas }
}

const BANEADA: FilaAuth = { id: 'ffffffff-0000-4000-8000-000000000001', email: 'otro.cliente@empresa.example', banned_until: 'infinity' }

describe('buscar un usuario de Auth por correo sin listUsers', () => {
  it('el listado entero está caído (modela producción) y la búsqueda por correo no', async () => {
    const filas = [BANEADA, { id: 'u-1', email: 'persona+trappvel-pruebas-dueno@metrik.example' }]
    const { f } = gotrueRoto(() => filas)
    // Lo que hacía `listUsers`: sin filtro, la fila rota tumba la consulta.
    const r = await f(`${URL_AUTH}/auth/v1/admin/users?page=1&per_page=1000`, { headers: { apikey: LLAVE } })
    expect(r.status).toBe(500)
    expect(await buscarIdDeAuthPorCorreo(URL_AUTH, LLAVE, 'Persona+Trappvel-Pruebas-Dueno@metrik.example', f)).toBe('u-1')
    expect(await buscarIdDeAuthPorCorreo(URL_AUTH, LLAVE, 'nadie@metrik.example', f)).toBeNull()
  })

  it('el LIKE trae parecidos: solo vale el correo exacto', async () => {
    const filas = [
      { id: 'u-largo', email: 'xpersona+a@metrik.example' },
      { id: 'u-comodin', email: 'persona-a@metrik.example' },
    ]
    const { f } = gotrueRoto(() => filas)
    expect(await buscarIdDeAuthPorCorreo(URL_AUTH, LLAVE, 'persona+a@metrik.example', f)).toBeNull()
    expect(await buscarIdDeAuthPorCorreo(URL_AUTH, LLAVE, 'persona_a@metrik.example', f)).toBeNull()
  })

  it('si el endpoint falla, para (no crea a ciegas)', async () => {
    const { f } = gotrueRoto(() => [{ ...BANEADA, email: 'persona@metrik.example' }])
    await expect(buscarIdDeAuthPorCorreo(URL_AUTH, LLAVE, 'persona@metrik.example', f)).rejects.toThrow(/500 .*Database error finding users/)
  })

  it('el clonador sigue sobre el doble con listUsers caído: crea los alias y la segunda corrida los encuentra', async () => {
    const a = crearAlmacenDoble()
    const { f, llamadas } = gotrueRoto(() => [BANEADA, ...a.usuarios.map(u => ({ id: u.id, email: u.correo }))])
    a.buscarUsuario = correo => buscarIdDeAuthPorCorreo(URL_AUTH, LLAVE, correo, f)
    let n = 0
    const opciones = {
      origen: 'trappvel', destino: 'trappvel-pruebas', nombre: 'Viajes Prueba', correoBase: CORREO,
      incluirClaves: [], hoy: '2026-10-13', caso: casoDeC0(),
      nuevoId: () => `bbbbbbbb-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    }

    const simulacro = await planificar(a, opciones)
    expect(simulacro.usuarios.map(u => u.id)).toEqual([null, null])

    const creados = await crearUsuarios(a, CORREO, 'trappvel-pruebas')
    expect(creados).toHaveLength(2)
    expect(await crearUsuarios(a, CORREO, 'trappvel-pruebas')).toEqual([])

    const plan = await planificar(a, opciones)
    expect(plan.usuarios.map(u => u.id)).toEqual(creados)
    // Ninguna llamada fue un listado sin filtro.
    expect(llamadas.length).toBeGreaterThan(0)
    expect(llamadas.every(q => new URLSearchParams(q).get('filter'))).toBe(true)
  })
})
