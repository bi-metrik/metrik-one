// ============================================================
// Asistente público — las ventanas por canal (§9)
// ------------------------------------------------------------
// Antes de publicar, el código compara la hora del último mensaje del contacto con la ventana del canal. Si venció, no
// publica y deja nota privada. El bot nunca usa la etiqueta Human Agent de Instagram (solo una persona).
//   · WhatsApp: 24 h desde el último mensaje del cliente (fuera, solo plantillas: las decide una persona).
//   · Instagram: 24 h; 7 días si la conversación llegó por un anuncio Click-to-Direct (lo dice el inbox).
//   · TikTok: 48 h, y hasta 10 mensajes nuestros seguidos antes de que el cliente vuelva a escribir.
// Fuente: §2.7 de la investigación y `requisitos-canales-chatwoot.md` (c), citados en el diseño. Pura.
// ============================================================

import type { Canal, FilaPublica } from './tipos.ts';

const HORA = 3600 * 1000;
export const TOPE_SEGUIDOS_TIKTOK = 10;

export function horasDeVentana(canal: Canal, anuncio7Dias = false): number {
  if (canal === 'tiktok') return 48;
  if (canal === 'instagram' && anuncio7Dias) return 24 * 7;
  return 24;
}

/** Los mensajes publicados nuestros desde el último del contacto (TikTok: tope de 10). */
export function seguidosDesdeElContacto(filas: FilaPublica[]): number {
  let n = 0;
  for (let i = filas.length - 1; i >= 0; i--) {
    const f = filas[i];
    if (f.direccion === 'entrante') break;
    if (f.estado === 'publicado') n++;
  }
  return n;
}

export type Ventana = { abierta: true; quedan: number | null } | { abierta: false; motivo: 'vencida' | 'tope_tiktok' | 'sin_mensaje_del_contacto' };

/**
 * ¿Se puede publicar `cuantos` mensajes ahora? `quedan`: cuántos más caben en TikTok (null = sin tope). Pura.
 */
export function ventana(p: { canal: Canal; anuncio7Dias?: boolean; filas: FilaPublica[]; ahoraMs: number; cuantos?: number }): Ventana {
  const ultimo = [...p.filas].reverse().find((f) => f.direccion === 'entrante');
  if (!ultimo) return { abierta: false, motivo: 'sin_mensaje_del_contacto' };
  if (p.ahoraMs - Date.parse(ultimo.created_at) > horasDeVentana(p.canal, p.anuncio7Dias) * HORA) return { abierta: false, motivo: 'vencida' };
  if (p.canal !== 'tiktok') return { abierta: true, quedan: null };
  const quedan = TOPE_SEGUIDOS_TIKTOK - seguidosDesdeElContacto(p.filas);
  if (quedan < (p.cuantos ?? 1)) return { abierta: false, motivo: 'tope_tiktok' };
  return { abierta: true, quedan };
}
