import type { PasoVenta } from '@/lib/ferreteria/reglas'
import type { PuertoNegocios } from '@/lib/ferreteria/tipos'

interface NegocioFalso {
  nombre: string
  paso: PasoVenta
  abierto: boolean
  precioAprobado: number | null
  pagos: { monto: number; fecha: string; referencia: string }[]
  historial: string[]
  responsable: boolean
}

/**
 * Doble de los negocios de ONE. Reproduce lo que el motor de verdad exige y que el núcleo da
 * por hecho: el avance es de a una etapa (Vendido → Entregado → Pagado), solo se completa desde
 * Pagado, y un negocio cerrado no recibe pagos ni se mueve.
 */
export function negociosFalsos() {
  const negocios = new Map<string, NegocioFalso>()
  const fallar: Partial<Record<keyof PuertoNegocios, string>> = {}
  let seq = 0
  const orden: PasoVenta[] = ['vendido', 'entregado', 'pagado']
  const puerto: PuertoNegocios = {
    async crear({ nombre, compradorNombre }) {
      if (fallar.crear) return { ok: false, error: fallar.crear }
      const id = `neg-${++seq}`
      negocios.set(id, { nombre, paso: 'vendido', abierto: true, precioAprobado: null, pagos: [], historial: compradorNombre ? [`contacto ${compradorNombre}`] : [], responsable: false })
      return { ok: true, negocioId: id }
    },
    async fijarPrecioAprobado(id, precio) {
      if (fallar.fijarPrecioAprobado) return fallar.fijarPrecioAprobado
      negocios.get(id)!.precioAprobado = precio
      return null
    },
    async registrarPago(id, pago) {
      if (fallar.registrarPago) return fallar.registrarPago
      const n = negocios.get(id)!
      if (!n.abierto) return 'Negocio cerrado'
      // Idempotente por referencia, como `registrarPagoEnNegocio`.
      if (!n.pagos.some((p) => p.referencia === pago.referencia)) n.pagos.push(pago)
      return null
    },
    async estado(id) {
      const n = negocios.get(id)
      return n ? { paso: n.paso, abierto: n.abierto } : null
    },
    async moverA(id, paso) {
      if (fallar.moverA) return fallar.moverA
      const n = negocios.get(id)!
      if (!n.abierto) return 'Negocio cerrado'
      if (orden.indexOf(paso) !== orden.indexOf(n.paso) + 1) return `Salto no permitido de ${n.paso} a ${paso}`
      n.paso = paso
      n.historial.push(`etapa ${paso}`)
      return null
    },
    async completar(id) {
      if (fallar.completar) return fallar.completar
      const n = negocios.get(id)!
      if (n.paso !== 'pagado') return 'Solo se completa desde la etapa de cierre'
      if (!n.abierto) return 'El negocio ya esta cerrado'
      n.abierto = false
      n.historial.push('completado')
      return null
    },
    async asignarResponsable(id) {
      if (fallar.asignarResponsable) return fallar.asignarResponsable
      negocios.get(id)!.responsable = true
      return null
    },
    async anotar(id, texto) {
      negocios.get(id)?.historial.push(texto)
    },
  }
  return { puerto, negocios, fallar }
}

