---
doc_id: 98B
version: 2.0
updated: 2026-02-19
depends_on: [21], [99]
depended_by: [98A], [98C]
decisiones_producto: D1-D68 (spec METRIK_ONE_Spec_UI_CRM_Completa.md)
vigente: false
nota_vigencia: "Modulo /pipeline es LEGACY. Reemplazado por modulo /negocios (decision 2026-04-09). Ver metrik-one/CLAUDE.md para estado actual."
---

# Spec: Mi Pipeline — CRM Comercial Liviano

Código: MOD-PIP. Corazón comercial de MéTRIK ONE. Gestiona el ciclo completo desde el primer contacto hasta el cierre de venta: contactos, empresas, oportunidades, cotizaciones y la transición a proyectos. No es un CRM enterprise — es un CRM liviano diseñado para independientes que hoy manejan todo en WhatsApp y Excel.

Pregunta central: **"¿Qué tengo en el horno y cuánto me va a quedar?"**

## 1. Flujo de datos

Entradas: App (creación de oportunidades, cotizaciones, cambios de etapa), WhatsApp Bot (registro contactos, notas, actualizaciones de oportunidad vía texto/audio), Config (perfil fiscal, catálogo servicios, personal).

Salidas: -> Proyectos [98C] (cotización aceptada genera proyecto con herencia completa), -> Números [98A] (forecast: valor ponderado por probabilidad, pipeline activo).

Frecuencia: Near real-time vía Supabase Realtime.

## 2. Modelo de datos

### 2.1 Contacto

Una persona con la que hago negocios. Entidad suelta — NO pertenece a ninguna empresa directamente. La relación contacto-empresa se establece a través de la oportunidad (D19).

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| id | UUID | Auto | PK |
| tenant_id | UUID | Auto | RLS |
| nombre | Text | Sí | — |
| telefono | Text | Sí | — |
| email | Text | No | — |
| fuente_adquisicion | Enum | Sí | 1 de 8 opciones (ver §2.7) |
| fuente_detalle | Text | No | Sub-selección según fuente |
| fuente_promotor_id | UUID | Condicional | FK -> contactos. Solo si fuente = 'promotor' |
| fuente_referido_nombre | Text | No | Texto libre si fuente = 'referido' |
| rol | Enum | No | promotor / decisor / influenciador / operativo |
| comision_porcentaje | Decimal | Condicional | Default 10%. Solo si rol = promotor |

Crear contacto requiere 3 datos: nombre + teléfono + fuente (D15). Se puede crear desde la app o desde WhatsApp (texto/audio).

Indicador completitud: si falta email.

### 2.2 Empresa

Entidad a la que le facturo. Suelta, independiente.

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| id | UUID | Auto | PK |
| tenant_id | UUID | Auto | RLS |
| nombre | Text | Sí | — |
| sector | Text | Sí | — |
| nit | Text | No* | *Obligatorio para hard gate fiscal |
| tipo_persona | Enum | No* | Natural / Jurídica |
| regimen_tributario | Enum | No* | Común / Simple / No Responsable |
| gran_contribuyente | Boolean | No* | Afecta retenciones |
| agente_retenedor | Boolean | No* | Afecta retenciones |
| contacto_nombre | Text | No | Persona de contacto |
| contacto_email | Text | No | Email empresa |

Crear empresa requiere 2 datos: nombre + sector (D4). Se crea inline al crear oportunidad, no antes.

Perfil fiscal completo = los 5 campos marcados con * tienen valor.

Indicador completitud: dual — fiscal incompleto / Si fiscal completo (D37). Única entidad con doble indicador.

### 2.3 Oportunidad

Un negocio que estoy persiguiendo. Puente que conecta contacto con empresa.

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| id | UUID | Auto | PK |
| tenant_id | UUID | Auto | RLS |
| contacto_id | UUID | Sí | FK -> contactos |
| empresa_id | UUID | Sí | FK -> empresas |
| descripcion | Text | Sí | Texto libre |
| etapa | Enum | Auto | Default: lead_nuevo |
| probabilidad | Integer | Auto | Derivado de etapa |
| valor_estimado | Decimal | No | Se llena desde cotización |
| ultima_accion | Text | No | Auto-actualizado |
| ultima_accion_fecha | Timestamp | No | Auto-actualizado |
| fecha_cierre_estimada | Date | No | — |
| razon_perdida | Text | Condicional | Obligatorio si etapa = perdida |

