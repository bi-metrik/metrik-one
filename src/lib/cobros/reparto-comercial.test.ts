import { describe, expect, it } from 'vitest'
import {
  cuadreDelReparto,
  deudaParaReparto,
  estadoDelReparto,
  filaSuperaDeuda,
  filasPrellenadas,
  mensajeErrorReparto,
  motivosParaNoEnviar,
  sugerenciaPorExceso,
  MENSAJE_FALTA_MIGRACION,
} from './reparto-comercial'

const modelo = (tarifa: number) => ({ tarifa_upme: tarifa, aprobado_plan: 2 as const, aprobado_honorario: null })

describe('lo que debe cada negocio', () => {
  it('es honorario + tarifa confirmada: cuadra con lo que la financiera terminó asignando (ref 389928481)', () => {
    expect(deudaParaReparto({ honorario: 614_250, modelo: modelo(701_812), cobros: [] })).toBe(1_316_062)
    expect(deudaParaReparto({ honorario: 614_250, modelo: modelo(723_139), cobros: [] })).toBe(1_337_389)
  })

  it('el prellenado de V0587/V0589 cuadra con el pago de $2.653.451', () => {
    const filas = filasPrellenadas(2_653_451, [
      { negocio_id: 'V0587', debe: 1_316_062 },
      { negocio_id: 'V0589', debe: 1_337_389 },
    ])
    expect(filas.map(f => f.monto)).toEqual([1_316_062, 1_337_389])
    expect(cuadreDelReparto(2_653_451, filas.map(f => f.monto)).estado).toBe('cuadra')
    expect(motivosParaNoEnviar(2_653_451, filas)).toEqual([])
  })

  it('resta lo recaudado, sin contar cuotas sin fecha ni cobros anulados', () => {
    const d = deudaParaReparto({
      honorario: 1_000_000,
      modelo: null,
      cobros: [
        { monto: 300_000, fecha: '2026-10-01' },
        { monto: 500_000, fecha: null },
        { monto: 0, fecha: '2026-10-02', anulado_at: '2026-10-03' },
      ],
    })
    expect(d).toBe(700_000)
  })

  it('al corregir, las porciones de la misma referencia no cuentan como pagadas', () => {
    const cobros = [{ monto: 1_326_725, fecha: '2026-10-15', external_ref: '389928481' }]
    expect(deudaParaReparto({ honorario: 614_250, modelo: modelo(701_812), cobros, excluirRef: '389928481' })).toBe(1_316_062)
    expect(deudaParaReparto({ honorario: 614_250, modelo: modelo(701_812), cobros })).toBe(0)
  })

  it('nunca es negativa', () => {
    expect(deudaParaReparto({ honorario: 100, modelo: null, cobros: [{ monto: 500, fecha: '2026-10-01' }] })).toBe(0)
  })
})

describe('cuadre', () => {
  it('partes iguales cuando cada uno debía distinto: no cuadra con lo que deben, pero sí con el pago', () => {
    // El error de Tatiana no se ve en el total: se ve en las filas.
    expect(cuadreDelReparto(2_653_451, [1_326_725, 1_326_726]).estado).toBe('cuadra')
    expect(filaSuperaDeuda({ negocio_id: 'V0587', monto: 1_326_725, debe: 1_316_062 })).toBe(true)
    expect(filaSuperaDeuda({ negocio_id: 'V0589', monto: 1_326_726, debe: 1_337_389 })).toBe(false)
  })

  it('dice cuánto falta o sobra', () => {
    expect(cuadreDelReparto(1_000_000, [400_000]).texto).toBe('Faltan $600.000')
    expect(cuadreDelReparto(1_000_000, [1_200_000]).texto).toBe('Sobran $200.000')
    expect(cuadreDelReparto(1_000_000, [999_999]).estado).toBe('cuadra')
  })

  it('no deja enviar si no cuadra, aunque sea un reparto parcial', () => {
    const m = motivosParaNoEnviar(3_786_759, [{ negocio_id: 'V0593', monto: 1_499_395, debe: 1_499_395 }])
    expect(m.join(' ')).toMatch(/No cuadra.*faltan \$2\.287\.364/)
  })

  it('no deja enviar con negocios repetidos ni montos en cero', () => {
    expect(motivosParaNoEnviar(100, [
      { negocio_id: 'a', monto: 100, debe: null },
      { negocio_id: 'a', monto: 0, debe: null },
    ])).toEqual(expect.arrayContaining(['Un negocio está repetido', 'Cada negocio necesita un monto mayor a cero']))
  })

  it('un solo negocio con total conocido es un pago simple: su monto es el pago', () => {
    expect(filasPrellenadas(500_000, [{ negocio_id: 'x', debe: 1_316_062 }])[0].monto).toBe(500_000)
  })
})

