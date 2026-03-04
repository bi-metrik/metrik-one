---
doc_id: 98F
version: 2.1
updated: 2026-02-22
depends_on: [21], [98A], [98B], [98C], [98E], [99]
depended_by: ninguno
changelog: |
  v2.0 — Fusión spec completa + delta Sesión 5. Agrega W32, W33, actualiza W16/W29. Decisiones D91-D118.
  v2.1 — Gastos Empresariales: confirmación W02 enriquecida (D103) + desambiguación proyecto vs empresa (D104).
---

# Spec: Flujos WhatsApp Bot — MéTRIK ONE

Código: MOD-WA. Canal de registro y consulta por lenguaje natural vía WhatsApp Business API. Solo disponible en plan Pro+.

## §1. Arquitectura General (D85-D89)

### 4 Fases por Mensaje

```
USUARIO envía mensaje
    │
    ▼
FASE 1 — PARSE (Gemini 2.0 Flash)
    Clasifica intención (1 de 16 MVP)
    Extrae hints textuales (monto, nombre, concepto)
    NO resuelve contra datos reales
    │
    ▼
FASE 2 — LOOKUP (Edge Function + Supabase)
    Resuelve hints contra datos reales del tenant
    Match difuso por nombre (pg_trgm)
    Valida reglas de negocio
    │
    ▼
FASE 3 — PRESENT (Edge Function → WhatsApp)
    Muestra opciones con contexto real (%, saldo, horas)
    Si 1 solo match → confirmación directa
    Si múltiples → menú numerado (máx 5 opciones)
    Si 0 matches → pide clarificación
    │
    ▼
FASE 4 — CONFIRM + SAVE (Edge Function + Supabase)
    Usuario confirma con "1", "sí", o emoji ✅
    INSERT/UPDATE en Supabase
    Responde con impacto: estado actualizado post-registro
    Supabase Realtime → UI web se actualiza
```

### Stack Técnico

| Componente | Tecnología | Función |
|-----------|-----------|---------|
| Webhook receptor | Supabase Edge Function (`wa-webhook`) | Recibe POST de Meta |
| Parser NLP | Gemini 2.0 Flash (API REST) | Clasifica intención + extrae campos |
| Base de datos | Supabase PostgreSQL | Lookup, match, persistencia |
| Match difuso | pg_trgm extension | Similarity search por nombre |
| Respuesta | WhatsApp Business API (Meta Cloud) | Envía mensajes al usuario |
| Realtime sync | Supabase Realtime | Actualiza UI web post-registro |

### Edge Functions Requeridas (MVP)

| Función | Responsabilidad |
|---------|----------------|
| `wa-webhook` | Receptor principal. Verifica firma Meta, rutea a handler |
| `wa-parse` | Llama Gemini, retorna intención + hints estructurados |
| `wa-handler-registro` | Procesa W01-W04, W06, W32 |
| `wa-handler-novedad` | Procesa W09, W11 |
| `wa-handler-consulta` | Procesa W14-W17, W19 |
| `wa-handler-accion` | Procesa W22, W23, W24 |
| `wa-handler-alerta` | Cron: genera y envía W25, W29, W33 |
| `wa-respond` | Formatea y envía mensaje vía Meta API |

### Catálogo de Intenciones MVP (v2.0)

**16 intenciones usuario + 3 proactivas = 19 flujos totales.**

| Código | Intención | Tipo | Sección |
|--------|-----------|------|---------|
| W01 | Gasto directo | Registro | §4 |
| W02 | Gasto operativo | Registro | §5 |
| W03 | Horas trabajadas | Registro | §6 |
| W04 | Cobro recibido | Registro | §7 |
| W06 | Contacto nuevo | Registro | §8 |
| W32 | Actualizar saldo bancario | Registro | §9A |
| W09 | Nota sobre oportunidad | Novedad | §9B |
| W11 | Nota sobre proyecto | Novedad | §9B |
| W14 | Estado de proyecto | Consulta | §10 |
| W15 | Estado pipeline | Consulta | §10 |
| W16 | Mis números | Consulta | §10 |
| W17 | Cartera pendiente | Consulta | §10 |
| W19 | Info de contacto | Consulta | §10 |
| W22 | Oportunidad ganada | Acción | §11 |
| W23 | Oportunidad perdida | Acción | §11 |
| W24 | Ayuda | Acción | §11 |
| W25 | Factura vencida | Proactivo | §12 |
| W29 | Resumen semanal | Proactivo | §12 |
| W33 | Push recordatorio saldo | Proactivo | §12 |

---

## §2. Prompt Maestro Gemini (D92)

Un solo prompt para todas las intenciones. Gemini clasifica y extrae en una pasada.

### System Prompt

```
Eres el parser de MéTRIK ONE, un sistema financiero para independientes colombianos.

Tu trabajo: recibir un mensaje de WhatsApp en español colombiano informal y devolver un JSON estructurado con:
1. La intención del mensaje (una de las categorías listadas)
2. Los campos extraídos del texto

REGLAS:
- Responde SOLO con JSON válido, sin texto adicional
- Si no puedes determinar la intención con confianza >70%, usa "UNCLEAR"
- Extrae montos en formato numérico (sin puntos de miles, sin "$")
- Los nombres de personas/empresas van tal cual los escribió el usuario
- Si el mensaje menciona un proyecto/cliente, extráelo como "entity_hint"
- Fechas: si no se menciona, no incluyas el campo (el sistema usa "hoy")
- Montos en pesos colombianos por defecto

INTENCIONES MVP:

REGISTRO:
- GASTO_DIRECTO: Gasto asociable a proyecto ("Gasté X en Y para Z")
- GASTO_OPERATIVO: Gasto general/fijo ("Pagué el arriendo", "Compré internet")
- HORAS: Registro de tiempo ("Trabajé X horas en Y")
- COBRO: Pago recibido ("Me pagaron X de Y")
- CONTACTO_NUEVO: Crear contacto ("Nuevo contacto: nombre, teléfono")
- SALDO_BANCARIO: El usuario reporta cuánto tiene en el banco ("Mi saldo es X", "Tengo X en el banco")

NOVEDADES:
- NOTA_OPORTUNIDAD: Nota sobre prospecto ("Lo de Torres se enfrió")
- NOTA_PROYECTO: Nota sobre proyecto activo ("Nota para Pérez: cambió el color")

CONSULTAS:
- ESTADO_PROYECTO: "¿Cómo va lo de X?"
- ESTADO_PIPELINE: "¿Qué tengo en el horno?"
- MIS_NUMEROS: "¿Cómo estoy este mes?"
- CARTERA: "¿Quién me debe?"
- INFO_CONTACTO: "¿Cuál es el teléfono de X?"

ACCIONES:
- OPP_GANADA: "X aceptó" / "Ganamos lo de X"
- OPP_PERDIDA: "Lo de X no se dio" / "Perdimos X"
- AYUDA: "¿Qué puedo hacer?" / "help" / "?"

UNCLEAR: No se puede determinar

NOTAS PARA SALDO_BANCARIO:
- TRIGGER: El usuario reporta cuánto tiene en el banco o su saldo actual.
- Saldo = estado actual de la cuenta. No es un movimiento.
- Extraer SOLO monto (obligatorio). No extraer nombre de banco ni fecha.
- CONFUSIÓN FRECUENTE:
  - "Me pagaron 3 millones" → COBRO, NO saldo
  - "Tengo 3 millones en cartera" → CONSULTA (CARTERA), NO saldo
  - "Gasté 500 mil" → GASTO, NO saldo

FORMATO DE RESPUESTA:

{
  "intent": "GASTO_DIRECTO",
  "confidence": 0.92,
  "fields": {
    "amount": 180000,
    "concept": "transporte",
    "entity_hint": "Pérez",
    "category_hint": "transporte"
  }
}
```

### Ejemplos de Parsing (few-shot en el prompt)

