/**
 * Un TRASLADO DE IDA Y REGRESO en un solo pantallazo (brief del 2026-10-29, punto 4; COT-2026-0008).
 *
 * El carrito de Civitatis trae un «Resumen» con dos trayectos de la misma reserva:
 *   Trayecto 1 · Aeropuerto (CUR) → Willemstad · sáb 26 jun 13:20 · $176.456,80
 *   Trayecto 2 · Willemstad → Aeropuerto (CUR) · mié 30 jun 05:10 · $176.456,80
 * Con la regla de no escoger una fila (RX1, `lectura-pantallazo.ts`) ONE preguntaba «¿cuál
 * trayecto?», y al volver a pegarlo lo rechazaba por repetido: Alejandra terminó subiendo cada
 * trayecto por separado y quedaron dos bloques.
 *
 * ## Qué se acepta y qué no (la regla de no escoger NO se afloja)
 *
 * Se juntan en UN traslado solo si son EXACTAMENTE dos trayectos y el segundo es el primero al
 * revés (mismos dos extremos, sentido contrario). Entonces no hay nada que escoger: es la ida y el
 * regreso de una misma reserva, y el costo es la suma de los dos.
 *
 * Todo lo demás sigue preguntando: tres trayectos (aeropuerto → hotel A → hotel B), dos que no son
 * inversos, o uno sin precio legible. La tarjeta del carro («Turismo de 4 plazas», sin ruta) y el
 * listado de vehículos no llegan aquí: no traen trayectos.
 *
 * Puro: sin red y sin base.
 */
import { parseMontoCop } from '@/lib/negocios/monto-cop'

/** Un trayecto tal como el modelo lo ve en el resumen de la reserva. */
export interface TrayectoReservaCrudo {
  desde: string | null
  hasta: string | null
  /** «AAAA-MM-DD», o «--MM-DD/dow» si la pantalla no muestra el año. */
  fecha: string | null
  /** «HH:MM». */
  hora: string | null
  precio: string | null
}

export interface TrasladoIdaYRegreso {
  ida: { desde: string; hasta: string; fecha: string | null; hora: string | null; precio: number }
  regreso: { desde: string; hasta: string; fecha: string | null; hora: string | null; precio: number }
  total: number
}

/** Para comparar extremos: sin tildes, sin signos, sin espacios de más, en minúscula. */
function clave(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const HORA = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/

function horaLimpia(h: string | null): string | null {
  const m = HORA.exec(h ?? '')
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/**
 * ¿Los trayectos del resumen son la ida y el regreso de una misma ruta? Devuelve los dos con su
 * precio y la suma, o `null` si no (y entonces la regla de no escoger sigue mandando).
 */
export function trasladoDeIdaYRegreso(trayectos: readonly TrayectoReservaCrudo[] | null | undefined): TrasladoIdaYRegreso | null {
  if (!trayectos || trayectos.length !== 2) return null
  const [a, b] = trayectos
  if (!a.desde?.trim() || !a.hasta?.trim() || !b.desde?.trim() || !b.hasta?.trim()) return null
  if (clave(a.desde) === clave(a.hasta)) return null
  const inverso = clave(a.desde) === clave(b.hasta) && clave(a.hasta) === clave(b.desde)
  if (!inverso) return null
  const pa = parseMontoCop(a.precio)
  const pb = parseMontoCop(b.precio)
  if (pa === null || pb === null || pa <= 0 || pb <= 0) return null
  const tramo = (t: TrayectoReservaCrudo, precio: number) => ({
    desde: (t.desde as string).trim(),
    hasta: (t.hasta as string).trim(),
    fecha: t.fecha?.trim() || null,
    hora: horaLimpia(t.hora),
    precio,
  })
  // Redondeo a centavos: 176.456,80 + 176.456,80 es 352.913,60, no 352913.60000000003.
  return { ida: tramo(a, pa), regreso: tramo(b, pb), total: Math.round((pa + pb) * 100) / 100 }
}

/** «A -> B y B -> A»: la forma que el documento ya sabe partir en dos trayectos (`trayectos.ts`). */
export function trayectoDeIdaYRegreso(t: TrasladoIdaYRegreso): string {
  return `${t.ida.desde} -> ${t.ida.hasta} y ${t.regreso.desde} -> ${t.regreso.hasta}`
}

/** «2027-06-26 13:20 y 2027-06-30 05:10»: cada fecha con su hora, en el orden de los trayectos. */
export function fechaDeIdaYRegreso(fechas: [string | null, string | null], t: TrasladoIdaYRegreso): string | null {
  const parte = (f: string | null, h: string | null) => (f ? [f, h].filter(Boolean).join(' ') : null)
  const ida = parte(fechas[0], t.ida.hora)
  const regreso = parte(fechas[1], t.regreso.hora)
  if (!ida && !regreso) return null
  return [ida, regreso].filter(Boolean).join(' y ')
}
