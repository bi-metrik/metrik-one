import { NextRequest, NextResponse } from 'next/server'
import { downloadDriveFile } from '@/lib/google-drive'
import { resolverArchivoDeCobro } from '@/lib/almacenamiento/archivo-de-cobro'
import { dependenciasDeCobro } from '@/lib/almacenamiento/sesion'

// GET /api/archivos/cobro?cobro=<uuid>&doc=soporte|recibo[&descargar=1]
//
// El soporte de un pago y el recibo de caja viven en Drive. Antes se entregaban
// abriendo el archivo a "cualquiera con el enlace"; ahora los bytes los baja ESTA ruta
// con la cuenta de servicio, que es el mismo patron con el que `send-cuenta-cobro.ts`
// adjunta el PDF de una cuenta de cobro.
//
// A diferencia de `/api/archivos/abrir`, aqui NO se redirige a una URL firmada: Drive no
// firma enlaces temporales, asi que o el archivo esta abierto a cualquiera (lo que se
// esta cerrando) o lo baja quien tiene la credencial. Los bytes pasan por el servidor.
//
// El criterio (que archivo es y quien puede pedirlo) vive en
// `src/lib/almacenamiento/archivo-de-cobro.ts`, probado. Aqui solo se decide QUIEN baja,
// que es lo que no se puede probar sin red. Un `route.ts` ademas no puede exportar
// helpers: el build lo rechaza.

export const dynamic = 'force-dynamic'

// Un archivo privado de un cobro no se guarda en ninguna cache, ni del navegador ni del
// CDN: la respuesta depende de la sesion.
const SIN_CACHE = { 'cache-control': 'no-store, private' }

function textoPlano(mensaje: string, status: number) {
  return new NextResponse(mensaje, {
    status,
    headers: { ...SIN_CACHE, 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * `Content-Disposition` con el nombre en las dos formas: la ASCII de toda la vida y la
 * `filename*` con codificacion, porque un soporte se llama, por ejemplo,
 * "PHOTO-2026-09-04.jpg" pero tambien puede traer tildes o eñes.
 */
function disposicion(nombre: string, descargar: boolean): string {
  const tipo = descargar ? 'attachment' : 'inline'
  const ascii = nombre.replace(/[^\x20-\x7e]+/g, '_')
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`
}

export async function GET(req: NextRequest) {
  const cobro = req.nextUrl.searchParams.get('cobro')
  const doc = req.nextUrl.searchParams.get('doc')
  const descargar = req.nextUrl.searchParams.get('descargar') === '1'

  const r = await resolverArchivoDeCobro(cobro, doc, dependenciasDeCobro())
  if (r.tipo === 'error') return textoPlano(r.mensaje, r.status)

  let bytes: Buffer
  try {
    bytes = await downloadDriveFile(r.archivo.fileId, r.workspaceId)
  } catch (e) {
    // El archivo puede haberse borrado de Drive (medido en el barrido del 2026-09-16:
    // 3 de 19 al azar ya no existian). Se dice, en vez de devolver un 500 mudo.
    console.error('[archivos/cobro] Drive no entrego el archivo:', (e as Error).message)
    return textoPlano('No se pudo traer el archivo de Drive', 502)
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      ...SIN_CACHE,
      'content-type': r.archivo.mimeType,
      'content-length': String(bytes.length),
      'content-disposition': disposicion(r.archivo.fileName, descargar),
      // El PDF o la foto no se embeben en ninguna otra pagina.
      'x-content-type-options': 'nosniff',
    },
  })
}
