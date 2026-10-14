---
name: valida-alta-autogestionada
description: Alta autogestionada de Valida (18-recorrido-baja-friccion). Pila #1104→#1107→#1110 abierta más metrik-valida#57. Migraciones SIN aplicar: 20261012100000, 20261014153000, 20261014203000 (Términos en el registro); 20261013090000 APLICADA. Desde el 14-oct los Términos v2.0 se aceptan en el registro (canal 'registro') y el cobro del día 7 llega a la tarjeta. Plan = bolsa por mes; términos por empresa; la tarjeta nunca toca ONE.
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
1. **#1102** (MERGEADO): textos aprobados, huella de Condiciones + aviso + casilla (`condiciones_version = condiciones-1.0+aviso-1.0`) y Política 1.5 → 1.6.
   - Al desplegar, Valida API y el Radar vuelven a pedir la Política una vez.
   - La cláusula de cobro va INACTIVA: `VALIDA_COBRO_TRAS_PRUEBA=1` más campos llenos, y en producción además `CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION`.
2. **#1104**: el pago de una cuota abre el mes en Valida (`ciclo-servidor.ts`, desde el webhook y el paso 8 del cron).
   - Límite: 3.000 FIJO en código desde el 2026-10-12 (fila 23 de Vera); ni el contrato ni el entorno lo cambian.
3. **#1107**: `/valida/activar` + RPC `valida_activar_autogestion`. **Migración 20261012100000 SIN aplicar.**
   - Está apagada: `VALIDA_ACTIVACION_ABIERTA` + `terminosPlanListos()`. Los Términos v2.0 siguen como marcador.
4. **#1110**: ePayco en modo prueba (`EPAYCO_HABILITADO`). Tokeniza en el navegador y cobra por token (paso 7b del cron).
   - Desde el 2026-10-12 trae además el cobro a los 7 días (decisión de Mauricio, opción A, fecha fija): Condiciones v2.0 + aviso v1.2, el paso 7a del cron, «Cancelar prueba», el borrado de la tarjeta y el aviso antes de suspender (paso 8b). Migración 20261013090000 APLICADA en producción el 2026-10-14 (no tocar el archivo).
   - Calendario de mora (Mauricio, 2026-10-14, Carmen en `crecimiento-mrr/28-…`): `DIAS_GRACIA_CICLO = 10`; cuota 2+ con tarjeta: intentos días 0, 3 y 7 (`cobro_intentos_tarjeta`, migración 20261014153000 SIN aplicar; sin la tabla NO cobra), enlace el día 0 (paso 7c), aviso día 7, suspensión día 10. La cuota 1 nunca se reintenta (7.5). `DIAS_GRACIA` del cron y `DIAS_GRACIA_RENOVACION` se quedan en 5 a propósito.
   - Los planes `epayco` ya NO reciben enlace automático antes de un rechazo (antes sí, por el fallback a `cobros.pasarela_en_linea` = bold del espacio metrik: doble pago).
   - **Términos en el registro (2026-10-14, migración 20261014203000 SIN aplicar):** la casilla v1.2 acepta los Términos v2.0 llenos con la Orden de la empresa; `valida_registros` guarda `aceptado_texto` (su sha = `condiciones_sha256`) y `terminos_*`, inmutables por trigger. El día 7 la activación registra ESE texto (no lo rearma) y `aceptarTerminosDelRegistro` inserta en `aceptaciones_terminos` con `canal = 'registro'`; la guarda de la base exige documento = texto aceptado, persona = designada, declaración = la casilla dentro de `aceptado_texto`, y pone hora/IP/correo desde el registro. `ACEPTACION_EN_REGISTRO_CONSTRUIDA = true`. Un registro sin `terminos_sha256` (anterior) queda en `esperando_terminos`.
   - Sin esa migración aplicada, un registro con tarjeta FALLA (la puerta escribe columnas nuevas) y el paso 7a responde error: aplicarla antes de probar en un preview y antes del merge.
   - Lecturas de Max sin confirmar con Emilio: `{fecha_publicacion}` («Rige desde») = día del registro; `{recomendado_afi: …}` pasó a `{recomendado_afi}` con «sí»/«no».
   - El botón «Activar plan» ya no activa un registro con tarjeta (`cobro_al_terminar_prueba`): cobraría la cuota 1 antes de los 7 días.
   - Mora de autoservicio (`REGLA_MORA_AUTOSERVICIO`): restringe consultas desde D+10, pausa /valida desde D+40 (no D+31). La puerta la elige si el contrato tiene un documento con slug `terminos-uso-valida-autogestion`.
   - Textos: la fuente son los archivos de `docs/legal/` (Emilio pasó ahí el texto de Vera). El código se comparó byte por byte con esos archivos el 2026-10-12; si cambian, se vuelve a copiar y se sube la versión.
   - ⚠️ Llaves con sufijo `_METRIK` (cuenta 1595165). `EPAYCO_PUBLIC_KEY`/`PRIVATE_KEY` sin sufijo son de OTRA cuenta (conciliación de un cliente); leerlas cobraría en la cuenta equivocada. Cargadas solo en Production (2026-10-12): Preview no las tiene.
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

