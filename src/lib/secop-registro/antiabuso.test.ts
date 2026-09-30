import { describe, expect, it } from 'vitest'
import {
  DOMINIOS_DESECHABLES,
  TOPE_POR_DOMINIO,
  TOPE_POR_IP,
  dominioDeCorreo,
  esDominioDesechable,
  motivoDeRechazo,
  textoMotivo,
  type MotivoRechazo,
} from './antiabuso'
import { derivarSlug, problemaDelSlug } from './slug'
import { normalizarIdentificacion, problemaDeIdentificacion } from './identificacion'
import { RESERVED_SLUGS } from '@/lib/tenant/extract-slug'

const base = { registrosPorIp: 0, registrosPorDominio: 0 }

describe('dominios desechables', () => {
  it('bloquea el dominio exacto', () => {
    expect(esDominioDesechable('alguien@mailinator.com')).toBe(true)
    expect(motivoDeRechazo({ ...base, correo: 'a@yopmail.com' })).toBe('dominio_desechable')
  })

  // La comparación es por dominio COMPLETO, no substring: si se hiciera con `includes` sobre el
  // correo, estos dos casos cambiarían de veredicto y el segundo bloquearía a alguien legítimo.
  it('no bloquea un dominio que solo CONTIENE uno desechable', () => {
    expect(esDominioDesechable('a@gmailinator.com')).toBe(false)
    expect(esDominioDesechable('a@mailinator.com.co')).toBe(false)
  })

  it('el dominio se compara en minúsculas', () => {
    expect(dominioDeCorreo('Alex@Mailinator.COM')).toBe('mailinator.com')
    expect(esDominioDesechable('Alex@Mailinator.COM')).toBe(true)
  })

  it('un correo sin forma de correo se rechaza como correo_invalido, no como desechable', () => {
    expect(motivoDeRechazo({ ...base, correo: 'no-es-un-correo' })).toBe('correo_invalido')
    expect(motivoDeRechazo({ ...base, correo: 'a@localhost' })).toBe('correo_invalido')
    expect(motivoDeRechazo({ ...base, correo: 'a@' })).toBe('correo_invalido')
  })

  it('la lista no tiene duplicados ni entradas con arroba', () => {
    expect(new Set(DOMINIOS_DESECHABLES).size).toBe(DOMINIOS_DESECHABLES.length)
    expect(DOMINIOS_DESECHABLES.every((d) => d === d.toLowerCase() && !d.includes('@'))).toBe(true)
  })
})

describe('topes por IP y por dominio', () => {
  it('el tope por IP es >=, no >', () => {
    expect(motivoDeRechazo({ ...base, correo: 'a@fabri.co', registrosPorIp: TOPE_POR_IP - 1 })).toBeNull()
    expect(motivoDeRechazo({ ...base, correo: 'a@fabri.co', registrosPorIp: TOPE_POR_IP })).toBe('tope_ip')
  })

  it('el tope por dominio aplica a un dominio corporativo', () => {
    expect(
      motivoDeRechazo({ ...base, correo: 'a@fabri.co', registrosPorDominio: TOPE_POR_DOMINIO }),
    ).toBe('tope_dominio')
  })

  // Sin la exención, el cuarto registro con Gmail del experimento quedaría afuera. Es el caso que
  // hace que el tope por dominio lastime al legítimo antes que al abusador.
  it('el tope por dominio NO aplica a los dominios masivos', () => {
    expect(
      motivoDeRechazo({ ...base, correo: 'a@gmail.com', registrosPorDominio: TOPE_POR_DOMINIO * 10 }),
    ).toBeNull()
  })

  // Decidido en `motivoDeRechazo`: un fallo de lectura no puede cerrar el registro a todo el mundo.
  it('un conteo que no se pudo medir (null) no bloquea', () => {
    expect(
      motivoDeRechazo({ correo: 'a@fabri.co', registrosPorIp: null, registrosPorDominio: null }),
    ).toBeNull()
  })

  it('la IP se evalúa antes que el dominio: el motivo que se guarda es estable', () => {
    expect(
      motivoDeRechazo({
        correo: 'a@fabri.co',
        registrosPorIp: TOPE_POR_IP,
        registrosPorDominio: TOPE_POR_DOMINIO,
      }),
    ).toBe('tope_ip')
  })
})

describe('textos al usuario', () => {
  const motivos: MotivoRechazo[] = [
    'correo_invalido',
    'dominio_desechable',
    'tope_ip',
    'tope_dominio',
    'identificacion_tomada',
    'correo_tomado',
    'slug_tomado',
  ]

  it('todo motivo tiene texto y ninguno enseña la regla ni el tope', () => {
    for (const m of motivos) {
      const t = textoMotivo(m)
      expect(t.length).toBeGreaterThan(10)
      expect(t).not.toMatch(/\bIP\b|tope|l[íi]mite|\d+ de \d+/i)
    }
  })
})

