import { describe, it, expect } from 'vitest'
import {
  esPorcionRepartoPropuesto,
  porcionConfirmadaPorFinanciera,
  esPorcionPendienteDeConfirmar,
  sumarRecaudoConfirmado,
  recaudoPendienteDeConfirmar,
  type CobroParaRecaudo,
} from './recaudo-confirmado'

// Los tres orígenes que existen de verdad en producción SOENA (medidos 2026-08-06).
const propuestaComercial: CobroParaRecaudo = { monto: 350906, split_json: { origen: 'comercial' } }
const repartoFinanciera: CobroParaRecaudo = { monto: 605625, split_json: {} }
const correccionAdmin: CobroParaRecaudo = { monto: 318750, split_json: { origen: 'correccion_2026_08_06' } }
const cobroNormal: CobroParaRecaudo = { monto: 701812, split_json: null }

describe('qué porción está a la espera del área financiera', () => {
  it('solo la propuesta del comercial', () => {
    expect(esPorcionRepartoPropuesto(propuestaComercial)).toBe(true)
  })

  // La financiera es quien confirma: no tiene que confirmarse a sí misma. Es el reparto
  // de julio (ref 375720883, V0043/V0064), que debe seguir contando igual que antes.
  it('un reparto hecho por la financiera NO está pendiente', () => {
    expect(esPorcionRepartoPropuesto(repartoFinanciera)).toBe(false)
  })

  it('la corrección administrativa del 06-ago NO está pendiente', () => {
    expect(esPorcionRepartoPropuesto(correccionAdmin)).toBe(false)
  })

  it('un cobro normal, sin split, nunca está pendiente', () => {
    expect(esPorcionRepartoPropuesto(cobroNormal)).toBe(false)
    expect(esPorcionRepartoPropuesto(null)).toBe(false)
    expect(esPorcionRepartoPropuesto(undefined)).toBe(false)
  })
})

describe('el recaudo que sostiene una decisión de avance', () => {
  // EL CASO QUE ORIGINÓ LA REGLA. V0287, 2026-08-05: el comercial le repartió $350.906 de
  // una referencia ajena y esa mitad cerró sola el gate de anticipo.
  it('la propuesta del comercial NO suma mientras la financiera no confirme', () => {
    expect(sumarRecaudoConfirmado([propuestaComercial], false)).toBe(0)
  })

  it('cuando la financiera confirma, esa misma plata sí suma', () => {
    expect(sumarRecaudoConfirmado([propuestaComercial], true)).toBe(350906)
  })

  // El negocio con plata propia suficiente no debe sufrir fricción: el efecto es
  // proporcional, no un freno al negocio completo.
  it('la plata propia sigue contando aunque haya una porción sin confirmar', () => {
    expect(sumarRecaudoConfirmado([propuestaComercial, cobroNormal], false)).toBe(701812)
  })

  it('sin porciones pendientes, suma exactamente igual que antes del cambio', () => {
    const cobros = [cobroNormal, repartoFinanciera, correccionAdmin]
    const total = 701812 + 605625 + 318750
    expect(sumarRecaudoConfirmado(cobros, false)).toBe(total)
    expect(sumarRecaudoConfirmado(cobros, true)).toBe(total)
  })

  // CONTROL POSITIVO del brief: si el default quedara al revés, este test cae y avisa que
  // se está congelando la operación normal.
  it('los 75 cobros normales del workspace no se ven afectados', () => {
    const comoProduccion: CobroParaRecaudo[] = Array.from({ length: 75 }, () => ({
      monto: 100000,
      split_json: null,
    }))
    expect(sumarRecaudoConfirmado(comoProduccion, false)).toBe(7500000)
  })

  it('respeta los tipos que el llamador ya excluía (devolucion_pendiente del handoff)', () => {
    const cobros: CobroParaRecaudo[] = [
      { monto: 500000, split_json: null, tipo_cobro: 'pago' },
      { monto: -80000, split_json: null, tipo_cobro: 'devolucion_pendiente' },
    ]
    expect(sumarRecaudoConfirmado(cobros, false, { excluirTipos: ['devolucion_pendiente'] })).toBe(500000)
  })

  it('aguanta montos nulos y listas vacías sin romperse', () => {
    expect(sumarRecaudoConfirmado([{ monto: null, split_json: null }], false)).toBe(0)
    expect(sumarRecaudoConfirmado([], false)).toBe(0)
    expect(sumarRecaudoConfirmado(null, false)).toBe(0)
  })
})

