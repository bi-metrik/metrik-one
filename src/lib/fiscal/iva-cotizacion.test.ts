/**
 * El IVA sobre el ingreso propio (regla de Felipe, 2026-09-22): la función pura.
 *
 * Los casos grandes salen de producción, leídos el 2026-09-22 sin escribir nada:
 * COT-2026-0002 (EUROPA 20D) y COT-2026-0006 (San Andrés - Providencia) de Trappvel.
 */
import { describe, expect, it } from 'vitest'

import { calcularCascada } from '@/lib/cotizaciones/totales'
import { generarResumenFiscal } from './calculos-fiscales'
import {
  CONFIG_IVA_POR_DEFECTO,
  clienteParaRetenciones,
  fiscalSobreIngresoPropio,
  ivaIncluidoEnElPrecio,
  ivaSobreIngresoPropio,
  leerConfigIvaCotizacion,
  lineasParaIva,
  liquidarIva,
  motivoIvaSinCalcular,
  tarifaIvaDelVendedor,
  textoIvaIncluido,
  type LineaParaIva,
} from './iva-cotizacion'
import type { Client, FiscalProfile } from '@/types/database'

const linea = (id: string, precio: number, costo: number, extra: Partial<LineaParaIva> = {}): LineaParaIva => ({
  id,
  nombre: id.toUpperCase(),
  precio,
  costoTerceros: costo,
  precioAdicionales: 0,
  costoAdicionales: 0,
  ...extra,
})

const AL_19 = { tarifaPct: 19 }

describe('la configuración del workspace', () => {
  it('sin declarar nada, el IVA va sobre el total: lo de siempre', () => {
    expect(leerConfigIvaCotizacion(undefined)).toEqual(CONFIG_IVA_POR_DEFECTO)
    expect(leerConfigIvaCotizacion({})).toEqual(CONFIG_IVA_POR_DEFECTO)
    expect(leerConfigIvaCotizacion({ iva_cotizacion: 'ingreso_propio' })).toEqual(CONFIG_IVA_POR_DEFECTO)
    expect(ivaSobreIngresoPropio(leerConfigIvaCotizacion(null))).toBe(false)
  })

  it('solo el valor exacto enciende la base nueva', () => {
    expect(ivaSobreIngresoPropio(leerConfigIvaCotizacion({ iva_cotizacion: { base: 'Ingreso_Propio' } }))).toBe(false)
    expect(ivaSobreIngresoPropio(leerConfigIvaCotizacion({ iva_cotizacion: { base: 'ingreso_propio' } }))).toBe(true)
  })

  it('el IVA sale en el documento salvo que se declare oculto', () => {
    expect(leerConfigIvaCotizacion({ iva_cotizacion: { base: 'ingreso_propio' } }).enDocumento).toBe('linea_incluida')
    expect(leerConfigIvaCotizacion({ iva_cotizacion: { base: 'ingreso_propio', en_documento: 'oculto' } }).enDocumento).toBe('oculto')
    expect(leerConfigIvaCotizacion({ iva_cotizacion: { base: 'ingreso_propio', en_documento: 'aparte' } }).enDocumento).toBe('linea_incluida')
  })

  it('la tarifa sale del perfil de la base: responsable 19 %, no responsable 0', () => {
    expect(tarifaIvaDelVendedor({ iva_responsible: true })).toBe(19)
    expect(tarifaIvaDelVendedor({ iva_responsible: false })).toBe(0)
    expect(tarifaIvaDelVendedor(null)).toBe(0)
  })
})

