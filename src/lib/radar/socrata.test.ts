/**
 * El mapeo y la deduplicación del barrido. Las filas son recortes REALES del barrido del
 * 2026-09-28 (`metrik-data/barridos/_universo-2026-09-28.json`), con sus rarezas intactas: el
 * proceso repetido por fase, la referencia con la fase pegada, `urlproceso` como objeto y como
 * texto, y el precio base vacío de un sondeo.
 */
import { describe, expect, it } from 'vitest'
import { BIBLIOTECA } from './biblioteca'
import {
  CAMPOS_SOCRATA,
  LARGO_OBJETO,
  PAGINA_SOCRATA,
  diasParaCierre,
  prepararProcesos,
  urlPaginaSocrata,
  type FilaSocrata,
} from './socrata'

const OP = { sinRup: BIBLIOTECA.sinRup, tiposCompra: BIBLIOTECA.tiposCompra }

const SDP: FilaSocrata = {
  id_del_proceso: 'CO1.NTC.10766528',
  referencia_del_proceso: 'SDP-LP-003-2026',
  modalidad_de_contratacion: 'Licitación pública',
  entidad: 'SECRETARIA DISTRITAL DE PLANEACION',
  departamento_entidad: 'Distrito Capital de Bogotá',
  ciudad_entidad: 'Bogotá',
  descripci_n_del_procedimiento: 'CONTRATAR UNA FÁBRICA DE SOFTWARE',
  precio_base: '5528513061',
  fecha_de_publicacion_del: '2026-09-12T00:00:00.000',
  fecha_de_recepcion_de: '2026-10-06T00:00:00.000',
  duracion: '14',
  unidad_de_duracion: 'Mes(es)',
  tipo_de_contrato: 'Prestación de servicios',
  urlproceso: { url: 'https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=CO1.NTC.10766528' },
}

const INVIAS: FilaSocrata = {
  id_del_proceso: 'CO1.NTC.9999001',
  referencia_del_proceso: 'SIP-DTE-SRT-043-2026',
  modalidad_de_contratacion: 'Solicitud de información a los Proveedores',
  entidad: 'INVIAS',
  departamento_entidad: 'Distrito Capital de Bogotá',
  descripci_n_del_procedimiento: 'SOLICITUD DE INFORMACIÓN A PROVEEDORES PARA EL MANUAL DE INTEROPERABILIDAD FÉRREA',
  // Un RFI es un sondeo: no tiene presupuesto.
  precio_base: '',
  fecha_de_recepcion_de: '2026-10-15T00:00:00.000',
  tipo_de_contrato: 'No Especificado',
  urlproceso: 'https://community.secop.gov.co/algo',
}

const MINIMA: FilaSocrata = {
  id_del_proceso: 'CO1.NTC.9999002',
  referencia_del_proceso: 'SA-024-2026 (Presentación de oferta)',
  modalidad_de_contratacion: 'Mínima cuantía',
  entidad: 'BIBLIOTECA PUBLICA PILOTO',
  departamento_entidad: 'Antioquia',
  descripci_n_del_procedimiento: 'Suministro de equipos y elementos audiovisuales',
  precio_base: '48000000',
  fecha_de_recepcion_de: '2026-10-02T00:00:00.000',
  tipo_de_contrato: 'Suministro',
}

describe('la URL del barrido', () => {
  const u = new URL(urlPaginaSocrata('2026-09-28', 40000))

  it('pide solo procesos con recepción de ofertas abierta después de hoy', () => {
    expect(u.searchParams.get('$where')).toBe(
      "estado_del_procedimiento in('Abierto','Publicado') AND fecha_de_recepcion_de > '2026-09-28T23:59:59'",
    )
  })

  it('ordena por id_del_proceso: sin orden, la paginación repite y salta filas', () => {
    expect(u.searchParams.get('$order')).toBe('id_del_proceso')
    expect(u.searchParams.get('$offset')).toBe('40000')
    expect(u.searchParams.get('$limit')).toBe(String(PAGINA_SOCRATA))
  })

  it('pide los 14 campos, no `*`', () => {
    expect(CAMPOS_SOCRATA.split(',')).toHaveLength(14)
    expect(u.searchParams.get('$select')).toBe(CAMPOS_SOCRATA)
  })
})

