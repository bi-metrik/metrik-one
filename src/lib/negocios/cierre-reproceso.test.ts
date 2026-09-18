/**
 * El cierre automático del reproceso, contra la topología REAL de SOENA (línea GIT EV/HEV,
 * leída de producción el 2026-09-18).
 *
 * Lo que estas pruebas tienen que fijar, y que una comparación por `orden` NO cumple:
 *  - Un caso que salió de Seguimiento (19) y llega a Facturación (15) SÍ rehizo el tramo.
 *    Por `orden` parecería que retrocedió.
 *  - Un caso que salió de Generación (13) y llega a Anexos (18) NO lo rehizo. Por `orden`
 *    parecería que ya pasó.
 * Las dos son casos vivos medidos hoy (V0403/V0213 la primera, V0255/V0446 la segunda).
 */
import { describe, expect, it } from 'vitest'
import { reprocesoQuedaRehecho, type MarcaParaCierre } from './cierre-reproceso'
import type { EtapaRetorno } from './retorno-reproceso'

/** Línea GIT EV/HEV de SOENA, tal como está en `etapas_negocio` (2026-09-18). */
const e = (
  orden: number,
  nombre: string,
  routing?: { default_etapa_orden?: number; conditional?: Array<{ etapa_orden: number; condition: { field: string; value: string } }> },
): EtapaRetorno => ({
  id: `e${orden}`,
  nombre,
  orden,
  config_extra: routing ? { routing } : {},
})

const SOENA: EtapaRetorno[] = [
  e(1, 'Validación', { default_etapa_orden: 4, conditional: [{ etapa_orden: 2, condition: { field: 'cargado_upme', value: 'no' } }] }),
  e(2, 'Inclusión', { default_etapa_orden: 4 }),
  e(4, 'Propuesta'),
  e(5, 'Negociación'),
  e(6, 'Documentación', { default_etapa_orden: 7, conditional: [{ etapa_orden: 10, condition: { field: 'servicio', value: 'solo_iva' } }] }),
  e(7, 'Cargue'),
  e(8, 'Pago UPME', { default_etapa_orden: 20 }),
  e(9, 'Certificación'),
  e(10, 'Segundo cobro'),
  e(11, 'Cartera', { default_etapa_orden: 12, conditional: [
    { etapa_orden: 16, condition: { field: 'requiere_cita_dian', value: 'true' } },
    { etapa_orden: 18, condition: { field: 'requiere_cita_dian', value: 'false' } },
  ] }),
  e(12, 'Entrega', { default_etapa_orden: 15, conditional: [
    { etapa_orden: 16, condition: { field: 'requiere_cita_dian_iva', value: 'true' } },
    { etapa_orden: 18, condition: { field: 'requiere_cita_dian_iva', value: 'false' } },
  ] }),
  e(13, 'Generación'),
  e(14, 'Envío', { default_etapa_orden: 19 }),
  e(15, 'Facturación', { default_etapa_orden: 15 }),
  e(16, 'Cita', { default_etapa_orden: 17, conditional: [
    { etapa_orden: 17, condition: { field: 'via_solicitud', value: 'pqrs' } },
    { etapa_orden: 18, condition: { field: 'via_solicitud', value: 'agenda' } },
  ] }),
  e(17, 'Notificación', { default_etapa_orden: 18, conditional: [{ etapa_orden: 16, condition: { field: 'resultado_pqr', value: 'pqr_rechazado' } }] }),
  e(18, 'Anexos', { default_etapa_orden: 13 }),
  e(19, 'Seguimiento', { default_etapa_orden: 15 }),
  e(20, 'Revisión radicado', { default_etapa_orden: 9 }),
]

const marca = (extra: Partial<MarcaParaCierre> = {}): MarcaParaCierre => ({
  activo: true,
  ciclo: 1,
  etapa_origen: 'Seguimiento',
  ...extra,
})

const decidir = (m: MarcaParaCierre | null, ordenDestino: number, etapas = SOENA) =>
  reprocesoQuedaRehecho({ marca: m, etapas, ordenDestino })

