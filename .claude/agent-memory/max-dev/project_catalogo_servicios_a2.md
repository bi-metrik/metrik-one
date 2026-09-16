---
name: catalogo-servicios-a2
description: PR #741 (A2) mergeado y migración APLICADA: el catálogo tiene las 4 fichas en v1 y servicios_contratados sigue en 0 filas (2026-09-16); un NULL en un CHECK deja pasar
metadata:
  type: project
---

Entrega A2 de `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md`, abierta el
2026-09-16 como **PR #741**, con los **7 checks en verde**. **Sin mergear**, porque trae
migración: lo decide Mauricio.

⚠️ **CADUCÓ lo de «sin mergear / sin aplicar»** (2026-09-16): #741 está en `main`, las 6 tablas existen en producción, `catalogo_servicios` tiene `licencia-clarity`, `licencia-sustenta`, `valida-api-bolsa` y `valida-cda-licencia` en v1, y `servicios_contratados` está en **0 filas** (los contratos son A3).

**Estado que no se ve en el código:**
- `20260916120000_catalogo_y_servicios_contratados.sql` **sin aplicar**. Es DDL puro, cero
  filas. Sin ella las dos rutas nuevas dan 500 y `/servicios` muestra su aviso de error;
  **nada de lo que ya funciona se rompe**, porque ninguna pantalla vieja lee esas tablas.
- `CATALOGO_SYNC_SECRET` **no existe en ningún lado**. Hasta que exista con el **mismo valor**
  en Vercel (producción) y en los secrets de `bi-metrik/metrik-system`, las dos rutas responden
  **503 a todo el mundo**, que es el comportamiento correcto.
- La Action del cerebro y los 4 archivos de catálogo viven en `docs/catalogo-servicios/`,
  **preparados y sin instalar**. Van a `bi-metrik/metrik-system`: los `.md` los escribe Kaori,
  el workflow lo instala Mik.
- ⚠️ **Falta una decisión del cerebro.** `valida-cda-licencia.md` cita
  `decisiones/2026-09-15_comisiones-afi-por-tipo-de-servicio`, que **no existe como archivo**:
  hoy vive en la fila del 2026-09-15 de `proyectos/metrik/one/decisions.md`. La Action **falla
  si el slug citado no existe**, así que ese archivo no se puede publicar hasta que Kaori lo
  capture. Los otros tres slugs sí existen.

**Why:** dos defectos que la lectura del SQL no mostraba y que solo aparecieron al **correr la
migración** con PGlite:
1. `catalogo_servicios` y `catalogo_servicios_versiones` **se apuntan** (la FK del servicio a su
   versión vigente va diferida), así que **fuera de una transacción no hay orden de inserts que
   funcione**: en autocommit cada sentencia se valida sola. De ahí sale
   `registrar_version_catalogo`, y por eso la ruta hace **una** llamada y no dos inserts.
2. **Un NULL dentro de un CHECK deja pasar.** `comision_coherente` con `{"modo":"porcentaje"}`
   sin `pct` daba NULL y el CHECK **aceptaba justo el caso que existe para rechazar**. Cada
   comparación va envuelta en `coalesce(..., false)`.

**How to apply:**
- Todo CHECK que lea `jsonb` va envuelto en `coalesce(..., false)`: un CHECK solo rechaza con
  FALSE, y con NULL deja pasar. Es la misma familia que «un valor ausente nunca autoriza».
- La comisión se calcula **solo** con `src/lib/servicios/comision.ts`: admite monto fijo (AFI,
  $50.000 por licencia de CDA) y porcentaje (20 % del paquete de Valida API). El **modo se
  escribe, no se deduce** de qué campo vino lleno. **`contactos.comision_porcentaje` (10 por
  defecto) no alimenta nada**: sería el valor global que N3 prohíbe.
- **Nada nace con IVA del 19 %:** `tratamiento_iva` es obligatorio y sin default, y un
  `gravado` sin `iva_pct` se rechaza. El esquema está en `src/lib/catalogo/definicion.ts`,
  **única autoridad**: la Action no revalida, solo comprueba que las decisiones citadas
  existan como archivo (lo único que ella ve y ONE no).
- Un archivo de catálogo con `comision` o `precio` se **rechaza con el motivo**.
- El frontmatter del catálogo **no es YAML**: es una gramática cerrada
  (`src/lib/catalogo/frontmatter.ts`) que rechaza con la línea lo que no entiende. **Una
  descripción con coma va entre comillas** o parte el mapa en línea.
- A2 le puso a `workspace_modulos.servicio_contratado_id` la llave foránea que A1 dejó abierta.
  Lo que sigue pendiente de A3 es el CHECK en la otra dirección.

Relacionado: [[modulos-gate-ruta-a1]], [[suscripciones-cobro-automatico]], [[ensayo-sql-pglite]].
