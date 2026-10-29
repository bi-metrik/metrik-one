import 'server-only'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'
import { leerCuentaCda } from './pago-servidor'
import { cuotasConEstado } from './pago-pendiente'
import {
  datosDelTextoV15,
  fechaExigeAceptacion,
  finUltimoPeriodoPagado,
  periodosPendientesAntesDe,
  type DatosPantallaV15,
} from './terminos-v1-5'

/**
 * Los datos de la pantalla de la v1.5 para el CDA de la sesión: lo del texto registrado de SU v1.5 y lo de
 * sus cuotas y pagos (la misma lectura por request de la tarjeta de pago y la mora, `leerCuentaCda`).
 *
 * Sin poder leer las cuotas (o sin contrato que pague este espacio), la pantalla dice la regla sin la
 * lista de períodos y la fecha de la 16.4 con su «si es posterior»: nunca una lista vacía que se lea
 * como «estás al día».
 */
export async function datosPantallaV15(p: {
  doc: DocumentoContractual
  servicioContratadoId: string | null
  hoy: string
}): Promise<DatosPantallaV15> {
  const texto = datosDelTextoV15(p.doc.textoMd)
  const base: Omit<DatosPantallaV15, 'periodos' | 'fechaExige'> = { doc: p.doc, texto }
  if (!p.servicioContratadoId) return { ...base, periodos: { estado: 'sin_dato' }, fechaExige: null }
  const cuenta = await leerCuentaCda(p.servicioContratadoId)
  if (cuenta.estado !== 'ok') return { ...base, periodos: { estado: 'sin_dato' }, fechaExige: null }
  const cuotas = cuotasConEstado({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy: p.hoy, ahoraISO: new Date().toISOString() })
  return {
    ...base,
    periodos: { estado: 'ok', periodos: periodosPendientesAntesDe(cuotas, p.doc.vigenteDesde.slice(0, 10)) },
    fechaExige: fechaExigeAceptacion(texto.exigeDesde, finUltimoPeriodoPagado(cuotas)),
  }
}
