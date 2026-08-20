import { describe, it, expect } from 'vitest'
import { etapasDescartadas } from './ruta-descartada'
import type { EtapaRuta, ValoresPorOrden } from './reversa-ruta'

// Topologia REAL de SOENA VE, re-leida de produccion el 2026-08-20. Se usa la real a
// proposito: es la que contiene la trampa que este modulo existe para no repetir. El plan
// escrito a mano listaba TRES etapas para marcar (Cargue, Pago UPME, Certificacion) y son
// CUATRO — entre Pago UPME y Certificacion el routing pasa por "Revision radicado" (orden
// 20, numero 8), que nadie recordo. Ninguna prueba con un fixture inventado habria
// destapado eso.
//
// Diferencias contra el fixture de `reversa-ruta.test.ts` (foto del 2026-08-11): alli no
// existe la etapa 20 y los `numero` de la mitad de abajo corrieron. Se deja aparte en vez
// de unificarlos: cada prueba fija la foto que la hace legible, y unificarlos obligaria a
// re-verificar las pruebas de la reversa por un cambio que no es suyo.
const BASE: Omit<EtapaRuta, 'tieneCasillas' | 'puedeSaltarsePorSaldo'>[] = [
  { id: 'e1', nombre: 'Validacion', orden: 1, numero: 1, routing: { default_etapa_orden: 4, conditional: [{ condition: { field: 'cargado_upme', value: 'no' }, etapa_orden: 2 }] } },
  { id: 'e2', nombre: 'Inclusion', orden: 2, numero: 2, routing: { default_etapa_orden: 4, conditional: [] } },
  { id: 'e4', nombre: 'Propuesta', orden: 4, numero: 3, routing: null },
  { id: 'e5', nombre: 'Negociacion', orden: 5, numero: 4, routing: null },
  { id: 'e6', nombre: 'Documentacion', orden: 6, numero: 5, routing: { default_etapa_orden: 7, source_etapa_orden: 5, conditional: [{ condition: { field: 'servicio', value: 'solo_iva' }, etapa_orden: 10 }] } },
  { id: 'e7', nombre: 'Cargue', orden: 7, numero: 6, routing: null },
  { id: 'e8', nombre: 'Pago UPME', orden: 8, numero: 7, routing: { default_etapa_orden: 20, conditional: [] } },
  { id: 'e20', nombre: 'Revision radicado', orden: 20, numero: 8, routing: { default_etapa_orden: 9, conditional: [] } },
  { id: 'e9', nombre: 'Certificacion', orden: 9, numero: 9, routing: null },
  { id: 'e10', nombre: 'Precobro', orden: 10, numero: 10, routing: null },
  { id: 'e11', nombre: 'Cobro', orden: 11, numero: 11, routing: { default_etapa_orden: 12, source_etapa_orden: 6, conditional: [{ condition: { field: 'requiere_cita_dian', value: 'true' }, etapa_orden: 16 }, { condition: { field: 'requiere_cita_dian', value: 'false' }, etapa_orden: 18 }] } },
  { id: 'e12', nombre: 'Entrega', orden: 12, numero: 12, routing: { default_etapa_orden: 15, conditional: [{ condition: { field: 'requiere_cita_dian_iva', value: 'true' }, etapa_orden: 16 }, { condition: { field: 'requiere_cita_dian_iva', value: 'false' }, etapa_orden: 18 }] } },
  { id: 'e16', nombre: 'Cita', orden: 16, numero: 13, routing: { default_etapa_orden: 17, conditional: [{ condition: { field: 'via_solicitud', value: 'pqrs' }, etapa_orden: 17 }, { condition: { field: 'via_solicitud', value: 'agenda' }, etapa_orden: 18 }] } },
  { id: 'e17', nombre: 'Notificacion', orden: 17, numero: 14, routing: { default_etapa_orden: 18, conditional: [] } },
  { id: 'e18', nombre: 'Anexos', orden: 18, numero: 15, routing: { default_etapa_orden: 13, conditional: [] } },
  { id: 'e13', nombre: 'Generacion', orden: 13, numero: 16, routing: null },
  { id: 'e14', nombre: 'Envio', orden: 14, numero: 17, routing: { default_etapa_orden: 19, conditional: [] } },
  { id: 'e19', nombre: 'Seguimiento', orden: 19, numero: 18, routing: { default_etapa_orden: 15, conditional: [] } },
  { id: 'e15', nombre: 'Facturacion', orden: 15, numero: 19, routing: { default_etapa_orden: 15, conditional: [] } },
]

