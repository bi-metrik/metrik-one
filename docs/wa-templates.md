# WhatsApp Business Templates — MeTRIK ONE

Templates listos para cargar a Meta Business Manager → WhatsApp Manager → Message Templates.

**Categoria:** Utility (todos) — operacional, disparado por accion del sistema
**Idioma:** `es_CO` (fallback `es` si Meta no acepta)
**Numero WA:** el configurado en el webhook `wa-webhook`

## Prerrequisitos antes de submit

- [ ] URL `https://metrik.com.co/privacidad` accesible publicamente (hoy devuelve 401 — pendiente fix Vercel SSO)
- [ ] Politica de tratamiento menciona explicitamente: envio de notificaciones por WhatsApp + telefono como dato recolectado + opt-out
- [ ] Numero WA verificado en Meta Business Manager con display name "MeTRIK ONE"
- [ ] Politica de privacidad de negocio configurada en Meta Business Manager apuntando a la misma URL

## Proceso de carga

1. Meta Business Manager → WhatsApp Manager → Message Templates → New Template
2. Copiar nombre (snake_case), categoria (Utility), idioma (Spanish — Colombia)
3. Pegar el body exacto de abajo (respetar variables numeradas `{{1}}`, `{{2}}`...)
4. En "Samples", pegar los sample values de cada template
5. Submit → esperar aprobacion (Utility: 1-24h)

## Template 01 — Opt-in inicial

Se envia una unica vez cuando el usuario interactua por primera vez. Sin aprobacion explicita, NO se envia ninguna notificacion.

**Nombre:** `metrik_opt_in_inicial`
**Categoria:** Utility
**Idioma:** es_CO
**Body:**

```
Hola, te escribe MeTRIK ONE.

Para enviarte notificaciones sobre tu trabajo (recordatorios, menciones, asignaciones, vencimientos), necesitamos tu autorizacion segun la Ley 1581 de 2012.

Politica de tratamiento: {{1}}

Responde ACEPTO para activar o NO para desactivar.
```

**Sample {{1}}:** `https://metrik.com.co/privacidad`

---

## Template 02 — Inactividad oportunidad

**Nombre:** `metrik_notif_inactividad_oportunidad`
**Categoria:** Utility
**Idioma:** es_CO
**Body:**

```
Hola {{1}}, la oportunidad "{{2}}" lleva {{3}} dias sin actividad.

Abrirla en MeTRIK ONE: {{4}}
```

**Samples:**
- {{1}}: `Mauricio`
- {{2}}: `Kaeser — Instalacion compresor`
- {{3}}: `5`
- {{4}}: `https://metrik.metrikone.co/negocios/a1b2c3d4`

---

## Template 03 — Inactividad proyecto

**Nombre:** `metrik_notif_inactividad_proyecto`
**Categoria:** Utility
**Idioma:** es_CO
**Body:**

```
Hola {{1}}, el proyecto "{{2}}" no tiene movimientos hace {{3}} dias.

Revisarlo: {{4}}
```

**Samples:**
- {{1}}: `Mauricio`
- {{2}}: `VE SOENA — Devolucion DIAN`
- {{3}}: `3`
- {{4}}: `https://soena.metrikone.co/negocios/a1b2c3d4`

---

## Template 04 — Handoff oportunidad a proyecto

**Nombre:** `metrik_notif_handoff`
**Categoria:** Utility
**Idioma:** es_CO
**Body:**

```
Hola {{1}}, se completo el handoff de "{{2}}" a proyecto.

Ver detalle: {{3}}
```

**Samples:**
- {{1}}: `Mauricio`
- {{2}}: `Kaeser — Instalacion compresor`
- {{3}}: `https://metrik.metrikone.co/negocios/a1b2c3d4`

---

## Template 05 — Asignacion responsable

**Nombre:** `metrik_notif_asignacion_responsable`
**Categoria:** Utility
**Idioma:** es_CO
**Body:**

```
Hola {{1}}, te asignaron como responsable de "{{2}}".

Abrir: {{3}}
```

