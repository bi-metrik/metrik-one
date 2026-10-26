/**
 * «Aceptar» de la bandeja de capturas (H2 y H3 de la prueba del 2026-09-24): lleva a
 * Componentes una captura que hasta ahora solo vivía en la bandeja como borrador firmado.
 *
 * POR QUÉ UNA RUTA Y NO LA SERVER ACTION: Next despacha las server actions del cliente en
 * fila, y la bandeja tiene lecturas de 8 a 25 s en curso; un «Aceptar» por server action
 * esperaba detrás de todas (R1, ver `items/[id]/confirmar-tarifa`). Un `fetch` no entra a esa
 * fila.
 *
 * La lógica y los permisos son los de `aceptarCapturaDeBandeja`: verifica la firma de la
 * lectura (nada sin firmar llega a Componentes), lee la sesión y aplica el RLS de siempre, y
 * decide contra la cotización de ESE momento dónde queda la captura.
 */
import { NextResponse } from 'next/server'

import { aceptarCapturaDeBandeja, type BorradorParaAceptar } from '@/app/(app)/negocios/tarifa-pax-actions'
import { enPeticionDeRuta } from '@/lib/actions/memo-de-ruta'
import { conTiempos, encabezadoServerTiming, medirEtapa } from '@/lib/actions/tiempos-de-ruta'
import { vistaTrasAceptar } from '@/lib/cotizaciones/vista-tras-aceptar'
import { bytesDeImagen, registrarEnBandeja, responderBandeja } from '@/lib/cotizaciones/bandeja-registro'
import { aceptarPorPasos, esEstadoAlAceptar, type EstadoAlAceptar } from '@/lib/cotizaciones/por-pasos-cierre'

export const runtime = 'nodejs'

const DECISIONES = new Set(['auto', 'opcion', 'habitacion', 'reemplazar'])
/** Solo con la marca de la forma por pasos (C5): lo que eligió el modelo o la asesora en la frase. */
const DECISIONES_POR_PASOS = new Set(['nueva', 'hermana', 'completa'])

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let cuerpo: Partial<BorradorParaAceptar> | null = null
  try {
    cuerpo = (await req.json()) as Partial<BorradorParaAceptar>
  } catch {
    cuerpo = null
  }
  if (
    !id ||
    !cuerpo ||
    typeof cuerpo.tipo !== 'string' ||
    typeof cuerpo.lecturaJson !== 'string' ||
    typeof cuerpo.firma !== 'string' ||
    !(DECISIONES.has(String(cuerpo.decision))
      || ((cuerpo as { porPasos?: unknown }).porPasos === true && DECISIONES_POR_PASOS.has(String(cuerpo.decision))))
  ) {
    registrarEnBandeja('warn', { ruta: 'aceptar-captura', codigo: 'PETICION', cotizacionId: id ?? '', bytesImagen: bytesDeImagen(cuerpo?.imagen) })
    return NextResponse.json({ ok: false, codigo: 'PETICION', mensaje: 'La captura llegó incompleta. Vuelve a pegarla.' }, { status: 400 })
  }
  // Una sola resolución de la sesión para toda la aceptación (`memo-de-ruta.ts`): antes eran
  // cinco en serie. `Server-Timing` deja ver en el navegador cuánto tardó el servidor.
  const inicio = performance.now()
  const borrador: BorradorParaAceptar = {
    tipo: cuerpo.tipo,
    lecturaJson: cuerpo.lecturaJson,
    firma: cuerpo.firma,
    pistas: cuerpo.pistas ?? { lugar: null, origen: null, destino: null },
    decision: cuerpo.decision as BorradorParaAceptar['decision'],
    destinoId: typeof cuerpo.destinoId === 'string' ? cuerpo.destinoId : null,
    imagen: typeof cuerpo.imagen === 'string' ? cuerpo.imagen : null,
    correcciones: Array.isArray(cuerpo.correcciones)
      ? cuerpo.correcciones.filter(c => !!c && typeof c.slug === 'string' && typeof c.valor === 'string')
      : null,
    idAceptacion: typeof cuerpo.idAceptacion === 'string' ? cuerpo.idAceptacion : null,
  }
  // Brief del 2026-10-05, punto 13: además del total, cada etapa (contexto, subida del
  // pantallazo, líneas, crear la opción, guardar la lectura, confirmar el costo, ubicarla).
  // Caso Alejandra (2026-10-05): todo `ok:false` con mensaje y con su línea en el log.
  //
  // La forma por pasos (C2) manda `porPasos: true`: después de aceptar, la opción entra en las
  // tarifas y la Recomendada queda en la propuesta. El interruptor se relee aquí, contra la
  // base: con él apagado (una pestaña vieja) no se acepta nada y se pide recargar. Sin la marca,
  // la ruta hace exactamente lo de siempre.
  const porPasos = (cuerpo as { porPasos?: unknown }).porPasos === true
  // V2 (re-verificación D) · por pasos, la respuesta trae además la cotización como quedó
  // (`vistaTrasAceptar`): el editor pinta el precio y el total sin pedir otra vez. Sin la marca, lo
  // de siempre.
  const { resultado: r, etapas } = await conTiempos(() =>
    responderBandeja('aceptar-captura', id, bytesDeImagen(borrador.imagen), () => porPasos
      ? enPeticionDeRuta(async () => {
          const aceptada = await aceptarPorPasos(id, borrador, esEstadoAlAceptar((cuerpo as { estado?: unknown }).estado) ? (cuerpo as { estado: EstadoAlAceptar }).estado : null)
          if (!aceptada.ok) return aceptada
          const vista = await medirEtapa('vista', () => vistaTrasAceptar(id))
          return vista ? { ...aceptada, vista } : aceptada
        })
      : enPeticionDeRuta(() => aceptarCapturaDeBandeja(id, borrador))))
  const ms = performance.now() - inicio
  return NextResponse.json(r, { headers: { 'Server-Timing': encabezadoServerTiming(['aceptar', ms], etapas) } })
}
