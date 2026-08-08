import { describe, it, expect } from 'vitest'
import { aplicaSaltoPorSaldo, debeSaltarPorSaldo } from './salto-etapa'
import { valorARecaudar, type ModeloDinero } from '@/lib/upme/modelo-dinero'

describe('qué etapas participan del salto', () => {
  it('sin flag, se comporta como hasta ahora: solo las de cobro', () => {
    expect(aplicaSaltoPorSaldo({ stage: 'cobro', config_extra: {} })).toBe(true)
    expect(aplicaSaltoPorSaldo({ stage: 'venta', config_extra: {} })).toBe(false)
    expect(aplicaSaltoPorSaldo({ stage: 'ejecucion', config_extra: null })).toBe(false)
    expect(aplicaSaltoPorSaldo(null)).toBe(false)
  })

  // Pago UPME: la financiera PAGA a la UPME. Su stage es 'cobro' porque describe quién
  // ejecuta, no porque ahí se le cobre al cliente.
  it('el flag en falso protege una etapa de cobro (Pago UPME)', () => {
    expect(
      aplicaSaltoPorSaldo({ stage: 'cobro', config_extra: { saltar_si_saldo_cero: false } }),
    ).toBe(false)
  })

  // Precobro: gestión comercial. Si ya pagó, no hay nada que precobrar.
  it('el flag en verdadero habilita una etapa que no es de cobro (Precobro)', () => {
    expect(
      aplicaSaltoPorSaldo({ stage: 'venta', config_extra: { saltar_si_saldo_cero: true } }),
    ).toBe(true)
  })

  // Una config a medio escribir no debe cambiar el comportamiento en silencio.
  it('un flag que no es booleano se ignora', () => {
    expect(
      aplicaSaltoPorSaldo({ stage: 'venta', config_extra: { saltar_si_saldo_cero: 'true' } }),
    ).toBe(false)
    expect(
      aplicaSaltoPorSaldo({ stage: 'cobro', config_extra: { saltar_si_saldo_cero: 0 } }),
    ).toBe(true)
  })
})

describe('cuándo el saldo justifica el salto', () => {
  it('sin precio no salta nunca', () => {
    expect(debeSaltarPorSaldo(0, 0, false)).toBe(false)
    expect(debeSaltarPorSaldo(0, -500, false)).toBe(false)
  })

  it('con saldo pendiente no salta', () => {
    expect(debeSaltarPorSaldo(637500, 300000, false)).toBe(false)
    expect(debeSaltarPorSaldo(637500, 300000, true)).toBe(false)
  })

  it('sin conciliación, cualquier saldo cubierto salta', () => {
    expect(debeSaltarPorSaldo(637500, 0, false)).toBe(true)
    expect(debeSaltarPorSaldo(637500, -701812, false)).toBe(true)
  })

  // Caso V0121: el cobro de la tarifa UPME ($701.812) dejó el saldo en negativo y eso
  // hacía que el motor se saltara justamente la etapa de Pago UPME.
  it('con conciliación, el sobrepago entra en vez de pasar de largo', () => {
    expect(debeSaltarPorSaldo(637500, -701812, true)).toBe(false)
  })

  it('con conciliación, solo el pago exacto salta', () => {
    expect(debeSaltarPorSaldo(637500, 0, true)).toBe(true)
  })
})

