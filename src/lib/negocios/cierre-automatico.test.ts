import { describe, it, expect } from 'vitest'
import { cierreAutomaticoActivo, cierraAlLlegar } from './cierre-automatico'

describe('cierreAutomaticoActivo', () => {
  it('solo el booleano true la enciende', () => {
    expect(cierreAutomaticoActivo({ cierre_automatico: { activa: true } })).toBe(true)
  })

  it('una config a medio escribir NO la enciende', () => {
    // Cerrar un negocio es irreversible desde la pantalla: no se dispara por accidente.
    expect(cierreAutomaticoActivo({ cierre_automatico: { activa: 'true' } })).toBe(false)
    expect(cierreAutomaticoActivo({ cierre_automatico: { activa: 1 } })).toBe(false)
    expect(cierreAutomaticoActivo({ cierre_automatico: {} })).toBe(false)
  })

  it('sin la clave, la linea se comporta como hoy', () => {
    expect(cierreAutomaticoActivo({})).toBe(false)
    expect(cierreAutomaticoActivo(null)).toBe(false)
    expect(cierreAutomaticoActivo(undefined)).toBe(false)
  })
})

describe('cierraAlLlegar', () => {
  const CIERRE_RESUELTO = { esCierre: true, gateCumplido: true }

  it('cierra cuando la linea lo declara, es la etapa de cierre y el gate esta cumplido', () => {
    expect(cierraAlLlegar(CIERRE_RESUELTO, true)).toBe(true)
  })

  it('con la linea apagada no cierra, aunque todo lo demas de', () => {
    expect(cierraAlLlegar(CIERRE_RESUELTO, false)).toBe(false)
  })

  it('una etapa que no es la de cierre nunca cierra', () => {
    // Llegar a Certificacion con factura emitida no termina el proceso.
    expect(cierraAlLlegar({ esCierre: false, gateCumplido: true }, true)).toBe(false)
  })

  it('la etapa de cierre con el gate SIN cumplir deja el caso en la bandeja', () => {
    // Es Facturacion haciendo su trabajo: sala de espera de los que llegan sin factura.
    expect(cierraAlLlegar({ esCierre: true, gateCumplido: false }, true)).toBe(false)
  })

  it('⚠️ si el gate NO se pudo comprobar, NO cierra', () => {
    // Cerrar por no poder leer el estado convierte una falla de lectura en un negocio
    // cerrado, y eso no se deshace desde la pantalla.
    expect(cierraAlLlegar({ esCierre: true, gateCumplido: null }, true)).toBe(false)
  })
})
