import { describe, it, expect } from 'vitest'
import {
  decidirEmisionGrupo,
  mensajeInterseccionParcial,
  type CuentaExistente,
} from './idempotencia-cuenta'

// Ids del caso real (workspace metrik, AFI International Group, septiembre de 2026).
const A = '44752727'
const B = 'e784c329'
const C = '4d8d7098'
const GRUPO = [A, B, C]

const cuenta = (numero: string, estado: string, cobros: string[]): CuentaExistente => ({
  id: `id-${numero}`, numero, estado, cobros_ids: cobros,
})

describe('decidirEmisionGrupo', () => {
  it('sin cuentas que crucen, emite', () => {
    expect(decidirEmisionGrupo(GRUPO, [])).toEqual({ accion: 'emitir' })
  })

  it('la agrupada ya emitida y la de licencias en el mismo mes: ya emitida', () => {
    const d = decidirEmisionGrupo(GRUPO, [
      cuenta('CC-2026-09-002', 'emitida_pendiente_aprobacion', GRUPO),
      cuenta('CC-2026-09-003', 'emitida_pendiente_aprobacion', ['cfca24eb']),
    ])
    expect(d.accion).toBe('ya_emitida')
    if (d.accion === 'ya_emitida') {
      // La de licencias no cruza: no aparece como la cuenta que cubre el grupo.
      expect(d.cuentas.map((c) => c.numero)).toEqual(['CC-2026-09-002'])
    }
  })

  it('una cuenta de otro plan que no cruza no bloquea', () => {
    expect(decidirEmisionGrupo(GRUPO, [
      cuenta('CC-2026-09-003', 'emitida_pendiente_aprobacion', ['cfca24eb']),
    ])).toEqual({ accion: 'emitir' })
  })

  it('una cuenta anulada no bloquea, aunque contenga el grupo entero', () => {
    expect(decidirEmisionGrupo(GRUPO, [cuenta('CC-2026-09-002', 'anulada', GRUPO)])).toEqual({ accion: 'emitir' })
  })

  it('la anulada no cuenta para la cobertura: anulada + viva parcial = parcial', () => {
    const d = decidirEmisionGrupo(GRUPO, [
      cuenta('CC-2026-08-001', 'anulada', [B, '83218c1c', A]),
      cuenta('CC-2026-09-010', 'enviada', [A]),
    ])
    expect(d.accion).toBe('parcial')
    if (d.accion === 'parcial') {
      expect(d.cubiertos).toEqual([A])
      expect(d.sinCuenta).toEqual([B, C])
      expect(d.cuentas.map((c) => c.numero)).toEqual(['CC-2026-09-010'])
    }
  })

  it('cobertura repartida entre dos cuentas vivas cuenta como ya emitida', () => {
    const d = decidirEmisionGrupo(GRUPO, [
      cuenta('CC-1', 'pagada', [A, B]),
      cuenta('CC-2', 'enviada', [C]),
    ])
    expect(d.accion).toBe('ya_emitida')
  })

  it('una cuenta viva que cubre el grupo y mas cobros sigue siendo ya emitida', () => {
    // El grupo de hoy puede ser mas chico que el del dia 10 si un cobro se pago.
    expect(decidirEmisionGrupo([A, B], [cuenta('CC-2026-09-002', 'enviada', GRUPO)]).accion).toBe('ya_emitida')
  })

  it('borrador tambien bloquea: solo la anulacion libera los cobros', () => {
    expect(decidirEmisionGrupo(GRUPO, [cuenta('CC-X', 'borrador', GRUPO)]).accion).toBe('ya_emitida')
  })

  it('el mensaje de parcial nombra las cuentas y los cobros sueltos', () => {
    const d = decidirEmisionGrupo(GRUPO, [cuenta('CC-2026-09-002', 'enviada', [A, B])])
    if (d.accion !== 'parcial') throw new Error('se esperaba parcial')
    const m = mensajeInterseccionParcial(d)
    expect(m).toContain('2 de 3')
    expect(m).toContain('CC-2026-09-002')
    expect(m).toContain(C)
  })
})
