import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  PARTE_I_ORDEN,
  PARTE_II_TERMINOS,
  SEPARADOR_PARTES,
  TERMINOS_PLAN,
  camposDeLaOrden,
  camposDePlantilla,
  terminosDeLaEmpresa,
  terminosPlanListos,
  vistaDeLosTerminos,
} from './terminos-plan'
import { DIAS_GRACIA_CICLO } from './plan'
import { huellaParteII, terminosParaElRegistro } from './terminos-registro-servidor'

/**
 * Los Términos de Uso de VALIDA v2.0 autoservicio, copiados de
 * `proyectos/metrik/valida/docs/legal/terminos-valida-v2.0-autoservicio.md` (título → 16.6).
 *
 * La huella de la Parte II se fijó el 2026-10-14 comparando el código con el archivo, y otra vez con la v2.1
 * (cobro del primer mes al confirmar, texto de Max pendiente de Emilio): si alguien
 * cambia una letra del texto, esta prueba cae y obliga a subir la versión (lo ya aceptado no cambia).
 */

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

describe('el texto de los Términos', () => {
  it('ya no es un marcador', () => {
    expect(terminosPlanListos()).toBe(true)
    expect(TERMINOS_PLAN).toMatchObject({ slug: 'terminos-uso-valida-autogestion', version: 'v2.1', titulo: 'Términos de Uso de VALIDA' })
  })

  it('la Parte II es la del archivo, letra por letra (huella fijada)', () => {
    expect(sha(PARTE_II_TERMINOS)).toBe('7d5389c619f2bb99603aa7f0bfa32b246cd0fcfda9a70d67beff51f4fc8684eb')
    expect(PARTE_II_TERMINOS.length).toBe(29953)
    expect(huellaParteII()).toBe(sha(PARTE_II_TERMINOS))
  })

  it('va del título a la 16.6: sin las secciones A a D ni la marca del PDF', () => {
    expect(TERMINOS_PLAN.plantilla.startsWith('# TÉRMINOS DE USO DE VALIDA\n\n**Variante: Autoservicio · Versión 2.1 · Rige desde {fecha_publicacion}**')).toBe(true)
    expect(PARTE_II_TERMINOS.startsWith('## PARTE II. TÉRMINOS\n\n### 0. Cómo se leen estos Términos')).toBe(true)
    expect(PARTE_II_TERMINOS.endsWith('si ese cobro falla, aplica el numeral 7.5 de las Condiciones de la prueba gratis.')).toBe(true)
    expect(TERMINOS_PLAN.plantilla).toBe(`${PARTE_I_ORDEN}${SEPARADOR_PARTES}${PARTE_II_TERMINOS}`)
    for (const fuera of ['<!-- FIN-PDF -->', '## A. Diferencias', '## B. Texto de la casilla', '## C. Supuestos', '## D. Veredicto', 'EMILIO (CLO)']) {
      expect(TERMINOS_PLAN.plantilla).not.toContain(fuera)
    }
  })

  it('sin las marcas [Δn] y con {N} = 10 en la 3.6 y la 11.1, igual a los días de gracia del código', () => {
    expect(TERMINOS_PLAN.plantilla).not.toMatch(/\[Δ\d+\]/)
    expect(TERMINOS_PLAN.plantilla).not.toContain('{N}')
    expect(DIAS_GRACIA_CICLO).toBe(10)
    expect(PARTE_II_TERMINOS).toContain('puede intentar el cobro de nuevo al mismo medio de pago durante los 10 días calendario siguientes')
    expect(PARTE_II_TERMINOS).toContain('ni se haya pagado dentro de los 10 días calendario de la cláusula 3.6')
  })

  it('la Parte II no tiene campos (es igual para todos); la Orden pide solo lo que el registro conoce', () => {
    expect(camposDePlantilla(PARTE_II_TERMINOS)).toEqual([])
    expect(camposDePlantilla(TERMINOS_PLAN.plantilla)).toEqual([
      'fecha_publicacion',
      'fecha_registro',
      'razon_social',
      'nit',
      'correo_notificaciones',
      'fecha_hora_vence_prueba',
      'recomendado_afi',
      'huella_sha256',
    ])
  })

  it('v2.1: el primer cobro, al confirmar el Cliente o después del plazo y nunca antes (0.5, 3.5, 16.6 y la Orden)', () => {
    expect(PARTE_I_ORDEN).toContain(
      'El primer cobro se hace cuando el Cliente confirma en su cuenta que activa el plan o, si no lo confirma ni cancela a tiempo, después de ese momento y nunca antes (cláusula 3.5)',
    )
    expect(PARTE_I_ORDEN).not.toContain('nunca antes, salvo que el Cliente cancele a tiempo')
    expect(PARTE_II_TERMINOS).toContain('que se hace cuando el Cliente confirma en su cuenta que activa el plan o, si no lo confirma, después del fin del plazo')
    expect(PARTE_II_TERMINOS).toContain(
      'el primer mes, en el momento en que el Cliente confirma en su cuenta que activa el plan, confirmación que Valida le pide cuando intenta una consulta después de agotar las 10 de la prueba',
    )
    expect(PARTE_II_TERMINOS).toContain('o, si no la da, después de que se cumplan los 7 días de la prueba y nunca antes;')
    expect(PARTE_II_TERMINOS).toContain('hecho cuando el Cliente confirma en su cuenta que activa el plan o, sin esa confirmación, después del fin del plazo')
  })

  it('el plan, el precio y la forma de pago van escritos en la Orden, no en campos', () => {
    expect(PARTE_I_ORDEN).toContain('| Usuarios incluidos | 2 |')
    expect(PARTE_I_ORDEN).toContain('| Consultas incluidas | Hasta 3.000 por mes |')
    expect(PARTE_I_ORDEN).toContain('| Valor mensual | $150.000 (ciento cincuenta mil pesos) |')
    expect(PARTE_I_ORDEN).toContain('| Canal de aceptación | Registro en Valida (casilla) |')
  })
})

