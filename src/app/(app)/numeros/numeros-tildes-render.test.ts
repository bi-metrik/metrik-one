/**
 * El copy de `/numeros` sale RENDERIZADO con sus tildes.
 *
 * Disparador (2026-09-10): Mauricio tomó capturas de `/numeros` en producción para
 * publicarlas en metrik.com.co y el título decía «Mis Numeros» y el rótulo de la
 * tarjeta de arriba a la izquierda «MARGEN DE CONTRIBUCION». Esa tarjeta lleva
 * `uppercase` de CSS, que conserva la tilde: el defecto estaba en el literal del
 * fuente, no en el estilo.
 *
 * ⚠️ Por qué RENDER y no un `grep` sobre el fuente: un grep prueba que el literal
 * está escrito bien, no que ESE literal sea el que la pantalla pinta. Media docena
 * de estas cadenas viven en ramas condicionales (`saldoEsReal`, `mcLineas`,
 * `regimenFiscal`, los tres tramos de runway) y una de ellas —el placeholder de
 * «Completa los pendientes»— está hoy en una rama INALCANZABLE (`showCards` es la
 * constante `true`). Sin renderizar no se distingue «corregido y visible» de
 * «corregido y muerto». Precedente: `recaudo-cambiado-banner.test.ts` (#569) y
 * `conciliacion/tarjeta-retenido-render.test.ts` (#581).
 *
 * ⚠️ Se queda en `.ts`, NO `.tsx`: el `include` de `vitest.config.ts` es
 * `src/**\/*.test.ts` y renombrarlo saca el archivo de la suite EN SILENCIO.
 *
 * ⚠️ Límite declarado: `renderToStaticMarkup` corre en el entorno `node` de vitest,
 * sin DOM y sin efectos. Alcanza para el primer render, que es donde vive todo el
 * copy. Lo que NO cubre: el `Semáforo` (su import está comentado en el cliente, así
 * que su copy en `actions-v2.ts` no se pinta hoy) ni la franja/diálogo de saldo, que
 * cuelgan de `FEATURES.CONCILIACION`, hoy en `false`. Esas cadenas se corrigieron
 * igual y quedan cubiertas por `SIN_TILDE` el día que se enciendan.
 *
 * ⚠️ Mutaciones MEDIDAS el 2026-09-10 (revertir el literal en el fuente, correr la
 * suite, restaurar). Línea base: 11 verdes, 0 rojas.
 *   · `Mis Números` → `Mis Numeros` (cliente) ................ 3 rojas / 8 verdes
 *   · `Margen de contribución` → `…cion` (cliente) ........... 2 rojas / 9 verdes
 *   · `>Proyección<` → `>Proyeccion<` (drill P1) ............. 1 roja  / 10 verdes
 *   · `label="Días restantes"` → `"Dias…"` (drill P4) ........ 1 roja  / 10 verdes
 * Las cuatro cayeron. Los conteos son los medidos, no los estimados: la primera
 * lectura a ojo decía 3/3/2/2 y dos estaban mal.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// `actions-v2.ts` es `'use server'` y arrastra `get-workspace` + el cliente de
// Supabase al importarse. Acá no se ejecuta ninguna de sus funciones: el cliente
// solo las llama al navegar de mes y el diálogo al guardar.
vi.mock('./actions-v2', () => ({
  getNumeros: async () => null,
  actualizarSaldo: async () => ({ success: true }),
}))

// Lo único que el cliente necesita de Next en el primer render.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}))

const { default: NumerosV2Client } = await import('./numeros-v2-client')
const { default: DrillDownSheet } = await import('./drill-down-sheet')

import type { NumerosData } from './actions-v2'

// ── Fixture ───────────────────────────────────────────
// Valores elegidos para que TODAS las ramas con copy acentuado se pinten:
// `saldoEsReal` (Último saldo), `metaRecaudo` + mes en curso (Proyección),
// `mcLineas` (MC por línea), `componenteNomina`/`staffNomina` (Nómina),
// `utilidad > 0` (Provisión impuestos + cálculo exacto) y ventas por debajo del
// punto de equilibrio con días de mes por delante (Días restantes).
const base: NumerosData = {
  saldoCaja: 12_000_000,
  saldoEsReal: true,
  recaudoMes: 8_000_000,
  recaudoTercerosMes: 1_000_000,
  metaRecaudo: 20_000_000,
  recaudoMesAnterior: 6_000_000,

  ingresosMes: 30_000_000,
  gastosMes: 10_000_000,
  gastosProyectosMes: 4_000_000,
  utilidad: 5_000_000,
  ingresosMesAnterior: 25_000_000,
  gastosMesAnterior: 9_000_000,

  carteraPendiente: 7_000_000,
  honorarioAprobado: 20_000_000,
  honorarioRecaudado: 13_000_000,
  carteraNegocios: 3,
  carteraMesAnterior: 8_000_000,
  carteraDetalle: [
    { negocioNombre: 'Caso de prueba', negocioCodigo: 'V0001', honorario: 5_000_000, recaudado: 1_000_000, saldo: 4_000_000, dias: 42 },
  ],

  ventasMes: 12_000_000,
  metaVentas: 40_000_000,
  costosFijosMes: 15_000_000,
  componenteNomina: 9_000_000,
  componenteOperativo: 6_000_000,
  staffNomina: [{ nombre: 'Persona de prueba', salario: 9_000_000 }],
  costosVariablesMes: 10_000_000,
  margenContribucion: 0.66,
  mcMonto: 20_000_000,
  ebitda: 5_000_000,
  fijosTotalMes: 15_000_000,
  mcNegociosTop: [
    { negocioId: 'n1', codigo: 'V0001', nombre: 'Caso de prueba', precio: 5_000_000, costosVariables: 1_000_000, mc: 4_000_000, mcPct: 0.8, estado: 'abierto' },
  ],
  mcLineas: [
    { lineaId: 'l1', lineaNombre: 'Línea de prueba', lineaTipo: 'clarity', ingresos: 20_000_000, costosVariables: 6_000_000, mc: 14_000_000, mcPct: 0.7 },
    { lineaId: null, lineaNombre: null, lineaTipo: null, ingresos: 0, costosVariables: 4_000_000, mc: -4_000_000, mcPct: null },
  ],
  puntoEquilibrio: 22_000_000,

  runwayMeses: 4.2,
  gastoPromedioMensual: 3_000_000,
  gastoTotalMensual: 18_000_000,

  cxpTotal: 0,
  cxpCount: 0,

  pipelineActivo: 0,
  valorContratado: 0,

  semaforo: {
    capa1Score: 100,
    capa1Estado: 'green',
    capa1Pendientes: [],
    capa2Estado: 'green',
    capa2Razon: null,
    estadoFinal: 'green',
    mensaje: 'Todo al día',
  },

  conciliacion: null,

  totalDeduciblesMes: 0,
  regimenFiscal: null,
  gastosDeduciblesMes: 0,
  gastosSinSoporteMes: 0,

  mesRef: mesEnCurso(),
  diaActual: 10,
  diasDelMes: 30,
  nombreUsuario: 'Persona de prueba',

  rentabilidadComercialMode: false,
}

function mesEnCurso(): string {
  const hoy = new Date()
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
}

const pintarPantalla = (data: NumerosData | null = base) =>
  renderToStaticMarkup(React.createElement(NumerosV2Client, { initialData: data }))

const pintarDrill = (questionNumber: 1 | 2 | 3 | 4 | 5, data: NumerosData = base) =>
  renderToStaticMarkup(
    React.createElement(DrillDownSheet, {
      questionNumber,
      data,
      monthType: 'current' as const,
      onClose: () => {},
    }),
  )

/**
 * Las formas SIN tilde que no pueden volver a aparecer en el HTML de esta pantalla.
 * Es la red que atrapa una regresión futura escrita en cualquier rama, no solo en
 * las que este archivo pinta hoy a propósito.
 */
