/**
 * La configuración REAL de SOENA (la de la migración, no una copia) contra los casos del
 * 24-sep medidos en producción. Si alguien edita la migración y rompe un voto o un cruce,
 * esto lo dice antes de aplicarla: una entrada mal formada se descarta en silencio al
 * leerla, y un voto sin fuentes no avisa nada.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cumpleCondicion } from './condicion-bloque'
import { evaluarCruces, leerCruces, slugsDeCruces } from './cruces'
import { evaluarVotos, leerVotos, slugsDeVotos } from './votos'
import type { ContextoFuentes } from './fuentes-negocio'

const SQL = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260924230000_soena_voto_documento_y_verificador_upme.sql'),
  'utf8',
)
function bloqueJson(tag: string): unknown {
  const m = SQL.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`))
  if (!m) throw new Error(`la migración no trae el bloque $${tag}$`)
  return JSON.parse(m[1])
}
const VOTOS_CRUDOS = bloqueJson('votos') as Array<{ fuentes: unknown[] }>
const VOTOS = leerVotos({ votos: VOTOS_CRUDOS })
const CRUCES_CRUDOS = bloqueJson('cruces_cert') as unknown[]
const CRUCES = leerCruces({ cruces: CRUCES_CRUDOS })

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
    etiqueta: () => null,
  }
}

const NATURAL_UNICO = {
  tipo_de_solicitante: { tipo_persona: 'natural' },
  titularidad: { modalidad_solicitante: 'unico' },
  servicio_contratado: { servicio: 'completo' },
}
// V0142 medido el 24-sep (el RUT guarda «Cédula de Ciudadanía» y DV 5).
const V0142 = {
  ...NATURAL_UNICO,
  rut: { razon_social: 'BENAVIDES MORENO SANTIAGO', nit: '1022424269', dv: '5', numero_identificacion: '1022424289', tipo_documento: 'Cédula de Ciudadanía' },
  factura_venta_vehiculo: { compradores: 'SANTIAGO BENAVIDES MORENO (1022424269)', marca: 'BYD', valor_unitario_sin_iva: '100000000' },
  concepto_upme: {
    nombre_certificado: 'BENAVIDES MORENO SANTIAGO', numero_identificacion_certificado: '1022424269',
    marca_certificado: 'BYD', valor_total_certificado: '100000000',
  },
}

describe('la configuración de SOENA en la migración', () => {
  it('dos votos y seis cruces, todos bien formados (nada se descartó al leerlos)', () => {
    expect(VOTOS.map(v => v.slug)).toEqual(['documento_titular', 'documento_titular_2'])
    expect(VOTOS.map(v => v.fuentes.length)).toEqual(VOTOS_CRUDOS.map(v => v.fuentes.length))
    expect(CRUCES).toHaveLength(CRUCES_CRUDOS.length)
    expect(CRUCES.map(c => c.slug)).toEqual([
      'certificado_nombre_titular',
      'certificado_nombre_titular_2',
      'certificado_valor_vs_factura',
      'certificado_marca_vs_factura',
      'certificado_vin_vs_factura',
      'certificado_proveedor_vs_factura',
    ])
  })

  it('todo bloque que referencia existe en la línea', () => {
    for (const s of [...slugsDeVotos(VOTOS), ...slugsDeCruces(CRUCES)]) expect(CONDICION_BLOQUE, s).toHaveProperty(s)
  })

  it('los votos niegan la generación y frenan en Documentación, Certificación y Anexos', () => {
    for (const v of VOTOS) {
      expect(v.niega_generacion).toBe(true)
      expect(v.bloquea_en_etapas).toEqual([6, 9, 18])
    }
  })

  it('V0142 con la config real: casilla 26 dudosa, propone 1022424269, niega generar y en Certificación frena', async () => {
    const rs = await evaluarVotos(VOTOS, ctx(V0142), 9)
    expect(rs).toHaveLength(1) // el voto del 2º titular no aplica: no es copropiedad
    const [r] = rs
    expect(r.estado).toBe('dudosa')
    expect(r.valor).toBe('1022424269')
    expect(r.fuentes.find(f => f.estado === 'dudosa')?.etiqueta).toBe('RUT (casilla 26)')
    expect(r.niega_generacion).toBe(true)
    expect(r.bloquea).toBe(true)
    // El certificado de V0142 no contradice nada más.
    expect(await evaluarCruces(CRUCES, ctx(V0142), 9)).toEqual([])
  })

  it('una cédula de extranjería: la casilla 5 no vota', async () => {
    const ce = {
      ...V0142,
      rut: { ...V0142.rut, tipo_documento: 'Cédula de Extranjería', nit: '700422924', numero_identificacion: '1022424269' },
    }
    const [r] = await evaluarVotos(VOTOS, ctx(ce), 9)
    expect(r.fuentes.map(f => f.etiqueta)).not.toContain('RUT (casilla 5)')
    expect(r.estado).toBe('acuerdo')
  })

  it('el certificado de otro vehículo frena en Certificación (V0064: Toyota contra Tesla, $130M contra $143M)', async () => {
    const v0064 = {
      ...V0142,
      rut: { ...V0142.rut, numero_identificacion: '1022424269' },
      factura_venta_vehiculo: { ...V0142.factura_venta_vehiculo, marca: 'Tesla', valor_unitario_sin_iva: '143800000' },
      concepto_upme: { ...V0142.concepto_upme, marca_certificado: 'TOYOTA', valor_total_certificado: '130530973' },
    }
    const cs = await evaluarCruces(CRUCES, ctx(v0064), 9)
    expect(cs.map(c => c.slug).sort()).toEqual(['certificado_marca_vs_factura', 'certificado_valor_vs_factura'])
    expect(cs.every(c => c.bloquea)).toBe(true)
  })
})
