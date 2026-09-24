/**
 * El voto entre fuentes, contra los casos que lo motivaron (SOENA, medidos en producción
 * el 2026-09-24). Los datos de cada caso son los que guarda la base: el RUT con sus dos
 * casillas (5 y 26), la factura con su lista de compradores y el certificado UPME con
 * sus pares nombre/documento.
 */
import { describe, expect, it } from 'vitest'
import { calcularDvNit } from '@/lib/dian/nit'
import { decidirVoto, evaluarVotos, leerVotos, mismaPersona, slugsDeVotos, validaConDv, type Voto } from './votos'
import type { ContextoFuentes } from './fuentes-negocio'

const CEDULA = { field: 'tipo_documento', value_in: ['Cédula de Ciudadanía'] }

/** Un voto con la forma que usará SOENA (la config real viaja en su migración). */
const VOTO: Voto = {
  slug: 'documento_titular',
  label: 'Documento del titular',
  nombre: { source_bloque_slug: 'rut', field: 'razon_social' },
  bloquea_en_etapas: [6, 9],
  niega_generacion: true,
  fuentes: [
    { etiqueta: 'RUT (casilla 26)', source_bloque_slug: 'rut', field: 'numero_identificacion', alimenta_generacion: true },
    { etiqueta: 'RUT (casilla 5)', source_bloque_slug: 'rut', field: 'nit', si: CEDULA, dv: 'dv', alimenta_generacion: true },
    { etiqueta: 'Factura', source_bloque_slug: 'factura_venta_vehiculo', lista: 'compradores' },
    {
      etiqueta: 'Certificado UPME',
      source_bloque_slug: 'concepto_upme_anexos',
      alternativas: ['concepto_upme'],
      personas: [
        { nombre: 'nombre_certificado', documento: 'numero_identificacion_certificado' },
        { nombre: 'nombre_certificado_2', documento: 'numero_identificacion_certificado_2' },
      ],
    },
  ],
}

type Campos = Record<string, string | { value: string; edicion?: { editado_por_nombre: string }; leido?: string }>

/** Un bloque de documento como lo guarda la base: `campos` anidado y aplanado a la vez. */
function doc(campos: Campos, archivo = 'https://drive/x'): Record<string, unknown> {
  const anidado: Record<string, unknown> = {}
  const plano: Record<string, unknown> = { drive_url: archivo }
  for (const [k, v] of Object.entries(campos)) {
    const c = typeof v === 'string' ? { value: v } : v
    anidado[k] = { confidence: 0.98, manual: false, ...c }
    plano[k] = c.value
  }
  return { ...plano, campos: anidado }
}

const NO_APLICA = new Set(['concepto_upme_anexos'])
function ctx(porSlug: Record<string, Record<string, unknown>>, noAplica = NO_APLICA): ContextoFuentes {
  return {
    porSlug,
    aplica: async s => !noAplica.has(s) && s in porSlug,
    evaluar: async () => true,
    etiqueta: () => null,
  }
}

