---
name: valida-alta-autogestionada
description: Alta autogestionada de Valida (18-recorrido-baja-friccion). Al 2026-10-12, pila de PR #1102→#1104→#1107→#1110 en ONE más metrik-valida#57, todo apagado. Migración 20261012100000 SIN aplicar. Lo que no se ve en el código: el plan es una bolsa por mes, los términos van por empresa y la tarjeta nunca toca ONE.
metadata:
  type: project
---

Spec `proyectos/metrik/valida/docs/crecimiento-mrr/18-recorrido-baja-friccion.md`. Las decisiones están en `10-decisiones-mauricio.md`:
- D: 10 consultas en 7 días, sin tarjeta;
- A2: método de pago al registrarse, cuando haya ePayco;
- B: marca de origen para la comisión de AFI;
- F: precio único, $150.000.

Textos legales aprobados por Mauricio el 2026-10-11: `proyectos/metrik/valida/docs/legal/condiciones-prueba-valida-v1.0.md` y `aviso-formulario-registro-v1.0.md`.

**Why:** Valida se vende autogestionada sobre ONE (decisión 23). La meta es la primera consulta en menos de 5 minutos, sin humano, y pagar sin hablar con nadie.

## Estado al 2026-10-12

Ya mergeados: #1095 (corte de la bolsa), #1097 (`valida_registros`, APLICADA, no volver a aplicar) y #1098 (`/valida/empezar`, apagado).

**Pila abierta.** Se mergea en orden y, antes de cada merge, hay que cambiar la base del siguiente a `main`:
1. **#1102**: textos aprobados, huella de Condiciones + aviso + casilla (`condiciones_version = condiciones-1.0+aviso-1.0`) y Política 1.5 → 1.6.
   - Al desplegar, Valida API y el Radar vuelven a pedir la Política una vez.
   - La cláusula de cobro va INACTIVA: `VALIDA_COBRO_TRAS_PRUEBA=1` más campos llenos, y en producción además `CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION`.
2. **#1104**: el pago de una cuota abre el mes en Valida (`ciclo-servidor.ts`, desde el webhook y el paso 8 del cron).
   - Límite: `parametros.limite_consultas_mes` > `VALIDA_PLAN_LIMITE_MES` > 3000.
3. **#1107**: `/valida/activar` + RPC `valida_activar_autogestion`. **Migración 20261012100000 SIN aplicar.**
   - Está apagada: `VALIDA_ACTIVACION_ABIERTA` + `terminosPlanListos()`. Los Términos v2.0 siguen como marcador.
4. **#1110**: ePayco en modo prueba (`EPAYCO_HABILITADO`). Tokeniza en el navegador y cobra por token (paso 7b del cron).
5. **metrik-valida#57**: los parches de PR 1 y 9, `POST /api/one/v1/autogestion/{cliente}/ciclos` y la marca PRUEBA en el PDF.

## Decisiones de diseño que no se deducen del código

- **El «plan» en Valida es una BOLSA por cuota pagada**, no `planes_consumo`.
  - Así el límite es duro (402) sin tocar `/validate`, y el pago habilita el mes.
  - La llave de la prueba **no se cambia por otra**: se le quita `vence_en`. Una llave nueva perdida entre Valida y Vault dejaría sin servicio a alguien que ya pagó.
- **Los Términos del plan van por EMPRESA (alcance `cliente`)**, no como `plantilla`. Un genérico de `valida_consulta` lo verían los 4 CDA, y su entrada les pediría aceptarlo.
- Un contrato SIN documento cierra `/valida` («todavía no están registrados»). Por eso la activación no abre sin texto aprobado.
- La activación **no acepta los Términos**: la persona los acepta en la entrada de `/valida`. Al aceptar, `asegurarCobroDelEspacio` enrola el plan de inmediato (`dias_trial: 0` en el contrato).
- **NIT con contrato vivo → `nit_con_contrato`.** Un CDA de hoy que se registra a probar no recibe otro contrato.
- **ePayco en modo prueba se niega a operar con `VERCEL_ENV=production`.** Una tarjeta de prueba pagaría una cuota real. Los inputs de la tarjeta no tienen `name`.
- La marca PRUEBA se decide por el **momento de la consulta** (bolsa vigente al consultar). La duda marca.

## Gotchas

- **Publicar en metrik-valida desde el worktree aislado sí se puede** (#57, 2026-10-12):
  1. `rsync` del checkout al scratchpad (sin `node_modules`/`.git`/`.claude`) y comparar blobs contra `git/trees/<sha>`;
  2. aplicar los parches con `patch -p1` (no `git apply`);
  3. `node_modules` por symlink sirve para `tsc` y `npm test`, pero `next build` NO (Turbopack: «Symlink points out of the filesystem root»);
  4. publicar con `gh api` (`git/refs` + `createCommitOnBranch`) y verificar el árbol blob por blob.
- ePayco.js usa `$.ajax`: hay que cargar jQuery antes. Su `parseForm` lee `getAttribute('value')` antes que `.value`, así que los campos de tarjeta van sin estado de React.
- El guardián `src/lib/compliance/retencion.test.ts` hace caer CI si un archivo nuevo dice «N años» sin clasificarlo (las Condiciones dicen 10 años).
- Rutas con paréntesis dentro de comandos compuestos: el hook rechaza el comando. Hay que pasar `\(` `\)` sin encadenar.

## Falta para abrir al público

- Aplicar la migración de #1107 antes de su merge.
- Desplegar metrik-valida#57.
- Términos v2.0 aprobados (pegarlos en `terminos-plan.ts`).
- Decisión sobre la comisión de AFI en autoservicio (el contrato nace con `comision = null` y el origen en los parámetros).
- La prueba de Vera en un preview.
- Para el cobro al terminar la prueba sin clic: Términos aceptados en el registro (condición 4 de §2.1) y una cuenta ePayco.

Relacionado: [[secop-autogestion-registro]], [[radar-trial-y-cobro]], [[valida-renovacion-continua]], [[sql-y-despliegue-metrik-valida]].