describe('la base es el ingreso propio', () => {
  it('el ejemplo del brief: paquete de $10 M con $1 M de ingreso propio → IVA $190.000', () => {
    const liq = liquidarIva([linea('paquete', 10_000_000, 9_000_000)], AL_19)
    expect(liq.baseGravable).toBe(1_000_000)
    expect(liq.iva).toBe(190_000)
    expect(10_000_000 + liq.iva).toBe(10_190_000)
  })

  it('COT-2026-0002: $440.083 de IVA sobre $2.316.229 de ingreso propio (antes: 19 % de $15.441.526)', () => {
    const liq = liquidarIva([
      linea('latam bog-mco', 13_301_621, 11_306_378),
      linea('prueba hotel decameron', 2_139_905, 1_818_919),
      // Sin precio y sin costo: no suma nada y no es un costo que falte.
      linea('prueba hotel cancun', 0, 0),
    ], AL_19)
    expect(liq.baseGravable).toBe(2_316_229)
    expect(liq.lineas.map(l => l.iva)).toEqual([379_096, 60_987, 0])
    expect(liq.iva).toBe(440_083)
    expect(liq.calculable).toBe(true)
  })

  it('COT-2026-0006: $318.546 de IVA sobre $1.676.558 de ingreso propio', () => {
    const liq = liquidarIva([
      linea('avianca bog-adz', 7_303_878, 6_208_296),
      linea('satena adz-providencia', 3_873_172, 3_292_196),
    ], AL_19)
    expect(liq.baseGravable).toBe(1_676_558)
    expect(liq.iva).toBe(318_546)
  })

  it('el IVA se redondea por línea y el total es su suma', () => {
    const liq = liquidarIva([linea('a', 1_005, 1_000), linea('b', 1_005, 1_000)], AL_19)
    // 5 × 0,19 = 0,95 → 1 por línea. Redondear el total daría 2 igual; lo que importa es
    // que el total sea la suma de lo que cada línea imprime.
    expect(liq.lineas.map(l => l.iva)).toEqual([1, 1])
    expect(liq.iva).toBe(2)
  })

  it('una línea vendida bajo su costo no le resta IVA a las demás ni lo vuelve negativo', () => {
    const liq = liquidarIva([linea('a', 900, 1_000), linea('b', 2_000, 1_000)], AL_19)
    expect(liq.lineas.map(l => l.iva)).toEqual([0, 190])
  })

  it('el descuento comercial sale del ingreso propio, no de la parte del tercero', () => {
    const liq = liquidarIva([linea('a', 1_000_000, 800_000)], { tarifaPct: 19, descuentoComercialPct: 10 })
    expect(liq.baseGravable).toBe(100_000)
    expect(liq.iva).toBe(19_000)
  })

  it('los adicionales llevan su IVA sobre lo que dejan, aparte de la línea', () => {
    const liq = liquidarIva([linea('vuelo', 1_000_000, 900_000, { precioAdicionales: 150_000, costoAdicionales: 100_000 })], AL_19)
    expect(liq.lineas[0].ivaBase).toBe(19_000)
    expect(liq.lineas[0].ivaAdicionales).toBe(9_500)
    expect(liq.iva).toBe(28_500)
  })

  it('sin responsable de IVA no hay IVA', () => {
    const liq = liquidarIva([linea('a', 10_000_000, 9_000_000)], { tarifaPct: 0 })
    expect(liq.iva).toBe(0)
  })
})

describe('la base de cada línea', () => {
  it('un servicio propio lleva IVA sobre el precio entero; el tercero, sobre lo que deja', () => {
    const liq = liquidarIva([
      linea('tiquete internacional', 2_000_000, 1_800_000),
      linea('acompañamiento propio', 300_000, 100_000, { baseDeclarada: 'valor_completo' }),
    ], AL_19)
    expect(liq.lineas.map(l => l.iva)).toEqual([38_000, 57_000])
  })

  it('una línea comisionable no le cobra IVA al viajero, aunque deje margen', () => {
    const liq = liquidarIva([linea('decameron', 2_029_118, 1_818_919, { baseDeclarada: 'sin_iva' })], AL_19)
    expect(liq.iva).toBe(0)
    expect(liq.calculable).toBe(true)
  })

  it('una comisionable cargada como venta = costo da $0 sin que nadie la marque', () => {
    expect(liquidarIva([linea('comisionable', 1_500_000, 1_500_000)], AL_19).iva).toBe(0)
  })
})

