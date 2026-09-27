---
name: avisos-dia-habil
description: Avisos automaticos al cliente solo en dia habil de su pais (#935) — migracion SIN aplicar al abrir el PR; 4 edge functions a desplegar; v_cartera la tiene #934
metadata:
  type: project
---

Decision de Mauricio (2026-09-27): todo aviso automatico al cliente sale en dia habil del pais
del cliente; si cae en dia no habil se corre al siguiente habil. PR #935 (con el remate de #929).

- Regla en `src/lib/dates/dias-habiles.ts` + copia Deno `_shared/dias-habiles.ts` (una prueba
  compara las dos dia por dia). Pais = `workspaces.pais` (columna nueva, default CO). Otro pais sin
  calendario: solo fines de semana.
- **Evento puntual** (notificar-etapa) = se GUARDA: fila `diferido` en `avisos_cliente` +
  cron `avisos-cliente-diferidos` que llama `{liberar_diferidos:true}`.
- **Alerta de estado** (W25, alertas-plazo, enlace de pago) = se salta; el cron del dia habil
  siguiente la recalcula. El enlace de pago se corta ANTES de generar: generado y sin correo se pierde.
- **Periodica** (W29 lunes, W33 mar/vie) = `debeSalirHoy` + cron diario `wa-alertas-corridas`.
  Los crons viejos NO se volvieron diarios a proposito: con el codigo viejo desplegado mandaria el
  resumen todos los dias. Un cron nuevo con accion nueva es seguro en cualquier orden (el viejo da 400).

**Why:** el orden migracion -> merge -> deploy deja ventanas; todo lo que la migracion encienda
tiene que ser inocuo con el codigo viejo.

**How to apply:** tras aplicar y mergear, desplegar wa-webhook, wa-alerts, notificar-etapa y
alertas-plazo desde origin/main. `v_cartera_negocio` la reescribio #934 el mismo dia: no tocarla
desde otra migracion sin releer `pg_get_viewdef` en el momento (cambio entre dos lecturas mias).
Aviso interno al equipo del workspace y notificaciones in-app quedaron fuera a proposito.
