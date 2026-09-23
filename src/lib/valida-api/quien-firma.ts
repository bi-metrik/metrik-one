/**
 * Por qué quien entra a una entrada de términos no puede firmar el contrato, dicho para su producto.
 * Puro y sin `'use client'`: lo pintan la entrada (cliente) y el aviso de los CDA (servidor). Una
 * función exportada desde un módulo de cliente no se puede LLAMAR desde un componente de servidor
 * (Next la convierte en referencia de cliente), por eso vive aquí.
 */

import { PRODUCTOS_ENTRADA, type ProductoEntrada } from './producto'
import type { EstadoEntradaPagina } from './resultados'

type ContratoNoFirma = Extract<
  Extract<EstadoEntradaPagina, { estado: 'pendiente' }>['contrato'],
  { puede: false }
>

/**
 * Por qué quien entra no firma, dicho para el producto: en Valida API espera al dueño y después hace
 * su propia aprobación; en los CDA espera a la persona designada y no tiene nada propio que aprobar.
 */
export function textoQuienFirma(contrato: ContratoNoFirma, producto: ProductoEntrada): string {
  const despues = PRODUCTOS_ENTRADA[producto].exigeAprobacionPorUsuario ? '; después haces aquí tu propia aprobación' : ''
  switch (contrato.razon) {
    case 'soporte':
      return PRODUCTOS_ENTRADA[producto].exigeDesignado
        ? 'Estás en este espacio como soporte de MeTRIK. Los términos los acepta la persona que la empresa designó ante MeTRIK, no el soporte.'
        : 'Estás en este espacio como soporte de MeTRIK. Los términos del contrato los acepta el dueño del espacio del cliente; cuando lo haga, podrás hacer aquí tu propia aprobación.'
    case 'no_designado':
      return contrato.designadoNombre
        ? `${contrato.designadoNombre}, la persona que la empresa designó para aceptar estos términos, todavía no los ha aceptado. El módulo se abre cuando los acepte${despues}.`
        : `La persona que la empresa designó para aceptar estos términos todavía no los ha aceptado. El módulo se abre cuando los acepte${despues}.`
    case 'sin_designado':
      return 'MeTRIK todavía no tiene registrada la persona que acepta estos términos por la empresa. El módulo se abre cuando esa persona los acepte. Escríbenos para indicarla.'
    default:
      return `El dueño del espacio, que es quien puede obligar a la empresa, todavía no ha aceptado estos términos. El módulo se abre cuando los acepte${despues}.`
  }
}