const SIN_TILDE = [
  'Mis Numeros',
  'contribucion',
  'Proyeccion',
  'Ultimo saldo',
  'Nomina',
  'Provision impuestos',
  'calculo exacto',
  'regimen',
  'Variacion',
  'Minimo',
  'venta minima',
  'Dias restantes',
  'Interpretacion',
  'Enfocate',
  'Atencion',
  'Sin linea',
  'MC por linea',
  'gestion operativa',
  'asesoria',
  'tus numeros',
  'automaticamente',
]

function sinFaltas(html: string) {
  for (const forma of SIN_TILDE) {
    expect(html, `apareció «${forma}» sin tilde en el HTML renderizado`).not.toContain(forma)
  }
}

// ── La pantalla ───────────────────────────────────────

describe('/numeros — el copy de la pantalla', () => {
  it('el título dice «Mis Números», con tilde', () => {
    const html = pintarPantalla()
    expect(html).toContain('Mis Números')
    expect(html).not.toContain('Mis Numeros')
  })

  it('el rótulo de la tarjeta de arriba a la izquierda dice «Margen de contribución»', () => {
    const html = pintarPantalla()
    // El `uppercase` lo pone el CSS (y conserva la tilde): el literal va capitalizado.
    expect(html).toContain('Margen de contribución')
    expect(html).toContain('uppercase')
  })

  it('no queda ninguna de las formas sin tilde en el HTML de la pantalla', () => {
    sinFaltas(pintarPantalla())
  })

  it('el onboarding vacío también sale con tildes', () => {
    const html = pintarPantalla(null)
    expect(html).toContain('Bienvenido a Mis Números')
    expect(html).toContain('Para que tus números cobren vida')
    expect(html).toContain('se activan automáticamente')
    sinFaltas(html)
  })
})

