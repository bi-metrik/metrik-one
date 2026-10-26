/**
 * SOE-001 (SOENA, 2026-10-07): Seguimiento se parte en cuatro etapas de operaciones.
 *
 * Lo que se prueba aquí es lo que el CÓDIGO tiene que cumplir para que la configuración
 * nueva funcione sin tocar el motor de reprocesos ni el de avance:
 *  - el rechazo de la DIAN (reproceso «Devolución DIAN») se puede abrir desde las etapas
 *    21, 22 y 23 y rehace el tramo desde Cita o Anexos hasta donde está el caso;
 *  - el operativo del caso solo puede donde la etapa se lo abre, y nunca elige la causa;
 *  - el motivo es obligatorio y de la lista del tipo;
 *  - salir de «Validación de rechazo» antes del día 15 hábil queda marcado, sin frenar.
 */
import { describe, expect, it } from 'vitest'
import { tramoDelReproceso, type EtapaRetorno } from './retorno-reproceso'
import { MOTIVOS_REPROCESO, etiquetaMotivo, validarMotivoReproceso } from './motivos-reproceso'
import { operativoPuedeReprocesar, tiposReprocesoOperativo } from './reproceso-operativo'
import {
  anclaDeBloques,
  configAvanceAnticipado,
  contenidoAvanceAnticipado,
  diasHabilesEntre,
  evaluarAvanceAnticipado,
  fechaDeTexto,
} from './avance-anticipado'

// ── La línea con las etapas nuevas, con el routing del SQL de SOE-001 ──────────
type R = { conditional?: Array<{ condition: { field: string; value: string }; etapa_orden: number }>; default_etapa_orden: number }
const e = (orden: number, nombre: string, routing: R | null = null, extra: Record<string, unknown> = {}): EtapaRetorno => ({
  id: `etapa-${orden}`,
  nombre,
  orden,
  config_extra: { ...(routing ? { routing } : {}), ...extra },
})
const si = (field: string, value: string, etapa_orden: number) => ({ condition: { field, value }, etapa_orden })
const OPERATIVO = { reproceso_operativo: ['devolucion_dian'] }

const SOENA_SOE001: EtapaRetorno[] = [
  e(11, 'Cartera', { conditional: [si('requiere_cita_dian', 'true', 16), si('requiere_cita_dian', 'false', 18)], default_etapa_orden: 12 }),
  e(12, 'Entrega', { conditional: [si('requiere_cita_dian_iva', 'true', 16), si('requiere_cita_dian_iva', 'false', 18)], default_etapa_orden: 15 }),
  e(13, 'Generación'),
  e(14, 'Envío', { conditional: [], default_etapa_orden: 19 }),
  e(15, 'Facturación', { conditional: [], default_etapa_orden: 15 }),
  e(16, 'Cita', { conditional: [si('via_solicitud', 'pqrs', 17), si('via_solicitud', 'agenda', 18)], default_etapa_orden: 17 }),
  e(17, 'Notificación', { conditional: [si('resultado_pqr', 'pqr_rechazado', 16)], default_etapa_orden: 18 }),
  e(18, 'Anexos', { conditional: [], default_etapa_orden: 13 }),
  e(19, 'Entrega a la DIAN', { conditional: [], default_etapa_orden: 21 }),
  e(20, 'Revisión radicado', { conditional: [], default_etapa_orden: 9 }),
  e(21, 'Confirmación del radicado', { conditional: [], default_etapa_orden: 22 }, OPERATIVO),
  e(22, 'Validación de rechazo', { conditional: [], default_etapa_orden: 23 }, OPERATIVO),
  e(23, 'Acto administrativo', { conditional: [], default_etapa_orden: 24 }, OPERATIVO),
  e(24, 'Dinero en cuenta', { conditional: [], default_etapa_orden: 15 }),
]
const nombres = (t: ReturnType<typeof tramoDelReproceso>) => (t.antesDelRetorno ? null : t.etapas.map((x) => x.nombre).sort())

