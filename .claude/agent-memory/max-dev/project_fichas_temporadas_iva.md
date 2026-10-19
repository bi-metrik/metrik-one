---
name: fichas-temporadas-iva
description: Trappvel 2026-10-19 (feat/trappvel-fichas-temporadas-iva) — ficha completa = por clasificar, alias al cambiar ciudad, temporadas en Configuración, IVA del proveedor por línea (items.iva_costo_pct), extracciones del motor; migración 20261019120000 SIN aplicar (solo DDL, antes del merge)
metadata:
  type: project
---

Brief de Mauricio del 2026-10-19 (decisiones en `proyectos/trappvel/clarity/decisions.md`). Un solo PR, una
migración `20261019120000_proveedores_temporadas_iva.sql` (solo DDL, nada de datos) que va ANTES del merge: la lista
y la ficha nombran las columnas nuevas en `COLUMNAS_PROVEEDOR` y sin ellas «Proveedores» dice «falta la migración».

- **IVA del proveedor**: costo SIEMPRE sin IVA; `items.iva_costo_pct` (19/NULL) lo suma `costosDelItem` en los 4
  armadores de la cascada. `recalcularTotales` guarda `subtotal` con `costoUnitarioSinIva` (si no, el IVA se compone en
  cada recálculo; gotcha en `docs/gotchas.md`). La casilla vive en `iva-costos-actions.ts`; al abrir la cotización
  sincroniza (escribe solo en borrador y con rol que escribe). Huecos conocidos: `precioDeLineaConManuales` (precios
  de fila a mano) mide contra el costo sin IVA; el PDF no dice «IVA incluido en el costo».
- **Ficha completa** (`completitud.ts`, usa DIVIPOLA → solo servidor): ciudad sin nota «Ciudad por confirmar», país,
  municipio y no departamento en CO, tipo ≠ «otro». Departamento/destino NO se exigen (nadie los tiene aún). No hay
  selector de proveedores en la cotización: «no se cotiza» = aviso en la tarjeta + lista «Por clasificar».
- `pedidoDeLinea` (lib) es el pedido de la tarjeta Y del servidor: no duplicar esa derivación.
- Punto 6: extracciones se SUBEN como JSON en la ficha (server-only). Haiku por AI Gateway quedó como plan en el PR
  (no hay `ai`/`@ai-sdk` en el repo; la instrucción vive en `~/datos-clientes/trappvel/motor-extraccion/instruccion/`).

**How to apply:** si Mauricio cambia la definición de ficha completa, tocar `faltasDeFicha` y sus pruebas, nada más.
Antes de agregar otro lector de costos de ítem, pasar por `costosDelItem`. Ver [[proveedores-ficha]].
