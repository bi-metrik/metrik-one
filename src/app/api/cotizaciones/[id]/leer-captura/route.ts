/**
 * La lectura firmada de un pantallazo de la bandeja, por `fetch` y no por server action: ver
 * `src/lib/cotizaciones/bandeja-red.ts`. La lógica y los permisos son los de
 * `leerCapturaEnBorrador`: no escribe nada, y lo que devuelve va firmado para «Aceptar».
 *
 * La cotización por pasos (C5) manda además `porPasos` y el viaje (`servicios`): con la pieza
 * `modelo_destino` encendida, después de leer se le pregunta al modelo a dónde va, con un corte de
 * 2,5 s (`destino-en-lectura.ts`). La respuesta viaja como `modelo`; si no llega a tiempo es
 * `null` y la fila dice la frase de las reglas. Sin esa marca, la ruta hace lo de siempre.
 */
import { NextResponse } from 'next/server'

import { leerCapturaEnBorrador } from '@/app/(app)/negocios/tarifa-pax-actions'
import type { TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'
import { bytesDeImagen, registrarEnBandeja, responderBandeja } from '@/lib/cotizaciones/bandeja-registro'
import { decisionEnLaLectura, modeloDeDestinoEncendido } from '@/lib/cotizaciones/destino-en-lectura'
import { enPeticionDeRuta } from '@/lib/actions/memo-de-ruta'

export const runtime = 'nodejs'
export const maxDuration = 60

interface Cuerpo {
  tipo?: unknown
  dataUrl?: unknown
  enfoque?: { nombre?: unknown; precio?: unknown } | null
  porPasos?: unknown
  servicios?: unknown
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let cuerpo: Cuerpo | null = null
  try {
    cuerpo = (await req.json()) as Cuerpo
  } catch {
    cuerpo = null
  }
  if (!id || !cuerpo || typeof cuerpo.tipo !== 'string' || typeof cuerpo.dataUrl !== 'string') {
    registrarEnBandeja('warn', { ruta: 'leer-captura', codigo: 'PETICION', cotizacionId: id ?? '', bytesImagen: bytesDeImagen(cuerpo?.dataUrl) })
    return NextResponse.json({ ok: false, codigo: 'PETICION', mensaje: 'La captura llegó incompleta. Vuelve a pegarla.' }, { status: 400 })
  }
  const e = cuerpo.enfoque
  const enfoque = e && typeof e.nombre === 'string'
    ? { nombre: e.nombre.slice(0, 200), precio: typeof e.precio === 'string' ? e.precio.slice(0, 60) : null }
    : null
  const { tipo, dataUrl } = cuerpo
  // `leerCapturaEnBorrador` valida el tipo: uno desconocido vuelve con su mensaje. Caso Alejandra
  // (2026-10-05): todo `ok:false` con mensaje y con su línea en el log.
  if (cuerpo.porPasos !== true || !Array.isArray(cuerpo.servicios)) {
    return NextResponse.json(await responderBandeja('leer-captura', id, bytesDeImagen(dataUrl), () => leerCapturaEnBorrador(id, tipo as TipoRanura, dataUrl, enfoque)))
  }
  const servicios = cuerpo.servicios
  const r = await responderBandeja('leer-captura', id, bytesDeImagen(dataUrl), () => enPeticionDeRuta(async () => {
    // La pieza se pregunta EN PARALELO con la lectura: no le suma espera.
    const encendido = modeloDeDestinoEncendido(id)
    const leida = await leerCapturaEnBorrador(id, tipo as TipoRanura, dataUrl, enfoque, { porPasos: true })
    if (!leida.ok || !(await encendido)) return leida
    return { ...leida, modelo: await decisionEnLaLectura(tipo as TipoRanura, leida.lectura, servicios) }
  }))
  return NextResponse.json(r)
}