Se crea SOLO desde la app (D16), nunca desde WhatsApp. Formulario inline de 3 pasos (ver §5.1).

Se ACTUALIZA desde WhatsApp (texto/audio) con loop de confirmación obligatorio (D9).

Indicador completitud: si falta información.

### 2.4 Cotización

Lo que le propongo cobrar. Siempre dentro de una oportunidad, nunca suelta (D14).

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| id | UUID | Auto | PK |
| tenant_id | UUID | Auto | RLS |
| oportunidad_id | UUID | Sí | FK -> oportunidades |
| consecutivo | Text | Auto | COT-YYYY-NNNN (D51). Reset anual (D57). |
| modo | Enum | Sí | flash / detallada |
| descripcion | Text | No | Solo en flash |
| valor_total | Decimal | Sí | Ingresado (flash) o calculado (detallada) |
| margen_porcentaje | Decimal | No | Solo detallada |
| costo_total | Decimal | No | Calculado de ítems |
| estado | Enum | Auto | borrador / enviada / aceptada / rechazada / vencida |
| fecha_envio | Timestamp | No | Al enviar |
| fecha_validez | Date | No | Default: fecha_envio + 30 días (D60) |
| duplicada_de | UUID | No | FK -> cotizaciones. Trazabilidad duplicación. |
| notas | Text | No | Internas, no van al PDF |
| condiciones_pago | Text | No | Para el PDF |
| email_enviado_a | Text | No | Registro de envío |

**Reglas de negocio:**

| Regla | Detalle | Decisión |
|-------|---------|----------|
| Unicidad Enviada | Máximo 1 cotización con estado "enviada" por oportunidad a la vez | D48 |
| Inmutabilidad | Enviada = todos los campos read-only. No se edita. | D49 |
| Duplicación | Crea borrador nuevo con consecutivo nuevo + datos copiados. Campo `duplicada_de` registra origen. | D49, D55 |
| Borradores ilimitados | N borradores simultáneos permitidos | D48 |
| Vencimiento auto | fecha_validez < hoy AND estado = enviada -> estado = vencida | D60 |
| Enviar segunda | Bloqueado si ya hay una enviada. Marcar anterior como rechazada/vencida primero. | D48 |

**Transiciones de estado:**

```
Borrador -> Enviada (vía email con PDF adjunto)
Enviada -> Aceptada (trigger: crear proyecto)
Enviada -> Rechazada
Enviada -> Vencida (automático)
Borrador -> Eliminable
```

### 2.5 Ítem

Línea dentro de cotización detallada.

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| id | UUID | Auto | PK |
| cotizacion_id | UUID | Sí | FK -> cotizaciones |
| nombre | Text | Sí | Nombre del entregable |
| subtotal | Decimal | Calculado | Suma de rubros |
| orden | Integer | Auto | Secuencia visual |
| servicio_origen_id | UUID | No | FK -> servicios. Si vino del catálogo. |

### 2.6 Rubro

Componente de costo dentro de un ítem. Formulario IDÉNTICO para los 6 tipos — un componente, no seis.

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| id | UUID | Auto | PK |
| item_id | UUID | Sí | FK -> items |
| tipo | Enum | Sí | 1 de 6 tipos |
| descripcion | Text | Sí | — |
| cantidad | Decimal | Sí | — |
| unidad | Text | Sí | horas / unidades / días / km / licencias / mes |
| valor_unitario | Decimal | Sí | — |
| valor_total | Decimal | Calculado | cantidad × valor_unitario |

**6 tipos de rubro:**

| # | Tipo | Enum | Unidades típicas |
|---|------|------|-----------------|
| 1 | Mano de obra propia | mo_propia | horas |
| 2 | Mano de obra terceros | mo_terceros | horas |
| 3 | Materiales | materiales | unidades |
| 4 | Viáticos | viaticos | días / km |
| 5 | Software y tecnología | software | licencias / mes |
| 6 | Servicios profesionales | servicios_prof | horas / proyecto |

### 2.7 Fuentes de adquisición

Enum obligatorio al crear contacto (D20). 8 opciones:

| # | Enum | Label | Sub-selección |
|---|------|-------|---------------|
| 1 | promotor | Promotor | Seleccionar contacto promotor (obligatorio) |
| 2 | referido | Referido | ¿Quién? (texto libre, opcional) |
| 3 | alianza | Alianza / Partner | Nombre alianza (opcional) |
| 4 | red_social_organico | Red social (orgánico) | LinkedIn / Instagram / Facebook / TikTok / Otra |
| 5 | pauta_digital | Pauta digital (pagado) | Google Ads / Meta Ads / LinkedIn Ads / Otra |
| 6 | contacto_directo | Contacto directo | — |
| 7 | evento | Evento / Networking | ¿Cuál? (opcional) |
| 8 | web_organico | Web / Orgánico | — |

