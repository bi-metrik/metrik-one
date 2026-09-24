/**
 * Lo que ve en `/suscripcion` quien maneja la suscripción de un CDA, renderizado.
 *
 * Prueba de render a propósito: las reglas (`pago-pendiente.ts`, `estado.ts`, `reglas.ts`) pueden
 * estar bien y el JSX pintar otra cosa. Se fija:
 *   - la tarjeta de pago: monto, periodo, vencimiento, IVA y un botón «Pagar en línea» que abre el
 *     enlace en otra pestaña; sin enlace dice cuándo llega; vencido, lo dice; al día, lo dice;
 *   - la pestaña Pagos: cuotas (tabla y tarjetas del teléfono), factura y recibo por la ruta
 *     autorizada, estado vacío;
 *   - la pestaña Usuarios: contador con el valor del contrato y lo que se puede hacer en cada fila;
 *   - NINGÚN texto de la sección nombra a un proveedor de pagos.
 *
 * Se queda en `.ts`: `vitest.config.ts` solo recoge `*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }))
// Las acciones arrastran `server-only` y el cliente de Supabase; la pantalla solo necesita sus referencias.
vi.mock('./acciones', () => ({
  cambiarRolEnEspacio: async () => ({ ok: true }),
  comprarUsuarioAdicional: async () => ({ ok: true, licencias: 3 }),
  cotizarUsuarioAdicional: async () => ({ ok: false, error: 'x' }),
  invitarAlEspacio: async () => ({ ok: true, correoEnviado: true }),
  reenviarInvitacionEspacio: async () => ({ ok: true }),
  retirarDelEspacio: async () => ({ ok: true, sesionCerrada: true, licenciaLiberada: false, desdeCuota: null }),
  descartarSustenta: async () => ({ ok: true }),
  pedirContactoDeSustenta: async () => ({ ok: true, yaExistia: false, nombre: 'Ana' }),
  registrarEventoSustenta: async () => {},
}))

const { TarjetaPago } = await import('./tarjeta-pago')
const { PestanaPagos } = await import('./pestana-pagos')
const { UsuariosPanel } = await import('./usuarios-panel')
const { default: SuscripcionClient } = await import('./suscripcion-client')
const { ResumenLicencias, iniciales } = await import('./resumen-licencias')

function texto(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Un proveedor de pagos nombrado en lo que se ve (el href del enlace no cuenta: es el dato). */
const PROVEEDOR = /\b(bold|epayco|wompi|payu)\b/i