describe('derivar y validar el slug', () => {
  it('propone un slug usable desde el nombre', () => {
    expect(derivarSlug('Fabri Ingeniería S.A.S.')).toBe('fabri-ingenieria-s-a-s')
    expect(derivarSlug('  Construcciones Ñandú  ')).toBe('construcciones-nandu')
  })

  it('lo que propone SIEMPRE pasa la validación, o es vacío', () => {
    const nombres = [
      'Fabri Ingeniería S.A.S.',
      'A',
      '   ',
      '...---...',
      'Compañía Constructora del Litoral Pacífico Colombiano Limitada',
      '2026 Obras & Montajes',
      '日本語だけ',
      '-empieza-con-guion-',
    ]
    for (const n of nombres) {
      const s = derivarSlug(n)
      if (s === '') continue
      expect(problemaDelSlug(s), `slug propuesto para "${n}": "${s}"`).toBeNull()
    }
  })

  // El recorte a 30 caracteres puede caer justo sobre un guion, y un slug que termina en guion no
  // sirve como host: el espacio existiría en la base sin forma de abrirlo.
  // El nombre está elegido para que el corte caiga EXACTAMENTE sobre un guion:
  // "compania-constructora-del-rio-sur".slice(0, 30) === "compania-constructora-del-rio-".
  // Con un nombre cualquiera el corte cae casi siempre en medio de una palabra y la prueba pasa
  // igual con el defecto puesto — se comprobó mutando `derivarSlug`.
  it('el recorte a 30 no deja el guion al final', () => {
    const s = derivarSlug('Compañía Constructora del Río Sur')
    expect(s).toBe('compania-constructora-del-rio')
    expect(s.endsWith('-')).toBe(false)
    expect(s.length).toBeLessThanOrEqual(30)
    expect(problemaDelSlug(s)).toBeNull()
  })

  it('un nombre del que no sale nada usable devuelve vacío, no un slug inventado', () => {
    expect(derivarSlug('A')).toBe('')
    expect(derivarSlug('...')).toBe('')
    expect(derivarSlug('日本語だけ')).toBe('')
  })

  it('rechaza los reservados, la forma inválida y los largos', () => {
    for (const r of RESERVED_SLUGS) expect(problemaDelSlug(r)).toBe('reservado')
    expect(problemaDelSlug('-fabri')).toBe('forma')
    expect(problemaDelSlug('fabri-')).toBe('forma')
    expect(problemaDelSlug('Fabri')).toBe('forma')
    expect(problemaDelSlug('fab ri')).toBe('forma')
    expect(problemaDelSlug('f')).toBe('corto')
    expect(problemaDelSlug('a'.repeat(31))).toBe('largo')
    expect(problemaDelSlug('')).toBe('vacio')
  })

  it('acepta el mínimo y el máximo exactos', () => {
    expect(problemaDelSlug('ab')).toBeNull()
    expect(problemaDelSlug('a'.repeat(30))).toBeNull()
  })
})

describe('identificación como llave', () => {
  it('el NIT con DV separado y sin DV son la misma llave', () => {
    expect(normalizarIdentificacion('900123456-7')).toBe('900123456')
    expect(normalizarIdentificacion('900.123.456-7')).toBe('900123456')
    expect(normalizarIdentificacion('900123456')).toBe('900123456')
  })

  // ⚠️ Esta expectativa fija la trampa de `src/lib/dian/nit.ts` (líneas 16-34): el DV NO se adivina.
  // Si alguien "arregla" este caso recortando el último dígito, vuelve el defecto que mutiló 14 de
  // 290 RUT — y aquí es peor, porque la llave es única y un recorte le bloquea el registro a la
  // empresa cuyo NIT real es el recorte.
  it('el DV pegado SIN separador no se adivina: queda como otra llave', () => {
    expect(normalizarIdentificacion('9001234567')).toBe('9001234567')
    // 8 es el DV de 89090393, y 890903938 es el NIT real de Bancolombia. Recortar lo destruiría.
    expect(normalizarIdentificacion('890903938')).toBe('890903938')
  })

  it('una cédula escrita con espacios o puntos no pierde dígitos', () => {
    expect(normalizarIdentificacion('12 345 678')).toBe('12345678')
    expect(normalizarIdentificacion('1.020.304.050')).toBe('1020304050')
  })

  it('veredictos de forma', () => {
    expect(problemaDeIdentificacion('900123456-7')).toBeNull()
    expect(problemaDeIdentificacion('')).toBe('vacia')
    expect(problemaDeIdentificacion('   ')).toBe('vacia')
    expect(problemaDeIdentificacion('NIT')).toBe('sin_digitos')
    expect(problemaDeIdentificacion('123')).toBe('corta')
    expect(problemaDeIdentificacion('1'.repeat(16))).toBe('larga')
  })
})
