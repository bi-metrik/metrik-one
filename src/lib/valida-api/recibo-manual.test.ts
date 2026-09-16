import { describe, expect, it } from 'vitest'
import { marcaReciboManual, nombreDescargaRecibo, problemaCargaRecibo, rutaRecibo } from './recibo-manual'

const PDF = { nombre: 'RC-2026-09-001.pdf', tipo: 'application/pdf', tamano: 120_000 }

describe('problemaCargaRecibo', () => {
  it('una carga completa no tiene problema', () => {
    expect(problemaCargaRecibo('RC-2026-09-001', PDF)).toBeNull()
  })

  it('sin número, sin archivo, sin PDF o muy pesado, se nombra el motivo', () => {
    expect(problemaCargaRecibo('  ', PDF)).toBe('Falta el número del recibo')
    expect(problemaCargaRecibo('RC-1', null)).toBe('Falta el PDF del recibo')
    expect(problemaCargaRecibo('RC-1', { ...PDF, nombre: 'r.png', tipo: 'image/png' })).toBe('El recibo tiene que ser un PDF')
    expect(problemaCargaRecibo('RC-1', { ...PDF, tamano: 11 * 1024 * 1024 })).toBe('El PDF pesa más de 10 MB')
  })
})

describe('marcaReciboManual', () => {
  const marca = marcaReciboManual({
    numero: ' RC-2026-09-001 ',
    valor: 1_400_000,
    workspaceId: 'ws-metrik',
    sha256: 'a'.repeat(64),
    ahoraIso: '2026-09-16T15:00:00.000Z',
    por: 'Diana',
  })

  it('deja el número que cuenta el control de recibos', () => {
    // `/conciliacion` decide `con_recibo` por `siigo_recibo.numero`.
    expect(marca.numero).toBe('RC-2026-09-001')
  })

  it('nunca guarda un enlace público: archivo_url en null y el PDF en el bucket privado', () => {
    expect(marca.archivo_url).toBeNull()
    expect(marca.storage_bucket).toBe('documentos-servicio')
    expect(marca.storage_path).toBe(rutaRecibo('ws-metrik', 'a'.repeat(64)))
    expect(marca.storage_path).not.toMatch(/drive\.google|https?:/)
  })

  it('la ruta no revela el número ni el cliente', () => {
    expect(marca.storage_path).not.toContain('RC-2026')
  })
})

describe('nombreDescargaRecibo', () => {
  it('usa el número, sin caracteres que rompan el nombre', () => {
    expect(nombreDescargaRecibo('RC 2026/09 001')).toBe('RC-2026-09-001.pdf')
    expect(nombreDescargaRecibo(null)).toBe('recibo.pdf')
  })
})