describe('la tarjeta de pago', () => {
  const LINK = 'https://checkout.bold.co/payment/LNK_PRUEBA'
  const pendiente = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      React.createElement(TarjetaPago, {
        lectura: {
          estado: 'ok',
          pago: {
            estado: 'pendiente',
            numero: 1,
            concepto: 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS) · periodo del 23-sep al 22-oct',
            fechaVencimiento: '2026-09-30',
            monto: 150000,
            abonado: 0,
            saldo: 150000,
            vencida: false,
            enlacePago: LINK,
            enlaceVencido: false,
            ...extra,
          },
        },
      }),
    )

  it('monto, periodo, vencimiento y que no lleva IVA', () => {
    const t = texto(pendiente())
    expect(t).toContain('$150.000')
    expect(t).toContain('periodo del 23-sep al 22-oct')
    expect(t).toContain('Vence el 30/09/2026')
    // Redacción de Felipe (2026-09-24), literal.
    expect(t).toContain('Servicio excluido de IVA (art. 476 num. 21 ET, computación en la nube)')
  })

  it('ningún texto del CDA llama «licencia» al servicio', () => {
    expect(texto(pendiente())).not.toMatch(/licencia/i)
  })

  it('«Pagar en línea» abre el enlace en otra pestaña, sin pasar la página de origen', () => {
    const html = pendiente()
    const boton = /<a[^>]*>Pagar en línea<\/a>/.exec(html)?.[0] ?? ''
    expect(boton).toContain(`href="${LINK}"`)
    expect(boton).toContain('target="_blank"')
    expect(boton).toContain('rel="noopener noreferrer"')
    expect(texto(html)).not.toMatch(PROVEEDOR)
  })

  it('sin enlace no hay botón: dice antes de cuándo llega', () => {
    const html = pendiente({ enlacePago: null })
    expect(html).not.toMatch(/>Pagar en línea</)
    expect(texto(html)).toContain('El enlace de pago estará disponible antes del 30/09/2026.')
  })

  it('sin enlace y con la cuota ya vencida: no promete una fecha pasada', () => {
    const html = pendiente({ enlacePago: null, vencida: true })
    const sinEnlace = texto(/<p[^>]*data-sin-enlace[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? '')
    expect(html).not.toMatch(/>Pagar en línea</)
    expect(sinEnlace).toBe('MéTRIK te enviará el enlace de pago de esta cuota.')
    expect(texto(html)).not.toContain('estará disponible antes')
  })

  it('con el enlace vencido tampoco: dice que venció (vencida o no la cuota)', () => {
    for (const vencida of [false, true]) {
      const t = texto(pendiente({ enlacePago: null, enlaceVencido: true, vencida }))
      expect(t).toContain('El enlace de pago de esta cuota venció. MéTRIK te enviará uno nuevo.')
      expect(t).not.toContain('estará disponible antes')
    }
  })

  it('la marca se escribe MéTRIK en lo que se ve', () => {
    for (const extra of [{ enlacePago: null }, { enlacePago: null, vencida: true }, { enlacePago: null, enlaceVencido: true }]) {
      expect(texto(pendiente(extra))).not.toMatch(/MeTRIK|METRIK/)
    }
  })

  it('una cuota vencida lo dice, y un abono parcial también', () => {
    const t = texto(pendiente({ vencida: true, abonado: 50000, saldo: 100000 }))
    expect(t).toContain('Pago vencido')
    expect(t).toContain('Venció el 30/09/2026')
    expect(t).toContain('$100.000')
    expect(t).toContain('Ya abonaste $50.000 de $150.000.')
  })

  it('al día lo dice; sin cuotas no inventa nada; sin lectura lo dice', () => {
    const alDia = renderToStaticMarkup(
      React.createElement(TarjetaPago, { lectura: { estado: 'ok', pago: { estado: 'al_dia', cuotasPagadas: 1 } } }),
    )
    expect(texto(alDia)).toContain('Tu suscripción está al día.')
    const sinCuotas = renderToStaticMarkup(
      React.createElement(TarjetaPago, { lectura: { estado: 'ok', pago: { estado: 'sin_cuotas' } } }),
    )
    expect(sinCuotas).toBe('')
    const caida = renderToStaticMarkup(
      React.createElement(TarjetaPago, { lectura: { estado: 'no_disponible', motivo: 'base' } }),
    )
    expect(texto(caida)).toContain('No se pudo cargar tu próximo pago')
  })
})

describe('la pestaña Pagos', () => {
  const cuota = {
    cuotaId: '55555555-5555-4555-8555-555555555555',
    numero: 1,
    concepto: 'Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026',
    fechaVencimiento: '2026-09-30',
    monto: 150000,
    abonado: 0,
    saldo: 150000,
    estado: 'vencida' as const,
    enlacePago: 'https://checkout.bold.co/payment/LNK_1',
    factura: { numero: 'FE-123', pdf: true, xml: true },
  }
  const html = renderToStaticMarkup(
    React.createElement(PestanaPagos, {
      carga: {
        estado: 'ok',
        cuotas: [cuota, { ...cuota, cuotaId: null, numero: 2, estado: 'pendiente', enlacePago: null, factura: null }],
        pagos: [
          { cobroId: 'b91b4a14-cce1-4cfa-88d5-f235aa9e1060', fecha: '2026-09-25', monto: 150000, fuente: 'bold', estado: 'pagado', reciboNumero: 'RC-1', reciboDescargable: true },
        ],
      },
    }),
  )
  const t = texto(html)

  it('la nota de IVA es la de Felipe, literal', () => {
    expect(t).toContain('Servicio excluido de IVA (art. 476 num. 21 ET, computación en la nube)')
  })

  it('cada cuota con su periodo, valor, vencimiento y estado, en tabla y en tarjetas del teléfono', () => {
    expect(t).toContain('Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026')
    expect(t).toContain('30/09/2026')
    expect(t).toContain('Vencida')
    expect(t).toContain('Pendiente')
    expect(html).toContain('data-cuota-movil="1"')
    expect(html).toContain('data-cuota="1"')
  })

  it('«Pagar en línea» abre el enlace; la factura baja por la ruta autorizada, nunca por el bucket', () => {
    expect(html).toContain('href="https://checkout.bold.co/payment/LNK_1"')
    expect(html).toContain('target="_blank"')
    expect(t).toContain('Pagar en línea')
    expect(html).toContain('href="/api/valida/archivo/factura_pdf/55555555-5555-4555-8555-555555555555"')
    expect(html).toContain('href="/api/valida/archivo/factura_xml/55555555-5555-4555-8555-555555555555"')
    expect(html).not.toContain('facturas/')
  })

  it('el recibo baja por la misma ruta y el medio no nombra al proveedor', () => {
    expect(html).toContain('href="/api/valida/archivo/recibo/b91b4a14-cce1-4cfa-88d5-f235aa9e1060"')
    expect(t).toContain('RC-1')
    expect(t).toContain('Pago en línea')
    expect(t).not.toMatch(PROVEEDOR)
  })

  it('sin cuotas, el estado vacío del diseño', () => {
    const vacio = texto(renderToStaticMarkup(React.createElement(PestanaPagos, { carga: { estado: 'ok', cuotas: [], pagos: [] } })))
    expect(vacio).toContain('Aquí vas a ver cada cuota con su factura electrónica.')
  })

  it('sin acceso lo dice, en vez de una lista vacía', () => {
    const sin = texto(renderToStaticMarkup(React.createElement(PestanaPagos, { carga: { estado: 'sin_acceso', razon: 'Los pagos los ven el dueño.' } })))
    expect(sin).toBe('Los pagos los ven el dueño.')
  })
})

