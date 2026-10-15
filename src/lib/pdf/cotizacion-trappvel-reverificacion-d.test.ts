/**
 * El PDF de Trappvel que vio Vera en la re-verificación D (2026-10-14, N2 · `re/h8-n2-pdf.txt`):
 *
 *  · «⇄» se imprimía «Ä»: Helvetica (WinAnsi) no tiene la flecha y pinta el byte bajo (0xC4).
 *  · «PREMIUM · Lord Pierre» quedaba solo arriba de la hoja 2, lejos de su capítulo
 *    («Destino 2 de 2 · San Andrés»): la regla de paginación del sistema visual dice que lo que
 *    abre un bloque no se separa de su contenido.
 *
 * Con las props del caso N2 grabadas en el fixture de igualdad de C0 (`trappvel-flujo-nuevo`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { componerCotizacionTrappvel } from './cotizacion-trappvel-paginacion'
import { compositorDePlantilla } from './plantillas-cotizacion'
import { HOJA } from './cotizacion-trappvel-formato'
import { medirPDF } from './medir-pdf'
import { textoDelPDF } from './texto-del-pdf'
import type { CotizacionPDFProps } from './cotizacion-props'
import { textoParaHelvetica } from './texto-helvetica'

const FRANJA = { arriba: HOJA.arriba - 8, abajo: HOJA.alto - HOJA.altoPie - 1 }

function propsN2(): CotizacionPDFProps {
  const ruta = resolve(process.cwd(), 'src/app/(app)/negocios/igualdad-servidor.fixture.json')
  const crudo = readFileSync(ruta, 'utf8').split('<repo>').join(process.cwd().replace(/\\/g, '/'))
  return (JSON.parse(crudo) as { salidas: Record<string, { pdf: { props: CotizacionPDFProps } }> }).salidas['trappvel-flujo-nuevo'].pdf.props
}

describe('«⇄» en el PDF', () => {
  it('textoParaHelvetica: la flecha de ida y regreso se escribe con un guion largo; lo demás no cambia', () => {
    expect(textoParaHelvetica('Avianca Bogotá ⇄ San Andrés')).toBe('Avianca Bogotá – San Andrés')
    expect(textoParaHelvetica('BOG → ADZ')).toBe('BOG – ADZ')
    expect(textoParaHelvetica('Cabañas «Agua Dulce» · 2 cuádruples — $ 4.352.838 “ok”')).toBe('Cabañas «Agua Dulce» · 2 cuádruples — $ 4.352.838 “ok”')
  })

  it('el PDF de N2 no trae «Ä» donde iba la flecha', async () => {
    const pdf = await compositorDePlantilla('trappvel')!(propsN2())
    const texto = textoDelPDF(pdf)
    // Con fuente estándar el texto viaja en la codificación de la fuente: 0xC4 es «Ä».
    expect(texto).not.toContain('Ä')
  }, 120_000)
})

describe('el hotel de una tarifa no queda solo arriba de una hoja', () => {
  it('N2: «Lord Pierre» cae en la misma hoja que su capítulo (San Andrés)', async () => {
    const { pdf } = await componerCotizacionTrappvel(propsN2())
    const m = medirPDF(pdf, FRANJA)
    const hojaDe = (re: RegExp) => m.hojas.findIndex(h => h.textos.some(t => re.test(t.texto)))
    const lord = hojaDe(/Lord Pierre/)
    const verdeMar = hojaDe(/Verde Mar/)
    expect(lord).toBeGreaterThanOrEqual(0)
    expect(lord).toBe(verdeMar)
  }, 120_000)
})