// Precobro (10) declara `saltar_si_saldo_cero = true` y Cobro (11) es stage `cobro` sin
// flag: las dos se saltan solas cuando el saldo esta cubierto. Pago UPME (8) lo declara en
// FALSE a proposito — ahi se le paga a la UPME, no se le cobra al cliente.
const SALTABLES = new Set([10, 11])

const SOENA: EtapaRuta[] = BASE.map(e => ({
  ...e,
  tieneCasillas: true,
  puedeSaltarsePorSaldo: SALTABLES.has(e.orden),
}))

/** Lo que responde un caso que solo contrato devolucion de IVA. */
const SOLO_IVA: ValoresPorOrden = { 5: { servicio: 'solo_iva' }, 6: { requiere_cita_dian: 'true' } }
/** Lo que responde un caso que contrato el servicio completo. */
const COMPLETO: ValoresPorOrden = { 5: { servicio: 'completo' }, 6: { requiere_cita_dian: 'true' } }

const ordenes = (r: ReturnType<typeof etapasDescartadas>): number[] => r.map(d => d.orden)

describe('etapasDescartadas — lo que el caso no va a recorrer nunca', () => {
  it('un caso de solo IVA descarta las CUATRO etapas de la via UPME, no tres', () => {
    // El caso paso por 1, 4, 5 y 6 y esta en Cita: el salto ya ocurrio.
    const r = etapasDescartadas({
      etapas: SOENA,
      valores: SOLO_IVA,
      recorridas: new Set([1, 4, 5, 6, 16]),
      etapaActualOrden: 16,
    })
    // 20 (Revision radicado) es la que el plan escrito a mano no tenia.
    expect(ordenes(r)).toEqual([7, 8, 9, 20])
  })

  it('nombra la decision que las dejo fuera, con campo y valor', () => {
    const r = etapasDescartadas({
      etapas: SOENA,
      valores: SOLO_IVA,
      recorridas: new Set([1, 4, 5, 6, 16]),
      etapaActualOrden: 16,
    })
    expect(r[0].motivo).toEqual({ decisionOrden: 6, campo: 'servicio', valor: 'solo_iva' })
  })

  it('un caso completo no descarta nada de la via UPME', () => {
    const r = etapasDescartadas({
      etapas: SOENA,
      valores: COMPLETO,
      recorridas: new Set([1, 4, 5, 6, 7]),
      etapaActualOrden: 7,
    })
    expect(ordenes(r)).not.toContain(8)
    expect(ordenes(r)).not.toContain(9)
  })

  it('Precobro y Cobro nunca se marcan: el motor los salta por saldo, que es otra cosa', () => {
    // La rama alterna de Documentacion (7 → 8 → 20 → 9) desemboca en Precobro y Cobro
    // antes de reencontrarse con la ruta real. Sin el corte por saldo entrarian a la lista
    // y la marca estaria mintiendo sobre por que no estan.
    const r = etapasDescartadas({
      etapas: SOENA,
      valores: SOLO_IVA,
      recorridas: new Set([1, 4, 5, 6, 16]),
      etapaActualOrden: 16,
    })
    expect(ordenes(r)).not.toContain(10)
    expect(ordenes(r)).not.toContain(11)
  })

  it('lo recorrido no se marca aunque el dato de hoy diga lo contrario', () => {
    // V0109 real: es `solo_iva` pero SI paso por Cargue y Certificacion (los recorrio con
    // el dato viejo, antes del backfill del 2026-08-18). Eso es historia y le toca a la
    // reversa de ruta, no una etapa que no aplica.
    const r = etapasDescartadas({
      etapas: SOENA,
      valores: SOLO_IVA,
      recorridas: new Set([1, 4, 5, 6, 7, 9, 18]),
      etapaActualOrden: 18,
    })
    expect(ordenes(r)).not.toContain(7)
    expect(ordenes(r)).not.toContain(9)
    expect(ordenes(r)).toContain(8)
  })

  it('no marca nada mientras el caso siga EN la bifurcacion', () => {
    // El motor todavia no decidio: el dato puede cambiar antes de avanzar. Mismo corte que
    // hace `divergenciaDeRuta`, y por la misma razon.
    const r = etapasDescartadas({
      etapas: SOENA,
      valores: SOLO_IVA,
      recorridas: new Set([1, 4, 5, 6]),
      etapaActualOrden: 6,
    })
    expect(r).toEqual([])
  })

  it('no marca nada si el caso nunca paso por la bifurcacion', () => {
    const r = etapasDescartadas({
      etapas: SOENA,
      valores: { 5: { servicio: 'solo_iva' } },
      recorridas: new Set([4]),
      etapaActualOrden: 4,
    })
    expect(r).toEqual([])
  })

  it('una bifurcacion resuelta EN SILENCIO no descarta nada', () => {
    // Validacion (1) bifurca por `cargado_upme`. Si nadie lo contesto el motor enruta igual,
    // por el camino por defecto, y Inclusion (2) queda fuera del recorrido. Marcarla como
    // "no aplica" convertiria un "nadie contesto" en una decision declarada — que es
    // literalmente lo que costo $1.552.461 en SOENA con el campo derivado en `false` de
    // relleno. Un caso asi tiene un dato pendiente, no una etapa descartada.
    const r = etapasDescartadas({
      etapas: SOENA,
      valores: SOLO_IVA, // sin `cargado_upme` en la bolsa de la etapa 1
      recorridas: new Set([1, 4, 5, 6, 16]),
      etapaActualOrden: 16,
    })
    expect(ordenes(r)).not.toContain(2)
    // La bifurcacion que SI tiene respuesta sigue marcando.
    expect(ordenes(r)).toEqual([7, 8, 9, 20])
  })

  it('una respuesta que cae en el camino por defecto tambien es una decision', () => {
    // `cargado_upme = si` no coincide con ninguna condicion, asi que gana el default. Hay
    // respuesta: la decision es tan real como una que coincide, y se nombra igual.
    const r = etapasDescartadas({
      etapas: SOENA,
      valores: { ...SOLO_IVA, 1: { cargado_upme: 'si' } },
      recorridas: new Set([1, 4, 5, 6, 16]),
      etapaActualOrden: 16,
    })
    expect(r.find(d => d.orden === 2)?.motivo).toEqual({ decisionOrden: 1, campo: 'cargado_upme', valor: 'si' })
  })

  it('una etapa sin casillas configuradas no se marca', () => {
    // No puede probar que fue recorrida, asi que apareceria descartada siempre y en todos
    // los casos — el mismo defecto que `EtapaRuta.tieneCasillas` ya evita en la reversa.
    const sinCasillas = SOENA.map(e => (e.orden === 8 ? { ...e, tieneCasillas: false } : e))
    const r = etapasDescartadas({
      etapas: sinCasillas,
      valores: SOLO_IVA,
      recorridas: new Set([1, 4, 5, 6, 16]),
      etapaActualOrden: 16,
    })
    expect(ordenes(r)).not.toContain(8)
    expect(ordenes(r)).toContain(7)
  })

  it('una linea sin bifurcaciones no produce ni una descartada', () => {
    // El portero es estructural: sin condiciones no hay nada que apagar.
    const lineal: EtapaRuta[] = SOENA.map(e => ({
      ...e,
      routing: e.routing ? { ...e.routing, conditional: [] } : null,
    }))
    const r = etapasDescartadas({
      etapas: lineal,
      valores: SOLO_IVA,
      recorridas: new Set([1, 4, 5, 6, 16]),
      etapaActualOrden: 16,
    })
    expect(r).toEqual([])
  })

  it('la rama alterna se corta al reencontrarse con la ruta real', () => {
    // Validacion (1) bifurca a Inclusion (2) o Propuesta (4). Un caso que ya venia cargado
    // en UPME se salta Inclusion y nada mas: de ahi en adelante las dos ramas son la misma.
    const r = etapasDescartadas({
      etapas: SOENA,
      valores: { ...SOLO_IVA, 1: { cargado_upme: 'si' } },
      recorridas: new Set([1, 4, 5, 6, 16]),
      etapaActualOrden: 16,
    })
    expect(ordenes(r)).toContain(2)
    expect(ordenes(r)).not.toContain(4)
    expect(ordenes(r)).not.toContain(5)
  })

  it('casos REALES de produccion (leidos el 2026-08-20)', () => {
    // Las tres formas que de verdad existen en la linea, para que un cambio de criterio
    // se vea contra datos y no contra un fixture inventado.
    const caso = (valores: ValoresPorOrden, recorridas: number[], actual: number) =>
      ordenes(etapasDescartadas({ etapas: SOENA, valores, recorridas: new Set(recorridas), etapaActualOrden: actual }))

    // V0184 — de los 212 abiertos que nunca respondieron el servicio: la bifurcacion de
    // Documentacion se resolvio en silencio, asi que NO se marca la via UPME. Solo queda
    // Inclusion, que si tiene respuesta.
    expect(caso(
      { 1: { cargado_upme: 'si' }, 6: { requiere_cita_dian: 'true' }, 16: { via_solicitud: 'pqrs' } },
      [1, 4, 5, 6, 7, 8, 9, 16, 17, 18], 17,
    )).toEqual([2])

    // V0303 — servicio completo: recorre la via larga, no descarta nada de ella.
    expect(caso(
      { 1: { cargado_upme: 'si' }, 5: { servicio: 'completo' }, 12: { requiere_cita_dian_iva: 'true' } },
      [1, 4, 5, 6, 7, 8, 9, 12, 16], 16,
    )).toEqual([2])

    // V0293 — solo_upme: tampoco descarta la via UPME (es justo la que contrato).
    expect(caso(
      { 1: { cargado_upme: 'si' }, 5: { servicio: 'solo_upme' } },
      [1, 4, 5, 6, 7, 8], 8,
    )).toEqual([2])

    // V0279 — solo_iva limpio: las cuatro de la via UPME, mas Inclusion.
    expect(caso(
      { 1: { cargado_upme: 'si' }, 5: { servicio: 'solo_iva' }, 6: { requiere_cita_dian: 'true' } },
      [1, 4, 5, 6, 16], 16,
    )).toEqual([2, 7, 8, 9, 20])
  })

  it('un routing ciclico no cuelga la deteccion', () => {
    const ciclico: EtapaRuta[] = [
      { id: 'a', nombre: 'A', orden: 1, numero: 1, tieneCasillas: true, puedeSaltarsePorSaldo: false, routing: { default_etapa_orden: 2, conditional: [{ condition: { field: 'x', value: 'si' }, etapa_orden: 3 }] } },
      { id: 'b', nombre: 'B', orden: 2, numero: 2, tieneCasillas: true, puedeSaltarsePorSaldo: false, routing: { default_etapa_orden: 2, conditional: [] } },
      { id: 'c', nombre: 'C', orden: 3, numero: 3, tieneCasillas: true, puedeSaltarsePorSaldo: false, routing: null },
    ]
    const r = etapasDescartadas({
      etapas: ciclico,
      valores: { 1: { x: 'si' } },
      recorridas: new Set([1, 3]),
      etapaActualOrden: 3,
    })
    expect(ordenes(r)).toEqual([2])
  })
})
