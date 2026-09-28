/**
 * El workspace admin ya no ofrece la sección Admin ni Workflows (2026-09-27).
 *
 * Proceso, Skills y Mi Bolsillo salieron del menú; Workflows en el workspace admin resolvía a
 * /admin/workflows, que nació cuando no se podía cambiar de workspace. Las rutas quedan: solo
 * dejan de ofrecerse. En los workspaces de clientes Workflows sigue apuntando a /flujo.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { rutaPermitida } from '@/lib/modulos/gate'
import { WORKSPACES_2026_09_15 } from '@/lib/modulos/__fixtures__/workspaces-2026-09-15'

vi.mock('next/navigation', () => ({
  usePathname: () => '/ninguna',
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}))

const { default: AppShell } = await import('./app-shell')

// Un workspace real al que el gate SÍ le deja abrir /flujo: si no, la guardia no probaría nada.
const CON_FLUJO = WORKSPACES_2026_09_15.find(
  (w) => !w.modoVitrina && rutaPermitida('/flujo', { modules: w.modules, modoVitrina: false, platformAdmin: false }),
)!

function render(isAdminWorkspace: boolean, role = 'owner'): string {
  return renderToStaticMarkup(
    React.createElement(AppShell, {
      fullName: 'Persona de prueba',
      workspaceName: 'Workspace de prueba',
      role,
      modules: CON_FLUJO.modules,
      modoVitrina: false,
      hasLineas: true,
      isAdminWorkspace,
      platformAdminState: null,
      children: null,
    }),
  )
}

const hrefs = (html: string) => [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1])

describe('sidebar del workspace admin', () => {
  it('no ofrece /admin/* ni Workflows, y no pinta el encabezado Admin vacío', () => {
    for (const role of ['owner', 'admin', 'supervisor']) {
      const html = render(true, role)
      expect(hrefs(html).filter((h) => h.startsWith('/admin/') || h === '/flujo')).toEqual([])
      expect(html).not.toMatch(/>Admin</)
      expect(html).not.toMatch(/>Workflows</)
    }
  })

  it('guardia: un workspace de cliente sigue ofreciendo Workflows → /flujo', () => {
    const html = render(false)
    expect(hrefs(html)).toContain('/flujo')
    expect(hrefs(html).some((h) => h.startsWith('/admin/'))).toBe(false)
  })
})
