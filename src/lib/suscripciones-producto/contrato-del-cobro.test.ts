import { describe, expect, it } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import { anclasDeOrigenes, compradorDeSuscripcion, contratoDelCobro } from './contrato-del-cobro'

/**
 * De quién es un cobro para la factura electrónica: negocio (empresa del directorio) o suscripción
 * (empresa declarada). La factura (Aliaddo) recibe el mismo origen, el mismo contrato y el mismo
 * comprador por los dos caminos.
 */

const WS = 'ws-metrik'

function tablas(extra: Partial<Tablas> = {}): Tablas {
  return {
    negocios: [{ id: 'n1', workspace_id: WS, metadata: { origen: 'valida_autogestion' } }],
    empresas: [
      {
        id: 'e1', razon_social: 'CDA DE HOY S.A.S.', nombre: 'CDA de hoy', tipo_documento: 'NIT', numero_documento: '900158425-0',
        tipo_persona: 'juridica', regimen_tributario: 'ordinario', responsable_iva: true, gran_contribuyente: false,
        autorretenedor: false, agente_retenedor: false, telefono: '6011234567',
      },
    ],
    suscripciones_producto: [
      {
        id: 's1', workspace_id: WS, metadata: { origen: 'valida_autogestion' }, razon_social: 'CDA EJEMPLO S.A.S.',
        tipo_documento: 'NIT', numero_documento: '900123456', dv: '7', correo_facturacion: 'facturas@cda.co',
        datos_fiscales: { responsable_iva: true, tipo_persona: 'juridica' },
      },
      { id: 's2', workspace_id: WS, metadata: { origen: 'directo_ventas' }, razon_social: 'X', numero_documento: '1', dv: null, datos_fiscales: {} },
    ],
    servicios_contratados: [
      { id: 'sc-n', workspace_id: WS, negocio_id: 'n1', suscripcion_id: null, empresa_id: 'e1', correo_facturacion: 'cda@hoy.co', servicio_slug: 'valida-cda-licencia' },
      { id: 'sc-s', workspace_id: WS, negocio_id: null, suscripcion_id: 's1', empresa_id: null, correo_facturacion: null, servicio_slug: 'valida-cda-licencia' },
    ],
    ...extra,
  }
}

describe('contratoDelCobro', () => {
  it('un cobro de negocio: el origen del negocio y la empresa del directorio', async () => {
    const { db } = crearDoble(tablas())
    const r = await contratoDelCobro(db, { workspace_id: WS, negocio_id: 'n1', suscripcion_id: null })
    expect(r).toMatchObject({
      ancla: { tipo: 'negocio', id: 'n1' },
      origen: 'valida_autogestion',
      contratos: 1,
      contrato: { servicio_slug: 'valida-cda-licencia', correo_facturacion: 'cda@hoy.co' },
      comprador: { razon_social: 'CDA DE HOY S.A.S.', numero_documento: '900158425-0', responsable_iva: true },
    })
  })

  it('un cobro de suscripción: el origen de la suscripción y la empresa que declaró, con su DV', async () => {
    const { db } = crearDoble(tablas())
    const r = await contratoDelCobro(db, { workspace_id: WS, negocio_id: null, suscripcion_id: 's1' })
    expect(r).toMatchObject({
      ancla: { tipo: 'suscripcion', id: 's1' },
      origen: 'valida_autogestion',
      contratos: 1,
      // Sin correo en el contrato, el de la suscripción.
      contrato: { servicio_slug: 'valida-cda-licencia', correo_facturacion: 'facturas@cda.co' },
      comprador: {
        razon_social: 'CDA EJEMPLO S.A.S.',
        tipo_documento: 'NIT',
        numero_documento: '900123456-7',
        tipo_persona: 'juridica',
        responsable_iva: true,
        gran_contribuyente: null,
      },
    })
  })

  it('dos contratos en la misma ancla son ambiguos: sin comprador', async () => {
    const t = tablas()
    t.servicios_contratados.push({ id: 'sc-s2', workspace_id: WS, negocio_id: null, suscripcion_id: 's1', servicio_slug: 'otra' })
    const r = await contratoDelCobro(crearDoble(t).db, { workspace_id: WS, negocio_id: null, suscripcion_id: 's1' })
    expect(r).toMatchObject({ contratos: 2, contrato: null, comprador: null })
  })

  it('un cobro sin ancla (o de otro cobrador) no tiene contrato', async () => {
    const { db } = crearDoble(tablas())
    expect(await contratoDelCobro(db, { workspace_id: WS, negocio_id: null, suscripcion_id: null })).toMatchObject({ ancla: null, contrato: null })
    expect(await contratoDelCobro(db, { workspace_id: 'otro', negocio_id: null, suscripcion_id: 's1' })).toMatchObject({ origen: null, comprador: null })
  })
})

describe('anclasDeOrigenes', () => {
  it('negocios y suscripciones del cobrador con el origen pedido', async () => {
    const { db } = crearDoble(tablas())
    expect(await anclasDeOrigenes(db, { workspaceId: WS, origenes: ['valida_autogestion'] })).toEqual({ negocios: ['n1'], suscripciones: ['s1'] })
  })
})

describe('compradorDeSuscripcion', () => {
  it('sin DV ni RUT leído: el NIT tal cual y lo fiscal en null', () => {
    expect(compradorDeSuscripcion({ razon_social: 'X S.A.S.', tipo_documento: null, numero_documento: '900123456', dv: null, datos_fiscales: null })).toEqual({
      razon_social: 'X S.A.S.',
      nombre: 'X S.A.S.',
      tipo_documento: 'NIT',
      numero_documento: '900123456',
      tipo_persona: null,
      regimen_tributario: null,
      responsable_iva: null,
      gran_contribuyente: null,
      autorretenedor: null,
      agente_retenedor: null,
      telefono: null,
    })
  })
})