// V0142: el RUT leyó la casilla 26 como 1022424289; la 5, la factura y el certificado dicen …269.
const V0142 = {
  rut: doc({ razon_social: 'BENAVIDES MORENO SANTIAGO', nit: '1022424269', dv: '5', numero_identificacion: '1022424289', tipo_documento: 'Cédula de Ciudadanía' }, 'drive://rut-v0142'),
  factura_venta_vehiculo: doc({ compradores: 'SANTIAGO BENAVIDES MORENO (1022424269)' }),
  concepto_upme: doc({ nombre_certificado: 'BENAVIDES MORENO SANTIAGO', numero_identificacion_certificado: '1022424269' }),
}
// V0355: la misma falla, un dígito en la casilla 26.
const V0355 = {
  rut: doc({ razon_social: 'PATIÑO PIRACOCA FERNANDO', nit: '7177453', dv: '9', numero_identificacion: '7177463', tipo_documento: 'Cédula de Ciudadanía' }),
  factura_venta_vehiculo: doc({ compradores: 'FERNANDO PATIÑO PIRACOCA (7177453)' }),
  concepto_upme: doc({ nombre_certificado: 'PATIÑO PIRACOCA FERNANDO', numero_identificacion_certificado: '7177453' }),
}
// V0164: el RUT y la factura dicen 7184935; el certificado, 71884935 (lectura o emisión).
const V0164 = {
  rut: doc({ razon_social: 'GOMEZ RESTREPO CARLOS', nit: '7184935', dv: '4', numero_identificacion: '7184935', tipo_documento: 'Cédula de Ciudadanía' }),
  factura_venta_vehiculo: doc({ compradores: 'CARLOS GOMEZ RESTREPO (7184935)' }),
  concepto_upme: doc({ nombre_certificado: 'GOMEZ RESTREPO CARLOS', numero_identificacion_certificado: '71884935' }, 'drive://cert-v0164'),
}
// V0286: copropiedad, todo coherente; el certificado lista a las dos personas en otro orden.
const V0286 = {
  rut: doc({ razon_social: 'CASTRILLON CASTAÑO ARLEY GIOVANNI', nit: '3556837', dv: '1', numero_identificacion: '3556837', tipo_documento: 'Cédula de Ciudadanía' }),
  factura_venta_vehiculo: doc({ compradores: 'ISABEL CRISTINA SALAZAR HERRERA (43448996); ARLEY GIOVANNI CASTRILLON CASTAÑO (3556837)' }),
  concepto_upme: doc({
    nombre_certificado: 'SALAZAR HERRERA ISABEL CRISTINA', numero_identificacion_certificado: '43448996',
    nombre_certificado_2: 'CASTRILLON CASTAÑO ARLEY GIOVANNI', numero_identificacion_certificado_2: '3556837',
  }),
}

async function votar(porSlug: Record<string, Record<string, unknown>>, etapa: number | null = null) {
  const [r] = await evaluarVotos([VOTO], ctx(porSlug), etapa)
  return r
}

describe('voto entre fuentes: los casos del 24-sep', () => {
  it('V0142: la casilla 26 del RUT es la lectura dudosa, el voto propone 1022424269 y niega generar', async () => {
    const r = await votar(V0142, 9)
    expect(r.estado).toBe('dudosa')
    expect(r.valor).toBe('1022424269')
    const dudosas = r.fuentes.filter(f => f.estado === 'dudosa')
    expect(dudosas.map(f => [f.etiqueta, f.valor])).toEqual([['RUT (casilla 26)', '1022424289']])
    expect(dudosas[0].archivo).toBe('drive://rut-v0142')
    expect(r.niega_generacion).toBe(true)
    expect(r.bloquea).toBe(true)
    expect(r.mensaje).toContain('RUT (casilla 26) (1022424289)')
    expect(r.mensaje).toContain('1022424269')
  })

  it('V0355: igual, con 7177453', async () => {
    const r = await votar(V0355)
    expect(r.estado).toBe('dudosa')
    expect(r.valor).toBe('7177453')
    expect(r.fuentes.find(f => f.estado === 'dudosa')?.valor).toBe('7177463')
    expect(r.niega_generacion).toBe(true)
  })

  it('V0164: en disputa con el certificado como minoritario; no niega generar (no alimenta documentos)', async () => {
    const r = await votar(V0164)
    expect(r.estado).toBe('dudosa')
    expect(r.valor).toBe('7184935')
    const dudosa = r.fuentes.find(f => f.estado === 'dudosa')
    expect(dudosa?.etiqueta).toBe('Certificado UPME')
    expect(dudosa?.field).toBe('numero_identificacion_certificado')
    expect(r.niega_generacion).toBe(false)
  })

  it('V0286 (copropiedad, coherente): acuerdo, sin aviso', async () => {
    const r = await votar(V0286, 9)
    expect(r.estado).toBe('acuerdo')
    expect(r.mensaje).toBeNull()
    expect(r.bloquea).toBe(false)
    expect(r.niega_generacion).toBe(false)
    // La persona del titular se tomó por nombre, no por posición en la lista.
    expect(r.fuentes.find(f => f.etiqueta === 'Factura')?.persona).toBe(1)
    expect(r.fuentes.find(f => f.etiqueta === 'Certificado UPME')?.field).toBe('numero_identificacion_certificado_2')
  })

  it('fuera de las etapas declaradas avisa pero no frena', async () => {
    expect((await votar(V0142, 13)).bloquea).toBe(false)
    expect((await votar(V0142, null)).bloquea).toBe(false)
  })
})

