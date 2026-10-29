import { describe, it, expect } from 'vitest'
import { validarPlantilla } from './validar'
import { htmlDelDocumento } from './html'
import { DJ_V1 } from './v1'
import { DOCUMENTOS } from './catalogo'

const DJ = 'declaracion-juramentada' as const
const CTX = { fechaGeneracion: '2026-10-30T02:30:00.000Z', codigoNegocio: 'S1 26 3' }

/** Una DJ mínima que cumple todos los requisitos, para probar una cosa a la vez. */
const MINIMA = `**{{numero_factura}}** {{valor_iva}} {{iva_solicitado}}
{{#firmas}}
---
{{titular.nombre}} {{titular.cedula}}
{{/firmas}}`

const errores = (c: string) => validarPlantilla(DJ, c).errores.map((e) => e.mensaje)

describe('rechaza al guardar', () => {
  it('una variable que no está en el catálogo', () => {
    expect(errores(`${MINIMA}\n{{valor_total}}`)).toEqual(['Variable desconocida {{valor_total}}.'])
  })

  it('una condición que no está en el catálogo', () => {
    expect(errores(`${MINIMA}\n{{#si hay_leasing}}x{{/si}}`)).toEqual(['Condición desconocida «hay_leasing».'])
  })

  it('un bloque que no existe', () => {
    expect(errores(`${MINIMA}\n{{#tabla}}\nx\n{{/tabla}}`)).toContain('Bloque desconocido «{{#tabla}}».')
  })

  it('una etiqueta con algo que no es un nombre', () => {
    expect(errores(`${MINIMA}\n{{ alert(1) }}`)).toEqual(['Etiqueta no reconocida «{{alert(1)}}».'])
  })

  it('un {{#si}} de bloque sin cerrar, con el renglón donde se abrió', () => {
    const v = validarPlantilla(DJ, `${MINIMA}\n\n{{#si dos_titulares}}\nQUINTO`)
    expect(v.errores).toEqual([{ linea: 7, mensaje: 'Falta cerrar {{/si}} (abierto en el renglón 7).' }])
  })

  it('un {{#si}} en línea sin cerrar en su párrafo', () => {
    expect(errores(`${MINIMA}\n\nhola {{#si dos_titulares}} y adiós`)).toEqual(['Falta {{/si}} en el mismo párrafo.'])
  })

  it('cierres cruzados', () => {
    expect(errores(`${MINIMA}\n{{#centrado}}\n{{#junto}}\nx\n{{/centrado}}\n{{/junto}}`))
      .toContainEqual(expect.stringMatching(/^Se esperaba \{\{\/junto\}\} \(abierto en el renglón 7\)/))
  })

  it('un {{sino}} suelto o repetido', () => {
    expect(errores(`${MINIMA}\n\nx {{sino}} y`)).toEqual(['{{sino}} sin un {{#si}} abierto en el mismo párrafo.'])
    expect(errores(`${MINIMA}\n\n{{#si dos_titulares}}a{{sino}}b{{sino}}c{{/si}}`)).toEqual(['Un {{#si}} lleva un solo {{sino}}.'])
  })

  it('una negrita sin cerrar o cruzada con un {{#si}}', () => {
    expect(errores(`${MINIMA}\n\n**sin cerrar`)).toEqual(['Negrita sin cerrar: falta el segundo **.'])
    expect(errores(`${MINIMA}\n\n{{#si dos_titulares}}**a{{/si}}**`)).toContain('Cierra la negrita (**) antes de {{/si}}.')
  })

  it('una variable o condición de titular fuera de su bloque', () => {
    expect(errores(`${MINIMA}\n\n{{titular.nombre}}`)).toEqual([
      '{{titular.nombre}} solo vale dentro de {{#cada titular}} o {{#firmas}}.',
    ])
    expect(errores(`${MINIMA}\n\n{{#si titular.es_primero}}x{{/si}}`)).toEqual([
      '«titular.es_primero» solo vale dentro de {{#cada titular}} o {{#firmas}}.',
    ])
  })

  it('una repetición que no es por titular, o anidada', () => {
    expect(errores(`${MINIMA}\n\n{{#cada factura}}x{{/cada}}`)).toEqual(['Solo existe {{#cada titular}} (llegó «factura»).'])
    expect(errores(`${MINIMA}\n\n{{#cada titular}}{{#cada titular}}x{{/cada}}{{/cada}}`)).toContain(
      'No se puede repetir por titular dentro de otra repetición por titular.',
    )
  })

  it('una llave suelta', () => {
    expect(errores(`${MINIMA}\n\nvalor {{numero_factura}`)).toEqual(['Llave suelta «{{»: las etiquetas van completas, como {{variable}}.'])
  })

  it('un bloque de alineación metido en el texto', () => {
    expect(errores(`${MINIMA}\n\nhola {{#centrado}} x`)).toContain('{{#centrado}} va solo en su renglón.')
  })
})

