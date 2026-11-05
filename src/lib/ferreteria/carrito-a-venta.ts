/**
 * El convertidor de Ferretería para el carrito de los asistentes (`src/lib/carritos/pago-bold.ts`): un carrito pagado
 * es UN negocio de ONE con una venta anticipada por línea (`registrarPedido`), cobro `BOLD-<LNK>` y la conversación de
 * Chatwoot como conversación de origen. Sin red ni base: todo entra por las dependencias.
 */
import type { ConvertidorCarrito } from '@/lib/carritos/pago-bold'
import { registrarPedido, type LineaPedidoVenta } from './ventas'
import type { Autor, PuertoNegocios, RepoFerreteria } from './tipos'

export const AUTOR_BOLD: Autor = { tipo: 'cron', id: null, nombre: 'Pago Bold (asistente)' }

export function referenciaCobroBold(link: string): string {
  return `BOLD-${link}`
}

export interface DepsConvertidorFerreteria {
  ws: string
  repo: RepoFerreteria
  negocios(): Promise<PuertoNegocios | { error: string }>
  /** La conversación de origen como fila de `ferreteria_conversaciones` (resultado `vendio`). Null si no se pudo. */
  conversacion(c: { cuentaId: number; conversacionId: number; canal: string; comprador: string; publicacionId: string }, hoyISO: string): Promise<string | null>
}

export function convertidorDeFerreteria(d: DepsConvertidorFerreteria): ConvertidorCarrito {
  return {
    async registrar({ carrito, lineas, referencia, hoyISO, anotarVenta, anotarNegocio }) {
      const ajenas = lineas.filter((l) => l.item_tipo !== 'ferreteria_publicacion')
      if (ajenas.length) return { ok: false, mensaje: `El carrito trae productos que no son de Ferretería (${ajenas.map((l) => l.codigo).join(', ')}).` }
      const pubs = await Promise.all(lineas.map((l) => d.repo.publicacionPorId(d.ws, l.item_id)))
      const falta = lineas.filter((_, i) => !pubs[i])
      if (falta.length) return { ok: false, mensaje: `Ya no existe la publicación de ${falta.map((l) => l.codigo).join(', ')}.` }
      const negocios = await d.negocios()
      if ('error' in negocios) return { ok: false, mensaje: negocios.error }

      const pedidoLineas: LineaPedidoVenta[] = lineas.map((l, i) => ({
        lineaId: l.id, pub: pubs[i]!, cantidad: l.cantidad, precioUnitario: l.precio_unitario, ventaId: l.venta_id,
      }))
      // La conversación de origen solo hace falta para la primera venta nueva (un reintento ya la tiene).
      const conversacionId = lineas[0].venta_id
        ? null
        : await d.conversacion({
            cuentaId: carrito.chatwoot_cuenta_id, conversacionId: carrito.chatwoot_conversacion_id, canal: carrito.canal,
            comprador: carrito.comprador_nombre, publicacionId: lineas[0].item_id,
          }, hoyISO)
      const r = await registrarPedido(d.repo, negocios, d.ws, {
        lineas: pedidoLineas,
        negocioId: carrito.negocio_id,
        fecha_venta: hoyISO,
        ruta: carrito.ruta,
        comprador_nombre: carrito.comprador_nombre,
        comprador_telefono: carrito.comprador_telefono,
        conversacion_id: conversacionId,
        referencia_pago: referenciaCobroBold(referencia),
        flete: carrito.flete,
        direccion: carrito.direccion,
      }, AUTOR_BOLD, hoyISO, { anotarVenta, anotarNegocio })
      if (!r.ok) return { ok: false, mensaje: r.mensaje }
      return { ok: true, negocioId: r.negocioId, avisos: r.avisos }
    },
  }
}
