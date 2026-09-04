---
name: presupuesto-vs-ejecutado
description: PR #529 — el bloque de Ejecución ya cuenta la cantidad y separa sobrecosto de margen; pero el arreglo de horas no mueve ninguna cifra hoy y quedan tres huecos vivos
metadata:
  type: project
---

El motor de "Presupuesto vs Ejecutado" del detalle de negocio se corrigió el 2026-09-04
(PR #529, mergeado, `866f951`). La aritmética vive en `src/lib/negocios/presupuesto-ejecucion.ts`.

**Why:** el presupuesto salía **794 veces más chico** en el caso real que lo destapó
(COT-2026-0002), y la barra "Total" medía margen mientras decía medir presupuesto.

**How to apply — lo que hay que saber antes de volver a tocar este bloque:**

- **La suma de los rubros DEBE cuadrar con `cotizaciones.costo_total`.** Es el contrato
  con `recalcularTotales` (`cotizacion-actions.ts`), que es quien llena esa columna.
  Si se cambia la fórmula aquí sin cambiarla allá, el bloque miente y nada avisa.
  Verificado el 2026-09-04 contra las 6 cotizaciones aceptadas: cuadran las 6.
- **`presupuestoCosto` y `precioAprobado` son cosas distintas y la pantalla lo dice.**
  Sobrecosto contra el primero, margen contra el segundo. No fusionarlas otra vez.
- **Invariante que sostiene las barras:** cada gasto cuenta contra UN rubro o ninguno.
  Si se agrega una categoría al mapa, revisar que no quede contando dos veces.

## ⚠️ Tres cosas que siguen abiertas (medidas, no supuestas)

1. **El arreglo de las horas no mueve ninguna cifra todavía.** El único negocio con
   cotización aceptada Y horas registradas tiene esa hora con `staff_id` nulo → tarifa 0.
   Los otros 38 registros de horas viven en negocios de un workspace de demostración
   **sin cotización aceptada**. El rubro dejó de mentir; hoy no hay a quién mostrárselo.
2. **La tarifa es `salary / 160` con default 0**, y hay 41 filas de `staff` con salario
   en 0: esas horas cuestan cero pase lo que pase. Fuera del alcance del #529.
3. **El gasto en categorías sin rubro sigue sin aparecer** (`comision` es la categoría
   más común de la base, 151 filas, y no tiene rubro equivalente). Es un hueco declarado
   en el código, no un olvido.

## ⚠️ El caso de prueba NO está en el workspace `metrik`

`COT-2026-0002` con `costo_total = 56.479.070,02` vive en el workspace
`971a4e80-e923-4a29-8730-f40b88e4be4e`. Buscarla con el **filtro de workspace obligatorio**
de `.claude/rules/agent-cerebro.md` (`a21bfc88…`, que es `metrik`) devuelve **null**, y ese
null se lee como "el brief está desactualizado" cuando lo que pasa es que el dato es de
otro tenant. Además el consecutivo **se repite entre workspaces**: hay cuatro
`COT-2026-0002` en la base. Al medir un caso que llega en un encargo, buscarlo primero sin
filtro para ver **de qué workspace es**, y recién entonces acotar.

Relacionado: [[cotizacion-margen-rubros]], [[medir-antes-de-construir]],
[[pruebas-por-mutacion]].
