import type { BorradorCotizacion } from '@/lib/cotizaciones/asistente/borrador'
import type { Viajeros } from '@/lib/cotizaciones/asistente/invariantes'
import type { Requisitos } from './esquema'
import type { Pregunta } from './preguntas'

/**
 * Los mensajes de Trappi a la ASESORA (manual de la entrega, E-07 y E-08). Nunca a la clienta ni a los
 * viajeros: el PDF se lo envía siempre la asesora.
 *
 * La línea de «lo que entendí» la arma el código con los requisitos (no el modelo): así es igual para el
 * mismo pedido y no se cuela un dato que no está en los requisitos. Debajo, numeradas, solo las preguntas
 * que eligió `preguntasQueBloquean`, con el texto que redactó el modelo.
 */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function textoViajeros(v: Viajeros | null): string | null {
  if (!v) return null
  const a = `${v.adultos} ${v.adultos === 1 ? 'adulto' : 'adultos'}`
  if (!v.ninos.length) return a
  const edades = v.ninos.map(n => n.edad)
  const ninos = v.ninos.length === 1 ? `1 niño de ${edades[0]}` : `${v.ninos.length} niños de ${edades.slice(0, -1).join(', ')} y ${edades.at(-1)}`
  return `${a} y ${ninos}`
}

/** «3 al 6 de enero» · «30 de diciembre al 3 de enero». */
export function textoFechas(ida: string | null, regreso: string | null): string | null {
  if (!ida || !regreso) return null
  const [, mi, di] = ida.split('-').map(Number)
  const [, mr, dr] = regreso.split('-').map(Number)
  return mi === mr ? `${di} al ${dr} de ${MESES[mr - 1]}` : `${di} de ${MESES[mi - 1]} al ${dr} de ${MESES[mr - 1]}`
}

export function lineaDeLoQueEntendi(r: Requisitos, b: BorradorCotizacion | null): string {
  const partes = [r.cliente ?? 'Cliente sin nombre', textoViajeros(r.viajeros) ?? 'viajeros por confirmar']
  const fechas = textoFechas(r.fechaIda, r.fechaRegreso)
  const noches = r.noches ? ` (${r.noches} ${r.noches === 1 ? 'noche' : 'noches'})` : ''
  partes.push([r.destino, fechas ? `${fechas}${noches}` : null].filter(Boolean).join(', ') || 'destino por confirmar')
  if (b) partes.push(`${b.hoteles.length} ${b.hoteles.length === 1 ? 'hotel' : 'hoteles'}`)
  return partes.join(' · ')
}

export function mensajeDeConfirmacion(p: {
  codigo: string
  requisitos: Requisitos
  borrador: BorradorCotizacion | null
  preguntas: Pregunta[]
  /** El cliente no está en ONE y no se puede crear sin una llave (decisión del 2026-10-05). */
  faltaCelularCliente: boolean
}): string {
  const lineas = [`${p.codigo} · *${lineaDeLoQueEntendi(p.requisitos, p.borrador)}*`]
  if (!p.borrador) lineas.push('Todavía no armé la cotización.')
  if (p.preguntas.length) {
    lineas.push('')
    for (const q of p.preguntas) lineas.push(`${q.numero}. ${q.texto}`)
  }
  if (p.faltaCelularCliente && p.requisitos.cliente) {
    lineas.push('', `${p.requisitos.cliente} no está en ONE. Si me pasas su celular, la creo; si no, el viaje queda sin cliente.`)
  }
  lineas.push('')
  if (p.preguntas.length) {
    const ej = p.preguntas.slice(0, 2).map(q => `${q.numero} ${q.clave === 'tarifa' ? 'pública' : 'sí'}`).join(', ')
    lineas.push(`Contéstame todo en un mensaje, por ejemplo «sí, ${ej}». Si algo más cambia, dímelo y lo ajusto.`)
  } else {
    lineas.push('Si todo está bien, responde *sí*. Si algo cambia, dímelo y lo ajusto.')
  }
  lineas.push('_Respóndeme citando este mensaje para que quede en esta cotización._')
  return lineas.join('\n')
}

export function mensajeDelPdf(p: { codigo: string; cliente: string | null; destino: string | null; enlace: string }): string {
  return [
    `${p.codigo} · ${[p.cliente, p.destino].filter(Boolean).join(' · ')}`,
    'Esta es la cotización. Revísala y, si está bien, envíasela tú a la clienta.',
    `Revisión en ONE: ${p.enlace}`,
  ].join('\n')
}

export function mensajeFrenado(p: { codigo: string; motivos: string[]; enlace: string }): string {
  return [
    `${p.codigo} · No saqué el PDF: el chequeo encontró algo que no cuadra.`,
    ...p.motivos.slice(0, 4).map(m => `• ${m}`),
    'Dime cómo lo corrijo o ábrelo en ONE:',
    p.enlace,
  ].join('\n')
}

export const PREGUNTA_TIPO = '¿Este pedido es un *bloqueo* (paquete de un operador) o un viaje *a medida*?'
