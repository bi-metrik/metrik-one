import { describe, it, expect } from 'vitest'
import { requiereCitaDian } from '@/lib/dian/seccionales'
import {
  alcanzablesPorFlujo,
  decisionesHaciaDestino,
  derivarRespuestaDeCita,
  resolverRetornoReproceso,
  tramoDelReproceso,
  type EtapaRetorno,
} from './retorno-reproceso'

/**
 * La línea GIT EV/HEV de SOENA tal como está en producción el 2026-09-14: `orden`,
 * nombre y `routing` de las 19 etapas, copiados de `etapas_negocio.config_extra`.
 * Cita es orden 16 (`reproceso_de: devolucion_dian`), Cargue orden 7
 * (`reproceso_de: certificacion_upme`), Anexos orden 18.
 *
 * Mutaciones medidas el 2026-09-14 (todas cayeron):
 *  - quitar `esRespuesta` en `ramaExplicita`: 1 (la rama que espera vacío);
 *  - contar decisiones posteriores a D: 2 (Notificación deja de ser ignorada);
 *  - evaluar la derivada antes que la registrada: 1;
 *  - derivar de un bloque desactivado: 1;
 *  - hacer ganar la decisión más lejana: 2 (entre ellas V0374).
 */
type R = { conditional?: Array<{ condition: { field: string; value: string }; etapa_orden: number }>; default_etapa_orden: number; source_etapa_orden?: number }
const e = (orden: number, nombre: string, routing: R | null = null): EtapaRetorno => ({
  id: `etapa-${orden}`,
  nombre,
  orden,
  config_extra: routing ? { routing } : {},
})
const si = (field: string, value: string, etapa_orden: number) => ({ condition: { field, value }, etapa_orden })

const SOENA: EtapaRetorno[] = [
  e(1, 'Validación', { conditional: [si('cargado_upme', 'no', 2)], default_etapa_orden: 4 }),
  e(2, 'Inclusión', { conditional: [], default_etapa_orden: 4 }),
  e(4, 'Propuesta'),
  e(5, 'Negociación'),
  e(6, 'Documentación', { conditional: [si('servicio', 'solo_iva', 10)], source_etapa_orden: 4, default_etapa_orden: 7 }),
  e(7, 'Cargue'),
  e(8, 'Pago UPME', { conditional: [], default_etapa_orden: 20 }),
  e(9, 'Certificación'),
  e(10, 'Segundo cobro'),
  e(11, 'Cartera', {
    conditional: [si('requiere_cita_dian', 'true', 16), si('requiere_cita_dian', 'false', 18)],
    source_etapa_orden: 6,
    default_etapa_orden: 12,
  }),
  e(12, 'Entrega', {
    conditional: [si('requiere_cita_dian_iva', 'true', 16), si('requiere_cita_dian_iva', 'false', 18)],
    default_etapa_orden: 15,
  }),
  e(13, 'Generación'),
  e(14, 'Envío', { conditional: [], default_etapa_orden: 19 }),
  e(15, 'Facturación', { conditional: [], default_etapa_orden: 15 }),
  e(16, 'Cita', { conditional: [si('via_solicitud', 'pqrs', 17), si('via_solicitud', 'agenda', 18)], default_etapa_orden: 17 }),
  e(17, 'Notificación', { conditional: [si('resultado_pqr', 'pqr_rechazado', 16)], default_etapa_orden: 18 }),
  e(18, 'Anexos', { conditional: [], default_etapa_orden: 13 }),
  e(19, 'Seguimiento', { conditional: [], default_etapa_orden: 15 }),
  e(20, 'Revisión radicado', { conditional: [], default_etapa_orden: 9 }),
]

const CITA = 16
const ANEXOS = 18
const CARTERA = 11
const ENTREGA = 12

