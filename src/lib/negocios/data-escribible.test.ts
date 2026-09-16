/**
 * La lista blanca de lo que el navegador escribe en `negocio_bloques.data`.
 * Ver `data-escribible.ts`.
 *
 * Las configs salen de las medidas en producción el 2026-09-16: los bloques `datos` declaran
 * campos `texto`, `select`, `toggle`, `imagen_clipboard` (`pantallazo_*`) y un
 * `documentos_preview` con slug `_preview_docs`; ninguno declara `docs`, `drive_url` ni
 * `drive_file_id`.
 *
 * VISTO FALLAR (2026-09-16), mutando `data-escribible.ts` una guarda a la vez (conteos de este
 * archivo; las mismas mutaciones tumban además las de `data-del-navegador.test.ts`):
 *   - dejando pasar toda clave (el comportamiento de `origin/main`): caen 4;
 *   - sin `CLAVES_NUNCA_DEL_NAVEGADOR`: cae 1;
 *   - sin el corte de los slugs con `_`: caen 2;
 *   - sin la validación del valor de imagen: cae 1;
 *   - en `reemplazo`, borrando lo no escribible que no viene: cae 1.
 */

import { describe, it, expect } from 'vitest'
import { clavesEscribibles, sanearDataDelNavegador } from './data-escribible'

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const OTRO_WS = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

const CONFIG_DATOS = {
  fields: [
    { slug: 'ciudad_venta', tipo: 'select' },
    { slug: 'requiere_cita', tipo: 'toggle' },
    { slug: 'pantallazo_inclusion', tipo: 'imagen_clipboard' },
    { slug: '_preview_docs', tipo: 'documentos_preview' },
  ],
}

describe('clavesEscribibles', () => {
  it('un bloque datos abre sus campos y las claves de su componente', () => {
    const claves = clavesEscribibles('datos', CONFIG_DATOS)
    expect([...claves].sort()).toEqual(
      ['_epayco_desglose', 'ciudad_venta', 'correo_seccional', 'pagos', 'pantallazo_inclusion', 'requiere_cita'].sort(),
    )
  })

  it('un campo declarado con nombre de referencia a archivo no se abre', () => {
    expect(clavesEscribibles('datos', { fields: [{ slug: 'drive_url', tipo: 'texto' }] }).has('drive_url')).toBe(false)
  })

  it('un bloque documento, formulario o propuesta no abre nada desde aquí', () => {
    for (const tipo of ['documento', 'documentos', 'formulario', 'propuesta_economica', 'cotizacion']) {
      expect(clavesEscribibles(tipo, { fields: [{ slug: 'x' }] }).size).toBe(0)
    }
  })
})

describe('sanearDataDelNavegador', () => {
  it('reemplazo: los campos se escriben y un campo que no viene se borra, como antes', () => {
    const r = sanearDataDelNavegador({
      entrante: { ciudad_venta: 'Cali' },
      guardada: { ciudad_venta: 'Bogota', requiere_cita: true },
      tipo: 'datos',
      configExtra: CONFIG_DATOS,
      workspaceId: WS,
      modo: 'reemplazo',
    })
    expect(r).toEqual({ ciudad_venta: 'Cali' })
  })

  it('reemplazo: lo que el navegador no escribe conserva lo guardado, venga o no', () => {
    const r = sanearDataDelNavegador({
      entrante: { ciudad_venta: 'Cali', drive_file_id: 'drv-de-otro-cliente', _ediciones: { x: 1 } },
      guardada: { drive_file_id: 'drv-propio', _ediciones: { ciudad_venta: { antes: 'Bogota' } }, _campo_retirado: { campo: 'y' } },
      tipo: 'datos',
      configExtra: CONFIG_DATOS,
      workspaceId: WS,
      modo: 'reemplazo',
    })
    expect(r).toEqual({
      ciudad_venta: 'Cali',
      drive_file_id: 'drv-propio',
      _ediciones: { ciudad_venta: { antes: 'Bogota' } },
      _campo_retirado: { campo: 'y' },
    })
  })

  it('mezcla sobre un bloque de documentos: `docs` no entra', () => {
    const guardada = { docs: { factura: `one://ve-documentos/${WS}/negocios/${NEG}/b/factura.pdf` } }
    const r = sanearDataDelNavegador({
      entrante: { docs: { factura: 'http://169.254.169.254/latest/meta-data/' } },
      guardada,
      tipo: 'documentos',
      configExtra: {},
      workspaceId: WS,
      modo: 'mezcla',
    })
    expect(r).toEqual(guardada)
  })

  it('el componente de equipo escribe sus tres responsables y nada más', () => {
    const r = sanearDataDelNavegador({
      entrante: { comercial_id: 'p-1', ejecucion_id: null, drive_url: 'x' },
      guardada: {},
      tipo: 'equipo',
      configExtra: {},
      workspaceId: WS,
      modo: 'mezcla',
    })
    expect(r).toEqual({ comercial_id: 'p-1', ejecucion_id: null })
  })

  it('un campo de imagen acepta la referencia de este workspace', () => {
    const ref = `one://ve-documentos/${WS}/negocios/${NEG}/b/pantallazo_inclusion.png`
    const r = sanearDataDelNavegador({
      entrante: { pantallazo_inclusion: ref },
      guardada: {},
      tipo: 'datos',
      configExtra: CONFIG_DATOS,
      workspaceId: WS,
      modo: 'mezcla',
    })
    expect(r.pantallazo_inclusion).toBe(ref)
  })

  it('un campo de imagen no acepta una URL arbitraria ni la referencia de otro workspace', () => {
    const guardada = { pantallazo_inclusion: `one://ve-documentos/${WS}/negocios/${NEG}/b/pantallazo_inclusion.png` }
    for (const valor of ['https://atacante.example/pixel.png', `one://ve-documentos/${OTRO_WS}/negocios/${NEG}/b/p.png`]) {
      const r = sanearDataDelNavegador({
        entrante: { pantallazo_inclusion: valor },
        guardada,
        tipo: 'datos',
        configExtra: CONFIG_DATOS,
        workspaceId: WS,
        modo: 'reemplazo',
      })
      expect(r.pantallazo_inclusion).toBe(guardada.pantallazo_inclusion)
    }
  })

  it('un slug declarado con `_` no pisa el espacio del servidor', () => {
    const r = sanearDataDelNavegador({
      entrante: { _preview_docs: 'x' },
      guardada: {},
      tipo: 'datos',
      configExtra: CONFIG_DATOS,
      workspaceId: WS,
      modo: 'mezcla',
    })
    expect(r).toEqual({})
  })
})
