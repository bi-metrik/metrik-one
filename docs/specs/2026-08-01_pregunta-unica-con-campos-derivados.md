# Una pregunta, varios campos derivados

**Objetivo O3** del plan de coherencia aprobado por Mauricio el 2026-07-31.
Owner: Max. Diseño: Noor. Gate de contenido: Deisy (redacción de las opciones).

## El problema, en general

Cuando dos campos booleanos independientes producen una combinación inválida, el formulario
está permitiendo de más y hay que poner un guardia para atajarla. Es la señal de que **la
pregunta está mal partida**.

Caso real (SOENA VE, etapa Negociación):

| `requiere_certificacion_upme` | `requiere_devolucion_iva` | Significa |
|---|---|---|
| sí | sí | el servicio completo |
| sí | no | solo certificación |
| no | sí | solo devolución (el cliente trae el certificado) |
| **no** | **no** | **imposible: no contrató nada** |

Para atajar la cuarta fila hubo que crear el gate `campos_alguno`. Además ambos campos son
`toggle` con `default`, así que **responden solos**: 119 casos dicen "sí requiere
certificación UPME" sin que nadie lo haya decidido. Eso viola la premisa del sistema
(*un campo que decide una ruta es siempre obligatorio y el vacío no es una respuesta*),
porque un toggle con default nunca está vacío: nace respondido.

## El diseño

Una sola pregunta, tres opciones, ninguna preseleccionada:

```
¿Qué contrató el cliente?
  ( ) Certificación UPME + devolución de IVA
  ( ) Solo certificación UPME
  ( ) Solo devolución de IVA
```

> ⚠️ **La redacción de las tres opciones la valida Deisy antes de construir.** Si el texto
> no es el que el equipo usa al vender, van a elegir en automático y no habremos ganado
> nada. Lo de arriba es propuesta, no definitivo.

La combinación imposible desaparece por construcción, y el gate `campos_alguno` de
Negociación y Documentación deja de tener razón de ser.

## Por qué NO se cambian los routings

`requiere_devolucion_iva` lo leen ~20 condiciones, dos routings y varios cross-checks.
Reapuntarlos a un campo nuevo es una migración grande sobre la parte más delicada del
motor, y por un beneficio nulo: el motor no necesita cambiar, la *pregunta* sí.

**El usuario ve una pregunta; el motor sigue viendo los dos campos de siempre.**

## Lo que hay que construir

### 1. `lock_when` acepta un mapeo (genérico, opt-in)

Hoy `lock_when` compara un valor y fuerza uno:

```ts
lock_when: { source_bloque_slug, source_etapa_orden, field, value, force_value, hint }
```

Se le agrega `mapping`, alternativo a `value`/`force_value`:

```ts
lock_when: {
  source_bloque_slug: 'servicio_contratado',
  field: 'servicio',
  mapping: {                    // valor de la fuente → valor forzado en este campo
    completo:   'true',
    solo_upme:  'true',
    solo_iva:   'false',
  },
  hint: 'Se deriva de lo que contrató el cliente',
}
```

Sin `mapping`, comportamiento idéntico al actual. Ningún workspace ajeno cambia.

Sitios: `BloqueDatos.tsx` (resolución en L284-289 y enforcement en L406-411) y el tipo de
`lock_when` en L48-54.

### 2. La derivación se persiste AL GUARDAR, no al renderizar

⚠️ **Esto es lo que decide si el diseño funciona.** Hoy el enforcement de `lock_when` corre
en un effect del cliente: el valor forzado se escribe cuando alguien **abre** el negocio.
Para un campo que decide una ruta eso llega tarde: el routing puede evaluarse antes de que
el valor exista, y estaríamos reintroduciendo el mismo defecto que este objetivo cierra
(el motor leyendo un campo vacío y cayendo al default).

`actualizarBloqueData` debe aplicar el mapeo del lado del servidor al guardar el campo
fuente, de modo que los campos derivados queden escritos en la misma operación. El effect
del cliente se conserva solo como respaldo para instancias viejas.

### 3. Configuración del workspace (migración aparte, tras el OK de Deisy)

- Bloque nuevo `servicio_contratado` en Negociación: un `radio` de tres opciones,
  `required: true`, **sin `default`**, en un bloque `es_gate`.
- `requiere_certificacion_upme` y `requiere_devolucion_iva` pasan a `visible` (solo lectura)
  con su `lock_when` + `mapping`. Dejan de ser preguntas; pasan a ser consecuencias.
- Se les quita el `default` a ambos.
- El gate `campos_alguno` se retira de Negociación y Documentación: queda sin objeto.

### 4. Datos existentes

- **Los 119 con "sí" por default no se tocan** (decisión declarada por Vera, sin objeción de
  Mauricio): están en la ruta correcta y ya avanzaron. Reabrirlos crearía trabajo sobre
  casos que van bien.
- Los negocios abiertos que aún no han pasado por Negociación responderán la pregunta
  nueva de forma natural.
- Backfill de `servicio_contratado` para los casos vivos, derivándolo al revés desde los
  dos campos actuales (es determinista: las tres combinaciones válidas mapean 1 a 1).

## Verificación

- Tests del mapeo en `lock_when`, incluyendo el caso sin `mapping` (comportamiento intacto).
- `select * from audit_flujo_coherencia('<linea>') where not ok` debe bajar de 5 hallazgos
  a 2 (desaparecen `decision_no_obligatoria`, `decision_con_control_binario` y los dos
  `gate_decorativo`; queda `default_cierra_el_negocio`, que es alcance de O4).
- Medir antes y después, con el guardián, no de memoria.
- QA en pantalla: la pregunta se ve, no hay opción preseleccionada, y al responderla los dos
  campos derivados quedan escritos **sin recargar**.
