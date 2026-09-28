---
name: terminos-modulo-radar
description: El gate de términos de Valida ya es genérico: un módulo nuevo se suma agregando un producto a PRODUCTOS_ENTRADA, sin reimplementar nada; pero el despacho de la acción de aprobación era un ternario que mandaba todo producto nuevo a Valida API
metadata:
  type: project
---

Al montar la entrada de términos del Radar SECOP (PR #952, bloque B de la spec del 2026-09-28) se
midió qué tan reusable es la máquina de `src/lib/valida-api/`. **Es reusable entera**, y eso ahorra
el trabajo de creer que hay que copiarla.

**Why:** desde el 2026-09-23 esa máquina se parametrizó por producto para que los CDA firmaran con
EXACTAMENTE las mismas comprobaciones que Valida API, «y no con una copia que se separe con el
primer arreglo». El Radar fue la prueba de que el diseño aguantó un tercer producto.

**How to apply — lo que hace falta para sumar un módulo con términos:**

1. Una entrada en `PRODUCTOS_ENTRADA` (`src/lib/valida-api/producto.ts`): `nombre`, `ruta`,
   `exigeAprobacionPorUsuario`, `exigeDesignado`. El `nombre` entra en los textos que se firman y en
   su huella, así que **el de un producto ya firmado NO se puede cambiar**.
2. Un contexto propio que compruebe el módulo (el de Valida API además exige
   `config_extra.valida_cliente_id`, que otros módulos no tienen).
3. Un `entrada-servidor.ts` que junte `documentosDelCliente()`, `leerAceptacionesUsuario()` y
   `perfilReal()` y llame a `evaluarConDesignacion({ ..., producto })`.
4. Dos acciones que deleguen en `armarEstadoEntradaPagina` y `registrarAprobacionEntrada`.
5. `<EntradaTerminos producto="..." />` y `textoAvisoPolitica(producto)` en la página.

Nada de `entrada.ts`, `terminos.ts` ni `entrada-aprobacion.ts` se toca. `revalidatePath` sale de
`PRODUCTOS_ENTRADA[producto].ruta`, así que tampoco hay que pasarle la ruta.

⚠️ **El despacho de la acción de aprobación era un ternario y es una trampa.** En
`src/components/terminos/entrada-terminos.tsx` estaba
`producto === 'valida_cda' ? aprobarEntradaValidaCda : aprobarEntradaValidaApi`: **todo producto
nuevo caía en la acción de Valida API sin que nada avisara.** No habría registrado una aceptación
falsa (el servidor rearma la casilla con SU producto y los textos no coinciden), pero el usuario
habría visto «los términos cambiaron mientras los leías», que manda a buscar el problema muy lejos
del defecto. En #952 pasó a un `Record<ProductoEntrada, …>`: **omitir un producto ahí ahora no
compila.** Si aparece otro despacho por producto en un ternario, conviene convertirlo igual.

⚠️ **Límite conocido, escrito en el código:** `mis_documentos_de_servicio()` devuelve los documentos
del CONTRATO que cubre al espacio, **sin filtrar por módulo**. Hoy alcanza porque el espacio de un
cliente de Radar tiene un solo contrato; un espacio con Radar Y otro servicio le pediría al usuario
aceptar también los términos del otro para entrar al Radar. Lo que habría que cambiar entonces es
esa función SQL, no el código del módulo.

**Decisiones del Radar, con su razón (no copiarlas sin mirar):**
- `exigeAprobacionPorUsuario: true`, como Valida API: quien mira el Radar decide con él a qué
  convocatoria presentarse, así que cada usuario lee que **el fit es priorización y no un concepto
  jurídico**. Con `false`, un operador vería los puntajes sin haber leído nunca esa advertencia, que
  es justo lo que el documento existe para dejar por escrito.
- `exigeDesignado: false`: la regla del dueño alcanza. El designado se exige en los CDA porque su
  dueño es, en tres de cuatro, una cuenta genérica y la **cláusula 16.1 de SUS términos** pide
  representante legal o apoderado. El Radar no tiene esa cláusula.

Relacionado: [[radar-secop-modulo]], [[entrada-unica-valida-api]], [[licencia-a-suscripcion]],
[[suscripcion-solo-designado]].
