'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const K_REVEALED = 0.60

export default function Splash() {
  const [visible, setVisible] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)
  const [breathe, setBreathe] = useState(false)

  const [beamProgress, setBeamProgress] = useState(0)
  const [beamStarted, setBeamStarted] = useState(false)
  const [beamFinished, setBeamFinished] = useState(false)

  const [oneFlash, setOneFlash] = useState(false)
  const [oneGreen, setOneGreen] = useState(false)
  const [oneCooling, setOneCooling] = useState(false)

  const [lineGlow, setLineGlow] = useState(false)

  const animRef = useRef<number | null>(null)
  const startTimeRef = useRef<number | null>(null)
  const oneTriggeredRef = useRef(false)

  const runBeam = useCallback(() => {
    setBeamStarted(true)
    startTimeRef.current = performance.now()
    const duration = 2200

    const tick = (now: number) => {
      const elapsed = now - startTimeRef.current!
      const raw = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - raw, 2.6)
      setBeamProgress(eased)

      if (!oneTriggeredRef.current && eased >= K_REVEALED) {
        oneTriggeredRef.current = true
        setOneFlash(true)
        setOneGreen(true)
      }

      if (raw < 1) {
        animRef.current = requestAnimationFrame(tick)
      } else {
        setBeamFinished(true)
      }
    }
    animRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => () => {
    if (animRef.current) cancelAnimationFrame(animRef.current)
  }, [])

  useEffect(() => {
    const t = [
      setTimeout(() => runBeam(), 500),
      setTimeout(() => setOneCooling(true), 2200),
      setTimeout(() => setLineGlow(true), 2800),
      setTimeout(() => setBreathe(true), 3400),
      setTimeout(() => { setBreathe(false); setFadeOut(true) }, 4500),
      setTimeout(() => setVisible(false), 5300),
    ]
    return () => t.forEach(clearTimeout)
  }, [runBeam])

  if (!visible) return null

  const metrikChars = [
    { ch: 'M', at: 0.00 },
    { ch: 'é', at: 0.11 },
    { ch: 'T', at: 0.20 },
    { ch: 'R', at: 0.29 },
    { ch: 'I', at: 0.37 },
    { ch: 'K', at: 0.43 },
  ]

  const getMetrikOpacity = (charPos: number) => {
    const reveal = beamProgress - 0.02
    if (reveal >= charPos + 0.07) return 1
    if (reveal >= charPos - 0.02) {
      return Math.max(0.04, (reveal - (charPos - 0.02)) / 0.09)
    }
    return 0.04
  }

  const isMetrikLit = (charPos: number) => {
    return beamStarted && !beamFinished &&
      Math.abs(beamProgress - charPos - 0.04) < 0.07
  }

  const beamPct = beamProgress * 100

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&display=swap');

        .sp {
          position: fixed;
          inset: 0;
          z-index: 99999;
          background: #FFFFFF;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          opacity: ${fadeOut ? 0 : 1};
          transition: opacity 0.8s cubic-bezier(0.4,0,0.2,1);
        }

        .lk {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .lk-br { animation: br 2.2s ease-in-out infinite; }
        @keyframes br {
          0%,100% { transform: scale(1); }
          50%     { transform: scale(1.01); }
        }

        .sp-row {
          display: flex;
          align-items: baseline;
          white-space: nowrap;
          position: relative;
        }

        .sp-ch {
          font-family: 'Montserrat', sans-serif;
          line-height: 1;
          display: inline-block;
          will-change: opacity, text-shadow;
        }

        .sp-ch-b {
          font-weight: 900;
          font-size: clamp(4rem, 11vw, 8.5rem);
          color: #1A1A1A;
          letter-spacing: -0.02em;
          transition: text-shadow 0.2s ease;
        }

        .sp-lit {
          text-shadow: 0 4px 18px rgba(16,185,129,0.3), 0 2px 35px rgba(16,185,129,0.1);
        }

        .one-wrap {
          position: relative;
          display: inline-flex;
          align-items: baseline;
          margin-left: clamp(10px, 2vw, 22px);
        }

        .sp-one {
          font-family: 'Montserrat', sans-serif;
          font-weight: 400;
          font-size: clamp(4rem, 11vw, 8.5rem);
          line-height: 1;
          letter-spacing: -0.01em;
          display: inline-block;
          will-change: opacity, color, text-shadow;
          position: relative;
          z-index: 2;
        }

        .destello-wrap {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 1;
          overflow: visible;
        }

        .destello {
          width: 0;
          height: 0;
          border-radius: 50%;
          background: radial-gradient(circle,
            rgba(255,255,255,1) 0%,
            rgba(16,185,129,0.3) 30%,
            rgba(16,185,129,0.08) 50%,
            transparent 70%
          );
          opacity: 0;
        }

        .destello.fire {
          animation: db 0.7s cubic-bezier(0.16,1,0.3,1) forwards;
        }

        @keyframes db {
          0%   { width: 0; height: 0; opacity: 0; }
          8%   { width: 60px; height: 60px; opacity: 1; }
          22%  { width: 280px; height: 280px; opacity: 0.85; }
          45%  { width: 340px; height: 340px; opacity: 0.35; }
          100% { width: 380px; height: 380px; opacity: 0; }
        }

        .destello-ring {
          position: absolute;
          border-radius: 50%;
          border: 1.5px solid rgba(16,185,129,0.2);
          width: 0; height: 0;
          opacity: 0;
        }

        .destello-ring.fire {
          animation: dr 0.85s cubic-bezier(0.16,1,0.3,1) 0.04s forwards;
        }

        @keyframes dr {
          0%   { width: 20px; height: 20px; opacity: 0.5; }
          100% { width: 250px; height: 250px; opacity: 0; }
        }

        .sp-track {
          width: 100%;
          height: 4px;
          position: relative;
          margin-top: clamp(8px, 1.2vw, 14px);
          overflow: visible;
        }

        .sp-trail {
          position: absolute;
          left: 0; top: 0;
          height: 100%;
          background: #10B981;
          border-radius: 2px;
          will-change: width;
        }

        .sp-orb {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #FFFFFF;
          box-shadow:
            0 0 6px 3px rgba(16,185,129,0.8),
            0 0 18px 8px rgba(16,185,129,0.45),
            0 0 50px 16px rgba(16,185,129,0.18),
            0 0 90px 30px rgba(16,185,129,0.06);
          z-index: 10;
          pointer-events: none;
          opacity: ${beamFinished ? 0 : 1};
          transition: opacity 0.6s ease;
        }

        .sp-tail {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          height: 14px;
          background: linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.06) 40%, rgba(16,185,129,0.25) 100%);
          border-radius: 8px;
          pointer-events: none;
          z-index: 9;
          opacity: ${beamFinished ? 0 : 1};
          transition: opacity 0.5s ease;
        }

        .sp-cone {
          position: absolute;
          bottom: 100%;
          transform: translateX(-50%);
          width: 80px;
          height: 60px;
          background: linear-gradient(0deg, rgba(16,185,129,0.09) 0%, rgba(16,185,129,0.015) 50%, transparent 100%);
          clip-path: polygon(35% 100%, 65% 100%, 85% 0%, 15% 0%);
          pointer-events: none;
          z-index: 8;
          opacity: ${beamFinished ? 0 : 1};
          transition: opacity 0.5s ease;
        }

        .sp-ln-glow {
          position: absolute;
          inset: -5px 0;
          background: #10B981;
          border-radius: 6px;
          filter: blur(10px);
          opacity: 0;
          pointer-events: none;
        }
        .sp-ln-glow.on { animation: lnp 1.2s cubic-bezier(0.16,1,0.3,1) forwards; }
        @keyframes lnp {
          0%   { opacity: 0.3; }
          30%  { opacity: 0.12; }
          100% { opacity: 0; }
        }

        .sp-cn {
          position: absolute;
          width: 14px; height: 14px;
          opacity: ${lineGlow ? 0.08 : 0};
          transition: opacity 0.6s ease;
        }
        .sp-cn::before, .sp-cn::after { content:''; position:absolute; background:#1A1A1A; }
        .sp-cn.tl::before { top:0; left:0; width:10px; height:1px; }
        .sp-cn.tl::after  { top:0; left:0; width:1px; height:10px; }
        .sp-cn.tr::before { top:0; right:0; width:10px; height:1px; }
        .sp-cn.tr::after  { top:0; right:0; width:1px; height:10px; }
        .sp-cn.bl::before { bottom:0; left:0; width:10px; height:1px; }
        .sp-cn.bl::after  { bottom:0; left:0; width:1px; height:10px; }
        .sp-cn.br::before { bottom:0; right:0; width:10px; height:1px; }
        .sp-cn.br::after  { bottom:0; right:0; width:1px; height:10px; }
      `}</style>

      <div className="sp">
        <div className="sp-cn tl" style={{ top: '15%', left: '8%' }} />
        <div className="sp-cn tr" style={{ top: '15%', right: '8%' }} />
        <div className="sp-cn bl" style={{ bottom: '15%', left: '8%' }} />
        <div className="sp-cn br" style={{ bottom: '15%', right: '8%' }} />

        <div className={`lk ${breathe ? 'lk-br' : ''}`}>
          <div className="sp-row">
            {metrikChars.map((c, i) => (
              <span
                key={i}
                className={`sp-ch sp-ch-b ${isMetrikLit(c.at) ? 'sp-lit' : ''}`}
                style={{ opacity: getMetrikOpacity(c.at) }}
              >
                {c.ch}
              </span>
            ))}

            <div className="one-wrap">
              <div className="destello-wrap">
                <div className={`destello ${oneFlash ? 'fire' : ''}`} />
                <div className={`destello-ring ${oneFlash ? 'fire' : ''}`} />
              </div>

              <span
                className="sp-one"
                style={{
                  opacity: oneGreen ? 1 : 0.04,
                  color: oneCooling ? '#1A1A1A' : (oneGreen ? '#10B981' : '#1A1A1A'),
                  textShadow: oneGreen && !oneCooling
                    ? '0 0 25px rgba(16,185,129,0.5), 0 0 50px rgba(16,185,129,0.2)'
                    : '0 0 0 transparent',
                  transition: oneCooling
                    ? 'color 1s cubic-bezier(0.4,0,0.2,1), text-shadow 1s cubic-bezier(0.4,0,0.2,1)'
                    : (oneGreen
                      ? 'opacity 0.1s ease, color 0.1s ease, text-shadow 0.3s ease'
                      : 'none'),
                }}
              >
                one
              </span>
            </div>
          </div>

          <div className="sp-track">
            <div className="sp-trail" style={{ width: `${Math.min(beamPct, 100)}%` }} />

            {beamStarted && (
              <>
                <div className="sp-orb" style={{ left: `${beamPct}%` }} />
                <div
                  className="sp-tail"
                  style={{
                    left: `${Math.max(0, beamPct - 14)}%`,
                    width: `${Math.min(beamPct, 14)}%`,
                  }}
                />
                <div className="sp-cone" style={{ left: `${beamPct}%` }} />
              </>
            )}

            <div className={`sp-ln-glow ${lineGlow ? 'on' : ''}`} />
          </div>
        </div>
      </div>
    </>
  )
}
