import { describe, it, expect } from 'vitest'
import { ensayarRutasBloqueadas, rutasDelCatalogo, type WorkspaceEnsayo } from './ensayo-rutas'

const CDA: WorkspaceEnsayo = { id: 'w-cda', slug: 'cda', modules: { valida_consulta: true }, modoVitrina: true }
const CLARITY: WorkspaceEnsayo = { id: 'w-cl', slug: 'clarity', modules: { business: true }, modoVitrina: false }

describe('ensayarRutasBloqueadas', () => {
  it('lista las rutas que el gate cierra y cruza el uso que cae en ellas', () => {
    const [cda, clarity] = ensayarRutasBloqueadas(
      [CLARITY, CDA],
      [
        { workspace_id: 'w-cda', entidad_tipo: 'negocio', created_at: '2026-08-01T00:00:00Z' },
        { workspace_id: 'w-cda', entidad_tipo: 'negocio', created_at: '2026-09-01T00:00:00Z' },
        { workspace_id: 'w-cda', entidad_tipo: 'workspace', created_at: '2026-09-02T00:00:00Z' },
        { workspace_id: 'w-cl', entidad_tipo: 'negocio', created_at: '2026-09-03T00:00:00Z' },
      ],
    )

    expect(cda.slug).toBe('cda')
    expect(cda.rutasBloqueadas).toContain('/negocios')
    expect(cda.rutasBloqueadas).not.toContain('/valida')
    expect(cda.rutasBloqueadas).not.toContain('/tableros') // vitrina
    expect(cda.rutasBloqueadas).toContain('/numeros') // un CDA usa ONE solo con Valida
    expect(cda.usoBloqueado).toEqual([{ ruta: '/negocios', eventos: 2, ultimo: '2026-09-01T00:00:00Z' }])
    expect(cda.entidadesSinRuta).toEqual(['workspace'])

    // Control: el mismo evento en un workspace con Clarity no es uso bloqueado.
    expect(clarity.usoBloqueado).toEqual([])
    expect(clarity.rutasBloqueadas).not.toContain('/negocios')
  })

  it('el catálogo del ensayo incluye las rutas de todos los módulos', () => {
    const rutas = rutasDelCatalogo()
    for (const r of ['/negocios', '/valida', '/valida-api', '/riesgos', '/calidad', '/certificaciones']) {
      expect(rutas).toContain(r)
    }
  })
})
