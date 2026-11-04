/**
 * `BloqueDocumento` cuando la lectura falló por el ARCHIVO (V0634, 2026-11-04): un PDF sin páginas
 * se mostraba como «Error de Gemini (400)» con «Reintentar», y reintentar el mismo archivo falla
 * igual. Ahora es un aviso en ámbar que pide reemplazarlo. Las acciones de servidor tienen sus
 * pruebas en `src/lib/actions/documento-lectura-segundo-plano.test.ts`.
 *
 * Corre con `renderToStaticMarkup` en el entorno `node` de vitest, sin DOM. Se queda en
 * `.test.ts`: el `include` de `vitest.config.ts` no mira `.tsx`.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, info: () => {}, warning: () => {} } }))
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
import { MENSAJES_ARCHIVO, MENSAJE_FALLA_NUESTRA } from '@/lib/documentos/aviso-archivo'

const CAMPOS: CampoExtraccion[] = [
  { slug: 'numero_cus', label: 'Número CUS', tipo: 'texto', descripcion_ai: '...', required: true },
  { slug: 'valor_pagado', label: 'Valor pagado a la UPME', tipo: 'currency', descripcion_ai: '...', required: true },
]


function pintar(opts: {
  modo?: 'visible' | 'editable'
  userRole?: string
  areaReadonly?: boolean
  estadoLectura?: 'failed' | 'ok'
  campos?: Record<string, unknown>
  conArchivo?: boolean
  archivo?: string
  lectura?: Record<string, unknown>
}) {
  // Las llaves de los bloques de producción (V0294, V0559, V0561).
  const data: Record<string, unknown> = {
    _extraction_status: opts.estadoLectura ?? 'failed',
    _extraction_error: 'Error de Gemini (400)',
    ...(opts.archivo ? { _extraction_archivo: opts.archivo } : {}),
    ...(opts.lectura ? { _lectura: opts.lectura } : {}),
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

describe('BloqueDocumento — la lectura falló por el archivo', () => {
  it('banner ámbar con el motivo y «Reemplazar», sin «Reintentar» ni el nombre del proveedor', () => {
    const html = pintar({ modo: 'editable', userRole: 'owner', archivo: 'sin_paginas' })
    expect(html).toContain('No se pudo leer el archivo')
    expect(html).toContain('no tiene páginas')
    expect(html).toContain('data-aviso-lectura="archivo"')
    expect(html).toContain('Reemplazar')
    expect(html).not.toContain('La extracción con IA falló')
    expect(html).not.toMatch(/gemini/i)
  })

  it('una falla del sistema sigue con su banner rojo de «Reintentar»', () => {
    const html = pintar({ modo: 'editable', userRole: 'owner' })
    expect(html).toContain('La extracción con IA falló')
    expect(html).toContain('Reintentar')
    expect(html).not.toContain('data-aviso-lectura="archivo"')
  })

  it('la marca de una lectura que terminó en error de archivo pinta el aviso ámbar, sin «Reintentar»', () => {
    const html = pintar({
      modo: 'editable',
      userRole: 'owner',
      estadoLectura: 'ok',
      lectura: {
        token: 't', estado: 'error', tipo: 'reproceso', iniciada_at: '2026-11-04T16:34:00.000Z',
        terminada_at: '2026-11-04T16:34:05.000Z', error: MENSAJES_ARCHIVO.sin_paginas,
      },
    })
    expect(html).toContain(MENSAJES_ARCHIVO.sin_paginas)
    expect(html).toContain('data-accion="reemplazar-archivo"')
    expect(html).not.toContain('data-accion="reintentar-lectura"')
  })

  it('la marca de una falla nuestra sí ofrece «Reintentar»', () => {
    const html = pintar({
      modo: 'editable',
      userRole: 'owner',
      estadoLectura: 'ok',
      lectura: {
        token: 't', estado: 'error', tipo: 'reproceso', iniciada_at: '2026-11-04T16:34:00.000Z',
        terminada_at: '2026-11-04T16:34:05.000Z', error: MENSAJE_FALLA_NUESTRA,
      },
    })
    expect(html).toContain('data-accion="reintentar-lectura"')
    expect(html).not.toContain('data-accion="reemplazar-archivo"')
  })
})
