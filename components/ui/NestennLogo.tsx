'use client'

interface NestennLogoProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: { icon: 20, textMain: 13, textSub: 7.5 },
  md: { icon: 26, textMain: 16, textSub: 8.5 },
  lg: { icon: 34, textMain: 21, textSub: 11  },
}

export default function NestennLogo({ size = 'md', className = '' }: NestennLogoProps) {
  const { icon, textMain, textSub } = sizeMap[size]

  return (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      {/* House icon with N */}
      <svg width={icon} height={icon} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M16 3.5 L29 14 L3 14 Z" stroke="#00AEBC" strokeWidth="2" strokeLinejoin="round" fill="none"/>
        <path d="M6 14 L6 29 L26 29 L26 14" stroke="#00AEBC" strokeWidth="2" strokeLinejoin="round" fill="none"/>
        <path d="M11.5 23.5 L11.5 18 L20.5 23.5 L20.5 18" stroke="#00AEBC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>

      {/* Text */}
      <div className="flex flex-col leading-none" aria-label="Nestenn Juridique">
        <span style={{ fontSize: textMain, fontFamily: 'Lato, sans-serif', fontWeight: 700, color: '#00AEBC', letterSpacing: '0.12em' }}>
          NESTENN
        </span>
        <span style={{ fontSize: textSub, fontFamily: 'Lato, sans-serif', fontWeight: 400, color: '#9CA3AF', letterSpacing: '0.2em', marginTop: 1 }}>
          JURIDIQUE
        </span>
      </div>
    </div>
  )
}
