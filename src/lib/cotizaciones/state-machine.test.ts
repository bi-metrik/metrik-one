import { describe, it, expect } from 'vitest'
import {
  canTransition,
  validateCorregir,
  validateAceptar,
  isEditable,
  getAccionesDisponibles,
} from './state-machine'
import { cobradoConfirmado } from '@/lib/cobros/saldo-negocio'

/**
 * Corregir una cotización aceptada. Lo que se prueba aquí es el criterio puro; las dos
 * condiciones del negocio llegan ya resueltas (la de etapa como booleano, la calcula
 * `hayCotizacionEditableEnEtapa` y se prueba en ./etapa-editable.test.ts; la de plata
 * como número, la calcula `cobradoConfirmado` y aquí se compone con ella de verdad en
 * vez de escribir el número a mano).
 *
 * ── Mutaciones corridas contra estas pruebas (2026-09-03) ──────────────────
 *
 * Cada una se aplicó al código, se corrió vitest y se restauró. Ninguna quedó viva:
 *
 * 1. Borrar el bloque `if (recaudo > 0)` de `validateCorregir` → caen 3: 'ya entró
 *    plata', 'un solo peso' y 'un abono con fecha… sí frena'.
 * 2. `recaudo > 0` → `recaudo > 1_000_000` (un umbral "de materialidad" inventado) →
 *    cae 1: 'un solo peso recibido ya frena'. Es la única que fija que el corte es
 *    cualquier peso; las otras usan montos grandes y la dejarían pasar.
 * 3. Aceptar el recaudo sin medir (`typeof recaudo !== 'number' …` → `false`) → cae 1:
 *    'sin medir el recaudo NO deja corregir'.
 * 4. Mover la guarda de plata ANTES de la de etapa → cae 1: 'con plata Y etapa
 *    avanzada, el motivo que se reporta es la etapa'.
 * 5. Quitarle a `cobradoConfirmado` el `if (!c.fecha) continue` (o sea, sumar también
 *    las cuotas programadas) → caen 3, dos de aquí y una de saldo-negocio.test.ts. Es
 *    la que demuestra que la guarda cuelga del criterio del producto y no de una copia.
 */
describe('validateCorregir', () => {
  it('deja corregir una aceptada mientras el negocio no avanzó de etapa ni recibió plata', () => {
    const r = validateCorregir({
      currentStatus: 'aceptada',
      totalPrice: 1_000_000,
      negocioEnEtapaEditable: true,
      recaudoConfirmado: 0,
    })
    expect(r.valid).toBe(true)
    expect(r.error).toBeUndefined()
  })

  it('no deja corregir si el negocio ya avanzó de etapa, y lo dice mandando a duplicar', () => {
    const r = validateCorregir({
      currentStatus: 'aceptada',
      totalPrice: 1_000_000,
      negocioEnEtapaEditable: false,
      recaudoConfirmado: 0,
    })
    expect(r.valid).toBe(false)
    expect(r.error).toContain('duplica')
  })

  it('sin la condición de etapa resuelta NO deja corregir (la duda frena)', () => {
    // El campo es opcional en el contexto compartido: un llamador que se olvide de
    // calcularlo no puede colarse por omisión.
    const r = validateCorregir({ currentStatus: 'aceptada', totalPrice: 1_000_000, recaudoConfirmado: 0 })
    expect(r.valid).toBe(false)
    expect(r.error).toContain('etapa')
  })

  it('no deja corregir si ya entró plata, y dice cuánta en vez de un "no se puede" pelado', () => {
    // Misma guarda que el límite 2 de `revertirAprobacionPropuesta`: con plata
    // recibida, soltar `precio_aprobado` deja el saldo apuntando a un precio que ya no
    // existe. El caso queda con la salida de siempre: duplicar.
    const r = validateCorregir({
      currentStatus: 'aceptada',
      totalPrice: 5_000_000,
      negocioEnEtapaEditable: true,
      recaudoConfirmado: 2_500_000,
    })
    expect(r.valid).toBe(false)
    expect(r.error).toContain('pagos confirmados')
    expect(r.error).toContain('$2.500.000')
    expect(r.error).toContain('duplica')
  })

  it('un solo peso recibido ya frena: no hay umbral de materialidad aquí', () => {
    const r = validateCorregir({
      currentStatus: 'aceptada',
      totalPrice: 5_000_000,
      negocioEnEtapaEditable: true,
      recaudoConfirmado: 1,
    })
    expect(r.valid).toBe(false)
  })

  it('sin medir el recaudo NO deja corregir (la duda frena, igual que con la etapa)', () => {
    const r = validateCorregir({
      currentStatus: 'aceptada',
      totalPrice: 1_000_000,
      negocioEnEtapaEditable: true,
    })
    expect(r.valid).toBe(false)
    expect(r.error).toContain('pagos confirmados')
  })

  it('con plata Y etapa avanzada, el motivo que se reporta es la etapa', () => {
    // El orden importa para el mensaje: la ventana de etapa es la regla principal y la
    // que el operador puede entender sin abrir cobros. Fija cuál se dice primero.
    const r = validateCorregir({
      currentStatus: 'aceptada',
      totalPrice: 1_000_000,
      negocioEnEtapaEditable: false,
      recaudoConfirmado: 3_000_000,
    })
    expect(r.valid).toBe(false)
    expect(r.error).toContain('etapa')
  })

  it.each(['borrador', 'enviada', 'rechazada', 'vencida'] as const)(
    'no corrige una cotización %s (no hay aprobación que soltar)',
    (estado) => {
      const r = validateCorregir({
        currentStatus: estado,
        totalPrice: 1_000_000,
        negocioEnEtapaEditable: true,
        recaudoConfirmado: 0,
      })
      expect(r.valid).toBe(false)
      expect(r.error).toContain('aceptada')
    },
  )
})

