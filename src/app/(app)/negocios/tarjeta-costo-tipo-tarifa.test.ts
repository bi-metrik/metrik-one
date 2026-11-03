/**
 * «Tarifa: Neta | Pública» en «Costo y precio» de la cotización por pasos (reunión con Trappvel del
 * 2026-10-22, punto 1), y el aviso de la autorización de datos pendiente (punto 4). Cifras
 * ficticias. Con `CAPTURAS_HTML=<carpeta>` deja el HTML de cada estado para las capturas del PR.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  ajustarOpcion: async () => ({ success: true }),
  elegirMonedaDeTarifa: async () => ({ success: true }),
  confirmarTarifaPorPasajero: async () => ({ success: true }),
}))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({
  agregarAdicional: async () => ({ success: true }),
  actualizarAdicional: async () => ({ success: true }),
  eliminarAdicional: async () => ({ success: true }),
}))

const { default: TarjetaCosto } = await import('./tarjeta-costo')
const { AvisoAutorizacionPendiente } = await import('./[id]/aviso-autorizacion-pendiente')
type Props = React.ComponentProps<typeof TarjetaCosto>

const NETA: Props = {
  itemId: 'traslado-1',
  editable: true,
  confirmada: {
    composicion: { adultos: 2, ninos: 0, infantes: 0 },
    costos: [{ tipo: 'adulto', cantidad: 2, unitarioCOP: 251_000, totalCOP: 502_000 }],
    costoTotalCOP: 502_000,
    moneda: 'COP',
    tasa: null,
    confirmadaEn: '2026-10-22T10:00:00Z',
  },
  preciosAMano: undefined,
  precioLinea: 590_588,
  costoLinea: 502_000,
  margenAplicado: 15,
  convencion: 'sobre_venta',
  administrativosPct: 0,
  pisoPct: 10,
  adicionales: [],
  adicionalesDisponible: true,
  margenCotizacion: { margenPct: 15, convencion: 'sobre_venta' },
  moneda: { moneda: 'COP', asumida: false, origen: 'captura', leida: 'COP', decision: null },
  onCambio: () => {},
  apilable: true,
  tipoTarifa: 'neta',
}
const PUBLICA: Props = { ...NETA, precioLinea: 502_000, margenAplicado: 0, tipoTarifa: 'publica' }

const pintar = (p: Props) => renderToStaticMarkup(React.createElement(TarjetaCosto, p))

function volcar(nombre: string, html: string) {
  const dir = process.env.CAPTURAS_HTML
  if (dir) writeFileSync(path.join(dir, `${nombre}.html`), html)
}

describe('«Tarifa: Neta | Pública» junto al margen', () => {
  it('Neta: marcada, con el margen de la cotización', () => {
    const html = pintar(NETA)
    volcar('tipo-tarifa-neta', html)
    expect(html).toContain('data-tipo-tarifa="neta"')
    expect(html).toMatch(/aria-checked="true"[^>]*data-elegir-tipo="neta"/)
    expect(html).toContain('15 %')
    expect(html).not.toContain('data-aviso-publica')
  })

  it('Pública con margen 0: lo dice, el cliente paga el precio público y no pide autorización por margen', () => {
    const html = pintar(PUBLICA)
    volcar('tipo-tarifa-publica', html)
    expect(html).toMatch(/aria-checked="true"[^>]*data-elegir-tipo="publica"/)
    expect(html).toContain('data-aviso-publica')
    expect(html).toContain('$502.000')
    // Con un mínimo del 10 %, una Neta al 0 % pediría autorización; la Pública no.
    expect(html).not.toContain('Con este margen necesitas autorización')
    expect(pintar({ ...PUBLICA, tipoTarifa: 'neta' })).toContain('Con este margen necesitas autorización')
  })

  it('propuesta por el tarifario: se dice de dónde salió y se puede cambiar', () => {
    const html = pintar({ ...PUBLICA, tipoPropuesto: true })
    expect(html).toContain('según el tarifario')
    expect(html).not.toMatch(/data-elegir-tipo="neta"[^>]*disabled/)
  })

  it('fuera de la cotización por pasos no aparece (la tarjeta es la de siempre)', () => {
    expect(pintar({ ...NETA, apilable: false })).not.toContain('data-tipo-tarifa')
  })
})

describe('el aviso de la autorización de datos pendiente', () => {
  it('dice que se arma pero no se envía', () => {
    const html = renderToStaticMarkup(React.createElement(AvisoAutorizacionPendiente))
    volcar('aviso-autorizacion', html)
    expect(html).toContain('Falta la autorización de datos del cliente')
    expect(html).toMatch(/Puedes armar y revisar la cotización\. No se puede enviar/)
  })
})
