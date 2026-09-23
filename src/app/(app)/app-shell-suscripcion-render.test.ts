/**
 * El ítem «Suscripción» del menú: sale solo cuando el layout lo pasa (dueño, administrador o
 * persona designada de un espacio que paga un contrato de Valida), con su punto de estado, y en el
 * teléfono vive dentro del menú de perfil. Sin la prop, el menú de siempre (y el avatar de siempre).
 *
 * Prueba de render: lo que se fija es qué pinta el shell con cada prop.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({
  usePathname: () => '/valida',
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}))

const { default: AppShell } = await import('./app-shell')

function pintar(suscripcion: { tono: 'verde' | 'ambar' | 'rojo' | null } | null) {
  const props = {
    fullName: 'Alba Rosas',
    workspaceName: 'CDA',
    role: 'owner',
    modules: { valida_consulta: true },
    modoVitrina: true,
    hasLineas: false,
    platformAdminState: null,
    suscripcion,
    children: null,
  }
  return renderToStaticMarkup(React.createElement(AppShell, props))
}

describe('el ítem Suscripción del menú', () => {
  it('con la prop, sale al final del menú lateral con su punto de estado', () => {
    const html = pintar({ tono: 'ambar' })
    expect(html).toContain('data-nav-suscripcion')
    expect(html).toContain('href="/suscripcion"')
    expect(html).toContain('data-punto-suscripcion="ambar"')
    expect(html).toContain('aria-label="Suscripción requiere atención"')
    // En el teléfono, el avatar abre el menú de perfil (cerrado al pintar).
    expect(html).toContain('aria-label="Menú de perfil"')
  })

  it('sin tono no hay punto', () => {
    const html = pintar({ tono: null })
    expect(html).toContain('href="/suscripcion"')
    expect(html).not.toContain('data-punto-suscripcion')
  })

  it('sin la prop (operador, espacio sin contrato) no se ofrece', () => {
    const html = pintar(null)
    expect(html).not.toContain('/suscripcion')
    expect(html).not.toContain('Menú de perfil')
  })
})
