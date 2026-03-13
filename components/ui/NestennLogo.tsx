interface NestennLogoProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: { width: 100, height: 36, houseSize: 14, textSize: 11, subTextSize: 7 },
  md: { width: 140, height: 50, houseSize: 20, textSize: 15, subTextSize: 9 },
  lg: { width: 200, height: 72, houseSize: 28, textSize: 22, subTextSize: 13 },
}

export default function NestennLogo({ size = 'md', className = '' }: NestennLogoProps) {
  const { width, height, houseSize, textSize, subTextSize } = sizeMap[size]

  const houseX = 2
  const houseY = height * 0.08
  const textX = houseSize + 8

  // House geometry scaled to houseSize
  const hs = houseSize
  const roofPoints = `${houseX + hs * 0.5},${houseY} ${houseX},${houseY + hs * 0.45} ${houseX + hs},${houseY + hs * 0.45}`
  const bodyY = houseY + hs * 0.42
  const bodyH = hs * 0.58
  const doorW = hs * 0.28
  const doorH = hs * 0.38
  const doorX = houseX + hs * 0.5 - doorW / 2
  const doorY = bodyY + bodyH - doorH

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Nestenn Juridique"
      className={className}
      role="img"
    >
      {/* House outline */}
      <polygon
        points={roofPoints}
        fill="none"
        stroke="#00AEBC"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <rect
        x={houseX}
        y={bodyY}
        width={hs}
        height={bodyH}
        fill="none"
        stroke="#00AEBC"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Door */}
      <rect
        x={doorX}
        y={doorY}
        width={doorW}
        height={doorH}
        fill="#00AEBC"
        rx="1"
      />

      {/* NESTENN text */}
      <text
        x={textX}
        y={houseY + textSize * 0.95}
        fontFamily="Metropolis, system-ui, sans-serif"
        fontWeight="700"
        fontSize={textSize}
        fill="#00AEBC"
        letterSpacing="2"
        dominantBaseline="auto"
      >
        NESTENN
      </text>

      {/* JURIDIQUE subtext */}
      <text
        x={textX}
        y={houseY + textSize + subTextSize + 3}
        fontFamily="Metropolis, system-ui, sans-serif"
        fontWeight="400"
        fontSize={subTextSize}
        fill="#4B4F54"
        letterSpacing="2.5"
        dominantBaseline="auto"
      >
        JURIDIQUE
      </text>
    </svg>
  )
}
