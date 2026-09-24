/**
 * El ajuste del 24-sep sobre el verificador del certificado UPME de SOENA: fuera el VIN,
 * dentro el correo del cliente. Lee la configuración REAL de las dos migraciones (la que
 * agregó los cruces del certificado y la que la ajusta) y arma la lista que queda en
 * producción después de aplicar las dos, en ese orden.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cumpleCondicion } from './condicion-bloque'
import { evaluarCruces, leerCruces, slugsDeCruces } from './cruces'
import { SLUG_CONTACTO, type ContextoFuentes } from './fuentes-negocio'

function bloques(archivo: string) {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations', archivo), 'utf8')
  return (tag: string): unknown => {
    const m = sql.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`))
    if (!m) throw new Error(`${archivo} no trae el bloque $${tag}$`)
    return JSON.parse(m[1])
  }
}
const antes = bloques('20260924230000_soena_voto_documento_y_verificador_upme.sql')
const ajuste = bloques('20260925010000_soena_certificado_correo_sin_vin.sql')

const CRUCES_CORREO_CRUDOS = ajuste('cruces_correo') as unknown[]
const CRUCES_CORREO = leerCruces({ cruces: CRUCES_CORREO_CRUDOS })
// Lo que queda en la línea: los del certificado sin el VIN, más los del correo al final.
const CRUCES_CERTIFICADO = leerCruces({
  cruces: [
    ...(antes('cruces_cert') as Array<{ slug: string }>).filter(c => c.slug !== 'certificado_vin_vs_factura'),
    ...CRUCES_CORREO_CRUDOS,
  ],
})

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

/** Doble de `contextoFuentesDelNegocio`: el contacto le aplica si el negocio lo tiene. */
function ctx(porSlug: Record<string, Record<string, unknown>>): ContextoFuentes {
  const evaluar = async (c: Record<string, unknown>) => cumpleCondicion(c as never, { porSlug, porEtapaOrden: {} })
  return {
    porSlug,
    evaluar,
    aplica: async slug => {
      if (slug === SLUG_CONTACTO) return !!porSlug[SLUG_CONTACTO]
      if (!(slug in CONDICION_BLOQUE)) return false
      const c = CONDICION_BLOQUE[slug]
      return c ? evaluar(c) : true
    },
    etiqueta: () => null,
  }
}

const UNICO = {
  tipo_de_solicitante: { tipo_persona: 'natural' },
  titularidad: { modalidad_solicitante: 'unico' },
  servicio_contratado: { servicio: 'completo' },
}
// V0210 medido el 24-sep: el certificado trae «hotmaiol.com»; contacto y RUT, «hotmail.com».
const V0210 = {
  ...UNICO,
  [SLUG_CONTACTO]: { nombre: 'LADY BARRUETO', email: 'lady.barrueto@hotmail.com', telefono: '3000000000' },
  rut: { razon_social: 'BARRUETO LADY', email: 'lady.barrueto@hotmail.com' },
  concepto_upme: { nombre_certificado: 'BARRUETO LADY', correo_certificado: 'lady.barrueto@hotmaiol.com' },
}

