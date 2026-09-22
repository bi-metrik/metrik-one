---
name: margen-recargo-configurables-trappvel
description: Mi Negocio → Margen y recargo guarda de verdad desde 2026-09-22; antes el UPDATE con sesión devolvía 0 filas y la pantalla decía «guardado». Recargo solo para internacionales. Exige la migración del CHECK de activity_log ANTES del merge
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-margen-y-recargo-configurables.md`.

## ⚠️⚠️ Lo que ya existía y NO funcionaba

La sección «Margen mínimo» de Mi Negocio (PR #712) llevaba desde el 14-sep sin guardar
nada. `lineas_negocio` tiene RLS con una sola política de escritura: `false`. Un UPDATE
con el cliente de sesión **devuelve cero filas y ningún error**, el código no contaba las
filas, y el toast decía «guardado». Por eso los valores de Trappvel seguían exactos a los
del SQL de arranque (`provisional: true`). La memoria [[trappvel-reglas-reunion-15]] dice
«el recargo se enciende desde Mi Negocio, no hace falta SQL»: era falso en producción.

**Regla:** toda escritura a `lineas_negocio` desde la app va con el cliente de servicio,
rol comprobado antes, `.eq('workspace_id')` explícito y `.select('id')` para contar filas.

## Lo que quedó

- **Registro antes de escribir.** `activity_log` (`entidad_tipo='linea_negocio'`, una fila
  por valor cambiado, autor = staff). Si el registro falla, no se escribe; si la escritura
  toca 0 filas, se retiran las filas del registro. Confirmar sin cambiar también deja fila.
- **⚠️ Exige ampliar el CHECK** `activity_log_entidad_tipo_check`:
  `proyectos/trappvel/clarity/migrations/2026-09-22_activity-log-linea-negocio-PENDIENTE.sql`.
  Sin él, Edgar no puede guardar (falla cerrado, a propósito).
- **Aviso < mínimo se rechaza** (antes se permitía con una nota). Iguales sí.
- **Recargo `vuelos: 'todos' | 'internacionales'`** en `config_extra.recargo`. Ausente o
  cualquier otro valor = todos (lo de antes). «Internacional» vive en
  `vuelo-internacional.ts`: origen o destino fuera de Colombia, por código IATA y si no hay,
  por nombre de ciudad; lo que no se reconoce cuenta como internacional **y se avisa**.
  Nombres ambiguos (Armenia, Florencia, Cartagena, Providencia) sin código NO se dan por
  colombianos. Códigos que coinciden con palabras en mayúsculas (SAN, LAS, DEL, SAL) fuera
  de la lista del exterior.
- **R6:** la sección solo aparece si alguna línea declara `margen` o `recargo`.
- `aplicarRecargo` ahora re-decide en el servidor: solo borrador, no duplica, respeta
  internacionales.
- «piso» → «margen mínimo» en todos los textos que ven las operadoras.

## Lo que NO cambió (y se dice)

- Los umbrales se CONGELAN al nacer la cotización (`cotizaciones.piso_margen_pct`): un
  cambio aplica a las cotizaciones NUEVAS. Un borrador viejo recalculado conserva los suyos.
- El recargo es UNO por cotización, no uno por vuelo ni por pasajero. Pregunta abierta.

Relacionado: [[trappvel-reglas-reunion-15]], [[medir-antes-de-construir]], [[pruebas-por-mutacion]].
