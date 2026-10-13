/**
 * El paquete de viaje (F4-4) leído del binario del PDF: lo que imprime de verdad.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import PaqueteViajePDF, { type PaqueteViajePDFProps } from './paquete-viaje-pdf'
import { textoDelPDF } from './texto-del-pdf'

const props: PaqueteViajePDFProps = {
  agencia: 'Trappvel',
  colorPrimario: '#e63380',
  viajero: 'Valeria Prueba',
  titulo: 'PRUEBA · Cusco y Valle Sagrado',
  fechas: '21 nov 2026 – 25 nov 2026',
  itinerario: [
    { fecha: '2026-11-21', titulo: 'Día 1 · 21 nov 2026', lineas: ['Vuelo LATAM · localizador XK2L9'] },
    { fecha: null, titulo: 'Durante el viaje', lineas: ['Asistencia médica'] },
  ],
  vouchers: [{ nombre: 'Vuelo LATAM', detalle: 'localizador XK2L9', adjunto: true }],
  antesDeViajar: ['Lleva el pasaporte vigente.'],
  contactosEmergencia: 'Edgar · 313 000 0000',
  nota: 'Lleva el registro civil del bebé.',
  comercial: 'Daniela',
}

const plano = (t: string) => t.replace(/\s+/g, ' ')

describe('PaqueteViajePDF', () => {
  it('imprime itinerario, vouchers, antes de viajar, emergencia y la nota', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = plano(textoDelPDF(Buffer.from(await renderToBuffer(createElement(PaqueteViajePDF, props) as any))))
    for (const s of [
      'PRUEBA · Cusco y Valle Sagrado', 'Itinerario día a día', 'Día 1 · 21 nov 2026', 'Durante el viaje',
      'Vuelo LATAM · localizador XK2L9 (adjunto al final)', 'Antes de viajar', 'Lleva el pasaporte vigente.',
      'Contactos de emergencia', 'Edgar · 313 000 0000', 'Lleva el registro civil del bebé.',
    ]) expect(t).toContain(s)
  })

  it('una letra que Helvetica no imprime se omite en vez de romper el PDF', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buf = await renderToBuffer(createElement(PaqueteViajePDF, { ...props, viajero: 'Валерия Prueba' }) as any)
    expect(plano(textoDelPDF(Buffer.from(buf)))).toContain('Prueba')
  })
})
