/**
 * El esquema `one://` y, sobre todo, la derivación de DUEÑO: la única función del
 * producto que decide de quién es un archivo. De ella cuelga toda la autorización de
 * `/api/archivos/abrir`, así que lo que se prueba aquí no es formato sino permiso.
 */
import { describe, expect, it } from 'vitest'
import {
  BUCKETS_ONE,
  construirReferenciaOne,
  duenoDeReferencia,
  esReferenciaArchivo,
  esReferenciaOne,
  esRutaDeWorkspace,
  hrefArchivo,
  hrefArchivoAbsoluto,
  parsearReferenciaOne,
  prefijoWorkspace,
  referenciaDocumentoNegocio,
  rutaEnWorkspace,
} from './referencia'

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const OTRO_WS = 'a21bfc88-1a60-48c3-afcd-144226aa2392'
const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const BLOQUE = '11111111-2222-4333-8444-555555555555'
const GASTO = '55555555-6666-4777-8888-999999999999'

const DOC = `one://ve-documentos/${WS}/negocios/${NEG}/${BLOQUE}/factura.pdf`
const SOPORTE_GASTO = `one://gastos-soportes/${WS}/${GASTO}.jpg`
const SOPORTE_PAGO = `one://ve-documentos/${WS}/pagos-externos/${BLOQUE}.pdf`

describe('esquema one://', () => {
  it('construye y parsea ida y vuelta', () => {
    const ref = construirReferenciaOne('ve-documentos', `${WS}/negocios/${NEG}/${BLOQUE}/factura.pdf`)
    expect(ref).toBe(DOC)
    expect(esReferenciaOne(ref)).toBe(true)
    expect(parsearReferenciaOne(ref)).toEqual({
      bucket: 've-documentos',
      path: `${WS}/negocios/${NEG}/${BLOQUE}/factura.pdf`,
    })
  })

  it('el bucket es lista CERRADA: uno ajeno no parsea aunque la forma sea válida', () => {
    expect(BUCKETS_ONE).toEqual(['ve-documentos', 'gastos-soportes'])
    expect(parsearReferenciaOne(`one://cert-databooks/${WS}/x.pdf`)).toBeNull()
    expect(parsearReferenciaOne(`one://workspace-logos/${WS}/x.png`)).toBeNull()
  })

  it('hereda las mismas guardas de forma que el esquema externo', () => {
    expect(parsearReferenciaOne(`one://ve-documentos/${WS}/../${OTRO_WS}/a.pdf`)).toBeNull()
    expect(parsearReferenciaOne(`one://ve-documentos/${WS}//a.pdf`)).toBeNull()
    expect(parsearReferenciaOne(`one://ve-documentos/${WS}/a.pdf?token=x`)).toBeNull()
    expect(parsearReferenciaOne('one://ve-documentos/')).toBeNull()
    expect(parsearReferenciaOne('one://')).toBeNull()
  })

  it('una URL pública heredada NO es referencia: la fila sin migrar sigue funcionando', () => {
    const publica = `https://x.supabase.co/storage/v1/object/public/ve-documentos/${WS}/a.pdf`
    expect(esReferenciaOne(publica)).toBe(false)
    expect(esReferenciaArchivo(publica)).toBe(false)
    expect(hrefArchivo(publica)).toBe(publica)
  })

  it('los dos esquemas cuentan como referencia de archivo', () => {
    expect(esReferenciaArchivo(DOC)).toBe(true)
    expect(esReferenciaArchivo(`sbext://one-documentos/negocios/${NEG}/a.pdf`)).toBe(true)
    expect(esReferenciaArchivo('https://drive.google.com/file/d/x/view')).toBe(false)
    expect(esReferenciaArchivo(null)).toBe(false)
  })
})

