import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Resolucion, RolResuelto } from './agente/roles'
import type { Dominio } from './agente/tipos'

/**
 * El atajo al bot anterior (Mauricio, 2026-10-30, «cierra el atajo»): con roles del asistente en `wa_one`, una asesora
 * que escribía «gasto …» o «bot …» caía al bot anterior, que la atiende por su CARGO (`operator`: gastos y actividades),
 * no por su rol (solo viajes). Con un rol activo, esos prefijos los atiende el agente con ese rol; sin roles, igual que
 * antes. Se prueba `atenderConAgente` con el turno por rol real (componedor + fichas de Trappvel) y la base, la cola y
 * el WhatsApp de mentira: devolver `false` es justo lo que deja seguir al webhook hacia la bandeja y el bot anterior.
 */

const estado = vi.hoisted(() => ({
  resolucion: null as unknown,
  haiku: true,
  atendidos: [] as Array<{ dominio: unknown; rol: unknown }>,
  enviados: [] as Array<{ phone: string; texto: string }>,
}))

vi.mock('./supabase-client.ts', () => ({ getServiceClient: () => { throw new Error('no se usa') } }))
vi.mock('./agente/roles.ts', async (original) => ({
  ...(await original<typeof import('./agente/roles')>()),
  resolverRol: async () => estado.resolucion,
}))
vi.mock('./llm-anthropic.ts', async (original) => ({
  ...(await original<typeof import('./llm-anthropic')>()),
  haikuActivo: () => estado.haiku,
}))
vi.mock('./agente/cola.ts', () => ({
  atenderPendientes: async (d: { dominio: unknown; rol: unknown }) => { estado.atendidos.push({ dominio: d.dominio, rol: d.rol }); return 1 },
}))
vi.mock('./wa-bandeja.ts', async () => {
  const { CONFIG_BANDEJA_POR_DEFECTO } = await import('./wa-bandeja-reglas')
  return { staffIdDelRemitente: async () => null, configDelWorkspace: async () => CONFIG_BANDEJA_POR_DEFECTO }
})
vi.mock('./agente/produccion.ts', async () => {
  const { reglamentoDePrueba } = await import('./agente/escenario')
  const { fichasDelRol } = await import('./agente/bandeja/roles-trappvel')
  const { PuertoMemoria } = await import('./agente/memoria')
  return {
    cargarReglamento: async (_s: unknown, _w: string, bot: string) =>
      bot.startsWith('rol:') ? await reglamentoDePrueba(fichasDelRol(bot.slice(4) as 'mano_derecha')) : null,
    puertoBandejaSupabase: () => new PuertoMemoria({}),
    mensajeroWa: () => ({ enviar: async (phone: string, s: { texto: string }) => { estado.enviados.push({ phone, texto: s.texto }) } }),
    almacenSupabase: () => ({}),
    cupoSupabase: () => ({}),
    alertarCaidaWa: async () => {},
  }
})

type Mod = typeof import('./wa-agente')
let mod: Mod
let FUNCIONES_ROL: typeof import('./agente/bandeja/roles-trappvel').FUNCIONES_ROL
let RF_ROL_NO_LEIDO: string

beforeAll(async () => {
  ;(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => undefined } }
  mod = await import('./wa-agente.ts')
  FUNCIONES_ROL = (await import('./agente/bandeja/roles-trappvel')).FUNCIONES_ROL
  RF_ROL_NO_LEIDO = (await import('./agente/one/turno-con-rol')).RF_ROL_NO_LEIDO
})

beforeEach(() => {
  estado.haiku = true
  estado.atendidos = []
  estado.enviados = []
})

const conRol = (clave: 'mano_derecha' | 'asesor_viajes'): Resolucion => ({
  tipo: 'rol',
  rol: {
    id: `rol-${clave}`, clave, familia: 'equipo', canal: 'wa_one', activo: true, reglamento_id: `reg-${clave}`, version: 1, por: 'staff',
    asignacion_id: 'a-1', funciones: FUNCIONES_ROL[clave].map((funcion) => ({ funcion, parametros: {} })), funciones_apagadas: [],
  } as RolResuelto,
})

