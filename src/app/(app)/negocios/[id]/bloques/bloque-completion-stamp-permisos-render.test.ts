/**
 * `BloqueCompletionStamp` con `restrict_to_operator_or_responsable` (SOE-018).
 *
 * La supervisora de operaciones de SOENA no podía marcar «Radicación revisada» (DA50,
 * etapa 8) sin ser responsable del caso: la pantalla tenía su propia lista de roles
 * (operator, owner, admin o responsable) y el servidor (`guardEditarBloque` →
 * `canEditBloque`) sí la aceptaba. Ahora la pantalla decide con
 * `puedeEditarConAreaResuelta`, que ES `canEditBloque` con el área ya resuelta.
 *
 * Render con `renderToStaticMarkup` (entorno node, sin DOM). El candado se lee en el
 * `disabled` del botón y en el aviso.
 *
 * ⚠️ Se queda en `.test.ts`: el `include` de vitest es `src/**\/*.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {}, info: () => {} } }))
vi.mock('../../negocio-v2-actions', () => ({
  marcarBloqueCompleto: async () => ({ error: null }),
}))

import BloqueCompletionStamp from './BloqueCompletionStamp'
import { puedeEditarConAreaResuelta } from '@/lib/permissions/can-edit'

function pintar(opts: { userRole: string; esResponsable: boolean; restrict?: boolean }) {
  return renderToStaticMarkup(
    React.createElement(BloqueCompletionStamp, {
      negocioBloqueId: 'nb-1',
      instancia: null,
      modo: 'editable',
      labelBoton: 'Radicación revisada',
      restrictToOperatorOrResponsable: opts.restrict ?? true,
      userRole: opts.userRole,
      esResponsable: opts.esResponsable,
      profiles: [],
    }),
  )
}

// `disabled=""` y no `disabled` a secas: la clase trae `disabled:cursor-not-allowed`.
const bloqueado = (html: string) => /<button[^>]*\sdisabled=""/.test(html)
const AVISO = 'Solo el ejecutor responsable del caso o un supervisor puede marcar este cargue.'

describe('BloqueCompletionStamp · restrict_to_operator_or_responsable', () => {
  it('un supervisor NO responsable puede marcar (SOE-018)', () => {
    const html = pintar({ userRole: 'supervisor', esResponsable: false })
    expect(bloqueado(html)).toBe(false)
    expect(html).not.toContain(AVISO)
  })

  it('un operador responsable sigue pudiendo', () => {
    const html = pintar({ userRole: 'operator', esResponsable: true })
    expect(bloqueado(html)).toBe(false)
  })

  it('owner y admin siguen pudiendo sin ser responsables', () => {
    expect(bloqueado(pintar({ userRole: 'owner', esResponsable: false }))).toBe(false)
    expect(bloqueado(pintar({ userRole: 'admin', esResponsable: false }))).toBe(false)
  })

  it('un read_only no puede, ni siendo responsable', () => {
    for (const esResponsable of [false, true]) {
      const html = pintar({ userRole: 'read_only', esResponsable })
      expect(bloqueado(html)).toBe(true)
      expect(html).toContain(AVISO)
    }
  })

  it('un contador no puede', () => {
    expect(bloqueado(pintar({ userRole: 'contador', esResponsable: true }))).toBe(true)
  })

  it('un operador NO responsable no puede (el servidor ya lo rechazaba)', () => {
    expect(bloqueado(pintar({ userRole: 'operator', esResponsable: false }))).toBe(true)
  })

  it('sin la bandera, el botón queda como antes para cualquier rol', () => {
    for (const userRole of ['owner', 'admin', 'supervisor', 'operator', 'contador', 'read_only']) {
      for (const esResponsable of [false, true]) {
        const html = pintar({ userRole, esResponsable, restrict: false })
        expect(bloqueado(html)).toBe(false)
        expect(html).not.toContain(AVISO)
      }
    }
  })
})

describe('puedeEditarConAreaResuelta · espejo de canEditBloque', () => {
  it('coincide rol por rol con la regla del servidor sin segmentación de área', () => {
    const esperado: Record<string, [boolean, boolean]> = {
      // [no responsable, responsable]
      owner: [true, true],
      admin: [true, true],
      supervisor: [true, true],
      operator: [false, true],
      contador: [false, false],
      read_only: [false, false],
      desconocido: [false, false],
    }
    for (const [role, [sinResp, conResp]] of Object.entries(esperado)) {
      expect(puedeEditarConAreaResuelta(role, false), `${role} sin responsable`).toBe(sinResp)
      expect(puedeEditarConAreaResuelta(role, true), `${role} responsable`).toBe(conResp)
    }
  })
})
