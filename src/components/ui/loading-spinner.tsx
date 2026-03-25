import { Loader2 } from 'lucide-react'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
  className?: string
}

const SIZE_MAP = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
}

export function LoadingSpinner({ size = 'md', text, className = '' }: LoadingSpinnerProps) {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <Loader2 className={`animate-spin text-muted-foreground ${SIZE_MAP[size]}`} />
      {text && <span className="text-sm text-muted-foreground">{text}</span>}
    </div>
  )
}

export default LoadingSpinner
