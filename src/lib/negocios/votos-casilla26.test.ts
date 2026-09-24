/**
 * La casilla 26 del RUT contra la casilla 5, con la configuración REAL de SOENA (la de la
 * migración 20260925050000, no una copia) y los valores de los respaldos del 24-sep.
 *
 * - V0326, V0354, V0361: la IA pegó un dígito de más al final de la casilla 26 y el NIT
 *   de la casilla 5 estaba bien. Con el código anterior el voto los daba por «acuerdo»
 *   (uno empieza por el otro = el mismo número). Tienen que salir dudosos y negar la
 *   generación de documentos para la DIAN, proponiendo el valor de la casilla 5.
 * - V0012: cédula 1015442918 y NIT 700004389 (asignado antes de la cédula). Números del
 *   todo distintos: aviso que no frena ni niega. Nunca un bloqueo.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { calcularDvNit } from '@/lib/dian/nit'
import { cumpleCondicion } from './condicion-bloque'
import type { ContextoFuentes } from './fuentes-negocio'
import { decidirVoto, evaluarVotos, leerVotos, mismoValor, type LecturaFuente } from './votos'

const SQL = readFileSync(join(process.cwd(), 'supabase/migrations/20260925050000_soena_rut_casilla26_vs_casilla5.sql'), 'utf8')
const VOTOS_CRUDOS = JSON.parse(/\$votos\$([\s\S]*?)\$votos\$/.exec(SQL)![1]) as Array<{ fuentes: unknown[] }>
const VOTOS = leerVotos({ votos: VOTOS_CRUDOS })

const CONDICION_BLOQUE: Record<string, Record<string, unknown> | null> = {
  tipo_de_solicitante: null,
  titularidad: { field: 'tipo_persona', value: 'natural', source_bloque_slug: 'tipo_de_solicitante' },
  servicio_contratado: null,
  rut: { field: 'tipo_persona', value: 'natural', source_bloque_slug: 'tipo_de_solicitante' },
  rut_solicitante_2: { field: 'modalidad_solicitante', value: 'copropiedad', source_bloque_slug: 'titularidad' },
  factura_venta_vehiculo: null,
  concepto_upme: null,
  concepto_upme_anexos: { field: 'servicio', value: 'solo_iva', source_bloque_slug: 'servicio_contratado' },
}
function ctx(porSlug: Record<string, Record<string, unknown>>): ContextoFuentes {
  const evaluar = async (c: Record<string, unknown>) => cumpleCondicion(c as never, { porSlug, porEtapaOrden: {} })
  return {
    porSlug,
    evaluar,
    aplica: async slug => {
      if (!(slug in CONDICION_BLOQUE) || !porSlug[slug]) return false
      const c = CONDICION_BLOQUE[slug]
      return c ? evaluar(c) : true
    },
    etiqueta: () => null,
  }
}

const UNICO = { tipo_de_solicitante: { tipo_persona: 'natural' }, titularidad: { modalidad_solicitante: 'unico' }, servicio_contratado: { servicio: 'completo' } }
const CC = 'Cédula de Ciudadanía'
// Valores de `backup_correccion_casilla26_digito_extra_20260924` (medidos el 24-sep).
const V0326 = { ...UNICO, rut: { razon_social: 'HURTADO MORENO ANGELA MARIA', nit: '52023852', dv: '7', numero_identificacion: '520238523', tipo_documento: CC } }
const V0354 = { ...UNICO, rut: { razon_social: 'PEREZ GOMEZ CARLOS', nit: '16839425', dv: calcularDvNit('16839425')!, numero_identificacion: '168394259', tipo_documento: CC } }
const V0361 = {
  ...UNICO,
  rut: { razon_social: 'RUIZ LOPEZ MARTHA', nit: '39785308', dv: calcularDvNit('39785308')!, numero_identificacion: '397853081', tipo_documento: CC },
  // La factura imprime el NIT con su DV pegado: eso SÍ es el mismo número.
  factura_venta_vehiculo: { compradores: `MARTHA RUIZ LOPEZ (39785308${calcularDvNit('39785308')})` },
  concepto_upme: { nombre_certificado: 'RUIZ LOPEZ MARTHA', numero_identificacion_certificado: '39785308' },
}
const V0012 = {
  ...UNICO,
  rut: { razon_social: 'GARCIA DIAZ LAURA', nit: '700004389', dv: calcularDvNit('700004389')!, numero_identificacion: '1015442918', tipo_documento: CC },
  factura_venta_vehiculo: { compradores: 'LAURA GARCIA DIAZ (1015442918)' },
}

describe('la casilla 26 con dígitos de más frente a la casilla 5', () => {
  it('V0326 solo con el RUT: el empate lo gana la casilla 5, la 26 queda dudosa y niega generar', async () => {
    const [r] = await evaluarVotos(VOTOS, ctx(V0326), 16)
    expect(r.estado).toBe('dudosa')
    expect(r.valor).toBe('52023852')
    const d = r.fuentes.find(f => f.estado === 'dudosa')!
    expect([d.etiqueta, d.valor, d.forma]).toEqual(['RUT (casilla 26)', '520238523', 'digitos_de_mas'])
    expect(r.fuentes.find(f => f.etiqueta === 'RUT (casilla 5)')?.estado).toBe('coincide')
    expect(r.niega_generacion).toBe(true)
    expect(r.mensaje).toContain('un dígito de más')
    expect(r.avisos).toEqual([])
  })

  it('V0354 igual, y frena en Documentación', async () => {
    const [r] = await evaluarVotos(VOTOS, ctx(V0354), 6)
    expect(r.valor).toBe('16839425')
    expect(r.fuentes.find(f => f.estado === 'dudosa')?.valor).toBe('168394259')
    expect(r.bloquea).toBe(true)
    expect(r.niega_generacion).toBe(true)
  })

  it('V0361 con factura (NIT con su DV) y certificado: mayoría clara, la factura coincide', async () => {
    const [r] = await evaluarVotos(VOTOS, ctx(V0361), 19)
    expect(r.estado).toBe('dudosa')
    expect(r.valor).toBe('39785308')
    expect(r.fuentes.filter(f => f.estado === 'dudosa').map(f => f.etiqueta)).toEqual(['RUT (casilla 26)'])
    expect(r.fuentes.find(f => f.etiqueta === 'Factura')?.forma).toBe('dv_pegado')
    expect(r.niega_generacion).toBe(true)
  })

  it('corregido (26 = 5), acuerdo sin avisos', async () => {
    const [r] = await evaluarVotos(VOTOS, ctx({ ...V0326, rut: { ...V0326.rut, numero_identificacion: '52023852' } }), 16)
    expect(r.estado).toBe('acuerdo')
    expect(r.avisos).toEqual([])
  })
})

describe('V0012: cédula y NIT del todo distintos', () => {
  it('aviso que no frena ni niega; la casilla 5 no vota', async () => {
    for (const orden of [6, 9, 18]) {
      const [r] = await evaluarVotos(VOTOS, ctx(V0012), orden)
      expect(r.estado).toBe('acuerdo')
      expect(r.valor).toBe('1015442918')
      expect(r.bloquea).toBe(false)
      expect(r.niega_generacion).toBe(false)
      expect(r.fuentes.find(f => f.etiqueta === 'RUT (casilla 5)')?.estado).toBe('distinta')
      expect(r.avisos).toHaveLength(1)
      expect(r.avisos[0]).toContain('700004389')
      expect(r.avisos[0]).toContain('No frena')
    }
  })

  it('solo con el RUT, tampoco frena', async () => {
    const [r] = await evaluarVotos(VOTOS, ctx({ ...UNICO, rut: V0012.rut }), 6)
    expect(r.estado).toBe('sin_contraste')
    expect(r.bloquea).toBe(false)
    expect(r.niega_generacion).toBe(false)
    expect(r.avisos).toHaveLength(1)
  })
})

describe('otros tipos de documento y el segundo titular', () => {
  it('cédula de extranjería: la casilla 5 no se compara (ni aviso)', async () => {
    const ce = { ...UNICO, rut: { ...V0326.rut, tipo_documento: 'Cédula de Extranjería', nit: '700422924', numero_identificacion: '520238523' } }
    const [r] = await evaluarVotos(VOTOS, ctx(ce), 6)
    expect(r.fuentes.map(f => f.etiqueta)).not.toContain('RUT (casilla 5)')
    expect(r.avisos).toEqual([])
  })

  it('RUT sin casilla 25 leída: cruza igual (el hueco no deja pasar el dígito de más)', async () => {
    const sinTipo = { ...UNICO, rut: { ...V0326.rut, tipo_documento: '' } }
    const [r] = await evaluarVotos(VOTOS, ctx(sinTipo), 6)
    expect(r.estado).toBe('dudosa')
    expect(r.valor).toBe('52023852')
  })

  it('el segundo titular también cruza su casilla 26 contra su casilla 5', async () => {
    const copro = {
      tipo_de_solicitante: { tipo_persona: 'natural' },
      titularidad: { modalidad_solicitante: 'copropiedad' },
      servicio_contratado: { servicio: 'completo' },
      rut: { razon_social: 'A B C', nit: '80180688', numero_identificacion: '80180688', tipo_documento: CC },
      rut_solicitante_2: { razon_social: 'D E F', nit: '39785308', numero_identificacion: '397853081' },
    }
    const rs = await evaluarVotos(VOTOS, ctx(copro), 9)
    const r2 = rs.find(r => r.slug === 'documento_titular_2')!
    expect(r2.estado).toBe('dudosa')
    expect(r2.valor).toBe('39785308')
    expect(r2.niega_generacion).toBe(true)
    expect(r2.bloquea).toBe(true)
  })

  it('la migración marca las dos casillas 5 como testigo, y nada se descartó al leerla', () => {
    expect(VOTOS.map(v => v.fuentes.length)).toEqual(VOTOS_CRUDOS.map(v => v.fuentes.length))
    const testigos = VOTOS.flatMap(v => v.fuentes.filter(f => f.testigo).map(f => f.etiqueta))
    expect(testigos).toEqual(['RUT (casilla 5)', 'RUT 2 (casilla 5)'])
  })
})

describe('piezas', () => {
  it('mismoValor: el DV de verdad pegado es el mismo número; un dígito cualquiera no', () => {
    expect(mismoValor('520238523', '52023852')).toBe(false)
    expect(mismoValor('520238527', '52023852')).toBe(true) // 7 es el DV de 52023852
    expect(mismoValor('1380180688', '80180688')).toBe(true) // el «13» lo sigue viendo el voto
    expect(mismoValor('52023852', '52023852')).toBe(true)
  })

  const leida = (clave: string, valor: string, testigo = false): Omit<LecturaFuente, 'estado' | 'forma'> => ({
    clave, etiqueta: clave, bloque_slug: 'rut', field: clave, persona: null, valor,
    verificada: false, editada_por: null, dv_invalido: false, archivo: null, alimenta_generacion: true, testigo,
  })
  const V = { slug: 'v', label: 'V', niega_generacion: true }

  it('sin testigo, un empate con dígitos de más es revisión manual (antes era «acuerdo»)', () => {
    const r = decidirVoto(V, [leida('26', '520238523'), leida('5', '52023852')], null)!
    expect(r.estado).toBe('manual')
    expect(r.niega_generacion).toBe(true)
  })

  it('el testigo no gana un empate contra un número distinto: no vota y avisa', () => {
    const r = decidirVoto(V, [leida('26', '52023853'), leida('5', '52023852', true)], null)!
    expect(r.estado).toBe('sin_contraste')
    expect(r.avisos).toHaveLength(1)
    expect(r.niega_generacion).toBe(false)
  })

  it('el testigo no desempata si hay un tercer grupo del mismo tamaño', () => {
    const r = decidirVoto(V, [leida('26', '520238523'), leida('5', '52023852', true), leida('f', '52023853')], null)!
    expect(r.estado).toBe('manual')
  })
})
