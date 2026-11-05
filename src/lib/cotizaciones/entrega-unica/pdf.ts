import type { Pantallazo } from '@/lib/cotizaciones/asistente/armar-con-modelo'
import type { BorradorCotizacion } from '@/lib/cotizaciones/asistente/borrador'
import type { Validado } from '@/lib/cotizaciones/asistente/invariantes'
import { entradaDePropuesta, type Casa, type Solicitud } from '@/lib/cotizaciones/asistente/a-propuesta'
import type { Requisitos } from './esquema'

/**
 * El PDF de la entrega única: la plantilla real (`pdfDePropuestaHtml`) con la entrada del piloto del
 * 2026-11-03 (`entradaDePropuesta`). La foto de cada hotel se recorta del pantallazo con la caja que dio
 * el modelo (`cajaFoto`) y va embebida (data URI): no se sube a ningún lado. Node (Chromium y sharp).
 */

async function recortarFoto(p: Pantallazo, caja: number[] | null): Promise<{ url: string; proporcion: number } | null> {
  if (!caja || caja.length !== 4) return null
  const sharp = (await import('sharp')).default
  const buf = Buffer.from(p.base64, 'base64')
  const { width = 0, height = 0 } = await sharp(buf).metadata()
  const [y0, x0, y1, x1] = caja.map(n => Math.max(0, Math.min(1000, n)) / 1000)
  const left = Math.round(x0 * width), top = Math.round(y0 * height)
  const w = Math.round((x1 - x0) * width), h = Math.round((y1 - y0) * height)
  if (w < 40 || h < 40) return null
  const jpg = await sharp(buf).extract({ left, top, width: w, height: h }).jpeg({ quality: 88 }).toBuffer()
  return { url: `data:image/jpeg;base64,${jpg.toString('base64')}`, proporcion: w / h }
}

export async function pdfDeLaEntrega(p: {
  codigo: string
  hoy: string
  borrador: BorradorCotizacion
  validado: Validado
  requisitos: Requisitos
  pantallazos: Pantallazo[]
  casa: Casa
  logoUrl?: string | null
}): Promise<{ pdf: Uint8Array; nombre: string }> {
  const { pdfDePropuestaHtml } = await import('@/lib/pdf/html/propuesta-html')
  const { fotosDeCiudad } = await import('@/lib/pdf/fotos-ciudad')
  const { nombrePdfCotizacion, tituloPdfCotizacion } = await import('@/lib/cotizaciones/nombre-pdf-cotizacion')
  const r = p.requisitos
  const fotos = new Map<number, { url: string; proporcion: number }>()
  for (const h of p.borrador.hoteles) {
    const pant = p.pantallazos[h.pantallazo - 1]
    const foto = pant ? await recortarFoto(pant, h.cajaFoto).catch(() => null) : null
    if (foto) fotos.set(h.pantallazo, foto)
  }
  const solicitud: Solicitud = {
    consecutivo: p.codigo, cliente: r.cliente ?? p.borrador.clienteParaDocumento, destino: r.destino ?? p.borrador.destino,
    viajeros: r.viajeros!, ciudadOrigen: r.ciudadOrigen ?? '', hoy: p.hoy,
  }
  const entrada = entradaDePropuesta(p.borrador, p.validado, solicitud, p.casa, fotos)
  const datos = { codigo: p.codigo, cliente: p.borrador.clienteParaDocumento || r.cliente, destino: solicitud.destino, borrador: false }
  const { pdf } = await pdfDePropuestaHtml(entrada, {
    marca: p.casa.marca, logoUrl: p.logoUrl ?? null, tituloDocumento: tituloPdfCotizacion(datos as never),
    fotoDeCiudad: (c: string) => fotosDeCiudad(c).map(f => ({ url: f.ruta, rotulo: f.rotulo, credito: f.credito, foco: f.foco, proporcion: f.proporcion })),
    catalogo: null,
  } as never)
  return { pdf: new Uint8Array(pdf), nombre: nombrePdfCotizacion(datos as never) }
}
