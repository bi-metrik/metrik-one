/**
 * Reglas del pago a proveedor (Vera C5, F3-3, N1, N4). Deciden plata: cada guarda se probó
 * quitándola (pruebas por mutación, ver el PR) y al menos un caso de aquí cae.
 */
import { describe, expect, it } from 'vitest'
import {
  clienteAbono,
  configReglasPago,
  desviacion,
  huellaRegla,
  mediosPagoProveedor,
  reglasQueRompe,
  reglasSinAprobar,
  totalTrasPago,
  type EntradaReglasPago,
  type MedioPagoProveedor,
} from './reglas-pago'

const EMPRESA: MedioPagoProveedor = { id: 'tc-empresa', label: 'Tarjeta empresa ••4417', titular: 'empresa' }
const PERSONAL: MedioPagoProveedor = { id: 'tc-edgar', label: 'Tarjeta personal Edgar ••0932', titular: 'personal' }

function entrada(extra: Partial<EntradaReglasPago> = {}): EntradaReglasPago {
  return {
    monto: 1_180_000,
    pagadoAntes: 0,
    costoCotizado: 1_180_000,
    medio: EMPRESA,
    cobradoCliente: 2_000_000,
    precioAprobado: 9_000_000,
    config: configReglasPago({ servicios_viaje: { activo: true } }),
    ...extra,
  }
}

const tipos = (e: EntradaReglasPago) => reglasQueRompe(e).map(r => r.tipo)

describe('configuración (provisionales del plan)', () => {
  it('sin nada: 5 %, piso $0, abono = anticipo, exige confirmación', () => {
    expect(configReglasPago(null)).toEqual({ umbralPct: 5, pisoPesos: 0, abonoMinimoPct: 0, exigeConfirmacion: true })
  })
  it('lee la línea y descarta valores inválidos', () => {
    const c = configReglasPago({ servicios_viaje: { umbral_desviacion_pct: 7, piso_desviacion_pesos: 50000, abono_minimo_pct: '30', exige_confirmacion_proveedor: false } })
    expect(c).toEqual({ umbralPct: 7, pisoPesos: 50000, abonoMinimoPct: 30, exigeConfirmacion: false })
    expect(configReglasPago({ servicios_viaje: { umbral_desviacion_pct: -3 } }).umbralPct).toBe(5)
  })
})

describe('medios de pago (el titular sale del medio)', () => {
  it('limpia la lista: sin id, sin nombre, titular inválido o repetido se descarta', () => {
    const m = mediosPagoProveedor({
      medios_pago_proveedor: [
        { id: 'a', label: 'A', titular: 'empresa' },
        { id: 'a', label: 'A otra vez', titular: 'empresa' },
        { id: 'b', label: '', titular: 'empresa' },
        { id: 'c', label: 'C', titular: 'socio' },
        { label: 'D', titular: 'personal' },
        { id: 'e', label: 'E', titular: 'personal' },
      ],
    })
    expect(m.map(x => x.id)).toEqual(['a', 'e'])
  })
  it('sin config: lista vacía', () => {
    expect(mediosPagoProveedor(null)).toEqual([])
    expect(mediosPagoProveedor({ medios_pago_proveedor: 'x' })).toEqual([])
  })
})

