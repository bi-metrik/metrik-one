---
name: valida-mensajes-error
description: Errores de Valida en llano (mensajes-error.ts) y busqueda_incompleta que no entra a valida_consultas (2026-10-21, fix/valida-mensajes-error)
metadata:
  type: project
---

Todo error que pinta /valida pasa por `mensajeErrorValida` (`src/lib/valida/mensajes-error.ts`): código conocido →
frase; frase (empieza en mayúscula y tiene espacios, como los de la puerta CDA) → tal cual; lo demás → genérico, con
el código como «Detalle técnico». Un código nuevo del motor se agrega a `MENSAJES_ERROR_VALIDA`.

`busqueda_incompleta` (503 de metrik-valida#66) NO se inserta en `valida_consultas`, ni en la puntual ni en el lote,
igual que el corte de la bolsa. **Why:** Valida no la registró ni la cobró, y una fila severidad='error' se veía como un
resultado en el historial; Mauricio prefirió no insertarla antes que rotularla. Nada cuenta consumo con esas filas
(sale de `cuenta/consumo` de Valida); el score las ignoraba de todos modos con `reintentar`.

**How to apply:** el lote deja la fila en `estado='error'`, `resultado_error='busqueda_incompleta'`, sin consulta; el
XLSX dice «No completada, reintenta». Las filas `error` previas al fix (si las hubo entre el merge de #66 y este PR)
no se distinguen: `valida_consultas` no guarda el código. Ver [[novedades-tablero]].