describe('la pestaña Usuarios', () => {
  const base = { correo: 'a@cda.co', ultimoIngreso: '2026-09-20T12:00:00Z', ultimoIngresoTexto: '20 sept 2026' }
  const lista = [
    { ...base, id: 'u1', nombre: 'Alba Rosas', role: 'owner', acciones: { puedeRetirar: false, puedeCambiarRol: false, puedeReenviar: false, nota: 'Eres tú' } },
    {
      ...base,
      id: 'u2',
      nombre: 'Beto Díaz',
      role: 'operator',
      ultimoIngreso: null,
      ultimoIngresoTexto: null,
      acciones: { puedeRetirar: true, puedeCambiarRol: true, puedeReenviar: true, nota: null },
    },
  ]
  const html = renderToStaticMarkup(
    React.createElement(UsuariosPanel, {
      datos: {
        lista,
        cupo: { licencias: 2, usados: 2, libres: 0 },
        valorAdicional: 50000,
        adicionalesVigentes: 0,
        licenciasContrato: 2,
      },
    }),
  )
  const t = texto(html)

  it('el contador dice los usuarios en uso y el valor del usuario adicional del contrato', () => {
    expect(t).toContain('2 de 2 usuarios en uso · $50.000 por usuario adicional al mes')
    expect(t).not.toMatch(/licencia/i)
  })

  it('cada fila dice lo que se puede hacer; la propia no se retira', () => {
    expect(t).toContain('Alba Rosas')
    expect(t).toContain('Eres tú')
    expect(t).toContain('Invitación pendiente')
    expect(t).toContain('Reenviar invitación')
    expect(html.match(/Retirar usuario/g)?.length).toBe(1)
    expect(t).toContain('Agregar usuario')
  })

  it('sin valor del contrato, no inventa un precio', () => {
    const sinValor = texto(
      renderToStaticMarkup(
        React.createElement(UsuariosPanel, {
          datos: { lista, cupo: { licencias: 2, usados: 2, libres: 0 }, valorAdicional: null, adicionalesVigentes: 0, licenciasContrato: 2 },
        }),
      ),
    )
    expect(sinValor).toContain('2 de 2 usuarios en uso')
    expect(sinValor).not.toMatch(/\$/)
  })

  it('en «Ver como» (solo lectura) se ve la lista, sin «Agregar usuario»', () => {
    const lectura = texto(
      renderToStaticMarkup(
        React.createElement(UsuariosPanel, {
          datos: {
            lista,
            cupo: { licencias: 2, usados: 2, libres: 0 },
            valorAdicional: 50000,
            adicionalesVigentes: 0,
            licenciasContrato: 2,
            soloLectura: true,
          },
        }),
      ),
    )
    expect(lectura).toContain('Beto Díaz')
    expect(lectura).not.toContain('Agregar usuario')
  })
})

