---
name: aprobacion-fuera-de-tarifa
description: SOE-004 (2026-10-08) — con tarifas, la propuesta se emite con cualquier valor; fuera de la tarifa (recargo o > tope) solo aprueba owner/admin/supervisor con motivo; sin migración
metadata:
  type: project
---

Con tarifas por plan y ruta ([[tarifas-plan-ruta]]) el tope de la versión YA NO frena al generar: frena al
APROBAR. Regla única en `motivoAprobacionTarifaRechazada` (`src/lib/propuesta/gate-descuento.ts`), usada por
`aprobarVersionPropuesta` (4º parámetro `motivo`) y `corregirAprobacion`. Marca en `data.aprobado_fuera_de_tarifa`
(motivo, base, cap, descuento_pct; negativo = recargo). El esquema anterior (negocios previos al 1-oct) sigue
con `motivoDescuentoRechazado`: tope duro y sin recargos, ni para el dueño.

**Why:** #977 convirtió el tope del 25 % en muro para todos y el umbral 50 % quedó mudo; Daniela (admin) no
podía poner $450.000 en V0570. Mauricio pidió extender la aprobación gerencial a recargos.

**How to apply:**
- El «reseteo» que reportan es el estado local del editor: el valor tecleado solo se guarda al generar. Si
  generar está bloqueado, al salir de la ficha vuelve la última versión. No es una escritura del servidor.
- El PR quedó sin mergear (brief PROHIBIDO). Lectura de prod por PostgREST negada por el clasificador ese día:
  el estado de V0570 no se verificó.
