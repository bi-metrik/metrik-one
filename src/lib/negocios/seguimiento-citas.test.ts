import { describe, expect, it } from 'vitest'
import {
  bloquesDeDocsRequeridos,
  docsFaltantes,
  evaluarAtencionCita,
  leerSeguimientoCitas,
  textoAtencionCita,
  type DocRequerido,
} from './seguimiento-citas'
import { diaDeFechaHora, horasHastaFechaHora } from './fecha-hora-campo'

const HOY = '2026-09-09'

/** El config tal como queda en `workspaces.config_extra` de SOENA. */
const CONFIG_SOENA = {
  seguimiento_citas: {
    horas_alerta: 36,
    docs_requeridos: [
      {
        bloque: 'Certificado bancario',
        etiqueta: 'certificado bancario',
        solo_si: {
          bloque: 'Devolución de IVA',
          campo: 'requiere_devolucion_iva',
          valor: 'true',
        },
      },
    ],
  },
}

const DOCS = leerSeguimientoCitas(CONFIG_SOENA)!.docs_requeridos
const sinValores = () => null
const conIva = (v: string) => (bloque: string, campo: string) =>
  bloque === 'Devolución de IVA' && campo === 'requiere_devolucion_iva' ? v : null

describe('leerSeguimientoCitas', () => {
  it('lee el config de SOENA completo', () => {
    const cfg = leerSeguimientoCitas(CONFIG_SOENA)
    expect(cfg).toEqual({
      horas_alerta: 36,
      docs_requeridos: [
        {
          bloque: 'Certificado bancario',
          etiqueta: 'certificado bancario',
          solo_si: {
            bloque: 'Devolución de IVA',
            campo: 'requiere_devolucion_iva',
            valor: 'true',
          },
        },
      ],
    })
  })

  it('admite la forma corta: solo el nombre del bloque', () => {
    const cfg = leerSeguimientoCitas({ seguimiento_citas: { docs_requeridos: ['RUT'] } })
    expect(cfg).toEqual({ horas_alerta: 36, docs_requeridos: [{ bloque: 'RUT' }] })
  })

  it('un umbral inservible cae al de 36 h, no a cero', () => {
    // Un `horas_alerta: 0` o basura apagaria la marca en silencio, que es peor que
    // usar el umbral acordado.
    for (const h of [0, -5, 'pronto', null]) {
      const cfg = leerSeguimientoCitas({ seguimiento_citas: { horas_alerta: h, docs_requeridos: ['RUT'] } })
      expect(cfg?.horas_alerta).toBe(36)
    }
  })

  it('sin config, con config vacio o sin documentos devuelve null: el workspace no participa', () => {
    expect(leerSeguimientoCitas(null)).toBeNull()
    expect(leerSeguimientoCitas({})).toBeNull()
    expect(leerSeguimientoCitas({ seguimiento_citas: {} })).toBeNull()
    expect(leerSeguimientoCitas({ seguimiento_citas: { docs_requeridos: [] } })).toBeNull()
    expect(leerSeguimientoCitas({ seguimiento_citas: { docs_requeridos: [{ etiqueta: 'x' }] } })).toBeNull()
  })

  it('descarta un solo_si a medias en vez de exigir el documento a ciegas', () => {
    const cfg = leerSeguimientoCitas({
      seguimiento_citas: { docs_requeridos: [{ bloque: 'B', solo_si: { bloque: 'C' } }] },
    })
    expect(cfg?.docs_requeridos[0].solo_si).toBeUndefined()
  })
})

describe('bloquesDeDocsRequeridos', () => {
  it('devuelve los nombres a leer, sin repetir', () => {
    const docs: DocRequerido[] = [{ bloque: 'A' }, { bloque: 'B' }, { bloque: 'A' }]
    expect(bloquesDeDocsRequeridos(docs)).toEqual(['A', 'B'])
  })
})

describe('docsFaltantes', () => {
  it('falta cuando hay instancia del bloque y ninguna esta completa', () => {
    const estados = { 'Certificado bancario': { instancias: 2, completos: 0 } }
    expect(docsFaltantes(DOCS, estados, conIva('true'))).toEqual(['certificado bancario'])
  })

  it('basta UNA instancia completa: el documento puede estar cargado en cualquier copia del bloque', () => {
    const estados = { 'Certificado bancario': { instancias: 4, completos: 1 } }
    expect(docsFaltantes(DOCS, estados, conIva('true'))).toEqual([])
  })

  // ⚠️ Sin esta condicion, el UNICO caso que la marca habria encendido el
  // 9-sep-2026 (V0136: cita ese mismo dia, certificado en `pendiente`) era un
  // falso positivo — ese negocio no pide devolucion de IVA.
  it('no exige un documento que no aplica: solo_si en false lo saca', () => {
    const estados = { 'Certificado bancario': { instancias: 1, completos: 0 } }
    expect(docsFaltantes(DOCS, estados, conIva('false'))).toEqual([])
  })

  it('sin el dato de la condicion tampoco lo exige', () => {
    const estados = { 'Certificado bancario': { instancias: 1, completos: 0 } }
    expect(docsFaltantes(DOCS, estados, sinValores)).toEqual([])
  })

  // Sin instancia del bloque no se puede afirmar que el documento falte: el
  // negocio no llegó a la etapa donde se pide, o el bloque condicional no aplica.
  it('sin ninguna instancia no se declara faltante', () => {
    expect(docsFaltantes(DOCS, {}, conIva('true'))).toEqual([])
    expect(
      docsFaltantes(DOCS, { 'Certificado bancario': { instancias: 0, completos: 0 } }, conIva('true')),
    ).toEqual([])
  })

  it('sin etiqueta se nombra con el bloque, y respeta el orden del config', () => {
    const docs: DocRequerido[] = [{ bloque: 'RUT' }, { bloque: 'Certificado bancario', etiqueta: 'certificado bancario' }]
    const estados = {
      RUT: { instancias: 1, completos: 0 },
      'Certificado bancario': { instancias: 1, completos: 0 },
    }
    expect(docsFaltantes(docs, estados, sinValores)).toEqual(['RUT', 'certificado bancario'])
  })
})

