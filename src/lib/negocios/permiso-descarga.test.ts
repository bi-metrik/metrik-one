import { describe, expect, it, vi } from 'vitest'
import {
  CLAVE_ROLES_DESCARGA_NEGOCIOS_EXTRA,
  puedeDescargarNegocios,
  rolesDescargaNegocios,
} from '@/lib/roles'
import { puedeDescargarNegociosDelWorkspace } from './permiso-descarga'

// SOE-028: un operator de SOENA tiene que poder bajarse el Excel de Negocios, sin que
// eso cambie el default de ningún otro workspace.

describe('puedeDescargarNegocios (regla pura)', () => {
  it('la clave es la que se documenta para poner en base', () => {
    expect(CLAVE_ROLES_DESCARGA_NEGOCIOS_EXTRA).toBe('roles_descarga_negocios_extra')
  })

  it('sin config: owner, admin y supervisor; nadie más', () => {
    for (const r of ['owner', 'admin', 'supervisor']) expect(puedeDescargarNegocios(r)).toBe(true)
    for (const r of ['operator', 'read_only', 'contador', '', null, undefined]) {
      expect(puedeDescargarNegocios(r)).toBe(false)
    }
    expect(rolesDescargaNegocios(null)).toEqual(['owner', 'admin', 'supervisor'])
    expect(rolesDescargaNegocios({})).toEqual(['owner', 'admin', 'supervisor'])
  })

  it('con la clave, el workspace SUMA operator al default', () => {
    const cfg = { otra_cosa: 1, roles_descarga_negocios_extra: ['operator'] }
    expect(puedeDescargarNegocios('operator', cfg)).toBe(true)
    for (const r of ['owner', 'admin', 'supervisor']) expect(puedeDescargarNegocios(r, cfg)).toBe(true)
    expect(puedeDescargarNegocios('read_only', cfg)).toBe(false)
    expect(puedeDescargarNegocios('contador', cfg)).toBe(false)
  })

  it('la config no puede quitar roles ni colar valores raros', () => {
    expect(rolesDescargaNegocios({ roles_descarga_negocios_extra: [] })).toEqual([
      'owner',
      'admin',
      'supervisor',
    ])
    // un string suelto, un objeto, un rol inventado y un no-string se ignoran
    for (const extra of ['operator', { operator: true }, ['superadmin', 7, null], ['__proto__']]) {
      const cfg = { roles_descarga_negocios_extra: extra }
      expect(puedeDescargarNegocios('operator', cfg)).toBe(false)
      expect(rolesDescargaNegocios(cfg)).toEqual(['owner', 'admin', 'supervisor'])
    }
    // repetidos no duplican
    expect(
      rolesDescargaNegocios({ roles_descarga_negocios_extra: ['operator', 'operator', 'admin'] }),
    ).toEqual(['owner', 'admin', 'supervisor', 'operator'])
  })
})

/** Cliente mínimo: `from('workspaces').select().eq().maybeSingle()`. */
function clienteCon(respuesta: { data?: unknown; error?: { message: string } | null } | Error) {
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (respuesta instanceof Error) throw respuesta
          return { data: respuesta.data ?? null, error: respuesta.error ?? null }
        },
      }),
    }),
  }))
  return { from }
}

const WS = '11111111-2222-4333-8444-555555555555'

describe('puedeDescargarNegociosDelWorkspace (lee la config)', () => {
  it('el default pasa sin leer la base', async () => {
    const sb = clienteCon({ data: null })
    expect(await puedeDescargarNegociosDelWorkspace(sb, WS, 'supervisor')).toBe(true)
    expect(sb.from).not.toHaveBeenCalled()
  })

  it('operator pasa solo si su workspace lo suma', async () => {
    const soena = clienteCon({ data: { config_extra: { roles_descarga_negocios_extra: ['operator'] } } })
    expect(await puedeDescargarNegociosDelWorkspace(soena, WS, 'operator')).toBe(true)
    expect(soena.from).toHaveBeenCalledWith('workspaces')

    const otro = clienteCon({ data: { config_extra: { modo_vitrina: false } } })
    expect(await puedeDescargarNegociosDelWorkspace(otro, WS, 'operator')).toBe(false)

    const sinConfig = clienteCon({ data: { config_extra: null } })
    expect(await puedeDescargarNegociosDelWorkspace(sinConfig, WS, 'operator')).toBe(false)
  })

  it('un error de lectura nunca abre el permiso', async () => {
    const conError = clienteCon({ error: { message: 'boom' } })
    expect(await puedeDescargarNegociosDelWorkspace(conError, WS, 'operator')).toBe(false)
    const lanza = clienteCon(new Error('red'))
    expect(await puedeDescargarNegociosDelWorkspace(lanza, WS, 'operator')).toBe(false)
    vi.restoreAllMocks()
  })

  it('sin workspace o sin rol, no', async () => {
    const sb = clienteCon({ data: { config_extra: { roles_descarga_negocios_extra: ['operator'] } } })
    expect(await puedeDescargarNegociosDelWorkspace(sb, null, 'operator')).toBe(false)
    expect(await puedeDescargarNegociosDelWorkspace(sb, WS, null)).toBe(false)
    expect(sb.from).not.toHaveBeenCalled()
  })
})
