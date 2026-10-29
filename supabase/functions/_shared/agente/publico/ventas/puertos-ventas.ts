// ============================================================
// Asistente de ventas — los puertos (catálogo de ONE, pasarela del workspace, links guardados) y su doble en memoria
// ------------------------------------------------------------
// Producción: `produccion-ventas.ts` (Supabase + Bold con las llaves de la bóveda del workspace, #1294). Pruebas y arnés:
// `ventasEnMemoria`. La pasarela es la del WORKSPACE o nada: sin llaves, `pasarela()` devuelve null y el asistente pasa
// a persona con `pago_no_disponible` (nunca inventa un link ni usa la llave de MéTRIK del servidor).
// ============================================================

import type { CuerpoLinkBold, PasarelaPagos, PedidoLink } from '../../../funciones/pasarela.ts';
import { cuerpoLinkBold } from '../../../funciones/pasarela.ts';
import type { ProductoVenta } from './catalogo-ventas.ts';

/** Lo que se guarda de un link creado (tabla `ferreteria_links_bold`). */
export interface NuevoLink {
  referencia: string;
  url: string;
  huella: string;
  publicacionId: string;
  cantidad: number;
  precioUnitario: number;
  flete: number;
  monto: number;
  zona: string;
  ruta: 'despacho' | 'recoge';
  compradorNombre: string;
  compradorTelefono: string;
  direccion: string | null;
  cuentaId: number;
  conversacionId: number;
  canal: string;
  venceAt: string;
}

export interface LinkGuardado extends NuevoLink {
  registro: string;
}

export type EstadoLink = { estado: string; total: number | null } | 'sin_llaves' | null;

export interface PuertosVentas {
  /** Las publicaciones activas con precio, con su producto. Lanza si la base falla. */
  catalogo(): Promise<ProductoVenta[]>;
  /** La pasarela con las llaves DEL WORKSPACE, o null si no tiene. */
  pasarela(): Promise<PasarelaPagos | null>;
  /** `GET /online/link/v1/{LNK}` con la llave del workspace. `sin_llaves` si no tiene; null si Bold no respondió. */
  consultarLink(referencia: string): Promise<EstadoLink>;
  linkPorHuella(huella: string): Promise<LinkGuardado | null>;
  linkPorReferencia(referencia: string): Promise<LinkGuardado | null>;
  /** Guarda el link. Lanza si no pudo (sin la fila, el webhook no reconocería el pago). */
  guardarLink(l: NuevoLink): Promise<LinkGuardado>;
}

/** El doble: catálogo fijo, pasarela en memoria (o ninguna), estados de link que el caso fija a mano. */
export function ventasEnMemoria(o: { productos: ProductoVenta[]; sinLlaves?: boolean; pasarelaCaida?: boolean }) {
  // Como Bold: arma el cuerpo real del pedido (valida monto y vencimiento) y devuelve un `LNK_…` con su checkout.
  const pedidos: Array<{ pedido: PedidoLink; cuerpo: CuerpoLinkBold }> = [];
  let n = 0;
  const pasarela: PasarelaPagos = {
    async crearLink(p) {
      if (o.pasarelaCaida) return { ok: false, error: 'pasarela caída (doble)' };
      pedidos.push({ pedido: structuredClone(p), cuerpo: cuerpoLinkBold(p) });
      const referencia = `LNK_PRUEBA${++n}`;
      return { ok: true, referencia, url: `https://checkout.bold.co/${referencia}` };
    },
  };
  const links: LinkGuardado[] = [];
  const estados = new Map<string, string>();
  const consultas: string[] = [];
  const puertos: PuertosVentas = {
    catalogo: async () => structuredClone(o.productos),
    pasarela: async () => (o.sinLlaves ? null : pasarela),
    async consultarLink(referencia) {
      consultas.push(referencia);
      if (o.sinLlaves) return 'sin_llaves';
      const l = links.find((x) => x.referencia === referencia);
      return l ? { estado: estados.get(referencia) ?? 'ACTIVE', total: l.monto } : null;
    },
    linkPorHuella: async (h) => structuredClone(links.find((x) => x.huella === h) ?? null),
    linkPorReferencia: async (r) => structuredClone(links.find((x) => x.referencia === r) ?? null),
    async guardarLink(l) {
      if (links.some((x) => x.huella === l.huella || x.referencia === l.referencia)) throw new Error('duplicado (23505)');
      const g = { ...structuredClone(l), registro: 'creado' };
      links.push(g);
      return structuredClone(g);
    },
  };
  return { puertos, links, estados, consultas, pedidos, pagar: (referencia: string) => estados.set(referencia, 'PAID') };
}
