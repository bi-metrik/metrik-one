// ============================================================
// Funciones — el PUERTO de la pasarela de pagos para `generar_link_pago`, su doble en memoria y la interfaz del
// adaptador de Bold (SIN la llamada real: las llaves por workspace son el frente de la pasarela, aparte de este PR)
// ------------------------------------------------------------
// Doc: Bold, API Link de pagos (https://developers.bold.co/pagos-en-linea/api-link-de-pagos), consultada el
// 2026-10-22 por la sesión de diseño: el link acepta `amount_type: 'CLOSE'` (monto fijo) y `expiration_date`
// (opcional); un link vencido (`EXPIRED`) no se puede pagar.
// ============================================================

export interface PedidoLink {
  pagoId: string;
  /** Pesos enteros: el `monto_esperado` del pago, calculado por la base. */
  monto: number;
  /** El `vence_at` del pago (realineado con el de sus apartados). */
  venceAt: string;
  descripcion: string;
}

export type ResultadoLink = { ok: true; referencia: string; url: string } | { ok: false; error: string };

export interface PasarelaPagos {
  crearLink(p: PedidoLink): Promise<ResultadoLink>;
}

/**
 * `expiration_date` de Bold a partir del `vence_at` del pago. LA ÚNICA conversión de unidades: se cambia aquí.
 *
 * En NANOSEGUNDOS desde la época Unix, como dice el texto de la doc y como manda las cuotas de las suscripciones
 * (`src/lib/suscripciones/pasarela/bold.ts`), que ya crea links en producción. Hasta el 2026-11-03 iba en milisegundos
 * (los ejemplos JSON de la doc traen 13 dígitos) y Bold rechazó el primer link real de Dimi con `HTTP 400: PL_000`.
 * Pasa de 2^53: el redondeo del double en ese rango es de cientos de nanosegundos, irrelevante para un vencimiento.
 */
export function expiracionBold(venceAtIso: string): number {
  const ms = Date.parse(venceAtIso);
  if (!Number.isFinite(ms)) throw new Error(`fecha de vencimiento inválida: ${venceAtIso}`);
  return Math.trunc(ms) * 1_000_000;
}

/** El cuerpo del pedido de link a Bold. Pura. */
export interface CuerpoLinkBold {
  amount_type: 'CLOSE';
  amount: { currency: 'COP'; total_amount: number; tip_amount: 0 };
  description: string;
  expiration_date: number;
}

export function cuerpoLinkBold(p: PedidoLink): CuerpoLinkBold {
  if (!Number.isSafeInteger(p.monto) || p.monto <= 0) throw new Error(`monto inválido: ${p.monto}`);
  return {
    amount_type: 'CLOSE',
    // Igual que las cuotas de las suscripciones, que Bold acepta: con `tip_amount: 0`.
    amount: { currency: 'COP', total_amount: p.monto, tip_amount: 0 },
    description: p.descripcion.slice(0, 100),
    expiration_date: expiracionBold(p.venceAt),
  };
}

/**
 * El adaptador de Bold. `enviar` hace la llamada HTTP con la llave del workspace: NO está aquí (es el frente de la
 * pasarela, con sus llaves por workspace). Este archivo solo arma el pedido y lee la respuesta.
 */
export function pasarelaBold(enviar: (cuerpo: CuerpoLinkBold) => Promise<{ referencia: string; url: string } | null>): PasarelaPagos {
  return {
    async crearLink(p) {
      let cuerpo: CuerpoLinkBold;
      try {
        cuerpo = cuerpoLinkBold(p);
      } catch (e) {
        return { ok: false, error: String((e as Error).message) };
      }
      try {
        const r = await enviar(cuerpo);
        return r && r.referencia && r.url ? { ok: true, referencia: r.referencia, url: r.url } : { ok: false, error: 'sin_respuesta' };
      } catch (e) {
        return { ok: false, error: String((e as Error).message).slice(0, 200) };
      }
    },
  };
}

/** Cuenta los links de TODOS los dobles: la referencia es única por workspace en la base, como en Bold. */
let enlacesDelDoble = 0;

/** El doble en memoria: guarda cada pedido (ya con el cuerpo de Bold) y devuelve una referencia `LNK_n` que no se repite. */
export function pasarelaEnMemoria(o: { falla?: boolean } = {}) {
  const pedidos: Array<{ pedido: PedidoLink; cuerpo: CuerpoLinkBold }> = [];
  const pasarela: PasarelaPagos = {
    async crearLink(p) {
      if (o.falla) return { ok: false, error: 'pasarela caída (doble)' };
      pedidos.push({ pedido: p, cuerpo: cuerpoLinkBold(p) });
      const referencia = `LNK_${++enlacesDelDoble}`;
      return { ok: true, referencia, url: `https://checkout.ejemplo/${referencia}` };
    },
  };
  return { pasarela, pedidos: () => pedidos.map((x) => structuredClone(x)) };
}
