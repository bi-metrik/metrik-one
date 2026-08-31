# Spec — Calificación de leads: la bandeja que nunca se construyó

**Owner de código:** Max · **Proceso:** Hana · **Origen:** sesión SOENA S12, 2026-08-20
**Estado:** especificado, sin construir.
**Bloquea a:** `2026-08-20_inversion-pauta-meta.md` (costo por lead calificado)

## El hecho

De las **486 interacciones de Meta** en SOENA, **467 siguen en estado `nueva`**.
Convertidas 14, contactadas 2, descartadas 1, posible duplicado 2.

No es que la calificación falle: es que **no está ocurriendo**.

## Por qué, y son dos causas distintas

### A. No hay dónde hacerlo

La calificación existe y funciona, pero vive **dentro de la ficha de un contacto**:
`/directorio/contacto/[id]`, en `interacciones-section.tsx`. Los botones están ahí
(`Crear negocio`, `Marcar contactada`, `Descartar`) y las server actions también.

**No existe ninguna ruta que liste leads pendientes.** Revisadas las 34 rutas de
`src/app/(app)/`: no hay bandeja, ni en `/directorio` ni en `/contactos` ni en ningún
lado. Para calificar 486 leads hay que abrir 486 fichas de contacto, una por una,
sabiendo de antemano a quién buscar.

El propio código lo delata. `negocio-v2-actions.ts:2310` dice, textual:

```
// ── Acciones de bandeja: marcar/descartar una interacción ──
```

**La bandeja se diseñó, se le construyó el backend, y la pantalla nunca llegó.** Las
acciones existen esperando a una pantalla que no las llama.

### B. No hay qué decir

Los estados disponibles son `nueva / contactada / descartada / convertida /
posible_duplicado`. Todos responden **"¿qué hicimos con el lead?"**. Ninguno responde
**"¿el lead servía?"**, que es lo que pidió el equipo comercial el 2026-08-10: *"poder
registrar lead calificado o no calificado"*.

No son la misma pregunta. Un lead excelente al que todavía nadie llamó está `nueva`. Un
lead basura al que llamaron está `contactada`. Los dos se ven igual de bien.

Peor: **`descartarInteraccion(interaccionId)` no recibe motivo.** Se descarta y se pierde
el por qué. Y el por qué es justo el dato que diría **qué campaña trae basura**, que es
todo el punto de cruzar leads contra inversión.

## Diseño

### 1. La bandeja

Una ruta que liste interacciones pendientes, no contactos. Filtros por fuente, campaña,
estado y responsable. Cada fila trae lo que ya se muestra hoy en la ficha (resumen del
`field_data`, fuente, fecha) más las mismas tres acciones, ejecutables **sin salir de la
lista**.

Es una pantalla nueva sobre server actions que ya existen y ya están probadas.

### 2. Dos ejes, no un enum más largo

**No se agregan estados al enum.** Son dos preguntas distintas y merecen dos campos:

| Eje | Campo | Valores | Pregunta que responde |
|---|---|---|---|
| Gestión | `estado` (ya existe) | nueva, contactada, convertida, descartada, posible_duplicado | ¿Qué hicimos? |
| Calificación | `calificacion` (nuevo) | `null`, `calificado`, `no_calificado` | ¿Servía? |

Meter la calificación dentro de `estado` obligaría a inventar combinaciones
(`contactada_calificada`, `contactada_no_calificada`) y rompería todo lo que hoy lee ese
campo.

### 3. Motivo obligatorio al descartar, de catálogo cerrado

Descartar exige elegir un motivo de una lista corta configurable por workspace
(`config_extra`), no texto libre. Para SOENA algo como: fuera de cobertura, no le
interesa, número equivocado, duplicado, no responde.

**Texto libre no sirve aquí.** Si cada asesor escribe lo suyo, no se puede agrupar por
campaña, y agrupar por campaña es la única razón por la que estamos guardando el motivo.

## Decisiones que no son obvias

**1. Sin calificar no es lo mismo que no calificado.**
`calificacion` arranca en `null` y **nadie la rellena automáticamente**. Un lead que
nadie miró tiene que verse como no mirado, no como malo. Es el mismo principio que ya
aplicamos con el gasto de pauta: la ausencia de dato se dice, no se rellena con un valor
que parece información. Si el default fuera `no_calificado`, el costo por lead calificado
saldría inflado y nadie notaría por qué.

**2. El backlog de 467 hay que decidirlo, no arrastrarlo.**
Abrir la bandeja con 467 pendientes acumulados desde el 8 de julio la vuelve inservible
el primer día. Hay dos caminos y **los elige SOENA, no nosotros**: calificar hacia atrás,
o cortar línea en una fecha y arrancar limpio dejando el histórico como
`sin_calificar` permanente. La segunda opción tiene un costo concreto que hay que decirles
de frente: **las campañas de julio y agosto se quedan sin costo por lead calificado para
siempre**.

**3. La bandeja mide su propio uso.**
Si dentro de un tiempo volvemos a encontrar 400 leads sin tocar, el problema no era la
pantalla y hay que dejar de construir pantallas. La bandeja debe permitir responder
cuántos leads se calificaron y en cuánto tiempo desde que entraron, sin consultas a mano.

## Lo que esto destraba

- **Costo por lead calificado**, que hoy no se puede calcular y es lo que pidieron.
- **Calidad por campaña**: motivo de descarte cruzado con `campaign_name`. Ahí es donde se
  ve si `CLIENTES POTENCIALES AGO 2026 PLUS`, con 231 leads y **cero negocios**, trae
  gente fuera de cobertura o simplemente nadie la ha llamado. Hoy esas dos explicaciones
  son indistinguibles, y llevan a decisiones opuestas sobre la pauta.

## Fuera de alcance

Asignación automática de leads a un responsable (SOENA ya tiene
`notificaciones.routing_por_responsable`, es otra conversación), avisos por lead sin
tocar, corte por ciudad, y pantalla de KPIs comerciales.

## Gate

Lleva migración (columnas nuevas en `contacto_interacciones` + catálogo de motivos), así
que **la mergea Mauricio**, según `.claude/rules/branch-workflow-one.md`.

Antes de construir hay que cerrar una decisión con SOENA: **qué se hace con los 467 del
backlog.** El diseño de la bandeja cambia según la respuesta.