**Samples:**
- {{1}}: `Maria`
- {{2}}: `VE SOENA — Textiles del Norte`
- {{3}}: `https://soena.metrikone.co/negocios/a1b2c3d4`

---

## Template 06 — Asignacion colaborador

**Nombre:** `metrik_notif_asignacion_colaborador`
**Categoria:** Utility
**Idioma:** es_CO
**Body:**

```
Hola {{1}}, te agregaron como colaborador en "{{2}}".

Ver: {{3}}
```

**Samples:**
- {{1}}: `Carlos`
- {{2}}: `Kaeser — Mantenimiento preventivo`
- {{3}}: `https://metrik.metrikone.co/negocios/a1b2c3d4`

---

## Template 07 — Mencion en comentario

**Nombre:** `metrik_notif_mencion`
**Categoria:** Utility
**Idioma:** es_CO
**Body:**

```
Hola {{1}}, {{2}} te menciono en "{{3}}":

"{{4}}"

Responder: {{5}}
```

**Samples:**
- {{1}}: `Mauricio`
- {{2}}: `Maria`
- {{3}}: `VE SOENA — Textiles del Norte`
- {{4}}: `Revisa el bloque documental, falta el RUT actualizado`
- {{5}}: `https://soena.metrikone.co/negocios/a1b2c3d4`

---

## Template 08 — Streak roto

**Nombre:** `metrik_notif_streak_roto`
**Categoria:** Utility
**Idioma:** es_CO
**Body:**

```
Hola {{1}}, tu racha de actividad se rompio despues de {{2}} dias.

Retomar en MeTRIK ONE: {{3}}
```

**Samples:**
- {{1}}: `Mauricio`
- {{2}}: `12`
- {{3}}: `https://metrik.metrikone.co/numeros`

---

## Template 09 — Proyecto entregado

**Nombre:** `metrik_notif_proyecto_entregado`
**Categoria:** Utility
**Idioma:** es_CO
**Body:**

```
Hola {{1}}, el proyecto "{{2}}" se marco como entregado.

Ver resumen: {{3}}
```

**Samples:**
- {{1}}: `Mauricio`
- {{2}}: `Dimpro — Trailer feria`
- {{3}}: `https://metrik.metrikone.co/negocios/a1b2c3d4`

---

## Template 10 — Proyecto cerrado

**Nombre:** `metrik_notif_proyecto_cerrado`
**Categoria:** Utility
**Idioma:** es_CO
**Body:**

```
Hola {{1}}, el proyecto "{{2}}" se cerro.

Ver cierre: {{3}}
```

**Samples:**
- {{1}}: `Mauricio`
- {{2}}: `Happy Nails — Setup gestion financiera`
- {{3}}: `https://metrik.metrikone.co/negocios/a1b2c3d4`

---

## Plantillas de alerta proactiva (wa-alerts) — pendientes de crear

> Detonante: **2026-09-01**. Las tres alertas W25 de ese dia salieron como texto libre y Meta
> las rechazo con **`131047 Re-engagement message`**. Fuera de la ventana de 24 h Meta solo
> entrega plantillas aprobadas, y un cron que dispara a las 8 a.m. **casi siempre** encuentra
> la ventana cerrada: la alerta no se atrasa, no llega nunca. Queda constancia en `wa_envios`.

Los diez templates de arriba cubren las notificaciones de la tabla `notificaciones`. **Ninguno
cubre los cinco avisos de `wa-alerts`**, que son los que hoy estan fallando. Estos son.

El codigo ya esta listo: cada aviso **publica sus variables con nombre** aunque todavia no haya
plantilla. Declararlas es cambiar el secreto `WA_ALERT_TEMPLATES`, sin deploy y sin tocar codigo.
Mientras el secreto no exista, todo sale como texto libre — o sea, igual que hoy.

### A1 — Saldo vencido (`W25`)

**Nombre:** `metrik_alerta_saldo_vencido` · **Utility** · `es_CO`

```
Hola, el negocio {{1}} ({{2}}) tiene un saldo vencido de {{3}} con {{4}} dias de antiguedad.

Revisalo en MeTRIK ONE.
```

