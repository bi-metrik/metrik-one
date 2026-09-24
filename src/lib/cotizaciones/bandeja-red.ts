/**
 * La bandeja de capturas habla con el servidor por `fetch`, NUNCA por server action.
 *
 * POR QUÉ (prueba de Mauricio en COT-2026-0016, 2026-09-24): Next despacha las server actions
 * y los `router.refresh()` de una página en UNA sola fila (`app-router-instance`). Cada
 * pantallazo pegado lanzaba dos server actions (detectar, leer) de 8 a 25 s, así que con siete
 * pegados la fila se llenaba y el `router.refresh()` que sigue a cada «Aceptar» esperaba detrás
 * de todas las lecturas: la captura ya estaba en la base y Componentes no la mostraba. En los
 * registros de Vercel se ve: las tres aceptaciones entraron a las 19:08:18-23 y el refresco
 * llegó a las 19:08:40, cuando terminó la última lectura. Un `fetch` no entra a esa fila, y de
 * paso las lecturas corren a la vez en vez de una detrás de otra.
 *
 * Un fallo de red LANZA: `procesarCaptura` ya lo convierte en su mensaje de siempre.
 */
import type { ResultadoDeteccion } from '@/app/(app)/negocios/ranura-actions'
import type { BorradorParaAceptar, ResultadoAceptarCaptura, ResultadoBorrador } from '@/app/(app)/negocios/tarifa-pax-actions'
import type { TipoRanura } from './ranuras-cotizacion'

type Fetch = typeof fetch

function rutaDe(cotizacionId: string, accion: 'detectar-captura' | 'leer-captura' | 'aceptar-captura'): string {
  return `/api/cotizaciones/${encodeURIComponent(cotizacionId)}/${accion}`
}

async function enviar<T>(url: string, cuerpo: unknown, f: Fetch): Promise<T> {
  const res = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })
  return (await res.json()) as T
}

/** ¿De qué es el pantallazo? (`detectarCaptura`, por la ruta). */
export function detectarPorRuta(cotizacionId: string, dataUrl: string, f: Fetch = fetch): Promise<ResultadoDeteccion> {
  return enviar(rutaDe(cotizacionId, 'detectar-captura'), { dataUrl }, f)
}

/** La lectura firmada del pantallazo (`leerCapturaEnBorrador`, por la ruta). */
export function leerPorRuta(
  cotizacionId: string,
  tipo: TipoRanura,
  dataUrl: string,
  enfoque: { nombre: string; precio: string | null } | null,
  f: Fetch = fetch,
): Promise<ResultadoBorrador> {
  return enviar(rutaDe(cotizacionId, 'leer-captura'), { tipo, dataUrl, enfoque }, f)
}

/** «Aceptar» (`aceptarCapturaDeBandeja`, por la ruta). `null` si no hubo respuesta. */
export async function aceptarPorRuta(cotizacionId: string, cuerpo: BorradorParaAceptar, f: Fetch = fetch): Promise<ResultadoAceptarCaptura | null> {
  try {
    return await enviar<ResultadoAceptarCaptura>(rutaDe(cotizacionId, 'aceptar-captura'), cuerpo, f)
  } catch {
    return null
  }
}