- **Los previews usan la base de PRODUCCIÓN**: el cobro a los 7 días guarda `cobro_entorno` y cada despliegue procesa solo lo suyo. Nunca correr el cron entero en un preview (manda enlaces a clientes reales). Para eso está `/api/crons/valida-cobro-prueba`.
- ePayco borra una tarjeta con `franchise` + `mask` + `customerId` (`/subscription/token/card/delete`). ONE no guarda la máscara: se consulta antes `/subscriptions/customer`. No está verificado contra una cuenta real.
- `crearDoble` (`test/tablas-doble.ts`) devuelve las filas POR REFERENCIA: un `update` cambia el objeto que ya se leyó. Hay que copiar el valor previo antes de reclamar, o la prueba de «soltar» miente.

- **Publicar en metrik-valida desde el worktree aislado sí se puede** (#57, 2026-10-12):
  1. `rsync` del checkout al scratchpad (sin `node_modules`/`.git`/`.claude`) y comparar blobs contra `git/trees/<sha>`;
  2. aplicar los parches con `patch -p1` (no `git apply`);
  3. `node_modules` por symlink sirve para `tsc` y `npm test`, pero `next build` NO (Turbopack: «Symlink points out of the filesystem root»);
  4. publicar con `gh api` (`git/refs` + `createCommitOnBranch`) y verificar el árbol blob por blob.
- ePayco.js usa `$.ajax`: hay que cargar jQuery antes. Su `parseForm` lee `getAttribute('value')` antes que `.value`, así que los campos de tarjeta van sin estado de React.
- El guardián `src/lib/compliance/retencion.test.ts` hace caer CI si un archivo nuevo dice «N años» sin clasificarlo (las Condiciones dicen 10 años).
- Rutas con paréntesis dentro de comandos compuestos: el hook rechaza el comando. Hay que pasar `\(` `\)` sin encadenar.
- El registro ya NO pregunta el tipo de empresa (Mauricio, 2026-10-12: «cualquier empresa»): `valida_registros.tipo_entidad` nace null; el segmento sale del RUT al activar (CIIU 7120 = CDA), aún sin construir.
- El DV se llena solo desde la casilla del NIT (`casillasDesdeNit`); un guion SEPARA (respeta el DV traído), sin guion se calcula. No es `separarNitDv`: nunca partir un número sin separador.

## Falta para abrir al público

- Aplicar la migración de #1107 antes de su merge.
- Desplegar metrik-valida#57.
- Términos v2.0: YA en `terminos-plan.ts` (14-oct, huella de la Parte II fijada en `terminos-plan.test.ts`). Si Emilio cambia el archivo, se recopia y se sube la versión.
- El retiro del plan, el cambio de medio de pago, la factura de cada cobro automático (hoy no se emite ninguna) y el procedimiento de cancelación por correo.
- Decisión sobre la comisión de AFI en autoservicio (el contrato nace con `comision = null` y el origen en los parámetros).
- La prueba de Vera en un preview.
- Para el cobro sin clic en producción: aplicar las 3 migraciones, `CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION`, `EPAYCO_PRODUCCION`, metrik-valida#57 desplegado (abre la bolsa al pagar), y lo de Emilio (16.4: enviar Términos + constancia al correo, no construido).

## Cobro al confirmar en la consulta 11 (2026-10-14, PR apilado sobre feat/valida-epayco-pruebas)
- Decisión de Mauricio: primer mes = lo primero entre día 7 y consulta 11, pero la consulta 11 SOLO con clic de
  confirmación (nunca en silencio). Condiciones v2.1 + Términos autoservicio v2.1: texto de Max, **lo aprueba Emilio
  antes de encender**; los archivos legales de `proyectos/metrik/valida/docs/legal/` siguen en v2.0 (no los toca Max).
- Solo se ofrece a registros que aceptaron condiciones-2.1+ (la v2.0 prometía «no se adelanta»).
- Migración `20261014233000_valida_cobro_al_confirmar.sql` SIN aplicar: sin ella el clic falla al reclamar y no cobra.
- La casilla con cobro y el texto junto a la tarjeta NO cambiaron (siguen describiendo solo el día 7): revisar con Emilio.

Relacionado: [[secop-autogestion-registro]], [[radar-trial-y-cobro]], [[valida-renovacion-continua]], [[sql-y-despliegue-metrik-valida]].