// ── Los paneles de cada pregunta ──────────────────────

describe('/numeros — el copy de los paneles (drill-down)', () => {
  it('P1 pinta «Último saldo reportado», «Proyección» y «(día N/M)»', () => {
    const html = pintarDrill(1)
    expect(html).toContain('Último saldo reportado')
    expect(html).toContain('Proyección')
    expect(html).toContain('Al ritmo actual (día 10/30)')
    sinFaltas(html)
  })

  it('P2 pinta «Margen de contribución», «MC por línea», «Sin línea» y «Nómina»', () => {
    const html = pintarDrill(2)
    expect(html).toContain('Margen de contribución y EBITDA')
    expect(html).toContain('MC por línea (mes actual)')
    expect(html).toContain('Sin línea (costos no asignados)')
    expect(html).toContain('(-) Nómina (Mi Equipo)')
    expect(html).toContain('(-) Provisión impuestos')
    expect(html).toContain('para el cálculo exacto')
    expect(html).toContain('Variación')
    // Componente compartido: el disclaimer fiscal, que también se ve en /revision,
    // /movimientos y /nuevo/gasto.
    expect(html).toContain('gestión operativa')
    expect(html).toContain('asesoría de tu contador')
    sinFaltas(html)
  })

  it('P2 pinta «Configura tu régimen fiscal» cuando el workspace no lo declaró', () => {
    const html = pintarDrill(2, { ...base, regimenFiscal: null })
    expect(html).toContain('Configura tu régimen fiscal')
    sinFaltas(html)
  })

  it('P2 pinta «Tu régimen (SIMPLE)» en el régimen simple', () => {
    const html = pintarDrill(2, { ...base, regimenFiscal: 'simple' })
    expect(html).toContain('Tu régimen (SIMPLE)')
    sinFaltas(html)
  })

  it('P3 no tiene faltas', () => {
    sinFaltas(pintarDrill(3))
  })

  it('P4 pinta «Mínimo que necesitas vender», «Nómina» y «Días restantes»', () => {
    const html = pintarDrill(4)
    expect(html).toContain('👥 Nómina (Mi Equipo)')
    expect(html).toContain('Mínimo que necesitas vender')
    expect(html).toContain('Gastos fijos / Margen de contribución')
    expect(html).toContain('Es la venta mínima mensual')
    expect(html).toContain('vs Mínimo necesario')
    expect(html).toContain('Días restantes')
    expect(html).toContain('20 días')
    sinFaltas(html)
  })

  it('P5 pinta «Si gastas más», «Interpretación» y los tres tramos de reserva', () => {
    const holgado = pintarDrill(5, { ...base, runwayMeses: 9 })
    expect(holgado).toContain('Si gastas más (+20%)')
    expect(holgado).toContain('Interpretación')
    sinFaltas(holgado)

    const moderado = pintarDrill(5, { ...base, runwayMeses: 4.2 })
    expect(moderado).toContain('Enfócate en aumentar ingresos')
    sinFaltas(moderado)

    const bajo = pintarDrill(5, { ...base, runwayMeses: 1.5 })
    expect(bajo).toContain('Atención: reserva baja')
    sinFaltas(bajo)
  })
})
