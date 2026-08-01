import { describe, it, expect } from 'vitest'
import { visiblePuedeNacerCompleto } from './bloque-visible-completo'

/**
 * El caso real que originó esta regla: el bloque "Cita DIAN" de la etapa Entrega en SOENA.
 * `visible` + `es_gate`, con un `select` obligatorio que decide el routing de toda la fase
 * de devolución de IVA. Nacía completo y vacío, así que el gate no retenía y el motor caía
 * al default (Facturación, que es etapa de cierre).
 */
const CITA_DIAN_ENTREGA = {
  fields: [
    { slug: 'seccional_display', tipo: 'plantilla', label: 'Seccional DIAN (RUT casilla 12)' },
    {
      slug: 'requiere_cita_dian_iva',
      tipo: 'select',
      required: true,
      label: '¿Requiere cita previa en la DIAN?',
    },
  ],
}

describe('visiblePuedeNacerCompleto', () => {
  it('NO da por resuelto el bloque cuando el campo que decide la ruta está vacío', () => {
    // Es el estado exacto en que nacían las 17 instancias: data {}.
    expect(visiblePuedeNacerCompleto(CITA_DIAN_ENTREGA, {}, true)).toBe(false)
  })

  it('lo da por resuelto cuando el auto-init ya escribió la respuesta', () => {
    expect(
      visiblePuedeNacerCompleto(CITA_DIAN_ENTREGA, {
        requiere_cita_dian_iva: 'true',
        seccional_ref: 'Dirección Seccional de Impuestos de Bogotá',
      }, true),
    ).toBe(true)
  })

  it('acepta "false" como respuesta válida: no requerir cita es una decisión, no un vacío', () => {
    expect(visiblePuedeNacerCompleto(CITA_DIAN_ENTREGA, { requiere_cita_dian_iva: 'false' }, true)).toBe(true)
  })

  it('no exige nada al bloque informativo sin campos required (comportamiento previo intacto)', () => {
    const soloLectura = { fields: [{ slug: 'nota', tipo: 'plantilla' }] }
    expect(visiblePuedeNacerCompleto(soloLectura, {}, true)).toBe(true)
    expect(visiblePuedeNacerCompleto({}, {}, true)).toBe(true)
    expect(visiblePuedeNacerCompleto(null, null, true)).toBe(true)
  })

  it('ignora el campo `plantilla` aunque venga marcado required: no captura respuesta', () => {
    const conPlantillaRequerida = {
      fields: [{ slug: 'aviso', tipo: 'plantilla', required: true }],
    }
    expect(visiblePuedeNacerCompleto(conPlantillaRequerida, {}, true)).toBe(true)
  })

  it('un toggle obligatorio en falso NO cuenta como resuelto (misma regla que el gate)', () => {
    // Delega en `campoRequeridoCumplido`: una confirmación apagada no es una confirmación.
    const confirmacion = { fields: [{ slug: 'entregado', tipo: 'toggle', required: true }] }
    expect(visiblePuedeNacerCompleto(confirmacion, { entregado: false }, true)).toBe(false)
    expect(visiblePuedeNacerCompleto(confirmacion, { entregado: true }, true)).toBe(true)
  })

  it('la data heredada de OTRO bloque no satisface los campos propios', () => {
    // La herencia ciega por bloque_definition_id metía data ajena (medido: 321 instancias
    // en SOENA). Aunque el bloque nazca con esa data, sus propios required siguen vacíos.
    const dataAjena = { radicado_certificacion: 'VEH_GEE2026102093', requiere_devolucion_iva: true }
    expect(visiblePuedeNacerCompleto(CITA_DIAN_ENTREGA, dataAjena, true)).toBe(false)
  })

  it('NO toca los bloques que no son gate: ahi nacer resuelto no decide nada', () => {
    // Acotamiento pedido por Mauricio (2026-07-31). Sin esto, ~640 instancias de bloques
    // informativos de SOENA (Vehiculos, Solicitantes asociados, Radicado de inclusion)
    // nacerian "pendiente" sin bloquear nada, ensuciando la pantalla del equipo.
    expect(visiblePuedeNacerCompleto(CITA_DIAN_ENTREGA, {}, false)).toBe(true)
    const conRequeridos = { fields: [{ slug: 'placa', tipo: 'texto', required: true }] }
    expect(visiblePuedeNacerCompleto(conRequeridos, {}, false)).toBe(true)
    expect(visiblePuedeNacerCompleto(conRequeridos, {}, true)).toBe(false)
  })

  it('exige TODOS los campos required, no solo el primero', () => {
    const dos = {
      fields: [
        { slug: 'a', tipo: 'texto', required: true },
        { slug: 'b', tipo: 'texto', required: true },
      ],
    }
    expect(visiblePuedeNacerCompleto(dos, { a: 'x' }, true)).toBe(false)
    expect(visiblePuedeNacerCompleto(dos, { a: 'x', b: 'y' }, true)).toBe(true)
  })
})
