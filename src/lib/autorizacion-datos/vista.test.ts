import { describe, expect, it } from 'vitest'
import { leerEstado } from './estado'
import { leerConfigAutorizacion } from './texto'
import {
  armarVista,
  autorizada,
  CONSECUENCIA_SIN_AUTORIZACION,
  puedePedirAutorizacion,
  puedeVerAutorizacion,
} from './vista'

const base = {
  existe: true,
  contacto: { nombre: 'CLIENTE INVENTADO', email: 'cliente@correo-inventado.co' },
  texto: { id: 't', version: 'v1.1', mayor: 1, menor: 1 },
  vigente: { generales: false, sensibles: false, menores: false, ofertas: false },
}

describe('armarVista', () => {
  it('verde solo con la general vigente de la RPC (lo mismo que mira el gate)', () => {
    const e = leerEstado({
      ...base,
      vigente: { ...base.vigente, generales: true },
      aceptacion: { enlace_id: 'e', aceptado_at: '2026-10-09T15:00:00Z', version: 'v1.1', mayor: 1, menor: 1, medio: 'correo', casillas: { generales: true }, revocadas: {}, via: 'link' },
    })
    const v = armarVista(e, null)
    expect(autorizada(v)).toBe(true)
    expect(v).toMatchObject({ fase: 'aprobada', aceptadoAt: '2026-10-09T15:00:00Z', version: 'v1.1', via: 'link', evidencia: null })
  })

  it('una aceptación sin la general vigente (versión mayor nueva) es roja: reaceptar', () => {
    const e = leerEstado({
      ...base,
      requiere_reaceptar: true,
      aceptacion: { enlace_id: 'e', aceptado_at: '2026-01-01T00:00:00Z', version: 'v0.9', mayor: 0, menor: 9, medio: 'correo', casillas: { generales: true }, revocadas: {} },
    })
    const v = armarVista(e, null)
    expect(v.fase).toBe('reaceptar')
    expect(autorizada(v)).toBe(false)
  })

  it('la marca manual vieja se muestra pero NO pinta verde', () => {
    const v = armarVista(leerEstado({ ...base, manual_sin_evidencia: { fecha: '2026-10-01' } }), null)
    expect(v.manualSinEvidencia).toEqual({ fecha: '2026-10-01' })
    expect(autorizada(v)).toBe(false)
  })

  it('enviada y rechazada traen su fecha; sin texto publicado se avisa', () => {
    const enviada = armarVista(leerEstado({ ...base, pendiente: { enlace_id: 'p', token: 'x', expira_at: '2026-12-01', correo_enviado_at: '2026-10-10T12:00:00Z', rechazado_at: null } }), null)
    expect(enviada).toMatchObject({ fase: 'enviada', correoEnviadoAt: '2026-10-10T12:00:00Z', textoPublicado: true })
    const rechazada = armarVista(leerEstado({ ...base, texto: null, pendiente: { enlace_id: 'p', token: 'x', expira_at: '2026-12-01', correo_enviado_at: null, rechazado_at: '2026-10-11T12:00:00Z' } }), null)
    expect(rechazada).toMatchObject({ fase: 'rechazada', rechazadoAt: '2026-10-11T12:00:00Z', textoPublicado: false })
  })

  it('las versiones de la vía con evidencia viajan solo si se pasan', () => {
    const versiones = [{ id: 't', version: 'v1.1', casillas: [{ clave: 'generales' as const, texto: 'x' }] }]
    expect(armarVista(leerEstado(base), versiones).evidencia).toEqual({ versiones })
  })

  it('la consecuencia nombra el viaje o los viajes del cliente', () => {
    expect(CONSECUENCIA_SIN_AUTORIZACION.viaje).toBe('Sin esta autorización el viaje no pasa a Cotización.')
    expect(CONSECUENCIA_SIN_AUTORIZACION.contacto).toBe('Sin esta autorización los viajes de este cliente no pasan a Cotización.')
  })
})

describe('permisos en la ficha del contacto', () => {
  it('ver: todos menos contador (ni sin rol)', () => {
    for (const r of ['owner', 'admin', 'supervisor', 'operator', 'read_only']) expect(puedeVerAutorizacion(r)).toBe(true)
    expect(puedeVerAutorizacion('contador')).toBe(false)
    expect(puedeVerAutorizacion(null)).toBe(false)
  })

  it('pedir el link: owner/admin/supervisor; operator solo si es responsable; read_only y contador nunca', () => {
    for (const r of ['owner', 'admin', 'supervisor']) expect(puedePedirAutorizacion(r, false)).toBe(true)
    expect(puedePedirAutorizacion('operator', false)).toBe(false)
    expect(puedePedirAutorizacion('operator', true)).toBe(true)
    expect(puedePedirAutorizacion('read_only', true)).toBe(false)
    expect(puedePedirAutorizacion('contador', true)).toBe(false)
    expect(puedePedirAutorizacion(null, true)).toBe(false)
  })
})

describe('config activa', () => {
  it('activa solo si config_extra.autorizacion_datos es un objeto', () => {
    expect(leerConfigAutorizacion(null).activa).toBe(false)
    expect(leerConfigAutorizacion({}).activa).toBe(false)
    expect(leerConfigAutorizacion({ autorizacion_datos: true }).activa).toBe(false)
    expect(leerConfigAutorizacion({ autorizacion_datos: [] }).activa).toBe(false)
    expect(leerConfigAutorizacion({ autorizacion_datos: {} }).activa).toBe(true)
    expect(leerConfigAutorizacion({ autorizacion_datos: { correo_al_crear: true } }).activa).toBe(true)
  })
})
