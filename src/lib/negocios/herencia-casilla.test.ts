import { describe, it, expect } from 'vitest'
import {
  esCopiaHeredada,
  fuenteDeHerencia,
  indicesDeHerencia,
  origenesPorSlugDe,
  type CasillaNueva,
  type ConfigDeFila,
  type FilaDelNegocio,
} from './herencia-casilla'

/**
 * Fixtures con la forma REAL de SOENA, medida en producción el 2026-09-14.
 *
 * El caso que abrió esto es V0475: hoy a las 15:08 y a las 15:15 le nacieron dos copias
 * de «Factura emitida» con `CertificadoVehiculosElectricos (17).pdf` adentro. No tiene
 * fila original de la factura; la única entrada con la llave `def:Factura emitida` era
 * una copia sucia de antes del #575 (etapa 10, creada el 08-sep a las 14:54). Cada copia
 * nueva la heredaba.
 */

const DEF_DOC = '61988509-deb4-40fa-a0c0-5afe66fe7f6c'
const DEF_DATOS = 'eb7f4ab1-0000-0000-0000-000000000000'
const DEF_PROP = '06eec331-0000-0000-0000-000000000000'

const CERTIFICADO = {
  file_name: 'CertificadoVehiculosElectricos (17).pdf',
  drive_url: 'https://drive.google.com/file/d/1CertificadoUpmeV0475xxxxxxxx/view',
  drive_file_id: '1CertificadoUpmeV0475xxxxxxxx',
  _cross_check: { passed: true },
}
const FACTURA_REAL = {
  campos: { numero_factura: { value: 'FV-2-248', manual: true } },
  origen: 'emitido_en_siigo',
  drive_url: 'https://drive.google.com/file/d/1XrMeN5uCm0KnETJ3_GlrznswQr04nIlc/view?usp=drivesdk',
  file_name: 'FV-2-248.pdf',
  drive_file_id: '1XrMeN5uCm0KnETJ3_GlrznswQr04nIlc',
}

// ── Configs ────────────────────────────────────────────────────────────────

const cfgFacturaOriginal: ConfigDeFila = {
  bloque_definition_id: DEF_DOC, nombre: 'Factura emitida', estado: 'editable', slug: 'factura_emitida',
  tipo: 'documento', config_extra: { drive_subfolder: '3. Facturación', editable_siempre: true },
}
const copiaFactura = (orden: number): ConfigDeFila => ({
  bloque_definition_id: DEF_DOC, nombre: 'Factura emitida', estado: 'visible', slug: null, tipo: 'documento',
  config_extra: {
    modo: 'visible', heredado: true, readonly: true, editable_siempre: true,
    source_etapa_orden: 7, source_bloque_slug: 'factura_emitida', _orden: orden,
  },
})
const cfgConceptoUpme: ConfigDeFila = {
  bloque_definition_id: DEF_DOC, nombre: 'Concepto UPME', estado: 'editable', slug: 'concepto_upme',
  tipo: 'documento', config_extra: { label: '003_CERTIFICADO_UPME' },
}

const casilla = (c: ConfigDeFila): CasillaNueva => ({
  bloque_definition_id: c.bloque_definition_id!, estado: c.estado!, nombre: c.nombre,
  config_extra: c.config_extra, tipo: c.tipo,
})

let seq = 0
const fila = (config: ConfigDeFila, estado: string, data: Record<string, unknown> | null, completado_at: string | null = null): FilaDelNegocio =>
  ({ id: `nb-${++seq}`, estado, data, completado_at, config })

/** Lo que hace `cambiarEtapaNegocio` con las filas que ya existen, en el orden en que llegan. */
function heredaria(nueva: ConfigDeFila, filas: FilaDelNegocio[]) {
  return fuenteDeHerencia(casilla(nueva), indicesDeHerencia(filas), origenesPorSlugDe(filas))
}

// ─── Pruebas ───────────────────────────────────────────────────────────────

