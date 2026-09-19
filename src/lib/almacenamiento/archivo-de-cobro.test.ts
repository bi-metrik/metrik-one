import { describe, it, expect } from 'vitest'
import {
  archivoDeCobro,
  docDeRecibo,
  esDocumentoCobro,
  hrefArchivoDeCobro,
  idDeArchivoDrive,
  resolverArchivoDeCobro,
  type FilaCobroArchivo,
} from './archivo-de-cobro'

// Las formas REALES, medidas contra produccion el 2026-09-16.
const URL_RECIBO = 'https://drive.google.com/file/d/1S0NXc_Qpj8h-pm_esV_hTFNeYydSQJO9/view?usp=drivesdk'
const ID_RECIBO = '1S0NXc_Qpj8h-pm_esV_hTFNeYydSQJO9'
const URL_SOPORTE = 'https://drive.google.com/file/d/1XXWDr1OfnAL8UwZTalaw7vqgjMCm7CNC/view'
const ID_SOPORTE = '1XXWDr1OfnAL8UwZTalaw7vqgjMCm7CNC'

const COBRO = '4013ee2b-6bb9-4454-9a11-0b1c2d3e4f50'
const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'

describe('idDeArchivoDrive', () => {
  it('saca el id de las dos formas que hay en produccion', () => {
    expect(idDeArchivoDrive(URL_RECIBO)).toBe(ID_RECIBO)
    expect(idDeArchivoDrive(URL_SOPORTE)).toBe(ID_SOPORTE)
  })

  it('acepta las otras formas de enlace de Drive', () => {
    expect(idDeArchivoDrive(`https://drive.google.com/open?id=${ID_RECIBO}`)).toBe(ID_RECIBO)
    expect(idDeArchivoDrive(`https://drive.google.com/uc?export=download&id=${ID_RECIBO}`)).toBe(ID_RECIBO)
  })

  it('rechaza cualquier host que no sea Drive, aunque la ruta tenga la forma', () => {
    expect(idDeArchivoDrive(`https://drive.google.com.evil.test/file/d/${ID_RECIBO}/view`)).toBeNull()
    expect(idDeArchivoDrive(`https://evil.test/file/d/${ID_RECIBO}/view`)).toBeNull()
  })

  it('rechaza lo que no es un enlace http de Drive', () => {
    expect(idDeArchivoDrive('one://ve-documentos/ws/negocios/x/a.pdf')).toBeNull()
    expect(idDeArchivoDrive('')).toBeNull()
    expect(idDeArchivoDrive(null)).toBeNull()
    expect(idDeArchivoDrive(undefined)).toBeNull()
    expect(idDeArchivoDrive(42)).toBeNull()
    expect(idDeArchivoDrive('https://drive.google.com/file/d//view')).toBeNull()
    // Un id demasiado corto no se acepta "por si acaso".
    expect(idDeArchivoDrive('https://drive.google.com/file/d/abc/view')).toBeNull()
  })
})

