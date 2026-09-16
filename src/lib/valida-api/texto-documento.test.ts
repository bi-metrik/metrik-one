import { describe, expect, it } from 'vitest'
import { bloquesDeTexto, tramosDeLinea, type BloqueTexto, type Tramo } from './texto-documento'

/**
 * El texto de los términos pintado como texto vivo. Lo que no puede pasar es que se pierda una
 * palabra: lo que la persona lee es lo que acepta. El fragmento es el comienzo real de los términos
 * v1.0 de 4D SOFT.
 */

const MD = [
  '# TÉRMINOS DE USO',
  '',
  '**Versión 1.0 · Septiembre de 2026**',
  '',
  '## Partes',
  '',
  '**EL PROVEEDOR:** METRIK IA S.A.S., NIT 902.079.601-9.',
  '',
  '1.1. METRIK concede al Cliente acceso a **VALIDA**, servicio de consulta (el "Servicio").',
  'Segunda línea del mismo párrafo.',
  '',
  '- primer punto',
  '- segundo **punto**',
].join('\r\n')

const plano = (tramos: Tramo[]) => tramos.map((t) => t.texto).join('')

function textoDe(bloques: BloqueTexto[]): string {
  return bloques
    .map((b) => (b.tipo === 'lista' ? b.items.map(plano).join('\n') : plano(b.tramos)))
    .join('\n')
}

describe('bloquesDeTexto', () => {
  const bloques = bloquesDeTexto(MD)

  it('reconoce títulos, párrafos y listas', () => {
    expect(bloques.map((b) => (b.tipo === 'titulo' ? `h${b.nivel}` : b.tipo))).toEqual([
      'h1',
      'parrafo',
      'h2',
      'parrafo',
      'parrafo',
      'lista',
    ])
  })

  it('no pierde texto: todo lo que no es marcado sigue ahí, en orden', () => {
    const sinMarcado = MD.replace(/\r\n/g, '\n')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => l.replace(/^#+\s+/, '').replace(/^- /, '').replace(/\*\*/g, ''))
      .join('\n')
    expect(textoDe(bloques)).toBe(sinMarcado)
  })

  it('conserva los saltos de línea dentro de un párrafo', () => {
    const p = bloques[4]
    expect(p.tipo === 'parrafo' && plano(p.tramos)).toContain('(el "Servicio").\nSegunda línea')
  })

  it('un título de nivel 4 o más se pinta como nivel 3', () => {
    expect(bloquesDeTexto('#### Anexo')).toEqual([{ tipo: 'titulo', nivel: 3, tramos: [{ texto: 'Anexo', negrita: false }] }])
  })
})

describe('tramosDeLinea', () => {
  it('separa las negritas', () => {
    expect(tramosDeLinea('**EL PROVEEDOR:** METRIK')).toEqual([
      { texto: 'EL PROVEEDOR:', negrita: true },
      { texto: ' METRIK', negrita: false },
    ])
  })

  it('un ** sin cerrar se deja visible, no se descarta', () => {
    expect(tramosDeLinea('precio **total')).toEqual([{ texto: 'precio **total', negrita: false }])
  })
})