| Mensaje usuario | Intent | Fields |
|----------------|--------|--------|
| "Gasté 180 mil en transporte para lo de Pérez" | GASTO_DIRECTO | amount: 180000, concept: "transporte", entity_hint: "Pérez", category_hint: "transporte" |
| "Pagué el arriendo, 2 palos" | GASTO_OPERATIVO | amount: 2000000, concept: "arriendo", category_hint: "arriendo" |
| "Hoy le metí 4 horas a lo de María" | HORAS | hours: 4, entity_hint: "María" |
| "Me consignaron 3 millones del edificio" | COBRO | amount: 3000000, entity_hint: "edificio" |
| "Anota: Ana Gómez, 315 555 1234, arquitecta" | CONTACTO_NUEVO | name: "Ana Gómez", phone: "3155551234", role: "arquitecta" |
| "Lo de Torres se puso difícil, el gerente viajó" | NOTA_OPORTUNIDAD | entity_hint: "Torres", note: "se puso difícil, el gerente viajó" |
| "¿Cómo vamos con Pérez?" | ESTADO_PROYECTO | entity_hint: "Pérez" |
| "Pérez aceptó la propuesta, ganamos" | OPP_GANADA | entity_hint: "Pérez" |
| "Mi saldo es 12 millones" | SALDO_BANCARIO | amount: 12000000 |
| "Tengo 4.800.000 en el banco" | SALDO_BANCARIO | amount: 4800000 |
| "En la cuenta hay 8 palos" | SALDO_BANCARIO | amount: 8000000 |
| "Saldo: 15M" | SALDO_BANCARIO | amount: 15000000 |
| "jajaja no sé qué hacer aquí" | AYUDA | — |
| "Hola" | UNCLEAR | — |

### Manejo de Coloquialismos Colombianos

| Expresión | Interpretación |
|-----------|---------------|
| "X palos" | X × 1,000,000 |
| "X lucas" | X × 1,000 |
| "X barras" | X × 1,000,000 |
| "una luca" | 1,000 |
| "medio palo" | 500,000 |
| "le metí X horas" | Trabajé X horas |
| "me consignaron" | Me pagaron |
| "me giraron" | Me pagaron |
| "quedó en veremos" | Oportunidad estancada |
| "se cayó" | Oportunidad perdida |
| "lo de [nombre]" | Proyecto o oportunidad asociada a [nombre] |

---

## §3. Decisiones Transversales (D94-D100)

### D94 — Pregunta #2: Hard Gate Fiscal por WhatsApp (W22)

**Decisión:** Oportunidad ganada (W22) NO completa el hard gate fiscal por WhatsApp. El bot registra la intención y redirige a la app.

**Flujo W22:**
1. Usuario dice "Pérez aceptó"
2. Bot confirma: "¡Bien! Voy a mover lo de Pérez a Ganada."
3. Bot valida si el contacto tiene datos fiscales completos
4. Si NO tiene datos fiscales → "Para cerrar esta oportunidad necesito los datos fiscales de Pérez. Complétalo en la app: [link directo al contacto]"
5. Si SÍ tiene datos fiscales → Cambia estado, crea proyecto automáticamente, responde con resumen

**Razón:** Los datos fiscales (NIT, régimen, agente retenedor) requieren precisión que WhatsApp no garantiza. Un error fiscal genera facturas incorrectas. Hana valida: "El hard gate es protección, no burocracia."

### D95 — Pregunta #5: Novedades — Texto Libre vs Parsing

**Decisión:** W09 (nota oportunidad) y W11 (nota proyecto) son **texto libre**. Gemini extrae solo el entity_hint para asociar la nota al registro correcto. El contenido de la nota se guarda tal cual.

**Razón:** Parsear notas libres para extraer campos estructurados genera falsos positivos. "El gerente viajó" no es un cambio de estado — es contexto. Mejor guardar verbatim y dejar que el usuario cambie estado explícitamente.

### D96 — Pregunta #7: Fallback (Intent UNCLEAR)

**Decisión:** Cuando Gemini retorna UNCLEAR o confidence < 0.6:

```
Bot: "No estoy seguro de entender. ¿Qué quieres hacer?

1️⃣ Registrar un gasto
2️⃣ Registrar horas
3️⃣ Registrar un cobro
4️⃣ Consultar un proyecto
5️⃣ Ver mis números
6️⃣ Otra cosa

Responde con el número."
```

Si el usuario responde "6" → "Escríbeme con más detalle qué necesitas y lo intento de nuevo. Si prefieres, entra a la app: [link]"

Si el usuario envía 3 mensajes UNCLEAR consecutivos → "Parece que no estoy entendiendo bien. Te recomiendo usar la app para esto: [link]. Si crees que debería entender tu mensaje, escríbeme 'ayuda' para ver qué puedo hacer."

### D97 — Pregunta #8: Rate Limiting

**Decisión:** 
- **Mensajes entrantes:** 30 mensajes por usuario por hora. Después: "Has enviado muchos mensajes. Espera unos minutos o usa la app: [link]"
- **Llamadas Gemini:** 1 por mensaje entrante (prompt maestro = 1 sola pasada)
- **Mensajes salientes (alertas):** Máximo 2 alertas por día por usuario. Las alertas se acumulan y se envían en batch (resumen semanal W29 agrupa todo)

**Costo estimado:** 30 msg/hr × 24hr = 720 msg/día máx teórico. Uso realista: ~15-25 msg/día por usuario activo. A $0.003 USD por llamada Gemini Flash ≈ $0.075 USD/día/usuario = $2.25 USD/mes. Muy dentro del margen del plan Pro+ ($149K COP ≈ $35 USD).

### D98 — Pregunta #9: Idioma

**Decisión:** **Solo español** para MVP. El prompt de Gemini está en español, los mensajes del bot son en español. Si el usuario escribe en inglés, Gemini debería poder parsear igualmente (es multilingüe), pero las respuestas del bot siempre son en español.

**Post-MVP:** Evaluar inglés si hay demanda. El cambio sería agregar templates de respuesta en inglés y un campo `language` en el perfil del usuario.

### D99 — Pregunta #4: Colaboradores de Campo

**Decisión para MVP:** Los colaboradores WhatsApp (técnicos de campo) solo pueden usar un subset de intenciones:

| Intención | Dueño | Colaborador |
|-----------|-------|-------------|
| W01 Gasto directo | ✅ | ✅ (solo proyectos asignados) |
| W02 Gasto operativo | ✅ | ❌ |
| W03 Horas | ✅ | ✅ (solo proyectos asignados) |
| W04 Cobro | ✅ | ❌ |
| W06 Contacto nuevo | ✅ | ❌ |
| W09 Nota oportunidad | ✅ | ❌ |
| W11 Nota proyecto | ✅ | ✅ (solo proyectos asignados) |
| W14 Estado proyecto | ✅ | ✅ (solo proyectos asignados) |
| W15-W17, W19 Consultas | ✅ | ❌ |
| W22-W23 Opp ganada/perdida | ✅ | ❌ |
| W24 Ayuda | ✅ | ✅ |
| W25, W29, W33 Alertas | ✅ | ❌ |
| W32 Saldo bancario | ✅ | ❌ |

**Identificación del colaborador:** Por número de teléfono registrado en la tabla `personal` del tenant. Si el número no está registrado → "No te tengo registrado. Pídele a tu jefe que te agregue en la app."

### D100 — Formato de Mensajes WhatsApp

**Reglas de formato:**
- Máximo 3 emojis por mensaje
- Montos siempre formateados: $2.350.000
- Porcentajes con 1 decimal: 73.2%
- Nombres en negrita: *Pérez*
- Confirmaciones usan ✅, alertas usan ⚠️, errores usan ❌
- Mensajes máximo 500 caracteres (WhatsApp trunca después)
- Si la respuesta requiere más de 500 chars → enviar en 2 mensajes con 1 segundo de delay
- No usar markdown complejo (WhatsApp solo soporta *bold*, _italic_, ~strikethrough~, ```code```)

---

## §4. Flujo W01 — Registrar Gasto Directo

**Intención:** Usuario reporta un gasto asociado a un proyecto activo.

**Ejemplo:** "Gasté 180 mil en transporte para lo de Pérez"

**Complejidad:** Alta — match proyecto + categoría + posible match contra gasto fijo borrador (D84).

### Fase 1: PARSE (Gemini)

```json
{
  "intent": "GASTO_DIRECTO",
  "confidence": 0.91,
  "fields": {
    "amount": 180000,
    "concept": "transporte",
    "entity_hint": "Pérez",
    "category_hint": "transporte"
  }
}
```

