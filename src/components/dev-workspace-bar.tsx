'use client'

type Workspace = { slug: string; name: string }

export default function DevWorkspaceBar({
  workspaces,
  activeSlug,
}: {
  workspaces: Workspace[]
  activeSlug: string
}) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: '#18181b',
        borderTop: '1px solid #3f3f46',
        padding: '6px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontFamily: 'monospace',
        fontSize: '11px',
      }}
    >
      <span style={{ color: '#71717a', marginRight: 4 }}>DEV</span>
      {workspaces.map((ws) => {
        const isActive = ws.slug === activeSlug
        return (
          <a
            key={ws.slug}
            href={`/?__ws=${ws.slug}`}
            style={{
              padding: '2px 10px',
              borderRadius: '4px',
              textDecoration: 'none',
              fontWeight: isActive ? 700 : 400,
              background: isActive ? '#10b981' : '#27272a',
              color: isActive ? '#fff' : '#a1a1aa',
              border: isActive ? '1px solid #10b981' : '1px solid #3f3f46',
              transition: 'all 0.1s',
            }}
          >
            {ws.name}
          </a>
        )
      })}
      <a
        href="/?__ws=off"
        style={{
          marginLeft: 'auto',
          padding: '2px 10px',
          borderRadius: '4px',
          textDecoration: 'none',
          background: '#27272a',
          color: '#71717a',
          border: '1px solid #3f3f46',
          fontSize: '10px',
        }}
      >
        ✕ salir
      </a>
    </div>
  )
}