describe('reglasQueRompe', () => {
  it('pago normal (anticipo, empresa, lo cotizado): nada que aprobar', () => {
    expect(reglasQueRompe(entrada())).toEqual([])
  })

  it('sin anticipo del cliente → pago_sin_abono', () => {
    expect(tipos(entrada({ cobradoCliente: 0 }))).toEqual(['pago_sin_abono'])
    expect(reglasQueRompe(entrada({ cobradoCliente: 0 }))[0].texto).toBe('El cliente no ha pagado el anticipo.')
  })

  it('con abono mínimo en %, el anticipo pequeño no alcanza', () => {
    const config = configReglasPago({ servicios_viaje: { abono_minimo_pct: 30 } })
    expect(tipos(entrada({ config, cobradoCliente: 2_000_000 }))).toEqual(['pago_sin_abono'])
    expect(tipos(entrada({ config, cobradoCliente: 2_700_000 }))).toEqual([])
  })

  it('tarjeta personal → medio_personal', () => {
    expect(tipos(entrada({ medio: PERSONAL }))).toEqual(['medio_personal'])
  })

  it('desviación hacia arriba > 5 % → desviacion_costo (SATENA +6,9 %)', () => {
    const r = reglasQueRompe(entrada({ monto: 1_262_000 }))
    expect(r.map(x => x.tipo)).toEqual(['desviacion_costo'])
    expect(r[0].texto).toBe('Costó $82.000 más de lo cotizado (+6,9 %).')
  })

  it('justo en el 5 % no pide; un peso más sí', () => {
    expect(tipos(entrada({ monto: 1_239_000 }))).toEqual([])
    expect(tipos(entrada({ monto: 1_239_001 }))).toEqual(['desviacion_costo'])
  })

  it('un pago más barato NO pide aprobación', () => {
    expect(tipos(entrada({ monto: 900_000 }))).toEqual([])
  })

  it('la primera parte de un pago partido NO pide; la segunda que se pasa sí', () => {
    expect(tipos(entrada({ monto: 600_000 }))).toEqual([])
    expect(tipos(entrada({ monto: 700_000, pagadoAntes: 600_000 }))).toEqual(['desviacion_costo'])
  })

  it('el piso en pesos frena las diferencias pequeñas', () => {
    const config = configReglasPago({ servicios_viaje: { piso_desviacion_pesos: 50_000 } })
    expect(tipos(entrada({ monto: 1_262_000, config }))).toEqual(['desviacion_costo'])
    expect(tipos(entrada({ monto: 1_229_000 + 15_000, config, costoCotizado: 1_180_000 }))).toEqual(['desviacion_costo'])
    // +$40.000 sobre $500.000 = +8 %, pero por debajo del piso de $50.000.
    expect(tipos(entrada({ monto: 540_000, costoCotizado: 500_000, config }))).toEqual([])
  })

  it('sin costo cotizado, cualquier pago es desviación', () => {
    const r = reglasQueRompe(entrada({ monto: 100_000, costoCotizado: 0 }))
    expect(r.map(x => x.tipo)).toEqual(['desviacion_costo'])
    expect(r[0].texto).toContain('no tenía costo cotizado')
  })

  it('las tres a la vez, en orden', () => {
    expect(tipos(entrada({ cobradoCliente: 0, medio: PERSONAL, monto: 1_400_000 }))).toEqual(['pago_sin_abono', 'medio_personal', 'desviacion_costo'])
  })
})

describe('huella: cambiar el monto caduca la aprobación', () => {
  it('la huella lleva el total del servicio tras el pago (y el medio en la del medio)', () => {
    expect(huellaRegla('desviacion_costo', 1_262_000, 'x')).toBe('desviacion_costo|1262000')
    expect(huellaRegla('medio_personal', 1_262_000, 'tc-edgar')).toBe('medio_personal|tc-edgar|1262000')
    expect(totalTrasPago({ monto: 700_000, pagadoAntes: 600_000 })).toBe(1_300_000)
  })

  it('aprobada con la misma huella pasa; con otro monto vuelve a pedirse', () => {
    const rotas = reglasQueRompe(entrada({ monto: 1_262_000 }))
    const aprobada = { id: 'a1', tipo: 'desviacion_costo', estado: 'aprobada' as const, huella: rotas[0].huella }
    expect(reglasSinAprobar(rotas, [aprobada])).toEqual([])
    const otras = reglasQueRompe(entrada({ monto: 1_300_000 }))
    expect(reglasSinAprobar(otras, [aprobada]).map(r => r.tipo)).toEqual(['desviacion_costo'])
  })

  it('pedida (sin decidir) o rechazada no cuentan como aprobación', () => {
    const rotas = reglasQueRompe(entrada({ medio: PERSONAL }))
    for (const estado of ['solicitada', 'rechazada', 'caducada'] as const) {
      expect(reglasSinAprobar(rotas, [{ id: 'a', tipo: 'medio_personal', estado, huella: rotas[0].huella }])).toHaveLength(1)
    }
  })

  it('una aprobación de otro tipo no tapa esta regla', () => {
    const rotas = reglasQueRompe(entrada({ medio: PERSONAL }))
    expect(reglasSinAprobar(rotas, [{ id: 'a', tipo: 'desviacion_costo', estado: 'aprobada', huella: rotas[0].huella }])).toHaveLength(1)
  })

  it('cambiar de tarjeta personal con el mismo monto también caduca', () => {
    const r1 = reglasQueRompe(entrada({ medio: PERSONAL }))
    const otra: MedioPagoProveedor = { id: 'tc-socio', label: 'Tarjeta personal socio', titular: 'personal' }
    const r2 = reglasQueRompe(entrada({ medio: otra }))
    expect(reglasSinAprobar(r2, [{ id: 'a', tipo: 'medio_personal', estado: 'aprobada', huella: r1[0].huella }])).toHaveLength(1)
  })
})