describe('evaluarAtencionCita', () => {
  const evaluar = (fechaCita: string | null, faltantes: string[], ahora: Date) =>
    evaluarAtencionCita({
      diaCita: diaDeFechaHora(fechaCita),
      horasHastaLaCita: horasHastaFechaHora(fechaCita, ahora),
      faltantes,
      horasAlerta: 36,
      hoy: HOY,
    })

  // 9-sep 10:00 en Bogotá = 15:00 UTC.
  const AHORA = new Date('2026-09-09T15:00:00Z')
  const FALTA = ['certificado bancario']

  it('enciende con documento faltante y la cita DENTRO del umbral', () => {
    // 10-sep 14:00 son 28 h después de las 10:00 del 9.
    expect(evaluar('2026-09-10T14:00', FALTA, AHORA)).toEqual({
      docs: ['certificado bancario'],
      horas: 28,
    })
  })

  it('no enciende con la cita FUERA del umbral', () => {
    // 11-sep 07:00 son 45 h.
    expect(evaluar('2026-09-11T07:00', FALTA, AHORA)).toBeNull()
  })

  it('el filo del umbral entra, la hora siguiente no', () => {
    expect(evaluar('2026-09-10T22:00', FALTA, AHORA)).not.toBeNull() // 36 h justas
    expect(evaluar('2026-09-10T23:00', FALTA, AHORA)).toBeNull() // 37 h
  })

  it('no enciende sin fecha de cita', () => {
    expect(evaluar(null, FALTA, AHORA)).toBeNull()
    expect(evaluar('', FALTA, AHORA)).toBeNull()
    expect(evaluar('por confirmar', FALTA, AHORA)).toBeNull()
  })

  it('no enciende si no falta ningun documento, por encima la cita que esté', () => {
    expect(evaluar('2026-09-09T11:00', [], AHORA)).toBeNull()
  })

  // ⚠️ Es la razon por la que la ventana se cierra por DIA y no por horas. Un valor
  // heredado de solo dia cuenta como medianoche: con el corte por horas, la cita
  // de HOY apagaria la marca a las 00:01 de ese mismo dia.
  it('una cita de HOY sigue encendida aunque las horas ya sean negativas', () => {
    const a = evaluar('2026-09-09T08:00', FALTA, AHORA)
    expect(a?.horas).toBe(-2)
    expect(evaluar('2026-09-09', FALTA, AHORA)?.horas).toBe(-10)
  })

  it('se apaga sola cuando la cita queda en un dia anterior', () => {
    expect(evaluar('2026-09-08T23:59', FALTA, AHORA)).toBeNull()
    expect(evaluar('2026-08-06', FALTA, AHORA)).toBeNull()
  })

  it('un umbral mas ancho alcanza citas mas lejanas', () => {
    const args = {
      diaCita: '2026-09-11',
      horasHastaLaCita: 45,
      faltantes: FALTA,
      hoy: HOY,
    }
    expect(evaluarAtencionCita({ ...args, horasAlerta: 36 })).toBeNull()
    expect(evaluarAtencionCita({ ...args, horasAlerta: 48 })).not.toBeNull()
  })
})

describe('textoAtencionCita', () => {
  it('dice QUE falta y CUANTO queda, no solo el color', () => {
    expect(textoAtencionCita({ docs: ['certificado bancario'], horas: 20.4 })).toBe(
      'Atención inmediata: falta certificado bancario, cita en 20 h',
    )
  })

  it('con la cita encima no inventa horas', () => {
    expect(textoAtencionCita({ docs: ['certificado bancario'], horas: -2 })).toBe(
      'Atención inmediata: falta certificado bancario, la cita es hoy',
    )
  })

  it('enumera varios documentos en castellano', () => {
    expect(textoAtencionCita({ docs: ['RUT', 'certificado bancario'], horas: 5 })).toBe(
      'Atención inmediata: faltan RUT y certificado bancario, cita en 5 h',
    )
    expect(textoAtencionCita({ docs: ['a', 'b', 'c'], horas: 5 })).toBe(
      'Atención inmediata: faltan a, b y c, cita en 5 h',
    )
  })
})