describe('las reglas del voto', () => {
  it('un dígito distinto NO se tolera, pero el DV pegado y el «13» sí', async () => {
    for (const leido of ['133556837', '35568371']) {
      const pegado = { ...V0286, rut: doc({ razon_social: 'CASTRILLON CASTAÑO ARLEY GIOVANNI', numero_identificacion: leido }) }
      expect((await votar(pegado)).estado, leido).toBe('acuerdo')
    }
    const unDigito = { ...V0286, rut: doc({ razon_social: 'CASTRILLON CASTAÑO ARLEY GIOVANNI', numero_identificacion: '3556887' }) }
    expect((await votar(unDigito)).estado).toBe('dudosa')
  })

  it('un documento de menos de 6 dígitos igual coincide consigo mismo (cédulas de extranjería viejas)', async () => {
    const corto = {
      rut: doc({ razon_social: 'LOPEZ ANA', numero_identificacion: '90611', nit: '700107146', tipo_documento: 'Cédula de Extranjería' }),
      factura_venta_vehiculo: doc({ compradores: 'ANA LOPEZ (417245)' }),
      concepto_upme: doc({ nombre_certificado: 'LOPEZ ANA', numero_identificacion_certificado: '90611' }),
    }
    const r = await votar(corto)
    expect(r.valor).toBe('90611')
    // La casilla 5 de una cédula de extranjería NO vota: su NIT difiere del documento.
    expect(r.fuentes.map(f => f.etiqueta)).not.toContain('RUT (casilla 5)')
    expect(r.fuentes.find(f => f.estado === 'dudosa')?.etiqueta).toBe('Factura')
  })

  it('sin mayoría: revisión manual, sin valor propuesto, y niega generar', async () => {
    const tres = {
      rut: doc({ razon_social: 'PEREZ JUAN', numero_identificacion: '11111111' }),
      factura_venta_vehiculo: doc({ compradores: 'JUAN PEREZ (22222222)' }),
      concepto_upme: doc({ nombre_certificado: 'PEREZ JUAN', numero_identificacion_certificado: '33333333' }),
    }
    const r = await votar(tres)
    expect(r.estado).toBe('manual')
    expect(r.valor).toBeNull()
    expect(r.fuentes.every(f => f.estado === 'en_disputa')).toBe(true)
    expect(r.niega_generacion).toBe(true)
  })

  it('una lectura minoritaria que una persona editó queda confirmada, no dudosa', async () => {
    const confirmada = {
      ...V0164,
      concepto_upme: doc({
        nombre_certificado: 'GOMEZ RESTREPO CARLOS',
        numero_identificacion_certificado: { value: '71884935', edicion: { editado_por_nombre: 'Deisy' } },
      }),
    }
    const r = await votar(confirmada)
    expect(r.estado).toBe('acuerdo')
    const c = r.fuentes.find(f => f.etiqueta === 'Certificado UPME')
    expect(c?.estado).toBe('confirmada')
    expect(c?.editada_por).toBe('Deisy')
  })

  it('la persona se busca por nombre: si nadie coincide, esa fuente no vota', async () => {
    const otro = { ...V0142, factura_venta_vehiculo: doc({ compradores: 'MARIA TORRES (1022424289)' }) }
    const r = await votar(otro)
    expect(r.fuentes.map(f => f.etiqueta)).not.toContain('Factura')
  })

  it('el certificado de Anexos manda sobre el de Certificación cuando le aplica al caso', async () => {
    const porSlug = { ...V0142, concepto_upme_anexos: doc({ nombre_certificado: 'BENAVIDES MORENO SANTIAGO', numero_identificacion_certificado: '1022424269' }, 'drive://anexos') }
    const [r] = await evaluarVotos([VOTO], ctx(porSlug, new Set()), null)
    expect(r.fuentes.find(f => f.etiqueta === 'Certificado UPME')?.archivo).toBe('drive://anexos')
  })

  it('un bloque que no le aplica al caso no vota', async () => {
    const [r] = await evaluarVotos([VOTO], ctx(V0142, new Set(['factura_venta_vehiculo', 'concepto_upme_anexos'])), null)
    expect(r.fuentes.map(f => f.etiqueta)).not.toContain('Factura')
  })

  it('una sola fuente: no hay voto, salvo que su DV la contradiga', async () => {
    const soloRut = { rut: doc({ razon_social: 'X Y', nit: '1022424289', dv: '5', tipo_documento: 'Cédula de Ciudadanía' }) }
    const v: Voto = { ...VOTO, fuentes: [VOTO.fuentes[1]] }
    const [malDv] = await evaluarVotos([v], ctx(soloRut), null)
    expect(malDv.estado).toBe('dudosa')
    expect(malDv.fuentes[0].dv_invalido).toBe(true)
    const bien = { rut: doc({ razon_social: 'X Y', nit: '1022424269', dv: '5', tipo_documento: 'Cédula de Ciudadanía' }) }
    const [ok] = await evaluarVotos([v], ctx(bien), null)
    expect(ok.estado).toBe('sin_contraste')
  })

  it('el DV que LEYÓ la IA (guardado aparte al recalcularlo) es el testigo', async () => {
    const dvCalc = calcularDvNit('1022424289')!
    const rut = { rut: doc({ razon_social: 'X Y', nit: '1022424289', dv: { value: dvCalc, leido: '5' }, tipo_documento: 'Cédula de Ciudadanía' }) }
    const [r] = await evaluarVotos([{ ...VOTO, fuentes: [VOTO.fuentes[1]] }], ctx(rut), null)
    expect(r.fuentes[0].dv_invalido).toBe(true)
  })

  it('sin ninguna fuente con dato, el voto calla', async () => {
    expect(await evaluarVotos([VOTO], ctx({}), null)).toEqual([])
  })

  it('la confianza de la IA no entra: 0.98 en la lectura mala no la salva', async () => {
    const r = await votar(V0142)
    // La fuente dudosa trae 0.98 en la base (ver `doc`) y aun así queda dudosa.
    expect(r.fuentes.find(f => f.etiqueta === 'RUT (casilla 26)')?.estado).toBe('dudosa')
  })
})