### Fase 2: LOOKUP (Edge Function)

```sql
-- 1. Buscar proyectos activos que matcheen con entity_hint
SELECT p.id, p.nombre, c.nombre as cliente, p.presupuesto_total, 
       p.gasto_acumulado, p.presupuesto_total - p.gasto_acumulado as saldo_disponible
FROM proyectos p
JOIN contactos c ON p.contacto_id = c.id
WHERE p.tenant_id = :tenant_id
  AND p.estado = 'activo'
  AND (similarity(c.nombre, :entity_hint) > 0.3 
       OR similarity(p.nombre, :entity_hint) > 0.3)
ORDER BY similarity(c.nombre, :entity_hint) DESC
LIMIT 5;

-- 2. Mapear category_hint a categoría de gasto
SELECT id, nombre FROM categorias_gasto
WHERE tenant_id = :tenant_id
  AND similarity(nombre, :category_hint) > 0.3
ORDER BY similarity(nombre, :category_hint) DESC
LIMIT 3;

-- 3. Check reconciliación: ¿hay borrador de gasto fijo que matchee? (D84)
SELECT gf.id, gf.concepto, gf.monto_esperado, gf.mes
FROM gastos_fijos_borradores gf
WHERE gf.tenant_id = :tenant_id
  AND gf.estado = 'pendiente'
  AND gf.mes = date_trunc('month', CURRENT_DATE)
  AND (similarity(gf.concepto, :concept) > 0.4 
       OR gf.categoria_id = :matched_category_id)
  AND ABS(gf.monto_esperado - :amount) / gf.monto_esperado < 0.2  -- ±20% tolerancia
LIMIT 1;
```

### Fase 3: PRESENT

**Caso A — 1 proyecto match + categoría clara + sin match gasto fijo:**

```
✅ Registro gasto directo:

📂 Proyecto: *Remodelación Pérez*
💰 Monto: $180.000
📋 Categoría: Transporte y movilidad
📅 Fecha: Hoy

Presupuesto Pérez: $4.500.000 gastado de $8.000.000 (56.3%)
Con este gasto quedaría en $4.680.000 (58.5%)

¿Confirmo? (Sí/No)
```

**Caso B — Match contra borrador gasto fijo (D84):**

```
🔄 Encontré un gasto fijo pendiente similar:

Borrador: *Transporte mensual* — $200.000 esperado
Tu gasto: $180.000

1️⃣ Es el mismo gasto fijo (confirmar borrador con $180.000)
2️⃣ Es un gasto aparte del proyecto *Pérez*
3️⃣ Cancelar

¿Cuál?
```

**Caso C — Múltiples proyectos match:**

```
💰 Gasto de $180.000 en transporte. ¿Para cuál proyecto?

1️⃣ *Remodelación Pérez* — 56.3% presupuesto usado
2️⃣ *Ampliación Pérez* — 23.1% presupuesto usado

Responde con el número.
```

**Caso D — 0 proyectos match:**

```
❌ No encontré proyecto activo con "*Pérez*".

Tus proyectos activos son:
1️⃣ *Remodelación Torres*
2️⃣ *Casa García*
3️⃣ Registrar como gasto operativo (sin proyecto)

¿Cuál? O escríbeme el nombre correcto.
```

**Caso E — Categoría no clara:**

```
💰 Gasto de $180.000 en *Pérez*. ¿Qué categoría?

1️⃣ Transporte y movilidad 🚗
2️⃣ Materiales e insumos 📦
3️⃣ Alimentación trabajo 🍽️
4️⃣ Otra

Responde con el número.
```

### Fase 4: CONFIRM + SAVE

```sql
INSERT INTO gastos (tenant_id, proyecto_id, monto, categoria_id, descripcion, fecha, tipo, registrado_via)
VALUES (:tenant_id, :proyecto_id, 180000, :cat_id, 'transporte', CURRENT_DATE, 'directo', 'whatsapp');
```

**Respuesta post-registro:**

```
✅ Gasto registrado.

📂 *Remodelación Pérez*
├ Presupuesto usado: $4.680.000 / $8.000.000 (58.5%)
├ Horas registradas: 42 / 60h
└ Margen proyectado: 34.2%
```

### Edge Cases

| Caso | Manejo |
|------|--------|
| Monto = 0 o negativo | "El monto debe ser mayor a $0. ¿Cuánto fue el gasto?" |
| Monto > presupuesto restante | Registrar + alerta: "⚠️ Este gasto supera el presupuesto restante de *Pérez*. Presupuesto excedido en $180.000." |
| Sin proyectos activos | "No tienes proyectos activos. ¿Quieres registrarlo como gasto operativo?" |
| Colaborador en proyecto no asignado | "No estás asignado al proyecto *Pérez*. Solo puedes registrar gastos en tus proyectos." |
| Mensaje con foto adjunta | Guardar imagen como `soporte_url` en el registro. "Guardé el soporte fotográfico." |

---

## §5. Flujo W02 — Registrar Gasto Operativo — 🆕v2.1

**Intención:** Gasto general del negocio, no asociado a proyecto. Incluye gastos fijos recurrentes y gastos de empresa esporádicos (categorías 6-9).

**Ejemplos:**
- "Pagué el arriendo, 2 millones"
- "Pagué la pauta de LinkedIn, 150 mil"
- "Compré materiales de oficina, 80 mil"

**Complejidad:** Media — match contra borradores gastos fijos (D84), categorización, desambiguación proyecto vs empresa (D104).

---

### Fase 0: 🆕v2.1 PRE-CHECK — Desambiguación (D104)

**Trigger:** ANTES de ejecutar Fase 1 (PARSE), evaluar si aplica desambiguación.

```
SI intent = GASTO_OPERATIVO Y (category_hint IN [1,2,3,4,5] O confidence < 0.75):
  → ACTIVAR flujo de desambiguación (ver abajo)

SI intent = GASTO_OPERATIVO Y category_hint IN [6,7,8,9] Y confidence >= 0.75:
  → Continuar a Fase 1 normal (es claramente gasto de empresa)
```

**Categorías 1-5 que activan desambiguación:**
- Mano de obra / subcontratistas
- Materiales e insumos
- Viáticos (transporte + alimentación)
- Software y tecnología
- Servicios profesionales

**Razonamiento:** Estas categorías pueden ser tanto costo directo de un proyecto como gasto operativo de empresa. Gemini puede confundirlas.

**Flujo de desambiguación:**

```
Bot → usuario:
"💰 ${monto} en {concept}.

¿Este gasto es de...?
1️⃣ 📂 Un proyecto de trabajo
2️⃣ 🏢 Mi empresa (gasto operativo)

Responde con el número."
```

```
SI usuario responde 1️⃣ → rutear a W01 (GASTO_DIRECTO)
  → Continuar flujo W01 desde Fase 2 (LOOKUP proyectos)

SI usuario responde 2️⃣ → continuar W02 Fase 1 (PARSE) con categoría del hint
  → tipo = 'empresa' en el INSERT final
```

**Edge cases desambiguación:**

| Caso | Manejo |
|------|--------|
| Usuario no responde 1 ni 2 | "Responde 1 para proyecto o 2 para empresa. ¿Cuál es?" |
| Usuario dice "ninguno" | "Entendido. ¿Quieres cancelar el registro?" |
| Sin proyectos activos | Saltar desambiguación → registrar como empresa directamente |

---

### Fase 1: PARSE

```json
{
  "intent": "GASTO_OPERATIVO",
  "confidence": 0.94,
  "fields": {
    "amount": 2000000,
    "concept": "arriendo",
    "category_hint": "arriendo"
  }
}
```

---

### Fase 2: LOOKUP

