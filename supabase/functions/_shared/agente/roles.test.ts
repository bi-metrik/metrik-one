import { beforeEach, describe, expect, it } from 'vitest'
import { resolverRol, resolucionDe, rolFijo, rolPrevio, usaRolesConocido } from './roles'
import type { ClienteRpc, RolResuelto } from './roles'
import { turnoOne, RF_ROL_NO_LEIDO, RF_SIN_ROL } from './one/turno-con-rol'
import type { PuertosTurnoOne } from './one/turno-con-rol'
import { dominioOne } from './one/dominio'
import { PuertoOneMemoria } from './one/puerto-memoria'
import { reglamentoOne } from './one/reglamento'
import { MOTIVO_SIN_BANCO, turnoPublico } from './publico/turno-con-rol'
import { reglamentoSabor } from './publico/escenario'
import type { Reglamento, RolTraza } from './tipos'

/**
 * La resolución del rol en los dos canales (spec 2026-10-26, §2.5): lo que devuelve la RPC, el orden contrario (la RPC
 * todavía no existe en producción), el rol fijo de la conversación y qué hace cada canal. Sin base: un doble del RPC.
 */

const WS = '00000000-0000-4000-8000-0000000000c1'
const rpc = (r: { data?: unknown; error?: { code?: string; message?: string } | null } | (() => never)): ClienteRpc & { llamados: Array<Record<string, unknown>> } => {
  const llamados: Array<Record<string, unknown>> = []
  return {
    llamados,
    rpc(_n, args) {
      llamados.push(args)
      if (typeof r === 'function') return r()
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
    },
  }
}

const ROL: RolResuelto = {
  id: 'rol-1', clave: 'mano_derecha', familia: 'equipo', canal: 'wa_one', activo: true, reglamento_id: 'reg-2', version: 2, por: 'staff',
  asignacion_id: 'asig-1', funciones: [{ funcion: 'equipo.gastos', parametros: {} }, { funcion: 'equipo.consulta_negocio', parametros: {} }], funciones_apagadas: [],
}

beforeEach(() => usaRolesConocido.clear())

describe('resolverRol: lo que devuelve la RPC', () => {
  it('pasa los parámetros con sus nombres y el canal', async () => {
    const c = rpc({ data: { usa_roles: false, rol: null } })
    await resolverRol(c, { workspaceId: WS, canal: 'wa_one', staff: 's-1', cargo: 'operator', inbox: 'wa:123' })
    expect(c.llamados).toEqual([{ p_workspace_id: WS, p_canal: 'wa_one', p_staff: 's-1', p_colaborador: null, p_cargo: 'operator', p_inbox: 'wa:123' }])
  })
  it('usa_roles false → hoy; con rol activo → rol; sin rol, apagado o sin publicar → parar', () => {
    expect(resolucionDe({ usa_roles: false, rol: null }).tipo).toBe('hoy')
    expect(resolucionDe(null).tipo).toBe('hoy')
    expect(resolucionDe({ usa_roles: true, rol: ROL })).toEqual({ tipo: 'rol', rol: ROL })
    expect(resolucionDe({ usa_roles: true, rol: null })).toEqual({ tipo: 'parar', motivo: 'sin_rol' })
    expect(resolucionDe({ usa_roles: true, rol: { ...ROL, activo: false } })).toMatchObject({ tipo: 'parar', motivo: 'rol_apagado' })
    expect(resolucionDe({ usa_roles: true, rol: { ...ROL, reglamento_id: null } })).toMatchObject({ tipo: 'parar', motivo: 'sin_publicar' })
  })
})

