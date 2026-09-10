---
name: valida-privacidad-v13
description: Cierre del frente de datos personales KYC (2026-09-10) — autorizacion v2 en metrik-one (PR #621) y Politica Habeas Data v1.3 en metrik-valida (PR #37), los dos SIN mergear; que invalida de verdad el bump de version y que NO
metadata:
  type: project
---

## Estado al 2026-09-10

Reemplaza a la memoria `valida-privacidad-v12`, que quedo caduca: **el PR #36 YA se mergeo**
(`main` de metrik-valida = `c117f60`, v1.2 vigente desde el 10-sep).

Dos PR **abiertos y sin mergear**, ejecutan `proyectos/metrik/valida/docs/entrega/cierre-emilio-privacidad-kyc.md`
(dictamen de cierre de Emilio; **manda sobre los documentos previos de Lucia**):

- **metrik-one #621** (`fix/autorizacion-datos-v2-diez-anios`, `0f60fe4`): el texto que firma la
  contraparte pasa a **diez (10) anios** de conservacion con su fundamentacion, gana el parrafo de
  **datos sensibles**, cambia el cierre, y `VERSION_TEXTO.autorizacion_datos` sube a **`-v2`**.
  Los 6 checks en verde.
- **metrik-valida #37** (`docs/privacidad-v13-anthropic-informa`, `dc4efff`): Politica Habeas Data
  a **v1.3**. Vercel en verde (ahi no hay mas checks).

## ⚠️⚠️ Que invalida de verdad el bump a `-v2`, y que NO

`faltaAceptar` (`src/lib/compliance/vinculacion-publica.ts`) cuenta una aceptacion **solo si su
`texto_version` es la vigente**, asi que las de la v1 dejan de contar. Verificado por mutacion.

**Pero `pasoActual` corta antes en `firmado`** (`estaFirmado(estado)` = `estado === 'pendiente_revision'`).
Un expediente **ya sellado no vuelve a pedir nada**: el bump solo alcanza a los que siguen en curso.
Es coherente con la decision 1 de Emilio (los dos expedientes v1, `5f594e69` MeTRIK y `40b3ed63` AFI,
son las dos partes del contrato: **no hay remediacion y no se toca ninguna fila**), pero conviene no
decir "todos vuelven a firmar" sin ese matiz.

## Lo que aparecio y no estaba en el encargo

- **`ESTADO_EXPEDIENTE_ACCION` de `src/lib/compliance/vinculacion.ts` decia "El expediente se conserva
  5 anios"** en `aprobado` y `rechazado` — el mismo dato que el titular firma, contradiciendolo en la
  pantalla del oficial de cumplimiento. Alineado a 10 en el #621.
- **La v1.2 y la v1.3 quedan con la MISMA fecha de vigencia** (10 de septiembre de 2026), porque las
  dos se publican el mismo dia. Es exacto y el historial lo dice, pero hay que saberlo.
- ⚠️ **La vigencia esta en CUATRO sitios** (hero y pie de la pagina, portada y pie del PDF). Si el #37
  se mergea otro dia, hay que moverla en los cuatro.

## Decisiones de Emilio que NO se revierten

- **Anthropic va en el numeral 9 y su fila NO afirma certificaciones ni retencion cero** (`soc2TypeII:
  null`), asi que no entra a la primera frase del 9.3. El compromiso de **proceso** de la segunda frase
  la cubre igual. Si manana se comprueba, se dice.
- **Informa Colombia va en un numeral 9 bis PROPIO, no en el 9.** Tres razones y ninguna de forma: el 9
  se titula "internacionales" y su 9.2 invoca el art. 26 (solo datos que salen del pais); el 9.3 promete
  clausulas de transferencia internacional que con Informa no existen; e Informa mantiene su propia base
  y es **Responsable**, no Encargado.
- **`HALLAZGOS_ABIERTOS` del guardrail queda VACIO**, con la razon escrita en el sitio. Dejar ahi un
  hallazgo ya resuelto seria peor que el hueco original: la prueba seguiria verde y el hallazgo quedaria
  fechado para siempre.

## Como quedo la constante unica de terceros

`lib/recursos/terceros-numeral-9.ts` se **extendio**, no se duplico: `TerceroNumeral9` gana
`ambito: 'internacional'` y aparece `DESTINATARIOS_NACIONALES` con su propio tipo (`datosTransmitidos`,
`finalidad`, `rol`, `noRecibe`, `host`). El barrido de hosts del guardrail **deriva**
`HOSTS_NACIONALES_DECLARADOS` de esa constante: sacar a Informa del 9 bis vuelve a dejar su host sin
clasificar, que es lo que debe pasar.

⚠️ **El corte `ENCABEZADO_9_BIS` + `cuerpo9Bis()` salio de MIRAR el PDF rasterizado**, no de una prueba:
con el literal completo de Emilio (que empieza por "9 bis. Destinatarios en Colombia.") bajo el titulo de
seccion, el lector veia el encabezado **dos veces seguidas**. `texto9Bis()` sigue existiendo y devuelve el
literal entero, que es lo que el guardrail compara.

## Sueltos preexistentes, verificados contra `main`

- En el PDF, "Proveedor" y "Finalidad" **se tocan** en la fila de Supabase (`TablaDosCols` con
  `flex 1 / flex 2`). La fila de Anthropic no tiene el problema.
- **El pie de pagina de `pdf-privacidad.tsx` no se imprime** (ni texto ni paginacion): el cambio de
  version del pie es invisible en el artefacto. Portada y encabezado corrido si lo llevan.

Relacionado: [[valida-fto-state-dept]], [[arbol-limpio-por-tarball]],
[[sql-y-despliegue-metrik-valida]], [[mirar-pdf-renderizado]], [[pruebas-por-mutacion]].