describe('una línea sin costo medible', () => {
  it('no se inventa una base: la línea se marca y la cotización no es calculable', () => {
    const liq = liquidarIva([linea('vuelo', 2_000_000, 1_800_000), linea('tour a mano', 500_000, 0)], AL_19)
    expect(liq.lineas[1].sinCosto).toBe(true)
    expect(liq.lineas[1].iva).toBe(0)
    expect(liq.iva).toBe(38_000)
    expect(liq.calculable).toBe(false)
    expect(liq.sinCosto).toEqual(['TOUR A MANO'])
    expect(motivoIvaSinCalcular(liq.sinCosto)).toContain('«TOUR A MANO» tiene precio y no tiene costo')
  })

  it('el recargo fijo es plata de la agencia: lleva IVA sobre su precio y no le falta nada', () => {
    const liq = liquidarIva([linea('recargo de emision', 100_000, 0, { esDeLaAgencia: true })], AL_19)
    expect(liq.lineas[0].sinCosto).toBe(false)
    expect(liq.iva).toBe(19_000)
    expect(liq.calculable).toBe(true)
  })

  it('una línea sin costo marcada como servicio propio sí se calcula', () => {
    const liq = liquidarIva([linea('asesoria', 500_000, 0, { baseDeclarada: 'valor_completo' })], AL_19)
    expect(liq.calculable).toBe(true)
    expect(liq.iva).toBe(95_000)
  })
})

describe('el puente con la cascada', () => {
  it('el costo del tercero es el de la línea SIN administrativos: el AIU es de la agencia', () => {
    const cascada = calcularCascada(
      [{ id: 'a', cantidad: 1, subtotal: 1_000_000, numeroDeRubros: 0, precio_venta: 0, precio_manual: false }],
      { administrativosPct: 10, margenPct: 15, convencionMargen: 'sobre_venta' },
    )
    const [l] = lineasParaIva(cascada.lineas, () => ({ nombre: 'A' }))
    expect(l.costoTerceros).toBe(1_000_000)
    expect(liquidarIva([l], AL_19).baseGravable).toBe(cascada.lineas[0].precioLinea - 1_000_000)
  })
})

describe('el resultado fiscal', () => {
  const perfil = {
    person_type: 'persona_juridica',
    tax_regime: 'ordinario',
    iva_responsible: true,
    is_declarante: true,
    self_withholder: false,
    ica_city: '',
  } as unknown as FiscalProfile

  it('el total es el subtotal más el IVA del ingreso propio', () => {
    const liq = liquidarIva([linea('paquete', 10_000_000, 9_000_000)], AL_19)
    const f = fiscalSobreIngresoPropio({ subtotal: 10_000_000, liquidacion: liq, perfil, cliente: clienteParaRetenciones({ tipo_persona: 'natural' }) })
    expect(f.iva).toBe(190_000)
    expect(f.totalBruto).toBe(10_190_000)
    expect(f.totalRetenciones).toBe(0)
  })

  it('las retenciones de un cliente empresa van sobre el ingreso propio, no sobre el total', () => {
    const liq = liquidarIva([linea('paquete', 10_000_000, 9_000_000)], AL_19)
    const cliente = clienteParaRetenciones({ tipo_persona: 'juridica', agente_retenedor: true })
    const f = fiscalSobreIngresoPropio({ subtotal: 10_000_000, liquidacion: liq, perfil, cliente })
    expect(f.reteFuente).toBe(40_000) // 4 % de $1 M, no de $10 M
    expect(f.reteIVA).toBe(28_500) // 15 % de $190.000
  })

  it('el resumen del editor sin liquidación previa sigue siendo el de siempre: 19 % del total', () => {
    const cliente = { person_type: 'persona_juridica', tax_regime: 'ordinario', agente_retenedor: false, gran_contribuyente: false } as unknown as Client
    const r = generarResumenFiscal(perfil, cliente, 15_441_526, 13_125_297)
    expect(r.iva).toBe(2_933_890)
    expect(r.total_paga_cliente).toBe(18_375_416)
  })

  it('con la liquidación, el resumen del editor dice la misma cifra que el PDF', () => {
    const cliente = { person_type: 'persona_natural', tax_regime: 'ordinario', agente_retenedor: false, gran_contribuyente: false } as unknown as Client
    const r = generarResumenFiscal(perfil, cliente, 15_441_526, 13_125_297, { iva: 440_083, baseGravable: 2_316_229 })
    expect(r.iva).toBe(440_083)
    expect(r.total_paga_cliente).toBe(15_881_609)
    expect(r.neto_recibido).toBe(15_441_526)
  })

  it('la frase del documento', () => {
    expect(textoIvaIncluido(190_000, n => `$${n}`)).toBe('Incluye IVA de $190000 sobre la tarifa de servicio de la agencia.')
  })
})