describe('lo que quedó sin confirmar, para poder nombrarlo en pantalla', () => {
  it('reporta el monto a la espera de la financiera', () => {
    expect(recaudoPendienteDeConfirmar([propuestaComercial, cobroNormal], false)).toBe(350906)
  })

  it('con el check puesto ya no hay nada pendiente', () => {
    expect(recaudoPendienteDeConfirmar([propuestaComercial], true)).toBe(0)
  })

  // Invariante que amarra las dos funciones: lo confirmado + lo pendiente = el total de
  // siempre. Si alguien cambia una sin la otra, el saldo empieza a perder plata.
  it('confirmado + pendiente reconstruye el total de siempre', () => {
    const cobros = [propuestaComercial, cobroNormal, repartoFinanciera]
    const total = 350906 + 701812 + 605625
    expect(sumarRecaudoConfirmado(cobros, false) + recaudoPendienteDeConfirmar(cobros, false)).toBe(total)
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// La confirmación vive en la PORCIÓN (2026-09-16)
//
// Caso real (SOENA, V0498): la financiera aceptó el 12-sep el reparto de la referencia
// 385563083 ($637.500 entre V0497 y V0498). El 15-sep entraron DOS pagos ePayco nuevos a
// V0498 y `registrarPagoEnNegocio` bajó `conciliado` — un update por negocio, ciego a la
// referencia. Con el flag abajo, la porción ya aceptada dejó de contar y el gate
// `saldo:handoff` pasó a exigir $212.761 cuando al cliente le faltaban $261.
// ════════════════════════════════════════════════════════════════════════════════

const porcionAceptada: CobroParaRecaudo = {
  monto: 212500,
  split_json: { origen: 'comercial', confirmado_at: '2026-09-12T01:34:47.722Z' },
}
// Los dos pagos ePayco que entraron después a V0498 (montos de producción).
const pagoPosteriorTarifa: CobroParaRecaudo = { monto: 769898, split_json: null }
const pagoPosteriorSaldo: CobroParaRecaudo = { monto: 212500, split_json: null }

describe('una porción aceptada no la desconfirma un pago posterior', () => {
  it('la marca de la financiera se reconoce en la porción', () => {
    expect(porcionConfirmadaPorFinanciera(porcionAceptada)).toBe(true)
    expect(porcionConfirmadaPorFinanciera(propuestaComercial)).toBe(false)
  })

  it('cuenta aunque el negocio ya no esté conciliado', () => {
    expect(esPorcionPendienteDeConfirmar(porcionAceptada, false)).toBe(false)
    expect(sumarRecaudoConfirmado([porcionAceptada], false)).toBe(212500)
  })

  it('y deja de figurar como pendiente de confirmar', () => {
    expect(recaudoPendienteDeConfirmar([porcionAceptada], false)).toBe(0)
  })

  // El número exacto del incidente: V0498 debía $1.195.159 (honorario 425.000 + tarifa
  // 770.159) y tenía registrados $1.194.898. Le faltaban $261, no $212.761.
  it('V0498 queda a $261 del valor a recaudar, no a $212.761', () => {
    const cobros = [porcionAceptada, pagoPosteriorTarifa, pagoPosteriorSaldo]
    const valorARecaudar = 425000 + 770159
    expect(valorARecaudar - sumarRecaudoConfirmado(cobros, false)).toBe(261)
  })

  it('el reparto que TODAVÍA nadie aceptó sigue sin contar', () => {
    expect(esPorcionPendienteDeConfirmar(propuestaComercial, false)).toBe(true)
    expect(sumarRecaudoConfirmado([propuestaComercial], false)).toBe(0)
    expect(recaudoPendienteDeConfirmar([propuestaComercial], false)).toBe(350906)
  })

  // Lo aceptado antes de que existiera la marca solo tiene el flag por negocio: mientras
  // ese flag esté puesto tiene que seguir contando igual que antes del cambio.
  it('el flag por negocio sigue valiendo como confirmación heredada', () => {
    expect(sumarRecaudoConfirmado([propuestaComercial], true)).toBe(350906)
  })

  // Una marca vacía no es una fecha. Si contara, cualquier escritura descuidada sobre
  // `split_json` confirmaría plata que nadie miró.
  it('una marca vacía no confirma nada', () => {
    const sinFecha: CobroParaRecaudo = { monto: 100, split_json: { origen: 'comercial', confirmado_at: '' } }
    const nula: CobroParaRecaudo = { monto: 100, split_json: { origen: 'comercial', confirmado_at: null } }
    expect(sumarRecaudoConfirmado([sinFecha, nula], false)).toBe(0)
  })

  it('confirmado + pendiente sigue reconstruyendo el total', () => {
    const cobros = [porcionAceptada, propuestaComercial, pagoPosteriorTarifa]
    const total = 212500 + 350906 + 769898
    expect(sumarRecaudoConfirmado(cobros, false) + recaudoPendienteDeConfirmar(cobros, false)).toBe(total)
  })
})