```sql
-- 1. Check contra borradores de gastos fijos del mes (D84)
SELECT gf.id, gf.concepto, gf.monto_esperado, gf.categoria_id, c.nombre as categoria
FROM gastos_fijos_borradores gf
JOIN categorias_gasto c ON gf.categoria_id = c.id
WHERE gf.tenant_id = :tenant_id
  AND gf.estado = 'pendiente'
  AND gf.mes = date_trunc('month', CURRENT_DATE)
  AND (similarity(gf.concepto, :concept) > 0.4 
       OR similarity(c.nombre, :category_hint) > 0.3)
ORDER BY similarity(gf.concepto, :concept) DESC
LIMIT 3;

-- 2. Si no hay match en borradores, buscar categoría
SELECT id, nombre FROM categorias_gasto
WHERE tenant_id = :tenant_id
  AND similarity(nombre, :category_hint) > 0.3
ORDER BY similarity(nombre, :category_hint) DESC
LIMIT 3;

-- 3. 🆕v2.1 Acumulado gastos empresa del mes (para feedback D103)
SELECT 
  SUM(monto) as total_empresa_mes,
  COUNT(*) as num_gastos
FROM gastos
WHERE tenant_id = :tenant_id
  AND proyecto_id IS NULL
  AND fecha >= date_trunc('month', CURRENT_DATE)
  AND fecha < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month';
```

---

### Fase 3: PRESENT

**Caso A — Match exacto con borrador gasto fijo:**

```
🔄 Confirmo gasto fijo del mes:

📋 *Arriendo oficina* — Esperado: $2.000.000
💰 Tu pago: $2.000.000 ✅ Coincide

¿Confirmo? (Sí/No)
```

**Caso B — Match con borrador pero monto diferente:**

```
🔄 Encontré gasto fijo similar:

📋 *Arriendo oficina* — Esperado: $2.200.000
💰 Tu pago: $2.000.000 (diferencia: -$200.000)

1️⃣ Confirmar con $2.000.000 (actualizar monto real)
2️⃣ Es un gasto diferente, no es el arriendo
3️⃣ Cancelar
```

**Caso C — Sin match en borradores:**

```
💰 Gasto de empresa:

💵 $2.000.000 — Arriendo y espacios
📅 Hoy

¿Confirmo? (Sí/No)
```

---

### Fase 4: CONFIRM + SAVE

Si es confirmación de borrador:
```sql
UPDATE gastos_fijos_borradores 
SET estado = 'confirmado', monto_real = :amount, fecha_confirmacion = CURRENT_DATE, confirmado_via = 'whatsapp'
WHERE id = :borrador_id;
```

Si es gasto nuevo:
```sql
INSERT INTO gastos (tenant_id, monto, categoria_id, descripcion, fecha, tipo, registrado_via)
VALUES (:tenant_id, :amount, :cat_id, :concept, CURRENT_DATE, 'empresa', 'whatsapp');
-- 🆕v2.1: tipo = 'empresa' (no 'operativo') para gastos registrados por path empresa
```

---

### Respuesta post-registro — 🆕v2.1 (D103)

**Formato enriquecido:**

```
✅ Gasto de empresa registrado:
💰 $2.000.000 — Arriendo y espacios
📊 Gastos empresa este mes: $3.800.000
   (Arriendo $2M · Internet $800K · Contador $1M)
📎 ¿Tienes soporte? 📷 Ahora / ⏰ Después / ❌ No
```

**Variables del mensaje:**

| Variable | Fuente |
|----------|--------|
| Monto registrado | Input del usuario |
| Categoría confirmada | Match Fase 2 |
| `Gastos empresa este mes` | Query acumulado §Fase 2 Query 3 |
| Detalle últimos gastos | `SELECT concepto, monto FROM gastos WHERE proyecto_id IS NULL ORDER BY fecha DESC LIMIT 3` |

**Regla de longitud:** Si el detalle de gastos supera 3 ítems o 400 caracteres → truncar a "y X más".

**Manejo de soporte:**
- Usuario responde 📷 / "foto" / "ahora" → bot espera imagen por 5 min → `UPDATE gastos SET soporte_url = :url WHERE id = :gasto_id`
- Usuario responde "después" → registrar sin soporte, marcar `soporte_pendiente = true`
- Usuario responde "no" → registrar sin soporte

---

### Edge Cases W02

| Caso | Manejo |
|------|--------|
| Monto = 0 o negativo | "El monto debe ser mayor a $0. ¿Cuánto fue el gasto?" |
| Categoría no identificada (confidence < 0.5) | "¿Qué tipo de gasto es? 1️⃣ Arriendo 2️⃣ Marketing 3️⃣ Impuestos/Seguros 4️⃣ Capacitación" |
| Gemini clasifica como GASTO_OPERATIVO pero usuario menciona cliente | Activar desambiguación D104 aunque confidence sea alta |
| Sin acumulado del mes (primer gasto) | Omitir línea de acumulado. Solo mostrar categoría + soporte prompt |
| Gasto muy alto (>$10M) | Agregar: "⚠️ Monto alto. ¿Confirmas $10.500.000?" |

---

## §6. Flujo W03 — Registrar Horas

**Intención:** Registro de tiempo trabajado en un proyecto.

**Ejemplo:** "Trabajé 4 horas hoy en lo de María"

**Complejidad:** Media — match proyecto + feedback horas acumuladas.

### Fase 1: PARSE

```json
{
  "intent": "HORAS",
  "confidence": 0.93,
  "fields": {
    "hours": 4,
    "entity_hint": "María",
    "date_hint": "hoy"
  }
}
```

### Fase 2: LOOKUP

```sql
SELECT p.id, p.nombre, c.nombre as cliente, 
       p.horas_estimadas, p.horas_registradas,
       p.horas_estimadas - p.horas_registradas as horas_disponibles,
       CASE WHEN p.horas_registradas + :hours > p.horas_estimadas * 1.1 
            THEN true ELSE false END as excede_estimado
FROM proyectos p
JOIN contactos c ON p.contacto_id = c.id
WHERE p.tenant_id = :tenant_id
  AND p.estado = 'activo'
  AND (similarity(c.nombre, :entity_hint) > 0.3 
       OR similarity(p.nombre, :entity_hint) > 0.3)
ORDER BY similarity(c.nombre, :entity_hint) DESC
LIMIT 5;
```

### Fase 3: PRESENT

**Caso A — 1 proyecto, dentro del estimado:**

```
⏱️ Registro de horas:

📂 Proyecto: *Casa María Rodríguez*
🕐 Horas: 4h (hoy)
📊 Acumulado: 38h / 60h estimadas (63.3%)

¿Confirmo? (Sí/No)
```

**Caso B — 1 proyecto, excede estimado (D88):**

```
⚠️ Registro de horas:

📂 Proyecto: *Casa María Rodríguez*
🕐 Horas: 4h (hoy)
📊 Acumulado: 64h / 60h estimadas (106.7%)

⚠️ Superaste el estimado de horas en 4h. Esto reduce tu margen.

¿Confirmo de todas formas? (Sí/No)
```

**Caso C — 1 proyecto activo (D88 — simplificación):**

Si el usuario tiene un solo proyecto activo y no mencionó entidad:

```
⏱️ 4 horas para *Casa María Rodríguez* (tu único proyecto activo).

Acumulado: 38h / 60h (63.3%)

¿Confirmo? (Sí/No)
```

**Caso D — Colaborador registra horas:**

```
⏱️ Registro de horas:

📂 Proyecto: *Casa María Rodríguez*
👤 Técnico: Juan Pérez
🕐 Horas: 4h (hoy)

¿Confirmo? (Sí/No)
```

### Fase 4: CONFIRM + SAVE

```sql
INSERT INTO registros_horas (tenant_id, proyecto_id, persona_id, horas, fecha, registrado_via)
VALUES (:tenant_id, :proyecto_id, :persona_id, 4, CURRENT_DATE, 'whatsapp');
```

**Respuesta:**

```
✅ 4 horas registradas en *María Rodríguez*.

📂 *Casa María Rodríguez*
├ Horas: 42 / 60h (70.0%)
├ Costo acumulado horas: $2.520.000
└ Margen proyectado: 31.5%
```

### Edge Cases

| Caso | Manejo |
|------|--------|
| Horas > 16 en un día | "¿Seguro? 16 horas es mucho. Confirma el número." |
| Horas = 0 | "El registro debe ser mayor a 0 horas." |
| Horas con decimales | Aceptar: "3.5 horas" = 3h 30min |
| "Trabajé todo el día" | "¿Cuántas horas fueron? (ej: 8)" |
| Colaborador sin costo hora | Registrar horas pero nota: "⚠️ No tienes tarifa hora configurada. Pídele a tu jefe que la configure." |

---

## §7. Flujo W04 — Registrar Cobro

