/**
 * Gate por ruta, contra los 17 workspaces reales (foto del 2026-09-15).
 *
 * Dos direcciones, y las dos importan igual:
 * - lo que se cierra: una pantalla de un módulo apagado no abre (`/negocios` en un CDA);
 * - lo que NO se puede cerrar: todo lo que un workspace con su módulo usa hoy. Un gate que
 *   apagara SOENA sería peor que no tener gate.
 */
import { describe, it, expect } from 'vitest'
import { landingForWorkspace } from '@/lib/auth/landing'
import { IDS_MODULO, MODULOS, RUTAS_COMUNES } from './catalogo'
import {
  destinoSiBloqueada,
  modulosDeRuta,
  rutaGateada,
  rutaPermitida,
  soportePasaGate,
  type ContextoGate,
} from './gate'
import { WORKSPACES_2026_09_15, workspaceMedido } from './__fixtures__/workspaces-2026-09-15'

const ROLES = ['owner', 'admin', 'supervisor', 'operator', 'read_only'] as const

function ctx(slug: string, extra: Partial<ContextoGate> = {}): ContextoGate {
  const w = workspaceMedido(slug)
  return { modules: w.modules, modoVitrina: w.modoVitrina, platformAdmin: false, ...extra }
}

const TODAS_LAS_RUTAS = [
  ...new Set([
    ...IDS_MODULO.flatMap((id) => MODULOS[id].rutas),
    ...RUTAS_COMUNES,
    '/negocios/123/archivos',
    '/compliance/listas',
    '/compliance/comparativa-informa',
    '/calidad/mi-perfil',
  ]),
]

describe('lo que se cierra', () => {
  it('un CDA (solo Valida, en vitrina) ya no abre /negocios ni sus subrutas', () => {
    for (const slug of ['cda-caqueta', 'cda-elcarmen', 'cda-puertotest', 'maxitec']) {
      expect(rutaPermitida('/negocios', ctx(slug)), slug).toBe(false)
      expect(rutaPermitida('/negocios/123/archivos', ctx(slug)), slug).toBe(false)
      expect(destinoSiBloqueada('/negocios', { ...ctx(slug), role: 'owner' }), slug).toBe('/valida')
    }
  })

  it('un workspace de solo Sustenta no abre Clarity y aterriza en sus listas', () => {
    expect(rutaPermitida('/negocios', ctx('alma-afi'))).toBe(false)
    expect(rutaPermitida('/movimientos', ctx('alma-afi'))).toBe(false)
    expect(destinoSiBloqueada('/negocios', { ...ctx('alma-afi'), role: 'operator' })).toBe('/compliance/listas')
  })

  it('un call center de solo calidad no abre /numeros; cada rol aterriza en lo suyo', () => {
    expect(destinoSiBloqueada('/numeros', { ...ctx('regat'), role: 'owner' })).toBe('/calidad')
    expect(destinoSiBloqueada('/numeros', { ...ctx('regat'), role: 'operator' })).toBe('/calidad/mi-perfil')
  })

  it('advise (llamadas + bot, sin Clarity) pierde Workflows aunque tenga una línea activa', () => {
    expect(rutaPermitida('/flujo', ctx('advise'))).toBe(false)
  })

  it('metrik (sin Sustenta) no abre las pantallas de Sustenta', () => {
    expect(rutaPermitida('/compliance/listas', ctx('metrik'))).toBe(false)
    expect(rutaPermitida('/compliance/validacion', ctx('metrik'))).toBe(false)
    expect(rutaPermitida('/riesgos', ctx('metrik'))).toBe(false)
  })

  it('una clave de módulo en `false` es módulo apagado', () => {
    expect(rutaPermitida('/negocios', { modules: { business: false }, modoVitrina: false, platformAdmin: false })).toBe(false)
  })
})

