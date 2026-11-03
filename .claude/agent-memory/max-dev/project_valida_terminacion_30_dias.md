---
name: project-valida-terminacion-30-dias
description: Terminación de Valida autoservicio a los 30 días de suspensión (11.2), paso 8c del cron; APAGADA en prod (TERMINACION_30_DIAS_APROBADA=false); reportes abiertos tras terminar por la puerta `libre`
metadata:
  type: project
---

PR feat/valida-terminacion-30-dias (2026-10-29, pedido de Mauricio). `terminacion.ts` + `terminacion-servidor.ts`,
paso 8c de `procesar-planes-cobro`. Sin migración: estado en `config_extra.valida_plan.terminacion`
(`por_terminar` = ensayo en prod; `terminada`). El pago que levanta la suspensión abre un ciclo nuevo y reemplaza
`valida_plan` entero, y con eso la marca desaparece sola.

**Why:** la 11.2 (v2.1/v2.2) promete terminar y pedir a la pasarela borrar el medio de pago; no estaba construido.
Encender es otro PR, después de que Vera y Emilio lo aprueben.

**How to apply:**
- Conteo: días de Bogotá COMPLETOS. Bolsa a medianoche → ese día cuenta; corte por reverso a mitad del día → empieza
  el día siguiente. Termina el primer día completo + 30. Emilio tiene que confirmarlo.
- «Sin pago que la levante»: un cobro pagado de cuota > `plan.cuota_numero`, o el recobro pagado, con el ciclo sin
  abrir (Valida caída) NO termina (va a `sinDeuda`). Por mora además tiene que haber una cuota vencida sin pagar.
- No llama a Valida. Revocar la llave o cerrar el cliente cortaría los reportes (#83 exige cliente activo).
- Hallazgo: la puerta (`puerta.ts`, `REGLA_MORA_AUTOSERVICIO`) YA pausa Valida entera (reportes incluidos) a D+40 por
  mora, y por reverso cuenta desde el vencimiento de la cuota, no desde el corte. Con el contrato `terminado` la
  puerta lo filtra (`ESTADOS_SIN_TERMINOS`) → `libre` → los reportes REABREN. Se dejó así a propósito: lo decide Emilio.
- Sigue abierto: un enlace de pago vigente (`generarEnlacePagoCuota` no mira el estado del contrato) se puede pagar
  después de la terminación. El pago queda registrado y no abre nada. Lo atiende una persona.
- Ver [[project-valida-reverso-corta-plan]] y [[project-valida-terminos-v2-2-reverso]].
