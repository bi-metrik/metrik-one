import { describe, it, expect } from 'vitest'
import { telefonoCasilla25 } from './telefono-casilla-25'

// La casilla 25 lleva el número LOCAL de 7 dígitos, venga como venga. Los dos casos
// vivos están medidos contra producción (SOENA, bloque `rut`, 2026-09-17): 340
// negocios con teléfono, 116 de 7 dígitos y 42 de 10 dígitos que empiezan en `60`.

describe('telefonoCasilla25', () => {
  describe('caso A — ya viene el número local (116 casos en SOENA)', () => {
    it('deja los 7 dígitos tal cual', () => {
      expect(telefonoCasilla25('2324412')).toBe('2324412')
    })

    // El caso de la captura de Deisy: antes salía "602 2324412" y la DIAN lo rechazaba.
    it('no le pega el indicativo aunque el negocio sea del Valle', () => {
      expect(telefonoCasilla25('2324412')).not.toContain('602')
      expect(telefonoCasilla25('2324412')).toBe('2324412')
    })

    it('quita los separadores del número local', () => {
      expect(telefonoCasilla25('232-44 12')).toBe('2324412')
    })
  })

  describe('caso B — el RUT ya trae el indicativo (42 casos en SOENA)', () => {
    it('recorta los 3 primeros dígitos de un fijo 60X', () => {
      expect(telefonoCasilla25('6022324412')).toBe('2324412')
    })

    it('recorta igual con el indicativo de Bogotá', () => {
      expect(telefonoCasilla25('6016210800')).toBe('6210800')
    })

    it('recorta aunque venga con separadores', () => {
      expect(telefonoCasilla25('602 232 4412')).toBe('2324412')
    })
  })

  describe('celular — 10 dígitos que empiezan en 3', () => {
    // Un celular ES un número de 10 dígitos completo: recortarlo lo destruye.
    it('no lo toca', () => {
      expect(telefonoCasilla25('3159509103')).toBe('3159509103')
    })

    it('no lo recorta a 7 dígitos', () => {
      expect(telefonoCasilla25('3159509103')).toHaveLength(10)
    })

    // Con separadores la rama del celular es OBSERVABLE: sin ella el número caería
    // al "sin cambios" y volvería con los espacios. Sin este caso, borrar la rama
    // entera dejaría las pruebas en verde.
    it('lo reconoce como celular y lo deja en solo dígitos', () => {
      expect(telefonoCasilla25('315 950 9103')).toBe('3159509103')
    })
  })

  describe('lo que no se reconoce se devuelve sin cambios', () => {
    it('6 dígitos', () => {
      expect(telefonoCasilla25('232441')).toBe('232441')
    })

    it('8 dígitos', () => {
      expect(telefonoCasilla25('23244120')).toBe('23244120')
    })

    it('9 dígitos', () => {
      expect(telefonoCasilla25('232441200')).toBe('232441200')
    })

    it('10 dígitos que no empiezan ni en 3 ni en 60', () => {
      expect(telefonoCasilla25('5712324412')).toBe('5712324412')
    })

    it('un número con indicativo de país delante, que no se puede recortar a ciegas', () => {
      expect(telefonoCasilla25('+57 315 950 9103')).toBe('+57 315 950 9103')
    })

    it('texto que no es un teléfono', () => {
      expect(telefonoCasilla25('no tiene')).toBe('no tiene')
    })
  })

  describe('ausencias', () => {
    it('null', () => {
      expect(telefonoCasilla25(null)).toBeNull()
    })

    it('undefined', () => {
      expect(telefonoCasilla25(undefined)).toBeNull()
    })

    it('cadena vacía', () => {
      expect(telefonoCasilla25('')).toBe('')
    })
  })
})
