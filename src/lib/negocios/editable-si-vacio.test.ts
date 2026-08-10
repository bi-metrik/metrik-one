import { describe, it, expect } from 'vitest'
import { soloLecturaPorDatoLleno } from './editable-si-vacio'

// La topología real (SOENA): el bloque "Fecha cita DIAN" de Notificación es una copia
// compartida del de Cita. En la vía `agenda` la fecha ya viene puesta; en `pqrs` viene
// vacía y la registra el comercial cuando el cliente le reporta la fecha que eligió.
const FECHA_CITA = {
  editable_solo_si_vacio: true,
  fields: [{ slug: 'fecha_cita_dian', tipo: 'fecha', required: true, label: 'Fecha de la cita DIAN' }],
}

describe('soloLecturaPorDatoLleno', () => {
  it('el dato ya viene de la etapa anterior → solo lectura', () => {
    expect(soloLecturaPorDatoLleno(FECHA_CITA, { fecha_cita_dian: '2026-08-21' })).toBe(true)
  })

  it('el dato viene vacío → editable, para poder registrarlo aquí', () => {
    expect(soloLecturaPorDatoLleno(FECHA_CITA, {})).toBe(false)
  })

  it('cadena vacía NO cuenta como dato puesto', () => {
    expect(soloLecturaPorDatoLleno(FECHA_CITA, { fecha_cita_dian: '' })).toBe(false)
  })

  it('sin instancia todavía (data null) → editable', () => {
    expect(soloLecturaPorDatoLleno(FECHA_CITA, null)).toBe(false)
  })

  it('sin la marca no cambia nada, aunque el dato esté lleno', () => {
    const sinMarca = { fields: FECHA_CITA.fields }
    expect(soloLecturaPorDatoLleno(sinMarca, { fecha_cita_dian: '2026-08-21' })).toBe(false)
  })

  it('con varios campos requeridos exige TODOS: uno vacío deja el bloque editable', () => {
    const cfg = {
      editable_solo_si_vacio: true,
      fields: [
        { slug: 'fecha', tipo: 'fecha', required: true },
        { slug: 'hora', tipo: 'texto', required: true },
      ],
    }
    expect(soloLecturaPorDatoLleno(cfg, { fecha: '2026-08-21' })).toBe(false)
    expect(soloLecturaPorDatoLleno(cfg, { fecha: '2026-08-21', hora: '9:00' })).toBe(true)
  })

  it('los campos NO requeridos no deciden: solo cuentan los obligatorios', () => {
    const cfg = {
      editable_solo_si_vacio: true,
      fields: [
        { slug: 'fecha', tipo: 'fecha', required: true },
        { slug: 'nota', tipo: 'texto' },
      ],
    }
    expect(soloLecturaPorDatoLleno(cfg, { fecha: '2026-08-21' })).toBe(true)
  })

  it('sin campos requeridos declarados se queda editable (lado seguro)', () => {
    const cfg = { editable_solo_si_vacio: true, fields: [{ slug: 'nota', tipo: 'texto' }] }
    expect(soloLecturaPorDatoLleno(cfg, { nota: 'algo' })).toBe(false)
  })

  it('tolera config nula', () => {
    expect(soloLecturaPorDatoLleno(null, { fecha_cita_dian: '2026-08-21' })).toBe(false)
  })
})
