import { describe, expect, it } from 'vitest'
import { agruparRepositorio, carpetaRelativa, claveSubcarpeta, formatearTamano } from './repositorio'

const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const OTRO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const p = (resto: string) => `negocios/${NEG}/${resto}`
const a = (resto: string, bytes = 100) => ({ path: p(resto), bytes, actualizado: '2026-09-14T20:00:00Z', mime: 'application/pdf' })

// Lo que declara la línea "Viaje a medida" (medido en producción el 2026-09-14).
const DECLARADAS = [
  '1. Cotización',
  '1. Cotización',
  '2. Legal',
  '3. Cobros',
  '4. Reservas',
  '5. Documentos del viajero',
]

describe('agruparRepositorio', () => {
  it('las subcarpetas de la línea se ven aunque estén vacías, con su nombre legible y en orden', () => {
    const grupos = agruparRepositorio(NEG, [], DECLARADAS)
    expect(grupos.map(g => g.etiqueta)).toEqual([
      '1. Cotización', '2. Legal', '3. Cobros', '4. Reservas', '5. Documentos del viajero',
    ])
    expect(grupos.every(g => g.archivos.length === 0)).toBe(true)
  })

  it('cada archivo cae en la subcarpeta declarada aunque la clave de Storage vaya sin tildes', () => {
    const grupos = agruparRepositorio(NEG, [a('5-documentos-del-viajero/pasaporte-y-visado.pdf'), a('1-cotizacion/itinerario-propuesto.pdf')], DECLARADAS)
    const viajero = grupos.find(g => g.etiqueta === '5. Documentos del viajero')!
    expect(viajero.archivos.map(x => x.nombre)).toEqual(['pasaporte-y-visado.pdf'])
    expect(viajero.archivos[0].referencia).toBe(`sbext://one-documentos/${p('5-documentos-del-viajero/pasaporte-y-visado.pdf')}`)
    expect(grupos.find(g => g.etiqueta === '1. Cotización')!.archivos).toHaveLength(1)
  })

  it('lo que escribe el servidor sin declararlo tiene nombre propio; lo desconocido se lee; la raíz va al final', () => {
    const grupos = agruparRepositorio(
      NEG,
      [a('cotizaciones/cot-2026-0012.pdf'), a('otros-soportes/x.pdf'), a('suelto.pdf'), a('1-legal/propuestas/propuesta-v1.pdf')],
      DECLARADAS,
    )
    expect(grupos.map(g => g.etiqueta)).toEqual([
      '1. Cotización', '1. Legal / Propuestas', '2. Legal', '3. Cobros', '4. Reservas',
      '5. Documentos del viajero', 'Cotizaciones', 'Otros soportes', 'Sin subcarpeta',
    ])
  })

  it('una subida pendiente no aparece, ni un archivo de otro negocio', () => {
    const grupos = agruparRepositorio(
      NEG,
      [a('_pendientes/bloque-1757880000000.pdf'), { ...a('x.pdf'), path: `negocios/${OTRO}/2-legal/contrato.pdf` }],
      [],
    )
    expect(grupos).toEqual([])
  })

  it('orden natural dentro del grupo (v2 antes que v10)', () => {
    const grupos = agruparRepositorio(NEG, [a('cotizaciones/v10.pdf'), a('cotizaciones/v2.pdf')], [])
    expect(grupos[0].archivos.map(x => x.nombre)).toEqual(['v2.pdf', 'v10.pdf'])
  })
})

describe('auxiliares', () => {
  it('claveSubcarpeta normaliza igual que la ruta de subida', () => {
    expect(claveSubcarpeta('1. Legal/Propuestas')).toBe('1-legal/propuestas')
    expect(claveSubcarpeta('5. Documentos del viajero')).toBe('5-documentos-del-viajero')
  })

  it('carpetaRelativa', () => {
    expect(carpetaRelativa(p('a/b/c.pdf'), NEG)).toBe('a/b')
    expect(carpetaRelativa(p('c.pdf'), NEG)).toBe('')
    expect(carpetaRelativa(`negocios/${OTRO}/c.pdf`, NEG)).toBeNull()
  })

  it('formatearTamano', () => {
    expect(formatearTamano(812)).toBe('812 B')
    expect(formatearTamano(340 * 1024)).toBe('340 KB')
    expect(formatearTamano(1.25 * 1024 * 1024)).toBe('1,3 MB')
    expect(formatearTamano(null)).toBe('—')
  })
})