describe('decisionesHaciaDestino', () => {
  it('Cita la deciden Cartera y Entrega, la más cercana primero', () => {
    expect(decisionesHaciaDestino(SOENA, CITA).map((d) => d.nombre)).toEqual(['Entrega', 'Cartera'])
  })

  it('Notificación también manda a Cita, pero DESPUÉS: es el desenlace del PQR, no una decisión de entrada', () => {
    expect(decisionesHaciaDestino(SOENA, CITA).some((d) => d.nombre === 'Notificación')).toBe(false)
  })

  it('Cargue no es bifurcación: Documentación llega por default, no por una rama', () => {
    expect(decisionesHaciaDestino(SOENA, 7)).toEqual([])
  })

  it('"antes de D" es por el flujo: una decisión con `orden` mayor que D pero previa en el recorrido cuenta', () => {
    // Inicio (1) → Decide (5) → Destino (3), que cierra. Por `orden`, Decide quedaría "después".
    const etapas = [
      e(1, 'Inicio', { conditional: [], default_etapa_orden: 5 }),
      e(3, 'Destino', { conditional: [], default_etapa_orden: 3 }),
      e(4, 'Otra', { conditional: [], default_etapa_orden: 4 }),
      e(5, 'Decide', { conditional: [si('x', 'si', 3)], default_etapa_orden: 4 }),
    ]
    expect(decisionesHaciaDestino(etapas, 3).map((d) => d.nombre)).toEqual(['Decide'])
  })
})

/**
 * El tramo y el «antes de» se miden por el FLUJO (2026-09-14). Secuencia DIAN real de la
 * línea: Cita (16) → Notificación (17) → Anexos (18) → Generación (13) → Envío (14) →
 * Seguimiento (19) → Facturación (15).
 *
 * Mutaciones medidas el 2026-09-14 sobre este archivo y `reproceso-sin-retorno.test.ts`
 * (54 pruebas entre los dos):
 *  - tramo = todo lo alcanzable desde el retorno, sin exigir que llegue a la actual: 12;
 *  - `alcanzablesPorFlujo` sin la propia etapa de origen: 10;
 *  - medir por `orden` también con routing (el comportamiento de antes): 12;
 *  - `decisionesHaciaDestino` de vuelta a `orden`: 1 (en SOENA las dos formas coinciden;
 *    solo la línea sintética lo distingue);
 *  - recorrer el grafo aunque la línea no tenga routing: 0 — sin routing, la siguiente
 *    etapa es la de `orden` mayor, así que las dos formas son EQUIVALENTES. La rama existe
 *    para que el criterio de una línea sin routing sea literalmente el de siempre.
 *
 * Y contra el `reproceso-actions.ts` anterior (el que comparaba `orden`), las tres pruebas
 * de «el tramo se mide por el flujo» de `reproceso-sin-retorno.test.ts` fallaron.
 */
const nombres = (t: ReturnType<typeof tramoDelReproceso>) =>
  t.antesDelRetorno ? null : t.etapas.map((x) => x.nombre).sort()
const GENERACION = 13
const ENVIO = 14
const FACTURACION = 15
const SEGUIMIENTO = 19
const CARGUE = 7

