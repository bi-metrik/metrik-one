/**
 * El criterio de la puerta de módulo de las acciones. Ver `requisito.ts`.
 *
 * Los contextos salen de los `modules` medidos en producción el 2026-09-16 (lectura por
 * PostgREST): 4d-soft solo tiene `valida_api`, los CDA solo `valida_consulta` en vitrina,
 * alma-afi es Sustenta con dual y vinculación, SOENA es Clarity con ePayco y Termotech es
 * Clarity sin ePayco.
 *
 * VISTO FALLAR (2026-09-16), mutando `requisito.ts` una guarda a la vez:
 *   - sin el corte del requisito vacío: cae 1;
 *   - sin la comprobación de módulos: caen 4;
 *   - sin la comprobación de la función: cae 1;
 *   - sin el paso del platform admin: cae 1.
 */

import { describe, it, expect } from 'vitest'
import type { ContextoGate } from './gate'
import { cumpleRequisitoModulo, REQUISITO as R } from './requisito'

function ctx(modules: Record<string, boolean> | null, platformAdmin = false): ContextoGate {
  return { modules, platformAdmin, modoVitrina: false }
}

const CUATRO_D_SOFT = ctx({ valida_api: true })
const CDA = ctx({ valida_consulta: true })
const ALMA_AFI = ctx({ compliance: true, compliance_vinculacion: true, compliance_dual_informa: true })
const SOENA = ctx({ business: true, fab_pago_epayco: true, fab_registrar_pago: true })
const TERMOTECH = ctx({ business: true, fab_registrar_pago: true })
const METRIK = ctx({ business: true, valida_consulta: true, compliance_audit: true })

describe('cumpleRequisitoModulo', () => {
  it('4d-soft (solo valida_api) no pasa ninguna puerta de MeTRIK', () => {
    for (const req of Object.values(R)) {
      expect(cumpleRequisitoModulo(req, CUATRO_D_SOFT)).toBe(false)
    }
  })

  it('un CDA consulta Valida con su llave pero no usa la llave global de Sustenta', () => {
    expect(cumpleRequisitoModulo(R.validaConsulta, CDA)).toBe(true)
    expect(cumpleRequisitoModulo(R.sustenta, CDA)).toBe(false)
    expect(cumpleRequisitoModulo(R.clarity, CDA)).toBe(false)
  })

  it('alma-afi usa la consulta dual y la vinculación; metrik no, aunque tenga Valida', () => {
    expect(cumpleRequisitoModulo(R.sustentaDual, ALMA_AFI)).toBe(true)
    expect(cumpleRequisitoModulo(R.sustentaVinculacion, ALMA_AFI)).toBe(true)
    expect(cumpleRequisitoModulo(R.sustentaDual, METRIK)).toBe(false)
  })

  it('la función se exige además del módulo: Termotech es Clarity pero no cobra por ePayco', () => {
    expect(cumpleRequisitoModulo(R.pagoEpayco, SOENA)).toBe(true)
    expect(cumpleRequisitoModulo(R.clarity, TERMOTECH)).toBe(true)
    expect(cumpleRequisitoModulo(R.pagoEpayco, TERMOTECH)).toBe(false)
  })

  it('llamadas y cobros recurrentes: advise audita, metrik sube PILA, SOENA no', () => {
    const ADVISE = ctx({ wa_customer_bot: true, calidad_llamadas: true, fab_registrar_cobro: true })
    const METRIK_COBROS = ctx({ business: true, cobros_recurrentes: true })
    expect(cumpleRequisitoModulo(R.llamadas, ADVISE)).toBe(true)
    expect(cumpleRequisitoModulo(R.llamadas, SOENA)).toBe(false)
    expect(cumpleRequisitoModulo(R.clarity, ADVISE)).toBe(false)
    expect(cumpleRequisitoModulo(R.cobrosRecurrentes, METRIK_COBROS)).toBe(true)
    expect(cumpleRequisitoModulo(R.cobrosRecurrentes, SOENA)).toBe(false)
    expect(cumpleRequisitoModulo(R.cobrosRecurrentes, ctx({ cobros_recurrentes: true }))).toBe(false)
  })

  it('una función sin su módulo no basta', () => {
    expect(cumpleRequisitoModulo(R.sustentaDual, ctx({ compliance_dual_informa: true }))).toBe(false)
  })

  it('un workspace sin `modules` es Clarity, igual que en el gate por ruta', () => {
    expect(cumpleRequisitoModulo(R.clarity, ctx(null))).toBe(true)
    expect(cumpleRequisitoModulo(R.validaConsulta, ctx(null))).toBe(false)
  })

  it('el soporte de MeTRIK pasa, como pasa el middleware', () => {
    expect(cumpleRequisitoModulo(R.sustentaDual, ctx({ valida_api: true }, true))).toBe(true)
  })

  it('un requisito vacío no autoriza, ni siquiera al platform admin', () => {
    expect(cumpleRequisitoModulo({}, SOENA)).toBe(false)
    expect(cumpleRequisitoModulo({ modulos: [] }, ctx(null, true))).toBe(false)
  })
})
