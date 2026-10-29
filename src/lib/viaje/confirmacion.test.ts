/**
 * «El cliente confirmó»: mensaje al viajero (C1, D-9, F2-11), titular (C4, P3), permisos (C15),
 * gates de la etapa y prerreserva (C9). Casos sintéticos.
 */
import { describe, expect, it } from 'vitest'
import { TERMINOS_BASE_TRAPPVEL } from '@/lib/cotizaciones/__fixtures__/terminos-base-trappvel'
import {
  AVISO_PASAPORTE,
  enlaceWhatsApp,
  esAnticipoConSoporte,
  gatesConfirmacionPendientes,
  leerTitular,
  mensajeConfirmacion,
  prerreservaVencida,
  puedeConfirmarCliente,
  seccionesDeTerminos,
  telefonoParaWa,
} from './confirmacion'
import { planSugerido } from './plan-pagos'
import { CONDICION_VISA_EN_TRAMITE, TITULO_CONDICION_VISA } from './condicion-visa'

const HOY = '2026-10-13'
const SALIDA = '2026-12-04'

describe('términos a viñetas (D-9)', () => {
  it('las 5 condiciones y los medios de pago con las cuentas anidadas', () => {
    const t = seccionesDeTerminos(TERMINOS_BASE_TRAPPVEL)
    expect(t.condiciones).toHaveLength(5)
    expect(t.condiciones[1]).toBe('Las cancelaciones pueden generar penalidades de hasta el 100 % del valor del paquete turístico.')
    expect(t.mediosPago).toContain('  · Bancolombia, cuenta de ahorros 32800003241')
    expect(t.mediosPago.at(-1)).toBe('PSE, tarjeta de crédito o link de pago, con un recargo promedio del 3 %.')
  })
  it('sin texto, sin secciones', () => {
    expect(seccionesDeTerminos(null)).toEqual({ condiciones: [], mediosPago: [] })
  })
})

describe('mensaje de confirmación con visa en trámite (Mauricio 2026-10-29, V8-2)', () => {
  it('lleva la condición visible, antes de las condiciones generales', () => {
    const cuotas = planSugerido({ total: 9_165_000, fechaSalida: SALIDA, hoy: HOY })!
    const t = mensajeConfirmacion({
      nombreCliente: 'Esteban', destino: 'Nueva York', fechaSalida: SALIDA, fechaRegreso: null, composicion: null,
      tarifaNombre: 'Recomendada', total: 9_165_000, cuotas, fechaMinimo: '2026-11-19', pctMinimo: 80, hoy: HOY,
      terminos: seccionesDeTerminos(TERMINOS_BASE_TRAPPVEL), extra: null, comercial: 'Daniela', agencia: 'Trappvel',
      visaEnTramite: true,
    })
    expect(t).toContain(`*${TITULO_CONDICION_VISA}:*\n${CONDICION_VISA_EN_TRAMITE}`)
    expect(t.indexOf(CONDICION_VISA_EN_TRAMITE)).toBeLessThan(t.indexOf('*Condiciones:*'))
  })
})

