/**
 * Lo que la pantalla del módulo Valida API PROMETE, renderizado.
 *
 * Prueba de render a propósito: las reglas puras (`reglas.ts`, `mapeo.ts`) pueden estar bien y el
 * JSX pintar otra cosa. Aquí se fija lo que un cliente ve:
 *
 *   - la llave en claro aparece con su aviso de «única vez» y un botón de copiar;
 *   - la entrada muestra los términos COMO TEXTO, el aviso de la Política y una sola casilla que
 *     nace sin marcar y deshabilitada (hasta leer hasta el final), con el botón «Acepto» apagado;
 *   - si Valida no responde, la pestaña dice «no disponible» y NO pinta una lista vacía;
 *   - quien no opera llaves no ve la pestaña de llaves;
 *   - ya no hay pestaña Documentos: la pestaña Términos relee, solo lectura y con el sello
 *     «Aprobado», el texto que el usuario aprobó, y si no está verificado no pinta ninguno.
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`, y renombrarlo a `.tsx` lo sacaría
 * de la suite en silencio.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
// Las acciones arrastran `server-only` y el cliente de Supabase; la pantalla solo necesita sus
// referencias para los botones.
vi.mock('@/lib/valida-api/acciones', () => ({
  aprobarEntradaValidaApi: async () => ({ ok: true, yaEstaba: false }),
  generarLlaveValidaApi: async () => ({ ok: false, error: 'x' }),
  revocarLlaveValidaApi: async () => ({ ok: false, error: 'x' }),
}))

const { EntradaValidaApi, LlaveUnaVez, PestanaTerminos, ValidaApiCliente } = await import('./valida-api-cliente')

const LLAVE = 'vld_live_1a2b3c4d5e6f_ESTA_ES_LA_LLAVE_EN_CLARO'

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

const NO_DISPONIBLE = { estado: 'no_disponible' as const, motivo: 'red' as const }
const TERMINOS_VACIOS = { estado: 'ok' as const, datos: [] }

describe('la llave en claro, una sola vez', () => {
  const html = renderToStaticMarkup(
    React.createElement(LlaveUnaVez, {
      llave: {
        keyId: 'k1',
        keyPrefix: 'vld_live_1a2b',
        nombre: 'ERP',
        llave: LLAVE,
        regenerada: false,
        anteriorDejaDeAutenticarEn: null,
      },
      onCerrar: () => {},
    }),
  )
  const t = texto(html)

  it('muestra la llave completa', () => {
    expect(t).toContain(LLAVE)
  })

  it('dice que no se vuelve a ver', () => {
    expect(t).toMatch(/única vez que vas a ver esta llave/)
    expect(t).toMatch(/no podrá mostrártela de nuevo/)
  })

  it('ofrece copiarla', () => {
    expect(t).toContain('Copiar')
  })
})

describe('si Valida no responde, la pestaña lo dice', () => {
  it('Llaves: «no disponible», no «todavía no hay llaves»', () => {
    const t = texto(
      renderToStaticMarkup(
        React.createElement(ValidaApiCliente, {
          resumen: NO_DISPONIBLE,
          llaves: NO_DISPONIBLE,
          terminos: TERMINOS_VACIOS,
          pagos: null,
          operaLlaves: true,
          vePagos: false,
        }),
      ),
    )
    expect(t).toContain('No disponible en este momento')
    expect(t).not.toContain('Todavía no hay llaves')
    // El resto del módulo sigue ahí.
    expect(t).toContain('Términos')
    expect(t).toContain('Ayuda')
  })

  it('Consumo: quien no opera llaves entra a consumo, y ve «no disponible»', () => {
    const t = texto(
      renderToStaticMarkup(
        React.createElement(ValidaApiCliente, {
          resumen: NO_DISPONIBLE,
          llaves: null,
          terminos: TERMINOS_VACIOS,
          pagos: null,
          operaLlaves: false,
          vePagos: false,
        }),
      ),
    )
    expect(t).toContain('No disponible en este momento')
    expect(t).not.toContain('consultas disponibles')
  })
})

describe('pestañas por rol', () => {
  it('sin permiso de llaves ni de pagos, esas pestañas no aparecen', () => {
    const html = renderToStaticMarkup(
      React.createElement(ValidaApiCliente, {
        resumen: NO_DISPONIBLE,
        llaves: null,
        terminos: TERMINOS_VACIOS,
        pagos: null,
        operaLlaves: false,
        vePagos: false,
      }),
    )
    const pestanas = [...html.matchAll(/role="tab"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)</g)].map((m) => m[1].trim())
    expect(pestanas).not.toContain('Llaves')
    expect(pestanas).not.toContain('Pagos')
    expect(pestanas).toEqual(['Consumo', 'Suscripción', 'Términos', 'Ayuda'])
  })

  it('con todos los permisos: Términos está y Documentos ya no', () => {
    const html = renderToStaticMarkup(
      React.createElement(ValidaApiCliente, {
        resumen: NO_DISPONIBLE,
        llaves: NO_DISPONIBLE,
        terminos: TERMINOS_VACIOS,
        pagos: { estado: 'ok', datos: [] },
        operaLlaves: true,
        vePagos: true,
      }),
    )
    const pestanas = [...html.matchAll(/role="tab"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)</g)].map((m) => m[1].trim())
    expect(pestanas).toEqual(['Llaves', 'Consumo', 'Suscripción', 'Términos', 'Pagos', 'Ayuda'])
  })

  it('la bolsa vigente se pinta con su saldo cuando Valida responde', () => {
    const t = texto(
      renderToStaticMarkup(
        React.createElement(ValidaApiCliente, {
          resumen: {
            estado: 'ok',
            datos: {
              cliente_id: '8c211c68-6c25-4beb-b364-c91c284d6379',
              consumo: {
                modalidad: 'bolsa',
                bolsa: {
                  bolsa_id: 'b1',
                  secuencia: 1,
                  estado: 'vigente',
                  bloqueada: false,
                  activada_en: '2026-09-15T00:00:00Z',
                  vence_en: '2027-03-15T00:00:00Z',
                  dias_para_vencer: 180,
                  consultas_compradas: 20000,
                  consumidas: 6,
                  saldo: 19994,
                  precio_total: 1400000,
                  pago_referencia: 'bold-TXRRP7Q95ZJ',
                },
              },
              bolsa_en_espera: null,
              bolsas: [],
              renovacion: { estado: 'sin_suscripcion' },
            },
          },
          llaves: null,
          terminos: TERMINOS_VACIOS,
          pagos: null,
          operaLlaves: false,
          vePagos: false,
        }),
      ),
    )
    expect(t).toContain('19.994')
    expect(t).toContain('consultas disponibles')
  })
})

describe('la entrada: términos vivos, Política y una sola aprobación', () => {
  const DOCUMENTO = {
    documentoId: '00000000-0000-4000-8000-0000000000e2',
    slug: 'terminos-uso-valida',
    titulo: 'Términos de Uso de VALIDA',
    version: 'v1.1',
    textoMd: '# TÉRMINOS DE USO\n\n**EL PROVEEDOR:** METRIK IA S.A.S.\n\n3.1. Las credenciales se entregan únicamente después de la aceptación.',
  }
  const POR_FIRMAR = {
    documentoId: DOCUMENTO.documentoId,
    titulo: DOCUMENTO.titulo,
    version: 'v1.1',
    pdfSha256: 'f'.repeat(64),
    empresaNombre: '4D SOFT S.A.S.',
    empresaNit: '901220269-6',
  }
  type Contrato = Parameters<typeof EntradaValidaApi>[0]['entrada']['contrato']
  const entrada = (contrato: Contrato, conflicto = false) =>
    renderToStaticMarkup(
      React.createElement(EntradaValidaApi, {
        entrada: { estado: 'pendiente', documentos: [DOCUMENTO], contrato, conflicto },
        aviso: 'Al continuar, autoriza a METRIK IA S.A.S. a tratar su correo ... v1.5.',
        politicaUrl: 'https://valida.metrik.com.co/recursos/privacidad',
        politicaTitulo: 'Política de Tratamiento de Datos Personales v1.5',
      }),
    )
  const casilla = (html: string) => /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0] ?? ''
  const botonAcepto = (html: string) => /<button[^>]*>Acepto<\/button>/.exec(html)?.[0] ?? ''

  it('los términos se leen ahí mismo, como texto, en un contenedor con scroll y su centinela al final', () => {
    const html = entrada({ estado: 'aceptado' })
    const t = texto(html)
    expect(t).toContain('TÉRMINOS DE USO')
    expect(t).toContain('3.1. Las credenciales se entregan únicamente después de la aceptación.')
    expect(html).toContain('<strong class="font-semibold">EL PROVEEDOR:</strong>')
    expect(html).toMatch(/data-terminos="true" class="[^"]*overflow-y-auto/)
    // El centinela va DENTRO del contenedor, después del texto.
    const contenedor = html.slice(html.indexOf('data-terminos'))
    expect(contenedor.indexOf('data-fin-terminos')).toBeGreaterThan(contenedor.indexOf('3.1. Las credenciales'))
    // Nada de «leer en otra pestaña» para los términos: no hay enlace al PDF.
    expect(html).not.toContain('/api/valida-api/archivo/documento/')
  })

  it('el aviso de la Política va en la misma vista, con el enlace a la versión completa', () => {
    const html = entrada({ estado: 'aceptado' })
    expect(texto(html)).toContain('Al continuar, autoriza a METRIK IA S.A.S.')
    expect(html).toContain('href="https://valida.metrik.com.co/recursos/privacidad"')
  })

  it('una sola casilla SIN marcar y deshabilitada hasta leer, un solo botón «Acepto» apagado', () => {
    const html = entrada({ estado: 'aceptado' })
    expect(html.match(/type="checkbox"/g)).toHaveLength(1)
    expect(casilla(html)).not.toMatch(/checked=""/)
    expect(casilla(html)).toMatch(/disabled/)
    expect(botonAcepto(html)).toMatch(/disabled/)
    expect(texto(html)).toContain('Lee hasta el final para poder aceptar.')
    expect(texto(html)).toContain('Leí hasta el final «Términos de Uso de VALIDA» (v1.1)')
    // Sin firma pendiente, no se piden datos personales.
    expect(html).not.toContain('name="cedula"')
  })

  it('el dueño con el contrato pendiente firma en la misma pantalla: nombre, cédula, calidad', () => {
    const html = entrada({ estado: 'pendiente', puede: true, empresas: ['4D SOFT S.A.S.'], porFirmar: [POR_FIRMAR] })
    expect(html).toContain('name="nombre"')
    expect(html).toContain('name="cedula"')
    expect(texto(html)).toContain('Representante legal')
    expect(texto(html)).toContain('Apoderado')
    expect(html.match(/type="checkbox"/g)).toHaveLength(1)
    expect(casilla(html)).toMatch(/disabled/)
    expect(botonAcepto(html)).toMatch(/disabled/)
    expect(texto(html)).toContain('tengo facultades para obligar a 4D SOFT S.A.S.')
  })

  it('quien no es dueño ve los términos y el aviso, pero no puede aprobar', () => {
    const html = entrada({ estado: 'pendiente', puede: false, razon: 'no_owner' })
    expect(texto(html)).toContain('3.1. Las credenciales se entregan')
    expect(texto(html)).toContain('Al continuar, autoriza a METRIK IA S.A.S.')
    expect(texto(html)).toContain('El dueño del espacio, que es quien puede obligar a la empresa, todavía no ha aceptado')
    expect(html).not.toContain('type="checkbox"')
    expect(botonAcepto(html)).toBe('')
    expect(html).not.toContain('name="cedula"')
    // Tampoco se le promete que leyendo hasta el final podrá aceptar.
    expect(texto(html)).not.toContain('para poder aceptar')
  })

  it('el soporte de MeTRIK ve que el contrato no le toca', () => {
    const html = entrada({ estado: 'pendiente', puede: false, razon: 'soporte' })
    expect(texto(html)).toContain('como soporte de MeTRIK')
    expect(html).not.toContain('type="checkbox"')
  })

  it('con un conflicto de constancias no se ofrece aprobar', () => {
    const html = entrada({ estado: 'aceptado' }, true)
    expect(texto(html)).toContain('mismo nombre y versión')
    expect(html).not.toContain('type="checkbox"')
  })

  it('los textos propios no llevan guion largo', () => {
    const html = entrada({ estado: 'pendiente', puede: true, empresas: ['4D SOFT S.A.S.'], porFirmar: [POR_FIRMAR] })
    expect(texto(html)).not.toMatch(/[—–]/)
  })
})

describe('Términos: releer lo aprobado, solo lectura', () => {
  const TEXTO = '# TÉRMINOS DE USO\n\n**EL PROVEEDOR:** METRIK IA S.A.S.\n\n3.1. Las credenciales se entregan únicamente después de la aceptación.'
  const verificado = {
    estado: 'verificado' as const,
    documentoId: '00000000-0000-4000-8000-0000000000e2',
    titulo: 'Términos de Uso de VALIDA',
    version: 'v1.0',
    textoMd: TEXTO,
    aprobadoAt: '2026-09-16T19:27:28.420248+00:00',
    contrato: { aceptadoAt: '2026-09-15T13:25:06Z', aceptadoPor: 'Juan Guillermo', canal: 'whatsapp' as const },
  }
  const pintar = (datos: Parameters<typeof PestanaTerminos>[0]['carga']) => renderToStaticMarkup(React.createElement(PestanaTerminos, { carga: datos }))

  it('muestra el texto aprobado con el mismo render de la entrada y el sello «Aprobado» con su fecha', () => {
    const html = pintar({ estado: 'ok', datos: [verificado] })
    const t = texto(html)
    // El sello dice «Aprobado» por sí mismo, no solo la línea de la fecha.
    const sello = /<span data-sello-aprobado[^>]*>([\s\S]*?)<\/span>/.exec(html)?.[1] ?? ''
    expect(texto(sello)).toBe('Aprobado')
    expect(t).toContain('Términos de Uso de VALIDA · v1.0')
    // 19:27 UTC = 2:27 p. m. en Bogotá: la fecha es la de la aprobación del usuario, en hora Colombia.
    expect(t).toMatch(/Aprobado por ti el 16 de sept\.? de 2026, 0?2:27\s?p\.\s?m\. \(hora Colombia\)/)
    expect(t).toContain('3.1. Las credenciales se entregan únicamente después de la aceptación.')
    expect(html).toContain('<strong class="font-semibold">EL PROVEEDOR:</strong>')
  })

  it('dice quién aceptó el contrato y por qué canal', () => {
    const t = texto(pintar({ estado: 'ok', datos: [verificado] }))
    expect(t).toContain('Contrato aceptado el')
    expect(t).toContain('por Juan Guillermo, por WhatsApp.')
    const sinContrato = texto(pintar({ estado: 'ok', datos: [{ ...verificado, contrato: null }] }))
    expect(sinContrato).not.toContain('Contrato aceptado')
  })

  it('es solo lectura: sin casilla, sin botón, sin PDF y con el scroll normal de la página', () => {
    const html = pintar({ estado: 'ok', datos: [verificado] })
    expect(html).not.toContain('type="checkbox"')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('/api/valida-api/archivo/')
    expect(html).not.toContain('overflow-y-auto')
    expect(html).not.toContain('data-fin-terminos')
  })

  it('si el texto no se pudo verificar, lo dice y no pinta ningún texto de términos', () => {
    const html = pintar({
      estado: 'ok',
      datos: [{ estado: 'no_verificado', titulo: 'Términos de Uso de VALIDA', version: 'v1.0', aprobadoAt: verificado.aprobadoAt, motivo: 'huella_distinta' }],
    })
    const t = texto(html)
    expect(t).toContain('No podemos mostrar el texto que aprobaste de «Términos de Uso de VALIDA» (v1.0)')
    expect(html).not.toContain('data-sello-aprobado')
    expect(t).not.toContain('3.1. Las credenciales')
  })

  it('si no se pudo leer, «no disponible»; sin aprobaciones, lo dice en vez de una lista vacía', () => {
    expect(texto(pintar({ estado: 'no_disponible', motivo: 'base' }))).toContain('No disponible en este momento')
    expect(texto(pintar({ estado: 'ok', datos: [] }))).toContain('No encontramos términos aprobados por ti')
  })

  it('los textos propios no llevan guion largo', () => {
    const html = pintar({
      estado: 'ok',
      datos: [
        { ...verificado, textoMd: '3.1. Texto.' },
        { estado: 'no_verificado', titulo: null, version: 'v2.0', aprobadoAt: verificado.aprobadoAt, motivo: 'version_no_encontrada' },
      ],
    })
    expect(texto(html)).not.toMatch(/[—–]/)
  })
})
