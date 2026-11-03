---
name: funciones-puerta-cerrada
description: Puerta cerrada al iniciar como campo de la ficha de experiencia (Sabor, 26-oct): migración 20261026220000 SIN aplicar; columna + lista fija de llaves de funcion_guardar_experiencia
metadata:
  type: project
---

La bienvenida al grupo solo avisa la puerta cerrada si `funcion_experiencias.puerta_cerrada` es true (boolean not null
default false). La llegada 10 min antes sigue fija. Migración `20261026220000_funciones_puerta_cerrada.sql` **SIN
aplicar** (PR feat/funciones-puerta-opcional); dry-run `node scripts/funciones-puerta-cerrada-dry-run.mjs`.

**Why:** Mauricio (decisions.md, 26-oct) y Paula: «aplica solo a las películas… En los talleres no aplica». Una cata no
puede salir con la puerta cerrada, por eso ausente/nulo = false.

**How to apply:**
- `funcion_guardar_experiencia` valida llaves con lista FIJA y la ficha son columnas: todo campo nuevo de la ficha
  lleva migración (columna + lista + insert/update + `funcion_panel_campana`). No hay jsonb libre.
- `datos.ts` lee `puerta_cerrada` en COLUMNAS_FICHA: si el código llega a prod antes que la migración, las
  experiencias no cargan (módulo apagado, pero migrar ANTES del merge).
- El dry-run firma `funcion_guardar_experiencia` con el primer perfil del equipo (claims locales a la transacción),
  porque `funcion_actor` sin uid devuelve 'servidor' y guardar exige 'equipo'.
- Choca en texto (no en funciones SQL) con #1298 (plazo 0): ambos tocan textos*.ts, actions.ts y funciones-sql.test.ts.
  Relacionado: [[funciones-mapa-salon]].