describe('tramoDelReproceso — por el flujo de la línea', () => {
  it('devolución DIAN desde Seguimiento: rehace Cita…Seguimiento, Generación y Envío incluidas', () => {
    expect(nombres(tramoDelReproceso(SOENA, CITA, SEGUIMIENTO))).toEqual(
      ['Anexos', 'Cita', 'Envío', 'Generación', 'Notificación', 'Seguimiento'],
    )
  })

  it('…y no toca lo que va después (Facturación) ni lo anterior (Entrega, Cartera)', () => {
    const t = nombres(tramoDelReproceso(SOENA, CITA, SEGUIMIENTO))
    expect(t).not.toContain('Facturación')
    expect(t).not.toContain('Entrega')
    expect(t).not.toContain('Cartera')
  })

  it('un caso en Envío (V0388) SÍ se puede reprocesar: Envío va después de Cita', () => {
    expect(nombres(tramoDelReproceso(SOENA, CITA, ENVIO))).toEqual(
      ['Anexos', 'Cita', 'Envío', 'Generación', 'Notificación'],
    )
  })

  it('un caso en Generación también, y Envío queda fuera: todavía no lo pisó', () => {
    expect(nombres(tramoDelReproceso(SOENA, CITA, GENERACION))).toEqual(
      ['Anexos', 'Cita', 'Generación', 'Notificación'],
    )
  })

  it('un caso en Entrega sí está antes de Cita: no hay tramo', () => {
    expect(tramoDelReproceso(SOENA, CITA, ENTREGA)).toEqual({ antesDelRetorno: true })
    expect(tramoDelReproceso(SOENA, CITA, CARTERA)).toEqual({ antesDelRetorno: true })
  })

  it('ciudad sin cita: el retorno cae en Anexos y el tramo arranca ahí, con Generación y Envío', () => {
    expect(nombres(tramoDelReproceso(SOENA, ANEXOS, SEGUIMIENTO))).toEqual(
      ['Anexos', 'Envío', 'Generación', 'Seguimiento'],
    )
  })

  it('el ciclo del PQR: un caso en Cita rehace también Notificación (pudo pasar y volver)', () => {
    expect(nombres(tramoDelReproceso(SOENA, CITA, CITA))).toEqual(['Cita', 'Notificación'])
  })

  it('un caso en Facturación está después de Cita por el flujo (Seguimiento → Facturación)', () => {
    // La pantalla no ofrece reprocesar en la etapa de cierre (no hay «siguiente etapa»);
    // esto fija lo que respondería la acción si alguien la llamara igual.
    expect(tramoDelReproceso(SOENA, CITA, FACTURACION).antesDelRetorno).toBe(false)
  })
})

describe('tramoDelReproceso — certificación UPME (retorno a Cargue)', () => {
  it('desde Revisión radicado rehace Cargue, Pago UPME y Revisión, no la línea entera', () => {
    // Por `orden` eran 7..20: las 14 etapas, Cita y Facturación incluidas.
    expect(nombres(tramoDelReproceso(SOENA, CARGUE, 20))).toEqual(['Cargue', 'Pago UPME', 'Revisión radicado'])
  })

  it('desde Certificación incluye Revisión radicado (orden 20), que el `orden` dejaba fuera', () => {
    expect(nombres(tramoDelReproceso(SOENA, CARGUE, 9))).toEqual(
      ['Cargue', 'Certificación', 'Pago UPME', 'Revisión radicado'],
    )
  })

  it('Documentación sigue antes de Cargue', () => {
    expect(tramoDelReproceso(SOENA, CARGUE, 6)).toEqual({ antesDelRetorno: true })
  })
})

describe('tramoDelReproceso — línea sin routing: por `orden`, como siempre', () => {
  // Las mismas etapas de SOENA sin una sola regla de routing.
  const SIN_ROUTING = SOENA.map((x) => ({ ...x, config_extra: {} }))

  it('Envío (14) queda antes de Cita (16)', () => {
    expect(tramoDelReproceso(SIN_ROUTING, CITA, ENVIO)).toEqual({ antesDelRetorno: true })
  })

  it('desde Seguimiento el tramo es 16..19', () => {
    expect(nombres(tramoDelReproceso(SIN_ROUTING, CITA, SEGUIMIENTO))).toEqual(
      ['Anexos', 'Cita', 'Notificación', 'Seguimiento'],
    )
  })

  it('alcanzables = orden mayor o igual', () => {
    expect([...alcanzablesPorFlujo(SIN_ROUTING, 18)].sort((a, b) => a - b)).toEqual([18, 19, 20])
  })
})

