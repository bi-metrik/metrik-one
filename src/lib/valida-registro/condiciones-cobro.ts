/**
 * La cláusula de cobro al terminar la prueba (`condiciones-prueba-valida-v1.0.md` §2), aprobada por
 * Mauricio el 2026-10-11 como texto INACTIVO: copiada tal cual, con sus cuatro campos sin llenar.
 *
 * ⚠️ NO está en las Condiciones vigentes. Entra solo cuando se cumplan las cinco condiciones de §2.1
 * (pasarela con cobro a tarjeta guardada, botón de cancelar y aviso previo construidos, pasarela
 * declarada en la Política, Términos v2.0 aceptados en el mismo registro, campos llenos) y Vera la
 * revise con los campos llenos. Al activarse REEMPLAZA el numeral 7 y la versión pasa a 2.0
 * (`condicionesVigentes` en `condiciones.ts`).
 *
 * Mientras tanto vive detrás de `VALIDA_COBRO_TRAS_PRUEBA=1`, y en producción además detrás de
 * `CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION`, que solo cambia un PR después del visto de Vera: la
 * variable de entorno sola no la enciende para clientes reales.
 */

export const CLAUSULA_COBRO_TRAS_PRUEBA = `7. Medio de pago y cobro al terminar la prueba. Para abrir la prueba, la Empresa registra un medio de pago en la pasarela {nombre_pasarela}. METRIK no guarda los datos de la tarjeta: los guarda la pasarela. Durante la prueba no se cobra nada.

7.1. Cobro. Si la Empresa no cancela la prueba antes de que termine, al terminar METRIK cobra a ese medio de pago el primer mes del plan mensual de Valida: $150.000, valor total, sin IVA que sumar. Desde ese día el plan queda activo bajo los Términos de Uso de Valida que la Empresa aceptó en este registro, con hasta {limite_mensual} consultas al mes.

7.2. Aviso previo. METRIK escribe al correo registrado al menos {horas_aviso} horas antes del cobro, con la fecha y el valor.

7.3. Cómo cancelar. La Empresa cancela desde {lugar_del_boton} o escribiendo a mauricio.moreno@metrik.com.co antes de que termine la prueba. Si cancela a tiempo, no se cobra nada.

7.4. Sin permanencia. Al terminar la prueba solo se cobra un mes. El plan es mensual, se renueva solo cada mes según los Términos de Uso de Valida y la Empresa puede retirarse cuando quiera, sin penalidad; el mes ya pagado no se reembolsa.

7.5. Si el cobro falla. No se activa el plan y METRIK envía un enlace de pago. La Empresa no queda debiendo nada por la prueba.`

/** Se cambia a `true` en un PR, después del visto de Vera con los campos llenos (§2.1 y veredicto). */
export const CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION = false

/** Los cuatro campos de la cláusula, de dónde salen. Sin uno solo, la cláusula no se activa. */
export function camposClausulaCobro(env: Record<string, string | undefined>): Record<string, string | null> {
  const limpio = (v: string | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    nombre_pasarela: limpio(env.VALIDA_COBRO_PASARELA),
    // El mismo límite del plan (`VALIDA_PLAN_LIMITE_MES`, 3.000 por defecto), escrito con puntos.
    limite_mensual: new Intl.NumberFormat('es-CO').format(
      Number.isInteger(Number(env.VALIDA_PLAN_LIMITE_MES)) && Number(env.VALIDA_PLAN_LIMITE_MES) > 0 ? Number(env.VALIDA_PLAN_LIMITE_MES) : 3000,
    ),
    horas_aviso: limpio(env.VALIDA_COBRO_HORAS_AVISO),
    lugar_del_boton: limpio(env.VALIDA_COBRO_LUGAR_CANCELAR),
  }
}