describe('mensaje de confirmación (Noor §7.1 con C1, D-9, X1)', () => {
  const cuotas = planSugerido({ total: 9_165_000, fechaSalida: SALIDA, hoy: HOY })!
  const texto = mensajeConfirmacion({
    nombreCliente: 'Carolina Duarte',
    destino: 'San Andrés y Providencia',
    fechaSalida: SALIDA,
    fechaRegreso: '2026-12-09',
    composicion: { adultos: 2, ninos: 0, infantes: 1 },
    tarifaNombre: 'Recomendada',
    total: 9_165_000,
    cuotas,
    fechaMinimo: '2026-11-19',
    pctMinimo: 80,
    hoy: HOY,
    terminos: seccionesDeTerminos(TERMINOS_BASE_TRAPPVEL),
    extra: 'Te espero en el aeropuerto.',
    comercial: 'Daniela',
    agencia: 'Trappvel',
  })

  it('repite tarifa, total, cada cuota con fecha y monto, la fecha del 80 %, las cuentas, el recargo y las condiciones (F2-11)', () => {
    expect(texto).toContain('Carolina, ¿todo bien con esto?')
    expect(texto).toContain('*Tu viaje:* San Andrés y Providencia, 4 dic al 9 dic · 2 adultos y 1 infante.')
    expect(texto).toContain('*Tarifa:* Recomendada')
    expect(texto).toContain('*Total:* $9.165.000')
    expect(texto).toContain('1. $2.750.000 · hoy, 13 oct (anticipo)')
    expect(texto).toContain('2. $4.582.000 · 19 nov')
    expect(texto).toContain('3. $1.833.000 · 3 dic')
    expect(texto).toContain('El 19 nov debes llevar el 80 % pagado.')
    expect(texto).toContain('NIT 900.945.317-1')
    expect(texto).toContain('recargo promedio del 3 %')
    expect(texto).toContain('- Los servicios que no se tomen no son reembolsables.')
    expect(texto).toContain('Te espero en el aeropuerto.')
    expect(texto.trim().endsWith('Daniela · Trappvel')).toBe(true)
    // Sin visa en trámite, nada de visa.
    expect(texto).not.toContain('visa')
  })

  it('no promete un link de pago que la agencia no tiene ni dice que «sale por WhatsApp» (X1, C1); nada técnico (§7.6)', () => {
    expect(texto).not.toMatch(/\[link/i)
    expect(texto).not.toMatch(/sale por WhatsApp/i)
    expect(texto).not.toMatch(/cobro programado|checklist|bloque|gate|plan_pago|wa_manual|excepci[oó]n|huella|FIFO|MéTRIK/i)
  })

  it('el enlace abre WhatsApp con el texto exacto', () => {
    const url = enlaceWhatsApp('300 123 4567', texto)
    expect(url.startsWith('https://wa.me/573001234567?text=')).toBe(true)
    expect(decodeURIComponent(url.split('?text=')[1])).toBe(texto)
    expect(telefonoParaWa('123')).toBeNull()
  })
})

describe('titular de facturación (C4, P3)', () => {
  const viajero = { nombre: 'Carolina Duarte', correo: null, telefono: '3001234567' }
  it('viajero sin documento sirve (la factura de persona natural se completa después)', () => {
    expect(leerTitular({ tipo: 'viajero' }, viajero)).toMatchObject({ ok: true, titular: { tipo: 'viajero', nombre: 'Carolina Duarte', tipo_documento: null } })
  })
  it('empresa exige NIT y razón social; queda con tipo 31', () => {
    expect(leerTitular({ tipo: 'empresa', numero_documento: '900123456' }, viajero).ok).toBe(false)
    expect(leerTitular({ tipo: 'empresa', nombre: 'Acme S.A.S' }, viajero).ok).toBe(false)
    expect(leerTitular({ tipo: 'empresa', nombre: 'Acme S.A.S', numero_documento: '900.123.456-7' }, viajero)).toMatchObject({ ok: true, titular: { tipo_documento: '31', numero_documento: '900123456-7' } })
  })
  it('otra persona exige nombre y documento; con pasaporte avisa que se factura por fuera, sin fallar en silencio', () => {
    expect(leerTitular({ tipo: 'tercero', nombre: 'Juan' }, viajero).ok).toBe(false)
    expect(leerTitular({ tipo: 'tercero', nombre: 'John Doe', numero_documento: 'AB123', tipo_documento: '41' }, viajero)).toMatchObject({ ok: true, aviso: AVISO_PASAPORTE })
  })
  it('un correo mal escrito no pasa; sin tipo tampoco', () => {
    expect(leerTitular({ tipo: 'viajero', correo: 'carolina@' }, viajero).ok).toBe(false)
    expect(leerTitular({}, viajero).ok).toBe(false)
  })
})

describe('quién confirma (C15, §7.4)', () => {
  const base = { aprobadores: ['s-edgar'], staffId: 's-dani', role: 'operator' }
  it('la comercial dueña sí; otra comercial no; operaciones sola no; la dirección sí', () => {
    expect(puedeConfirmarCliente({ ...base, areas: ['comercial'], esResponsable: true })).toBe(true)
    expect(puedeConfirmarCliente({ ...base, areas: ['comercial'], esResponsable: false })).toBe(false)
    expect(puedeConfirmarCliente({ ...base, areas: ['operaciones'], esResponsable: true })).toBe(false)
    expect(puedeConfirmarCliente({ ...base, staffId: 's-edgar', areas: [], esResponsable: false })).toBe(true)
    expect(puedeConfirmarCliente({ ...base, role: 'owner', areas: [], esResponsable: false })).toBe(true)
    expect(puedeConfirmarCliente({ ...base, role: 'read_only', areas: ['comercial'], esResponsable: true })).toBe(false)
  })
})

describe('gates de Confirmación', () => {
  const gates = ['confirmacion_registrada', 'plan_pagos_acordado', 'anticipo_con_soporte']
  it('dice lo que falta en el orden de la etapa, con el texto de la línea si lo declara', () => {
    expect(gatesConfirmacionPendientes(gates, { confirmado: false, planVigente: false, anticipoConSoporte: false })).toHaveLength(3)
    expect(gatesConfirmacionPendientes(gates, { confirmado: true, planVigente: true, anticipoConSoporte: false }, { anticipo_con_soporte: 'Falta el anticipo' })).toEqual(['Falta el anticipo'])
    expect(gatesConfirmacionPendientes(['saldo_cero'], { confirmado: false, planVigente: false, anticipoConSoporte: false })).toEqual([])
  })
  it('el anticipo cuenta solo con fecha, monto, comprobante y cuenta receptora', () => {
    const ok = { fecha: HOY, monto: 1, soporte: { url: 'one://x' }, cuenta_recaudo: 'bancolombia' }
    expect(esAnticipoConSoporte(ok)).toBe(true)
    expect(esAnticipoConSoporte({ ...ok, fecha: null })).toBe(false)
    expect(esAnticipoConSoporte({ ...ok, soporte: null })).toBe(false)
    expect(esAnticipoConSoporte({ ...ok, cuenta_recaudo: null })).toBe(false)
    expect(esAnticipoConSoporte({ ...ok, monto: 0 })).toBe(false)
  })
})

describe('prerreserva (C9)', () => {
  const p = { vence_at: '2026-10-13T20:40:00Z', estado: 'vigente' as const }
  it('vence a la hora sin pago; con pago o ya aplicada, no', () => {
    expect(prerreservaVencida(p, Date.parse('2026-10-13T20:39:59Z'), false)).toBe(false)
    expect(prerreservaVencida(p, Date.parse('2026-10-13T20:40:00Z'), false)).toBe(true)
    expect(prerreservaVencida(p, Date.parse('2026-10-14T00:00:00Z'), true)).toBe(false)
    expect(prerreservaVencida({ ...p, estado: 'vencida' }, Date.parse('2026-10-14T00:00:00Z'), false)).toBe(false)
    expect(prerreservaVencida(null, Date.now(), false)).toBe(false)
  })
})
