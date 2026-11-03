// ============================================================
// Asistente público — topes y costo (§11)
// ------------------------------------------------------------
// En código: 3 llamados de herramienta por turno (el núcleo), turnos con IA por conversación (propuesta 30, luego
// persona), mensajes por contacto por hora (anti-spam), contexto bajo 100.000 tokens (el núcleo recorta la conversación
// a 6.000 y el sistema es fijo por versión: queda muy por debajo), y presupuesto diario con alertas al 50, 80 y 100 %.
// Al 100 % el bot manda un mensaje fijo y pasa a persona: no se corta a ciegas. El presupuesto y la regla de corte los
// fija Carmen (D12): mientras tanto `presupuesto_diario_usd` es un parámetro sin valor (sin tope ni alertas).
//
// El gasto sale de las trazas del día (cada turno del modelo guarda sus tokens por llamado) y de los precios que se le
// pasen: los de `bot_modelo_precios` y, si Haiku 5.5 no está ahí, el oficial de `llm-anthropic.ts` (USD 0,10 / 0,50 por
// millón, leído de la doc de Anthropic el 2026-10-20). Puro.
// ============================================================

import { MODELO_HAIKU, PRECIO_HAIKU } from '../../llm-anthropic.ts';
import { sumarUso } from '../uso.ts';
import type { PrecioModelo } from '../uso.ts';
import type { FilaPublica, TrazaPublica } from './tipos.ts';

export const UMBRALES_PRESUPUESTO = [50, 80, 100] as const;

/** Los precios con Haiku 5.5 por defecto si la tabla no lo trae. Pura. */
export function conPrecioHaiku(precios: PrecioModelo[]): PrecioModelo[] {
  if (precios.some((p) => p.modelo === MODELO_HAIKU)) return precios;
  return [...precios, { modelo: MODELO_HAIKU, entrada: PRECIO_HAIKU.entrada, salida: PRECIO_HAIKU.salida, cache: PRECIO_HAIKU.entrada * 0.1 }];
}

/** El inicio del día de Bogotá de un instante (ISO UTC). Pura. */
export function inicioDiaBogota(ms: number): string {
  const dia = new Date(ms - 5 * 3600 * 1000).toISOString().slice(0, 10);
  return new Date(`${dia}T05:00:00.000Z`).toISOString();
}

/** El gasto del día en USD (null si algún modelo no tiene precio). Pura. */
export function gastoDelDia(trazas: TrazaPublica[], precios: PrecioModelo[]): number | null {
  return sumarUso(trazas, conPrecioHaiku(precios)).costo_usd;
}

/** Los umbrales alcanzados (50, 80, 100). Pura. */
export function umbralesAlcanzados(gasto: number, presupuesto: number): number[] {
  return UMBRALES_PRESUPUESTO.filter((u) => gasto >= (presupuesto * u) / 100);
}

/** Turnos del modelo que ya tuvo la conversación. Pura. */
/**
 * Las filas del tramo en curso: desde el último aviso de bienvenida (que vuelve a salir tras una pausa larga o cuando
 * una persona devuelve la conversación). Messenger reusa la misma conversación para siempre: sin esto, el cliente que
 * vuelve otro día hereda los turnos y las fotos de antes (30-oct, Dimpro: tope de 30 turnos y fotos que no salían). Pura.
 */
export function filasDelTramo(filas: FilaPublica[]): FilaPublica[] {
  let i = -1;
  filas.forEach((f, j) => { if ((f.traza as TrazaPublica | null)?.aviso) i = j; });
  return i < 0 ? filas : filas.slice(i);
}

/**
 * Lo que va después de la última vez que una persona resolvió la conversación en Chatwoot (la fila con `cierre`). Al
 * resolverla, el cliente que vuelve a escribir empieza de nuevo: aviso de bienvenida, sin historial, sin pedido ni fotos
 * de antes (Mauricio, 30-oct: «no está reiniciando la conversación»; Messenger reusa la misma). Pura.
 */
export function desdeCierre(filas: FilaPublica[]): FilaPublica[] {
  let i = -1;
  filas.forEach((f, j) => { if ((f.traza as TrazaPublica | null)?.cierre) i = j; });
  return i < 0 ? filas : filas.slice(i + 1);
}

export function turnosConIA(filas: FilaPublica[]): number {
  return filas.filter((f) => f.traza?.tipo === 'modelo').length;
}

/** Mensajes del contacto en la última hora (anti-spam). Pura. */
export function mensajesUltimaHora(filas: FilaPublica[], ahoraMs: number): number {
  return filas.filter((f) => f.direccion === 'entrante' && ahoraMs - Date.parse(f.created_at) <= 3600 * 1000).length;
}

export function textoAvisoPresupuesto(p: { workspace: string; umbral: number; gasto: number; presupuesto: number }): string {
  return p.umbral >= 100
    ? `El asistente de ${p.workspace} llegó al 100 % de su presupuesto diario (USD ${p.gasto.toFixed(2)} de ${p.presupuesto.toFixed(2)}): las conversaciones nuevas pasan a persona hasta mañana.`
    : `El asistente de ${p.workspace} va en el ${p.umbral} % de su presupuesto diario (USD ${p.gasto.toFixed(2)} de ${p.presupuesto.toFixed(2)}).`;
}
