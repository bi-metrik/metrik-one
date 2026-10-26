/**
 * `BloqueDocumento` en modo visible: «Leer de nuevo» para el documento cuya lectura falló
 * (SOE-029).
 *
 * El hueco que cierra es de PANTALLA: el banner de «Reintentar» vivía solo en el modo
 * editable, y el modo visible no pinta campos que no existen. Un comprobante UPME cuya
 * lectura falló (Gemini 403, 1–13 oct 2026) en un negocio que ya avanzó quedaba sin datos y
 * sin ningún botón. La acción de servidor que corre detrás (`reprocesarDocumento` con
 * `soloHuecos`) tiene sus pruebas en `src/lib/actions/documento-releer-huecos.test.ts`.
 *
 * Corre con `renderToStaticMarkup` en el entorno `node` de vitest, sin DOM. Se queda en
 * `.test.ts`: el `include` de `vitest.config.ts` no mira `.tsx`.
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
import type { CampoExtraccion } from '@/lib/ai/extract-fields'

const CAMPOS: CampoExtraccion[] = [
  { slug: 'numero_cus', label: 'Número CUS', tipo: 'texto', descripcion_ai: '...', required: true },
  { slug: 'valor_pagado', label: 'Valor pagado a la UPME', tipo: 'currency', descripcion_ai: '...', required: true },
]

const BOTON = 'Leer de nuevo'

function pintar(opts: {
  modo?: 'visible' | 'editable'
  userRole?: string
  areaReadonly?: boolean
  estadoLectura?: 'failed' | 'ok'
  campos?: Record<string, unknown>
  conArchivo?: boolean
}) {
  // Las llaves de los bloques de producción (V0294, V0559, V0561).
  const data: Record<string, unknown> = {
    _extraction_status: opts.estadoLectura ?? 'failed',
    _extraction_error: 'Error de Gemini (403)',
    mime_type: 'application/pdf',
    uploaded_at: '2026-10-09T22:41:19.000Z',
    ...(opts.campos ? { campos: opts.campos } : {}),
  }
  if (opts.conArchivo !== false) {
    data.drive_url = 'https://drive.google.com/file/d/drv-comprobante/view'
    data.drive_file_id = 'drv-comprobante'
    data.file_name = 'VEH_GEE2026168317.pdf'
  }
  return renderToStaticMarkup(
    React.createElement(BloqueDocumento, {
      negocioBloqueId: 'nb-1',
      negocioId: 'neg-1',
      workspaceId: 'ws-1',
      instancia: { id: 'nb-1', estado: 'pendiente', data } as unknown as Parameters<typeof BloqueDocumento>[0]['instancia'],
      modo: opts.modo ?? 'visible',
      userRole: opts.userRole ?? 'supervisor',
      configExtra: {
        label: 'Comprobante de pago UPME',
        campos_extraccion: CAMPOS,
        ...(opts.areaReadonly ? { _areaReadonly: true } : {}),
      },
    }),
  )
}

describe('BloqueDocumento visible — leer de nuevo un documento que no se leyó', () => {
  it('lo ofrece cuando la lectura falló y el bloque no tiene campos', () => {
    const html = pintar({})
    expect(html).toContain(BOTON)
    expect(html).toContain('solo llena los campos vacíos')
  })

  it('lo ofrece si falta al menos un campo', () => {
    expect(pintar({ campos: { numero_cus: { value: '3387221', confidence: 1, manual: true } } })).toContain(BOTON)
  })

  it('no lo ofrece si el bloque ya tiene todos sus campos', () => {
    const campos = {
      numero_cus: { value: '3387221', confidence: 1, manual: true },
      valor_pagado: { value: null, confidence: 0, manual: true },
    }
    expect(pintar({ campos })).not.toContain(BOTON)
  })

  it('no lo ofrece si la lectura salió bien', () => {
    expect(pintar({ estadoLectura: 'ok' })).not.toContain(BOTON)
  })

  it('no lo ofrece sin permiso: área de solo lectura o rol que no corrige', () => {
    expect(pintar({ areaReadonly: true })).not.toContain(BOTON)
    expect(pintar({ userRole: 'read_only' })).not.toContain(BOTON)
    expect(pintar({ userRole: 'contador' })).not.toContain(BOTON)
  })

  it('sin archivo no hay nada que leer', () => {
    expect(pintar({ conArchivo: false })).not.toContain(BOTON)
  })

  it('el modo editable sigue con su «Reintentar» de siempre', () => {
    const html = pintar({ modo: 'editable' })
    expect(html).not.toContain(BOTON)
    expect(html).toContain('Reintentar')
  })
})