describe('piezas', () => {
  it('validaConDv', () => {
    expect(validaConDv('1022424269', '5')).toBe(true)
    expect(validaConDv('1022424289', '5')).toBe(false)
    // DV pegado y prefijo «13» toleran como en mismoDocumento.
    expect(validaConDv('10224242695', '5')).toBe(true)
    expect(validaConDv('131022424269', '5')).toBe(true)
  })

  it('mismaPersona', () => {
    expect(mismaPersona('BENAVIDES MORENO SANTIAGO', 'SANTIAGO BENAVIDES MORENO')).toBe(true)
    expect(mismaPersona('LEON CASTAÑO JUAN BERNANDO', 'LEON CASTAÑO JUAN BERNARDO')).toBe(true)
    // Dos hermanos comparten apellidos y ninguno contiene al otro.
    expect(mismaPersona('GOMEZ PEREZ ANA', 'GOMEZ PEREZ LUIS')).toBe(false)
    expect(mismaPersona('', 'X')).toBe(false)
  })

  it('leerVotos descarta lo mal formado y slugsDeVotos junta todo lo que hay que cargar', () => {
    const votos = leerVotos({ votos: [VOTO, { slug: 'x' }, { slug: 'y', label: 'Y', fuentes: [{ etiqueta: 'A', source_bloque_slug: 'a' }] }] })
    expect(votos.map(v => v.slug)).toEqual(['documento_titular'])
    expect(slugsDeVotos(votos).sort()).toEqual(['concepto_upme', 'concepto_upme_anexos', 'factura_venta_vehiculo', 'rut'])
  })

  it('decidirVoto sin lecturas devuelve null', () => {
    expect(decidirVoto(VOTO, [], null)).toBeNull()
  })
})
