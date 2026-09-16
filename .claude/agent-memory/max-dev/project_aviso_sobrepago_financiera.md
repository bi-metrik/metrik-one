---
name: aviso-sobrepago-financiera
description: #734 mergeado 2026-09-15 y config SOENA SIN aplicar; el orden deploy → config → apagar conciliar_sobrepago no es negociable; V0498 dispara un sobrepago falso por una tarifa mal tecleada
metadata:
  type: project
---

El aviso de sobrepago a la financiera (PR #734, squash `389d8604`, mergeado 2026-09-15 22:44Z)
esta en `main` y **inerte**: la clave `config_extra.aviso_sobrepago` no esta en ninguna linea.
El SQL de activacion de SOENA vive en `docs/specs/2026-09-15_aviso-sobrepago-financiera.md`.

**Why:** Mauricio decidio que un sobrepago no detiene la gestion (V0442 cayo a Cartera por
$17.188). El plan tiene dos pasos y el segundo depende del primero: apagar
`conciliar_sobrepago` en Cartera hace que `debeSaltarPorSaldo` vuelva a `saldo <= 0` y el
sobrepago salte la etapa. Si se apaga antes de encender el aviso, nadie ve esos sobrepagos.

**How to apply:**
- Orden: deploy de Vercel en Ready → SQL de la linea GIT EV/HEV → recien ahi apagar
  `conciliar_sobrepago`. Si alguien pide el paso 2, verificar primero que la clave este puesta.
- ⚠️ **CADUCO lo de V0498** (re-medido 2026-09-16, #738): su tarifa ya esta en `770.159`,
  el valor a recaudar en $1.195.159 y el saldo es **$261 de FALTANTE**, no un sobrante de
  $556.628. Ya no dispara el aviso.
- Backlog medido al encender: 6 abiertos con sobrante (V0498, V0398, V0310, V0365, V0442,
  V0048). Llegan de a uno, en el siguiente avance o pago de cada caso — no de golpe.
  ⚠️ **Esa lista se re-mide antes de encender**: V0498 ya salio, y los otros cinco no se
  volvieron a comprobar.
- La idempotencia es por **monto**, en cualquier estado del aviso
  (`sobrepago:negocio:<id>:exceso:<n>:area:<a>`). Un sobrepago identico que reaparece despues
  de resuelto NO se vuelve a avisar: limite aceptado, escrito en el modulo.
- No hay trigger: el criterio es `descuadreConciliacion` en TypeScript, asi que el disparo
  cuelga de seis sitios de codigo. El avance (`cambiarEtapaNegocioConGate`) es la red de
  seguridad; `reevaluarBloquesCobros` concentra los caminos de `negocio-v2-actions`. Un camino
  nuevo que meta plata a un negocio sin pasar por ninguno de los dos avisa tarde (en el
  siguiente avance), no nunca.
- El enlace `/conciliacion?pestana=saldos&saldo=sobrante` depende de que `page.tsx` lea los
  parametros (`destino-inicial.ts`). Si alguien vuelve a hacer la pagina sin `searchParams`,
  el aviso aterriza en "Por confirmar" sin error.

Relacionado: [[pruebas-por-mutacion]] (9 de 9 mutaciones tumbaron pruebas),
[[medir-antes-de-construir]], [[gate-recaudo-facturacion]].