Sub-selecciones son opcionales — no agregan fricción al crear.

**Regla D17 — Referido ≠ Promotor:**

| Concepto | Promotor | Referido |
|----------|----------|---------|
| Qué es | Rol del contacto | Fuente de adquisición |
| Comisión | Sí (default 10%) | No |
| Sobre qué | Primer proyecto del cliente referido | N/A |
| Recompra | No aplica comisión | N/A |

### 2.8 Servicio (catálogo de plantillas)

Plantilla reutilizable de ítem. Vive en Config -> Mis servicios.

| Campo | Tipo | Obligatorio | Notas |
|-------|------|-------------|-------|
| id | UUID | Auto | PK |
| tenant_id | UUID | Auto | RLS |
| nombre | Text | Sí | — |
| precio_estandar | Decimal | No | Precio de lista sugerido |
| rubros_template | JSONB | No | Array de rubros precargados |
| activo | Boolean | Auto | Default: true |

Flujo: usuario selecciona servicio del catálogo -> se copia como ítem nuevo en cotización con rubros precargados (deep copy del JSON) -> edita lo que necesite -> original intacto (D42).

### 2.9 Relaciones entre entidades

```
Contacto (suelto) ──[origina]──-> Oportunidad <-──[factura a]── Empresa (suelta)
 │
 ├── Cotización (1 enviada máx, N borradores)
 │ └── Ítem
 │ └── Rubro (6 tipos)
 │
 └──[al ganar + hard gate fiscal]──-> Proyecto [98C]
```

| Relación | Tipo | Nota |
|----------|------|------|
| Contacto -> Empresa | Ninguna directa | Se conectan VÍA oportunidad (D19) |
| Contacto -> Oportunidad | 1:N | Un contacto origina muchas oportunidades |
| Empresa -> Oportunidad | 1:N | Una empresa tiene muchas oportunidades |
| Oportunidad -> Cotización | 1:N | Pero max 1 enviada a la vez (D48) |
| Cotización -> Ítem | 1:N | Solo en modo detallada |
| Ítem -> Rubro | 1:N | 6 tipos |
| Oportunidad -> Proyecto | 1:1 | Al ganar con cotización aceptada (D45) |
| Servicio -> Ítem | 1:N (copia) | Plantilla se copia, no se referencia |

## 3. Etapas del embudo

| # | Etapa | Enum | Probabilidad | Siguiente acción |
|---|-------|------|-------------|-------------------|
| 1 | Lead nuevo | lead_nuevo | 10% | Calificar (ICP fit) |
| 2 | Contacto inicial | contacto_inicial | 20% | Agendar discovery |
| 3 | Discovery hecha | discovery_hecha | 40% | Enviar propuesta |
| 4 | Propuesta enviada | propuesta_enviada | 60% | Follow-up |
| 5 | Negociación | negociacion | 80% | Cerrar |
| 6 | Ganada | ganada | 100% | -> Proyecto [98C] |
| 7 | Perdida | perdida | 0% | Registrar razón (obligatorio) |

Chips de color con gradiente: gris claro (Lead) -> escala a verde (Ganada). Rojo para Perdida (D39).

Probabilidad se actualiza automáticamente vía trigger al cambiar etapa.

## 4. Funciones del módulo

| Función | ONE (1-4 pers) | Clarity Comercial (PYME) | Alerta |
|---------|----------------|--------------------------|--------|
| Oportunidades por etapa | Lista personal con filtro por etapa | Por vendedor + consolidado | Embudo vacío (< 3 activas) |
| Valor total pipeline | Suma ponderada por probabilidad | Segmentado por vendedor | — |
| Estado oportunidad | Última acción + fecha relativa | + responsable + notas | Sin actividad > 7 días |
| Tasa de conversión | Global | Por vendedor, fuente, servicio | Conversión < 15% |
| Tiempo promedio en etapa | Simple | Por etapa con benchmark | Estancada > 14 días |
| Cotización dentro de oportunidad | Flash + detallada + PDF + email | + aprobación interna | — |
| Vista 360 contacto | Historial oportunidades | + comisiones si promotor | — |
| Vista 360 empresa | Perfil fiscal + historial | + facturación acumulada | — |