**Intención:** El usuario recibió un pago de un cliente.

**Ejemplo:** "Me pagaron 3 millones del edificio"

**Complejidad:** Alta — match proyecto + selección de factura con saldo pendiente.

### Fase 1: PARSE

```json
{
  "intent": "COBRO",
  "confidence": 0.90,
  "fields": {
    "amount": 3000000,
    "entity_hint": "edificio"
  }
}
```

### Fase 2: LOOKUP

```sql
-- 1. Buscar proyecto
SELECT p.id, p.nombre, c.nombre as cliente
FROM proyectos p
JOIN contactos c ON p.contacto_id = c.id
WHERE p.tenant_id = :tenant_id
  AND p.estado IN ('activo', 'pausado')
  AND (similarity(c.nombre, :entity_hint) > 0.3 
       OR similarity(p.nombre, :entity_hint) > 0.3)
LIMIT 5;

-- 2. Buscar facturas con saldo del proyecto
SELECT f.id, f.numero, f.monto_total, f.monto_cobrado, 
       f.monto_total - f.monto_cobrado as saldo_pendiente,
       f.fecha_emision, 
       CURRENT_DATE - f.fecha_emision as dias_emision
FROM facturas f
WHERE f.proyecto_id = :proyecto_id
  AND f.monto_total - f.monto_cobrado > 0
ORDER BY f.fecha_emision ASC;
```

### Fase 3: PRESENT

**Caso A — 1 factura con saldo que matchea el cobro:**

```
💰 Cobro recibido:

📂 Proyecto: *Edificio Torres*
📄 Factura: #0023 — Saldo pendiente: $3.000.000
💵 Cobro: $3.000.000 ✅ Pago completo

¿Confirmo? (Sí/No)
```

**Caso B — Múltiples facturas con saldo:**

```
💰 Cobro de $3.000.000 para *Edificio Torres*. ¿A cuál factura?

1️⃣ Factura #0023 — Saldo: $3.000.000 (emitida hace 15 días)
2️⃣ Factura #0025 — Saldo: $5.200.000 (emitida hace 3 días)
3️⃣ Abono general (sin asociar a factura específica)

Responde con el número.
```

**Caso C — Cobro mayor al saldo de una factura:**

```
💰 Cobro de $3.000.000 para *Edificio Torres*.

📄 Factura #0023 tiene saldo de $2.000.000.

1️⃣ Aplicar $2.000.000 a factura #0023 + $1.000.000 a factura #0025
2️⃣ Aplicar todo a factura #0023 ($1.000.000 queda como anticipo)
3️⃣ Cancelar y corregir monto

¿Cuál?
```

**Caso D — Sin facturas emitidas:**

```
💰 Cobro de $3.000.000 para *Edificio Torres*.

⚠️ No hay facturas emitidas para este proyecto. El cobro se registra como anticipo.

¿Confirmo? (Sí/No)
```

### Fase 4: CONFIRM + SAVE

```sql
INSERT INTO cobros (tenant_id, proyecto_id, factura_id, monto, fecha, registrado_via)
VALUES (:tenant_id, :proyecto_id, :factura_id, 3000000, CURRENT_DATE, 'whatsapp');

-- Actualizar saldo factura
UPDATE facturas SET monto_cobrado = monto_cobrado + 3000000 WHERE id = :factura_id;
```

**Respuesta:**

```
✅ Cobro registrado.

📂 *Edificio Torres*
├ Facturado: $12.000.000
├ Cobrado: $9.500.000 (79.2%)
├ Cartera pendiente: $2.500.000
└ Próximo vencimiento: Factura #0025 — $2.500.000 (vence en 12 días)
```

---

## §8. Flujo W06 — Crear Contacto Nuevo

**Intención:** Agregar un nuevo contacto al directorio.

**Ejemplo:** "Nuevo contacto: Ana Gómez, 315 555 1234, arquitecta"

**Complejidad:** Baja — check duplicado por nombre/teléfono.

### Fase 1: PARSE

```json
{
  "intent": "CONTACTO_NUEVO",
  "confidence": 0.95,
  "fields": {
    "name": "Ana Gómez",
    "phone": "3155551234",
    "role": "arquitecta"
  }
}
```

### Fase 2: LOOKUP

```sql
-- Check duplicado por nombre o teléfono
SELECT id, nombre, telefono, email
FROM contactos
WHERE tenant_id = :tenant_id
  AND (similarity(nombre, :name) > 0.7 
       OR telefono = :phone)
LIMIT 3;
```

### Fase 3: PRESENT

**Caso A — Sin duplicados:**

```
👤 Nuevo contacto:

📛 Nombre: *Ana Gómez*
📱 Teléfono: 315 555 1234
💼 Rol: Arquitecta

¿Confirmo? (Sí/No)

Tip: Completa email y datos fiscales en la app cuando la contactes 💡
```

**Caso B — Posible duplicado:**

```
⚠️ Ya existe un contacto similar:

👤 *Ana Gómez López* — 315 555 1234

1️⃣ Es la misma persona (no crear nuevo)
2️⃣ Es diferente, crear contacto nuevo
3️⃣ Cancelar
```

**Caso C — Datos incompletos (solo nombre):**

```
👤 Nuevo contacto: *Ana Gómez*

No tengo teléfono ni email. ¿Quieres agregarlo así o me das más datos?

1️⃣ Crear solo con nombre
2️⃣ Cancelar y completar en la app
```

### Fase 4: CONFIRM + SAVE

```sql
INSERT INTO contactos (tenant_id, nombre, telefono, rol, creado_via)
VALUES (:tenant_id, 'Ana Gómez', '3155551234', 'arquitecta', 'whatsapp');
```

**Respuesta:**

```
✅ Contacto creado: *Ana Gómez* (Arquitecta)

Para crear una oportunidad con Ana, escríbeme:
"Nueva oportunidad con Ana Gómez, [descripción], [valor estimado]"

O completa sus datos fiscales en la app para poder facturarle.
```

---

## §9A. Flujo W32 — Actualizar Saldo Bancario (NUEVO v2.0)

**Intención:** El usuario reporta su saldo real del banco para conciliación.

**Ejemplo:** "Mi saldo es 12 millones" / "Tengo 4.800.000 en el banco" / "Saldo: 15M"

**Complejidad:** Baja — solo monto, una cuenta en MVP.

**Decisiones fuente:** D109 (conciliación simplificada), D110 (una cuenta MVP), D111 (tolerancias), D114 (3 canales), D115 (banco siempre gana), D117 (streak).

### Fase 1: PARSE (Gemini)

```json
{
  "intent": "SALDO_BANCARIO",
  "confidence": 0.93,
  "fields": {
    "amount": 12000000
  }
}
```

**Nota parsing:** Gemini NO extrae nombre de banco (MVP = 1 cuenta, D110) ni fecha (siempre es ahora).

### Fase 2: LOOKUP (Edge Function)

```sql
-- 1. Obtener último saldo registrado + saldo teórico
SELECT 
  sb.saldo_real as ultimo_saldo_real,
  sb.fecha as fecha_ultimo_saldo,
  CURRENT_DATE - sb.fecha::date as dias_sin_actualizar
FROM saldos_banco sb
WHERE sb.tenant_id = :tenant_id
ORDER BY sb.fecha DESC
LIMIT 1;

-- 2. Calcular saldo teórico desde último saldo real
-- saldo_teorico = ultimo_saldo_real + cobros_desde - gastos_desde
SELECT 
  COALESCE(SUM(c.monto), 0) as cobros_desde
FROM cobros c
WHERE c.tenant_id = :tenant_id
  AND c.fecha > (SELECT MAX(fecha) FROM saldos_banco WHERE tenant_id = :tenant_id);

SELECT 
  COALESCE(SUM(g.monto), 0) as gastos_desde
FROM gastos g
WHERE g.tenant_id = :tenant_id
  AND g.fecha > (SELECT MAX(fecha) FROM saldos_banco WHERE tenant_id = :tenant_id);

-- saldo_teorico = ultimo_saldo_real + cobros_desde - gastos_desde
-- diferencia = :nuevo_saldo_real - saldo_teorico

-- 3. Obtener streak actual
SELECT semanas_actuales, semanas_record
FROM streaks
WHERE tenant_id = :tenant_id AND tipo = 'conciliacion';
```

