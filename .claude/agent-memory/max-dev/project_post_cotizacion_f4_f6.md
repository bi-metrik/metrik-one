---
name: post-cotizacion-f4-f6
description: Post-cotización Trappvel ola 5 (2026-10-12) — F4 entrega (#1131, migración contacto_documentos SIN aplicar), F6 cierre (#1133), «Así puedes pagar» (#1129), cierres F3 (#1128), extracción instanciarBloquesDeEtapa (#1132)
metadata:
  type: project
---

Pila de la ola 5: #1117 → #1119 → #1128 → #1131 (F4) → #1133 (F6, que además trae #1132 por merge). #1129 y #1132
van contra `main`. Retarget a `main` antes de cada merge. **#1131 trae la migración
`20261012220000_contacto_documentos.sql`: aplicarla antes del merge.**

**Why:** decisiones que no se ven en el código:
- Interruptores nuevos: `entrega_viaje.activo` (F4), `cierre_viaje.activo` y `etapas_por_fecha` (F6). Los gates
  (`vouchers_completos`, `documentos_viajero`, `cobro_minimo`, `paquete_enviado`, `margen_confirmado`,
  `postventa_completa`) son opt-in por etapa en `etapas_negocio.config_extra.gates`.
- Internacional/nacional sale de `destino_tipo` del bloque de la etapa 1; sin dato, el gate de documentos no frena.
- El recargo del pago por link sigue en 0 en el cierre (el riel no lo registra aparte): con recargo, hoy sale como
  saldo a favor. Pendiente de F2-7.
- El paquete anexa los vouchers (PDF o foto) con pdf-lib; los que no se leen se nombran en `sinAnexar`.
- Sin la herramienta SendMessage en el subagente: el aviso «#1117 verde» no se pudo mandar a la sesión principal.

**How to apply:**
- El doble de las e2e de viaje no aplica defaults de columnas: `vigente` y `valor_por_pagar` se escriben explícitos.
- Antes de encender F6: SQL de config en las descripciones de #1131 y #1133 (sobre el clon primero, Vera C14).
- Pendientes de Vera: lectura real del pasaporte (D-8), revisión de Ren (paquete, encuesta), medir «Mis
  pendientes» ≤ 2 s, 390 px en el ONE construido, F3-8 con el número de Alejandra.

Relacionado: [[post-cotizacion-f3-f5]], [[post-cotizacion-f2]], [[pruebas-por-mutacion]].