// El residuo de redondeo NO es un sobrepago que conciliar. Exigir el cero absoluto aquí
// mientras el gate `saldo_cero` de la misma etapa tolera $1.000 dejaba una franja donde el
// motor retiene un caso que, una vez adentro, sus propios gates dan por cuadrado.
//
// Medido en SOENA el 2026-08-06: V0276 pagó $120 de más sobre $1.051.880 y quedó varado en
// Cobro; V0274 traía $688 y venía detrás. Ninguno tenía plata que resolver.
describe('el residuo inmaterial no retiene: una sola vara para todo el sistema', () => {
  // Piso de materialidad de Carmen (CFO). Se escribe literal a propósito: si alguien cambia
  // la constante, estas pruebas tienen que hablar del número que el negocio decidió.
  it('un sobrepago dentro de la tolerancia salta igual que el pago exacto', () => {
    expect(debeSaltarPorSaldo(1_051_880, -120, true)).toBe(true)   // V0276
    expect(debeSaltarPorSaldo(1_339_312, -688, true)).toBe(true)   // V0274
    expect(debeSaltarPorSaldo(637_500, -1_000, true)).toBe(true)   // el borde entra
  })

  it('un faltante dentro de la tolerancia también salta, igual que el gate saldo_cero', () => {
    expect(debeSaltarPorSaldo(637_500, 999, true)).toBe(true)
  })

  // La franja tolerada es angosta a propósito: un sobrepago real sigue entrando a conciliarse.
  it('pasada la tolerancia sigue reteniendo, por los dos lados', () => {
    expect(debeSaltarPorSaldo(637_500, -1_001, true)).toBe(false)
    expect(debeSaltarPorSaldo(637_500, 1_001, true)).toBe(false)
    expect(debeSaltarPorSaldo(637_500, -701_812, true)).toBe(false) // V0121, el caso original
  })

  // Sin `conciliar_sobrepago` la etapa nunca miró el sobrepago: cualquier saldo cubierto
  // saltaba y sigue saltando. La tolerancia no le agrega ni le quita nada.
  it('sin conciliación el comportamiento no cambia', () => {
    expect(debeSaltarPorSaldo(637_500, -701_812, false)).toBe(true)
    expect(debeSaltarPorSaldo(637_500, 999, false)).toBe(false)
  })
})

// El helper de arriba nunca estuvo mal: recibía un saldo mal calculado. Estos casos
// fijan la COMPOSICIÓN, que es donde estaba el defecto (2026-08-03): el saldo se mide
// contra `valorARecaudar(honorario, modelo)` — honorario + tarifa pasante — y NO contra
// `precio_aprobado` a secas, que es solo el honorario.
//
// ⚠️ Aplica al SALTO y a `sobrepago_conciliado`, NO al gate `saldo_cero`, que sigue
// midiendo el honorario. La diferencia no es un descuido: el recaudo de la tarifa lo
// controla `saldo:handoff` aguas arriba, y exigirlo otra vez en `saldo_cero` retendría
// negocios cuyo cliente pagó su honorario y cuya tarifa no entró por SOENA (medido:
// 32 casos abiertos). Aquí la fórmula nueva solo puede DESTRABAR, nunca retener de más.
describe('el saldo se compone contra el valor a recaudar, no contra el honorario', () => {
  const modeloCon = (tarifa: number): ModeloDinero => ({
    tarifa_upme: tarifa,
    aprobado_plan: 1,
    aprobado_honorario: 0,
  })

  // V0099: honorario $850.000 + tarifa $701.812 = $1.551.812, y el cliente pagó
  // exactamente eso. Estaba entrando a Cobro como si hubiera pagado de más.
  it('negocio pagado completo (honorario + tarifa) salta: saldo 0, no sobrepago', () => {
    const honorario = 850_000
    const tarifa = 701_812
    const cobrado = 1_551_812

    const precio = valorARecaudar(honorario, modeloCon(tarifa))
    expect(precio).toBe(cobrado)
    expect(debeSaltarPorSaldo(precio, precio - cobrado, true)).toBe(true)

    // Con la fórmula vieja el mismo caso daba sobrepago y quedaba retenido.
    expect(debeSaltarPorSaldo(honorario, honorario - cobrado, true)).toBe(false)
  })

  // V0025 / V0103: mismo esquema, pero falta el 50% del honorario del Plan 1.
  // Un faltante real tiene que seguir reteniendo con la fórmula nueva.
  it('faltante real sigue sin saltar aunque se cuente la tarifa', () => {
    const precio = valorARecaudar(850_000, modeloCon(701_812))
    const cobrado = 1_126_812
    expect(precio - cobrado).toBe(425_000)
    expect(debeSaltarPorSaldo(precio, precio - cobrado, true)).toBe(false)
  })

  // Sin tarifa confirmada el valor a recaudar es el honorario: el comportamiento de
  // los negocios que no cobran tarifa (y de cualquier otro workspace) no cambia.
  it('sin tarifa, la fórmula nueva es idéntica a la anterior', () => {
    const honorario = 637_500
    expect(valorARecaudar(honorario, null)).toBe(honorario)
    expect(valorARecaudar(honorario, modeloCon(0))).toBe(honorario)
  })
})
