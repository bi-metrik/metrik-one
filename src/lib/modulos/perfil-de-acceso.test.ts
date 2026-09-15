import { describe, it, expect, vi } from 'vitest'
import { leerPerfilDeAcceso, SELECT_PERFIL_CON_MODULOS, type ClientePerfil } from './perfil-de-acceso'

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
      data: { role: 'owner', platform_admin: false, workspace: { modules: { valida_consulta: true }, modo_vitrina: true } },
      error: null,
    })
    const perfil = await leerPerfilDeAcceso(c, 'u1', true)
    expect(pedido).toEqual({ tabla: 'profiles', select: SELECT_PERFIL_CON_MODULOS, eq: ['id', 'u1'] })
    expect(SELECT_PERFIL_CON_MODULOS).toContain('workspaces!profiles_workspace_id_fkey')
    expect(perfil).toEqual({
      role: 'owner',
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

  it('sin módulos pide solo el rol, como el guard del contador de antes', async () => {
    const { c, pedido } = cliente({ data: { role: 'contador' }, error: null })
    expect(await leerPerfilDeAcceso(c, 'u1', false)).toEqual({ role: 'contador', gate: null })
    expect(pedido.select).toBe('role')
  })

  it('si la lectura falla no hay gate, y se dice en el log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { c } = cliente({ data: null, error: { message: 'Could not embed' } })
    expect(await leerPerfilDeAcceso(c, 'u1', true)).toEqual({ role: null, gate: null })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[gate-modulos]'), 'Could not embed')
    log.mockRestore()
  })
})
