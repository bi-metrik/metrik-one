/**
 * El campo numérico se pinta como TEXTO con teclado decimal, no como `type="number"`.
 *
 * Es una prueba de RENDER y por eso vale la pena: el defecto que este frente cierra vivía
 * en el JSX, no en la lógica. `parsearNumeroColombiano` puede estar perfecto y sus 14
 * pruebas en verde mientras el input sigue siendo `type="number"` con `Number(...)`, que
 * es exactamente cómo `769.898` entró a la base como 769,898 pesos. Ninguna prueba pura
 * mata esa mutación.
 *
 * ⚠️ LO QUE ESTA PRUEBA **NO** CUBRE. `renderToStaticMarkup` corre en el entorno `node`
 * de vitest, sin DOM y sin eventos: mide el PRIMER render. El rechazo de la tarifa
 * (mensaje en rojo y guardado frenado) solo aparece después de un `change`, así que no se
 * puede afirmar acá. Ese criterio está cubierto por `lib/upme/tarifa-confirmada.test.ts`
 * y por la barrera del servidor, que es la que de verdad impide la escritura.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

// El bloque importa server actions; acá solo se mide el primer render.
vi.mock('../../negocio-v2-actions', () => ({
  actualizarBloqueData: async () => ({ error: null }),
  marcarBloqueCompleto: async () => ({ error: null }),
  consultarRetornoDeCorreccion: async () => ({ aviso: null, etapa: null }),
}))
vi.mock('@/lib/actions/documento-actions', () => ({
  extraerCampoDesdeImagen: async () => ({ ok: true }),
  subirImagenClipboard: async () => ({ ok: true }),
}))
vi.mock('@/lib/actions/epayco-actions', () => ({ consultarEpayco: async () => ({ success: false }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))

import BloqueDatos, { type DatosField } from './BloqueDatos'

/** El bloque real de SOENA, recortado a lo que este render necesita. */
const CAMPOS: DatosField[] = [
  {
    slug: 'tarifa_upme_confirmada',
    tipo: 'numero',
    label: 'Tarifa a recaudar (confirmada)',
    required: true,
  },
  { slug: 'tarifa_confirmada', tipo: 'toggle', label: 'Confirmo la tarifa UPME', required: true },
]

function pintar(data: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement(BloqueDatos, {
      negocioBloqueId: 'nb-1',
      // La instancia solo aporta `data`: el resto de la fila no participa del render.
      instancia: { id: 'nb-1', data } as unknown as Parameters<typeof BloqueDatos>[0]['instancia'],
      modo: 'editable' as const,
      fields: CAMPOS,
      tarifaConfirmacion: {
        enabled: true,
        ref_field: 'tarifa_upme_ref',
        confirmada_field: 'tarifa_upme_confirmada',
        justificacion_field: 'tarifa_upme_motivo_diferencia',
      },
    }),
  )
}

describe('BloqueDatos — campo numérico', () => {
  it('NO se pinta como `type="number"`', () => {
    // La mutación que esto mata: volver al input que leía `769.898` como 769,898.
    const html = pintar({ tarifa_upme_confirmada: 770159, tarifa_upme_ref: 770159 })
    expect(html).not.toContain('type="number"')
  })

  it('se pinta como texto con teclado decimal', () => {
    const html = pintar({ tarifa_upme_confirmada: 770159, tarifa_upme_ref: 770159 })
    // ⚠️ React SSR emite el atributo en camelCase (`inputMode`), no en minúsculas.
    expect(html).toContain('inputMode="decimal"')
    expect(html).toContain('type="text"')
  })

  it('muestra el valor guardado tal cual, sin perder dígitos', () => {
    const html = pintar({ tarifa_upme_confirmada: 770159, tarifa_upme_ref: 770159 })
    expect(html).toContain('value="770159"')
  })

  it('un campo sin valor se pinta vacío, no en cero', () => {
    // Un cero es una respuesta; el campo sin llenar no lo es.
    const html = pintar({ tarifa_upme_ref: 770159 })
    expect(html).toContain('value=""')
    expect(html).not.toContain('value="0"')
  })
})