describe('archivoDeCobro', () => {
  it('soporte: prefiere el id guardado aparte', () => {
    const fila: FilaCobroArchivo = {
      soporte: {
        url: URL_SOPORTE,
        file_name: 'PHOTO-2026-09-04.jpg',
        mime_type: 'image/jpeg',
        drive_file_id: ID_SOPORTE,
      },
    }
    expect(archivoDeCobro(fila, 'soporte')).toEqual({
      fileId: ID_SOPORTE,
      fileName: 'PHOTO-2026-09-04.jpg',
      mimeType: 'image/jpeg',
    })
  })

  it('soporte: cae al id del enlace cuando la fila no lo trae', () => {
    const fila: FilaCobroArchivo = {
      soporte: { url: URL_SOPORTE, file_name: 'x.pdf', mime_type: 'application/pdf', drive_file_id: null },
    }
    expect(archivoDeCobro(fila, 'soporte')?.fileId).toBe(ID_SOPORTE)
  })

  it('soporte: un nombre con caracteres que parten la cabecera se limpia', () => {
    const fila: FilaCobroArchivo = {
      soporte: { url: URL_SOPORTE, file_name: 'a"b\nc/d.pdf', mime_type: null },
    }
    const r = archivoDeCobro(fila, 'soporte')
    expect(r?.fileName).toBe('abcd.pdf')
    // Sin mime declarado no se inventa uno: octet-stream y que el navegador decida.
    expect(r?.mimeType).toBe('application/octet-stream')
  })

  it('recibo: sale del id guardado, y si no, del enlace de las 7 marcas viejas', () => {
    const conId: FilaCobroArchivo = {
      siigo_recibo: { numero: 'RC-1-65', archivo_url: URL_RECIBO, drive_file_id: ID_RECIBO },
    }
    expect(archivoDeCobro(conId, 'recibo')).toEqual({
      fileId: ID_RECIBO, fileName: 'RC-1-65.pdf', mimeType: 'application/pdf',
    })

    const vieja: FilaCobroArchivo = { siigo_recibo: { numero: 'RC-1-43', archivo_url: URL_RECIBO } }
    expect(archivoDeCobro(vieja, 'recibo')?.fileId).toBe(ID_RECIBO)
  })

  it('un recibo manual (sin enlace de Drive) no tiene archivo que bajar', () => {
    const manual: FilaCobroArchivo = { siigo_recibo: { numero: 'RC-2026-09-001', archivo_url: null } }
    expect(archivoDeCobro(manual, 'recibo')).toBeNull()
  })

  it('un archivo que quedo en Storage (referencia one://) no se baja de Drive', () => {
    const fila: FilaCobroArchivo = {
      siigo_recibo: { numero: 'RC-1-70', archivo_url: `one://ve-documentos/${WS}/negocios/x/rc.pdf` },
    }
    expect(archivoDeCobro(fila, 'recibo')).toBeNull()
  })

  it('una fila sin el documento pedido devuelve null', () => {
    expect(archivoDeCobro({}, 'soporte')).toBeNull()
    expect(archivoDeCobro({ soporte: null }, 'soporte')).toBeNull()
    expect(archivoDeCobro(null, 'recibo')).toBeNull()
  })

  // ── Un pago mixto trae DOS recibos ───────────────────────────────────────
  //
  // Desde el 2026-09-19 la marca puede ser una lista. `recibo` abre el del honorario y
  // `recibo_pasante` el de la plata de terceros: si los dos cayeran en el mismo nombre,
  // la ruta bajaria siempre el mismo PDF y el otro documento seria inalcanzable.
  it('recibo y recibo_pasante abren archivos DISTINTOS de la misma fila', () => {
    const OTRO_ID = '1AAAbbbCCCdddEEEfffGGG'
    const mixto: FilaCobroArchivo = {
      siigo_recibo: [
        { numero: 'RC-1-70', archivo_url: URL_RECIBO, drive_file_id: ID_RECIBO, componente: 'honorario' },
        { numero: 'RC-9-3', archivo_url: URL_RECIBO, drive_file_id: OTRO_ID, componente: 'pasante' },
      ],
    }
    expect(archivoDeCobro(mixto, 'recibo')).toEqual({
      fileId: ID_RECIBO, fileName: 'RC-1-70.pdf', mimeType: 'application/pdf',
    })
    expect(archivoDeCobro(mixto, 'recibo_pasante')).toEqual({
      fileId: OTRO_ID, fileName: 'RC-9-3.pdf', mimeType: 'application/pdf',
    })
  })

  it('la marca VIEJA responde a `recibo`: ningun enlace ya repartido cambia de destino', () => {
    // Acusa el total, asi que no declara componente. Son las 17 marcas de produccion.
    const vieja: FilaCobroArchivo = {
      siigo_recibo: { numero: 'RC-1-43', archivo_url: URL_RECIBO },
    }
    expect(archivoDeCobro(vieja, 'recibo')?.fileId).toBe(ID_RECIBO)
    // Y no se presta como si fuera el de terceros: pedir el que no existe da null.
    expect(archivoDeCobro(vieja, 'recibo_pasante')).toBeNull()
  })

  it('un cobro PURO de terceros abre por `recibo_pasante`', () => {
    const soloTerceros: FilaCobroArchivo = {
      siigo_recibo: [{ numero: 'RC-9-4', archivo_url: URL_RECIBO, drive_file_id: ID_RECIBO, componente: 'pasante' }],
    }
    expect(archivoDeCobro(soloTerceros, 'recibo_pasante')?.fileId).toBe(ID_RECIBO)
    // `recibo` no cae al de terceros: abriria el documento equivocado.
    expect(archivoDeCobro(soloTerceros, 'recibo')).toBeNull()
  })
})

describe('hrefArchivoDeCobro', () => {
  it('un enlace de Drive pasa por la ruta nueva, con el id del COBRO y no el de Drive', () => {
    const href = hrefArchivoDeCobro(COBRO, 'soporte', URL_SOPORTE)
    expect(href).toBe(`/api/archivos/cobro?cobro=${COBRO}&doc=soporte`)
    expect(href).not.toContain(ID_SOPORTE)
    expect(href).not.toContain('drive.google.com')
  })

  it('descargar agrega el parametro', () => {
    expect(hrefArchivoDeCobro(COBRO, 'recibo', URL_RECIBO, { descargar: true }))
      .toBe(`/api/archivos/cobro?cobro=${COBRO}&doc=recibo&descargar=1`)
  })

  it('una referencia de Storage sigue por la puerta que ya existe', () => {
    const ref = `one://ve-documentos/${WS}/pagos-externos/abc.pdf`
    expect(hrefArchivoDeCobro(COBRO, 'soporte', ref)).toBe(
      `/api/archivos/abrir?ref=${encodeURIComponent(ref)}`,
    )
  })

  it('sin url no hay enlace', () => {
    expect(hrefArchivoDeCobro(COBRO, 'recibo', null)).toBeNull()
    expect(hrefArchivoDeCobro(COBRO, 'recibo', '')).toBeNull()
  })
})