## 5. Flujos de pantalla

### 5.1 Crear oportunidad — stepper 3 pasos (D24)

Máximo 6 campos si todo es nuevo. 1 campo si contacto y empresa ya existen.

**Paso 1: ¿Quién? (Contacto)**
- Buscar contacto existente (autocomplete Supabase real-time)
- O crear nuevo: nombre + teléfono + fuente (3 campos)

**Paso 2: ¿Para quién? (Empresa)**
- Buscar empresa existente (autocomplete)
- O crear nueva: nombre + sector (2 campos)
- Sugerencia inteligente (D25): si contacto tiene historial con empresa, la sugiere automáticamente

**Paso 3: ¿Qué? (Descripción)**
- Descripción del trabajo (1 campo texto libre)

Submit -> crea contacto (si nuevo) + empresa (si nueva) + oportunidad en "Lead nuevo" (10%). Redirect a detalle de oportunidad.

Solo disponible desde la app (D16). FAB -> Nueva oportunidad.

### 5.2 Crear cotización

Desde detalle de oportunidad -> sección Cotizaciones -> [+ Nueva cotización].

**Selección de modo:**

| Modo | Para qué | Campos |
|------|----------|--------|
| Flash (D63) | Cotizar rápido | 2 campos: valor total + descripción. Sistema calcula retenciones. |
| Detallada (D40) | Desglose completo | Ítems -> rubros -> margen -> resultado fiscal |

**Modo detallado — flujo:**

1. Agregar ítems: desde catálogo (D42) o libre
2. Dentro de cada ítem: agregar rubros (6 tipos, formulario idéntico)
3. Definir margen deseado (%)
4. Sistema calcula: costo total + margen = precio venta
5. Resultado fiscal: retenciones estimadas -> "TE QUEDA" (D43)
6. Si perfil fiscal empresa incompleto -> sección fiscal bloqueada con CTA visible (D18)

Ítems en accordion: contraído en móvil (1 abierto a la vez), semi-expandido en desktop (D41).

### 5.3 Enviar cotización (D50)

Al tocar [Enviar cotización ->]:

1. Modal de envío: destinatario (precargado), asunto (auto), mensaje (template editable), PDF adjunto (auto-generado)
2. Envío vía Resend (API transaccional)
3. Post-envío: estado cambia a "enviada", cotización queda inmutable, evento en timeline de oportunidad

### 5.4 PDF de cotización (D52-D54, D58)

- Layout fijo MVP (D54) con branding de empresa del usuario (logo + datos legales desde Config -> Mi empresa)
- Sin logo si no configurado -> PDF funcional + aviso sutil (D53)
- Consecutivo visible: COT-YYYY-NNNN
- Desglose de ítems y rubros (si detallada) o valor total (si flash)
- **SIN desglose de retenciones** (D58) — línea informativa al pie: "Sujeto a retenciones de ley según condición del contratante"
- Retenciones son herramienta INTERNA del usuario en la app (D59)

### 5.5 Duplicar cotización (D49, D55)

Cotización enviada = inmutable. Botón "Duplicar y editar" prominente (no menú oculto). Crea borrador nuevo con consecutivo nuevo + datos copiados. Campo `duplicada_de` registra origen para trazabilidad.

### 5.6 Vista cotizaciones dentro de oportunidad (D56)

```
COT-2026-0043 [Borrador] $8.190.000 [Editar] [Enviar ->]
COT-2026-0042 [Enviada ] $7.500.000 [Duplicar y editar] [Ver PDF]
COT-2026-0041 [Rechazada ] $9.200.000 [Ver PDF]
```

Orden: más reciente arriba. Candado () en inmutables.

## 6. Hard gate fiscal (D5, D44, D45)

### Trigger

Usuario intenta mover oportunidad a "Ganada" AND empresa tiene perfil fiscal incompleto (falta >=1 de: NIT, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor).

### Comportamiento

Flujo inline positivo — NO modal de error (D44):

- Título: " Un paso más para cerrar este negocio"
- Muestra campos fiscales con Si (completo) y No (faltante, editable in-situ)
- Al completar: transacción atómica Supabase (D45):
 1. UPDATE empresa (perfil fiscal)
 2. UPDATE oportunidad (etapa = ganada)
 3. Confirmación: "¿Crear proyecto a partir de esta cotización?"
 4. Si confirma -> INSERT proyecto (hereda datos D68)