describe('transiciones', () => {
  it('aceptada → borrador es una transición válida', () => {
    expect(canTransition('aceptada', 'borrador')).toBe(true)
  })

  it('aceptada no salta a enviada ni a rechazada: el único camino de vuelta es borrador', () => {
    expect(canTransition('aceptada', 'enviada')).toBe(false)
    expect(canTransition('aceptada', 'rechazada')).toBe(false)
  })

  it('vencida sigue siendo terminal', () => {
    expect(canTransition('vencida', 'borrador')).toBe(false)
  })
})

describe('lo que NO cambia al abrir la corrección', () => {
  it('una aceptada sigue sin ser editable en el editor', () => {
    // El editor solo abre borradores. La corrección primero devuelve la cotización a
    // borrador; sin eso, aceptada editable dejaría cambiar el precio aprobado en vivo.
    expect(isEditable('aceptada')).toBe(false)
    expect(isEditable('borrador')).toBe(true)
  })

  it('el catálogo de acciones por estado no ofrece corregir (no conoce la etapa)', () => {
    expect(getAccionesDisponibles('aceptada')).toEqual(['duplicate', 'view'])
  })

  it('aceptar sigue exigiendo que la cotización esté enviada', () => {
    expect(validateAceptar({ currentStatus: 'enviada', totalPrice: 1 }).valid).toBe(true)
    expect(validateAceptar({ currentStatus: 'aceptada', totalPrice: 1 }).valid).toBe(false)
  })
})

/**
 * La guarda de plata compuesta con quien mide la plata. Sin esto, la prueba de arriba
 * solo verifica que un número mayor que cero frena; esta verifica que el número sea el
 * que el resto del producto llama "recaudo confirmado" y no la suma de todo lo
 * registrado, que incluiría cuotas que nadie ha pagado.
 */
describe('validateCorregir + cobradoConfirmado (el criterio de pago confirmado)', () => {
  const base = { currentStatus: 'aceptada' as const, totalPrice: 4_000_000, negocioEnEtapaEditable: true }

  it('una cuota programada sin fecha no es plata recibida: sigue dejando corregir', () => {
    const recaudo = cobradoConfirmado([
      { monto: 2_000_000, fecha: null },
      { monto: 2_000_000, fecha: null },
    ])
    expect(recaudo).toBe(0)
    expect(validateCorregir({ ...base, recaudoConfirmado: recaudo }).valid).toBe(true)
  })

  it('un cobro anulado (monto 0 con fecha) tampoco frena', () => {
    const recaudo = cobradoConfirmado([{ monto: 0, fecha: '2026-08-20' }])
    expect(recaudo).toBe(0)
    expect(validateCorregir({ ...base, recaudoConfirmado: recaudo }).valid).toBe(true)
  })

  it('un abono con fecha, entre cuotas programadas, sí frena', () => {
    const recaudo = cobradoConfirmado([
      { monto: 1_200_000, fecha: '2026-08-20' },
      { monto: 2_800_000, fecha: null },
    ])
    expect(recaudo).toBe(1_200_000)
    const r = validateCorregir({ ...base, recaudoConfirmado: recaudo })
    expect(r.valid).toBe(false)
    expect(r.error).toContain('$1.200.000')
  })
})
