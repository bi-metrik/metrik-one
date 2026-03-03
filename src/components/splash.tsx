'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const K_REVEALED = 0.60

export default function Splash() {
  const [visible, setVisible] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)

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
    const duration = 1400

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
      setTimeout(() => runBeam(), 300),
      setTimeout(() => setOneCooling(true), 1600),
      setTimeout(() => setLineGlow(true), 2000),
      setTimeout(() => setFadeOut(true), 2200),
      setTimeout(() => setVisible(false), 2800),
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
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@300;800&display=swap');

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
          transition: opacity 0.6s cubic-bezier(0.4,0,0.2,1);
        }

        .sp-lk {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .sp-row {
          display: flex;
          align-items: baseline;
          white-space: nowrap;
          position: relative;
        }

        .sp-ch {
          font-family: 'Montserrat', sans-serif;
          font-weight: 800;
          font-size: clamp(2.2rem, 5vw, 3.2rem);
          line-height: 1;
          color: #1A1A1A;
          letter-spacing: -0.02em;
          display: inline-block;
          will-change: opacity, text-shadow;
          transition: text-shadow 0.15s ease;
        }

        .sp-lit {
          text-shadow: 0 2px 12px rgba(16,185,129,0.25), 0 1px 24px rgba(16,185,129,0.08);
        }

        .sp-one-wrap {
          position: relative;
          display: inline-flex;
          align-items: baseline;
          margin-left: clamp(6px, 1.2vw, 14px);
        }

        .sp-one {
          font-family: 'Montserrat', sans-serif;
          font-weight: 300;
          font-size: clamp(2.2rem, 5vw, 3.2rem);
          line-height: 1;
          letter-spacing: -0.01em;
          display: inline-block;
          will-change: opacity, color, text-shadow;
          position: relative;
          z-index: 2;
        }

        .sp-destello-wrap {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 1;
          overflow: visible;
        }

        .sp-destello {
          width: 0;
          height: 0;
          border-radius: 50%;
          background: radial-gradient(circle,
            rgba(255,255,255,1) 0%,
            rgba(16,185,129,0.25) 35%,
            rgba(16,185,129,0.06) 55%,
            transparent 70%
          );
          opacity: 0;
        }

        .sp-destello.fire {
          animation: sp-db 0.5s cubic-bezier(0.16,1,0.3,1) forwards;
        }

        @keyframes sp-db {
          0%   { width: 0; height: 0; opacity: 0; }
          10%  { width: 30px; height: 30px; opacity: 1; }
          30%  { width: 100px; height: 100px; opacity: 0.7; }
          60%  { width: 130px; height: 130px; opacity: 0.25; }
          100% { width: 140px; height: 140px; opacity: 0; }
        }

        .sp-track {
          width: 100%;
          height: 2px;
          position: relative;
          margin-top: clamp(6px, 1vw, 10px);
          overflow: visible;
        }

        .sp-trail {
          position: absolute;
          left: 0; top: 0;
          height: 100%;
          background: #10B981;
          border-radius: 1px;
          will-change: width;
        }

        .sp-orb {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #FFFFFF;
          box-shadow:
            0 0 4px 2px rgba(16,185,129,0.7),
            0 0 12px 5px rgba(16,185,129,0.35),
            0 0 30px 10px rgba(16,185,129,0.12);
          z-index: 10;
          pointer-events: none;
          opacity: ${beamFinished ? 0 : 1};
          transition: opacity 0.4s ease;
        }

        .sp-tail {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          height: 8px;
          background: linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.04) 40%, rgba(16,185,129,0.18) 100%);
          border-radius: 4px;
          pointer-events: none;
          z-index: 9;
          opacity: ${beamFinished ? 0 : 1};
          transition: opacity 0.4s ease;
        }

        .sp-ln-glow {
          position: absolute;
          inset: -3px 0;
          background: #10B981;
          border-radius: 4px;
          filter: blur(6px);
          opacity: 0;
          pointer-events: none;
        }
        .sp-ln-glow.on { animation: sp-lnp 0.8s cubic-bezier(0.16,1,0.3,1) forwards; }
        @keyframes sp-lnp {
          0%   { opacity: 0.2; }
          30%  { opacity: 0.08; }
          100% { opacity: 0; }
        }
      `}</style>

      <div className="sp">
        <div className="sp-lk">
          <div className="sp-row">
            {metrikChars.map((c, i) => (
              <span
                key={i}
                className={`sp-ch ${isMetrikLit(c.at) ? 'sp-lit' : ''}`}
                style={{ opacity: getMetrikOpacity(c.at) }}
              >
                {c.ch}
              </span>
            ))}

            <div className="sp-one-wrap">
              <div className="sp-destello-wrap">
                <div className={`sp-destello ${oneFlash ? 'fire' : ''}`} />
              </div>

              <span
                className="sp-one"
                style={{
                  opacity: oneGreen ? 1 : 0.04,
                  color: oneCooling ? '#1A1A1A' : (oneGreen ? '#10B981' : '#1A1A1A'),
                  textShadow: oneGreen && !oneCooling
                    ? '0 0 16px rgba(16,185,129,0.4), 0 0 32px rgba(16,185,129,0.15)'
                    : '0 0 0 transparent',
                  transition: oneCooling
                    ? 'color 0.8s cubic-bezier(0.4,0,0.2,1), text-shadow 0.8s cubic-bezier(0.4,0,0.2,1)'
                    : (oneGreen
                      ? 'opacity 0.08s ease, color 0.08s ease, text-shadow 0.2s ease'
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
                    left: `${Math.max(0, beamPct - 12)}%`,
                    width: `${Math.min(beamPct, 12)}%`,
                  }}
                />
              </>
            )}

            <div className={`sp-ln-glow ${lineGlow ? 'on' : ''}`} />
          </div>
        </div>
      </div>
    </>
  )
}
