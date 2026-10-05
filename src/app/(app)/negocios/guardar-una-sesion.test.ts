/**
 * Guardar en la ficha resuelve la sesión UNA vez (2026-10-04).
 *
 * EL CASO QUE IMPORTA: en una server action el `cache()` de React no memoiza (no hay
 * render), así que cada `getWorkspace` del camino —la acción, su guard, `exigirModulo`—
 * volvía a ir a Supabase (profile + staff + staff_areas). Las acciones de guardado corren
 * ahora dentro de `enPeticionDeRuta` y lo comparten.
 *
 * La sesión se cuenta con el MISMO `memoDeRuta` que envuelve a `getWorkspace` en
 * producción. CONTROL: dos guardados seguidos son dos invocaciones, y cada una resuelve su
 * propia sesión: el memo no cruza de una petición a otra.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WS, estado, reiniciarDoble, servicioFalso } from '../../../../test/redistribucion-doble'

let resoluciones = 0
vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  return {
    getWorkspace: memoDeRuta(async () => {
      resoluciones++
      return {
        supabase: servicioFalso(), workspaceId: WS, userId: 'p-1', staffId: 'staff-1',
        role: 'owner', areas: ['comercial'], impersonating: false, realRole: 'owner', error: null,
      }
    }),
  }
})
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => servicioFalso(), createClient: async () => servicioFalso() }))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: { id: 'p-1' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { actualizarBloqueData } from './negocio-v2-actions'

beforeEach(() => {
  resoluciones = 0
  reiniciarDoble()
  estado.fixtures.workspaces = [{ id: WS, modules: { clarity: true } }]
  estado.fixtures.profiles = [{ id: 'p-1', platform_admin: false, workspace_id: WS, home_workspace_id: null }]
})

describe('guardar en la ficha', () => {
  it('la acción, su guard y exigirModulo comparten UNA resolución de la sesión', async () => {
    // El bloque no existe: el guard corta después de resolver la sesión y el módulo, que
    // es justo el tramo donde antes se resolvía tres veces.
    const r = await actualizarBloqueData('nb-inexistente', { a: 1 })
    expect(r.error).toBeTruthy()
    expect(resoluciones).toBe(1)
  })

  it('CONTROL — dos guardados son dos invocaciones: cada una resuelve la suya', async () => {
    await actualizarBloqueData('nb-inexistente', { a: 1 })
    await actualizarBloqueData('nb-inexistente', { a: 2 })
    expect(resoluciones).toBe(2)
  })
})
