---
name: cargue-segundo-plano
description: Brief blindaje de red (2026-10-05) — procesarDocumento/reprocesarDocumento leen con after() y marca data._lectura; emisión de factura y acciones largas (fases 2 y 3)
metadata:
  type: project
---

Brief `proyectos/soena/ve/2026-10-05_brief-max-blindaje-red-cargue-y-acciones-largas.md`. Fase 1 = #1035
(sin migración). La falla sigue al operador (Claro/Telmex 24 errores/10.000 GET), no al servidor.

**Decisiones no obvias de la fase 1:**
- La marca vive en `negocio_bloques.data._lectura` (sin migración). Mientras lee, el bloque queda
  `pendiente` porque `puede_avanzar_etapa` SOLO mira `estado`; se repone `estado_previo` al fallar.
  Una segunda marca hereda el `estado_previo` de la primera (el `pendiente` lo puso la marca).
- «Gana el último»: chequeo de token antes de lo destructivo + update con
  `.eq('data->_lectura->>token', t)` y `.select('id')` para saber si escribió.
- La marca se escribe con el cliente de SESIÓN: `trg_avisar_documento_cargado` exige `auth.uid()`.
- Vencida = 90 s medidos con el reloj del SERVIDOR (la ruta devuelve `vencida`); el teléfono puede
  tener la hora corrida.
- Dobles de pruebas de documento-actions ahora APLICAN los updates y resuelven rutas JSON
  (`valorEnRuta`): sin eso la lectura se cree reemplazada y se retira.

**Why:** p95 20,1 s del cargue en SOENA; las actions van en fila y una larga bloquea la pestaña.

**How to apply:** quien escriba `data` de un bloque documental conserva `_lectura`. `after()` no
compra tiempo: sigue el `maxDuration` de la página que llamó. Medir el después con
`vercel metrics ... --group-by server_action_name` (ver [[rum-y-lecturas-sin-actions]]).
Relacionado: [[acciones-lentas-soena]], [[recuperacion-red-iphone]].
