// ============================================================
// Siigo DESPUÉS de responder.
//
// Registrar un pago es lo que la persona pidió; el abono a la factura y el RC-3 son una
// consecuencia (`recibo-automatico.ts`: «NUNCA lanza y NUNCA devuelve error al llamador»).
// Hasta el 2026-10-04 esa consecuencia corría EN LÍNEA dentro de la acción, y la persona
// esperaba a Siigo: con el back-off de 429 de hasta 30 s por llamada (`recibos.ts`), el
// p95 de 7 días de «Conciliar» en SOENA llegó a 19,7 s.
//
// Aquí la misma rutina se agenda con `after()` de Next: corre cuando la respuesta ya
// salió, en la misma invocación (Vercel la mantiene viva con `waitUntil`). Lo que cambia
// es CUÁNDO, no QUÉ: los fallos siguen quedando en el log con `[abono-automatico]` /
// `[recibo-automatico]` y el cobro sin marca, que es lo que reintenta el siguiente pago
// del negocio o el lote del rezago.
//
// ── Fuera de un request ──────────────────────────────────────────────────────
// `after()` lanza si no hay request (un script, una prueba, un cron que llame la rutina
// directo). En ese caso se corre EN LÍNEA y se espera, como antes: un script que termina
// sin esperar dejaría el abono a medio camino.
//
// ⚠️ La pantalla que se revalida al responder NO ve el abono: sale después. Hoy ninguna
// pantalla depende de él para decidir algo (el abono no tiene botón ni aparece como
// recibo en el panel); se ve al siguiente render.
//
// Server-only.
// ============================================================

import { after } from 'next/server'
import { abonarAlRegistrarPago, alRegistrarCobro } from './recibo-automatico'

/**
 * Agenda `tarea` para después de la respuesta. Fuera de un request la corre en línea y
 * devuelve la promesa, para que el llamador la espere igual que antes.
 *
 * La tarea no debería lanzar (las rutinas de Siigo no lanzan); si lo hace, queda en el log
 * con su etiqueta en vez de convertirse en un rechazo sin dueño.
 */
export function enSegundoPlano(etiqueta: string, tarea: () => Promise<void>): Promise<void> {
  const protegida = async () => {
    try {
      await tarea()
    } catch (e) {
      console.error(`[siigo] ${etiqueta} falló en segundo plano:`, (e as Error)?.message ?? e)
    }
  }
  try {
    after(protegida)
    return Promise.resolve()
  } catch {
    // Sin request (script, prueba, cron que llama directo): en línea, como antes.
    return protegida()
  }
}

/**
 * El abono del honorario de cada negocio, después de responder.
 *
 * Los negocios van UNO TRAS OTRO a propósito, no en paralelo: el límite de Siigo salta
 * alrededor de las 100 peticiones seguidas (`client.ts`), y en segundo plano nadie está
 * esperando la diferencia.
 */
export function abonarEnSegundoPlano(workspaceId: string, negocioIds: Iterable<string>): Promise<void> {
  const ids = Array.from(new Set(negocioIds))
  if (ids.length === 0) return Promise.resolve()
  return enSegundoPlano(`abono de ${ids.length} negocio(s)`, async () => {
    for (const id of ids) await abonarAlRegistrarPago(workspaceId, id)
  })
}

/** Abono + RC-3 de UN cobro (`alRegistrarCobro`), después de responder. */
export function alRegistrarCobroEnSegundoPlano(workspaceId: string, cobroId: string): Promise<void> {
  return enSegundoPlano(`documentos del cobro ${cobroId}`, () => alRegistrarCobro(workspaceId, cobroId))
}
