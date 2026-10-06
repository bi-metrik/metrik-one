/**
 * `BloqueDocumento` en modo visible pintando la data de un FORMULARIO generado: la copia
 * readonly de la carta de autorización (SOENA, 2026-10-06), cuyo origen es
 * `carta_autorizacion_generar`. La fila de un formulario trae `drive_url`, `campos_usados`,
 * `template` y `version_actual`; no trae `file_name` ni `campos` de extracción.
 *
 * Qué se fija: con PDF, «Ver» y «Descargar» apuntando a ese archivo; sin PDF, «Sin archivo»;
 * y en ningún caso hay forma de subir, reemplazar ni generar.
 *
 * ⚠️ `.test.ts` y no `.tsx`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, info: () => {} } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/actions/documento-actions', () => ({
  procesarDocumento: async () => ({ success: true }),
  reprocesarDocumento: async () => ({ success: true }),
  actualizarCampoDocumento: async () => ({ success: true }),
}))
vi.mock('@/lib/actions/subida-externa', () => ({
  prepararSubidaExterna: async () => ({ ok: false, error: '' }),
  descartarSubidaExterna: async () => {},
}))
vi.mock('@/lib/actions/devolucion-actions', () => ({ devolverBloque: async () => ({ ok: true }) }))

import BloqueDocumento from './BloqueDocumento'

const PDF = 'https://drive.google.com/file/d/carta123/view'

function pintar(data: Record<string, unknown>, userRole = 'owner') {
  return renderToStaticMarkup(
    React.createElement(BloqueDocumento, {
      negocioBloqueId: 'nb-copia',
      negocioId: 'neg-1',
      workspaceId: 'ws-1',
      instancia: { id: 'nb-copia', estado: 'completo', data } as unknown as Parameters<typeof BloqueDocumento>[0]['instancia'],
      modo: 'visible' as const,
      userRole,
      configExtra: {
        readonly: true,
        label: '008_CARTA_AUTORIZACION_BORRADOR',
        source_etapa_orden: 6,
        source_bloque_slug: 'carta_autorizacion_generar',
      } as unknown as Parameters<typeof BloqueDocumento>[0]['configExtra'],
    }),
  )
}

// Lo que deja `generarFormularioCore` en la fila del formulario.
const DATA_FORMULARIO = {
  drive_url: PDF,
  template: 'carta-autorizacion',
  version_actual: 2,
  generated_at: '2026-10-01T15:00:00.000Z',
  campos_usados: { autorizante_nombre: 'ANA PÉREZ', beneficiario_nombre: 'LUIS GÓMEZ' },
}

describe('copia readonly de la carta de autorización', () => {
  it('con el PDF generado muestra Ver y Descargar sobre ese archivo', () => {
    const html = pintar(DATA_FORMULARIO)
    expect(html).toContain('008_CARTA_AUTORIZACION_BORRADOR')
    expect(html).toContain('carta123')
    expect(html).toContain('Ver')
    expect(html).toContain('Descargar')
    expect(html).not.toContain('Sin archivo')
    // `campos_usados` no son campos de extracción: no se pintan.
    expect(html).not.toContain('ANA PÉREZ')
  })

  it('sin PDF en el origen muestra «Sin archivo»', () => {
    const html = pintar({})
    expect(html).toContain('Sin archivo')
    expect(html).not.toContain('Descargar')
  })

  it('en ningún caso ofrece subir, reemplazar, devolver ni generar', () => {
    for (const data of [DATA_FORMULARIO, {}]) {
      for (const rol of ['owner', 'supervisor', 'operator']) {
        const html = pintar(data, rol)
        expect(html).not.toContain('type="file"')
        expect(html).not.toContain('Reemplazar')
        expect(html).not.toContain('Devolver')
        expect(html).not.toMatch(/Generar|regenerar/)
      }
    }
  })
})
