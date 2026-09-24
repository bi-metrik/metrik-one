/**
 * La configuración REAL de SOENA (la de la migración, no una copia) contra casos reales
 * medidos en producción el 2026-09-24: la auditoría de los 28 casos y los datos de V0207,
 * V0151, V0286 y V0142 que pide el brief.
 *
 * El evaluador de condiciones es un doble de `condicion_cumplida` hecho con
 * `cumpleCondicion`: la misma semántica (`value` exacto, `value_in` normalizado) que la
 * función SQL replica del render.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cumpleCondicion } from './condicion-bloque'
import { evaluarCruces, leerCruces, slugsDeCruces } from './cruces'
import { leerConfigDatosClave, resolverDatosClave, slugsDeDatosClave } from './datos-clave'
import type { ContextoFuentes } from './fuentes-negocio'

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260924190000_soena_datos_clave_y_titularidad.sql'),
  'utf8',
)
function bloqueJson(tag: string): unknown {
  const m = SQL.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`))
  if (!m) throw new Error(`la migración no trae el bloque $${tag}$`)
  return JSON.parse(m[1])
}
const CRUCES = leerCruces({ cruces: bloqueJson('cruces') })
const DATOS_CLAVE = leerConfigDatosClave({ datos_clave: bloqueJson('datos_clave') })!

// `condition` de cada bloque en producción (bloque_configs.config_extra.condition).
const CONDICION_BLOQUE: Record<string, Record<string, unknown> | null> = {
  tipo_de_solicitante: null,
  titularidad: { field: 'tipo_persona', value: 'natural', source_bloque_slug: 'tipo_de_solicitante' },
  servicio_contratado: null,
  rut: { field: 'tipo_persona', value: 'natural', source_bloque_slug: 'tipo_de_solicitante' },
  rut_solicitante_2: { field: 'modalidad_solicitante', value: 'copropiedad', source_bloque_slug: 'titularidad' },
  factura_venta_vehiculo: null,
  concepto_upme: null,
  concepto_upme_anexos: { field: 'servicio', value: 'solo_iva', source_bloque_slug: 'servicio_contratado' },
  confirmar_tarifa_upme: null,
  propuesta_economica: null,
  cita_dian_requerida: { field: 'servicio', value: 'solo_iva', source_bloque_slug: 'servicio_contratado' },
  cita_dian_iva: { field: 'servicio', value_in: ['completo', 'solo_iva'], source_bloque_slug: 'servicio_contratado' },
  fecha_cita_dian: { field: 'via_solicitud', value: 'agenda', source_bloque_slug: 'via_solicitud_cita' },
}
const OPCIONES: Record<string, Record<string, string>> = {
  'titularidad.modalidad_solicitante': {
    unico: 'Un solo solicitante',
    copropiedad: 'Copropiedad (dos personas naturales)',
    leasing: 'Leasing (banco co-titular)',
  },
}

function ctx(porSlug: Record<string, Record<string, unknown>>): ContextoFuentes {
  const evaluar = async (c: Record<string, unknown>) => cumpleCondicion(c as never, { porSlug, porEtapaOrden: {} })
  return {
    porSlug,
    evaluar,
    aplica: async slug => {
      if (!(slug in CONDICION_BLOQUE)) return false
      const c = CONDICION_BLOQUE[slug]
      return c ? evaluar(c) : true
    },
    etiqueta: (slug, field, v) => OPCIONES[`${slug}.${field}`]?.[String(v)] ?? null,
  }
}

const NATURAL = { tipo_de_solicitante: { tipo_persona: 'natural' } }
const DOCUMENTACION = 6
const CITA = 16

// V0207 medido: titularidad «unico», certificado a Alvarado, factura a Alvarado + Rodríguez.
const V0207 = {
  ...NATURAL,
  titularidad: { modalidad_solicitante: 'unico' },
  servicio_contratado: { servicio: 'completo' },
  rut: { razon_social: 'ALVARADO BARRUETO LADY MARLENE', numero_identificacion: '1032426193' },
  concepto_upme: { nombre_certificado: 'ALVARADO BARRUETO LADY MARLENE', numero_identificacion_certificado: '1032426193' },
  cita_dian_requerida: { requiere_cita_dian: true },
  factura_venta_vehiculo: { marca: 'BMW' },
}
const V0207_CON_COMPRADORES = {
  ...V0207,
  factura_venta_vehiculo: {
    marca: 'BMW',
    cantidad_compradores: '2',
    compradores: 'LADY MARLENE ALVARADO BARRUETO (1032426193); DIEGO ANDRES RODRIGUEZ ACEVEDO (80798054)',
  },
}
// V0151 medido: copropiedad, RUT 2 cargado, certificado solo a Uribe Estrada.
const V0151 = {
  ...NATURAL,
  titularidad: { modalidad_solicitante: 'copropiedad' },
  servicio_contratado: { servicio: 'completo' },
  rut: { razon_social: 'URIBE ESTRADA JUAN FELIPE', numero_identificacion: '8163544' },
  rut_solicitante_2: { razon_social: 'LOPEZ VELEZ DIANA PATRICIA', numero_identificacion: '43201715' },
  concepto_upme: { nombre_certificado: 'URIBE ESTRADA JUAN FELIPE', numero_identificacion_certificado: '8163544' },
}
// V0286 medido: copropiedad y certificado a las dos personas (en Certificación y en Anexos).
const V0286 = {
  ...NATURAL,
  titularidad: { modalidad_solicitante: 'copropiedad' },
  servicio_contratado: { servicio: 'solo_iva' },
  rut: { razon_social: 'CASTRILLON CASTAÑO ARLEY GIOVANNI', numero_identificacion: '3556837' },
  rut_solicitante_2: { razon_social: 'SALAZAR HERRERA ISABEL CRISTINA', numero_identificacion: '43448996' },
  concepto_upme: { nombre_certificado: 'CASTRILLON CASTAÑO ARLEY GIOVANNI', nombre_certificado_2: 'SALAZAR HERRERA ISABEL CRISTINA' },
  concepto_upme_anexos: { nombre_certificado: 'CASTRILLON CASTAÑO ARLEY GIOVANNI', nombre_certificado_2: 'SALAZAR HERRERA ISABEL CRISTINA' },
  factura_venta_vehiculo: {
    cantidad_compradores: '2',
    compradores: 'ISABEL CRISTINA SALAZAR HERRERA (43448996); ARLEY GIOVANNI CASTRILLON CASTAÑO (3556837)',
  },
}
// V0142 medido: único y un comprador.
const V0142 = {
  ...NATURAL,
  titularidad: { modalidad_solicitante: 'unico' },
  rut: { razon_social: 'BENAVIDES MORENO SANTIAGO', numero_identificacion: '1022424269' },
  concepto_upme: { nombre_certificado: 'BENAVIDES MORENO SANTIAGO' },
  factura_venta_vehiculo: { cantidad_compradores: '1', compradores: 'SANTIAGO BENAVIDES MORENO (1022424269)' },
}

describe('la configuración de SOENA en la migración', () => {
  it('declara los cuatro cruces y los cinco campos de la tarjeta, todos bien formados', () => {
    expect(CRUCES.map(c => c.slug)).toEqual([
      'factura_compradores_vs_titularidad',
      'rut_entre_compradores',
      'rut2_entre_compradores',
      'certificado_personas_vs_titularidad',
    ])
    expect(DATOS_CLAVE.campos.map(c => c.label)).toEqual(['Servicio', 'Tipo de persona', 'Titularidad', 'Tarifa UPME', 'Cita DIAN'])
  })

  it('todo slug que referencia existe en la línea', () => {
    for (const s of [...slugsDeCruces(CRUCES), ...slugsDeDatosClave(DATOS_CLAVE)]) {
      if (s === 'via_solicitud_cita') continue // solo lo usa la condition de fecha_cita_dian
      expect(CONDICION_BLOQUE, s).toHaveProperty(s)
    }
  })
})

describe('cruces de SOENA contra casos reales', () => {
  it('V0207 hoy (factura sin compradores leídos): ningún aviso, la factura todavía no dice nada', async () => {
    expect(await evaluarCruces(CRUCES, ctx(V0207), CITA)).toEqual([])
  })

  it('V0207 con los compradores leídos: la contradicción sale en rojo, y en Cita no frena', async () => {
    const r = await evaluarCruces(CRUCES, ctx(V0207_CON_COMPRADORES), CITA)
    expect(r).toEqual([{
      slug: 'factura_compradores_vs_titularidad',
      mensaje: 'La factura trae 2 compradores y la titularidad dice «Un solo solicitante».',
      bloquea: false,
    }])
  })

  it('V0207 en Documentación: la misma contradicción frena el avance', async () => {
    const r = await evaluarCruces(CRUCES, ctx(V0207_CON_COMPRADORES), DOCUMENTACION)
    expect(r.map(c => [c.slug, c.bloquea])).toEqual([['factura_compradores_vs_titularidad', true]])
  })

  it('V0151: el certificado a una persona en una copropiedad frena en Cita', async () => {
    const r = await evaluarCruces(CRUCES, ctx(V0151), CITA)
    expect(r).toEqual([{
      slug: 'certificado_personas_vs_titularidad',
      mensaje: 'El certificado UPME trae 1 solicitante y la titularidad dice «Copropiedad (dos personas naturales)».',
      bloquea: true,
    }])
  })

  it('V0286 (copropiedad, certificado a dos personas): ningún aviso', async () => {
    expect(await evaluarCruces(CRUCES, ctx(V0286), CITA)).toEqual([])
    expect(await evaluarCruces(CRUCES, ctx(V0286), DOCUMENTACION)).toEqual([])
  })

  it('V0142 (único, un comprador): ningún aviso', async () => {
    expect(await evaluarCruces(CRUCES, ctx(V0142), DOCUMENTACION)).toEqual([])
  })

  it('el RUT que no está entre los compradores se nombra con el documento y la lista', async () => {
    const r = await evaluarCruces(CRUCES, ctx({
      ...V0142,
      rut: { numero_identificacion: '99999999' },
    }), DOCUMENTACION)
    expect(r).toEqual([{
      slug: 'rut_entre_compradores',
      mensaje: 'El documento del RUT (99999999) no está entre los compradores de la factura: SANTIAGO BENAVIDES MORENO (1022424269).',
      bloquea: true,
    }])
  })

  it('en copropiedad también exige el RUT del segundo titular entre los compradores', async () => {
    const r = await evaluarCruces(CRUCES, ctx({
      ...V0286,
      rut_solicitante_2: { numero_identificacion: '11111111' },
    }), DOCUMENTACION)
    expect(r.map(c => c.slug)).toEqual(['rut2_entre_compradores'])
  })

  it('leasing: el comprador es el banco y ningún cruce de titularidad aplica', async () => {
    const r = await evaluarCruces(CRUCES, ctx({
      ...V0142,
      titularidad: { modalidad_solicitante: 'leasing' },
      concepto_upme: { nombre_certificado: 'X', nombre_certificado_2: 'BANCO' },
      factura_venta_vehiculo: { cantidad_compradores: '1', compradores: 'BANCO DAVIVIENDA (8600343137)' },
    }), DOCUMENTACION)
    expect(r).toEqual([])
  })

  it('una titularidad que quedó de una rama abandonada (persona jurídica) no decide nada', async () => {
    const r = await evaluarCruces(CRUCES, ctx({
      ...V0151,
      tipo_de_solicitante: { tipo_persona: 'juridica' },
    }), CITA)
    expect(r).toEqual([])
  })

  // V0321 medido: único, persona natural, certificado 2024 con la sociedad del proyecto.
  const V0321 = {
    ...NATURAL,
    titularidad: { modalidad_solicitante: 'unico' },
    servicio_contratado: { servicio: 'solo_iva' },
    concepto_upme: {
      nombre_certificado: 'ELMY LUCELLY ESCOBAR JIMENEZ',
      numero_identificacion_certificado: '31965359',
      nombre_certificado_2: 'INNVENTOR ELECTRONICS SAS',
      numero_identificacion_certificado_2: '901045219',
    },
  }

  it('V0321: la sociedad del proyecto en el certificado no cuenta como 2º titular', async () => {
    expect(await evaluarCruces(CRUCES, ctx(V0321), CITA)).toEqual([])
  })

  it('la sociedad se reconoce por el NIT aunque el nombre no traiga sigla, y por la sigla sin NIT', async () => {
    const porNit = { ...V0321, concepto_upme: { ...V0321.concepto_upme, nombre_certificado_2: 'INNVENTOR ELECTRONICS' } }
    const porSigla = { ...V0321, concepto_upme: { ...V0321.concepto_upme, numero_identificacion_certificado_2: undefined } }
    expect(await evaluarCruces(CRUCES, ctx(porNit), CITA)).toEqual([])
    expect(await evaluarCruces(CRUCES, ctx(porSigla), CITA)).toEqual([])
  })

  it('en copropiedad, persona natural + sociedad sigue siendo UN titular: frena', async () => {
    const r = await evaluarCruces(CRUCES, ctx({ ...V0321, titularidad: { modalidad_solicitante: 'copropiedad' } }), CITA)
    expect(r.map(c => c.slug)).toEqual(['certificado_personas_vs_titularidad'])
    expect(r[0].mensaje).toMatch(/^El certificado UPME trae 1 solicitante/)
  })

  it('sin titularidad respondida el cruce no se evalúa (la tarjeta ya la muestra «Sin definir»)', async () => {
    const { titularidad: _t, ...sinTitularidad } = V0151
    void _t
    expect(await evaluarCruces(CRUCES, ctx(sinTitularidad), CITA)).toEqual([])
    expect(await evaluarCruces(CRUCES, ctx({ ...V0151, titularidad: { modalidad_solicitante: '' } }), CITA)).toEqual([])
  })

  it('el certificado de Anexos solo cuenta cuando el caso va por solo IVA', async () => {
    // Caso completo: Anexos no le aplica, se mira el de Certificación (una persona).
    const r = await evaluarCruces(CRUCES, ctx({
      ...V0151,
      concepto_upme_anexos: { nombre_certificado: 'A', nombre_certificado_2: 'B' },
    }), CITA)
    expect(r.map(c => c.slug)).toEqual(['certificado_personas_vs_titularidad'])
  })
})

describe('tarjeta de datos clave de SOENA', () => {
  it('V0207: titularidad «Único» con Lady Marlene Alvarado debajo', async () => {
    const v = await resolverDatosClave(DATOS_CLAVE, ctx(V0207))
    const tit = v.campos.find(c => c.label === 'Titularidad')!
    expect(tit.valor).toEqual({ estado: 'ok', texto: 'Único', nota: null })
    expect(tit.detalle).toEqual(['ALVARADO BARRUETO LADY MARLENE'])
    expect(v.campos.find(c => c.label === 'Servicio')!.valor).toEqual({ estado: 'ok', texto: 'Completo (UPME + IVA)', nota: null })
  })

  it('en copropiedad lista a los dos titulares', async () => {
    const v = await resolverDatosClave(DATOS_CLAVE, ctx(V0151))
    expect(v.campos.find(c => c.label === 'Titularidad')!.detalle)
      .toEqual(['URIBE ESTRADA JUAN FELIPE', 'LOPEZ VELEZ DIANA PATRICIA'])
  })

  it('un caso sin servicio muestra «Sin definir», no lo esconde', async () => {
    const v = await resolverDatosClave(DATOS_CLAVE, ctx({ ...NATURAL, titularidad: { modalidad_solicitante: 'unico' } }))
    expect(v.campos.find(c => c.label === 'Servicio')!.valor).toEqual({ estado: 'sin_definir' })
    expect(v.campos.find(c => c.label === 'Tarifa UPME')!.valor).toEqual({ estado: 'sin_definir' })
  })

  it('persona jurídica: la titularidad no aplica', async () => {
    const v = await resolverDatosClave(DATOS_CLAVE, ctx({ tipo_de_solicitante: { tipo_persona: 'juridica' } }))
    expect(v.campos.find(c => c.label === 'Titularidad')!.valor).toEqual({ estado: 'no_aplica' })
    expect(v.campos.find(c => c.label === 'Tipo de persona')!.valor).toEqual({ estado: 'ok', texto: 'Jurídica', nota: null })
  })

  it('tarifa: la confirmada solo cuenta con el visto bueno; si no, la cotizada con su marca', async () => {
    const base = { ...V0207, propuesta_economica: { tarifa_upme: 701812 } }
    const sinVisto = await resolverDatosClave(DATOS_CLAVE, ctx({
      ...base, confirmar_tarifa_upme: { tarifa_upme_confirmada: 800000, tarifa_confirmada: false },
    }))
    expect(sinVisto.campos.find(c => c.label === 'Tarifa UPME')!.valor)
      .toEqual({ estado: 'ok', texto: '$701.812', nota: 'cotizada' })
    const conVisto = await resolverDatosClave(DATOS_CLAVE, ctx({
      ...base, confirmar_tarifa_upme: { tarifa_upme_confirmada: 800000, tarifa_confirmada: true },
    }))
    expect(conVisto.campos.find(c => c.label === 'Tarifa UPME')!.valor)
      .toEqual({ estado: 'ok', texto: '$800.000', nota: null })
  })

  it('cita DIAN: «Sí» con la fecha debajo aunque la fecha la haya puesto otra vía', async () => {
    const v = await resolverDatosClave(DATOS_CLAVE, ctx({
      ...V0207,
      servicio_contratado: { servicio: 'solo_iva' },
      via_solicitud_cita: { via_solicitud: 'pqrs' },
      fecha_cita_dian: { fecha_cita_dian: '2026-10-02T09:30' },
    }))
    const cita = v.campos.find(c => c.label === 'Cita DIAN')!
    expect(cita.valor).toEqual({ estado: 'ok', texto: 'Sí', nota: null })
    expect(cita.detalle).toHaveLength(1)
    expect(cita.detalle[0]).toMatch(/^2 de oct de 2026/)
  })
})