### Fase 3: PRESENT

**Caso A — Diferencia dentro de tolerancia (D111: ±$50K o ±2%):**

```
🏦 ¿Actualizo tu saldo del banco a $12.000.000?

Saldo teórico calculado: $11.800.000
Diferencia: +$200.000 (1.7%) ✅ Dentro de tolerancia

¿Confirmo? (Sí/No)
```

**Caso B — Diferencia menor (D111: $50K-500K o 2-10%):**

```
🏦 ¿Actualizo tu saldo del banco a $12.000.000?

Saldo teórico calculado: $11.200.000
Diferencia: +$800.000 (7.1%) ⚠️

Puede haber un ingreso o gasto sin registrar. Revisa en la app → Números.

¿Confirmo de todas formas? (Sí/No)
```

**Caso C — Diferencia importante (D111: >$500K o >10%):**

```
🏦 ¿Actualizo tu saldo del banco a $12.000.000?

Saldo teórico calculado: $9.500.000
Diferencia: +$2.500.000 (26.3%) ⚠️ Importante

Hay movimientos sin registrar. Te recomiendo revisar en la app → Números antes de continuar.

1️⃣ Confirmar de todas formas
2️⃣ Cancelar y revisar primero
```

**Caso D — Primer saldo (sin historial):**

```
🏦 ¿Registro tu saldo inicial del banco en $12.000.000?

Es tu primer registro de saldo. A partir de ahora, el sistema calculará la diferencia entre lo que registras y lo que debería haber según tus cobros y gastos.

¿Confirmo? (Sí/No)
```

**Caso E — Milestone de streak (D117):**

Después de confirmar, si alcanza milestone:

```
✅ Saldo actualizado.

🏆 ¡Llevas 12 semanas seguidas actualizando! 🥈

Diferencia: +$200.000 (dentro de tolerancia)
```

### Fase 4: CONFIRM + SAVE

```sql
-- Calcular saldo teórico antes de insertar
WITH calculo AS (
  SELECT 
    COALESCE(sb.saldo_real, 0) + 
    COALESCE((SELECT SUM(monto) FROM cobros WHERE tenant_id = :tenant_id AND fecha > sb.fecha), 0) -
    COALESCE((SELECT SUM(monto) FROM gastos WHERE tenant_id = :tenant_id AND fecha > sb.fecha), 0)
    as saldo_teorico
  FROM saldos_banco sb
  WHERE sb.tenant_id = :tenant_id
  ORDER BY sb.fecha DESC
  LIMIT 1
)
INSERT INTO saldos_banco (tenant_id, saldo_real, saldo_teorico, diferencia, fecha, registrado_via)
VALUES (
  :tenant_id, 
  :amount, 
  (SELECT saldo_teorico FROM calculo),
  :amount - (SELECT saldo_teorico FROM calculo),
  NOW(), 
  'whatsapp'
);

-- Actualizar streak
UPDATE streaks 
SET semanas_actuales = semanas_actuales  -- el cron semanal evalúa esto
WHERE tenant_id = :tenant_id AND tipo = 'conciliacion';
-- Nota: El streak se evalúa con cron dominical, no en el INSERT.
-- El INSERT solo registra el saldo. El cron verifica si hubo registro en la semana.
```

**Respuesta post-registro (sin milestone):**

```
✅ Saldo actualizado a $12.000.000.

Saldo teórico era: $11.800.000
Diferencia: +$200.000 ✅

🏃 Racha: 8 semanas
```

### Edge Cases

| Caso | Manejo |
|------|--------|
| Monto = 0 | Aceptar. El usuario puede tener $0 en cuenta. Confirmar: "¿Tu saldo real es $0?" |
| Monto negativo | "El saldo del banco no puede ser negativo. ¿Cuánto tienes?" |
| Monto > $1.000.000.000 | "¿Seguro? $1.000.000.000 parece muy alto. Confirma el monto." |
| Segundo update en el mismo día | Aceptar (sobrescribe). "Ya habías registrado $X hoy. ¿Actualizo a $Y?" |
| Colaborador intenta | "Solo el dueño puede actualizar el saldo del banco." |
| Confusión con cobro | Gemini maneja (ver notas en prompt). Si aún confunde: "¿Es tu saldo actual en el banco, o recibiste un pago?" |

### Tabla destino

```sql
-- Tabla: saldos_banco
CREATE TABLE saldos_banco (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  saldo_real BIGINT NOT NULL,
  saldo_teorico BIGINT,
  diferencia BIGINT,
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registrado_via TEXT NOT NULL CHECK (registrado_via IN ('app', 'whatsapp')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla: streaks
CREATE TABLE streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  tipo TEXT NOT NULL DEFAULT 'conciliacion',
  semanas_actuales INT NOT NULL DEFAULT 0,
  semanas_record INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, tipo)
);
```

---

## §9B. Flujos de Novedades MVP (W09, W11)

### W09 — Nota sobre Oportunidad

**Flujo simplificado (D95 — texto libre):**

1. Gemini extrae: entity_hint + note text
2. Lookup: buscar oportunidad activa que matchee
3. Present: "Voy a agregar esta nota a *Torres — Remodelación oficinas* (Propuesta enviada): '[texto]'. ¿Confirmo?"
4. Save: INSERT en `notas` con `oportunidad_id`

**Respuesta:**

```
✅ Nota agregada a *Torres — Remodelación oficinas*.

📋 Estado: Propuesta enviada (hace 8 días)
💰 Valor: $20.000.000

Última nota: "se puso difícil, el gerente viajó"
```

### W11 — Nota sobre Proyecto

Mismo flujo que W09 pero busca en `proyectos` activos en vez de `oportunidades`.

---

## §10. Flujos de Consulta MVP (W14-W17, W19)

### W14 — Estado de Proyecto

**Respuesta tipo:**

```
📂 *Casa María Rodríguez*

├ Estado: Activo (45% avance)
├ ⏱️ Horas: 42 / 60h (70.0%)
├ 💰 Presupuesto: $4.680.000 / $8.000.000 (58.5%)
├ 📄 Facturado: $5.000.000 — Cobrado: $3.000.000
├ 💵 Cartera: $2.000.000
└ 📈 Margen proyectado: 31.5%

⚠️ Horas avanzadas (70%) vs avance reportado (45%). Revisa si necesitas ajustar el estimado.
```

### W15 — Estado Pipeline

```
📊 Tu pipeline:

├ Lead nuevo: 2 ($8.5M)
├ Contacto inicial: 1 ($3M)
├ Discovery: 0
├ Propuesta enviada: 2 ($25M)
├ Negociación: 1 ($12M)

💰 Valor total: $48.5M
💰 Ponderado: $18.9M

⚠️ Sin oportunidades en Discovery. ¿Estás haciendo follow-up?
```

### W16 — Mis Números (ACTUALIZADO v2.0)

Incluye estado de conciliación bancaria y streak (D109, D115, D117).

```
📊 Tus números — Febrero 2026:

├ 🏦 Banco: $12.000.000 (actualizado hace 2 días) ✅
├ 💵 Ingresos cobrados: $9.500.000
├ 💸 Gastos: $4.350.000
├ 📈 Utilidad bruta: $5.150.000
├ 🏛️ Provisión impuestos: ~$1.030.000
├ 💰 Disponible para ti: ~$4.120.000
└ 🏦 Runway: 4.2 meses

🏃 Racha conciliación: 8 semanas 🥈

Comparado con enero: Ingresos +12%, Gastos -5% ✅
```

**Variantes de la línea de banco según estado:**

| Estado | Línea |
|--------|-------|
| Cuadra (tolerancia ✅) | 🏦 Banco: $12.000.000 (hace 2 días) ✅ |
| Diferencia menor | 🏦 Banco: $12.000.000 (hace 2 días) ⚠️ Diferencia: $350K |
| Diferencia importante | 🏦 Banco: $12.000.000 (hace 2 días) ⚠️ Diferencia: $2.5M — Revisa en app |
| Sin actualizar > 7 días | 🏦 Banco: sin actualizar hace 9 días ⚠️ Escríbeme tu saldo |
| Sin saldo registrado | 🏦 Banco: sin configurar. Escríbeme "Mi saldo es [monto]" |

