import { describe, expect, it } from 'vitest'
import { esIpDeCloudflare, ipDelCliente, origenDelPedido, ubicacionDelPedido } from './ip-cliente'

const h = (o: Record<string, string>) => new Headers(o)

describe('esIpDeCloudflare', () => {
  it('reconoce IPv4 e IPv6 dentro de los rangos publicados', () => {
    expect(esIpDeCloudflare('172.70.1.9')).toBe(true) // 172.64.0.0/13
    expect(esIpDeCloudflare('162.159.255.255')).toBe(true) // 162.158.0.0/15, borde superior
    expect(esIpDeCloudflare('2606:4700:10::ac43:1')).toBe(true)
    expect(esIpDeCloudflare('2a06:98c7:ffff::1')).toBe(true) // /29: 98c0–98c7
  })

  it('no confunde IPs vecinas ni basura', () => {
    expect(esIpDeCloudflare('172.72.0.1')).toBe(false) // justo después de 172.64.0.0/13
    expect(esIpDeCloudflare('162.160.0.0')).toBe(false)
    expect(esIpDeCloudflare('2a06:98c8::1')).toBe(false)
    expect(esIpDeCloudflare('186.81.102.19')).toBe(false) // Claro Colombia
    expect(esIpDeCloudflare('172.70.1')).toBe(false)
    expect(esIpDeCloudflare('172.70.1.999')).toBe(false)
    expect(esIpDeCloudflare('no-es-ip')).toBe(false)
    expect(esIpDeCloudflare(null)).toBe(false)
  })
})

describe('origenDelPedido', () => {
  it('por Cloudflare: la IP real sale de cf-connecting-ip', () => {
    const r = origenDelPedido(h({ 'x-real-ip': '172.70.1.9', 'x-forwarded-for': '172.70.1.9', 'cf-connecting-ip': '181.51.2.3' }))
    expect(r).toEqual({ ip: '181.51.2.3', via: 'cloudflare' })
  })

  it('por Cloudflare con IPv6 del usuario y del PoP', () => {
    const r = origenDelPedido(h({ 'x-real-ip': '2400:cb00:1::1', 'cf-connecting-ip': '2800:e2:9c00::5' }))
    expect(r).toEqual({ ip: '2800:e2:9c00::5', via: 'cloudflare' })
  })

  it('por Cloudflare sin cf-connecting-ip (o inválida): null, nunca la IP del PoP', () => {
    expect(origenDelPedido(h({ 'x-real-ip': '172.70.1.9' }))).toEqual({ ip: null, via: 'cloudflare' })
    expect(origenDelPedido(h({ 'x-real-ip': '172.70.1.9', 'cf-connecting-ip': 'x' }))).toEqual({ ip: null, via: 'cloudflare' })
  })

  it('directo con cf-connecting-ip falsificada: se ignora', () => {
    const r = origenDelPedido(h({ 'x-real-ip': '186.81.102.19', 'cf-connecting-ip': '8.8.8.8' }))
    expect(r).toEqual({ ip: '186.81.102.19', via: 'directo' })
  })

  it('directo sin x-real-ip: primera de x-forwarded-for, como antes', () => {
    expect(ipDelCliente(h({ 'x-forwarded-for': '186.81.102.19, 76.76.21.21' }))).toBe('186.81.102.19')
    expect(ipDelCliente(h({}))).toBeNull()
  })

  it('un x-forwarded-for de Cloudflare no abre la puerta si x-real-ip no es de Cloudflare', () => {
    const r = origenDelPedido(h({ 'x-real-ip': '186.81.102.19', 'x-forwarded-for': '172.70.1.9', 'cf-connecting-ip': '8.8.8.8' }))
    expect(r).toEqual({ ip: '186.81.102.19', via: 'directo' })
  })
})

describe('ubicacionDelPedido', () => {
  const pop = { 'x-real-ip': '172.70.1.9', 'x-vercel-ip-city': 'Miami', 'x-vercel-ip-country-region': 'FL', 'x-vercel-ip-country': 'US' }

  it('por Cloudflare sin cabeceras de ubicación: todo null, no Miami', () => {
    expect(ubicacionDelPedido(h(pop))).toEqual({ ciudad: null, region: null, pais: null })
  })

  it('por Cloudflare con el Managed Transform encendido', () => {
    const u = ubicacionDelPedido(h({ ...pop, 'cf-ipcity': 'Bogot%C3%A1', 'cf-region-code': 'DC', 'cf-region': 'Bogota D.C.', 'cf-ipcountry': 'CO' }))
    expect(u).toEqual({ ciudad: 'Bogotá', region: 'DC', pais: 'CO' })
    expect(ubicacionDelPedido(h({ ...pop, 'cf-region': 'Bogota D.C.' })).region).toBe('Bogota D.C.')
  })

  it('país desconocido o Tor de Cloudflare: null', () => {
    expect(ubicacionDelPedido(h({ ...pop, 'cf-ipcountry': 'XX' })).pais).toBeNull()
    expect(ubicacionDelPedido(h({ ...pop, 'cf-ipcountry': 'T1' })).pais).toBeNull()
  })

  it('directo: las de Vercel, aunque vengan cf-* falsas', () => {
    const u = ubicacionDelPedido(
      h({ 'x-real-ip': '186.81.102.19', 'x-vercel-ip-city': 'Zipaquir%C3%A1', 'x-vercel-ip-country-region': 'CUN', 'x-vercel-ip-country': 'CO', 'cf-ipcity': 'Paris' }),
    )
    expect(u).toEqual({ ciudad: 'Zipaquirá', region: 'CUN', pais: 'CO' })
  })
})