describe('resolverRetornoReproceso — con respuesta registrada', () => {
  it('Entrega dice que requiere cita → vuelve a Cita', () => {
    const r = resolverRetornoReproceso({
      etapas: SOENA,
      destinoOrden: CITA,
      valores: { [ENTREGA]: { respuestas: { requiere_cita_dian_iva: 'true' } }, [CARTERA]: { respuestas: {} } },
    })
    expect(r).toMatchObject({ orden: CITA, motivo: 'aplica' })
  })

  it('Entrega dice que NO requiere cita → vuelve a Anexos, no a Cita', () => {
    const r = resolverRetornoReproceso({
      etapas: SOENA,
      destinoOrden: CITA,
      valores: { [ENTREGA]: { respuestas: { requiere_cita_dian_iva: 'false' } }, [CARTERA]: { respuestas: {} } },
    })
    expect(r).toEqual({
      orden: ANEXOS,
      motivo: 'no_aplica',
      rama: { etapaOrden: ENTREGA, campo: 'requiere_cita_dian_iva', valor: 'false', destinoOrden: ANEXOS },
    })
  })

  it('solo IVA: Cartera dice que NO → Anexos (V0265, V0353, V0405)', () => {
    const r = resolverRetornoReproceso({
      etapas: SOENA,
      destinoOrden: CITA,
      valores: { [CARTERA]: { respuestas: { requiere_cita_dian: 'false' } }, [ENTREGA]: { respuestas: {} } },
    })
    expect(r.orden).toBe(ANEXOS)
  })

  it('el `true` booleano del cargue histórico cuenta como respuesta', () => {
    const r = resolverRetornoReproceso({
      etapas: SOENA,
      destinoOrden: CITA,
      valores: { [CARTERA]: { respuestas: { requiere_cita_dian: true } } },
    })
    expect(r.motivo).toBe('aplica')
  })

  it('una respuesta registrada manda sobre la derivada', () => {
    const r = resolverRetornoReproceso({
      etapas: SOENA,
      destinoOrden: CITA,
      valores: {
        [ENTREGA]: { respuestas: { requiere_cita_dian_iva: 'true' }, derivados: { requiere_cita_dian_iva: 'false' } },
      },
    })
    expect(r).toMatchObject({ orden: CITA, motivo: 'aplica' })
  })
})

describe('resolverRetornoReproceso — sin respuesta registrada', () => {
  it('V0374 (Manizales, sin bloque de Entrega): la seccional dice que no lleva cita → Anexos', () => {
    const r = resolverRetornoReproceso({
      etapas: SOENA,
      destinoOrden: CITA,
      valores: {
        [ENTREGA]: { respuestas: {}, derivados: { requiere_cita_dian_iva: 'false' } },
        [CARTERA]: { respuestas: {}, derivados: { requiere_cita_dian: 'false' } },
      },
    })
    expect(r).toMatchObject({ orden: ANEXOS, motivo: 'no_aplica_derivado', rama: { etapaOrden: ENTREGA } })
  })

  it('V0431 (Bogotá, con un `false` sembrado en un bloque que no le aplica): vuelve a Cita', () => {
    // El `false` sembrado NO llega: `camposDeRoutingDelNegocio` descarta el bloque que
    // no aplica. Sin respuesta, decide la seccional.
    const r = resolverRetornoReproceso({
      etapas: SOENA,
      destinoOrden: CITA,
      valores: {
        [ENTREGA]: { respuestas: {}, derivados: { requiere_cita_dian_iva: 'true' } },
        [CARTERA]: { respuestas: {}, derivados: { requiere_cita_dian: 'true' } },
      },
    })
    expect(r).toMatchObject({ orden: CITA, motivo: 'aplica_derivado' })
  })

  it('campo ausente NO es `false`: sin respuesta ni seccional, vuelve a Cita como hoy', () => {
    // El default de Entrega es Facturación (15). Seguirlo cerraría el caso.
    const r = resolverRetornoReproceso({
      etapas: SOENA,
      destinoOrden: CITA,
      valores: { [ENTREGA]: { respuestas: {} }, [CARTERA]: { respuestas: {} } },
    })
    expect(r).toEqual({ orden: CITA, motivo: 'sin_respuesta', rama: null })
  })

  it('una cadena vacía tampoco es respuesta', () => {
    const r = resolverRetornoReproceso({
      etapas: SOENA,
      destinoOrden: CITA,
      valores: { [ENTREGA]: { respuestas: { requiere_cita_dian_iva: '' } } },
    })
    expect(r.motivo).toBe('sin_respuesta')
  })

  it('una rama configurada para el valor vacío no casa con un campo vacío: el vacío no es respuesta', () => {
    const etapas = [
      e(1, 'Decide', { conditional: [si('x', '', 3), si('x', 'si', 2)], default_etapa_orden: 2 }),
      e(2, 'Destino'),
      e(3, 'Otra'),
    ]
    const r = resolverRetornoReproceso({ etapas, destinoOrden: 2, valores: { 1: { respuestas: { x: '' } } } })
    expect(r.motivo).toBe('sin_respuesta')
  })

  it('certificación UPME: sin bifurcación, vuelve a Cargue', () => {
    expect(resolverRetornoReproceso({ etapas: SOENA, destinoOrden: 7, valores: {} }))
      .toEqual({ orden: 7, motivo: 'sin_bifurcacion', rama: null })
  })
})