// Un workspace con el agente de la bandeja (como Trappvel) y la bandeja encendida; quien escribe es `operator`.
const usuario = {
  workspace_id: 'w', phone: '573001112233', name: 'Asesora', role: 'operator' as const, subscription_status: 'trial', staff_id: 's-1',
  modulos: { modules: { bandeja_solicitudes_wa: true }, bot_conversacional: { agente: true } },
}
const escrito = (text: string) => ({ phone: '573001112233', text, type: 'text' as const, timestamp: '1', wa_message_id: 'm1' })

// Una base que contesta vacío a todo (el nombre del workspace, el rol previo de la conversación).
function base() {
  const q: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'gte', 'not', 'order', 'limit', 'is', 'update']) q[k] = () => q
  q.maybeSingle = async () => ({ data: { name: 'Agencia', slug: 'agencia' }, error: null })
  q.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
  return { from: () => q } as never
}

const acciones = (d: unknown) => (d as Dominio).acciones

describe('con un rol activo, «gasto …» y «bot …» no caen al bot anterior', () => {
  it('asesora con «gasto 50000 taxi»: la atiende el agente con su rol, sin la acción gasto', async () => {
    estado.resolucion = conRol('asesor_viajes')
    expect(await mod.atenderConAgente(base(), usuario, escrito('gasto 50000 taxi'))).toBe(true)
    expect(estado.atendidos).toHaveLength(1)
    expect(estado.atendidos[0].rol).toMatchObject({ clave: 'asesor_viajes' })
    expect(acciones(estado.atendidos[0].dominio)).not.toContain('gasto')
    expect(acciones(estado.atendidos[0].dominio)).not.toContain('actividad')
  })

  it('asesora con «bot …»: también el agente con su rol', async () => {
    estado.resolucion = conRol('asesor_viajes')
    for (const texto of ['bot cuánto vendimos en septiembre', 'Bot: registra una actividad']) {
      estado.atendidos = []
      expect(await mod.atenderConAgente(base(), usuario, escrito(texto))).toBe(true)
      expect(estado.atendidos[0].rol).toMatchObject({ clave: 'asesor_viajes' })
    }
  })

  it('mano derecha con «gasto …»: la atiende el agente con equipo.gastos', async () => {
    estado.resolucion = conRol('mano_derecha')
    expect(await mod.atenderConAgente(base(), { ...usuario, name: 'Edgar' }, escrito('gasto 50000 taxi'))).toBe(true)
    expect(estado.atendidos[0].rol).toMatchObject({ clave: 'mano_derecha' })
    expect(acciones(estado.atendidos[0].dominio)).toContain('gasto')
  })

  it('sin modelo: el prefijo del bot recibe la respuesta fija (no el bot anterior); lo demás sigue el camino de hoy', async () => {
    estado.haiku = false
    estado.resolucion = conRol('asesor_viajes')
    expect(await mod.atenderConAgente(base(), usuario, escrito('gasto 50000 taxi'))).toBe(true)
    expect(estado.enviados).toEqual([{ phone: '573001112233', texto: RF_ROL_NO_LEIDO }])
    expect(estado.atendidos).toEqual([])
    estado.enviados = []
    expect(await mod.atenderConAgente(base(), usuario, escrito('abre un viaje para Carolina'))).toBe(false)
    expect(estado.enviados).toEqual([])
  })
})

describe('sin roles: igual que antes', () => {
  it('workspace sin roles: «gasto …» sigue al bot de gastos de siempre; lo demás, al agente de hoy', async () => {
    estado.resolucion = { tipo: 'hoy', motivo: 'el workspace no usa roles en este canal' }
    expect(await mod.atenderConAgente(base(), usuario, escrito('gasto 50000 taxi'))).toBe(false)
    expect(estado.atendidos).toEqual([])
    // Sin reglamento publicado de la bandeja (la base de mentira no lo trae): el camino de hoy también suelta lo demás.
    const espia = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await mod.atenderConAgente(base(), usuario, escrito('bot cuánto vendimos'))).toBe(false)
    espia.mockRestore()
  })

  it('un teléfono fuera de `agente_telefonos`: ni resuelve el rol', async () => {
    estado.resolucion = conRol('asesor_viajes')
    const fuera = { ...usuario, modulos: { ...usuario.modulos, bot_conversacional: { agente: true, agente_telefonos: ['573209219444'] } } }
    expect(await mod.atenderConAgente(base(), fuera, escrito('gasto 50000 taxi'))).toBe(false)
    expect(estado.atendidos).toEqual([])
  })
})
