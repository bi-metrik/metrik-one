/**
 * El motor de emisión con un repositorio en memoria que ESCRIBE y un Muisca falso que guarda lo que
 * «creó». Así «se emitió dos veces» se ve como dos documentos en el falso, no como una suposición.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { CONSULTAS_ANTES_DE_AVISAR, INTENTOS_ANTES_DE_AVISAR, procesarEmision, type DepsEmision, type Emision, type MotivoAlerta, type RepoEmision } from './emision'
import type { ClienteMuisca, DocumentoMuisca, RespuestaMuisca } from './muisca'

const CUFE = 'ca2f628cac4a2f71a510cf28eaba9ad9703686681cb11e5ecea9a1d26f375e1cdc9899dea2e81a9eb1758382c3582b0f'
const RESOLUCION = { key: 'k', prefix: 'SETP', number: 1, rangeInitial: 990000000, rangeFinal: 995000000, validFrom: '2019-01-19', validUntil: '2030-01-19' }
const NIT = '900156521'

function emision(extra: Partial<Emision> = {}): Emision {
  return {
    id: 'e1',
    workspaceId: 'ws',
    cobroId: 'c1',
    tipo: 'factura',
    modo: 'Production',
    estado: 'pendiente',
    prefijo: null,
    consecutivo: null,
    numero: null,
    proveedorDocumentoId: null,
    cufe: null,
    fechaEmision: null,
    intentos: 0,
    alertaMotivo: null,
    ...extra,
  }
}

function doc(extra: Partial<DocumentoMuisca> = {}): DocumentoMuisca {
  return {
    id: 'doc-1',
    cufe: CUFE,
    numero: 'SETP990000001',
    prefijo: 'SETP',
    consecutivo: 990000001,
    estado: 'aprobada',
    estadoOriginal: 'Aprobada',
    motivos: ['Procesado Correctamente.'],
    fechaEmision: '2026-10-20',
    urlPdf: 'r/fv.pdf',
    urlXml: 'r/fv.xml',
    pdfBase64: null,
    xmlBase64: null,
    identificacionCliente: NIT,
    monto: 150000,
    ...extra,
  }
}

let fila: Emision
let siguiente: number | null
let ocupada: boolean
let alertas: Array<{ motivo: MotivoAlerta; detalle: string }>
let publicadas: number
let creados: Array<Record<string, unknown>>
let enMuisca: Map<string, DocumentoMuisca>
let respuestasCrear: Array<RespuestaMuisca | 'crea'>
let respuestasConsulta: RespuestaMuisca[]
let problemaDatos: string | null
let descargaOk: boolean

const repo: RepoEmision = {
  async reclamar() {
    return ocupada ? null : { ...fila }
  },
  async soltar() {},
  async asignarConsecutivo() {
    if (fila.consecutivo !== null) return { ok: true, numeracion: { prefijo: fila.prefijo!, consecutivo: fila.consecutivo } }
    if (siguiente === null) return { ok: false, motivo: 'sin_numeracion', detalle: 'sin numeración' }
    fila.prefijo = 'SETP'
    fila.consecutivo = siguiente++
    fila.numero = `SETP${fila.consecutivo}`
    return { ok: true, numeracion: { prefijo: fila.prefijo, consecutivo: fila.consecutivo } }
  },
  async preparar() {
    if (problemaDatos) return { ok: false, problema: problemaDatos }
    return {
      ok: true,
      preparado: {
        identificacionComprador: NIT,
        monto: 150000,
        prefijoResolucion: (n) => n.prefijo,
        armar: ({ prefijo, consecutivo, resolucion }) => ({ prefix: prefijo, consecutive: consecutivo, resolution: resolucion.key }),
      },
    }
  },
  async guardar(_id, c) {
    if (c.estado) fila.estado = c.estado
    if (c.intentos !== undefined) fila.intentos = c.intentos
    if (c.proveedorDocumentoId !== undefined) fila.proveedorDocumentoId = c.proveedorDocumentoId
    if (c.cufe) fila.cufe = c.cufe
    if (c.numero) fila.numero = c.numero
    if (c.fechaEmision) fila.fechaEmision = c.fechaEmision
    if (c.alertaMotivo) fila.alertaMotivo = c.alertaMotivo
  },
  async guardarArchivos(_e, a) {
    return { pdfPath: a.pdf ? 'ws/facturas/x.pdf' : null, pdfSha: a.pdf ? 'a'.repeat(64) : null, xmlPath: a.xml ? 'ws/facturas/x.xml' : null, xmlSha: a.xml ? 'b'.repeat(64) : null }
  },
  async publicar(e) {
    if (e.modo === 'Production' && e.tipo === 'factura') publicadas += 1
  },
  async alertar(_e, motivo, detalle) {
    alertas.push({ motivo, detalle })
  },
}

const muisca: ClienteMuisca = {
  async crear(_tipo, cuerpo) {
    const r = respuestasCrear.shift() ?? 'crea'
    if (r !== 'crea') return r
    creados.push(cuerpo)
    const d = doc({ id: `doc-${creados.length}`, consecutivo: cuerpo.consecutive as number, numero: `SETP${cuerpo.consecutive}` })
    enMuisca.set(`${cuerpo.prefix}${cuerpo.consecutive}`, d)
    return { tipo: 'documento', documento: d }
  },
  async consultarPorId(_t, id) {
    const r = respuestasConsulta.shift()
    if (r) return r
    const d = [...enMuisca.values()].find((x) => x.id === id)
    return d ? { tipo: 'documento', documento: d } : { tipo: 'no_encontrado' }
  },
  async buscarPorNumero(_t, prefijo, consecutivo) {
    const d = enMuisca.get(`${prefijo}${consecutivo}`)
    return d ? { tipo: 'documento', documento: d } : { tipo: 'no_encontrado' }
  },
  async resoluciones() {
    return { ok: true, resoluciones: [RESOLUCION] }
  },
  async descargar() {
    return descargaOk ? { ok: true, bytes: new Uint8Array([37, 80, 68, 70]) } : { ok: false, mensaje: 'sin base' }
  },
}

const deps: DepsEmision = {
  repo,
  muisca,
  ahora: () => new Date('2026-10-20T15:00:00Z'),
  resolucion: async (p) => (p === RESOLUCION.prefix ? RESOLUCION : null),
}

beforeEach(() => {
  fila = emision()
  siguiente = 990000001
  ocupada = false
  alertas = []
  publicadas = 0
  creados = []
  enMuisca = new Map()
  respuestasCrear = []
  respuestasConsulta = []
  problemaDatos = null
  descargaOk = true
})

describe('procesarEmision', () => {
  it('camino feliz: número, envío, CUFE, archivos y publicada (Production)', async () => {
    const r = await procesarEmision('e1', deps)
    expect(r.estado).toBe('archivada')
    expect(creados).toEqual([{ prefix: 'SETP', consecutive: 990000001, resolution: 'k' }])
    expect(fila).toMatchObject({ estado: 'archivada', numero: 'SETP990000001', cufe: CUFE, fechaEmision: '2026-10-20' })
    expect(publicadas).toBe(1)
    expect(alertas).toEqual([])
  })

  it('en Test no se publica para el cliente', async () => {
    fila = emision({ modo: 'Test' })
    await procesarEmision('e1', deps)
    expect(fila.estado).toBe('archivada')
    expect(publicadas).toBe(0)
  })

  it('otro proceso la tiene: no hace nada', async () => {
    ocupada = true
    expect((await procesarEmision('e1', deps)).estado).toBe('ocupada')
    expect(creados).toHaveLength(0)
  })

  it('una factura por pago: repetir el proceso no crea otra', async () => {
    await procesarEmision('e1', deps)
    await procesarEmision('e1', deps)
    await procesarEmision('e1', deps)
    expect(creados).toHaveLength(1)
  })

  it('se cayó después de crearla: el reintento la ENCUENTRA por número y no la duplica', async () => {
    // El primer intento crea en Muisca pero la respuesta se pierde (tiempo agotado).
    respuestasCrear = ['crea']
    const crear = muisca.crear
    muisca.crear = async (t, c) => {
      await crear(t, c)
      return { tipo: 'transitorio', http: null, mensaje: 'sin respuesta en 25000 ms' }
    }
    const r1 = await procesarEmision('e1', deps)
    muisca.crear = crear
    expect(r1.estado).toBe('pendiente')
    expect(fila).toMatchObject({ intentos: 1, consecutivo: 990000001 })

    const r2 = await procesarEmision('e1', deps)
    expect(r2.estado).toBe('archivada')
    expect(creados).toHaveLength(1)
    expect(fila.cufe).toBe(CUFE)
  })

  it('el reintento usa el MISMO consecutivo', async () => {
    respuestasCrear = [{ tipo: 'transitorio', http: 500, mensaje: 'HTTP 500' }]
    await procesarEmision('e1', deps)
    await procesarEmision('e1', deps)
    expect(creados.map((c) => c.consecutive)).toEqual([990000001])
    expect(siguiente).toBe(990000002)
  })

  it('el número ya lo usa OTRO documento: se bloquea y avisa, no se reenvía', async () => {
    fila = emision({ prefijo: 'SETP', consecutivo: 990000001, numero: 'SETP990000001', intentos: 1 })
    enMuisca.set('SETP990000001', doc({ identificacionCliente: '800111222' }))
    const r = await procesarEmision('e1', deps)
    expect(r.estado).toBe('bloqueada')
    expect(creados).toHaveLength(0)
    expect(alertas.map((a) => a.motivo)).toEqual(['consecutivo_ocupado'])
  })

  it('una rechazada con el mismo número se vuelve a mandar corregida (no se adopta)', async () => {
    fila = emision({ prefijo: 'SETP', consecutivo: 990000001, numero: 'SETP990000001', intentos: 1 })
    enMuisca.set('SETP990000001', doc({ estado: 'rechazada', estadoOriginal: 'Rechazada' }))
    const r = await procesarEmision('e1', deps)
    expect(r.estado).toBe('archivada')
    expect(creados).toHaveLength(1)
  })

  it('DIAN no disponible: queda enviada y se CONSULTA después, sin volver a crear', async () => {
    respuestasCrear = [{ tipo: 'documento', documento: doc({ id: 'doc-9', cufe: null, estado: 'en_proceso', estadoOriginal: 'DianNoDisponible' }) }]
    const r1 = await procesarEmision('e1', deps)
    expect(r1.estado).toBe('enviada')
    expect(fila.proveedorDocumentoId).toBe('doc-9')

    respuestasConsulta = [{ tipo: 'documento', documento: doc({ id: 'doc-9' }) }, { tipo: 'documento', documento: doc({ id: 'doc-9' }) }]
    const r2 = await procesarEmision('e1', deps)
    expect(r2.estado).toBe('archivada')
    expect(creados).toHaveLength(0)
  })

  it('la DIAN sin responder por mucho rato: avisa una vez', async () => {
    fila = emision({ estado: 'enviada', proveedorDocumentoId: 'doc-9', prefijo: 'SETP', consecutivo: 990000001, numero: 'SETP990000001' })
    for (let i = 0; i < CONSULTAS_ANTES_DE_AVISAR + 2; i++) {
      respuestasConsulta = [{ tipo: 'documento', documento: doc({ id: 'doc-9', cufe: null, estado: 'en_proceso', estadoOriginal: 'DianNoDisponible' }) }]
      await procesarEmision('e1', deps)
    }
    expect(alertas.map((a) => a.motivo)).toEqual(['reintentos'])
  })

  it('rechazada por la DIAN: estado rechazada y UNA alerta', async () => {
    respuestasCrear = [{ tipo: 'documento', documento: doc({ cufe: null, estado: 'rechazada', estadoOriginal: 'Rechazada', motivos: ['FAK24: NIT del adquirente'] }) }]
    const r = await procesarEmision('e1', deps)
    expect(r.estado).toBe('rechazada')
    expect(alertas).toHaveLength(1)
    expect(alertas[0].detalle).toContain('FAK24')
    await procesarEmision('e1', deps)
    expect(alertas).toHaveLength(1)
  })

  it('422 de la API: rechazada, con alerta', async () => {
    respuestasCrear = [{ tipo: 'invalido', http: 422, mensaje: 'HTTP 422: customer.email' }]
    expect((await procesarEmision('e1', deps)).estado).toBe('rechazada')
    expect(alertas[0].motivo).toBe('rechazada')
  })

  it('token inválido: bloqueada con alerta', async () => {
    respuestasCrear = [{ tipo: 'no_autorizado', http: 401, mensaje: 'HTTP 401' }]
    expect((await procesarEmision('e1', deps)).estado).toBe('bloqueada')
    expect(alertas[0].motivo).toBe('no_autorizado')
  })

  it('errores transitorios: reintenta y avisa desde el intento umbral, una vez', async () => {
    for (let i = 0; i < INTENTOS_ANTES_DE_AVISAR + 2; i++) {
      respuestasCrear = [{ tipo: 'transitorio', http: 429, mensaje: 'HTTP 429' }]
      const r = await procesarEmision('e1', deps)
      expect(r.estado).toBe('pendiente')
    }
    expect(alertas.map((a) => a.motivo)).toEqual(['reintentos'])
    expect(creados).toHaveLength(0)
  })

  it('sin numeración cargada: bloqueada y avisa (no manda nada)', async () => {
    siguiente = null
    expect((await procesarEmision('e1', deps)).estado).toBe('bloqueada')
    expect(alertas[0].motivo).toBe('sin_numeracion')
    expect(creados).toHaveLength(0)
  })

  it('datos del comprador incompletos: bloqueada y avisa', async () => {
    problemaDatos = 'El contrato no tiene un correo de facturación válido.'
    expect((await procesarEmision('e1', deps)).estado).toBe('bloqueada')
    expect(alertas[0]).toMatchObject({ motivo: 'datos' })
  })

  it('la organización no tiene la resolución del prefijo: bloqueada', async () => {
    siguiente = 1
    deps.resolucion = async () => null
    try {
      expect((await procesarEmision('e1', deps)).estado).toBe('bloqueada')
      expect(alertas[0].motivo).toBe('sin_resolucion')
    } finally {
      deps.resolucion = async (p) => (p === RESOLUCION.prefix ? RESOLUCION : null)
    }
  })

  it('emitida sin poder traer archivos: sigue emitida (vale) y reintenta los archivos', async () => {
    descargaOk = false
    const r = await procesarEmision('e1', deps)
    expect(r.estado).toBe('emitida')
    expect(fila.cufe).toBe(CUFE)
    expect(publicadas).toBe(0)
    descargaOk = true
    expect((await procesarEmision('e1', deps)).estado).toBe('archivada')
    expect(publicadas).toBe(1)
    expect(creados).toHaveLength(1)
  })

  it('archivos en base64 en la consulta: no hace falta descargar', async () => {
    descargaOk = false
    respuestasConsulta = [{ tipo: 'documento', documento: doc({ id: 'doc-1', urlPdf: null, urlXml: null, pdfBase64: Buffer.from('%PDF').toString('base64') }) }]
    expect((await procesarEmision('e1', deps)).estado).toBe('archivada')
  })
})
