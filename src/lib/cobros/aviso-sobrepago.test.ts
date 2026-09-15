/**
 * Aviso de sobrepago: cuándo se dispara, a quién, y cuándo NO se repite.
 *
 * Las cifras del caso ancla son las de V0442 (SOENA), leídas de producción el 2026-09-15:
 * honorario $637.500 + tarifa UPME confirmada $701.812 = $1.339.312 a recaudar, y un pago
 * de $1.356.500 (pago fuera de ePayco redistribuido por la financiera). Sobran $17.188.
 */
import { describe, it, expect } from 'vitest'
import {
  AREA_POR_DEFECTO,
  ENLACE_SOBRANTES,
  claveAvisoSobrepago,
  configAvisoSobrepago,
  contenidoAvisoSobrepago,
  correoAvisoSobrepago,
  excesoParaAviso,
  planAvisoSobrepago,
  prefijoAvisoSobrepago,
} from './aviso-sobrepago'
import { saldoConciliacion } from '@/lib/upme/modelo-dinero'
import { saldoCuadrado, TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'
import { sumarRecaudoConfirmado, type CobroParaRecaudo } from '@/lib/negocios/recaudo-confirmado'
import { destinoInicialConciliacion } from '@/app/(app)/conciliacion/destino-inicial'

const HONORARIO = 637_500
const TARIFA = 701_812
const PAGADO_V0442 = 1_356_500
const NEGOCIO = '11111111-2222-3333-4444-555555555555'

describe('configAvisoSobrepago — opt-in', () => {
  it('sin la clave en ningún lado, está apagado', () => {
    expect(configAvisoSobrepago(null, null)).toBeNull()
    expect(configAvisoSobrepago({}, {})).toBeNull()
    expect(configAvisoSobrepago({ recaudo: { topar_por_valor: true } }, undefined)).toBeNull()
  })

  it('encendido en el workspace: a la financiera, sin correo si no lo pide', () => {
    expect(configAvisoSobrepago(null, { aviso_sobrepago: { activo: true } }))
      .toEqual({ areas: [AREA_POR_DEFECTO], email: false })
  })

  it('el correo solo sale con email: true, igual que avisar_al_entrar', () => {
    expect(configAvisoSobrepago({ aviso_sobrepago: { activo: true, email: true } }, null)?.email).toBe(true)
    expect(configAvisoSobrepago({ aviso_sobrepago: { activo: true, email: 'si' } }, null)?.email).toBe(false)
  })

  it('la línea gana sobre el workspace, también para apagarlo', () => {
    const ws = { aviso_sobrepago: { activo: true } }
    expect(configAvisoSobrepago({ aviso_sobrepago: { activo: false } }, ws)).toBeNull()
    expect(configAvisoSobrepago({ aviso_sobrepago: { activo: true, areas: ['comercial'] } }, ws)?.areas)
      .toEqual(['comercial'])
  })

  it('una declaración a medio escribir no decide: se ignora y manda la siguiente', () => {
    const ws = { aviso_sobrepago: { activo: true } }
    expect(configAvisoSobrepago({ aviso_sobrepago: { activo: 'true' } }, ws)).not.toBeNull()
    expect(configAvisoSobrepago({ aviso_sobrepago: { activo: 'true' } }, null)).toBeNull()
    expect(configAvisoSobrepago({ aviso_sobrepago: true }, null)).toBeNull()
  })

  it('áreas: limpia, sin repetir, y vacía cae a la financiera', () => {
    const cfg = (areas: unknown) => configAvisoSobrepago({ aviso_sobrepago: { activo: true, areas } }, null)
    expect(cfg([' financiera ', 'financiera', 'direccion', 3, ''])?.areas).toEqual(['financiera', 'direccion'])
    expect(cfg([])?.areas).toEqual([AREA_POR_DEFECTO])
    expect(cfg('financiera')?.areas).toEqual([AREA_POR_DEFECTO])
  })
})

describe('excesoParaAviso — el disparo', () => {
  const entrada = (cobros: CobroParaRecaudo[], extra: Partial<Parameters<typeof excesoParaAviso>[0]> = {}) => ({
    honorario: HONORARIO,
    tarifaConfirmada: TARIFA,
    cobros,
    conciliado: false,
    ...extra,
  })

  it('V0442: sobran $17.188 sobre honorario más tarifa', () => {
    expect(excesoParaAviso(entrada([{ monto: PAGADO_V0442 }]))).toBe(17_188)
  })

  it('pagar honorario y tarifa exactos NO es sobrepago', () => {
    expect(excesoParaAviso(entrada([{ monto: HONORARIO + TARIFA }]))).toBe(0)
  })

  it('un residuo dentro del piso de materialidad no se avisa; uno encima sí', () => {
    expect(excesoParaAviso(entrada([{ monto: HONORARIO + TARIFA + TOLERANCIA_SALDO_COP }]))).toBe(0)
    expect(excesoParaAviso(entrada([{ monto: HONORARIO + TARIFA + TOLERANCIA_SALDO_COP + 1 }])))
      .toBe(TOLERANCIA_SALDO_COP + 1)
  })

  it('un faltante nunca dispara el aviso', () => {
    expect(excesoParaAviso(entrada([{ monto: HONORARIO / 2 }]))).toBe(0)
    expect(excesoParaAviso(entrada([]))).toBe(0)
  })

  it('el reparto que el comercial propuso y nadie confirmó no cuenta; confirmado sí', () => {
    const cobros: CobroParaRecaudo[] = [
      { monto: HONORARIO + TARIFA },
      { monto: 50_000, split_json: { origen: 'comercial' } },
    ]
    expect(excesoParaAviso(entrada(cobros))).toBe(0)
    expect(excesoParaAviso(entrada(cobros, { conciliado: true }))).toBe(50_000)
  })

  it('un remanente por devolver no suma al recaudo, igual que en el panel', () => {
    const cobros: CobroParaRecaudo[] = [
      { monto: HONORARIO + TARIFA },
      { monto: 90_000, tipo_cobro: 'devolucion_pendiente' },
    ]
    expect(excesoParaAviso(entrada(cobros))).toBe(0)
  })

  /**
   * El enlace del aviso manda a Saldos → Sobrantes. Si el aviso y la lista usaran criterios
   * distintos, el enlace aterrizaría en una lista que no contiene el caso. Aquí se fija que
   * disparan exactamente en los mismos casos que el filtro de la pestaña
   * (`saldo < 0 && !saldoCuadrado(saldo)` sobre `saldoConciliacion`).
   */
  it('dispara exactamente en los casos que la pestaña Sobrantes lista', () => {
    const pagos = [0, 300_000, HONORARIO, HONORARIO + TARIFA - 5_000, HONORARIO + TARIFA,
      HONORARIO + TARIFA + 999, HONORARIO + TARIFA + 1_000, HONORARIO + TARIFA + 1_001, PAGADO_V0442, 3_000_000]
    const tarifas = [0, TARIFA]
    for (const pago of pagos) {
      for (const tarifa of tarifas) {
        for (const conciliado of [false, true]) {
          const cobros: CobroParaRecaudo[] = [
            { monto: pago },
            { monto: 40_000, split_json: { origen: 'comercial' } },
            { monto: 25_000, tipo_cobro: 'devolucion_pendiente' },
          ]
          const recaudo = sumarRecaudoConfirmado(cobros, conciliado, { excluirTipos: ['devolucion_pendiente'] })
          const saldo = saldoConciliacion(
            HONORARIO,
            { tarifa_upme: tarifa, aprobado_plan: null, aprobado_honorario: null },
            recaudo,
          )
          const enSobrantes = saldo < 0 && !saldoCuadrado(saldo)
          const exceso = excesoParaAviso({ honorario: HONORARIO, tarifaConfirmada: tarifa, cobros, conciliado })
          expect({ pago, tarifa, conciliado, dispara: exceso > 0 }).toEqual({ pago, tarifa, conciliado, dispara: enSobrantes })
          if (enSobrantes) expect(exceso).toBe(-saldo)
        }
      }
    }
  })
})

describe('planAvisoSobrepago — un aviso por negocio por monto', () => {
  const clave = (exceso: number, area = 'financiera') => claveAvisoSobrepago(NEGOCIO, exceso, area)

  it('la primera vez se crea, uno por área', () => {
    const plan = planAvisoSobrepago({ negocioId: NEGOCIO, exceso: 17_188, areas: ['financiera', 'direccion'], previos: [] })
    expect(plan.crear).toEqual([
      { area: 'financiera', clave: clave(17_188) },
      { area: 'direccion', clave: clave(17_188, 'direccion') },
    ])
    expect(plan.retirar).toEqual([])
  })

  it('el mismo monto ya avisado no se repite, lo haya atendido alguien o no', () => {
    for (const estado of ['pendiente', 'completada', 'descartada']) {
      const plan = planAvisoSobrepago({
        negocioId: NEGOCIO, exceso: 17_188, areas: ['financiera'],
        previos: [{ grupo_clave: clave(17_188), estado }],
      })
      expect({ estado, plan }).toEqual({ estado, plan: { crear: [], retirar: [] } })
    }
  })

  it('si el sobrante cambia, es otro aviso, y el pendiente viejo se retira', () => {
    const plan = planAvisoSobrepago({
      negocioId: NEGOCIO, exceso: 67_188, areas: ['financiera'],
      previos: [
        { grupo_clave: clave(17_188), estado: 'pendiente' },
        { grupo_clave: clave(5_000), estado: 'completada' },
      ],
    })
    expect(plan.crear).toEqual([{ area: 'financiera', clave: clave(67_188) }])
    // El atendido se deja: ya no está en la campana de nadie.
    expect(plan.retirar).toEqual([clave(17_188)])
  })

  it('no toca avisos de otros negocios', () => {
    const otro = claveAvisoSobrepago('99999999-2222-3333-4444-555555555555', 17_188, 'financiera')
    const plan = planAvisoSobrepago({
      negocioId: NEGOCIO, exceso: 20_000, areas: ['financiera'],
      previos: [{ grupo_clave: otro, estado: 'pendiente' }],
    })
    expect(plan.retirar).toEqual([])
    expect(plan.crear).toHaveLength(1)
  })

  it('sin exceso no hay nada que hacer', () => {
    expect(planAvisoSobrepago({ negocioId: NEGOCIO, exceso: 0, areas: ['financiera'], previos: [] }))
      .toEqual({ crear: [], retirar: [] })
  })

  it('la clave vive bajo el prefijo del negocio y redondea el monto', () => {
    expect(clave(17_188.4).startsWith(prefijoAvisoSobrepago(NEGOCIO))).toBe(true)
    expect(clave(17_188.4)).toBe(`sobrepago:negocio:${NEGOCIO}:exceso:17188:area:financiera`)
  })
})

describe('contenido del aviso', () => {
  const negocio = { codigo: 'V0442', nombre: 'NORA ANETH PAVA RIPOLL' }

  it('la campana nombra el negocio, el código y cuánto sobra', () => {
    const t = contenidoAvisoSobrepago(negocio, 17_188)
    expect(t).toContain('V0442')
    expect(t).toContain('NORA ANETH PAVA RIPOLL')
    expect(t).toContain('17.188')
  })

  it('el correo enlaza a la lista de sobrantes del subdominio, NO al negocio', () => {
    const { asunto, html } = correoAvisoSobrepago({ negocio, exceso: 17_188, workspaceSlug: 'soena', baseDomain: 'metrikone.co' })
    expect(asunto).toContain('V0442')
    expect(asunto).toContain('17.188')
    expect(html).toContain(`https://soena.metrikone.co${ENLACE_SOBRANTES}`)
    expect(html).not.toContain('/negocios/')
  })

  it('el nombre del negocio no puede inyectar marcado en el correo', () => {
    const { html } = correoAvisoSobrepago({
      negocio: { codigo: 'X1', nombre: '<script>alert(1)</script>' },
      exceso: 5_000, workspaceSlug: 'soena', baseDomain: 'metrikone.co',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('el enlace del aviso abre Tesorería en Saldos con el filtro de sobrantes', () => {
    const query = new URLSearchParams(ENLACE_SOBRANTES.split('?')[1])
    expect(ENLACE_SOBRANTES.startsWith('/conciliacion?')).toBe(true)
    expect(destinoInicialConciliacion({
      pestana: query.get('pestana') ?? undefined,
      saldo: query.get('saldo') ?? undefined,
    })).toEqual({ pestana: 'saldos', saldo: 'sobrante' })
  })
})

describe('destinoInicialConciliacion', () => {
  it('sin parámetros, o con valores desconocidos, no cambia nada', () => {
    expect(destinoInicialConciliacion(undefined)).toEqual({ pestana: null, saldo: null })
    expect(destinoInicialConciliacion({ pestana: 'hackeo', saldo: 'todo' })).toEqual({ pestana: null, saldo: null })
  })

  it('un parámetro repetido toma el primero', () => {
    expect(destinoInicialConciliacion({ pestana: ['saldos', 'general'], saldo: [' faltante '] }))
      .toEqual({ pestana: 'saldos', saldo: 'faltante' })
  })
})
