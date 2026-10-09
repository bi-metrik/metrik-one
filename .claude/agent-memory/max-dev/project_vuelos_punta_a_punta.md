---
name: vuelos-punta-a-punta
description: Brief Trappvel 2026-10-08 (COT-2026-0025) — los 4 tramos SÍ salen con los datos de hoy; un vuelo ahora lleva el check va/no va (fueraDelPrecio acepta vuelo); el PDF avisa texto revisado viejo
metadata:
  type: project
---

Rama `fix/vuelos-de-punta-a-punta`, sin migración, NO mergear (brief: reportar).

- **No se reprodujo la falta**: con el volcado, el PDF imprime los 4 tramos en main y con el código del 06-oct
  (e614e290), en las 8 combinaciones de `va_en_propuesta`, con y sin `items.tramos`, con fotos. Lo que SÍ estaba
  mal en ese PDF: el TOTAL no era el de la Recomendada (`valor_total` viejo: el último recálculo tenía más costo), el segundo traslado (ADZ) compite en la misma ranura y no se cobra, y «Incluido» (IA revisada) dice
  Avianca con bodega cuando la lectura dice solo artículo personal. La huella del texto no coincide con las líneas.
- **Check de vuelo**: `puedeQuedarFueraDelPrecio` = sugerible O vuelo; `itemsSugeridos` filtra solo sugeribles (un
  vuelo fuera nunca va a «Opcionales»). Reemplaza la regla «un vuelo fuera del precio se ignora». Guard de mover
  grupo: a vuelo solo desde vuelo. Antes del merge: medir en prod que no haya vuelos con `entra_al_precio=false`
  (con la regla nueva saldrían del precio solos).
- Volcados de prod NO se commitean ni anonimizados: el clasificador niega escribirlos al repo (ver
  [[fixture-de-produccion-bloquea-push]]). El caso fijo se escribió a mano.
- Arnés reutilizable: `test/cotizacion-pdf-doble.ts` (doble que escribe, proyecta embeds de las acciones de cotización).

**Why:** Mauricio pidió control de quitar/poner vuelos y la causa del reporte de Alejandra.
**How to apply:** si vuelve «faltan vuelos», pedir el PDF guardado (sbext one-documentos) y el activity_log antes de
tocar el armado; reproducir con el volcado y el doble en un test temporal.

Relacionado: [[project-limpieza-presentar-trappvel]], [[cobertura-opciones-cotizacion]], [[tres-tarifas-y-tabla-de-vuelos]].