describe('requisitos mínimos (bloquean la activación, no el guardado)', () => {
  it('la mínima los cumple todos', () => {
    expect(validarPlantilla(DJ, MINIMA)).toMatchObject({ errores: [], faltantes: [] })
  })

  it('sin número de factura ni firmas: se puede guardar, no activar', () => {
    const v = validarPlantilla(DJ, `{{valor_iva}} {{iva_solicitado}} {{#cada titular}}{{titular.nombre}} {{titular.cedula}}{{/cada}}`)
    expect(v.errores).toEqual([])
    expect(v.faltantes).toEqual(['Número de factura', 'Bloque de firmas ({{#firmas}})'])
  })

  it('una variable que solo sale dentro de un {{#si}} no cuenta como presente', () => {
    const v = validarPlantilla(DJ, MINIMA.replace('**{{numero_factura}}**', '{{#si dos_titulares}}{{numero_factura}}{{/si}}'))
    expect(v.faltantes).toEqual(['Número de factura'])
  })

  it('cada documento del catálogo declara requisitos', () => {
    for (const d of Object.values(DOCUMENTOS)) expect(d.requisitos.length).toBeGreaterThan(3)
  })
})

describe('escapa lo que viene de la persona', () => {
  it('HTML en el texto de la plantilla sale como texto', () => {
    const r = htmlDelDocumento(DJ, `${MINIMA}\n\n<script>alert(1)</script><img src="https://x.co/a.png" onerror=alert(1)>`, {}, CTX)
    expect(r.ok).toBe(true)
    const cuerpo = r.html.slice(r.html.indexOf('<body>'))
    expect(cuerpo).not.toMatch(/<script|<img|<style|<link|<iframe/i)
    expect(cuerpo).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=&quot;https://x.co/a.png&quot; onerror=alert(1)&gt;')
  })

  it('HTML en los DATOS del expediente también', () => {
    const r = htmlDelDocumento(DJ, MINIMA, { numero_factura: '<b onmouseover=x>F1</b>', nombre_solicitante: '"><svg/onload=1>' }, CTX)
    expect(r.html).toContain('&lt;b onmouseover=x&gt;F1&lt;/b&gt;')
    expect(r.html).toContain('&quot;&gt;&lt;svg/onload=1&gt;')
    expect(r.html).not.toMatch(/<svg|<b /)
  })

  it('el documento lleva una CSP sin scripts ni red', () => {
    const r = htmlDelDocumento(DJ, MINIMA, {}, CTX)
    expect(r.html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"`)
  })

  it('una plantilla con errores no produce documento', () => {
    const r = htmlDelDocumento(DJ, `${MINIMA}\n{{nada}}`, {}, CTX)
    expect(r).toMatchObject({ ok: false, html: '' })
    expect(r.errores[0]).toMatch(/Renglón 6: Variable desconocida/)
  })
})

describe('resuelve variables y condiciones', () => {
  const cuerpo = (contenido: string, datos: Record<string, string | null>) => {
    const r = htmlDelDocumento(DJ, `${contenido}\n\n${MINIMA}`, datos, CTX)
    expect(r.errores).toEqual([])
    const h = r.html.slice(r.html.indexOf('<main class="hoja">') + 19)
    return h.slice(0, h.indexOf('</p>') + 4)
  }

  it('derivados: IVA solicitado exacto, tarifa, fechas largas y de generación en hora de Bogotá', () => {
    expect(cuerpo('{{iva_solicitado}}|{{tarifa_iva}}|{{fecha_factura_larga}}|{{fecha_generacion_larga}}', {
      valor_iva: '4319548', valor_unitario_sin_iva: '22734463', fecha_factura: '2026-03-15',
    })).toBe('<p>$ 4.319.548|19 %|15 de marzo de 2026|29 de octubre de 2026</p>')
  })

  it('concordancia de uno y de dos titulares', () => {
    const uno = { nombre_solicitante: 'ANA' }
    const dos = { ...uno, nombre_solicitante_2: 'LUIS' }
    const c = '{{frase_yo}} {{frase_soy}} {{frase_manifiesto}}'
    expect(cuerpo(c, uno)).toBe('<p>Yo soy manifiesto</p>')
    expect(cuerpo(c, dos)).toBe('<p>Nosotros somos manifestamos</p>')
  })

  it('{{#cada titular}} con primero y último', () => {
    const c = '{{#cada titular}}{{#si titular.es_primero}}{{sino}} y {{/si}}**{{titular.nombre}}**{{#si titular.es_ultimo}}.{{/si}}{{/cada}}'
    expect(cuerpo(c, { nombre_solicitante: 'ANA' })).toBe('<p><strong>ANA</strong>.</p>')
    expect(cuerpo(c, { nombre_solicitante: 'ANA', nombre_solicitante_2: 'LUIS' }))
      .toBe('<p><strong>ANA</strong> y <strong>LUIS</strong>.</p>')
  })

  it('radicado y fecha del certificado: la degradación de la cláusula SEGUNDO', () => {
    const c = 'descrito{{#si hay_radicado_upme}}, radicado {{numero_caso_upme}}{{#si hay_fecha_certificado}}, de fecha {{fecha_certificado_larga}}{{/si}}.{{sino}} en la cláusula anterior.{{/si}}'
    expect(cuerpo(c, { numero_caso_upme: 'R1', fecha_certificado: '2026-05-08' })).toBe('<p>descrito, radicado R1, de fecha 8 de mayo de 2026.</p>')
    expect(cuerpo(c, { numero_caso_upme: 'R1' })).toBe('<p>descrito, radicado R1.</p>')
    expect(cuerpo(c, { fecha_certificado: '2026-05-08' })).toBe('<p>descrito en la cláusula anterior.</p>')
  })

  it('un párrafo que queda vacío por un {{#si}} no deja hueco', () => {
    const r = htmlDelDocumento(DJ, `{{#si dos_titulares}}\nQUINTO\n{{/si}}\n\n${MINIMA}`, {}, CTX)
    expect(r.html).not.toContain('QUINTO')
    expect(r.html).not.toContain('<p></p>')
  })

  it('la firma se repite por titular, en columnas', () => {
    const r = htmlDelDocumento(DJ, MINIMA, { nombre_solicitante: 'ANA', nombre_solicitante_2: 'LUIS' }, CTX)
    expect(r.html).toContain('<div class="firmas firmas-2"><div class="firma"><hr class="raya-firma"><p>ANA [N.° DE CÉDULA]</p></div><div class="firma"><hr class="raya-firma"><p>LUIS [N.° DE CÉDULA]</p></div></div>')
  })

  it('tabla de dos columnas: etiqueta sombreada y valor', () => {
    const r = htmlDelDocumento(DJ, `|! Factura | {{numero_factura}} |\n\n${MINIMA}`, { numero_factura: 'F1' }, CTX)
    expect(r.html).toContain('<td class="c-etiqueta">Factura</td><td class="c-valor">F1</td>')
  })

  it('la v1 de SOENA resuelve sin errores con datos vacíos (marcadores)', () => {
    const r = htmlDelDocumento(DJ, DJ_V1, {}, CTX)
    expect(r.ok).toBe(true)
    expect(r.html).toContain('[NOMBRE COMPLETO DEL SOLICITANTE]')
    expect(r.html).toContain('[IVA SOLICITADO]')
    expect(r.html).not.toMatch(/al mil/i)
  })
})
