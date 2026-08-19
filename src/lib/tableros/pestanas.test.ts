import { describe, it, expect } from 'vitest'
import {
  necesitaDatosGenericos,
  pestanasDeTableros,
  tieneTablerosPropios,
  vistasDeOperaciones,
  type DatosTableros,
  type ModulosWorkspace,
} from './pestanas'

/** Todo lo que el servidor puede traer llego. Aisla el efecto de los modulos. */
const CON_DATOS: DatosTableros = {
  comercialNegocios: true,
  procesoSeccional: true,
  operacionesBono: true,
  calidad: true,
}

const SIN_DATOS: DatosTableros = {
  comercialNegocios: false,
  procesoSeccional: false,
  operacionesBono: false,
  calidad: false,
}

/** `modules` real de SOENA, medido en la base. */
const SOENA: ModulosWorkspace = {
  aliados: true,
  business: true,
  conciliacion: true,
  pausa_enabled: true,
  proceso_semanal: true,
  operaciones_bonos: true,
  comercial_negocios: true,
  fab_registrar_pago: true,
}

/** Los 7 workspaces con `business` que no tienen ningun modulo propio. */
const BUSINESS_PELADO: ModulosWorkspace = { business: true }

const claves = (mod: ModulosWorkspace, datos: DatosTableros = CON_DATOS) =>
  pestanasDeTableros(mod, datos).map(p => p.key)

describe('pestanasDeTableros', () => {
  it('SOENA ve exactamente dos pestanas: Comercial y Operaciones', () => {
    expect(claves(SOENA)).toEqual(['comercial_negocios', 'operaciones'])
  })

  it('un workspace con business y sin modulos propios conserva las tres genericas', () => {
    expect(claves(BUSINESS_PELADO)).toEqual(['financiero', 'comercial', 'operativo'])
  })

  it('las genericas conviven con Cumplimiento y con Recaudo y riesgo', () => {
    const mod = { business: true, compliance: true, calidad_llamadas: true }
    expect(claves(mod)).toEqual([
      'financiero',
      'comercial',
      'operativo',
      'cumplimiento',
      'calidad',
    ])
  })

  it('UN solo modulo propio ya apaga las tres genericas', () => {
    // El corazon del cambio: no hace falta tenerlos todos como SOENA. Un
    // workspace que solo mide el proceso tampoco debe ver el 0% falso de
    // utilizacion ni el financiero sin saldos.
    expect(claves({ business: true, proceso_semanal: true })).toEqual(['operaciones'])
    expect(claves({ business: true, operaciones_bonos: true })).toEqual(['operaciones'])
    expect(claves({ business: true, comercial_negocios: true })).toEqual(['comercial_negocios'])
  })

  it('los modulos propios NO dependen de business: gate propio, como Cumplimiento', () => {
    // Antes vivian dentro del `else if (mod.business)`. `business` gobierna
    // ademas el menu lateral, el FAB, Caja y Mi negocio, asi que apagarlo para
    // quitar una pestana rompia la aplicacion entera.
    const sinBusiness = { proceso_semanal: true, operaciones_bonos: true, comercial_negocios: true }
    expect(claves(sinBusiness)).toEqual(['comercial_negocios', 'operaciones'])
  })

  it('rentabilidad_comercial sigue excluyendo a las genericas', () => {
    expect(claves({ business: true, rentabilidad_comercial: true })).toEqual([
      'rentabilidad_comercial',
    ])
  })

  it('un modulo encendido sin datos no dibuja su pestana', () => {
    // Caso real: un rol no gerencial en SOENA no recibe el tablero comercial.
    // Queda con Operaciones, no con las genericas de vuelta.
    const soloComercialSinDatos = { ...CON_DATOS, comercialNegocios: false }
    expect(claves(SOENA, soloComercialSinDatos)).toEqual(['operaciones'])

    expect(claves(SOENA, SIN_DATOS)).toEqual([])
    expect(claves({ business: true, calidad_llamadas: true }, SIN_DATOS)).toEqual([
      'financiero',
      'comercial',
      'operativo',
    ])
  })

  it('sin ningun modulo no hay pestanas, y eso lo dice la pantalla', () => {
    expect(claves({})).toEqual([])
  })

  it('Cumplimiento no depende de datos ni de business', () => {
    expect(claves({ compliance: true }, SIN_DATOS)).toEqual(['cumplimiento'])
  })
})

describe('vistasDeOperaciones', () => {
  it('con los dos modulos ofrece Casos y Personas, en ese orden', () => {
    expect(vistasDeOperaciones(SOENA, CON_DATOS)).toEqual(['casos', 'personas'])
  })

  it('con un solo modulo devuelve una sola vista (la pestana no dibuja selector)', () => {
    expect(vistasDeOperaciones({ proceso_semanal: true }, CON_DATOS)).toEqual(['casos'])
    expect(vistasDeOperaciones({ operaciones_bonos: true }, CON_DATOS)).toEqual(['personas'])
  })

  it('sin datos no hay vista, y por eso tampoco pestana', () => {
    expect(vistasDeOperaciones(SOENA, SIN_DATOS)).toEqual([])
    expect(claves(SOENA, SIN_DATOS)).not.toContain('operaciones')
  })
})

describe('tieneTablerosPropios / necesitaDatosGenericos', () => {
  it('la condicion de pintar las genericas es la misma que la de consultarlas', () => {
    const casos: ModulosWorkspace[] = [
      BUSINESS_PELADO,
      SOENA,
      { business: true, proceso_semanal: true },
      { business: true, operaciones_bonos: true },
      { business: true, comercial_negocios: true },
      { business: true, rentabilidad_comercial: true },
      { compliance: true },
      {},
    ]
    for (const mod of casos) {
      const pinta = claves(mod).includes('financiero')
      expect(necesitaDatosGenericos(mod)).toBe(pinta)
    }
  })

  it('un workspace sin business no consulta las genericas aunque tenga modulos propios', () => {
    expect(necesitaDatosGenericos({ proceso_semanal: true })).toBe(false)
    expect(tieneTablerosPropios({ proceso_semanal: true })).toBe(true)
  })
})
