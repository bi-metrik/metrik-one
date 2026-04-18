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

## Notas de compliance

- Todos los templates son Utility — **no marketing**. Meta acepta Utility para mensajes operacionales de cuenta.
- Variables como `{{4}}` en URLs son validas siempre que el dominio base sea estable y accesible. Metrikone.co con wildcard SSL cumple.
- No incluir emojis en v1 — reduce riesgo de rechazo por Meta.
- No incluir CTAs promocionales ("Descubre mas", "Aprovecha") — rechazo automatico en Utility.
- Los samples DEBEN coincidir con uso real. Si Meta detecta que el contenido real no concuerda con el sample approved, pueden pausar el template.

## Siguientes pasos

1. Fix Vercel SSO en `metrik.com.co` → Max
2. Verificar contenido de politica de tratamiento menciona WhatsApp → Emilio + Yuto
3. Cargar los 10 templates → Yuto (via Meta Business Manager)
4. Mientras Meta aprueba, construir `wa-notify` edge function + trigger SQL → Max
5. Publicar `wa_phone` y `notificaciones_wa_enabled` en tabla `profiles` → Max
6. Flow de opt-in en primera interaccion del bot → Max + Yuto
