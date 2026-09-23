/**
 * El menú no ofrece lo que el gate por módulo no deja abrir.
 *
 * Si el menú muestra una entrada que el middleware bloquea, el clic rebota al aterrizaje: una
 * pantalla que parece rota. Se midió sobre los 17 workspaces reales (2026-09-15) y pasaba en dos:
 * Workflows en advise (sin Clarity, con una línea activa) y Validación en metrik (sin Sustenta).
 *
 * Es prueba de render a propósito: lo que se fija es un hecho de pantalla (qué enlaces pinta el
 * sidebar), y lo único que puede romperlo es que alguien quite el filtro de un grupo del menú.
 * Se renderizan los 17 workspaces por cada rol, y además dos casos guardia que afirman que las
 * entradas que SÍ deben estar siguen estando: un filtro que borrara todo pasaría el primer caso.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import type { PlatformAdminState } from '@/lib/actions/platform-admin'
import { rutaPermitida } from '@/lib/modulos/gate'
import { WORKSPACES_2026_09_15, workspaceMedido } from '@/lib/modulos/__fixtures__/workspaces-2026-09-15'

vi.mock('next/navigation', () => ({
  usePathname: () => '/ninguna',
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
}))

const { default: AppShell } = await import('./app-shell')

const ROLES = ['owner', 'admin', 'supervisor', 'operator', 'read_only'] as const

const PLATFORM_ADMIN: PlatformAdminState = {
  platformAdmin: true,
  currentWorkspace: null,
  homeWorkspace: null,
  workspaces: [],
  isAway: false,
}

// Medido el 2026-09-16 por PostgREST: `4d-soft` nació después de la foto del 2026-09-15. Solo
// `valida_api`, sin modo vitrina y sin líneas activas.
const CUATRO_D_SOFT = { slug: '4d-soft', modules: { valida_api: true }, modoVitrina: false, hasLineas: false }

function hrefsDelMenu(slug: string, role: string, platformAdminState: PlatformAdminState | null = null): string[] {
  const w = slug === CUATRO_D_SOFT.slug ? CUATRO_D_SOFT : workspaceMedido(slug)
  const props = {
    fullName: 'Persona de prueba',
    workspaceName: 'Workspace de prueba',
    role,
    modules: w.modules,
    modoVitrina: w.modoVitrina,
    hasLineas: w.hasLineas,
    platformAdminState,
    children: null,
  }
  const html = renderToStaticMarkup(React.createElement(AppShell, props))
  return [...new Set([...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]))]
}

describe('menú contra gate por módulo', () => {
  it('ningún workspace real, con ningún rol, ve en el menú una ruta que el gate bloquea', () => {
    const bloqueadas: string[] = []
    for (const w of WORKSPACES_2026_09_15) {
      const ctx = { modules: w.modules, modoVitrina: w.modoVitrina, platformAdmin: false }
      for (const role of ROLES) {
        for (const href of hrefsDelMenu(w.slug, role)) {
          if (!rutaPermitida(href, ctx)) bloqueadas.push(`${w.slug} (${role}): ${href}`)
        }
      }
    }
    expect(bloqueadas, `El menú ofrece rutas que el gate bloquea:\n${bloqueadas.join('\n')}`).toEqual([])
  })

  it('guardia: advise conserva Llamadas y Solicitudes, y ya no ofrece Workflows', () => {
    const hrefs = hrefsDelMenu('advise', 'owner')
    expect(hrefs).toContain('/calidad')
    expect(hrefs).toContain('/solicitudes')
    expect(hrefs).not.toContain('/flujo')
  })

  it('guardia: metrik conserva la comparativa de Informa y Valida; Validación queda para el platform admin en su propio espacio', () => {
    const owner = hrefsDelMenu('metrik', 'owner')
    expect(owner).toContain('/compliance/comparativa-informa')
    expect(owner).toContain('/negocios')
    expect(owner).not.toContain('/compliance/validacion')
    expect(hrefsDelMenu('metrik', 'owner', PLATFORM_ADMIN)).toContain('/compliance/validacion')
  })

  it('4d-soft (solo Valida API): ni el cliente ni el soporte que lo visita ven Directorio ni Tableros', () => {
    const cliente = hrefsDelMenu('4d-soft', 'owner')
    const soporteVisitando = hrefsDelMenu('4d-soft', 'owner', { ...PLATFORM_ADMIN, isAway: true })
    for (const hrefs of [cliente, soporteVisitando]) {
      expect(hrefs).not.toContain('/directorio')
      expect(hrefs).not.toContain('/tableros')
      // Lo que le queda: su módulo y la configuración de la cuenta.
      expect(hrefs.filter((h) => h !== '/')).toEqual(['/valida-api', '/mi-negocio'])
    }
  })

  it('guardia: un CDA en vitrina sigue viendo Valida y Tableros, y ya no Números', () => {
    const hrefs = hrefsDelMenu('cda-caqueta', 'operator')
    expect(hrefs).toEqual(expect.arrayContaining(['/valida', '/tableros']))
    expect(hrefs).not.toContain('/numeros')
  })
})
