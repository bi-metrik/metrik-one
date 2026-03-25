import Link from 'next/link'

const SIZES = {
  lg: {
    fontSize: 'clamp(2rem, 5vw, 2.5rem)',
    lineHeight: '2.5px',
    lineMargin: '6px',
    gap: '0.3rem',
  },
  md: {
    fontSize: 'clamp(1.4rem, 3.5vw, 1.6rem)',
    lineHeight: '2px',
    lineMargin: '4px',
    gap: '0.2rem',
  },
} as const

interface MetrikLockupProps {
  size?: 'lg' | 'md'
  linkTo?: string
}

export default function MetrikLockup({ size = 'md', linkTo }: MetrikLockupProps) {
  const s = SIZES[size]
  const font = 'var(--font-montserrat), Montserrat, sans-serif'

  const lockup = (
    <div className="inline-flex flex-col">
      <div className="flex items-baseline" style={{ fontFamily: font, fontSize: s.fontSize }}>
        <span style={{ fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--foreground)' }}>
          MéTRIK
        </span>
        <span style={{ fontWeight: 300, letterSpacing: '-0.01em', color: 'var(--foreground)', marginLeft: s.gap }}>
          one
        </span>
      </div>
      <div
        style={{
          height: s.lineHeight,
          backgroundColor: '#10B981',
          borderRadius: '1px',
          marginTop: s.lineMargin,
        }}
      />
    </div>
  )

  if (linkTo) {
    return (
      <Link href={linkTo} className="inline-block">
        {lockup}
      </Link>
    )
  }

  return lockup
}
