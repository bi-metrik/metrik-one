import { describe, it, expect } from 'vitest'
import { avisoTelefono } from './phone-input'

/**
 * Los valores están medidos en producción el 2026-09-02: las 10 filas de
 * `contactos` cuyo teléfono no era un teléfono, todas escritas a mano (ninguna
 * llegó por el webhook de Meta).
 *
 * ⚠️ Lo que se prueba aquí NO es la regla. La regla vive en la base
 * (`telefono_valido`, migración `20260902230000`) y la impone un trigger. Este
 * aviso es deliberadamente más estrecho, y estas pruebas existen para fijar esa
 * asimetría: **ningún número legítimo puede dispararlo**. Un falso positivo aquí
 * bloquea a alguien que está escribiendo bien su teléfono.
 */

describe('avisoTelefono', () => {
  it('avisa del usuario de WhatsApp escrito en la casilla del teléfono', () => {
    for (const v of ['@doritasrg', '@beatrixes', '@ALRA272007', 'isa.paca', 'None', '@AdMarif']) {
      expect(avisoTelefono(v), v).not.toBeNull()
    }
  })

  it('calla ante cualquier forma en que la gente escribe un número', () => {
    for (const v of [
      '',
      '3147753962',
      '300 123 4567',
      '(601) 743 2100',
      '300-123-4567',
      '+57 300 123 4567',
      '300.123.4567',
      '3001234567.0',
    ]) {
      expect(avisoTelefono(v), v).toBeNull()
    }
  })

  it('calla mientras el número se está escribiendo', () => {
    // El aviso se pinta en cada tecla: no puede salir a mitad de un número bueno.
    for (const v of ['3', '31', '314', '3147', '31477539']) {
      expect(avisoTelefono(v), v).toBeNull()
    }
  })
})
