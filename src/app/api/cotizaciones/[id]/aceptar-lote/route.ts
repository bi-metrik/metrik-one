/**
 * «Aceptar los N» de la bandeja de la cotización por pasos (C5, nota técnica de Max §5.3; V4).
 *
 * Por `fetch` y no por server action, por lo mismo que «Aceptar» de a una (`aceptar-captura`): la
 * fila de server actions de Next esperaría detrás de las lecturas en curso.
 *
 * La lógica es `aceptarLotePorPasos`: comprueba el interruptor, acepta las N en orden y en serie
 * con la aceptación de siempre (firma, RLS, idempotencia por `idAceptacion`) y recalcula UNA vez
 * al final. Con el interruptor apagado no acepta nada: esta ruta no existe para la forma de
 * siempre.
 */
import { NextResponse } from 'next/server'

import { enPeticionDeRuta } from '@/lib/actions/memo-de-ruta'
import { conTiempos, encabezadoServerTiming } from '@/lib/actions/tiempos-de-ruta'
import { registrarEnBandeja, responderBandeja } from '@/lib/cotizaciones/bandeja-registro'
import { borradorDePeticion } from '@/lib/cotizaciones/borrador-de-peticion'
import { aceptarLotePorPasos, esEstadoAlAceptar, MAX_LOTE, type FilaDelLote } from '@/lib/cotizaciones/por-pasos-cierre'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let cuerpo: { filas?: unknown } | null = null
  try {
    cuerpo = (await req.json()) as { filas?: unknown }
  } catch {
    cuerpo = null
  }
  const crudas = Array.isArray(cuerpo?.filas) ? (cuerpo!.filas as unknown[]) : null
  const filas: FilaDelLote[] = []
  for (const f of crudas ?? []) {
    const r = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
    const borrador = borradorDePeticion(r.borrador)
    if (typeof r.id !== 'string' || !borrador) { filas.length = 0; break }
    filas.push({
      id: r.id.slice(0, 120),
      borrador,
      estado: esEstadoAlAceptar(r.estado) ? r.estado : null,
      destinoCaptura: typeof r.destinoCaptura === 'string' ? r.destinoCaptura.slice(0, 120) : null,
    })
  }
  if (!id || !crudas || filas.length === 0 || filas.length !== crudas.length || filas.length > MAX_LOTE) {
    registrarEnBandeja('warn', { ruta: 'aceptar-lote', codigo: 'PETICION', cotizacionId: id ?? '', bytesImagen: null })
    return NextResponse.json({ ok: false, codigo: 'PETICION', mensaje: 'Las capturas llegaron incompletas. Vuelve a tocar «Aceptar los N».' }, { status: 400 })
  }
  const inicio = performance.now()
  const { resultado: r, etapas } = await conTiempos(() =>
    responderBandeja('aceptar-lote', id, null, () => enPeticionDeRuta(() => aceptarLotePorPasos(id, filas))))
  const ms = performance.now() - inicio
  return NextResponse.json(r, { headers: { 'Server-Timing': encabezadoServerTiming(['aceptar-lote', ms], etapas) } })
}