describe('esDocumentoCobro', () => {
  it('la lista es cerrada', () => {
    expect(esDocumentoCobro('soporte')).toBe(true)
    expect(esDocumentoCobro('recibo')).toBe(true)
    expect(esDocumentoCobro('recibo_pasante')).toBe(true)
    expect(esDocumentoCobro('factura')).toBe(false)
    expect(esDocumentoCobro(null)).toBe(false)
  })

  it('docDeRecibo: solo `pasante` cambia de puerta', () => {
    expect(docDeRecibo('pasante')).toBe('recibo_pasante')
    expect(docDeRecibo('honorario')).toBe('recibo')
    // Una marca vieja no declara componente y abre por la puerta de siempre.
    expect(docDeRecibo(null)).toBe('recibo')
    expect(docDeRecibo(undefined)).toBe('recibo')
  })
})

// ── Las puertas ──────────────────────────────────────────────────────────────
//
// Un doble que ANOTA a quien se le pregunto: la prueba que importa no es solo el
// codigo de respuesta, es que la lectura del cobro haya llevado el workspace de la
// SESION. Sin eso, "no filtra" y "filtra" dan el mismo verde.

function deps(opciones: {
  workspace: string | null
  filas: Record<string, FilaCobroArchivo>
  pedidos?: Array<{ cobroId: string; workspaceId: string }>
}) {
  return {
    async workspaceDeSesion() { return opciones.workspace },
    async cobroDelWorkspace(cobroId: string, workspaceId: string) {
      opciones.pedidos?.push({ cobroId, workspaceId })
      // El doble aplica el filtro igual que la base: la fila solo existe para su dueno.
      const fila = opciones.filas[`${workspaceId}:${cobroId}`]
      return fila ?? null
    },
  }
}

const FILA_CON_SOPORTE: FilaCobroArchivo = {
  soporte: { url: URL_SOPORTE, file_name: 's.jpg', mime_type: 'image/jpeg', drive_file_id: ID_SOPORTE },
}

describe('resolverArchivoDeCobro', () => {
  it('con sesion y cobro propio, devuelve el archivo y el workspace que baja los bytes', async () => {
    const pedidos: Array<{ cobroId: string; workspaceId: string }> = []
    const r = await resolverArchivoDeCobro(COBRO, 'soporte', deps({
      workspace: WS, filas: { [`${WS}:${COBRO}`]: FILA_CON_SOPORTE }, pedidos,
    }))
    expect(r).toEqual({
      tipo: 'archivo',
      workspaceId: WS,
      archivo: { fileId: ID_SOPORTE, fileName: 's.jpg', mimeType: 'image/jpeg' },
    })
    // La lectura llevo el workspace de la sesion, no uno del navegador.
    expect(pedidos).toEqual([{ cobroId: COBRO, workspaceId: WS }])
  })

  it('sin sesion no se lee el cobro siquiera', async () => {
    const pedidos: Array<{ cobroId: string; workspaceId: string }> = []
    const r = await resolverArchivoDeCobro(COBRO, 'soporte', deps({
      workspace: null, filas: { [`${WS}:${COBRO}`]: FILA_CON_SOPORTE }, pedidos,
    }))
    expect(r).toEqual({ tipo: 'error', status: 401, mensaje: 'Inicia sesion para abrir este archivo' })
    expect(pedidos).toEqual([])
  })

  it('un cobro de OTRO workspace responde 404, no 403: no se confirma que exista', async () => {
    const otro = '11111111-2222-3333-4444-555555555555'
    const r = await resolverArchivoDeCobro(COBRO, 'soporte', deps({
      workspace: otro, filas: { [`${WS}:${COBRO}`]: FILA_CON_SOPORTE },
    }))
    expect(r).toEqual({ tipo: 'error', status: 404, mensaje: 'Archivo no encontrado' })
  })

  it('un documento fuera de la lista cerrada no llega a leer nada', async () => {
    const pedidos: Array<{ cobroId: string; workspaceId: string }> = []
    const r = await resolverArchivoDeCobro(COBRO, 'factura', deps({
      workspace: WS, filas: { [`${WS}:${COBRO}`]: FILA_CON_SOPORTE }, pedidos,
    }))
    expect(r).toEqual({ tipo: 'error', status: 400, mensaje: 'Peticion de archivo invalida' })
    expect(pedidos).toEqual([])
  })

  it('un id de cobro que no es un uuid se rechaza antes de tocar la base', async () => {
    const pedidos: Array<{ cobroId: string; workspaceId: string }> = []
    for (const malo of [null, '', 'no-es-uuid', `${COBRO} or 1=1`]) {
      const r = await resolverArchivoDeCobro(malo, 'soporte', deps({
        workspace: WS, filas: {}, pedidos,
      }))
      expect(r).toMatchObject({ tipo: 'error', status: 400 })
    }
    expect(pedidos).toEqual([])
  })

  it('el cobro existe pero el documento pedido no tiene archivo: 404', async () => {
    const r = await resolverArchivoDeCobro(COBRO, 'recibo', deps({
      workspace: WS, filas: { [`${WS}:${COBRO}`]: FILA_CON_SOPORTE },
    }))
    expect(r).toEqual({ tipo: 'error', status: 404, mensaje: 'Archivo no encontrado' })
  })
})