Si "Volver al pipeline" -> no pasa nada, oportunidad queda en etapa actual.

### Hard gate — campos obligatorios

| Campo | Tipo | Opciones |
|-------|------|----------|
| NIT | Text | Con dígito verificación |
| Tipo persona | Select | Natural / Jurídica |
| Régimen tributario | Select | Común / Simple / No Responsable |
| Gran contribuyente | Boolean | Sí / No |
| Agente retenedor | Boolean | Sí / No |

## 7. Cálculos fiscales internos

Fuente: Felipe [55A]. Estos cálculos se muestran SOLO en la app como herramienta interna del usuario (D59). NO van al PDF ni al cliente.

### Retención en la fuente

| Actividad | Base mínima | Tarifa | Aplica cuando |
|-----------|------------|--------|---------------|
| Servicios generales | 4 UVT ($209.496) | 4% / 6% | Cliente es agente retenedor |
| Consultoría (declarante) | 4 UVT | 11% | Honorarios |
| Consultoría (no declarante) | 4 UVT | 10% | Honorarios |
| Compras | 27 UVT ($1.414.098) | 2.5% | Bienes |

### Retención ICA

Bogotá default: 9.66‰ a 11.04‰ según actividad. Tarifa parametrizable por municipio en perfil fiscal tenant.

### UVT 2026

$52.374 — parametrizable en configuración del tenant.

### Output en pantalla

```
Precio venta: $X.XXX.XXX
Retención fuente: -$XXX.XXX
Retención ICA: -$XXX.XXX
────────────────────────────────
TE QUEDA: $X.XXX.XXX <- prominente, verde
```

Disclaimer obligatorio: "Valores estimados. Consulte su contador para declaraciones oficiales."

## 8. Creación progresiva de datos

| Momento | Datos obligatorios |
|---------|-------------------|
| Crear contacto | nombre + teléfono + fuente |
| Crear oportunidad (inline) | contacto + nombre empresa + sector + descripción |
| Crear cotización | dentro de oportunidad existente |
| Ver resultados fiscales en cotización | perfil fiscal empresa completo |
| Pasar a "Ganada" (hard gate) | NIT + tipo persona + régimen + gran contribuyente + agente retenedor |

Indicador de completitud ( dot rojo) visible en cada card de cada entidad (D34). No bloquea nada excepto los dos hard blocks: resultados fiscales y gate a Ganada.

## 9. Interacción WhatsApp

| Acción | WhatsApp | App |
|--------|----------|-----|
| Registrar contacto | Si texto/audio | Si |
| Registrar notas/interacciones | Si texto/audio | Si |
| Actualizar oportunidad (etapa, notas) | Si texto/audio | Si |
| Consultar pipeline | Si texto | Si |
| Crear oportunidad | No | Si |
| Crear empresa | No | Si |
| Crear cotización | No | Si |
| Gate fiscal | No | Si |
| Vistas 360 | No | Si |

Pipeline de audio:

```
Audio WhatsApp (.ogg) -> Gemini 2.0 Flash (multimodal nativo)
-> Extracción: contacto, empresa, acción, etapa, fecha, nota
-> Mensaje confirmación al usuario (loop obligatorio D9)
-> Usuario confirma/corrige -> Escritura Supabase
```

Costo: ~$0.0001 USD/audio. Latencia: <5 seg. Límite: 60 seg/audio.

## 10. Navegación y ubicación en la app

Pipeline es la **segunda tab** (D46): Números -> **Pipeline** -> Proyectos -> Directorio -> Config.

### Contenido de la tab Pipeline

Vista principal: lista de EntityCards de oportunidades con chips de filtro horizontal por etapa (D64). Sin Kanban (D33) — lista consistente en todas las plataformas.

### Directorio (tab 4) — relacionado

Contactos y Empresas viven en su propia sección "Directorio" (D28, D29) con dos subtabs. Las vistas 360 de contacto y empresa están ahí, no dentro de Pipeline.

Desde Pipeline se puede navegar a Directorio tocando el nombre del contacto o empresa en una oportunidad.

## 11. UI de la tab Pipeline

### Lista de oportunidades

Cada oportunidad es un EntityCard (D30) con:

**Summary contraído (D36):**

| Línea 1 | Línea 2 | Línea 3 |
|---------|---------|---------|
| Contacto + Empresa | Etapa (chip color D39) | Última acción + fecha relativa |

+ indicador si incompleta.