describe('una copia nunca alimenta la herencia', () => {
  it('V0475: sin original, la copia sucia vieja NO se hereda a la copia nueva', () => {
    const filas = [
      fila(cfgConceptoUpme, 'completo', CERTIFICADO, '2026-09-08T14:54:29.805Z'),
      // La copia de la etapa 10, contaminada antes del #575.
      fila(copiaFactura(10), 'completo', CERTIFICADO, '2026-09-08T14:54:29.805Z'),
    ]
    expect(heredaria(copiaFactura(11), filas)).toBeUndefined()
  })

  it('original bueno y una copia sucia leída DESPUÉS: gana el original', () => {
    const original = fila(cfgFacturaOriginal, 'completo', FACTURA_REAL, '2026-08-27T18:59:14.920Z')
    const filas = [original, fila(copiaFactura(10), 'completo', CERTIFICADO, '2026-09-08T14:54:29.805Z')]
    const f = heredaria(copiaFactura(11), filas)
    expect(f?.id).toBe(original.id)
    expect(f?.data.file_name).toBe('FV-2-248.pdf')
  })

  it('el original real está PENDIENTE (así lo deja el archivado de Siigo) y aun así manda', () => {
    // 272 de las 274 facturas originales de SOENA con archivo están en `pendiente`:
    // `archivarPdfEnBloque` escribe la data sin tocar el estado.
    const original = fila(cfgFacturaOriginal, 'pendiente', FACTURA_REAL, '2026-08-27T18:59:14.920Z')
    const filas = [original, fila(copiaFactura(10), 'completo', CERTIFICADO)]
    expect(heredaria(copiaFactura(11), filas)?.data.file_name).toBe('FV-2-248.pdf')
  })

  it('original con la fila VACÍA: la copia nace sin archivo aunque otra copia tenga uno', () => {
    const filas = [
      fila(cfgFacturaOriginal, 'pendiente', {}),
      fila(copiaFactura(10), 'completo', CERTIFICADO),
    ]
    expect(heredaria(copiaFactura(11), filas)).toBeUndefined()
  })

  it('un original «completo» sin archivo no le da a la copia algo que mostrar', () => {
    const filas = [fila(cfgFacturaOriginal, 'completo', { campos: {} })]
    expect(heredaria(copiaFactura(11), filas)).toBeUndefined()
  })

  it('datos: la copia contaminada no se hereda cuando el origen no está completo', () => {
    // Forma real: "Radicado de inclusión" en etapa 8 con campos de OTRO bloque adentro
    // (28 negocios así en SOENA), y sin fila original.
    const copiaRadicado = (orden: number): ConfigDeFila => ({
      bloque_definition_id: DEF_DATOS, nombre: 'Radicado de inclusión', estado: 'visible', slug: null, tipo: 'datos',
      config_extra: { source_etapa_orden: 2, source_bloque_slug: 'radicado_de_inclusion', _orden: orden },
    })
    const filas = [fila(copiaRadicado(8), 'completo', { requiere_devolucion_iva: true })]
    expect(heredaria(copiaRadicado(9), filas)).toBeUndefined()
  })

  it('datos: con el origen completo, gana el origen aunque la copia se lea después', () => {
    const cfgOrigen: ConfigDeFila = {
      bloque_definition_id: DEF_DATOS, nombre: 'Devolución de IVA', estado: 'visible', slug: 'devolucion_de_iva',
      tipo: 'datos', config_extra: {},
    }
    const copia = (orden: number): ConfigDeFila => ({
      bloque_definition_id: DEF_DATOS, nombre: 'Devolución de IVA', estado: 'visible', slug: null, tipo: 'datos',
      config_extra: { source_etapa_orden: 5, source_bloque_slug: 'devolucion_de_iva', _orden: orden },
    })
    const origen = fila(cfgOrigen, 'completo', { requiere_devolucion_iva: false })
    const filas = [origen, fila(copia(6), 'completo', { cargado_upme: 'si' })]
    expect(heredaria(copia(8), filas)?.id).toBe(origen.id)
  })

  it('tipos con definition_id propio (propuesta): la copia tampoco alimenta', () => {
    const cfgOrigen: ConfigDeFila = {
      bloque_definition_id: DEF_PROP, nombre: 'Propuesta económica', estado: 'editable', slug: 'propuesta_economica',
      tipo: 'propuesta_economica', config_extra: {},
    }
    const copia = (orden: number): ConfigDeFila => ({
      bloque_definition_id: DEF_PROP, nombre: 'Propuesta económica', estado: 'visible', slug: null,
      tipo: 'propuesta_economica', config_extra: { readonly: true, source_etapa_orden: 4, source_bloque_slug: 'propuesta_economica', _orden: orden },
    })
    const origen = fila(cfgOrigen, 'completo', { aprobado_plan: 'plan1' })
    expect(heredaria(copia(8), [origen, fila(copia(6), 'completo', { aprobado_plan: 'viejo' })])?.id).toBe(origen.id)
    expect(heredaria(copia(8), [fila(copia(6), 'completo', { aprobado_plan: 'viejo' })])).toBeUndefined()
  })

  it('un documento editable hereda por label del ORIGEN, no de una copia con el mismo label', () => {
    const cfgAnexos: ConfigDeFila = {
      bloque_definition_id: DEF_DOC, nombre: 'Concepto UPME', estado: 'editable', slug: 'concepto_upme_anexos',
      tipo: 'documento', config_extra: { label: '003_CERTIFICADO_UPME' },
    }
    const copiaSucia: ConfigDeFila = {
      bloque_definition_id: DEF_DOC, nombre: 'Concepto UPME copia', estado: 'visible', slug: null, tipo: 'documento',
      config_extra: { label: '003_CERTIFICADO_UPME', source_etapa_orden: 9, source_bloque_slug: 'concepto_upme' },
    }
    const origen = fila(cfgConceptoUpme, 'completo', CERTIFICADO)
    const filas = [origen, fila(copiaSucia, 'completo', { file_name: 'RUT.pdf', drive_url: 'x' })]
    expect(heredaria(cfgAnexos, filas)?.id).toBe(origen.id)
  })
})

describe('qué es una copia', () => {
  it('visible y con referencia a su origen', () => {
    expect(esCopiaHeredada(copiaFactura(8))).toBe(true)
    expect(esCopiaHeredada({ estado: 'visible', config_extra: { source_etapa_orden: 7 } })).toBe(true)
  })

  it('un editable con referencia de origen NO es copia (casilla compartida)', () => {
    // «Certificado UPME» de Documentación: editable con `source_bloque_slug`, escribe en su origen.
    expect(esCopiaHeredada({ estado: 'editable', config_extra: { source_bloque_slug: 'concepto_upme' } })).toBe(false)
  })

  it('un visible sin referencia de origen es un origen (bloque del sistema)', () => {
    expect(esCopiaHeredada({ estado: 'visible', config_extra: {} })).toBe(false)
    expect(esCopiaHeredada({ estado: 'visible', config_extra: null })).toBe(false)
  })
})