describe('aguanta el orden contrario: la migración todavía no está en producción', () => {
  for (const code of ['PGRST202', '42883', '42P01', 'PGRST205']) {
    it(`${code} → el camino de hoy, sin tumbar a nadie`, async () => {
      const r = await resolverRol(rpc({ error: { code, message: 'no existe' } }), { workspaceId: WS, canal: 'wa_one' }, { log: () => {} })
      expect(r.tipo).toBe('hoy')
    })
  }
  it('otro error en un workspace del que no se sabe si usa roles → el camino de hoy', async () => {
    const r = await resolverRol(rpc({ error: { code: '57014', message: 'timeout' } }), { workspaceId: WS, canal: 'wa_one' }, { log: () => {} })
    expect(r.tipo).toBe('hoy')
  })
  it('otro error (o una excepción) en un workspace que se sabe que usa roles → parar, nunca el dominio completo', async () => {
    await resolverRol(rpc({ data: { usa_roles: true, rol: ROL } }), { workspaceId: WS, canal: 'wa_one' }, { ahora: 1000 })
    expect(await resolverRol(rpc({ error: { code: '57014', message: 'timeout' } }), { workspaceId: WS, canal: 'wa_one' }, { ahora: 2000, log: () => {} }))
      .toEqual({ tipo: 'parar', motivo: 'lectura_fallo' })
    expect(await resolverRol(rpc(() => { throw new Error('red') }), { workspaceId: WS, canal: 'wa_one' }, { ahora: 3000, log: () => {} }))
      .toEqual({ tipo: 'parar', motivo: 'lectura_fallo' })
    // En otro canal del mismo workspace no se sabe: el camino de hoy.
    expect((await resolverRol(rpc({ error: { code: '57014' } }), { workspaceId: WS, canal: 'chatwoot' }, { ahora: 3000, log: () => {} })).tipo).toBe('hoy')
  })
})

describe('el rol se fija al empezar la conversación', () => {
  const previo: RolTraza = { clave: 'mano_derecha', id: 'rol-1', version: 1, reglamento_id: 'reg-1', por: 'staff', funciones: [{ funcion: 'equipo.gastos', parametros: {} }, { funcion: 'equipo.consulta_negocio', parametros: {} }, { funcion: 'equipo.contactos', parametros: {} }] }
  it('mismo rol: sigue con la versión y las funciones con que empezó', () => {
    expect(rolFijo(ROL, previo)).toMatchObject({ reglamento_id: 'reg-1', version: 1, funciones: previo.funciones })
  })
  it('si la empresa apagó una función, se quita (el interruptor manda); agregar no se agrega a mitad', () => {
    expect(rolFijo({ ...ROL, funciones_apagadas: ['equipo.contactos'] }, previo).funciones.map((f) => f.funcion)).toEqual(['equipo.gastos', 'equipo.consulta_negocio'])
  })
  it('otro rol (la asignación cambió) o un cargo de hoy: manda el de ahora', () => {
    expect(rolFijo(ROL, { ...previo, clave: 'recolector' })).toBe(ROL)
    expect(rolFijo(ROL, { ...previo, clave: 'cargo:owner', reglamento_id: null })).toBe(ROL)
    expect(rolFijo(ROL, null)).toBe(ROL)
  })
  it('rolPrevio toma el más reciente de la conversación', () => {
    expect(rolPrevio([{ traza: { rol: previo } }, { traza: null }, { traza: { rol: { ...previo, version: 9 } } }, {}])?.version).toBe(9)
    expect(rolPrevio([{ traza: null }])).toBeNull()
  })
})

describe('wa_one: qué atiende el turno', () => {
  const puertos = async (r: Awaited<ReturnType<PuertosTurnoOne['resolver']>>, o: { reglamentoRol?: Reglamento | null; previo?: RolTraza | null } = {}): Promise<PuertosTurnoOne & { motores: string[][] }> => {
    const motores: string[][] = []
    const hoy = await reglamentoOne('Empresa de Prueba')
    return {
      motores,
      resolver: async () => r,
      rolPrevio: async () => o.previo ?? null,
      reglamentoDelRol: async () => (o.reglamentoRol === undefined ? { ...hoy, id: 'reg-2', version: 2 } : o.reglamentoRol),
      reglamentoDeHoy: async () => hoy,
      motor: (f) => { motores.push(f); return dominioOne(new PuertoOneMemoria(), { rol: 'operator', funciones: f }) },
      log: () => {},
    }
  }
  it('sin roles: el dominio del cargo y el reglamento de hoy; la traza dice cargo', async () => {
    const t = await turnoOne('operator', await puertos({ tipo: 'hoy', motivo: 'x' }))
    expect(t.tipo).toBe('atender')
    if (t.tipo !== 'atender') return
    expect(t.via).toBe('cargo')
    expect(t.rol.clave).toBe('cargo:operator')
    expect(t.composicion.declaradas.acciones).toEqual(['gasto', 'adjuntar_soporte', 'corregir_gasto', 'actividad'])
  })
  it('con rol: sus funciones (no las del cargo) y la versión del rol; la traza trae clave y versión', async () => {
    const p = await puertos({ tipo: 'rol', rol: ROL })
    const t = await turnoOne('owner', p)
    if (t.tipo !== 'atender') throw new Error('no atendió')
    expect(t.via).toBe('rol')
    expect(p.motores).toEqual([['equipo.gastos', 'equipo.consulta_negocio']])
    expect(t.composicion.declaradas.acciones).toEqual(['gasto', 'adjuntar_soporte', 'corregir_gasto'])
    expect(t.reglamento.id).toBe('reg-2')
    expect(t.rol).toMatchObject({ clave: 'mano_derecha', version: 2, reglamento_id: 'reg-2', por: 'staff' })
  })
  it('parar: respuesta fija, sin dominio', async () => {
    expect(await turnoOne('owner', await puertos({ tipo: 'parar', motivo: 'sin_rol' }))).toEqual({ tipo: 'parar', texto: RF_SIN_ROL, motivo: 'sin_rol' })
    expect(await turnoOne('owner', await puertos({ tipo: 'parar', motivo: 'lectura_fallo' }))).toMatchObject({ texto: RF_ROL_NO_LEIDO })
    expect(await turnoOne('owner', await puertos({ tipo: 'rol', rol: ROL }, { reglamentoRol: null }))).toMatchObject({ tipo: 'parar', motivo: 'reglamento_del_rol_no_leido' })
  })
})

