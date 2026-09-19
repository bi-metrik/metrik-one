import { describe, it, expect, vi } from 'vitest'
import {
  leerPerfilDeAcceso,
  SELECT_PERFIL_BASE,
  SELECT_PERFIL_CON_MODULOS,
  type ClientePerfil,
} from './perfil-de-acceso'

/** Doble del cliente que anota qué se pidió y responde lo que se le diga. */
function cliente(respuesta: { data: unknown; error: { message: string } | null }) {
  const pedido: { tabla?: string; select?: string; eq?: [string, string] } = {}
  const c: ClientePerfil = {
    from(tabla) {
      pedido.tabla = tabla
      return {
        select(columnas) {
          pedido.select = columnas
          return {
            eq(columna, valor) {
              pedido.eq = [columna, valor]
              return { single: async () => respuesta }
            },
          }
        },
      }
    },
  }
  return { c, pedido }
}

describe('leerPerfilDeAcceso', () => {
  it('con módulos pide el perfil con el workspace embebido por la llave correcta y arma el contexto', async () => {
    const { c, pedido } = cliente({
      data: {
        role: 'owner',
        platform_admin: false,
        workspace: { slug: 'soena', modules: { valida_consulta: true }, modo_vitrina: true },
      },
      error: null,
    })
    const perfil = await leerPerfilDeAcceso(c, 'u1', true)
    expect(pedido).toEqual({ tabla: 'profiles', select: SELECT_PERFIL_CON_MODULOS, eq: ['id', 'u1'] })
    expect(SELECT_PERFIL_CON_MODULOS).toContain('workspaces!profiles_workspace_id_fkey')
    expect(perfil).toEqual({
      role: 'owner',
      slugWorkspace: 'soena',
      gate: { role: 'owner', platformAdmin: false, modules: { valida_consulta: true }, modoVitrina: true },
    })
  })

  it('modo vitrina solo con `true` literal, y el platform admin solo con `true`', async () => {
    const { c } = cliente({
      data: { role: 'operator', platform_admin: null, workspace: { modules: null, modo_vitrina: 'true' } },
      error: null,
    })
    const perfil = await leerPerfilDeAcceso(c, 'u1', true)
    expect(perfil.gate).toEqual({ role: 'operator', platformAdmin: false, modules: null, modoVitrina: false })
  })

  it('el platform admin pasa el gate en su propio espacio y no visitando el de un cliente', async () => {
    const enCasa = cliente({
      data: {
        role: 'owner',
        platform_admin: true,
        workspace_id: 'ws-metrik',
        home_workspace_id: 'ws-metrik',
        workspace: { modules: { business: true }, modo_vitrina: null },
      },
      error: null,
    })
    expect((await leerPerfilDeAcceso(enCasa.c, 'u1', true)).gate?.platformAdmin).toBe(true)
    expect(SELECT_PERFIL_CON_MODULOS).toMatch(/\bworkspace_id\b.*\bhome_workspace_id\b/)

    const visitando = cliente({
      data: {
        role: 'owner',
        platform_admin: true,
        workspace_id: 'ws-4dsoft',
        home_workspace_id: 'ws-metrik',
        workspace: { modules: { valida_api: true }, modo_vitrina: null },
      },
      error: null,
    })
    expect((await leerPerfilDeAcceso(visitando.c, 'u1', true)).gate).toEqual({
      role: 'owner',
      platformAdmin: false,
      modules: { valida_api: true },
      modoVitrina: false,
    })
  })

  it('sin módulos pide el rol y el slug del workspace, los dos guards que no miran módulos', async () => {
    const { c, pedido } = cliente({
      data: { role: 'contador', workspace: { slug: 'soena' } },
      error: null,
    })
    expect(await leerPerfilDeAcceso(c, 'u1', false)).toEqual({
      role: 'contador',
      slugWorkspace: 'soena',
      gate: null,
    })
    expect(pedido.select).toBe(SELECT_PERFIL_BASE)
  })

  it('si el embed no trae el workspace, el slug queda en null (el guard no afirma nada)', async () => {
    const { c } = cliente({ data: { role: 'owner', platform_admin: false, workspace: null }, error: null })
    expect((await leerPerfilDeAcceso(c, 'u1', true)).slugWorkspace).toBeNull()
  })

  it('si la lectura falla no hay gate, y se dice en el log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { c } = cliente({ data: null, error: { message: 'Could not embed' } })
    expect(await leerPerfilDeAcceso(c, 'u1', true)).toEqual({
      role: null,
      slugWorkspace: null,
      gate: null,
    })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[gate-modulos]'), 'Could not embed')
    log.mockRestore()
  })
})
