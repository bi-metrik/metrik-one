import { describe, expect, it } from 'vitest'
import { conAnticipo, leerAnticipo, normalizarAnticipo } from './anticipo'
import { serviciosDelDocumento } from './servicios-del-documento'
import { esTren, sinCancelacion, nombresParaLaPropuesta } from './modelo-documento'
import { documentoClienteSinRevisar } from '@/lib/cotizaciones/duplicar-opciones'
import { usaMotorHtml } from '@/lib/pdf/plantillas-cotizacion'

describe('anticipo (decisión 3)', () => {
  it('normaliza lo que manda el navegador', () => {
    expect(normalizarAnticipo({ monto: '$ 5.421.000', texto: '  Bloquea   hoteles ' })).toEqual({ ok: true, anticipo: { monto: 5_421_000, texto: 'Bloquea hoteles' } })
    expect(normalizarAnticipo({ monto: 1500000 })).toEqual({ ok: true, anticipo: { monto: 1_500_000, texto: null } })
    // Vacío o cero = sin anticipo.
    expect(normalizarAnticipo({ monto: '' })).toEqual({ ok: true, anticipo: null })
    expect(normalizarAnticipo({ monto: 0, texto: 'x' })).toEqual({ ok: true, anticipo: null })
    expect(normalizarAnticipo(null)).toEqual({ ok: true, anticipo: null })
    // Basura o cifras absurdas, error.
    expect(normalizarAnticipo({ monto: -5 }).ok).toBe(false)
    expect(normalizarAnticipo({ monto: 5_000_000_000 }).ok).toBe(false)
    expect(normalizarAnticipo('x').ok).toBe(false)
  })

  it('se lee del jsonb sin confiar en él', () => {
    expect(leerAnticipo({ anticipo: { monto: 100, texto: '' } })).toEqual({ monto: 100, texto: null })
    expect(leerAnticipo({ anticipo: { monto: '100' } })).toBeNull()
    expect(leerAnticipo({ anticipo: { monto: 0 } })).toBeNull()
    expect(leerAnticipo({ titular: 'x' })).toBeNull()
    expect(leerAnticipo(null)).toBeNull()
  })

  it('convive con el texto: quien guarda el texto conserva el anticipo, y viceversa', () => {
    const a = { monto: 100, texto: null }
    expect(conAnticipo({ titular: 'T' }, a)).toEqual({ titular: 'T', anticipo: a })
    expect(conAnticipo(null, a)).toEqual({ anticipo: a })
    expect(conAnticipo({ titular: 'T', anticipo: a }, null)).toEqual({ titular: 'T' })
    expect(conAnticipo(null, null)).toBeNull()
  })

  it('la copia de una cotización no hereda el anticipo', () => {
    expect(documentoClienteSinRevisar({ titular: 'T', revisado_en: 'x', anticipo: { monto: 1 } })).toEqual({
      titular: 'T', revisado_en: null, revisado_por: null, revisado_por_nombre: null,
    })
    expect(documentoClienteSinRevisar({ anticipo: { monto: 1 } })).toBeNull()
  })
})

describe('motor html por workspace', () => {
  it('solo con la plantilla de Trappvel y `documento_viaje.motor = html`', () => {
    expect(usaMotorHtml('trappvel', { documento_viaje: { motor: 'html' } })).toBe(true)
    expect(usaMotorHtml('trappvel', { documento_viaje: { motor: 'react-pdf' } })).toBe(false)
    expect(usaMotorHtml('trappvel', { documento_viaje: { pie: 'x' } })).toBe(false)
    expect(usaMotorHtml('trappvel', {})).toBe(false)
    expect(usaMotorHtml('trappvel', null)).toBe(false)
    expect(usaMotorHtml('termotech', { documento_viaje: { motor: 'html' } })).toBe(false)
  })
})

describe('servicios del documento (pendiente del PR 1)', () => {
  const traslado = { nombre: 'AEROPUERTO - HOTEL', grupo: 'traslado: Traslado en Madrid' }
  it('el día asignado manda sobre la fecha leída; las tarifas viajan', () => {
    const s = serviciosDelDocumento([{ ...traslado, dia_relativo: 2, tarifas: [0, 2] }], '2026-12-10')
    expect(s).toEqual([{ tipo: 'traslado', descripcion: 'AEROPUERTO - HOTEL', fecha: '11 dic 2026', hora: null, tarifas: [0, 2] }])
  })
  it('sin día ni fecha de inicio, la fecha leída (o ninguna)', () => {
    const s = serviciosDelDocumento([{ ...traslado, dia_relativo: 3 }], null)
    expect(s[0].fecha).toBeNull()
    expect(s[0]).not.toHaveProperty('tarifas')
  })
  it('lo que no es traslado ni actividad no entra', () => {
    expect(serviciosDelDocumento([{ nombre: 'HOTEL X', grupo: 'hotel: Hotel en Madrid' }], '2026-12-10')).toEqual([])
  })
})

describe('trenes y cancelaciones', () => {
  it('una estación en un solo extremo es el traslado al tren, no el tren', () => {
    expect(esTren('Hotel - estación Puerta de Atocha · Privado')).toBe(false)
    expect(esTren('Barcelona Sants - hotel · Compartido')).toBe(false)
    expect(esTren('Madrid Atocha - Barcelona Sants')).toBe(true)
    expect(esTren('Paris Nord - Amsterdam Centraal · Eurostar 9325')).toBe(true)
  })
  it('la cancelación del proveedor se quita también pegada a la descripción', () => {
    expect(sinCancelacion('Vestuarios y museo. Cancelación: gratuita hasta 01/12/2026')).toBe('Vestuarios y museo.')
    expect(sinCancelacion('Tour del estadio · 2 h · Cancelación: gratuita')).toBe('Tour del estadio · 2 h')
    expect(sinCancelacion('Cancelación: no reembolsable')).toBeNull()
  })
  it('nombres: los de menores solo con autorización, y solo el de pila', () => {
    const v = [{ nombre: 'Laura Ocampo', menor: false }, { nombre: 'Isabela', menor: true }]
    expect(nombresParaLaPropuesta(v, false)).toEqual(['Laura'])
    expect(nombresParaLaPropuesta(v, true)).toEqual(['Laura', 'Isabela'])
  })
})