describe('duenoDeReferencia', () => {
  it('documento de negocio en un bucket de ONE: trae workspace Y negocio', () => {
    expect(duenoDeReferencia(DOC)).toEqual({ workspaceId: WS, negocioId: NEG })
  })

  it('soporte de gasto: trae workspace y NINGÚN negocio', () => {
    expect(duenoDeReferencia(SOPORTE_GASTO)).toEqual({ workspaceId: WS, negocioId: null })
  })

  it('soporte de pago: trae workspace y ningún negocio (la ruta no lo dice)', () => {
    expect(duenoDeReferencia(SOPORTE_PAGO)).toEqual({ workspaceId: WS, negocioId: null })
  })

  it('el esquema externo NO trae workspace: lo resuelve el negocio', () => {
    expect(duenoDeReferencia(`sbext://one-documentos/negocios/${NEG}/vouchers/hotel.pdf`))
      .toEqual({ workspaceId: null, negocioId: NEG })
  })

  it('sin dueño atribuible no hay dueño: null, y quien lo recibe no abre nada', () => {
    // externa fuera de `negocios/`
    expect(duenoDeReferencia('sbext://one-documentos/otra-cosa/a.pdf')).toBeNull()
    // externa de otro bucket
    expect(duenoDeReferencia(`sbext://ve-documentos/negocios/${NEG}/a.pdf`)).toBeNull()
    // one:// cuyo primer segmento no es un uuid de workspace
    expect(duenoDeReferencia('one://ve-documentos/publico/a.pdf')).toBeNull()
    // one:// sin nada debajo del workspace
    expect(duenoDeReferencia(`one://gastos-soportes/${WS}`)).toBeNull()
    // basura
    expect(duenoDeReferencia(null)).toBeNull()
    expect(duenoDeReferencia('https://drive.google.com/file/d/x/view')).toBeNull()
  })

  it('el workspace de la ruta se normaliza, para que la comparación no dependa de mayúsculas', () => {
    const ref = `one://gastos-soportes/${WS.toUpperCase()}/${GASTO}.jpg`
    expect(duenoDeReferencia(ref)).toEqual({ workspaceId: WS, negocioId: null })
  })
})

describe('href', () => {
  it('una referencia de ONE pasa por el endpoint que firma', () => {
    expect(hrefArchivo(DOC)).toBe(`/api/archivos/abrir?ref=${encodeURIComponent(DOC)}`)
    expect(hrefArchivo(SOPORTE_GASTO, { descargar: true }))
      .toBe(`/api/archivos/abrir?ref=${encodeURIComponent(SOPORTE_GASTO)}&descargar=1`)
  })

  it('el href absoluto antepone el dominio del workspace, y deja intacto lo que no es referencia', () => {
    expect(hrefArchivoAbsoluto('https://soena.metrikone.co/', SOPORTE_GASTO))
      .toBe(`https://soena.metrikone.co/api/archivos/abrir?ref=${encodeURIComponent(SOPORTE_GASTO)}`)
    const publica = 'https://x.supabase.co/storage/v1/object/public/gastos-soportes/a.jpg'
    expect(hrefArchivoAbsoluto('https://soena.metrikone.co', publica)).toBe(publica)
    expect(hrefArchivoAbsoluto('https://soena.metrikone.co', null)).toBeNull()
  })
})

describe('rutas dentro de los buckets de ONE', () => {
  it('toda ruta cuelga del prefijo del workspace', () => {
    expect(prefijoWorkspace(WS)).toBe(`${WS}/`)
    expect(rutaEnWorkspace(WS, 'pagos-externos', 'abc.pdf')).toBe(`${WS}/pagos-externos/abc.pdf`)
    expect(rutaEnWorkspace(WS, `${GASTO}.jpg`)).toBe(`${WS}/${GASTO}.jpg`)
  })

  it('un workspaceId que no es uuid no produce ruta', () => {
    expect(() => rutaEnWorkspace('../otro', 'a.pdf')).toThrow()
    expect(() => prefijoWorkspace('publico')).toThrow()
  })

  // Ida y vuelta escritor → puerta. Es el contrato que de verdad importa: una ruta que
  // el escritor arme fuera del prefijo del workspace produce un archivo que NADIE puede
  // abrir, y eso no se ve hasta que un usuario lo intenta.
  it('la referencia de un documento de negocio queda donde la puerta la espera', () => {
    const ref = referenciaDocumentoNegocio(WS, NEG, BLOQUE, 'factura.pdf')
    expect(ref).toBe(DOC)
    expect(duenoDeReferencia(ref)).toEqual({ workspaceId: WS, negocioId: NEG })
  })

  it('la del soporte de un gasto también, y sin negocio', () => {
    const ref = construirReferenciaOne('gastos-soportes', rutaEnWorkspace(WS, `${GASTO}.jpg`))
    expect(ref).toBe(SOPORTE_GASTO)
    expect(duenoDeReferencia(ref)).toEqual({ workspaceId: WS, negocioId: null })
  })

  it('esRutaDeWorkspace compara el prefijo y rechaza el salto de carpeta', () => {
    expect(esRutaDeWorkspace(`${WS}/pagos-externos/a.pdf`, WS)).toBe(true)
    expect(esRutaDeWorkspace(`${WS.toUpperCase()}/a.pdf`, WS)).toBe(true)
    expect(esRutaDeWorkspace(`${OTRO_WS}/a.pdf`, WS)).toBe(false)
    expect(esRutaDeWorkspace(`${WS}/../${OTRO_WS}/a.pdf`, WS)).toBe(false)
    expect(esRutaDeWorkspace(`${WS}x/a.pdf`, WS)).toBe(false)
  })
})