**Comportamiento responsive (D31, D32):**
- Móvil: cards contraídas, expandibles por tap, una a la vez
- Desktop: banners semi-expandidos, múltiples abiertos simultáneamente

**Secciones expandibles:**
1. Notas e interacciones (cronológico, + agregar)
2. Cotizaciones (lista con estados, §5.6)
3. Datos empresa (resumen fiscal)

**Filtros (D64):**
Chips horizontales por etapa (7 + "Todas") + sort (fecha / valor). Búsqueda por nombre contacto o empresa.

### Detalle de oportunidad (/pipeline/[id])

```
HEADER
├── Etapa: [chip editable]
├── Contacto: [nombre] -> link a Directorio
├── Empresa: [nombre + indicador fiscal] -> link a Directorio
└── si incompleta

SECCIONES EXPANDIBLES
├── Descripción del trabajo
├── Notas e interacciones (+ agregar nota)
├── Cotizaciones (lista §5.6, + nueva cotización)
└── Recordatorios (si tiene)

ACCIONES
├── [+ Nueva cotización]
├── [Cambiar etapa ->]
└── [Marcar como perdida]
```

## 12. Herencia a Proyecto (D68)

Al aceptar cotización y crear proyecto:

| Dato | Fuente | Destino en Proyecto |
|------|--------|---------------------|
| Nombre | oportunidad.descripcion | proyecto.nombre |
| Empresa | oportunidad.empresa_id | proyecto.empresa_id |
| Contacto | oportunidad.contacto_id | proyecto.contacto_id |
| Presupuesto | cotizacion.valor_total | proyecto.presupuesto_total |
| Ítems | cotizacion -> items | Líneas presupuestarias referenciales |

Estado inicial del proyecto: "En ejecución". Detalle en [98C].

## 13. Decisiones de producto referenciadas

| Decisión | Descripción | Sección |
|----------|-------------|---------|
| D1 | Contacto (relación) vs Empresa (fiscal) — entidades separadas | §2.1, §2.2 |
| D2 | Promotor = rol del contacto, no entidad separada | §2.1 |
| D3 | Oportunidad nace desde contacto — siempre | §2.3 |
| D4 | Empresa se crea inline al crear oportunidad | §5.1 |
| D5 | Hard gate fiscal antes de Ganada | §6 |
| D9 | Loop confirmación WhatsApp obligatorio | §9 |
| D14 | Cotización siempre dentro de oportunidad | §2.4 |
| D15 | Cadena obligatoria: Contacto -> Oportunidad -> Cotización | §8 |
| D16 | Oportunidad solo desde la app | §5.1 |
| D17 | Referido ≠ Promotor | §2.7 |
| D18 | Bloqueo fiscal en cotización sin perfil completo | §5.2 |
| D19 | Contacto suelto — relación con empresa vía oportunidad | §2.1, §2.9 |
| D20 | 8 fuentes de adquisición | §2.7 |
| D24 | Creación oportunidad 3 pasos | §5.1 |
| D25 | Autocompletado inteligente empresa | §5.1 |
| D33 | Sin Kanban — lista con filtro | §10, §11 |
| D39 | Chips etapa con gradiente cromático | §3 |
| D40 | Cotización flash + detallada | §5.2 |
| D41 | Accordion ítems | §5.2 |
| D42 | Catálogo servicios como plantillas | §2.8, §5.2 |
| D43 | "TE QUEDA" prominente | §7 |
| D44 | Hard gate = flujo inline positivo | §6 |
| D45 | Transacción atómica fiscal + ganada + proyecto | §6 |
| D48 | Max 1 enviada por oportunidad | §2.4 |
| D49 | Enviada = inmutable | §2.4, §5.5 |
| D50 | Envío email vía Resend | §5.3 |
| D51 | Consecutivo COT-YYYY-NNNN | §2.4 |
| D52-D54 | PDF con branding | §5.4 |
| D55 | Duplicar y editar prominente | §5.5 |
| D56 | Historial cotizaciones con candado | §5.6 |
| D57 | Consecutivo reset anual | §2.4 |
| D58-D59 | Retenciones = herramienta interna | §5.4, §7 |
| D60 | Validez 30 días default | §2.4 |
| D63 | Flash = 2 campos | §5.2 |
| D68 | Herencia cotización -> proyecto | §12 |

---

*Spec documentada por Kaori Tanaka · Validada por Max · Optimizada por Hana Nakamura · Aprobada por Vera Mendoza (COO) · 2026-02-19*
