import { describe, it, expect } from 'vitest'
import { pasarelaWompi, wompiConfigurado, ENV_WOMPI, MOTIVO_SIN_CREDENCIALES } from './wompi'
import { adapterPara } from './registro'
import { PASARELAS, esPasarela } from '../estado'
import type { SolicitudCargo } from './adapter'

const solicitud: SolicitudCargo = {
  referencia: 'sub-abc-c1',
  suscripcionId: 'abc',
  workspaceId: 'ws-cliente',
  cobroId: 'cobro-1',
  planCobroId: 'plan-1',
  numeroCuota: 1,
  monto: 150_000,
  moneda: 'COP',
  descripcion: 'Licencia ONE — cuota 1 de 6',
  facturaRef: null,
  medioPago: null,
  cliente: null,
}

describe('wompi entra al vocabulario', () => {
  it('`wompi` es una pasarela válida del tipo', () => {
    expect(PASARELAS).toContain('wompi')
    expect(esPasarela('wompi')).toBe(true)
  })

  // El punto de este PR: antes caía en el `default` del registro y devolvía `null`,
  // indistinguible de una pasarela escrita mal.
  it('el registro le da un adaptador, no `null`', () => {
    expect(adapterPara('wompi')).toBe(pasarelaWompi)
  })

  it('una pasarela sin adaptador sigue devolviendo `null`', () => {
    expect(adapterPara('bold')).toBeNull()
    expect(adapterPara('epayco')).toBeNull()
    expect(adapterPara('paypal')).toBeNull()
  })
})

describe('sin credenciales no cobra, y lo dice', () => {
  it('`cobrar` devuelve error con motivo, NO un rechazo', async () => {
    const r = await pasarelaWompi.cobrar(solicitud)
    // Un `rechazado` le sumaría un intento fallido a la suscripción y la acercaría a
    // la suspensión por un problema nuestro, no del medio de pago del cliente.
    expect(r.estado).toBe('error')
    if (r.estado === 'error') {
      expect(r.reintentable).toBe(false)
      expect(r.mensaje).toBe(MOTIVO_SIN_CREDENCIALES)
    }
  })

  it('`consultar` responde igual: no hay a quién preguntarle', async () => {
    const r = await pasarelaWompi.consultar('cualquier-ref')
    expect(r.estado).toBe('error')
  })

  it('el webhook responde `no_configurado`, distinto de `firma_invalida`', () => {
    const v = pasarelaWompi.verificarWebhook?.('{}', {})
    expect(v).toEqual({ ok: false, motivo: 'no_configurado' })
  })
})

describe('wompiConfigurado', () => {
  const llaves = Object.values(ENV_WOMPI)

  it('es false cuando falta alguna llave', () => {
    expect(wompiConfigurado({})).toBe(false)
    for (const faltante of llaves) {
      const env = Object.fromEntries(llaves.filter((k) => k !== faltante).map((k) => [k, 'x']))
      expect(wompiConfigurado(env)).toBe(false)
    }
  })

  it('es false con una llave en blanco (puesta pero vacía)', () => {
    const env = Object.fromEntries(llaves.map((k) => [k, 'x']))
    env[ENV_WOMPI.llavePrivada] = '   '
    expect(wompiConfigurado(env)).toBe(false)
  })

  it('es true solo con las cuatro puestas', () => {
    expect(wompiConfigurado(Object.fromEntries(llaves.map((k) => [k, 'x'])))).toBe(true)
  })
})

describe('capacidades declaradas', () => {
  // No dependen de que las llaves estén puestas: el ciclo las consulta para decidir
  // si tiene sentido reintentar o esperar un clic del cliente.
  it('declara cobro sin clic y tokenización, que es por lo que se eligió', () => {
    expect(pasarelaWompi.capacidades).toEqual({
      cobroSinClic: true,
      tokenizacion: true,
      linkDePago: true,
      webhook: true,
    })
  })

  it('el nombre coincide con el valor que acepta el CHECK de la tabla', () => {
    expect(pasarelaWompi.nombre).toBe('wompi')
  })
})