describe('el ajuste del certificado UPME de SOENA', () => {
  it('dos cruces de correo bien formados, que leen el contacto y los dos RUT, y solo avisan', () => {
    expect(CRUCES_CORREO.map(c => c.slug)).toEqual(['certificado_correo_titular', 'certificado_correo_titular_2'])
    expect(CRUCES_CORREO).toHaveLength(CRUCES_CORREO_CRUDOS.length)
    for (const c of CRUCES_CORREO) {
      expect(c.tipo).toBe('coincide')
      // Medido: 12 de 315 certificados difieren y casi todos a propósito. Avisa, no frena.
      expect(c.bloquea_en_etapas).toEqual([])
    }
    expect(slugsDeCruces(CRUCES_CORREO).sort()).toEqual(
      [SLUG_CONTACTO, 'concepto_upme', 'concepto_upme_anexos', 'rut', 'rut_solicitante_2', 'titularidad'].sort(),
    )
  })

  it('en la línea no queda ningún cruce del VIN', () => {
    expect(CRUCES_CERTIFICADO.map(c => c.slug)).toEqual([
      'certificado_nombre_titular',
      'certificado_nombre_titular_2',
      'certificado_valor_vs_factura',
      'certificado_marca_vs_factura',
      'certificado_proveedor_vs_factura',
      'certificado_correo_titular',
      'certificado_correo_titular_2',
    ])
  })

  it('el certificado lee los dos correos y no el VIN; y el celular no se lee', () => {
    const campos = (ajuste('campos_certificado') as Array<{ slug: string; required: boolean }>)
    expect(campos.map(c => c.slug)).toEqual(['correo_certificado', 'correo_certificado_2'])
    expect(campos.every(c => c.required === false)).toBe(true)
    expect(JSON.stringify(campos)).not.toMatch(/celular|telefono|vin/i)
  })

  it('V0210: el correo mal escrito del certificado se avisa en cualquier etapa y no frena', async () => {
    for (const etapa of [9, 18, 13]) {
      const [r] = await evaluarCruces(CRUCES_CERTIFICADO, ctx(V0210), etapa)
      expect(r.slug).toBe('certificado_correo_titular')
      expect(r.bloquea).toBe(false)
    }
    const [r] = await evaluarCruces(CRUCES_CERTIFICADO, ctx(V0210), 9)
    // El mismo correo en el contacto y en el RUT sale una sola vez.
    expect(r.mensaje).toBe('El certificado UPME notifica a «lady.barrueto@hotmaiol.com» y el correo que tenemos del cliente es «lady.barrueto@hotmail.com».')
  })

  it('basta con que coincida el contacto o el RUT, sin importar mayúsculas', async () => {
    const soloContacto = { ...V0210, concepto_upme: { ...V0210.concepto_upme, correo_certificado: 'Lady.Barrueto@HOTMAIL.com' }, rut: { razon_social: 'BARRUETO LADY', email: 'otro@x.co' } }
    expect(await evaluarCruces(CRUCES_CERTIFICADO, ctx(soloContacto), 9)).toEqual([])
    const soloRut = { ...soloContacto, [SLUG_CONTACTO]: { email: 'la.asesora@concesionario.co' }, rut: { razon_social: 'BARRUETO LADY', email: 'lady.barrueto@hotmail.com' } }
    expect(await evaluarCruces(CRUCES_CERTIFICADO, ctx(soloRut), 9)).toEqual([])
  })

  it('calla en un certificado cargado antes (sin correo) y en un negocio sin ningún correo', async () => {
    const viejo = { ...V0210, concepto_upme: { nombre_certificado: 'BARRUETO LADY' } }
    expect(await evaluarCruces(CRUCES_CERTIFICADO, ctx(viejo), 9)).toEqual([])
    const sinCorreos: Record<string, Record<string, unknown>> = { ...V0210, rut: { razon_social: 'BARRUETO LADY' } }
    delete sinCorreos[SLUG_CONTACTO]
    expect(await evaluarCruces(CRUCES_CERTIFICADO, ctx(sinCorreos), 9)).toEqual([])
  })

  it('copropiedad: el correo del segundo beneficiario se coteja con los RUT; en un caso único no', async () => {
    const copro = {
      ...V0210,
      concepto_upme: { ...V0210.concepto_upme, correo_certificado: 'lady.barrueto@hotmail.com', correo_certificado_2: 'socio@gmail.com' },
      titularidad: { modalidad_solicitante: 'copropiedad' },
      rut_solicitante_2: { razon_social: 'SOCIO UNO', email: 'SOCIO@gmail.com' },
    }
    expect(await evaluarCruces(CRUCES_CORREO, ctx(copro), 9)).toEqual([])
    const otro = { ...copro, rut_solicitante_2: { razon_social: 'SOCIO UNO', email: 'socio2@gmail.com' } }
    expect((await evaluarCruces(CRUCES_CORREO, ctx(otro), 9)).map(c => c.slug)).toEqual(['certificado_correo_titular_2'])
    // Un correo_2 leído en un caso único no se coteja: la condición del cruce no se cumple.
    expect(await evaluarCruces(CRUCES_CORREO, ctx({ ...otro, titularidad: { modalidad_solicitante: 'unico' } }), 9)).toEqual([])
  })
})
