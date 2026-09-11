---
name: valida-privacidad-v13
description: Frente de datos personales KYC — autorizacion v2 en ONE (#621) y Politica Habeas Data v1.3 en Valida (#37), los dos MERGEADOS el 2026-09-10; el plazo canonico de diez anios, que invalida de verdad el bump de version, y por que los docstrings quedaron atras (#622)
metadata:
  type: project
---

## Estado al 2026-09-10 (los tres PR ya estan en `main`)

Reemplaza a `valida-privacidad-v12`, que quedo caduca. Ejecutan
`proyectos/metrik/valida/docs/entrega/cierre-emilio-privacidad-kyc.md` (dictamen de cierre de
Emilio; **manda sobre los documentos previos de Lucia**).

- **metrik-one #621** (`28069ec`, mergeado 19:40Z): el texto que firma la contraparte pasa a
  **diez (10) anios** de conservacion con su fundamentacion, gana el parrafo de **datos
  sensibles**, cambia el cierre, y `VERSION_TEXTO.autorizacion_datos` sube a **`-v2`**.
- **metrik-valida #37** (mergeado 19:40Z): Politica Habeas Data a **v1.3**.
- **metrik-one #622**: la correccion de los docstrings que el #621 dejo atras (abajo).

## El plazo canonico, para no volver a buscarlo

**Diez (10) anios**, fijado por Emilio el 2026-09-10, con fundamento en la **Ley 962 de 2005,
articulo 28**, al que remiten la **Resolucion 2328 de 2025 de la Superintendencia de Transporte**
(art. 5.6.11.4) y la **Circular Externa 100-000016 de 2020 de la Superintendencia de Sociedades**
(num. 5.5). Se cuenta **desde el fin del vinculo**.

## ⚠️⚠️ Subir la version del texto firmado NO arrastra lo que lo explica

Lo que destapo el **#622**: el #621 cambio el texto que firma la contraparte
(`vinculacion-publica.ts`) y la pantalla del oficial (`ESTADO_EXPEDIENTE_ACCION`), y dejo en
**cinco anios** los docstrings de arquitectura, que son justo donde alguien va a entender *por que
el dato no se copia a ONE*. Cuatro menciones en tres archivos
(`compliance/vinculacion.ts`, `actions/compliance-vinculacion.ts` x2,
`compliance/solicitud-vinculacion.ts`).

**Por que sobrevivio al #621:** la prueba `vinculacion-publica.test.ts` tiene un guardian real
(`expect(cuerpo).not.toContain('cinco (5) años')`), pero vigila **el texto firmado**, no los
comentarios. Un guardian sobre el artefacto legal no ve la prosa que lo explica, y la prosa es la
que se lee al construir lo siguiente.

**How to apply:** al cambiar una cifra que aparece en un texto legal, barrer **la misma cifra en
prosa** por su FORMA (`retenc|conserv|custodia` cruzado con `años|anos`), no solo el literal
exacto — aqui convivian `5 años`, `cinco años` y `diez (10) años`. Familia de
[[pruebas-por-mutacion]]: el verde del guardian no cubre lo que el guardian no mira.

## ⚠️ Lo que en ese barrido NO se toca

- `vinculacion-publica.test.ts` con `not.toContain('cinco (5) años')` — es el guardian, tiene que
  seguir diciendo cinco.
- El comentario que habla de **quienes firmaron la v1** («a quien acepto el texto de cinco anios»)
  — es historia, y corregirlo la falsea.
- `vinculacion-publica.ts:22`, «dentro de tres anios nadie puede decir QUE acepto» — es retorico.
- ✅ **`src/lib/tutorials/_shared.ts:56` — CERRADO el 2026-09-11 (#629, `ed00fec`).** Se escalo
  como "otro artefacto" y **la distincion no se sostiene: la razon esta en el propio texto**.
  La frase se define a si misma como **«Soporte de auditoria SARLAFT»**, o sea que ES la
  bitacora de consultas SARLAFT — el mismo artefacto que la politica publicada de Valida
  declara en **diez (10) anios** en su tabla de retencion. No eran dos plazos: era uno dicho
  dos veces, y uno estaba mal. Paso a `10 años` (con eñe, ver abajo).
  **How to apply:** antes de escalar un plazo como "pertenece a otro artefacto", leer si el
  propio copy se autodescribe — el nombre del artefacto suele estar en la misma frase.

## El control cruzado de retencion: 5 superficies, y como se corre

`/home/mauricio/Developer/metrik/.claude/hooks/control-retencion-cruzado.sh` (vive FUERA de
los dos repos, owner Mik). Desde el #629 son **cinco** superficies: 3 de metrik-one
(`vinculacion-publica.ts`, `vinculacion.ts`, `tutorials/_shared.ts`) y 2 de metrik-valida
(pagina y PDF de privacidad). Al 2026-09-11 sale **verde, exit 0**.

- ⚠️ **Lee de `origin/main`, no del working tree** (`git show origin/main:<ruta>`): una
  superficie agregada antes de mergear su PR da **NO VERIFICABLE / exit 2**, no verde. El
  orden es mergear primero, agregar la superficie despues.
- ⚠️ **Su extractor es `\(?[0-9]+\)?\s+años`**, o sea que marca discrepancia cualquier numero
  distinto de 10 seguido de "años". **Antes de agregar un archivo, simular el extractor sobre
  el**: si declara otro plazo en anios que no sea el de conservacion, produce falsas alarmas.
  En `_shared.ts` el unico valor extraido es `[10]` (el `500 filas` no va seguido de "años").
  Nota: un plazo escrito **sin eñe no lo ve el extractor**, asi que "sin plazo declarado"
  puede significar "esta mal escrito", no "no lo dice".
- **Validarlo por mutacion, no por el verde:** `CANONICO=5 bash <script>` tiene que sacar las
  5 en rojo **con la ruta nueva nombrada**. Sin eso, una superficie que el script se salta en
  silencio y una que coincide se ven igual ([[pruebas-por-mutacion]]).
- ⚠️ **`.claude/hooks/` es un SYMLINK a `metrik-system`**, asi que el archivo es compartido:
  editarlo **en sitio** (python `open(w)`), no con algo que reemplace el inode.

⚠️ **Ningun check de CI vigila esto.** El guardian del #621 mira el texto firmado; ya van
**tres** superficies encontradas por fuera de el (docstrings en #622, tutorial en #629). El
script cruzado es lo unico que las cubre, y se corre **a mano en la torre**.

## ⚠️⚠️ Que invalida de verdad el bump a `-v2`, y que NO

`faltaAceptar` (`src/lib/compliance/vinculacion-publica.ts`) cuenta una aceptacion **solo si su
`texto_version` es la vigente**, asi que las de la v1 dejan de contar. Verificado por mutacion.

**Pero `pasoActual` corta antes en `firmado`** (`estaFirmado(estado)` = `estado === 'pendiente_revision'`).
Un expediente **ya sellado no vuelve a pedir nada**: el bump solo alcanza a los que siguen en curso.
Coherente con la decision 1 de Emilio (los dos expedientes v1, `5f594e69` MeTRIK y `40b3ed63` AFI,
son las dos partes del contrato: **no hay remediacion y no se toca ninguna fila**), pero conviene no
decir "todos vuelven a firmar" sin ese matiz.

## Decisiones de Emilio que NO se revierten

- **Anthropic va en el numeral 9 y su fila NO afirma certificaciones ni retencion cero**
  (`soc2TypeII: null`), asi que no entra a la primera frase del 9.3. El compromiso de **proceso** de
  la segunda frase la cubre igual. Si manana se comprueba, se dice.
- **Informa Colombia va en un numeral 9 bis PROPIO, no en el 9.** Tres razones y ninguna de forma:
  el 9 se titula "internacionales" y su 9.2 invoca el art. 26 (solo datos que salen del pais); el
  9.3 promete clausulas de transferencia internacional que con Informa no existen; e Informa
  mantiene su propia base y es **Responsable**, no Encargado.
- **`HALLAZGOS_ABIERTOS` del guardrail queda VACIO**, con la razon escrita en el sitio. Dejar ahi un
  hallazgo ya resuelto seria peor que el hueco original: la prueba seguiria verde y el hallazgo
  quedaria fechado para siempre.

## Como quedo la constante unica de terceros

`lib/recursos/terceros-numeral-9.ts` se **extendio**, no se duplico: `TerceroNumeral9` gana
`ambito: 'internacional'` y aparece `DESTINATARIOS_NACIONALES` con su propio tipo
(`datosTransmitidos`, `finalidad`, `rol`, `noRecibe`, `host`). El barrido de hosts del guardrail
**deriva** `HOSTS_NACIONALES_DECLARADOS` de esa constante: sacar a Informa del 9 bis vuelve a dejar
su host sin clasificar, que es lo que debe pasar.

⚠️ **El corte `ENCABEZADO_9_BIS` + `cuerpo9Bis()` salio de MIRAR el PDF rasterizado**, no de una
prueba: con el literal completo de Emilio (que empieza por "9 bis. Destinatarios en Colombia.") bajo
el titulo de seccion, el lector veia el encabezado **dos veces seguidas**. `texto9Bis()` sigue
existiendo y devuelve el literal entero, que es lo que el guardrail compara.

## Sueltos preexistentes, verificados contra `main`

- En el PDF, "Proveedor" y "Finalidad" **se tocan** en la fila de Supabase (`TablaDosCols` con
  `flex 1 / flex 2`). La fila de Anthropic no tiene el problema.
- **El pie de pagina de `pdf-privacidad.tsx` no se imprime** (ni texto ni paginacion): el cambio de
  version del pie es invisible en el artefacto. Portada y encabezado corrido si lo llevan.
- La v1.2 y la v1.3 quedan con la **MISMA fecha de vigencia** (10 de septiembre de 2026), porque las
  dos se publican el mismo dia. Es exacto y el historial lo dice, pero hay que saberlo.
- ⚠️ **La vigencia esta en CUATRO sitios** (hero y pie de la pagina, portada y pie del PDF).

Relacionado: [[valida-fto-state-dept]], [[arbol-limpio-por-tarball]],
[[sql-y-publicacion-metrik-valida]], [[mirar-pdf-renderizado]], [[pruebas-por-mutacion]].
