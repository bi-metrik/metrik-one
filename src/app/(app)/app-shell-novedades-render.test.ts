/**
 * La entrada «Novedades» del menú: sale solo si el espacio tiene alguna novedad de su producto, en
 * el menú lateral y en la barra superior del teléfono. Al pintar en el servidor no hay numerito (el
 * «visto» vive en el navegador y se lee después de hidratar).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/valida',
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, prefetch: () => {} }),
}))

// Lista fija: la prueba no depende de lo que se publique en el archivo real.
vi.mock('@/lib/novedades/novedades', () => ({
  NOVEDADES: [{ id: 'solo-valida', fecha: '2026-10-21', titulo: 'T', texto: 'X', producto: 'valida' }],
}))

const { default: AppShell } = await import('./app-shell')

function pintar(modules: Record<string, boolean>, modoVitrina = false) {
  const props = {
    fullName: 'Alba Rosas',
    workspaceName: 'Espacio',
    role: 'owner',
    modules,
    modoVitrina,
    hasLineas: false,
    platformAdminState: null,
    usuarioId: 'u-1',
    children: null,
  }
  return renderToStaticMarkup(React.createElement(AppShell, props))
}

describe('la entrada Novedades', () => {
  it('en un espacio con Valida sale en el menú lateral y en la barra del teléfono, sin numerito al pintar', () => {
    const html = pintar({ valida_consulta: true }, true)
    expect(html).toContain('data-nav-novedades')
    expect(html).toContain('data-boton-novedades')
    expect(html).toContain('aria-label="Novedades"')
    expect(html).not.toContain('data-numerito-novedades')
  })

  it('sin novedades de su producto, no hay entrada', () => {
    const html = pintar({ business: true })
    expect(html).not.toContain('data-nav-novedades')
    expect(html).not.toContain('data-boton-novedades')
  })
})
