import { describe, expect, it } from 'vitest'

import { enlaceCorreo, enlaceWhatsApp, mensajeSolicitud, preguntasPendientes } from './solicitud-tarifas'

const base = { proveedor: 'Hotel Ficticio del Mar', contacto: 'Laura Gómez', agencia: 'Agencia Prueba', anio: 2027, tarifaCanal: null, ivaDeclarado: null, ivaIncluido: null }

describe('solicitud de tarifas', () => {
  it('pregunta neto o comisionable y el IVA mientras la ficha no lo sepa', () => {
    const texto = mensajeSolicitud(base)
    expect(texto).toMatch(/^Hola, Laura\./)
    expect(texto).toContain('tarifario 2027')
    expect(texto).toContain('netas o comisionables')
    expect(texto).toContain('¿Cobran IVA?')
  })

  it('no repite lo que la ficha ya sabe', () => {
    expect(preguntasPendientes({ tarifaCanal: 'neta', ivaDeclarado: true, ivaIncluido: false })).toEqual([])
    expect(preguntasPendientes({ tarifaCanal: 'neta', ivaDeclarado: true, ivaIncluido: null })).toHaveLength(1)
    expect(mensajeSolicitud({ ...base, contacto: null, tarifaCanal: 'comisionable', ivaDeclarado: false, ivaIncluido: false })).not.toContain('Y para cotizar bien')
  })

  it('enlaces de WhatsApp y correo solo con dato', () => {
    expect(enlaceWhatsApp('+573001234567', 'hola mundo')).toBe('https://wa.me/573001234567?text=hola%20mundo')
    expect(enlaceWhatsApp(null, 'x')).toBeNull()
    expect(enlaceCorreo('reservas@ficticio.example', 'Asunto', 'Cuerpo')).toBe('mailto:reservas@ficticio.example?subject=Asunto&body=Cuerpo')
    expect(enlaceCorreo('', 'a', 'b')).toBeNull()
  })
})