### W17 — Cartera Pendiente

```
💵 Cartera pendiente:

1️⃣ *Edificio Torres* — $2.500.000 (Fact #0025, 3 días)
2️⃣ *Casa María* — $2.000.000 (Fact #0018, 22 días)
3️⃣ *Remodelación Pérez* — $1.800.000 (Fact #0019, 35 días) ⚠️

💰 Total cartera: $6.300.000
⚠️ 1 factura con más de 30 días.
```

### W19 — Info de Contacto

```
👤 *Juan Pérez Torres*

📱 315 222 3344
📧 jperez@torres.com
🏢 Torres & Asociados
💼 Gerente de proyectos

📂 Proyectos: Remodelación Pérez (activo)
📋 Pipeline: Ampliación oficinas ($8M, en negociación)
```

---

## §11. Flujos de Acción MVP (W22, W23, W24)

### W22 — Oportunidad Ganada (D94 — Hard Gate)

Ver decisión D94 arriba. Flujo con redirect a app si faltan datos fiscales.

**Respuesta exitosa (datos fiscales completos):**

```
🎉 ¡Oportunidad ganada!

📋 *Torres — Remodelación oficinas*
💰 Valor: $20.000.000
📂 Proyecto creado automáticamente

Siguiente paso: Registra la primera factura en la app o escríbeme "Facturé [monto] a Torres".
```

### W23 — Oportunidad Perdida

1. Gemini extrae: entity_hint
2. Lookup: buscar oportunidad activa
3. Present: "Voy a marcar *Torres — Remodelación* como perdida. ¿Cuál fue la razón?"
4. Usuario responde con razón (texto libre)
5. Save: UPDATE estado + INSERT razón

**Respuesta:**

```
📋 Oportunidad marcada como perdida.

*Torres — Remodelación oficinas*
💰 Valor: $20.000.000
📝 Razón: "Eligieron a otro proveedor más barato"

Pipeline actualizado: 5 oportunidades activas ($28.5M)
```

### W24 — Ayuda (ACTUALIZADO v2.0)

```
👋 ¡Hola! Soy tu asistente MéTRIK ONE. Puedo ayudarte con:

💰 *Registrar:*
• "Gasté [monto] en [concepto] para [proyecto]"
• "Trabajé [X] horas en [proyecto]"
• "Me pagaron [monto] de [proyecto]"
• "Mi saldo es [monto]"

📋 *Consultar:*
• "¿Cómo va [proyecto]?"
• "¿Cómo estoy este mes?"
• "¿Quién me debe?"

🎯 *Actualizar:*
• "[Prospecto] aceptó" / "no se dio"
• "Nota para [proyecto]: [texto]"

Escríbeme con naturalidad, no necesitas comandos exactos 😊
```

---

## §12. Alertas Proactivas MVP (W25, W29, W33)

### W25 — Factura Vencida

**Trigger:** Factura con saldo > 0 y > 30 días desde emisión.
**Frecuencia:** Primera vez cuando ocurre. Recordatorio cada 7 días.

```
⚠️ Factura vencida:

📄 Factura #0019 — *Remodelación Pérez*
💰 Saldo: $1.800.000
📅 Emitida: 15 ene 2026 (hace 36 días)

¿Quieres que te recuerde el teléfono de Pérez para cobrarle?
```

### W29 — Resumen Semanal (ACTUALIZADO v2.0)

**Trigger:** Lunes 7:00 AM automático.

Incluye estado de conciliación bancaria y streak (D109, D117).

```
📊 Resumen semanal — 17-23 Feb 2026

💰 Cobros recibidos: $3.000.000
💸 Gastos registrados: $1.250.000
⏱️ Horas trabajadas: 28h

🏦 Banco: $12.000.000 — cuadra ✅ (actualizado hace 3 días)

📂 Proyectos activos: 3
├ *María Rodríguez* — 70% avance ✅
├ *Edificio Torres* — 45% avance
└ *Pérez* — 85% avance ✅

📋 Pipeline: 6 oportunidades ($48.5M)
⚠️ *Torres Remodelación* sin actividad hace 12 días

💵 Cartera: $6.300.000 (1 vencida ⚠️)
🏦 Runway: 4.2 meses

🏃 Racha conciliación: 8 semanas 🥈

¡Buena semana! 💪
```

**Variantes de la línea de banco en W29:**

| Estado | Línea |
|--------|-------|
| Cuadra | 🏦 Banco: $12.000.000 — cuadra ✅ (hace 3 días) |
| Diferencia menor | 🏦 Banco: $12.000.000 — diferencia de $350K ⚠️ |
| Diferencia importante | 🏦 Banco: $12.000.000 — diferencia de $2.5M ⚠️ Revisa en app |
| Sin actualizar > 7 días | 🏦 Banco: ⚠️ 9 días sin actualizar. Escríbeme tu saldo |

### W33 — Push Recordatorio Saldo Bancario (NUEVO v2.0)

**Decisión fuente:** D114 (3 canales para actualizar saldo).

**Trigger:** Martes y viernes, SOLO si el saldo no se ha actualizado en más de 7 días.
**Tipo:** Proactivo (sistema → usuario, template pre-aprobado por Meta).

**Template:**

```
Hola {{nombre}}, tu saldo del banco tiene {{días}} días sin actualizar. ¿Cuál es tu saldo hoy?

Responde con el monto y lo registro.
```

**Reglas:**
- Saldo no actualizado > 7 días baja score de completitud del semáforo Capa 1 (D113)
- Si el usuario responde con un monto, se procesa como W32 (SALDO_BANCARIO)
- Si no responde, no se insiste hasta el siguiente martes/viernes
- Máximo 2 push por semana (martes + viernes)
- Se detiene cuando el usuario actualiza su saldo

### Contexto: Streak de Conciliación (D117)

El bot necesita conocer la mecánica para respuestas contextuales.

| Regla | Valor |
|-------|-------|
| Unidad | Semanal (se evalúa cada domingo 23:59 con cron) |
| Se mantiene si | Hubo al menos 1 actualización de saldo en la semana |
| Se rompe si | 7+ días sin actualizar → streak = 0 |
| Milestones | 4 semanas 🥉, 12 semanas 🥈, 26 semanas 🥇, 52 semanas 🏆 |
| Irrecuperable | Si se rompe, arranca de 0 |

**Tabla:** `streaks` (tenant_id, tipo='conciliacion', semanas_actuales, semanas_record)

**Uso en bot:**
- W32: Cuando el usuario actualiza saldo y está en semana de milestone → "✅ Saldo actualizado. ¡Llevas 12 semanas seguidas! 🥈"
- W16: Mostrar streak actual con medalla
- W29: Incluir streak en resumen semanal

### Contexto: FAB → WhatsApp (D118)

D118 define 4 acciones en el FAB: nueva oportunidad, registrar gasto, registrar cobro, actualizar saldo.

"Actualizar saldo" en el FAB es la versión app de lo que W32 hace por WhatsApp y W33 incentiva por push. Los 3 canales escriben a la misma tabla `saldos_banco` con diferente valor en `registrado_via`:

| Canal | registrado_via |
|-------|---------------|
| App (FAB) | 'app' |
| WhatsApp (W32) | 'whatsapp' |
| Push (W33 → respuesta) | 'whatsapp' |

---

## §13. Implementación — Plan de Sprints WhatsApp

### Pre-requisito (Mauricio, ~35 min)

- [ ] Crear Meta Business App
- [ ] Configurar webhook URL → Edge Function `wa-webhook`
- [ ] Obtener token permanente Meta API
- [ ] Agregar números de test al sandbox
- [ ] Autenticar Supabase CLI en Claude Code

### Sprint WA-1: Infraestructura + W24 + W06

| Entregable | Descripción |
|-----------|-------------|
| `wa-webhook` | Receptor, verificación firma, routing |
| `wa-parse` | Integración Gemini con prompt maestro (16 intenciones) |
| `wa-respond` | Formatter + envío vía Meta API |
| W24 (Ayuda) | Flujo más simple para validar pipeline completo |
| W06 (Contacto) | Primer registro real para validar CRUD |

### Sprint WA-2: Registros Core (W01, W02, W03, W32)

