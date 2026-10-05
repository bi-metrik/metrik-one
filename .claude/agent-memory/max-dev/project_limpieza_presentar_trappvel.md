---
name: project-limpieza-presentar-trappvel
description: Brief Trappvel 2026-10-05 «limpieza antes de presentar» (puntos 0–18), rama feat/trappvel-limpieza-cotizacion SIN mergear, sin migración — tres estados de actividad sin columna, el día ya no es interruptor, cuadre por pasajero mueve COT-0018 un peso
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-05-limpieza-antes-de-presentar.md`. PR sin mergear (Mauricio
lo mergea); sin migración.

- **Actividad Incluida / Opcional / No va SIN columna nueva**: incluida = `entra_al_precio`; opcional = fuera del precio y
  `mostrar_en_sugeridos`; no va = fuera y oculta, CONSERVA `dia_relativo`. Lo único que no cabía (una «No va» sin día, ¿era
  incluida u opcional?) va en `tarifa_pax.noVa.era` (leído por `leerTarifaPax`, si no se pierde en la siguiente escritura).
  Reglas puras en `actividad-en-cotizacion.ts`; acción `marcarActividadEnCotizacion` (itinerario-actions).
- **Reemplaza la regla del 2026-09-14 «el día es el interruptor»**: `fueraDelPrecio` ya no exige «sin día», una línea fuera
  del precio no entra a `diasDelItinerario` ni a `hayDiasAsignados`, e `itemsSugeridos` = SOLO lo fuera del precio. El aviso
  rojo (`avisoSugeridosQueCobran`) queda vivo solo para un llamador que olvide pasar `entra_al_precio`. Medido en prod el
  2026-10-05: 0 ítems con día / `entra_al_precio=false` / `mostrar=false`, y 0 grupos fuera de Trappvel.
- ⚠️ El texto del panel genérico «Vacío = sugerida» quedó VIEJO a propósito: está en el golden R6 de Termotech.
- ⚠️⚠️ **Punto 11 mueve plata por pesos**: el precio de una línea vendida por pasajero es la suma de los precios por pasajero
  redondeados (`cuadre-pasajero.ts`, campo `pasajeros` de la cascada, armado en los TRES constructores: recalcularTotales,
  editor, `contextoDeCotizacion`). COT-2026-0018 pasa de 17.917.166 a 17.917.165 en su próximo recálculo; COT-0017 −1.
- Punto 8: la detección de tipo moría en MAX_TOKENS porque Gemini se enreda en una letra con TILDE dentro de un string
  («San Andr\n\n\n…»); con `thinkingBudget: 0` pasa en 2 de 19 capturas del banco. Se rescata el tipo de la respuesta cortada.
- Punto 13: `recalcularTotales` escribía TODAS las líneas en serie en cada recálculo; ahora solo las que cambian, en
  paralelo (`patch-recalculo.ts`). «Aceptar» manda `Server-Timing` por etapa: medir ahí en producción.
- Punto 14 («Confirmar» al primer clic) NO se reprodujo: solo se puso «Cargando el costo…» en el botón.

**Why:** Mauricio quiere presentar con todo integrado; la aceptación (10 criterios) la hace la sesión principal en prod.
**How to apply:** si piden «volver a que sin día sea sugerida», es deshacer `itemsSugeridos`, no tocar `fueraDelPrecio`.

Relacionado: [[dia-relativo-sugeridos]], [[entra-al-precio]], [[project-detalles-pantalla-va-no-va]].
