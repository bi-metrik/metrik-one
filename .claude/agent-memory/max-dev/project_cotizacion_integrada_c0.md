---
name: cotizacion-integrada-c0
description: C0 de la cotización integrada Trappvel (2026-10-12) — fixture de igualdad del servidor grabado sobre 54568adf que NO se regenera; presupuesto de idas V5; P12/N12/COT-0025/P7 confirmados; la línea base PW (V1) choca con «preview = base de producción»
metadata:
  type: project
---

PR de C0 (rama `feat/cotizacion-integrada-c0`): `igualdad-servidor-e2e.test.ts` + `igualdad-servidor.fixture.json`,
caso fijo anonimizado en `test/caso-san-andres.ts`, doble con registro en `test/igualdad-servidor-doble.ts`.

**Why:** Vera (criterios N1, N2, V5) exige que C1–C7 den exactamente lo que daba `origin/main` en recálculo, PDF,
precio de cada tarifa y aprobación, para Termotech/genérica y Trappvel con el interruptor apagado y encendido.

**How to apply:**
- El fixture NO se regenera para que pase. Si una pieza lo cambia, el PR no entra. Bajar un número del presupuesto
  de idas sí se puede, a mano y dicho en el PR. «Aceptar en lote» y «Deshacer» entran al presupuesto con su pieza.
- Las props del PDF se capturan envolviendo `compositorDePlantilla` (Trappvel) y `renderToBuffer` (las demás);
  la primera captura gana porque el compositor renderiza varias veces por dentro.
- Mutación de control que sí cae: `itemsDelItinerario` ignorando la selección NO combinable (Premium −$800.000).
  Termotech no la ve (no tiene ranuras): para ella sirve ignorar el descuento comercial.
- P12: hoy NO hay regla «falta el precio del niño»; la bandeja crea la opción con `pendiente` y lo que frena
  Enviar/Aprobar es `faltaCosto` (línea sin costo ni precio en una tarifa marcada), solo con piso en la salida.
  El bloqueo de V4 («no crea servicio») es regla nueva: la aprueba Mauricio.
- COT-0025: con la Recomendada `va_en_propuesta`, cualquier `recalcularTotales` deja su total; ninguna acción
  marca sin recalcular, así que un total viejo con la Recomendada marcada = marca escrita fuera de las acciones
  (SQL) o un ítem `es_ajuste` (rama LEGADO que ignora la principal). Abrir la página no recalcula.
- V1 por Playwright en el preview escribiría en producción (preview = base de prod,
  [[project-preview-abre-workspace]]): se reportó la línea base de servidor por `vercel metrics` y se pidió decisión.

Relacionado: [[project-recomendada-tarifa-elegida]], [[project-vuelos-punta-a-punta]].