describe('el rechazo de la DIAN desde las etapas nuevas (tramo por el flujo)', () => {
  it('desde Acto administrativo (23) con cita: rehace Cita…Acto, sin tocar Dinero en cuenta ni Facturación', () => {
    expect(nombres(tramoDelReproceso(SOENA_SOE001, 16, 23))).toEqual([
      'Acto administrativo', 'Anexos', 'Cita', 'Confirmación del radicado', 'Entrega a la DIAN',
      'Envío', 'Generación', 'Notificación', 'Validación de rechazo',
    ])
  })

  it('desde Confirmación del radicado (21) sin cita: vuelve a Anexos y rehace Anexos…21', () => {
    expect(nombres(tramoDelReproceso(SOENA_SOE001, 18, 21))).toEqual([
      'Anexos', 'Confirmación del radicado', 'Entrega a la DIAN', 'Envío', 'Generación',
    ])
  })

  it('desde Validación de rechazo (22) el caso NO está antes del retorno: se puede reprocesar', () => {
    expect(tramoDelReproceso(SOENA_SOE001, 16, 22).antesDelRetorno).toBe(false)
    expect(tramoDelReproceso(SOENA_SOE001, 18, 22).antesDelRetorno).toBe(false)
  })
})

describe('el operativo del caso y el reproceso', () => {
  const cfg21 = SOENA_SOE001.find((x) => x.orden === 21)!.config_extra

  it('puede abrir «Devolución DIAN» en las etapas que se lo abren, si es el operativo del caso', () => {
    expect(operativoPuedeReprocesar({ tipo: 'devolucion_dian', configEtapa: cfg21, esOperativoDelCaso: true })).toBe(true)
  })

  it('no puede si no es el operativo del caso, ni para otro tipo, ni en otra etapa', () => {
    expect(operativoPuedeReprocesar({ tipo: 'devolucion_dian', configEtapa: cfg21, esOperativoDelCaso: false })).toBe(false)
    expect(operativoPuedeReprocesar({ tipo: 'certificacion_upme', configEtapa: cfg21, esOperativoDelCaso: true })).toBe(false)
    const cfg24 = SOENA_SOE001.find((x) => x.orden === 24)!.config_extra
    expect(operativoPuedeReprocesar({ tipo: 'devolucion_dian', configEtapa: cfg24, esOperativoDelCaso: true })).toBe(false)
  })

  it('la config solo acepta tipos que existen', () => {
    expect(tiposReprocesoOperativo({ reproceso_operativo: ['devolucion_dian', 'inventado', 3] })).toEqual(['devolucion_dian'])
    expect(tiposReprocesoOperativo({ reproceso_operativo: 'devolucion_dian' })).toEqual(['devolucion_dian'])
    expect(tiposReprocesoOperativo(null)).toEqual([])
  })
})

describe('motivo del reproceso', () => {
  it('es obligatorio y tiene que ser del tipo', () => {
    expect(validarMotivoReproceso({ tipo: 'devolucion_dian', motivo: '', causa: 'criterio_tercero', causaFija: false }).ok).toBe(false)
    expect(validarMotivoReproceso({ tipo: 'devolucion_dian', motivo: 'pago_upme_rechazado', causa: 'criterio_tercero', causaFija: false }).ok).toBe(false)
  })

  it('dirección/supervisión conservan la causa que eligieron', () => {
    const r = validarMotivoReproceso({ tipo: 'devolucion_dian', motivo: 'cliente_no_radico', causa: 'error_propio', causaFija: false })
    expect(r).toMatchObject({ ok: true, causa: 'error_propio' })
  })

  it('el operativo NO elige la causa: queda la del motivo, aunque mande otra', () => {
    const propio = validarMotivoReproceso({ tipo: 'devolucion_dian', motivo: 'documento_propio_mal_diligenciado', causa: 'criterio_tercero', causaFija: true })
    expect(propio).toMatchObject({ ok: true, causa: 'error_propio' })
    const tercero = validarMotivoReproceso({ tipo: 'devolucion_dian', motivo: 'cliente_no_firmo', causa: 'error_propio', causaFija: true })
    expect(tercero).toMatchObject({ ok: true, causa: 'criterio_tercero' })
  })

  it('cada tipo tiene «otro» y los valores no se repiten', () => {
    for (const lista of Object.values(MOTIVOS_REPROCESO)) {
      expect(lista.some((m) => m.value === 'otro')).toBe(true)
      expect(new Set(lista.map((m) => m.value)).size).toBe(lista.length)
    }
  })

  it('la etiqueta de un motivo viejo o desconocido se muestra tal cual, y sin motivo no hay etiqueta', () => {
    expect(etiquetaMotivo('devolucion_dian', 'rut_desactualizado')).toBe('El RUT del cliente estaba desactualizado')
    expect(etiquetaMotivo('devolucion_dian', 'motivo_retirado')).toBe('motivo_retirado')
    expect(etiquetaMotivo('devolucion_dian', null)).toBeNull()
  })
})

