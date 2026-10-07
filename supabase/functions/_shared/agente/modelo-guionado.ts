// ============================================================
// Núcleo conversacional — un modelo falso y guionado (pruebas y arnés sin gastar cupo)
// ------------------------------------------------------------
// Cada llamado consume el siguiente paso del guion. Un paso es una llamada a herramienta, varias (en paralelo), una
// falla, o una función que mira el pedido (para guiones que dependen de lo que devolvió una herramienta).
// ============================================================

import type { Mensaje, Modelo, PedidoModelo, RespuestaModelo, UsoLlamado } from './tipos.ts';

export type Llamada = { name: string; args?: Record<string, unknown> };
export type Paso =
  | Llamada
  | { varias: Llamada[] }
  | { falla: string }
  | ((p: PedidoModelo) => Llamada | { varias: Llamada[] } | { falla: string });

export interface ModeloGuionado extends Modelo {
  pedidos: PedidoModelo[];
  restantes(): number;
}

export function modeloGuionado(guion: Paso[], o: { modelo?: string; uso?: Partial<UsoLlamado> } = {}): ModeloGuionado {
  const pasos = [...guion];
  const pedidos: PedidoModelo[] = [];
  const modelo = o.modelo ?? 'guion';
  return {
    pedidos,
    restantes: () => pasos.length,
    async llamar(p: PedidoModelo): Promise<RespuestaModelo> {
      pedidos.push(structuredClone(p));
      const uso: UsoLlamado = { modelo, entrada: 1000, salida: 50, razonamiento: 100, cache: 0, ms: 10, ok: true, ...o.uso };
      const siguiente = pasos.shift();
      if (!siguiente) return { ok: false, motivo: 'guion agotado', usos: [{ ...uso, ok: false }] };
      const paso = typeof siguiente === 'function' ? siguiente(p) : siguiente;
      if ('falla' in paso) return { ok: false, motivo: paso.falla, usos: [{ ...uso, ok: false, motivo: paso.falla }] };
      const llamadas = 'varias' in paso ? paso.varias : [paso];
      const mensaje: Mensaje = {
        role: 'model',
        modelo,
        parts: llamadas.map((l, i) => ({ functionCall: { name: l.name, args: l.args ?? {} }, ...(i === 0 ? { thoughtSignature: `firma-${pedidos.length}` } : {}) })),
      };
      return { ok: true, mensaje, usos: [uso] };
    },
  };
}
