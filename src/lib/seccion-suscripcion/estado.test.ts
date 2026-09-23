import { describe, expect, it } from 'vitest'
import type { ProximoPago } from '@/lib/valida-cda/pago-pendiente'
import { fechaConAnio, franjaValida, periodoCorto, puedeOperarSuscripcion, puedeVerSuscripcion, resumenEstado, tonoDelPunto } from './estado'

describe('quién ve Suscripción: solo la persona designada', () => {
  // Datos de cda-pruebas: el designado es el dueño; el operador no.
  const DESIGNADO = '76856b58-6220-40f0-ae59-e08933d8f8f6'
  const OPERADOR = 'de50ff2a-cc51-4dc7-99a9-a39c67cd04b7'

  it('la persona designada la ve (sea cual sea su rol)', () => {
    expect(puedeVerSuscripcion({ usuarioId: DESIGNADO, designadoId: DESIGNADO })).toBe(true)
  })

  it('nadie más: ni el operador, ni un dueño o administrador que no sea la persona designada', () => {
    expect(puedeVerSuscripcion({ usuarioId: OPERADOR, designadoId: DESIGNADO })).toBe(false)
    expect(puedeVerSuscripcion({ usuarioId: 'otro-owner', designadoId: DESIGNADO })).toBe(false)
    expect(puedeVerSuscripcion({ usuarioId: 'otro-admin', designadoId: DESIGNADO })).toBe(false)
  })

  it('un contrato sin persona designada: nadie la ve', () => {
    expect(puedeVerSuscripcion({ usuarioId: DESIGNADO, designadoId: null })).toBe(false)
    expect(puedeVerSuscripcion({ usuarioId: null, designadoId: null })).toBe(false)
  })

  it('la persona designada la opera; «Ver como» la ve en solo lectura', () => {
    expect(puedeOperarSuscripcion({ usuarioId: DESIGNADO, designadoId: DESIGNADO, impersonando: false })).toBe(true)
    // Un platform admin mirando como la persona designada: la ve, pero no opera.
    expect(puedeVerSuscripcion({ usuarioId: DESIGNADO, designadoId: DESIGNADO })).toBe(true)
    expect(puedeOperarSuscripcion({ usuarioId: DESIGNADO, designadoId: DESIGNADO, impersonando: true })).toBe(false)
    expect(puedeOperarSuscripcion({ usuarioId: OPERADOR, designadoId: DESIGNADO, impersonando: false })).toBe(false)
  })
})

const pendiente = (fechaVencimiento: string, concepto: string | null = null): ProximoPago => ({
  estado: 'pendiente',
  numero: 1,
  concepto,
  fechaVencimiento,
  monto: 150000,
  abonado: 0,
  saldo: 150000,
  vencida: false,
  enlacePago: null,
  enlaceVencido: false,
})
const APROBADA = { estado: 'aprobada' as const }
const AL_DIA = { estado: 'al_dia' as const }

