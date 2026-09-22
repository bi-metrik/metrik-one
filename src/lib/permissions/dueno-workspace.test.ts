import { describe, it, expect } from 'vitest'

import { esDuenoDelWorkspace, leerPlatformAdmin } from './dueno-workspace'

describe('esDuenoDelWorkspace', () => {
  it('el dueño lo es', () => {
    expect(esDuenoDelWorkspace({ role: 'owner', impersonating: false, platformAdmin: false })).toBe(true)
  })

  it.each(['admin', 'supervisor', 'operator', 'read_only', 'contador', null])('%s no lo es', role => {
    expect(esDuenoDelWorkspace({ role, impersonating: false, platformAdmin: false })).toBe(false)
  })

  it('un platform admin de MeTRIK dentro del workspace conserva su rol, y no es el dueño', () => {
    expect(esDuenoDelWorkspace({ role: 'owner', impersonating: false, platformAdmin: true })).toBe(false)
  })

  it('«Ver como» el dueño no es el dueño', () => {
    expect(esDuenoDelWorkspace({ role: 'owner', impersonating: true, platformAdmin: false })).toBe(false)
  })
})

describe('leerPlatformAdmin', () => {
  const servicio = (fila: unknown, error: unknown = null) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fila, error }) }) }) }),
  })

  it('lee la marca de la propia fila', async () => {
    expect(await leerPlatformAdmin(servicio({ platform_admin: false }), 'u')).toBe(false)
    expect(await leerPlatformAdmin(servicio({ platform_admin: true }), 'u')).toBe(true)
  })

  it('si no se puede leer, niega: el lado seguro de un permiso exclusivo', async () => {
    expect(await leerPlatformAdmin(servicio(null, { message: 'x' }), 'u')).toBe(true)
    expect(await leerPlatformAdmin(servicio(null), 'u')).toBe(true)
    expect(await leerPlatformAdmin(servicio({ platform_admin: false }), null)).toBe(true)
  })
})