describe('derivarRespuestaDeCita', () => {
  // Las dos configs reales de SOENA que declaran la derivación.
  const CITA_DIAN_IVA = {
    cita_dian_confirmacion: { enabled: true, requiere_field: 'requiere_cita_dian_iva', rut_slug: 'rut' },
  }
  const CITA_DIAN_REQUERIDA = {
    cita_dian_confirmacion: { enabled: true, requiere_field: 'requiere_cita_dian', rut_slug: 'rut' },
  }
  const requiereCita = (s: string) => requiereCitaDian(s).requiere_cita

  it.each([
    ['Bogotá', 'true'],
    ['Medellín', 'true'],
    ['Cali', 'true'],
    ['Bucaramanga', 'true'],
    ['Manizales', 'false'],
    ['Girardot', 'false'],
    ['Tuluá', 'false'],
    ['Villavicencio', 'false'],
  ])('%s (valor real de negocios.metadata.seccional) → %s', (seccional, esperado) => {
    expect(
      derivarRespuestaDeCita({
        camposSinRespuesta: ['requiere_cita_dian_iva'],
        configsEtapaFuente: [CITA_DIAN_IVA],
        seccional,
        requiereCita,
      }),
    ).toEqual({ requiere_cita_dian_iva: esperado })
  })

  it('una seccional que el catálogo no reconoce no se adivina', () => {
    expect(
      derivarRespuestaDeCita({
        camposSinRespuesta: ['requiere_cita_dian_iva'],
        configsEtapaFuente: [CITA_DIAN_IVA],
        seccional: 'Seccional inventada',
        requiereCita,
      }),
    ).toEqual({})
  })

  it('sin seccional no hay nada que derivar', () => {
    expect(
      derivarRespuestaDeCita({ camposSinRespuesta: ['requiere_cita_dian_iva'], configsEtapaFuente: [CITA_DIAN_IVA], seccional: null, requiereCita }),
    ).toEqual({})
  })

  it('solo deriva el campo que una config declara, y no de un bloque desactivado', () => {
    expect(
      derivarRespuestaDeCita({
        camposSinRespuesta: ['requiere_cita_dian_iva', 'otro_campo'],
        configsEtapaFuente: [CITA_DIAN_REQUERIDA, { ...CITA_DIAN_IVA, desactivado: true }],
        seccional: 'Manizales',
        requiereCita,
      }),
    ).toEqual({})
  })
})
