/**
 * `BloqueDocumento` en modo visible: qué ofrece y a quién, corrigiendo hacia atrás.
 *
 * Es prueba de RENDER porque las dos fallas que cierra son de pantalla, no de regla:
 *
 *  1. `puedeCorregirVisible` NO miraba `_areaReadonly` (BloqueDatos sí). Con un caso en
 *     una etapa de `ejecucion`, a la supervisora de operaciones se le ofrecía corregir un
 *     bloque de `venta` y al guardar recibía «Tu rol o área no permite editar en esta fase
 *     del negocio». El flag ya viajaba; este componente no lo leía.
 *  2. En modo visible solo había Ver, Descargar y Devolver: si el documento estaba mal y
 *     quien lo veía tenía el bueno en la mano, su única salida era devolvérselo a quien lo
 *     cargó. Ahora hay **Reemplazar archivo**, detrás de las MISMAS tres llaves que la
 *     corrección de campos (opt-in del bloque, rol o responsable, causa ya elegida).
 *
 * Corre con `renderToStaticMarkup` en el entorno `node` de vitest, sin DOM. La causa se
 * elige con un clic, así que el primer render muestra el selector y no el botón: lo que se
 * fija aquí es qué aparece antes de elegirla y qué no aparece nunca sin permiso.
 *
 * ⚠️ El archivo se queda en `.test.ts` (no `.tsx`): el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo lo sacaría de la suite EN SILENCIO.
 *
 * ── Mutaciones corridas contra este archivo (2026-09-17) ──────────────────────
 *   · `puedeCorregirVisible` ignora `_areaReadonly`                 → 1 roja
 *   · el botón de reemplazo se pinta sin exigir `causaDoc`           → 1 roja
 *   · el botón de reemplazo se pinta sin exigir `corregirGerencial`  → 1 roja
 *   · el botón de reemplazo se pinta sin archivo previo              → 2 rojas
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
  { slug: 'nit', label: 'NIT', tipo: 'texto', descripcion_ai: 'NIT del emisor', required: true },
]

function pintar(opts: {
  userRole?: string
  areaReadonly?: boolean
  corregirGerencial?: boolean
  conArchivo?: boolean
}) {
  const data: Record<string, unknown> = {
    campos: { nit: { value: '900123456', confidence: 1, manual: false } },
  }
  if (opts.conArchivo !== false) {
    data.drive_url = 'https://drive.google.com/file/d/abc/view'
    data.file_name = 'factura-vieja.pdf'
  }
  return renderToStaticMarkup(
    React.createElement(BloqueDocumento, {
      negocioBloqueId: 'nb-1',
      negocioId: 'neg-1',
      workspaceId: 'ws-1',
      instancia: { id: 'nb-1', estado: 'completo', data } as unknown as Parameters<typeof BloqueDocumento>[0]['instancia'],
      modo: 'visible' as const,
      userRole: opts.userRole ?? 'supervisor',
      configExtra: {
        label: 'Factura Venta Vehículo',
        campos_extraccion: CAMPOS,
        corregir_campos_gerencial: opts.corregirGerencial ?? true,
        ...(opts.areaReadonly ? { _areaReadonly: true } : {}),
      },
    }),
  )
}

describe('BloqueDocumento visible — corrección hacia atrás', () => {
  it('ofrece corregir a un rol de corrección cuando el bloque lo declara', () => {
    const html = pintar({})
    expect(html).toContain('¿Por qué se corrige?')
  })

  it('NO ofrece corregir cuando el servidor marcó el bloque de solo lectura por área', () => {
    // El caso que lo motivó: la pantalla ofrecía y el servidor rechazaba.
    const html = pintar({ areaReadonly: true })
    expect(html).not.toContain('¿Por qué se corrige?')
    // Y lo que siempre estuvo, sigue: ver y descargar no son escribir.
    expect(html).toContain('Descargar')
  })

  it('sin el opt-in del bloque no hay corrección, aunque el rol sea gerencial', () => {
    expect(pintar({ corregirGerencial: false })).not.toContain('¿Por qué se corrige?')
  })

  it('un read_only no corrige ni ve el selector de causa', () => {
    expect(pintar({ userRole: 'read_only' })).not.toContain('¿Por qué se corrige?')
  })

  it('el botón de reemplazo NO aparece antes de elegir la causa', () => {
    // La causa se elige primero, igual que en los campos: sin ella el servidor
    // rechazaría el reemplazo, y ofrecer un botón que va a fallar enseña a chocarse.
    expect(pintar({})).not.toContain('Reemplazar archivo')
    expect(pintar({ areaReadonly: true })).not.toContain('Reemplazar archivo')
  })

  it('sin archivo cargado no hay nada que reemplazar', () => {
    const html = pintar({ conArchivo: false })
    expect(html).not.toContain('Reemplazar archivo')
    expect(html).toContain('Sin archivo')
  })
})
