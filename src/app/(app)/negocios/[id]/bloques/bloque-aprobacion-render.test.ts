/**
 * El selector de aprobador ofrece solo a quien puede decidir, y no borra al designado que
 * dejó de poder hacerlo.
 *
 * Es prueba de RENDER porque la regla pura (`opcionesAprobador`) puede estar bien y el
 * `<select>` seguir pintando la lista completa: eso fue exactamente el defecto, una pantalla
 * que ofrecía a cualquier profile mientras el servidor solo dejaba decidir a la gerencia.
 * Corre con `renderToStaticMarkup` en el entorno `node` de vitest, sin DOM.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

// El bloque importa la server action; aquí solo se mide el primer render.
vi.mock('../../negocio-v2-actions', () => ({
  actualizarAprobacion: async () => ({ error: null }),
}))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))

import BloqueAprobacion from './BloqueAprobacion'

const PERFILES = [
  { id: 'p-owner', full_name: 'Dueña', role: 'owner', activo: true },
  { id: 'p-oper', full_name: 'Operadora', role: 'operator', activo: true },
  { id: 'p-admin-baja', full_name: 'Admin de baja', role: 'admin', activo: false },
  { id: 'p-admin', full_name: 'Admin', role: 'admin', activo: true },
]

function pintar(opts: { aprobadorId?: string; currentUserId?: string; perfiles?: typeof PERFILES }) {
  const instancia = {
    id: 'nb-1',
    estado: 'pendiente',
    data: opts.aprobadorId ? { aprobador_id: opts.aprobadorId, estado: 'pendiente' } : {},
  } as unknown as Parameters<typeof BloqueAprobacion>[0]['instancia']
  return renderToStaticMarkup(
    React.createElement(BloqueAprobacion, {
      negocioId: 'n-1',
      negocioBloqueId: 'nb-1',
      instancia,
      modo: 'editable',
      profiles: opts.perfiles ?? PERFILES,
      currentUserId: opts.currentUserId ?? 'p-owner',
    }),
  )
}

const opciones = (html: string) =>
  [...html.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)].map(m => ({ attrs: m[1], texto: m[2] }))

describe('BloqueAprobacion: el selector de aprobador', () => {
  it('ofrece solo a dueños y administradores activos', () => {
    const textos = opciones(pintar({})).map(o => o.texto)
    expect(textos).toContain('Dueña')
    expect(textos).toContain('Admin')
    expect(textos).not.toContain('Operadora')
    expect(textos).not.toContain('Admin de baja')
  })

  it('un designado que no puede decidir se muestra marcado, no desaparece', () => {
    const html = pintar({ aprobadorId: 'p-oper', currentUserId: 'p-oper' })
    const marcada = opciones(html).find(o => o.texto.startsWith('Operadora'))
    expect(marcada?.texto).toBe('Operadora (no puede aprobar)')
    expect(marcada?.attrs).toContain('disabled')
    expect(marcada?.attrs).toContain('selected')
    expect(html).toContain('no es dueño ni administrador')
    // Aunque sea el usuario actual, no se le ofrece decidir: el servidor lo rechazaría.
    expect(html).not.toContain('Aprobar')
    expect(html).not.toContain('Esperando aprobación de')
  })

  it('un designado desactivado se marca con su motivo', () => {
    const html = pintar({ aprobadorId: 'p-admin-baja' })
    expect(html).toContain('Admin de baja (no puede aprobar)')
    expect(html).toContain('está desactivado en el equipo')
  })

  it('el designado válido que abre el bloque ve los botones de decisión', () => {
    const html = pintar({ aprobadorId: 'p-admin', currentUserId: 'p-admin' })
    expect(html).toContain('Esperando aprobación de')
    expect(html).toContain('Aprobar')
    expect(html).not.toContain('no puede aprobar')
  })

  it('sin nadie que pueda aprobar, lo dice en vez de mostrar una lista vacía muda', () => {
    const html = pintar({ perfiles: [PERFILES[1], PERFILES[2]] })
    expect(html).toContain('Nadie en el equipo puede aprobar')
  })
})