/**
 * Adenda del 23-sep: Edgar cotiza con el IVA ADENTRO del precio. El total que ve el cliente
 * es el de la cascada, sin sumarle nada; el IVA se EXTRAE del ingreso propio (19/119).
 */
describe('el IVA dentro del precio (precio: iva_incluido)', () => {
  const AL_19_ADENTRO = { tarifaPct: 19, precio: 'iva_incluido' as const }

  it('sin la llave, el IVA va aparte: lo del #830', () => {
    expect(CONFIG_IVA_POR_DEFECTO.precio).toBe('iva_aparte')
    expect(leerConfigIvaCotizacion({ iva_cotizacion: { base: 'ingreso_propio' } }).precio).toBe('iva_aparte')
    expect(ivaIncluidoEnElPrecio(leerConfigIvaCotizacion({ iva_cotizacion: { base: 'ingreso_propio' } }))).toBe(false)
    expect(ivaIncluidoEnElPrecio(null)).toBe(false)
  })

  it('solo el valor exacto lo mete adentro', () => {
    const leer = (precio: unknown) => leerConfigIvaCotizacion({ iva_cotizacion: { base: 'ingreso_propio', precio } }).precio
    expect(leer('iva_incluido')).toBe('iva_incluido')
    expect(leer('IVA_INCLUIDO')).toBe('iva_aparte')
    expect(leer('incluido')).toBe('iva_aparte')
    expect(leer(true)).toBe('iva_aparte')
    expect(leer('iva_aparte')).toBe('iva_aparte')
  })

  it('el ejemplo del brief: $1 M de ingreso propio lleva $159.664 de IVA adentro', () => {
    const liq = liquidarIva([linea('paquete', 10_000_000, 9_000_000)], AL_19_ADENTRO)
    expect(liq.iva).toBe(159_664) // 1.000.000 × 19 / 119
    expect(liq.baseGravable).toBe(840_336) // lo demás del ingreso propio
    expect(liq.baseGravable + liq.iva).toBe(1_000_000)
    expect(liq.precio).toBe('iva_incluido')
  })

  it('COT-2026-0002: $369.818 de IVA dentro de $2.316.229 de ingreso propio', () => {
    const liq = liquidarIva([
      linea('latam bog-mco', 13_301_621, 11_306_378),
      linea('prueba hotel decameron', 2_139_905, 1_818_919),
      linea('prueba hotel cancun', 0, 0),
    ], AL_19_ADENTRO)
    expect(liq.lineas.map(l => l.iva)).toEqual([318_568, 51_250, 0])
    expect(liq.iva).toBe(369_818)
    expect(liq.baseGravable).toBe(1_946_411)
    // El 19/119 del ingreso propio, salvo el redondeo por línea.
    expect(Math.abs(liq.iva - 2_316_229 * 19 / 119)).toBeLessThan(1)
  })

  it('COT-2026-0006: $267.686 de IVA dentro de $1.676.558 de ingreso propio', () => {
    const liq = liquidarIva([
      linea('avianca bog-adz', 7_303_878, 6_208_296),
      linea('satena adz-providencia', 3_873_172, 3_292_196),
    ], AL_19_ADENTRO)
    expect(liq.lineas.map(l => l.iva)).toEqual([174_925, 92_761])
    expect(liq.iva).toBe(267_686)
    expect(liq.baseGravable).toBe(1_408_872)
  })

  it('con iva_aparte declarado la cuenta es idéntica a la de sin llave', () => {
    const lineas = [
      linea('latam bog-mco', 13_301_621, 11_306_378),
      linea('servicio', 300_000, 100_000, { baseDeclarada: 'valor_completo' }),
      linea('vuelo', 1_000_000, 900_000, { precioAdicionales: 150_000, costoAdicionales: 100_000 }),
    ]
    expect(liquidarIva(lineas, { tarifaPct: 19, precio: 'iva_aparte' })).toEqual(liquidarIva(lineas, AL_19))
  })

  it('los adicionales también llevan su IVA adentro, aparte de la línea', () => {
    const liq = liquidarIva([linea('vuelo', 1_000_000, 900_000, { precioAdicionales: 150_000, costoAdicionales: 100_000 })], AL_19_ADENTRO)
    expect(liq.lineas[0].ivaBase).toBe(15_966) // 100.000 × 19/119
    expect(liq.lineas[0].ivaAdicionales).toBe(7_983) // 50.000 × 19/119
    expect(liq.baseGravable).toBe(150_000 - 23_949)
  })

  it('sin responsable de IVA no hay nada que sacar', () => {
    const liq = liquidarIva([linea('a', 10_000_000, 9_000_000)], { tarifaPct: 0, precio: 'iva_incluido' })
    expect(liq.iva).toBe(0)
    expect(liq.baseGravable).toBe(1_000_000)
  })

  const perfil = {
    person_type: 'persona_juridica',
    tax_regime: 'ordinario',
    iva_responsible: true,
    is_declarante: true,
    self_withholder: false,
    ica_city: '',
  } as unknown as FiscalProfile

  it('el total que paga el cliente es el subtotal, sin sumarle el IVA', () => {
    const liq = liquidarIva([linea('paquete', 10_000_000, 9_000_000)], AL_19_ADENTRO)
    const f = fiscalSobreIngresoPropio({ subtotal: 10_000_000, liquidacion: liq, perfil, cliente: clienteParaRetenciones({ tipo_persona: 'natural' }) })
    expect(f.iva).toBe(159_664)
    expect(f.totalBruto).toBe(10_000_000)
    expect(f.teQueda).toBe(10_000_000)
  })

  it('las retenciones van sobre la base neta de IVA', () => {
    const cliente = clienteParaRetenciones({ tipo_persona: 'juridica', agente_retenedor: true })
    const adentro = fiscalSobreIngresoPropio({
      subtotal: 10_000_000,
      liquidacion: liquidarIva([linea('paquete', 10_000_000, 9_000_000)], AL_19_ADENTRO),
      perfil,
      cliente,
    })
    // Control: la misma base neta ($840.336) liquidada con el IVA aparte.
    const control = fiscalSobreIngresoPropio({
      subtotal: 9_840_336,
      liquidacion: liquidarIva([linea('paquete', 9_840_336, 9_000_000)], AL_19),
      perfil,
      cliente,
    })
    expect(adentro.reteFuente).toBe(control.reteFuente)
    expect(adentro.reteFuente).toBeLessThan(40_000) // no sobre el millón entero
    expect(adentro.reteFuente).toBeGreaterThan(0)
  })

  it('el resumen del editor: el cliente paga la cotización y de ahí sale el IVA', () => {
    const cliente = { person_type: 'persona_natural', tax_regime: 'ordinario', agente_retenedor: false, gran_contribuyente: false } as unknown as Client
    const r = generarResumenFiscal(perfil, cliente, 15_441_526, 13_125_297, { iva: 369_818, baseGravable: 1_946_411, incluido: true })
    expect(r.iva).toBe(369_818)
    expect(r.total_paga_cliente).toBe(15_441_526)
    expect(r.iva_trasladado).toBe(369_818)
    expect(r.neto_recibido).toBe(15_441_526 - 369_818)
  })

  it('el resumen del editor con incluido: false es el del #830', () => {
    const cliente = { person_type: 'persona_natural', tax_regime: 'ordinario', agente_retenedor: false, gran_contribuyente: false } as unknown as Client
    const aparte = generarResumenFiscal(perfil, cliente, 15_441_526, 13_125_297, { iva: 440_083, baseGravable: 2_316_229, incluido: false })
    const sinLlave = generarResumenFiscal(perfil, cliente, 15_441_526, 13_125_297, { iva: 440_083, baseGravable: 2_316_229 })
    expect(aparte).toEqual(sinLlave)
  })
})