// ── Saltos de carpeta que el parser de URL arma solo ──────────────────────────
//
// `storage-js` pega la ruta a la URL sin codificarla y el parser WHATWG normaliza los
// segmentos de punto antes de mandar la petición. Antes de esta guarda, la referencia
// `one://ve-documentos/<mi_ws>/%2e%2e/<otro_ws>/...` pasaba la puerta de `abrir.ts` (el
// primer segmento es el workspace de la sesión) y se firmaba el archivo del OTRO
// workspace. El primer caso de cada prueba es el control: comprueba con el parser real
// que la forma de verdad se escapa, para que la prueba no pase por una suposición.
//
// VISTO FALLAR (2026-09-16): con `referencia.ts` de `origin/main` caen 2 (las dos guardas);
// el control y el caso legítimo siguen verdes. Mutando `rutaConEscape`: sin decodificar
// `%2e` caen 2, sin rechazar caracteres de control caen 2, sin rechazar la barra invertida
// caen 2, y `esRutaDeWorkspace` con su guarda vieja tumba 1.
describe('rutas que el parser de URL convierte en salto de carpeta', () => {
  const TAB = String.fromCharCode(9)
  const SALTO = String.fromCharCode(10)
  const ESCAPES = [
    `${WS}/%2e%2e/${OTRO_WS}/negocios/${NEG}/factura.pdf`,
    `${WS}/%2E%2E/${OTRO_WS}/negocios/${NEG}/factura.pdf`,
    `${WS}/.%2e/${OTRO_WS}/negocios/${NEG}/factura.pdf`,
    `${WS}/%2e./${OTRO_WS}/negocios/${NEG}/factura.pdf`,
    `${WS}/.${TAB}./${OTRO_WS}/negocios/${NEG}/factura.pdf`,
    `${WS}/.${SALTO}./${OTRO_WS}/negocios/${NEG}/factura.pdf`,
    `${WS}/x\\..\\..\\${OTRO_WS}/negocios/${NEG}/factura.pdf`,
  ]

  function rutaQuePide(path: string): string {
    return new URL(`https://x.supabase.co/storage/v1/object/ve-documentos/${path}`).pathname
  }

  it('control: el parser real saca cada una de estas rutas del workspace', () => {
    for (const p of ESCAPES) {
      expect(rutaQuePide(p), JSON.stringify(p)).toContain(`/ve-documentos/${OTRO_WS}/`)
    }
    // Y una ruta legítima llega intacta, con su workspace.
    expect(rutaQuePide(`${WS}/negocios/${NEG}/factura.pdf`)).toContain(`/ve-documentos/${WS}/`)
  })

  it('esRutaDeWorkspace las rechaza todas', () => {
    for (const p of ESCAPES) expect(esRutaDeWorkspace(p, WS), JSON.stringify(p)).toBe(false)
  })

  it('el parser de referencias las rechaza, así que abrir no les atribuye dueño', () => {
    for (const p of ESCAPES) {
      const ref = `one://ve-documentos/${p}`
      expect(parsearReferenciaOne(ref), JSON.stringify(p)).toBeNull()
      expect(duenoDeReferencia(ref), JSON.stringify(p)).toBeNull()
    }
  })

  it('un nombre de archivo con puntos o un porcentaje normal sigue siendo válido', () => {
    const conPuntos = `${WS}/negocios/${NEG}/${BLOQUE}/acta..final.pdf`
    const conEspacio = `${WS}/negocios/${NEG}/${BLOQUE}/Mi%20archivo.pdf`
    expect(esRutaDeWorkspace(conPuntos, WS)).toBe(true)
    expect(esRutaDeWorkspace(conEspacio, WS)).toBe(true)
    expect(parsearReferenciaOne(`one://ve-documentos/${conEspacio}`)).not.toBeNull()
  })
})