describe('piezas', () => {
  it('desviación nunca es negativa', () => {
    expect(desviacion(900, 1000)).toEqual({ pesos: 0, pct: 0 })
    expect(desviacion(1100, 1000)).toEqual({ pesos: 100, pct: 10 })
  })
  it('clienteAbono: anticipo > 0 basta con 0 %', () => {
    expect(clienteAbono(0, 1000, { abonoMinimoPct: 0 })).toBe(false)
    expect(clienteAbono(1, 1000, { abonoMinimoPct: 0 })).toBe(true)
  })
})

describe('desviación contra el viaje (QA Trappvel 2026-10-29, H3-4)', () => {
  // Viaje 03: vuelo cotizado 689.400 pagado 1.000.000; hotel cotizado 1.452.000 que cobró 1.141.400.
  const VUELO = { monto: 1_000_000, costoCotizado: 689_400 }
  it('el +45 % del vuelo NO pide a Edgar si el hotel ya registró que cobró 310.600 menos', () => {
    expect(tipos(entrada({ ...VUELO, viaje: { cotizado: 2_141_400, comprometidoOtros: 1_141_400 } }))).toEqual([])
  })
  it('sin el ahorro registrado (el hotel cuenta por lo cotizado) sí pide, y dice cuánto se pasa el viaje', () => {
    const r = reglasQueRompe(entrada({ ...VUELO, viaje: { cotizado: 2_141_400, comprometidoOtros: 1_452_000 } }))
    expect(r.map(x => x.tipo)).toEqual(['desviacion_costo'])
    expect(r[0].texto).toBe('Costó $310.600 más de lo cotizado (+45,1 %).')
    expect(r[0].detalle).toMatchObject({ viaje_cotizado: 2_141_400, viaje_sobrecosto: 310_600 })
  })
  it('compensado a medias: pide, y el texto dice lo que se pasa el viaje entero', () => {
    const r = reglasQueRompe(entrada({ ...VUELO, viaje: { cotizado: 2_141_400, comprometidoOtros: 1_300_000 } }))
    expect(r[0].texto).toBe('Costó $310.600 más de lo cotizado (+45,1 %). El viaje entero se pasa $158.600.')
  })
  it('el piso en pesos también vale para el viaje', () => {
    const config = configReglasPago({ servicios_viaje: { piso_desviacion_pesos: 50_000 } })
    expect(tipos(entrada({ ...VUELO, config, viaje: { cotizado: 2_141_400, comprometidoOtros: 1_190_000 } }))).toEqual([])
    expect(tipos(entrada({ ...VUELO, config, viaje: { cotizado: 2_141_400, comprometidoOtros: 1_200_000 } }))).toEqual(['desviacion_costo'])
  })
  it('sin viaje (el bot de WhatsApp), la regla de siempre: por servicio', () => {
    expect(tipos(entrada(VUELO))).toEqual(['desviacion_costo'])
  })
  it('si el proveedor dijo que cobra menos, pagarle más de eso se mide contra lo que dijo', () => {
    const r = reglasQueRompe(entrada({ monto: 1_452_000, costoCotizado: 1_452_000, valorPorPagar: 1_141_400 }))
    expect(r[0].texto).toBe('Costó $310.600 más de lo que dijo que cobraba el proveedor ($1.141.400).')
  })
})
