import 'server-only'

/**
 * El paquete de viaje en PDF (F4-4): la hoja con el itinerario día a día, los vouchers, «Antes de
 * viajar» y los contactos de emergencia, y al final los archivos de los vouchers (un PDF entra con
 * sus hojas; una foto, como una hoja). Aparte de `entrega-datos.ts` para que el avance de etapa no
 * cargue el motor de PDF.
 */

import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { PDFDocument } from 'pdf-lib'
import { createServiceClient } from '@/lib/supabase/server'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { leerDocumentoCliente, textoParaElViaje } from '@/lib/cotizaciones/documento-cliente'
import { parsearReferenciaOne } from '@/lib/almacenamiento/referencia'
import PaqueteViajePDF from '@/lib/pdf/paquete-viaje-pdf'
import { leerNegocioConLinea } from './confirmacion-datos'
import { leerServiciosDelNegocio, type ServicioDelNegocio } from './servicios-viaje-datos'
import { configEntrega, fechaConAnio, huellaVouchers, itinerarioDesdeServicios, pideVoucher } from './entrega'
import type { Base } from './entrega-datos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// ── El paquete en PDF ────────────────────────────────────────────────────────

const MAX_VOUCHER = 15 * 1024 * 1024

async function bytesDeReferencia(ref: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const r = parsearReferenciaOne(ref)
  if (!r) return null
  const { data, error } = await (createServiceClient() as Db).storage.from(r.bucket).download(r.path)
  if (error || !data) return null
  const blob = data as Blob
  if (blob.size > MAX_VOUCHER) return null
  const lower = r.path.toLowerCase()
  const mime = blob.type || (lower.endsWith('.pdf') ? 'application/pdf' : lower.endsWith('.png') ? 'image/png' : 'image/jpeg')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime }
}

/** Pega un voucher al final: un PDF entra con sus hojas; una foto, como una hoja A4. */
async function anexar(doc: PDFDocument, v: { bytes: Uint8Array; mime: string }): Promise<boolean> {
  try {
    if (v.mime === 'application/pdf') {
      const src = await PDFDocument.load(v.bytes, { ignoreEncryption: true })
      const paginas = await doc.copyPages(src, src.getPageIndices())
      paginas.forEach(p => doc.addPage(p))
      return true
    }
    const img = v.mime === 'image/png' ? await doc.embedPng(v.bytes) : await doc.embedJpg(v.bytes)
    const pagina = doc.addPage([595.28, 841.89])
    const escala = Math.min(515 / img.width, 760 / img.height, 1)
    const w = img.width * escala
    const h = img.height * escala
    pagina.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h })
    return true
  } catch (e) {
    console.warn('[entrega] un voucher no se pudo anexar:', e instanceof Error ? e.message : e)
    return false
  }
}

export interface PaqueteArmado {
  pdf: Buffer
  filename: string
  huella: string
  /** Vouchers que no se pudieron anexar (formato que no se lee): se nombran, no se pierden. */
  sinAnexar: string[]
}

export async function armarPaquetePdf(db: Db, workspaceId: string, negocioId: string, nota: string | null): Promise<PaqueteArmado | null> {
  const base = (await leerNegocioConLinea(db, workspaceId, negocioId)) as Base | null
  if (!base) return null
  const cfg = configEntrega(base.configLinea)
  if (!cfg.activo) return null
  const [servicios, { viaje }, contactoRes, wsRes, cotRes, comercialRes] = await Promise.all([
    leerServiciosDelNegocio(db, { workspaceId, negocioId }),
    leerViajeDelNegocio(db, negocioId),
    base.negocio.contacto_id
      ? db.from('contactos').select('nombre').eq('id', base.negocio.contacto_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('workspaces').select('name, color_primario').eq('id', workspaceId).maybeSingle(),
    db.from('cotizaciones').select('documento_cliente').eq('negocio_id', negocioId).eq('estado', 'aceptada').order('created_at', { ascending: false }).limit(1),
    db.from('negocio_responsables').select('rol, staff!negocio_responsables_staff_id_fkey(full_name)').eq('negocio_id', negocioId),
  ])
  const filas = (servicios ?? []) as ServicioDelNegocio[]
  const ws = (wsRes.data ?? {}) as { name?: string; color_primario?: string | null }
  const agencia = (ws.name ?? '').trim() || 'Tu agencia'
  const responsables = (comercialRes.data ?? []) as Array<{ rol?: string | null; staff?: { full_name?: string | null } | null }>
  const comercial = (responsables.find(r => r.rol === 'comercial') ?? responsables[0])?.staff?.full_name?.trim() || null
  const cot = ((cotRes.data ?? []) as Array<{ documento_cliente?: unknown }>)[0]
  const texto = textoParaElViaje(leerDocumentoCliente(cot?.documento_cliente))

  // Vouchers: cada archivo al final del mismo PDF, en el orden del viaje.
  const conVoucher = filas.filter(f => pideVoucher(f) && f.voucher_ref)
  const archivos = await Promise.all(conVoucher.map(f => bytesDeReferencia(f.voucher_ref as string)))

  const fechas = viaje.fechas.inicio
    ? [viaje.fechas.inicio, viaje.fechas.fin].filter((x): x is string => !!x).map(fechaConAnio).join(' – ')
    : null
  const portada = await renderToBuffer(
    createElement(PaqueteViajePDF, {
      agencia,
      colorPrimario: ws.color_primario ?? null,
      viajero: ((contactoRes.data as { nombre?: string | null } | null)?.nombre ?? '').trim(),
      titulo: (texto.titular?.trim() || base.negocio.nombre || viaje.destino || 'Tu viaje').trim(),
      fechas,
      itinerario: itinerarioDesdeServicios(filas, viaje.fechas.inicio),
      vouchers: filas.filter(pideVoucher).map(f => ({
        nombre: f.nombre,
        detalle: [f.proveedor_nombre, f.localizador ? `localizador ${f.localizador}` : null].filter(Boolean).join(' · ') || null,
        adjunto: !!f.voucher_ref && !!archivos[conVoucher.indexOf(f)],
      })),
      antesDeViajar: texto.antesDeViajar ?? [],
      contactosEmergencia: cfg.contactosEmergencia,
      nota: nota?.trim() || null,
      comercial,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  )
  const doc = await PDFDocument.load(portada)
  const sinAnexar: string[] = []
  for (let i = 0; i < conVoucher.length; i++) {
    const a = archivos[i]
    if (!a || !(await anexar(doc, a))) sinAnexar.push(conVoucher[i].nombre)
  }
  const pdf = Buffer.from(await doc.save())
  const slug = (base.negocio.nombre ?? 'viaje').normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'viaje'
  return { pdf, filename: `paquete-${slug}.pdf`, huella: huellaVouchers(filas), sinAnexar }
}