describe('reprocesoQuedaRehecho — el flujo manda, no el orden', () => {
  it('salió de Seguimiento (19) y llega a Facturación (15): rehecho, aunque el orden baje', () => {
    const d = decidir(marca({ etapa_origen: 'Seguimiento' }), 15)
    expect(d.cierra).toBe(true)
    expect(d).toMatchObject({ ciclo: 1, etapaOrigen: 'Seguimiento' })
  })

  it('salió de Generación (13) y llega a Anexos (18): NO rehecho, aunque el orden suba', () => {
    // Anexos → Generación: Anexos va ANTES. Casos vivos V0255 y V0446.
    expect(decidir(marca({ etapa_origen: 'Generación' }), 18)).toEqual({ cierra: false, motivo: 'no_alcanzado' })
  })

  it('salió de Envío (14) y llega a Generación (13): NO rehecho (V0388)', () => {
    expect(decidir(marca({ etapa_origen: 'Envío' }), 13)).toEqual({ cierra: false, motivo: 'no_alcanzado' })
  })

  it('llegar a la PROPIA etapa de origen ya cuenta como alcanzarla', () => {
    expect(decidir(marca({ etapa_origen: 'Seguimiento' }), 19).cierra).toBe(true)
  })

  it('salió de Pago UPME (8) y llega a Cita (16): rehecho (V0309)', () => {
    expect(decidir(marca({ etapa_origen: 'Pago UPME' }), 16).cierra).toBe(true)
  })

  it('salió de Anexos (18) y llega a Cita (16): NO rehecho — le falta volver por el tramo (V0254)', () => {
    expect(decidir(marca({ etapa_origen: 'Anexos' }), 16)).toEqual({ cierra: false, motivo: 'no_alcanzado' })
  })

  it('devuelto a Cita y apenas avanza un paso a Notificación: NO cierra', () => {
    // El criterio de Vera: superar la etapa de RETORNO (Cita) no es haber rehecho el tramo.
    // El origen es Seguimiento y Notificación (17) no lo alcanza.
    expect(decidir(marca({ etapa_origen: 'Seguimiento' }), 17)).toEqual({ cierra: false, motivo: 'no_alcanzado' })
  })
})

describe('reprocesoQuedaRehecho — cuándo se abstiene', () => {
  it('sin marca, no cierra', () => {
    expect(decidir(null, 15)).toEqual({ cierra: false, motivo: 'sin_marca' })
  })

  it('marca ya cerrada, no la vuelve a tocar', () => {
    expect(decidir(marca({ activo: false }), 15)).toEqual({ cierra: false, motivo: 'no_activo' })
  })

  it('sin etapa_origen no adivina: son los 22 reprocesos vivos de hoy', () => {
    expect(decidir(marca({ etapa_origen: null }), 15)).toEqual({ cierra: false, motivo: 'sin_origen' })
    expect(decidir(marca({ etapa_origen: '  ' }), 15)).toEqual({ cierra: false, motivo: 'sin_origen' })
    expect(decidir({ activo: true, ciclo: 1 }, 15)).toEqual({ cierra: false, motivo: 'sin_origen' })
  })

  it('etapa de origen que ya no existe en la línea: se queda abierto, no se cierra de más', () => {
    expect(decidir(marca({ etapa_origen: 'Seguimiento viejo' }), 15))
      .toEqual({ cierra: false, motivo: 'origen_desconocido' })
  })

  it('sin ciclo utilizable no toca el evento de calidad', () => {
    expect(decidir(marca({ ciclo: 0 }), 15)).toEqual({ cierra: false, motivo: 'sin_marca' })
    expect(decidir({ activo: true, etapa_origen: 'Seguimiento' }, 15)).toEqual({ cierra: false, motivo: 'sin_marca' })
  })
})

describe('reprocesoQuedaRehecho — una línea sin routing se mide por orden', () => {
  const LINEAL: EtapaRetorno[] = [e(1, 'Uno'), e(2, 'Dos'), e(3, 'Tres')]

  it('alcanza cualquier etapa de orden mayor o igual', () => {
    expect(decidir(marca({ etapa_origen: 'Dos' }), 2, LINEAL).cierra).toBe(true)
    expect(decidir(marca({ etapa_origen: 'Dos' }), 3, LINEAL).cierra).toBe(true)
  })

  it('no alcanza una etapa anterior', () => {
    expect(decidir(marca({ etapa_origen: 'Dos' }), 1, LINEAL)).toEqual({ cierra: false, motivo: 'no_alcanzado' })
  })
})
