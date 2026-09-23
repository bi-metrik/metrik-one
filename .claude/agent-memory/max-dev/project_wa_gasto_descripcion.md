---
name: wa-gasto-descripcion
description: PR #861 (2026-09-23) gasto por WhatsApp guarda descripcion completa y mensaje_original; mergeado pero wa-webhook SIN redesplegar; handleSessionResponse arma parsed.fields vacio
metadata:
  type: project
---

PR #861 mergeado el 2026-09-23 (`35ffdeba`): `gastos.descripcion` guarda todo el detalle
del mensaje y `mensaje_original` llega en todos los caminos. **Sin migracion. `wa-webhook`
NO quedo redesplegado** (lo hace la sesion principal; brief de Yuto prohibia deploy).

**Why:** tres fugas — prompt que resumia a 2-5 palabras, tope de 40 caracteres en
`buildGastoTitle`, y los caminos por sesion (elegir destino / gasto de empresa) que
escribian `parsed_fields` desde `ctx.parsed.fields`, que `handleSessionResponse` arma
**vacio**. Los 11 gastos WA del 12 al 23-sep tienen `mensaje_original` NULL por eso.

**How to apply:**
- Todo handler que corre en reanudacion lee los datos del gasto de `session.context.parsed_fields`,
  nunca de `ctx.parsed.fields`.
- Decision de Mauricio (no reabrir): la descripcion NO se pregunta; sale de interpretar el mensaje.
- Gemini recorta palabras sueltas o el proveedor aun con instruccion: `elegirDescripcion` guarda la
  extraccion literal cuando el modelo solo recorto. Medido contra Gemini con mensajes reales.
- Las reglas del parser viven en `wa-parse-reglas.ts` (puro) y los handlers de registro ya se
  pueden importar en vitest (`gasto-guardado.test.ts` recorre handleGasto -> resume -> insert).
- Pendiente abierto: detalle en un mensaje SIN monto y monto despues se pierde (no hay borrador en sesion).

Relacionado: [[probar-handler-wa-bot]], [[wa-soporte-reencauza]].
