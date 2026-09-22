import { describe, it, expect } from 'vitest'
import { anticipoEsperado, estadoAnticipo, notaAnticipoCubierto } from './anticipo-cubierto'

describe('cuánto es el anticipo', () => {
  it('Plan 1 es la mitad del precio, redondeada', () => {
    expect(anticipoEsperado(850_000, 1)).toBe(425_000)
    expect(anticipoEsperado(637_501, 1)).toBe(318_751)
  })

  it('Plan 2 y la ausencia de plan exigen el precio completo', () => {
    expect(anticipoEsperado(850_000, 2)).toBe(850_000)
    expect(anticipoEsperado(850_000, null)).toBe(850_000)
  })
})

// Hasta 2026-09-22 la tolerancia era de UN peso (`cobrado >= esperado - 1`), mientras los
// gates `saldo_cero` y `saldo:handoff` y el salto de etapa perdonaban $1.000. Decisión de
// Mauricio (2026-08-06): el piso de materialidad aplica a todo el sistema.
describe('cuándo el anticipo está cubierto: el mismo piso que los gates de saldo', () => {
  it('el anticipo pagado completo cubre', () => {
    expect(estadoAnticipo(425_000, 425_000)).toEqual({ cubierto: true, faltante: 0 })
  })

  it('pagado de más también cubre, y no reporta faltante', () => {
    expect(estadoAnticipo(425_000, 1_126_812)).toEqual({ cubierto: true, faltante: 0 })
  })

  it('un faltante de $261 cubre y queda nombrado', () => {
    expect(estadoAnticipo(1_195_159, 1_194_898)).toEqual({ cubierto: true, faltante: 261 })
  })

  // Piso literal a propósito: si alguien mueve la constante, esto tiene que hablar del
  // número que decidió el negocio.
  it('el borde del piso entra: faltan $1.000 y cubre', () => {
    expect(estadoAnticipo(425_000, 424_000)).toEqual({ cubierto: true, faltante: 1_000 })
  })

  it('un peso por encima del piso ya no cubre', () => {
    expect(estadoAnticipo(425_000, 423_999)).toEqual({ cubierto: false, faltante: 1_001 })
  })

  it('un faltante real sigue sin cubrir', () => {
    expect(estadoAnticipo(425_000, 0).cubierto).toBe(false)
    expect(estadoAnticipo(850_000, 425_000).cubierto).toBe(false)
  })

  // Se queda como estaba: sin monto de anticipo no hay nada que dar por cubierto. El
  // honorario en cero deliberado lo resuelve `anticipoCubiertoPorSaldo` antes de llegar aquí.
  it('con anticipo esperado de 0 o menos no cubre', () => {
    expect(estadoAnticipo(0, 0).cubierto).toBe(false)
    expect(estadoAnticipo(0, 500_000).cubierto).toBe(false)
    expect(estadoAnticipo(-10, 0).cubierto).toBe(false)
  })

  it('un cobrado no numérico no cubre', () => {
    expect(estadoAnticipo(425_000, Number.NaN).cubierto).toBe(false)
  })
})

// La tolerancia deja avanzar, no convierte el faltante en pago. La nota que queda en el
// bloque y en el timeline no puede decir "cubierto" a secas sobre un anticipo incompleto.
describe('la nota del cierre automático no esconde el faltante', () => {
  it('sin faltante, la nota de siempre', () => {
    expect(notaAnticipoCubierto(0)).toBe(
      'Anticipo cubierto por el saldo del negocio (reparto/otro pago); gate cerrado automáticamente.',
    )
  })

  it('con faltante, nombra la cifra y dice que no se da por pagado', () => {
    const nota = notaAnticipoCubierto(261)
    expect(nota).toMatch(/faltante de \$\s?261/)
    expect(nota).toContain('dentro del piso de materialidad')
    expect(nota).toContain('no se da por pagado')
  })

  // `activity_log.contenido` tiene CHECK de 280 caracteres: una nota más larga tumba el
  // INSERT del timeline.
  it('cabe en el timeline aun con el faltante más largo posible', () => {
    expect(notaAnticipoCubierto(1_000).length).toBeLessThanOrEqual(280)
  })
})