describe('lo que no se puede cerrar', () => {
  it('todo workspace con Clarity abre todas las rutas de Clarity', () => {
    const conClarity = WORKSPACES_2026_09_15.filter((w) => w.modules.business)
    expect(conClarity.length).toBe(10)
    for (const w of conClarity) {
      for (const r of MODULOS.clarity.rutas) expect(rutaPermitida(r, ctx(w.slug)), `${w.slug} ${r}`).toBe(true)
    }
  })

  it('cada workspace abre las rutas de cada módulo que tiene encendido', () => {
    for (const w of WORKSPACES_2026_09_15) {
      for (const id of IDS_MODULO) {
        if (w.modules[MODULOS[id].clave] !== true) continue
        for (const r of MODULOS[id].rutas) expect(rutaPermitida(r, ctx(w.slug)), `${w.slug} ${r}`).toBe(true)
      }
    }
  })

  it('la vitrina de un CDA abre Tableros y Valida; Números ya no (usa ONE solo con Valida)', () => {
    for (const slug of ['cda-caqueta', 'cda-elcarmen', 'cda-puertotest', 'maxitec']) {
      expect(rutaPermitida('/numeros', ctx(slug)), slug).toBe(false)
      expect(rutaPermitida('/tableros', ctx(slug)), slug).toBe(true)
      expect(rutaPermitida('/valida', ctx(slug)), slug).toBe(true)
    }
    // Control: sin vitrina, las mismas rutas se cierran. Sin este caso no se distingue
    // "la vitrina abre" de "el gate nunca cierra".
    expect(rutaPermitida('/tableros', ctx('cda-caqueta', { modoVitrina: false }))).toBe(false)
    // Control: una vitrina con otro módulo además de Valida conserva Números. Se razona por
    // módulo encendido, no por el slug.
    const conOtro = { modules: { valida_consulta: true, compliance: true }, modoVitrina: true, platformAdmin: false }
    expect(rutaPermitida('/numeros', conOtro)).toBe(true)
    // Una llave de función no es un módulo: no le devuelve Números a un CDA.
    const conLlave = { modules: { valida_consulta: true, fab_registrar_pago: true }, modoVitrina: true, platformAdmin: false }
    expect(rutaPermitida('/numeros', conLlave)).toBe(false)
  })

  it('una llave de función abre SOLO su ruta: comparativa en metrik, solicitudes con el bot', () => {
    expect(rutaPermitida('/compliance/comparativa-informa', ctx('metrik'))).toBe(true)
    expect(rutaPermitida('/solicitudes', ctx('advise'))).toBe(true)
    expect(rutaPermitida('/solicitudes', { modules: { wa_customer_bot: true }, modoVitrina: false, platformAdmin: false })).toBe(true)
    expect(rutaPermitida('/calidad', { modules: { wa_customer_bot: true }, modoVitrina: false, platformAdmin: false })).toBe(false)
  })

  it('los módulos compartidos: /equipo y /tableros abren para Llamadas, /directorio para Sustenta', () => {
    expect(rutaPermitida('/equipo', ctx('regat'))).toBe(true)
    expect(rutaPermitida('/tableros', ctx('regat'))).toBe(true)
    expect(rutaPermitida('/directorio', ctx('alma-afi'))).toBe(true)
    expect(rutaPermitida('/tableros', ctx('alma-afi'))).toBe(true)
  })

  it('las rutas comunes abren en cualquier workspace, incluido un CDA en vitrina', () => {
    for (const w of WORKSPACES_2026_09_15) {
      for (const r of RUTAS_COMUNES) expect(rutaPermitida(r, ctx(w.slug)), `${w.slug} ${r}`).toBe(true)
    }
    expect(rutaGateada('/servicios')).toBe(false)
  })

  it('el aterrizaje de cada workspace y rol está permitido (la puerta de entrada no rebota)', () => {
    for (const w of WORKSPACES_2026_09_15) {
      for (const role of ROLES) {
        const destino = landingForWorkspace(role, w.modules, w.modoVitrina)
        expect(rutaPermitida(destino, ctx(w.slug)), `${w.slug} ${role} -> ${destino}`).toBe(true)
      }
    }
  })

  it('un cliente de API directa (solo valida_api) aterriza en /valida-api, que su gate permite', () => {
    const soloApi: ContextoGate = { modules: { valida_api: true }, modoVitrina: false, platformAdmin: false }
    for (const role of ROLES) {
      const destino = landingForWorkspace(role, soloApi.modules as Record<string, boolean>, false)
      expect(destino, role).toBe('/valida-api')
      expect(rutaPermitida(destino, soloApi), role).toBe(true)
    }
    // Y no abre pantallas de otros módulos por URL.
    expect(rutaPermitida('/negocios', soloApi)).toBe(false)
    expect(rutaPermitida('/valida', soloApi)).toBe(false)
    expect(destinoSiBloqueada('/negocios', { ...soloApi, role: 'owner' })).toBe('/valida-api')
  })

  it('el platform admin pasa en todo', () => {
    for (const r of TODAS_LAS_RUTAS) expect(rutaPermitida(r, ctx('cda-caqueta', { platformAdmin: true })), r).toBe(true)
  })

  it('el soporte de MeTRIK solo pasa en su propio espacio: visitando a un cliente ve lo del cliente', () => {
    const HOME = 'ws-metrik'
    expect(soportePasaGate({ platformAdmin: true, workspaceId: HOME, homeWorkspaceId: HOME })).toBe(true)
    // Sin espacio propio registrado cuenta como en casa, igual que `isAway`.
    expect(soportePasaGate({ platformAdmin: true, workspaceId: '4d-soft', homeWorkspaceId: null })).toBe(true)
    expect(soportePasaGate({ platformAdmin: true, workspaceId: '4d-soft', homeWorkspaceId: HOME })).toBe(false)
    expect(soportePasaGate({ platformAdmin: false, workspaceId: HOME, homeWorkspaceId: HOME })).toBe(false)
    expect(soportePasaGate({ platformAdmin: null, workspaceId: HOME, homeWorkspaceId: HOME })).toBe(false)

    // 4d-soft (solo valida_api, medido el 2026-09-16): el soporte que lo visita no abre por URL
    // Directorio ni Tableros, y entra a Valida API como el cliente.
    const visita: ContextoGate = {
      modules: { valida_api: true },
      modoVitrina: false,
      platformAdmin: soportePasaGate({ platformAdmin: true, workspaceId: '4d-soft', homeWorkspaceId: HOME }),
      role: 'owner',
    }
    expect(rutaPermitida('/directorio', visita)).toBe(false)
    expect(rutaPermitida('/tableros', visita)).toBe(false)
    expect(destinoSiBloqueada('/directorio', visita)).toBe('/valida-api')
    expect(rutaPermitida('/valida-api', visita)).toBe(true)
    expect(rutaPermitida('/mi-negocio', visita)).toBe(true)
  })

  it('sin `modules` el workspace es Clarity, igual que en el layout y el menú', () => {
    const sinModules: ContextoGate = { modules: null, modoVitrina: false, platformAdmin: false }
    for (const r of MODULOS.clarity.rutas) expect(rutaPermitida(r, sinModules), r).toBe(true)
    expect(rutaPermitida('/valida', sinModules)).toBe(false)
  })

  it('el contador no se redirige desde el gate (su guard ya lo confina a /revision)', () => {
    expect(destinoSiBloqueada('/revision', { ...ctx('regat'), role: 'contador' })).toBeNull()
  })
})

