import { describe, expect, it } from 'vitest'
import { correoDeltaMonitoreo } from './correo-delta'

const base = { workspaceNombre: 'ALMA', workspaceSlug: 'alma-afi', baseDomain: 'metrikone.co' }

describe('correoDeltaMonitoreo', () => {
  it('un aviso: asunto en singular y el texto de la campanita', () => {
    const { asunto, html } = correoDeltaMonitoreo({ ...base, avisos: ['ACME aparece reportada: 2 reporte(s) donde antes no había ninguno.'] })
    expect(asunto).toBe('Monitoreo de listas: una contraparte cambió')
    expect(html).toContain('ACME aparece reportada')
    expect(html).toContain('https://alma-afi.metrikone.co/compliance/liberaciones')
  })

  it('varios avisos van en UN correo', () => {
    const { asunto, html } = correoDeltaMonitoreo({ ...base, avisos: ['a', 'b', 'c'] })
    expect(asunto).toBe('Monitoreo de listas: 3 contrapartes cambiaron')
    expect(html.match(/<li /g)).toHaveLength(3)
  })

  it('escapa el nombre de la contraparte', () => {
    const { html } = correoDeltaMonitoreo({ ...base, avisos: ['<script>x</script> cambió'] })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('en desarrollo el enlace va por http', () => {
    const { html } = correoDeltaMonitoreo({ ...base, baseDomain: 'localhost:3000', avisos: ['a'] })
    expect(html).toContain('http://alma-afi.localhost:3000/compliance/liberaciones')
  })
})
