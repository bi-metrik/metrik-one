import { describe, it, expect } from 'vitest'
import { rolPlataformaParaAutocrear } from './rol-plataforma-autocreado'

/** `staff_rol_plataforma_check` en produccion. */
const VALIDOS = ['dueno', 'administrador', 'supervisor', 'ejecutor', 'contador', 'campo']

/** El CASE de `fn_sync_staff_role_to_profile` (staff.rol_plataforma → profiles.role). */
const ESPEJO: Record<string, string> = {
  dueno: 'owner',
  administrador: 'admin',
  supervisor: 'supervisor',
  ejecutor: 'operator',
  campo: 'read_only',
}

describe('rolPlataformaParaAutocrear', () => {
  it('operator → ejecutor (antes "operativo", que el CHECK rechaza con 23514)', () => {
    expect(rolPlataformaParaAutocrear('operator')).toBe('ejecutor')
  })

  it('read_only → campo: el unico valor que el trigger devuelve a read_only', () => {
    expect(rolPlataformaParaAutocrear('read_only')).toBe('campo')
  })

  it('contador no se autocrea: el trigger no lo espeja y dejaria profiles.role en NULL', () => {
    expect(rolPlataformaParaAutocrear('contador')).toBeNull()
  })

  it('un rol desconocido no cae en dueno (el trigger lo volveria owner)', () => {
    expect(rolPlataformaParaAutocrear('cualquiera')).toBeNull()
  })

  it('sin rol en el perfil conserva el comportamiento de siempre: dueno', () => {
    expect(rolPlataformaParaAutocrear(null)).toBe('dueno')
  })

  it.each(['owner', 'admin', 'supervisor', 'operator', 'read_only', 'contador'])(
    '%s: lo que se escribe pasa el CHECK y el trigger lo devuelve al mismo rol',
    (role) => {
      const rol = rolPlataformaParaAutocrear(role)
      if (rol === null) return
      expect(VALIDOS).toContain(rol)
      expect(ESPEJO[rol]).toBe(role)
    },
  )
})