describe('deduplicación por notice_uid', () => {
  it('el mismo proceso repetido por fase entra UNA vez', () => {
    // Es el caso de IDARTES-SA-SI-013-2026, que salía cuatro veces e inflaba todos los conteos.
    const cuatroFases = [
      { ...SDP, referencia_del_proceso: 'SDP-LP-003-2026 (Borrador)' },
      { ...SDP, referencia_del_proceso: 'SDP-LP-003-2026 (Presentación de oferta)' },
      { ...SDP, referencia_del_proceso: 'SDP-LP-003-2026 (Evaluación)' },
      SDP,
    ]
    const r = prepararProcesos(cuatroFases, OP)
    expect(r).toHaveLength(1)
    // Gana la PRIMERA aparición, igual que `preparar()` en Python.
    expect(r[0].referencia).toBe('SDP-LP-003-2026 (Borrador)')
  })

  it('una fila sin id_del_proceso se descarta: sin clave natural no hay upsert idempotente', () => {
    expect(prepararProcesos([{ ...SDP, id_del_proceso: '' }, SDP], OP)).toHaveLength(1)
    expect(prepararProcesos([{ ...SDP, id_del_proceso: undefined }], OP)).toEqual([])
  })

  it('procesos distintos no se pisan', () => {
    expect(prepararProcesos([SDP, INVIAS, MINIMA], OP).map((p) => p.notice_uid)).toEqual([
      'CO1.NTC.10766528',
      'CO1.NTC.9999001',
      'CO1.NTC.9999002',
    ])
  })
})

describe('el mapeo de cada campo', () => {
  const [sdp, invias] = prepararProcesos([SDP, INVIAS, MINIMA], OP)

  it('las fechas quedan en YYYY-MM-DD', () => {
    expect(sdp.fecha_cierre).toBe('2026-10-06')
    expect(sdp.fecha_publicacion).toBe('2026-09-12')
    // Sin fecha de publicación no se inventa una: queda null.
    expect(invias.fecha_publicacion).toBeNull()
  })

  it('un precio base vacío es 0 (sondeo), no un error', () => {
    expect(invias.valor).toBe(0)
    expect(sdp.valor).toBe(5528513061)
  })

  it('`urlproceso` llega como objeto o como texto y las dos formas se leen', () => {
    expect(sdp.url).toContain('noticeUID=CO1.NTC.10766528')
    expect(invias.url).toBe('https://community.secop.gov.co/algo')
    expect(prepararProcesos([{ ...SDP, urlproceso: undefined }], OP)[0].url).toBeNull()
  })

  it('la duración se junta y un vacío queda null', () => {
    expect(sdp.duracion).toBe('14 Mes(es)')
    expect(invias.duracion).toBeNull()
  })

  it('el objeto se recorta a 600: guardar el pliego entero no cambia ningún FIT', () => {
    const largo = prepararProcesos([{ ...SDP, descripci_n_del_procedimiento: 'A'.repeat(900) }], OP)
    expect(largo[0].objeto).toHaveLength(LARGO_OBJETO)
  })

  it('el departamento y el tipo de contrato ausentes dicen «No especificado»', () => {
    const pelado = prepararProcesos([{ id_del_proceso: 'x' }], OP)[0]
    expect(pelado.departamento).toBe('No especificado')
    expect(pelado.tipo_contrato).toBe('No especificado')
    expect(pelado.ciudad).toBeNull()
  })
})

describe('las dos banderas que la pantalla filtra', () => {
  it('sin_rup es cierto en mínima cuantía y en RFI, y falso en licitación', () => {
    const [sdp, invias, minima] = prepararProcesos([SDP, INVIAS, MINIMA], OP)
    expect(minima.sin_rup).toBe(true)
    expect(invias.sin_rup).toBe(true)
    expect(sdp.sin_rup).toBe(false)
  })

  it('es_compra distingue comprar bienes de contratar servicios', () => {
    const [sdp, , minima] = prepararProcesos([SDP, INVIAS, MINIMA], OP)
    expect(minima.es_compra).toBe(true)
    expect(sdp.es_compra).toBe(false)
  })

  it('las dos listas salen de la biblioteca, no de una copia', () => {
    expect(BIBLIOTECA.sinRup).toEqual(['Mínima cuantía', 'Solicitud de información a los Proveedores'])
    expect(BIBLIOTECA.tiposCompra).toEqual(['Compraventa', 'Suministro'])
  })
})

describe('días para el cierre', () => {
  it('cuenta días calendario y admite el pasado', () => {
    expect(diasParaCierre('2026-10-06', '2026-09-28')).toBe(8)
    expect(diasParaCierre('2026-09-28', '2026-09-28')).toBe(0)
    expect(diasParaCierre('2026-09-20', '2026-09-28')).toBe(-8)
  })

  it('cruza fin de mes y de año sin corrimiento', () => {
    expect(diasParaCierre('2026-10-01', '2026-09-30')).toBe(1)
    expect(diasParaCierre('2027-01-01', '2026-12-31')).toBe(1)
  })

  it('sin fecha de cierre no hay número inventado', () => {
    expect(diasParaCierre(null, '2026-09-28')).toBeNull()
  })
})