| Entregable | Descripción |
|-----------|-------------|
| W01 | Gasto directo con match proyecto + reconciliación |
| W02 | 🆕v2.1 Gasto empresa con desambiguación (D104) + respuesta enriquecida (D103) |
| W03 | Registro de horas con feedback acumulado |
| W32 | Actualizar saldo bancario (nuevo v2.0) |
| pg_trgm | Configurar extensión para match difuso |
| Tablas | `saldos_banco` + `streaks` (DDL en §9A) |

**Checklist v2.1 para W02:**

```
□ 🆕v2.1 Fase 0 — PRE-CHECK desambiguación (D104)
  □ Lógica: category_hint IN [1-5] OR confidence < 0.75
  □ Mensaje desambiguación con 2 opciones (1️⃣ proyecto / 2️⃣ empresa)
  □ Routing: opción 1 → W01, opción 2 → continuar W02
  □ Edge case: sin proyectos activos → saltar desambiguación

□ 🆕v2.1 Fase 2 — Query acumulado gastos empresa del mes (D103)
  □ SELECT SUM(monto) WHERE proyecto_id IS NULL AND mes actual

□ 🆕v2.1 Fase 4 — INSERT con tipo = 'empresa' (no 'operativo')

□ 🆕v2.1 Respuesta post-registro enriquecida (D103)
  □ Categoría confirmada
  □ Acumulado mes con detalle últimos 3 gastos
  □ Prompt soporte 3 opciones: foto / después / no
  □ Manejo de imagen entrante (5 min timeout)
  □ Truncar detalle si > 400 chars
```

**Verificaciones post-ejecución W02 v2.1:**

```
□ Enviar "Compré materiales, $50K" → debe activar desambiguación (cat 1-5)
□ Responder 1️⃣ → debe rutear a W01 y mostrar lista de proyectos
□ Responder 2️⃣ → debe continuar W02 y registrar como empresa
□ Enviar "Pagué el arriendo, $2M" → NO debe desambiguar (cat 6, alta confianza)
□ Enviar "Compré algo, $30K" (confidence baja) → debe desambiguar
□ Post-registro: verificar que acumulado empresa del mes aparece en respuesta
□ Post-registro: verificar prompt de soporte con 3 opciones
□ Responder con foto → verificar UPDATE en gastos.soporte_url
□ Verificar que INSERT tiene tipo = 'empresa'
□ Sin proyectos activos: "Pagué combustible, 80 mil" → NO debe desambiguar
```

### Sprint WA-3: Cobros + Acciones (W04, W22, W23)

| Entregable | Descripción |
|-----------|-------------|
| W04 | Cobro con match factura + distribución |
| W22 | Opp ganada con hard gate fiscal (D94) |
| W23 | Opp perdida con razón |

### Sprint WA-4: Consultas + Novedades (W09, W11, W14-W17, W19)

| Entregable | Descripción |
|-----------|-------------|
| W09, W11 | Notas texto libre |
| W14-W17, W19 | Todas las consultas read-only (W16 incluye conciliación v2.0) |
| Colaboradores | Identificación por teléfono + permisos (D99) |

### Sprint WA-5: Alertas + Polish (W25, W29, W33)

| Entregable | Descripción |
|-----------|-------------|
| W25 | Alerta factura vencida (cron) |
| W29 | Resumen semanal con conciliación + streak (cron lunes 7am) |
| W33 | Push recordatorio saldo (cron martes/viernes, solo si > 7 días) |
| Streak cron | Evaluación dominical de streak (D117) |
| Rate limiting | D97 implementado |
| Logs | Structured logging para debugging |
| Health check | Ping automático webhook cada hora |

---

## §14. Registro de Decisiones

### Decisiones originales (D91-D100) — Sesión WhatsApp

| # | Decisión | Quién decidió |
|---|---------|---------------|
| D91 | Max autónomo para flujos WA post-setup. Mauricio provee tokens + QA por sprint | Consenso: Max + Vera + Hana |
| D92 | Prompt Gemini: maestro único con clasificador de intención | Mauricio (aprobado) |
| D93 | MVP WhatsApp: 15 intenciones originales (W01-W04, W06, W09, W11, W14-W17, W19, W22-W25, W29) | Mauricio (aprobado) |
| D94 | W22 (opp ganada): hard gate fiscal NO por WA, redirect a app | Mik + Hana |
| D95 | W09/W11 (novedades): texto libre, Gemini solo extrae entity_hint | Mik |
| D96 | Fallback UNCLEAR: menú de 6 opciones + escalada a app después de 3 intentos | Mik |
| D97 | Rate limit: 30 msg/hr entrada, 2 alertas/día salida, 1 llamada Gemini/msg | Mik + Max |
| D98 | Idioma MVP: solo español. Respuestas siempre en español | Mauricio (aprobado) |
| D99 | Colaboradores: subset de intenciones (W01, W03, W11, W14, W24), solo proyectos asignados | Mik |
| D100 | Formato mensajes: máx 3 emojis, 500 chars, montos formateados, nombres en bold | Hana |

### Decisiones Sesión 5 — Mis Números (D109-D118 relevantes a WhatsApp)

| # | Decisión | Impacto en WhatsApp | Quién decidió |
|---|---------|---------------------|---------------|
| D109 | Conciliación bancaria simplificada: saldo real vs teórico | Origen de W32 | Carmen + equipo → Mauricio ✅ |
| D110 | Una sola cuenta bancaria en MVP | W32 no pregunta cuál cuenta | Max + Carmen → Mauricio ✅ |
| D111 | Tolerancia: ±$50K/2% cuadra, $50K-500K/2-10% menor, >$500K/>10% importante | Respuesta W32 varía según diferencia | Carmen → Mauricio ✅ |
| D113 | Saldo > 7 días sin actualizar baja score completitud Capa 1 | W33 se dispara a los 7 días | Hana + Sofía → Mauricio ✅ |
| D114 | 3 canales para actualizar saldo: app (FAB), WhatsApp (W32), push (W33) | Define W32 + W33 | Hana → Mauricio ✅ |
| D115 | P1 y P5 siempre usan saldo real del banco, no el teórico | W16 muestra saldo real | Carmen → Mauricio ✅ |
| D117 | Streak tipo Duolingo: semanal, irrecuperable, milestones 4/12/26/52 | W16 y W32 incluyen streak | Santiago → Mauricio ✅ |
| D118 | FAB con 4 acciones: oportunidad, gasto, cobro, saldo | Saldo es uno de los 4 | Max → Mauricio ✅ |

### 🆕v2.1 Decisiones — Gastos Empresariales (D103-D104)

| # | Decisión | Descripción | Sprint |
|---|----------|-------------|--------|
| **🆕v2.1 D103** | **Confirmación W02 enriquecida** | **Post-registro GASTO_OPERATIVO incluye: categoría confirmada + acumulado gastos empresa del mes + detalle últimos 3 gastos + prompt de soporte con instrucción de deducibilidad.** | **WA-2** |
| **🆕v2.1 D104** | **Desambiguación proyecto vs empresa** | **Cuando Gemini clasifica GASTO_OPERATIVO pero category_hint es 1-5 (ambigua) o confidence < 0.75 → bot pregunta "¿proyecto o empresa?" ANTES de registrar. Si proyecto → rutear a W01. Si empresa → continuar W02. Sin proyectos activos → saltar desambiguación.** | **WA-2** |

---

## §15. Erratas y Correcciones v2.0

El documento delta de Sesión 5 (`98F_ONE_Spec_WhatsApp_Flows_v1 (1).md`) contenía errores de numeración que fueron corregidos en esta versión unificada:

| Error en delta | Corrección aplicada | Razón |
|---------------|---------------------|-------|
| "W29 — Push saldo bancario" (nueva) | Renombrado a **W33** | W29 ya existía como Resumen Semanal desde v1.0 |
| "W16 — Resumen semanal" (modificada) | Corregido a **W29** | W16 es Mis Números (consulta), W29 es el Resumen Semanal |
| "W06 — Consultar números" (modificada) | Corregido a **W16** | W06 es Contacto Nuevo, W16 es Mis Números |

Estos errores se originaron porque el delta fue generado como documento independiente sin acceso al catálogo completo de intenciones. La unificación los resuelve.
