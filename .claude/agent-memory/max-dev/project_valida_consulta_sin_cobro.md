---
name: project-valida-consulta-sin-cobro
description: Consulta sin cobro de Valida (marca firmada con VALIDA_SIN_COBRO_SECRET) y el reproceso de tipo de documento de AFI que la usa; orden de merges y gotchas
metadata:
  type: project
---

Valida acepta una «consulta sin cobro» solo de MéTRIK (aprobado por Mauricio 2026-10-23): encabezados `X-Valida-Sin-Cobro` (HMAC de `${t}.${motivo}\n${cuerpo}` con `VALIDA_SIN_COBRO_SECRET`, ventana 300 s) y `X-Valida-Sin-Cobro-Motivo` (ASCII). Fila con billable=false, costo 0 y `consultas.sin_cobro_motivo` (migración Valida 0041, CHECK). Marca inválida = 403 `sin_cobro_no_autorizado`, nunca se degrada a cobrada. Existe para el reproceso de ~750 filas de AFI (ONE #1260): Mauricio decidió no cobrarle ni avisarle.

**Why:** los triggers de bolsa (0032) y periodo (0028) son `when (new.billable)`; por eso billable=false basta para no contar, y el motivo distingue de dual/KYC (que también van billable=false).

**How to apply:**
- Secreto solo en Vercel de Valida y en `.env.local` de la máquina que corre el script; ONE (la app) no lo lee.
- El script de ONE hace prueba previa sin costo (`--probar`): cuerpo `{}` con secreto falso debe dar 403 y con el real 400 validation_error. Una Valida vieja ignora la marca y COBRA, por eso la prueba va antes y cada 200 sin `sin_cobro` detiene.
- El filtro del reproceso es `TIPOS_ACEPTADOS_ANTES` (CC, CE, NIT, PAS), no la lista de hoy: si no, las filas en error con TI quedan fuera.
- Gotcha local: en el clon de Valida, `lib/consultas/sin-cobro-sql.test.ts` colgaba siempre en este equipo (copia idéntica con otro nombre pasaba); quedó como `sin-cobro-bolsa.test.ts`. Para mutar en Valida: copia `zz-*.test.ts` que recrea el trigger en runtime.

Relacionado: [[project-valida-alta-autogestionada]].