| `{{n}}` | variable que publica el codigo | sample |
|---|---|---|
| 1 | `codigo` | `A1 26 1` |
| 2 | `negocio` | `Clarity Express AFI` |
| 3 | `saldo` | `$1.750.000` |
| 4 | `dias` | `42` |

### A2 — Push de saldo bancario (`W33`)

**Nombre:** `metrik_alerta_push_saldo` · **Utility** · `es_CO`

```
Hola {{1}}, tu saldo del banco tiene {{2}} dias sin actualizar.

Respondeme con el monto y lo registro.
```

| `{{n}}` | variable | sample |
|---|---|---|
| 1 | `nombre` | `Mauricio` |
| 2 | `dias` | `9` |

⚠️ **Son dos avisos, no uno.** Quien nunca registro un saldo recibe otro texto, y con un solo
`{{dias}}` le diria "tiene 0 dias sin actualizar". El codigo los separa en dos intents; el
segundo es opcional y puede quedarse sin plantilla.

**Nombre:** `metrik_alerta_sin_saldo` · **Utility** · `es_CO` · intent **`W33_sin_saldo`**

```
Hola {{1}}, aun no has registrado tu saldo bancario.

Respondeme con el monto y lo registro.
```

| `{{n}}` | variable | sample |
|---|---|---|
| 1 | `nombre` | `Mauricio` |

Y `nombre` viaja crudo: un staff sin `full_name` deja la variable vacia y el aviso cae a texto
libre, en vez de mandar una plantilla que saluda a nadie.

### A3 — Negocios en venta sin movimiento (`stale_opps`)

**Nombre:** `metrik_alerta_negocios_estancados` · **Utility** · `es_CO`

```
Hola, tienes {{1}} negocios en venta sin movimiento: {{2}}.

Escribeme "llame a [nombre]" para actualizar.
```

| `{{n}}` | variable | sample |
|---|---|---|
| 1 | `cuantos` | `3` |
| 2 | `detalle` | `Kaeser, Textiles del Norte, Happy Nails` |

### A4 — Recaudo bajo el 50% de la meta (`recaudo_check`)

**Nombre:** `metrik_alerta_recaudo_bajo` · **Utility** · `es_CO`

```
Hola, el recaudo del mes va en {{1}} de la meta: {{2}} de {{3}}.

Revisa tu cartera con "quien me debe".
```

| `{{n}}` | variable | sample |
|---|---|---|
| 1 | `pct` | `38%` |
| 2 | `cobrado` | `$4.200.000` |
| 3 | `meta` | `$11.000.000` |

### A5 — Numero desconocido escribio al bot (`numero_desconocido`)

Lo agrego el PR #470 y sale como texto libre al admin (`WA_ADMIN_NOTIFY_PHONE`), asi que choca
con el mismo 131047. ⚠️ La ventana que importa es la **del admin**, no la del desconocido: que
alguien acabe de escribirle al bot no habilita nada aqui.

**Nombre:** `metrik_alerta_numero_desconocido` · **Utility** · `es_CO`

```
Un numero no registrado le escribio al bot: {{1}}.

Dice: {{2}}. No hay a quien enrutarlo.
```

| `{{n}}` | variable | sample |
|---|---|---|
| 1 | `telefono` | `+573001234567` |
| 2 | `mensaje` | `Buenas, quiero informacion` |

### Decision abierta — el resumen semanal (`W29`) no cabe en una plantilla

`buildWeeklySummary` arma un mensaje de varias secciones con un arbol de proyectos, y un
parametro de cuerpo de Meta **no admite saltos de linea**: ese contenido no entra en una
plantilla. Las dos salidas, y hay que elegir una:

- **(a) Plantilla-empujon.** Una plantilla corta y fija ("tu resumen de la semana esta listo,
  respondeme *resumen*"). Llega siempre, y el resumen rico sale despues como texto libre cuando
  la persona responde — que es lo que abre la ventana. Cuesta un paso mas al usuario.
- **(b) Restructurar.** Que `buildWeeklySummary` devuelva sus cifras sueltas y la plantilla las
  reciba, perdiendo el arbol de proyectos.

Mientras no se decida, W29 sigue como texto libre y **solo llega si la ventana esta abierta**.
Declarar una plantilla para `W29` en el secreto ya funciona: no hace falta tocar codigo.

### El secreto, una vez aprobadas

Se llama **`WA_ALERT_TEMPLATES`** y vive en los secretos de Edge Functions. Un JSON
`{intent: {name, lang, params}}`, donde `params` es el orden de las variables del cuerpo:

```json
{
  "W25":  { "name": "metrik_alerta_saldo_vencido",      "lang": "es_CO", "params": ["codigo", "negocio", "saldo", "dias"] },
  "W33":  { "name": "metrik_alerta_push_saldo",         "lang": "es_CO", "params": ["nombre", "dias"] },
  "W33_sin_saldo": { "name": "metrik_alerta_sin_saldo",  "lang": "es_CO", "params": ["nombre"] },
  "stale_opps":    { "name": "metrik_alerta_negocios_estancados", "lang": "es_CO", "params": ["cuantos", "detalle"] },
  "recaudo_check": { "name": "metrik_alerta_recaudo_bajo",        "lang": "es_CO", "params": ["pct", "cobrado", "meta"] },
  "numero_desconocido": { "name": "metrik_alerta_numero_desconocido", "lang": "es_CO", "params": ["telefono", "mensaje"] }
}
```

```bash
npx supabase secrets set --project-ref yfjqscvvxetobiidnepa WA_ALERT_TEMPLATES="$(cat plantillas.json)"
```

Se puede declarar **de a una**: un intent sin entrada sigue saliendo como texto libre. Conviene
encender la primera sola y comprobarla contra `wa_envios` antes de declarar el resto.

Reglas que aplica el codigo (`_shared/wa-plantillas.ts`, 11 pruebas):

- Un JSON malformado **no tumba el cron**: degrada a texto libre y lo dice en consola. Un
  secreto mal tecleado no puede dejar al equipo sin ninguna alerta.
- Una entrada sin `name` o sin `lang` se descarta **entera**. Adivinar el idioma manda una
  plantilla que Meta rechaza, y el aviso se pierde igual con un error mas dificil de leer.
- Una variable declarada que llega **vacia** cae a texto libre y nombra cual falto. Meta rechaza
  el parametro vacio, y si no lo hiciera el cliente recibiria el aviso con un hueco. El **cero
  si es un valor**, no una ausencia.

### Como comprobar que una plantilla nueva funciona

No basta con que Meta la apruebe ni con que el POST devuelva 200: **las tres W25 del 2026-09-01
devolvieron 200 con wamid y fallaron despues**. El desenlace real esta en `wa_envios`:

```sql
select intent, template_name, status, error_code, error_title, status_at
from public.wa_envios
where origen in ('alerta','interno') and created_at > now() - interval '1 day'
order by created_at desc;
```

Verde es `delivered` o `read`. Un `aceptado` que nunca avanza tambien es sospechoso.

---

## Notas de compliance

- Todos los templates son Utility — **no marketing**. Meta acepta Utility para mensajes operacionales de cuenta.
- Variables como `{{4}}` en URLs son validas siempre que el dominio base sea estable y accesible. Metrikone.co con wildcard SSL cumple.
- No incluir emojis en v1 — reduce riesgo de rechazo por Meta.
- No incluir CTAs promocionales ("Descubre mas", "Aprovecha") — rechazo automatico en Utility.
- Los samples DEBEN coincidir con uso real. Si Meta detecta que el contenido real no concuerda con el sample approved, pueden pausar el template.

## Siguientes pasos

1. ~~Fix Vercel SSO en `metrik.com.co`~~ → hecho (2026-04-28)
2. Verificar contenido de politica de tratamiento menciona WhatsApp → Emilio + Yuto
3. Cargar los 10 templates → Yuto (via Meta Business Manager)
4. Mientras Meta aprueba, construir `wa-notify` edge function + trigger SQL → Max
5. Publicar `wa_phone` y `notificaciones_wa_enabled` en tabla `profiles` → Max
6. Flow de opt-in en primera interaccion del bot → Max + Yuto