describe('los Términos de una empresa, llenos en el registro', () => {
  const p = {
    razonSocial: 'ACME S.A.S.',
    nit: '900123456',
    dv: '7',
    correo: 'gerencia@acme.co',
    recomendadoAfi: true,
    // Martes 13 de octubre de 2026, 15:00:59 de Bogotá.
    aceptadoMs: Date.parse('2026-10-13T20:00:59Z'),
  }

  it('la Orden lleva lo declarado, la huella de la Parte II y el fin del plazo truncado al minuto', () => {
    const r = terminosParaElRegistro(p, { VERCEL_ENV: 'production' })
    if (!r.ok) throw new Error(r.faltan.join(','))
    const t = r.terminos
    expect(t.version).toBe('v2.1')
    expect(t.sha256).toBe(sha(t.texto))
    expect(t.texto).toContain('| Razón social (declarada en el registro) | ACME S.A.S. |')
    expect(t.texto).toContain('| NIT (declarado en el registro) | 900.123.456-7 |')
    expect(t.texto).toContain('| Correo de notificaciones (verificado con código en el registro) | gerencia@acme.co |')
    expect(t.texto).toContain('| Recomendado por AFI (cláusula 15) | sí |')
    expect(t.texto).toContain(`| Huella SHA-256 de los Términos (Parte II) | ${sha(PARTE_II_TERMINOS)} |`)
    expect(t.texto).toContain('Fecha del registro: 13 de octubre de 2026')
    expect(t.texto).toMatch(/\| Fin del plazo para cancelar la prueba \| martes, 20 de octubre de 2026, 3:00\s?p\.\s?m\. \(hora de Colombia\) \(7 días después/)
    expect(t.texto).not.toMatch(/\{[a-z_]+\}/)
    // La Parte II va intacta dentro del documento.
    expect(t.texto.endsWith(PARTE_II_TERMINOS)).toBe(true)
  })

  it('en un preview con la prueba acortada, el plazo es el de los minutos', () => {
    const r = terminosParaElRegistro(p, { VERCEL_ENV: 'preview', VALIDA_COBRO_PRUEBA_MINUTOS: '14' })
    if (!r.ok) throw new Error('faltan')
    expect(r.terminos.texto).toMatch(/martes, 13 de octubre de 2026, 3:14\s?p\.\s?m\. \(hora de Colombia\)/)
  })

  it('sin recomendación de AFI dice «no»', () => {
    const c = camposDeLaOrden({ ...p, recomendadoAfi: null, duracionPruebaMs: 0, huellaParteII: 'a'.repeat(64) })
    expect(c.recomendado_afi).toBe('no')
  })

  it('no devuelve texto con un campo vacío', () => {
    const c = camposDeLaOrden({ ...p, razonSocial: '  ', duracionPruebaMs: 0, huellaParteII: 'a'.repeat(64) })
    expect(terminosDeLaEmpresa(c)).toEqual({ ok: false, faltan: ['razon_social'] })
  })

  it('la vista de la pantalla no deja llaves sueltas mientras la persona escribe', () => {
    const v = vistaDeLosTerminos({ razon_social: 'ACME', nit: '' })
    expect(v).toContain('| Razón social (declarada en el registro) | ACME |')
    expect(v).toContain('| NIT (declarado en el registro) | … |')
    expect(v).not.toMatch(/\{[a-z_]+\}/)
  })
})