describe('aviso «no repartió»', () => {
  const candidatos = [
    { negocio_id: 'v0594', codigo: 'V0594', nombre: null, debe: 2_287_363 },
    { negocio_id: 'v9999', codigo: 'V9999', nombre: null, debe: 0 },
  ]

  it('EXT-251163: $3.786.759 contra una deuda de $1.499.395 sugiere el otro negocio con saldo', () => {
    const s = sugerenciaPorExceso({ monto: 3_786_759, debeOrigen: 1_499_395, candidatos })
    expect(s?.excedente).toBe(2_287_364)
    expect(s?.candidatos.map(c => c.codigo)).toEqual(['V0594'])
  })

  it('no avisa si el pago cabe en la deuda, ni si nadie más tiene saldo', () => {
    expect(sugerenciaPorExceso({ monto: 1_499_395, debeOrigen: 1_499_395, candidatos })).toBeNull()
    expect(sugerenciaPorExceso({ monto: 3_786_759, debeOrigen: 1_499_395, candidatos: [candidatos[1]] })).toBeNull()
    expect(sugerenciaPorExceso({ monto: 3_786_759, debeOrigen: null, candidatos })).toBeNull()
  })
})

describe('estado del reparto', () => {
  const vacio = new Map<string, boolean>()
  it('enviado mientras ninguna porción tenga el visto bueno', () => {
    expect(estadoDelReparto([
      { negocio_id: 'a', monto: 1, split_json: { origen: 'comercial' } },
      { negocio_id: 'b', monto: 1, split_json: { origen: 'comercial' } },
    ], vacio)).toBe('enviado')
  })
  it('aprobado con UNA porción confirmada, o con su negocio conciliado', () => {
    expect(estadoDelReparto([
      { negocio_id: 'a', monto: 1, split_json: { origen: 'comercial', confirmado_at: '2026-10-15' } },
      { negocio_id: 'b', monto: 1, split_json: { origen: 'comercial' } },
    ], vacio)).toBe('aprobado')
    expect(estadoDelReparto([
      { negocio_id: 'a', monto: 1, split_json: { origen: 'comercial' } },
    ], new Map([['a', true]]))).toBe('aprobado')
  })
})

describe('mensajes', () => {
  it('nunca le pide al comercial eliminar porciones', () => {
    for (const e of ['REPARTO_YA_ENVIADO', 'REPARTO_APROBADO', 'REPARTO_REF_EN_USO:V0559', 'REPARTO_NO_EXISTE']) {
      expect(mensajeErrorReparto(e, '123')).not.toMatch(/elimin/i)
    }
  })
  it('después de aprobado manda a la financiera, antes manda a Editar', () => {
    expect(mensajeErrorReparto('REPARTO_APROBADO', '1')).toMatch(/ya no se puede editar/)
    expect(mensajeErrorReparto('REPARTO_YA_ENVIADO', '1')).toMatch(/Editar reparto/)
  })
  it('sin la migración lo dice claro', () => {
    expect(mensajeErrorReparto('Could not find the function public.guardar_reparto_comercial(...) in the schema cache', '1'))
      .toBe(MENSAJE_FALTA_MIGRACION)
  })
})
