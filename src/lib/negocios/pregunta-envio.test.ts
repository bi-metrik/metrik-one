/**
 * H33 · «¿Ya se la mandaste?»: cuándo se pregunta, y que descargar el PDF ya no escriba el envío.
 *
 * VISTO FALLAR (2026-10-14), una mutación a la vez:
 *   · `debePreguntarEnvio` sin `if (a.pdfBorrador) return false` → cae «un PDF de borrador no pregunta»;
 *   · sin el `a.estado !== 'borrador'` → cae «una ya enviada no pregunta»;
 *   · volver a poner `envioPorDescarga(...)` en la acción del PDF → cae la guarda del archivo.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { debePreguntarEnvio } from './pregunta-envio'

const base = { pdfBorrador: false, estado: 'borrador', editable: true, viaje: true, seguimiento: false }

describe('debePreguntarEnvio', () => {
  it('cotización de viaje en borrador con PDF limpio: pregunta', () => {
    expect(debePreguntarEnvio(base)).toBe(true)
  })

  it('fuera del viaje, solo con el seguimiento encendido', () => {
    expect(debePreguntarEnvio({ ...base, viaje: false })).toBe(false)
    expect(debePreguntarEnvio({ ...base, viaje: false, seguimiento: true })).toBe(true)
  })

  it('un PDF de borrador (marca de agua) no pregunta: ese documento no se manda', () => {
    expect(debePreguntarEnvio({ ...base, pdfBorrador: true })).toBe(false)
  })

  it('una ya enviada, aprobada o congelada no pregunta', () => {
    expect(debePreguntarEnvio({ ...base, estado: 'enviada' })).toBe(false)
    expect(debePreguntarEnvio({ ...base, estado: 'aceptada' })).toBe(false)
    expect(debePreguntarEnvio({ ...base, editable: false })).toBe(false)
  })
})

describe('la descarga del PDF no registra el envío', () => {
  const fuente = readFileSync(path.resolve(__dirname, '../../app/(app)/negocios/cotizacion-pdf-actions.ts'), 'utf8')

  it('la acción del PDF no llama al registro del envío ni escribe fecha_envio', () => {
    expect(fuente).not.toMatch(/seguimiento-datos/)
    expect(fuente).not.toMatch(/registrarEnvio|envioPorDescarga/)
    expect(fuente).not.toMatch(/fecha_envio\s*:\s*new Date/)
  })
})