describe('salida anticipada de «Validación de rechazo» (sin gate, solo se mide)', () => {
  const cfg = configAvanceAnticipado({ registrar_avance_anticipado: { ancla_campo: 'fecha_entrega_dian', dias_habiles: 15 } })!

  it('cuenta días hábiles como la base: el día inicial no cuenta, fines de semana y festivos tampoco', () => {
    // Jueves 2026-10-08 → lunes 2026-10-12 es festivo (Día de la Raza): solo cuenta el viernes 9 y el martes 13.
    expect(diasHabilesEntre('2026-10-08', '2026-10-13')).toBe(2)
    expect(diasHabilesEntre('2026-10-08', '2026-10-08')).toBe(0)
    expect(diasHabilesEntre('2026-10-13', '2026-10-08')).toBe(0)
  })

  it('antes del día 15 queda marcado con los días que llevaba', () => {
    expect(evaluarAvanceAnticipado({ config: cfg, fechaAncla: '2026-10-01', hoy: '2026-10-09' })).toEqual({ dias: 6, plazo: 15 })
  })

  it('en el día 15 o después NO es anticipado', () => {
    // 2026-10-01 + 15 hábiles (con el festivo del 12-oct) = 2026-10-23.
    expect(evaluarAvanceAnticipado({ config: cfg, fechaAncla: '2026-10-01', hoy: '2026-10-23' })).toBeNull()
    expect(evaluarAvanceAnticipado({ config: cfg, fechaAncla: '2026-10-01', hoy: '2026-10-22' })).toEqual({ dias: 14, plazo: 15 })
  })

  it('sin T0 también se marca, como «sin ancla»', () => {
    expect(evaluarAvanceAnticipado({ config: cfg, fechaAncla: null, hoy: '2026-10-09' })).toEqual({ dias: null, plazo: 15 })
    expect(contenidoAvanceAnticipado('Validación de rechazo', { dias: null, plazo: 15 })).toContain('sin fecha de inicio')
  })

  it('el T0 se lee como lo lee el motor de plazos: el más reciente legible, y un año imposible no cuenta', () => {
    expect(fechaDeTexto('0006-02-18')).toBeNull()
    expect(fechaDeTexto('2026-10-01T07:00')).toBe('2026-10-01')
    expect(anclaDeBloques([{ fecha_entrega_dian: '0026-08-28' }, null, { fecha_entrega_dian: '2026-09-30' }, { otro: '2026-12-01' }], 'fecha_entrega_dian')).toBe('2026-09-30')
  })

  it('una config incompleta no enciende nada', () => {
    expect(configAvanceAnticipado({})).toBeNull()
    expect(configAvanceAnticipado({ registrar_avance_anticipado: { ancla_campo: '', dias_habiles: 15 } })).toBeNull()
    expect(configAvanceAnticipado({ registrar_avance_anticipado: { ancla_campo: 'x', dias_habiles: 0 } })).toBeNull()
  })
})
