---
name: valida-diligencia-v2
description: Arranque de Valida Diligencia v2 (SIRI + SECOP II) en metrik-valida, 2026-09-08 — entregado como patch sin commit ni PR; decisiones de diseño (modulo, RPC, tabla propia), lo que quedó fuera y el choque con el PR #15
metadata:
  type: project
---

El 2026-09-08 Mauricio decidió "arranca SIRI y SECOP en v2". Se construyó todo el arranque
(adapters, migración `0030`, endpoint `/api/v1/diligencia`, limpieza B.5, pruebas, docs) y
quedó **sin commit ni PR**: la entrega vive en
`/home/mauricio/Developer/metrik/metrik-valida-wt-diligencia-v2-pendiente/` (patch + árbol +
`publicar.py` con el plan de 3 commits + `pr-body.md` + `LEEME.md` con los comandos).

**Why:** el subagente corría en worktree aislado de metrik-one; el guard bloquea git sobre
metrik-valida y el clasificador bloqueó también publicar por `gh api` (Git Data API).
Ver [[publicar-otro-repo-desde-worktree-aislado]].

**How to apply:** la sesión principal (cwd en metrik-valida) crea el worktree, aplica el
patch, commitea, pushea y abre el PR con el título
`feat(diligencia): Valida Diligencia v2 con SIRI Procuraduría y SECOP II`. **No mergear, no
aplicar 0030 en prod.** Comprobar primero que `origin/main` siga en `b1724e8` o que nadie
tocó los 5 archivos modificados.

## Decisiones de diseño que no se revierten sin hablar con Mauricio/Lucía

- `listas.modulo` (`sarlaft`|`diligencia`) es el aislamiento. Las dos listas nuevas van con
  `activa = true` (el cron las ingiere) y `modulo = 'diligencia'`; las RPC
  `buscar_candidatos_por_*` exigen `modulo = 'sarlaft'`; un trigger impide que `matches`
  referencie una lista de diligencia; los consumidores TS del catálogo filtran `modulo`
  (`certificacion-data.ts`, `reporte/[consulta_id]/route.ts`, `v/[hash]/page.tsx`).
  `lib/diligencia/aislamiento.test.ts` lee esos archivos y se cae si alguien quita un filtro.
- Evidencia propia en `consultas_diligencia` (retención 10 años), NUNCA en `consultas`/`matches`:
  el historial, el certificado mensual, el fair-use y el consumo del paquete SARLAFT no la cuentan.
- SIRI: una entrada por `numero_siri` (42.786 filas → 15.609; un numero_siri nunca cruza dos
  cédulas, medido). Es el subconjunto certificable, NO el certificado: la leyenda lo dice.
- SECOP II: sin NIT (`as_codigo_proveedor_objeto` es código interno), match por razón social;
  se excluyen los 29 "Comentarios positivos" (borradores, no sanción); 380 de 520 están
  "A la espera de aprobación" y el estado viaja en `detalle.estado_plataforma`.
- Un hit por NOMBRE cuya cédula registrada difiera de la consultada se descarta como homónimo.

## Choque con PR #15 — cerrado el 2026-09-08

`leerListasVigentes` (PR #15) y el `else` de `reporte/[consulta_id]/route.ts` ya filtran
`.eq('modulo','sarlaft')` (con reintento a 42703 si 0030 aún no aplicó — única lectura del
repo con ese reintento). `lib/diligencia/aislamiento.test.ts` (PR #19) dejó de enumerar 3
rutas a mano: ahora recorre TODO el repo buscando `.from('listas')` y exige el filtro salvo
7 exenciones declaradas y comentadas (cron de ingesta, 5 lecturas puntuales por slug/lista_id,
y `lib/diligencia/consulta.ts` por ser del otro módulo). Comprobado que se cae de verdad:
archivo temporal sin filtro → test rojo con archivo:línea → borrado → 76/76 verde otra vez.
**Orden de despliegue correcto, escrito en el body de ambos PR: 0030 va ANTES del código de
`feat/diligencia-v2-siri-secop`** (esos 4 consumidores no tienen reintento; sin la columna,
`certificacion-data.ts` y `app/v/[hash]/page.tsx` mienten en silencio con `?? []`, y
`consulta.ts` revienta ruidosamente). Ninguno de los dos PR se mergeó ni se aplicó 0030.

## Lo que quedó fuera y quién lo cierra

- Pricing/contador de consumo de Diligencia (fila `billable = true`, no descuenta de nada).
- Guía `/docs` y OpenAPI: los reescribe el PR #15; el contenido está en `docs/diligencia-v2.md`.
- **Choque con PR #15 (`feat/api-terceros`)**: su `lib/consultas/listas-snapshot.ts` filtra
  solo `activa = true` → al rebasar necesita `.eq('modulo', 'sarlaft')` o el PDF SARLAFT
  listará SIRI/SECOP como fuentes consultadas. Y `reporte/[consulta_id]/route.ts` recibe una
  línea que el #15 reestructura (conflicto trivial).
- `fbi_dea.ts` sigue leyendo OpenSanctions (DEA, penal, inactiva): no estaba en B.5.
- Reescribir `uk_hmt.ts` y el seed de `fatf.ts` (resto de B.5): frente aparte.
