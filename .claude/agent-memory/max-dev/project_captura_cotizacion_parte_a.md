---
name: captura-cotizacion-parte-a
description: "#839 (Trappvel, 2026-09-23) — montos es-CO del pantallazo, el clic «va en propuesta» que se perdía y tipos de itinerarios; la Parte B del brief espera a Mauricio"
metadata:
  type: project
---

PR [#839](https://github.com/bi-metrik/metrik-one/pull/839). Parte A del brief
`proyectos/trappvel/clarity/docs/diseno/brief-max-captura-cotizacion-2026-09-23.md`.
**Sin migración.** La Parte B (ranura como entidad, cargos por opción, tramos del vuelo,
recargo configurable) va en #847: ver [[captura-cotizacion-parte-b]].

## A1 · el modelo a veces deja el punto de miles

`value` es STRING en el esquema de Gemini y el prompt pide «sin separadores», pero el modelo
no lo cumple siempre: en el ensayo devolvió `"50.080"`, `"64.200"` y `"64200"` para el mismo
campo. **Todo número que venga de una lectura pasa por `parseMontoCop`**, nunca por
`Number(x.replace(...))`. Piso de verosimilitud: `cifraInverosimil` / `cifrasPorRevisar`
(`lectura-pantallazo.ts`, `ficha-linea.ts`), solo pesos, < $1.000.

⚠️ **Las lecturas viejas quedan a medias.** El PDF se arregla solo (relee el texto crudo),
pero `items.descripcion` y `notasCliente` tienen el «50,08 COP» escrito como texto al leer:
solo cambian si se vuelve a leer el pantallazo.

El mismo patrón en SOENA (`BloqueFacturacion`, la tarifa UPME desde la factura, la cola, el
010, el auto_fill y la propuesta) se cerró en #842: ver [[soena-parse-monto-cop]].

## A2 · la casilla no se apaga con `isPending`

Causa medida con `vercel logs`: 2 POST para 3 clics. Reglas en
`src/lib/cotizaciones/marcas-en-propuesta.ts` (anotación optimista + cola en
`tabla-combinaciones.tsx`). ⚠️ Si alguien vuelve a poner `isPending` en el `disabled` de esa
casilla, vuelve el bug: lo fija `tabla-combinaciones-marca-render.test.ts`, que dobla
`useTransition` en pendiente.

## A3

`motivo_codigo`/`motivo_texto` existen desde el 2026-09-21 (versión `20260921150454`). ⚠️ El
archivo de esa migración sigue en `proyectos/trappvel/clarity/migrations/…-APLICADA.sql`, no
en `supabase/migrations/`: por eso el brief creyó que faltaba. Moverlo sigue pendiente, en PR
aparte (llevaría un archivo de migración y frena el merge).

Relacionado: [[registro-decisiones-combinacion]], [[recomendada-tarifa-elegida]],
[[vercel-logs-por-cli]], [[qa-pantalla-viva-cdp]].
