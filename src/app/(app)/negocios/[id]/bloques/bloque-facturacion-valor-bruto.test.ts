/**
 * Facturar a nombre de otro: el valor bruto lo escribe una persona, y en Colombia lo
 * escribe con punto de miles.
 *
 * Se leía con `Number(v.replace(/[^\d.-]/g, ''))`, que conserva el punto: «350.906»
 * salía como 350,906 pesos, el total con IVA como «$ 418» y el texto que se copia a
 * Siigo llevaba esa cifra. Ahora pasa por el normalizador único de montos.
 *
 * Prueba de render: lo que se afirma es la cifra que la persona ve en pantalla.
 */
import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }))

import BloqueFacturacion from './BloqueFacturacion'

// El formateador separa «$» de la cifra con un espacio duro; el texto de la pantalla
// se normaliza a espacios simples, así que la cifra esperada también.
const cop = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(v)
    .replace(/\s+/g, ' ')

/** Texto que lee la persona, sin marcado. */
function textoCon(valorBruto: string, modo: 'editable' | 'visible' = 'editable'): string {
  const html = renderToStaticMarkup(
    createElement(BloqueFacturacion, {
      negocioBloqueId: 'nb-1',
      instancia: {
        id: 'nb-1',
        completado: false,
        data: { facturar_a_tercero: true, override: { valor_bruto: valorBruto } },
      },
      modo,
      draft: null,
      configExtra: { iva_pct: 19 },
    }),
  )
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
}

describe('BloqueFacturacion — valor bruto escrito a mano', () => {
  it('«350.906» son 350.906 pesos: IVA y total salen de ahí', () => {
    const texto = textoCon('350.906')
    // 350.906 × 1,19 = 417.578,14 → 417.578
    expect(texto).toContain(cop(66672)) // IVA
    expect(texto).toContain(cop(417578)) // Total
    expect(texto).not.toContain(cop(418)) // lo que salía antes
  })

  it('con coma decimal también', () => {
    expect(textoCon('350.906,00')).toContain(cop(417578))
  })

  it('el resumen de solo lectura muestra el mismo total', () => {
    expect(textoCon('350.906', 'visible')).toContain(cop(417578))
  })

  // CONTROL: el número sin separadores da lo mismo que antes.
  it('sin separadores no cambia', () => {
    expect(textoCon('350906')).toContain(cop(417578))
  })
})