describe('forma de las rutas', () => {
  it('el prefijo no se come rutas vecinas ni las fuera de la app', () => {
    expect(modulosDeRuta('/negocios-x')).toEqual([])
    expect(rutaGateada('/negocios-x')).toBe(false)
    for (const r of ['/api/cron/x', '/auth/callback', '/login', '/', '/cert/abc', '/vinculacion/t']) {
      expect(rutaGateada(r), r).toBe(false)
    }
  })

  it('una ruta compartida pertenece a todos sus módulos', () => {
    expect(modulosDeRuta('/tableros')).toEqual(['clarity', 'sustenta', 'llamadas'])
  })
})

describe('el destino de una ruta bloqueada', () => {
  it('nunca es otra ruta bloqueada, para ningún workspace, rol ni ruta', () => {
    for (const w of WORKSPACES_2026_09_15) {
      for (const role of ROLES) {
        for (const r of TODAS_LAS_RUTAS) {
          const c = { ...ctx(w.slug), role }
          const destino = destinoSiBloqueada(r, c)
          if (destino === null) continue
          expect(rutaPermitida(destino, c), `${w.slug} ${role} ${r} -> ${destino}`).toBe(true)
          expect(destino, `${w.slug} ${role} ${r}`).not.toBe(r)
        }
      }
    }
  })

  it('si el aterrizaje también está bloqueado, cae al primer módulo encendido y luego a /mi-negocio', () => {
    // Vitrina sin Valida: el aterrizaje de vitrina es /valida, que no abre.
    expect(destinoSiBloqueada('/negocios', { modules: { calidad_llamadas: true }, modoVitrina: true, platformAdmin: false, role: 'owner' })).toBe('/calidad')
    expect(destinoSiBloqueada('/negocios', { modules: {}, modoVitrina: true, platformAdmin: false, role: 'owner' })).toBe('/mi-negocio')
  })
})