describe('el Resumen', () => {
  const pintar = (extra: Record<string, unknown> = {}) =>
    texto(
      renderToStaticMarkup(
        React.createElement(SuscripcionClient, {
          tabInicial: 'resumen',
          principal: null,
          licencias: { usados: 2, total: 2 },
          terminosResumen: 'Aceptados el 25 sept 2026 por Alba Rosas.',
          sustenta: 'oferta',
          pagos: null,
          terminos: null,
          usuarios: { lista: [], cupo: null, valorAdicional: null, adicionalesVigentes: 0, licenciasContrato: null },
          ...extra,
        }),
      ),
    )

  it('las cuatro pestañas, las licencias en uso, los términos y Sustenta al final', () => {
    const t = pintar()
    for (const p of ['Resumen', 'Pagos', 'Usuarios', 'Términos']) expect(t).toContain(p)
    expect(t).toContain('Usuarios 2 de 2 en uso')
    expect(t).toContain('Aceptados el 25 sept 2026 por Alba Rosas.')
    expect(t).toContain('Sustenta sostiene todo tu SARLAFT')
    expect(t).toContain('Ahora no')
    expect(t.indexOf('2 de 2 en uso')).toBeLessThan(t.indexOf('Sustenta sostiene'))
    expect(t).not.toMatch(/[!¡]/)
    expect(t).not.toMatch(PROVEEDOR)
  })

  it('a quien ya pidió la demostración le queda la confirmación, no la oferta; con «Ahora no» vigente, nada', () => {
    const solicitada = pintar({ sustenta: 'solicitada' })
    expect(solicitada).not.toContain('Sustenta sostiene')
    expect(solicitada).toContain('Ya recibimos tu solicitud. Te escribiremos para agendar la demostración.')
    const oculta = pintar({ sustenta: null })
    expect(oculta).not.toContain('Sustenta')
  })
})

describe('el bloque de licencias del Resumen', () => {
  const persona = (n: number) => ({ id: `u${n}`, nombre: `Persona Numero${n}`, correo: null })
  const html = (usados: number, total: number) =>
    renderToStaticMarkup(
      React.createElement(ResumenLicencias, {
        usados,
        total,
        personas: Array.from({ length: usados }, (_, i) => persona(i + 1)),
        onVerUsuarios: () => {},
      }),
    )
  const cuenta = (h: string, marca: string) => h.split(`${marca}="`).length - 1

  it('sin barra de progreso: un avatar por usuario y ningún círculo libre si está lleno', () => {
    const h = html(2, 2)
    expect(h).not.toMatch(/style="width/)
    expect(h).not.toContain('bg-papel')
    expect(cuenta(h, 'data-avatar-licencia')).toBe(2)
    expect(cuenta(h, 'data-licencia-libre')).toBe(0)
    expect(h).toContain('aria-label="2 de 2 usuarios en uso"')
    expect(texto(h)).toContain('Usuarios 2 de 2 en uso')
    expect(texto(h)).toContain('PN')
    expect(texto(h)).toContain('Ver usuarios')
    // Lleno está bien: ni alerta ni advertencia.
    expect(h).not.toMatch(/alerta|advertencia|amber|red-/)
  })

  it('un círculo punteado por licencia libre', () => {
    const h = html(2, 3)
    expect(cuenta(h, 'data-avatar-licencia')).toBe(2)
    expect(cuenta(h, 'data-licencia-libre')).toBe(1)
    expect(h).toContain('border-dashed')
    expect(texto(h)).toContain('2 de 3 en uso')
  })

  it('con más de cuatro usuarios, cuatro avatares y «+N»', () => {
    const h = html(6, 6)
    expect(cuenta(h, 'data-avatar-licencia')).toBe(4)
    expect(h).toContain('data-avatar-mas')
    expect(texto(h)).toContain('+2')
  })

  it('las iniciales salen del nombre, o del correo si no hay nombre', () => {
    expect(iniciales('Alba Rosas')).toBe('AR')
    expect(iniciales('Alba María Rosas Pérez')).toBe('AP')
    expect(iniciales('alba')).toBe('AL')
    expect(iniciales('  ', 'zoe@cda.co')).toBe('Z')
  })
})