describe('los cinco estados', () => {
  it('términos pendientes con plazo: ámbar, con la fecha', () => {
    const r = resumenEstado({
      terminos: { estado: 'pendiente', plazoHasta: '2026-09-30', enPlazo: true },
      pago: pendiente('2026-09-30'),
      mora: AL_DIA,
      hoy: '2026-09-23',
    })
    expect(r).toMatchObject({ estado: 'terminos_pendientes', tono: 'ambar' })
    expect(r.mensaje).toBe('Acepta los Términos a más tardar el 30-sep para seguir usando Valida sin interrupción.')
  })

  it('términos pendientes fuera de plazo: rojo', () => {
    const r = resumenEstado({ terminos: { estado: 'pendiente', plazoHasta: '2026-09-30', enPlazo: false }, pago: null, mora: AL_DIA, hoy: '2026-10-01' })
    expect(r).toMatchObject({ estado: 'terminos_pendientes', tono: 'rojo' })
  })

  it('al día: la próxima cuota vence en más de 5 días', () => {
    const r = resumenEstado({ terminos: APROBADA, pago: pendiente('2026-10-27'), mora: AL_DIA, hoy: '2026-10-01' })
    expect(r).toMatchObject({ estado: 'al_dia', tono: 'verde', mensaje: 'Estás al día. Tu próxima cuota vence el 27-oct.' })
  })

  it('próxima a vencer: 5 días o menos', () => {
    expect(resumenEstado({ terminos: APROBADA, pago: pendiente('2026-10-27'), mora: AL_DIA, hoy: '2026-10-22' }).estado).toBe('por_vencer')
    expect(resumenEstado({ terminos: APROBADA, pago: pendiente('2026-10-27'), mora: AL_DIA, hoy: '2026-10-21' }).estado).toBe('al_dia')
    expect(resumenEstado({ terminos: APROBADA, pago: pendiente('2026-10-27'), mora: AL_DIA, hoy: '2026-10-27' }).mensaje).toBe(
      'Tu cuota vence el 27-oct.',
    )
  })

  it('en aviso de mora: el periodo y la fecha de corte', () => {
    const r = resumenEstado({
      terminos: APROBADA,
      pago: pendiente('2026-09-30', 'Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026'),
      mora: { estado: 'en_mora', vencio: '2026-09-30', corteDesde: '2026-10-31' },
      hoy: '2026-10-05',
    })
    expect(r).toMatchObject({ estado: 'en_mora', tono: 'ambar_fuerte' })
    expect(r.mensaje).toBe('Tu cuota del 23-sep al 22-oct está vencida. Paga antes del 31-oct para evitar la pausa del servicio.')
  })

  it('pausado: más de 30 días', () => {
    const r = resumenEstado({
      terminos: APROBADA,
      pago: pendiente('2026-09-30'),
      mora: { estado: 'suspendido', vencio: '2026-09-30', corteDesde: '2026-10-31' },
      hoy: '2026-11-02',
    })
    expect(r).toMatchObject({ estado: 'pausado', tono: 'rojo' })
    expect(r.mensaje).not.toMatch(/!|¡|urgente/i)
  })

  it('sin poder leer el pago no afirma nada', () => {
    expect(resumenEstado({ terminos: APROBADA, pago: null, mora: AL_DIA, hoy: '2026-10-01' }).estado).toBe('desconocido')
  })

  it('sin cuotas pendientes: al día', () => {
    expect(resumenEstado({ terminos: APROBADA, pago: { estado: 'al_dia', cuotasPagadas: 2 }, mora: AL_DIA, hoy: '2026-10-01' }).mensaje).toBe(
      'Estás al día.',
    )
  })
})

describe('punto del menú y franja de /valida', () => {
  it('el punto sigue el tono; sin datos no hay punto', () => {
    const r = (tono: 'verde' | 'ambar' | 'ambar_fuerte' | 'rojo' | 'gris') =>
      tonoDelPunto({ estado: 'al_dia', tono, chip: '', mensaje: '', requiereAccion: false })
    expect([r('verde'), r('ambar'), r('ambar_fuerte'), r('rojo'), r('gris')]).toEqual(['verde', 'ambar', 'ambar', 'rojo', null])
  })

  it('la franja solo cuando hay algo que hacer con el pago', () => {
    const pago = pendiente('2026-10-27')
    const porVencer = resumenEstado({ terminos: APROBADA, pago, mora: AL_DIA, hoy: '2026-10-24' })
    expect(franjaValida(porVencer, pago)).toBe('Tu cuota vence el 27-oct')
    const alDia = resumenEstado({ terminos: APROBADA, pago, mora: AL_DIA, hoy: '2026-10-01' })
    expect(franjaValida(alDia, pago)).toBeNull()
  })
})

describe('fechas', () => {
  it('con año y periodo corto', () => {
    expect(fechaConAnio('2027-01-15')).toBe('15-ene-2027')
    expect(periodoCorto(null, '2026-10-27')).toBe('27-oct')
  })
})
