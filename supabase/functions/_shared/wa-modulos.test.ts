/**
 * El bot de WhatsApp del equipo pide Clarity, con el mismo criterio que la app.
 *
 * El hueco (riesgo 11, cuarta ronda): `wa-webhook` identificaba al remitente por telefono y
 * solo miraba rol y suscripcion. Un miembro de alma-afi o de advise (los dos en `trial`, sin
 * Clarity) registraba gastos y contactos, y cada mensaje pasaba por Gemini a cargo de MeTRIK.
 *
 * Dos partes:
 *   - el criterio puro (`botEquipoPermitido`) contra el de la app (`REQUISITO.clarity`) sobre los
 *     workspaces medidos: si uno cambia y el otro no, esto cae;
 *   - el cableado en `wa-webhook/index.ts`, leyendo el fuente: el handler no se puede colectar
 *     desde node (lee `Deno.env` al importarse), y lo que importa es el ORDEN: la puerta va
 *     despues de la aceptacion de terminos y antes de Gemini, la sesion y los handlers.
 *
 * VISTO FALLAR (2026-09-16) contra `origin/main`: caen las 2 del cableado (las 3 del criterio son
 * del modulo nuevo). Mutaciones: mover la puerta despues del parseo tumba la del orden; abrir sin
 * fila de workspace tumba la de la fila nula.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { cumpleRequisitoModulo, REQUISITO } from '@/lib/modulos/requisito'
import { WORKSPACES_2026_09_15 } from '@/lib/modulos/__fixtures__/workspaces-2026-09-15'
import { botEquipoPermitido } from './wa-modulos'

const CUATRO_D_SOFT = { valida_api: true }

describe('botEquipoPermitido', () => {
  it('coincide con REQUISITO.clarity de la app en cada workspace medido', () => {
    const casos: Array<{ slug: string; modules: Record<string, boolean> | null }> = [
      ...WORKSPACES_2026_09_15.map((w) => ({ slug: w.slug, modules: w.modules })),
      { slug: '4d-soft', modules: CUATRO_D_SOFT },
      { slug: 'sin modules', modules: null },
    ]
    for (const c of casos) {
      const app = cumpleRequisitoModulo(REQUISITO.clarity, { modules: c.modules, platformAdmin: false, modoVitrina: false })
      expect({ slug: c.slug, bot: botEquipoPermitido({ modules: c.modules }) }).toEqual({ slug: c.slug, bot: app })
    }
  })

  it('cierra a 4D SOFT, alma-afi, advise y los CDA; abre a SOENA', () => {
    const por = (slug: string) => WORKSPACES_2026_09_15.find((w) => w.slug === slug)!.modules
    expect(botEquipoPermitido({ modules: CUATRO_D_SOFT })).toBe(false)
    expect(botEquipoPermitido({ modules: por('alma-afi') })).toBe(false)
    expect(botEquipoPermitido({ modules: por('advise') })).toBe(false)
    expect(botEquipoPermitido({ modules: por('cda-caqueta') })).toBe(false)
    expect(botEquipoPermitido({ modules: por('soena') })).toBe(true)
  })

  it('sin fila de workspace cierra; una fila sin `modules` es Clarity', () => {
    expect(botEquipoPermitido(null)).toBe(false)
    expect(botEquipoPermitido(undefined)).toBe(false)
    expect(botEquipoPermitido({ modules: null })).toBe(true)
    expect(botEquipoPermitido({ modules: { business: 'true' } })).toBe(false)
  })
})

describe('wa-webhook aplica la puerta', () => {
  const fuente = readFileSync('supabase/functions/wa-webhook/index.ts', 'utf8')

  function cuerpo(nombre: string): string {
    const inicio = fuente.indexOf(`async function ${nombre}(`)
    expect(inicio).toBeGreaterThan(-1)
    const fin = fuente.indexOf('\n}\n', inicio)
    return fuente.slice(inicio, fin)
  }

  it('processMessage corta sin Clarity despues de los terminos y antes de Gemini, la sesion y los handlers', () => {
    const pm = cuerpo('processMessage')
    const puerta = pm.indexOf('if (!botEquipoPermitido(user.modulos))')
    expect(puerta).toBeGreaterThan(-1)
    expect(pm.slice(puerta, pm.indexOf('}', puerta))).toMatch(/return;/)

    expect(puerta).toBeGreaterThan(pm.indexOf('atenderPendienteTerminos('))
    expect(puerta).toBeGreaterThan(pm.indexOf('atenderDesconocido('))
    const trasIdentificar = pm.indexOf('identifyUser(')
    for (const despues of ['transcribeAudio(', 'getOrCreateSession(', 'parseMessage(', 'handleSessionResponse(', 'routeToHandler(', 'checkInboundLimit(']) {
      const i = pm.indexOf(despues, trasIdentificar)
      expect({ despues, i: i > puerta }).toEqual({ despues, i: true })
    }
  })

  it('identifyUser lee `modules` y lo entrega en las dos ramas (staff y colaborador)', () => {
    const iu = cuerpo('identifyUser')
    const lecturas = iu.split(".from('workspaces')").length - 1
    expect(lecturas).toBe(2)
    expect(iu.split(".select('subscription_status, modules')").length - 1).toBe(lecturas)
    expect(iu.split('modulos: workspace ?? null').length - 1).toBe(lecturas)
  })
})
