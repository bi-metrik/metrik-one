# Spec — Facturar deja de ser una etapa del flujo

**Owner código ONE:** Max · **Proceso:** Hana · **UX:** Noor · **Criterio contable:** Valentina
**Decidido por Mauricio:** 2026-08-06, sesión SOENA.
**Depende de:** `2026-08-06_integracion-siigo-facturacion.md` (se construye después de Siigo).

## El problema

Facturar es hoy una **etapa** (`Facturación`, orden 15, la única con `etapa_cierre: true`).
Eso obliga a que **todos** los casos hagan una parada que solo le sirve a una persona, y
mantiene un caso ya entregado ocupando el tablero de quien ya hizo su trabajo. Facturar no
es un paso del proceso: es un acto administrativo que ocurre en paralelo.

## Diseño acordado

Facturar se habilita **al cerrar Documentación** y vive en **un solo lugar: el panel de
financiera**. La etapa Facturación **se conserva**, pero cambia de significado: deja de ser
donde se factura y pasa a ser **el destino de los casos que llegan al final sin factura**.

```
Documentación cerrada → el caso queda habilitado para facturar (desde el panel)

Fin del trabajo operativo
  (Entrega si es solo certificado · Seguimiento si lleva devolución de IVA)
   ├─ ya facturado ──────────────→ cierra solo
   └─ sin facturar ──────────────→ cae a Facturación y espera
                                        ↓
                     financiera factura (o marca no facturable) en el panel
                                        ↓
                                  el caso cierra solo
```

### Decisiones cerradas (no reabrir sin decisión de Mauricio)

1. **Unicidad de superficie.** La opción de facturar existe **solo en el panel**. Desde el
   negocio hay un botón, pero es **navegación al panel**, no una segunda forma de facturar.
   Dos caminos de escritura para el mismo dato se desincronizan en silencio; este repo ya lo
   pagó (ver el gotcha de `updateContactoSegmento`, 3 días guardando en falso).
2. **El cierre lo dispara la facturación, no una acción manual.** Un caso que llega al final
   ya facturado **también cierra solo**: si no, habría dos reglas de cierre distintas según
   el orden en que ocurrieron las cosas.
3. **No se recogen lecciones aprendidas en el cierre.** El campo desaparece con el cierre
   automático. Decisión explícita por volumen; si algún día se necesita, se resuelve aparte.
   El snapshot financiero se sigue calculando sin nadie presente.
4. **El cierre no facturable se muda al panel.** Es el mismo motor ya en producción
   (`puedeAutorizarCierreNoFacturable` + columnas `cierre_no_facturable*`), solo cambia
   dónde se dispara. Sin esto, un caso que nunca se va a facturar se queda en Facturación
   para siempre.
5. **Etapas de cierre: Entrega, Seguimiento y Facturación.** Las dos primeras son el fin del
   trabajo real por rama; la tercera es la sala de espera de los no facturados.

## Lo que hay que cambiar en el código

⚠️ **Marcar Entrega y Seguimiento como etapa de cierre NO es solo configuración.** El flag
`es_cierre` sí se lee por etapa (`config_extra.etapa_cierre`, resuelto en `negocio-v2-actions.ts:794`)
y admite varias etapas marcadas. Pero el resto del código asume que cerrar **bien** ocurre en
stage `cobro` o `ejecucion`, y **Entrega y Seguimiento son stage `venta`**:

| Sitio | Qué asume hoy | Qué pasaría |
|---|---|---|
| `cierre-negocio-dialog.tsx` → `showCompletar` | `stage === 'cobro' \|\| (ejecucion && terminal)` | En Entrega abriría **PerderForm** (pérdida comercial), no el cierre |
| `negocio-detail-client.tsx` → `cierreConfig` | mapa por stage | El botón diría **"Perder"** en rojo |
| `completarNegocio` → guard de la excepción | `negocio.stage_actual !== 'cobro'` → error | **El cierre no facturable no funcionaría** en las etapas nuevas |

El criterio correcto en los tres sitios es **"la etapa es de cierre"**, no el stage. Es
acotado, pero omitirlo rompe justo lo que se desplegó el 2026-08-06.

### Además

- **Panel de facturación** para el área financiera (opt-in por workspace, patrón `modules.*`).
  Cola = negocios que superaron Documentación y no tienen factura, con valor y antigüedad.
  Desde ahí se factura, se marca no facturable, y el caso cierra.
- **Botón en el detalle del negocio** que navega al panel enfocando ese caso.
- **Cierre automático** al registrarse la factura: reutiliza el núcleo de `completarNegocio`
  (una sola vía de escritura, igual que hizo `registrarPagoEnNegocio` con el FAB de pagos).
- **Routing:** el destino por defecto de Entrega y Seguimiento pasa a ser Facturación
  **solo cuando no hay factura**. Con factura, cierran.

## Estado medido de los datos (2026-08-06)

**173 negocios abiertos ya superaron Documentación, y NINGUNO tiene factura registrada en
ONE** (unos $34.279.250 donde hay precio aprobado):

| Etapa | Negocios | Con factura | Valor sin factura |
|---|---:|---:|---:|
| Cita | 128 | 0 | $14.411.750 |
| Entrega | 18 | 0 | $9.625.500 |
| Envío | 9 | 0 | $2.380.000 |
| Cargue | 6 | 0 | $3.910.000 |
| Seguimiento | 4 | 0 | $1.275.000 |
| Facturación | 3 | 0 | $1.402.500 |
| Otras (Pago UPME, Precobro, Notificación, Generación) | 5 | 0 | $637.500 |

Esto **no** significa que SOENA no haya facturado: significa que se factura por fuera y no se
carga a ONE. La regla "no habrá facturas emitidas por fuera de ONE" aplica **desde que la
integración exista**, no antes.

⚠️ **Por eso el panel NO se construye primero.** Nacería con 173 pendientes falsos y Diana
tendría que depurarlos a mano. Con Siigo conectado, ONE consulta las facturas ya existentes,
las cruza contra los negocios y la cola nace reflejando la realidad.

## Orden de construcción

| # | Qué | Complejidad | Bloqueado por |
|---|---|---|---|
| 1 | Conexión Siigo (autenticación, crear factura, traer PDF) | media | Credenciales de SOENA |
| 2 | Cruce de facturas existentes en Siigo contra los negocios | media | 1 |
| 3 | Panel de facturación + botón de navegación desde el negocio | media | 2 |
| 4 | Cierre automático al facturar + no facturable desde el panel | baja | 3 |
| 5 | Entrega y Seguimiento como etapas de cierre + fix del stage | baja | 4 |
| 6 | Facturación deja de recibir casos por avance normal | baja | 5 |

El paso 5 es el que no se puede omitir ni adelantar: si entra antes de que la cola esté
depurada, frena de golpe 22 casos con el trabajo hecho ($10,9M en Entrega y Seguimiento).

## Abierto

- Qué hace el panel con un caso **facturado y luego caído** (nota crédito). Fuera del alcance
  de este spec.
- Retención practicada por clientes jurídicos: puede dejar el recaudo por debajo de la factura
  y frenar el gate de saldo cero. Ver el spec de Siigo.
