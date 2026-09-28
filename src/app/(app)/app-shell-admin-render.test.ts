/**
 * Del menú Admin salieron Mi Bolsillo, Proceso y Skills (queda Cerebro), y el Workflows del
 * workspace admin abre /flujo (2026-09-27).
 *
 * Las rutas viejas no se borran. Workflows en el workspace admin resolvía a
 * /admin/workflows, que nació cuando no se podía cambiar de workspace; ahora metrik ve su propio
 * flujo por línea de negocio, igual que un cliente. Las rutas /admin/* quedan: solo dejan de
 * ofrecerse.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { workspaceMedido } from '@/lib/modulos/__fixtures__/workspaces-2026-09-15'

vi.mock('next/navigation', () => ({
  usePathname: () => '/ninguna',
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}))

const { default: AppShell } = await import('./app-shell')

// metrik es el workspace admin real: business activo y con líneas (medido 2026-09-15).
const METRIK = workspaceMedido('metrik')

function render(isAdminWorkspace: boolean, role = 'owner'): string {
  const props = {
    fullName: 'Persona de prueba',
    workspaceName: 'Workspace de prueba',
    role,
    modules: METRIK.modules,
    modoVitrina: METRIK.modoVitrina,
    hasLineas: METRIK.hasLineas,
    isAdminWorkspace,
    platformAdminState: null,
    // En la constante y no en el literal de createElement: ver app-shell-tesoreria-render.test.ts.
    children: null,
  }
  return renderToStaticMarkup(React.createElement(AppShell, props))
}

// Encabezado de sección del sidebar (no la etiqueta del rol en la tarjeta del usuario).
const encabezado = (texto: string) => new RegExp(`uppercase tracking-wider"[^>]*>${texto}</p>`)

const hrefs = (html: string) => [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1])

describe('sidebar del workspace admin', () => {
  it('Admin solo ofrece Cerebro: fuera Mi Bolsillo, Proceso, Skills y /admin/workflows', () => {
    const html = render(true, 'owner')
    expect(hrefs(html).filter((h) => h.startsWith('/admin/'))).toEqual(['/admin/cerebro'])
    expect(html).toMatch(encabezado('Admin'))
  })

  it('sin ítems visibles para su rol, el encabezado Admin no se pinta vacío', () => {
    for (const role of ['admin', 'supervisor']) {
      const html = render(true, role)
      expect(hrefs(html).filter((h) => h.startsWith('/admin/'))).toEqual([])
      expect(html).not.toMatch(encabezado('Admin'))
    }
  })

  it('Workflows abre /flujo, el flujo del propio workspace, y no /admin/workflows', () => {
    const html = render(true, 'owner')
    // El patrón del encabezado sí encuentra una sección que existe: si no, la prueba de Admin no probaría nada.
    expect(html).toMatch(encabezado('Workflows'))
    const owner = hrefs(html)
    expect(owner).toContain('/flujo')
    expect(owner).not.toContain('/admin/workflows')
  })

  it('guardia: un workspace de cliente sigue ofreciendo Workflows → /flujo', () => {
    expect(hrefs(render(false))).toContain('/flujo')
  })
})