describe('chatwoot: qué atiende el turno (por inbox)', () => {
  const sabor = reglamentoSabor()
  it('sin roles: el reglamento de siempre y el dominio público entero (sin funciones)', async () => {
    const t = await turnoPublico({ resolver: async () => ({ tipo: 'hoy', motivo: 'x' }), reglamentoDelRol: async () => null, reglamentoDeHoy: async () => await sabor })
    expect(t).toEqual({ tipo: 'atender', reglamento: await sabor })
  })
  it('con rol: la versión del rol y sus funciones', async () => {
    const rol: RolResuelto = { ...ROL, clave: 'asesor_vendedor', familia: 'clientes', canal: 'chatwoot', por: 'inbox', funciones: [{ funcion: 'clientes.ficha', parametros: {} }] }
    const t = await turnoPublico({ resolver: async () => ({ tipo: 'rol', rol }), reglamentoDelRol: async () => ({ ...(await sabor), id: 'reg-2' }), reglamentoDeHoy: async () => null })
    expect(t).toMatchObject({ tipo: 'atender', funciones: rol.funciones, rol: { clave: 'asesor_vendedor', por: 'inbox' } })
  })
  it('sin rol activo para el inbox: pasa a una persona (el respaldo de Sabor); sin reglamento de hoy: no contesta', async () => {
    expect(await turnoPublico({ resolver: async () => ({ tipo: 'parar', motivo: 'rol_apagado' }), reglamentoDelRol: async () => null, reglamentoDeHoy: async () => null }))
      .toEqual({ tipo: 'persona', motivo: 'rol_apagado' })
    expect((await turnoPublico({ resolver: async () => ({ tipo: 'hoy', motivo: 'x' }), reglamentoDelRol: async () => null, reglamentoDeHoy: async () => null })).tipo).toBe('nada')
  })
  it('la versión vigente sin banco (encargo 2026-10-30): pasa a una persona, con rol o sin él; con banco atiende', async () => {
    const r = await sabor
    const sinBanco: Reglamento = { ...r, bancoValido: false }
    expect(await turnoPublico({ resolver: async () => ({ tipo: 'hoy', motivo: 'x' }), reglamentoDelRol: async () => null, reglamentoDeHoy: async () => sinBanco }))
      .toEqual({ tipo: 'persona', motivo: MOTIVO_SIN_BANCO })
    const rol: RolResuelto = { ...ROL, clave: 'asesor_vendedor', familia: 'clientes', canal: 'chatwoot', por: 'inbox' }
    expect(await turnoPublico({ resolver: async () => ({ tipo: 'rol', rol }), reglamentoDelRol: async () => sinBanco, reglamentoDeHoy: async () => null }))
      .toEqual({ tipo: 'persona', motivo: MOTIVO_SIN_BANCO })
    expect((await turnoPublico({ resolver: async () => ({ tipo: 'hoy', motivo: 'x' }), reglamentoDelRol: async () => null, reglamentoDeHoy: async () => ({ ...r, bancoValido: true }) })).tipo)
      .toBe('atender')
  })
})
