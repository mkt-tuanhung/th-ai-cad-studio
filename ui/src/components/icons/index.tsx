/**
 * Icon set. Most glyphs come from Lucide (thin-line style used across the mockups); the few glyphs
 * Lucide does not have (CAD node, MEP pipe, Civil, CAD Tools "A", AI sparkles, brand logo) are drawn
 * here on the same 24px grid with the same stroke conventions.
 */
import type { SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }

function Svg({ size = 24, strokeWidth = 1.75, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Drafting node: grip square, leader, block and pointer. */
export const CadNodeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="10.4" y="2.6" width="3.2" height="3.2" rx="0.6" />
    <path d="M12 5.8v8.2" />
    <rect x="3.6" y="13.2" width="6.2" height="6.2" rx="0.6" />
    <path d="M9.8 14h6.4" />
    <path d="M16.2 14l4.3-1.9-1.3 3.4z" />
  </Svg>
)

/** MEP: J-trap pipe with two flanges. */
export const PipeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.4" y="3.6" width="7" height="2.8" rx="0.7" />
    <rect x="14.2" y="10.6" width="5.9" height="2.6" rx="0.7" />
    <path d="M5.9 6.4V13a6 6 0 0 0 6 6h.6a6 6 0 0 0 6-6v.2" />
    <path d="M9.9 6.4V13a2 2 0 0 0 2 2h.6a2 2 0 0 0 2-2v.2" />
  </Svg>
)

/** Civil: two peaks. */
export const PeaksIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.6 18.6 7.9 9.2l2.4 3.4L14 4.6l7.4 14z" />
    <path d="M7.9 9.2 13.6 18.6" />
  </Svg>
)

/** CAD Tools: "A" glyph inside a rounded square. */
export const CadToolsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2.4" />
    <path d="M8.2 16.6 12 7.2l3.8 9.4M9.6 13.3h4.8" />
  </Svg>
)

/** AI: one large and two small four-point sparkles. */
export const AiSparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 5.2c.5 3.6 1.7 4.9 5.3 5.4-3.6.5-4.8 1.8-5.3 5.4-.5-3.6-1.7-4.9-5.3-5.4 3.6-.5 4.8-1.8 5.3-5.4z" />
    <path d="M18.2 2.6v4.2M16.1 4.7h4.2" />
    <path d="M18.2 15.6v4.4M16 17.8h4.4" />
  </Svg>
)

/** Home — outline, or solid with door cut-out when `filled` (active nav). */
export const HomeIcon = ({ filled, ...p }: IconProps & { filled?: boolean }) =>
  filled ? (
    <Svg {...p} stroke="none">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M11.1 2.9a1.4 1.4 0 0 1 1.8 0l6.9 5.9c.5.4.8 1 .8 1.7v8.6a2 2 0 0 1-2 2h-3.7v-6.5a1.3 1.3 0 0 0-1.3-1.3H10.6a1.3 1.3 0 0 0-1.3 1.3v6.5H5.6a2 2 0 0 1-2-2v-8.6c0-.7.3-1.3.8-1.7z"
      />
    </Svg>
  ) : (
    <Svg {...p}>
      <path d="M4 10.3c0-.6.3-1.2.8-1.6l6.4-5.4a1.3 1.3 0 0 1 1.6 0l6.4 5.4c.5.4.8 1 .8 1.6V19a1.6 1.6 0 0 1-1.6 1.6h-3.2v-5.8a1 1 0 0 0-1-1h-3.4a1 1 0 0 0-1 1v5.8H5.6A1.6 1.6 0 0 1 4 19z" />
    </Svg>
  )

/** Brand mark (TH monogram, teal gradient). */
export function LogoMark({ width = 42, height = 34 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 42 34" aria-hidden="true">
      <defs>
        <linearGradient id="thLogoA" x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#33bdb2" />
          <stop offset="1" stopColor="#1f9d98" />
        </linearGradient>
        <linearGradient id="thLogoB" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#2aa9a3" />
          <stop offset="0.55" stopColor="#1e8c8a" />
          <stop offset="1" stopColor="#35c2b4" />
        </linearGradient>
      </defs>
      <path fill="url(#thLogoA)" d="M0 0h31.2v8.4H19V33h-8.3V8.4H0z" />
      <path
        fill="url(#thLogoB)"
        d="M27.8 0H41.6v33l-4.1-4.2V18.1c-4 0-7-1.7-8.4-4.6-.9-1.7-1.3-3.4-1.3-5.1z"
      />
    </svg>
  )
}

/* ---------- CAD tool palette (mockup 02) ---------- */

export const LineToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 19.5 19.5 4.5" />
    <circle cx="19.5" cy="4.5" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
)

export const PolylineToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19c.6-3.6 2.4-6.6 6-7.2 3.2-.5 4.6-3.4 5.6-6.3" />
    <path d="M10 11.8 19.8 18" />
    <circle cx="4" cy="19" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15.6" cy="5.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="19.8" cy="18" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
)

export const RectangleToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="0.6" />
  </Svg>
)

export const ArcToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 20c0-8.6 6.9-15.5 15.5-15.5" />
  </Svg>
)

export const TrimToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5v17M4 16.5 20 7.5M5.5 6.5l13 11" />
  </Svg>
)

export const OffsetToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M17 4.5H9.5a4.3 4.3 0 0 0 0 8.6H12" />
    <path d="M7 19.5h7.5a4.3 4.3 0 0 0 0-8.6H12" />
    <path d="M17 7.6H9.5a1.2 1.2 0 0 0 0 2.4M7 16.4h7.5a1.2 1.2 0 0 0 0-2.4" />
  </Svg>
)

export const HatchToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="0.6" />
    <path d="M4 9 9 4M4 14 14 4M4 19 19 4M9 20 20 9M14 20l6-6" strokeWidth={(p.strokeWidth ?? 1.75) * 0.8} />
  </Svg>
)

export const DimensionToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 5v6M20.5 5v6M3.5 13v6M20.5 13v6" />
    <path d="M3.5 8h17M3.5 16h17" />
    <path d="m6 6.5-2.5 1.5L6 9.5M18 6.5l2.5 1.5L18 9.5M6 14.5 3.5 16 6 17.5M18 14.5l2.5 1.5-2.5 1.5" />
  </Svg>
)

export const TextToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21 12 3l7 18M7.6 14.5h8.8" />
  </Svg>
)

export const SaveAsIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h10.2L20 7.3V12" />
    <path d="M7.5 3.5v4.6h7.5V3.5M7.5 20.5v-6h5" />
    <path d="m16.8 20.8 4.3-4.3a1.2 1.2 0 0 0-1.7-1.7l-4.3 4.3-.5 2.2z" />
  </Svg>
)

export const ExportToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.5h8l3 3.5-1.7 1.3V19a1.5 1.5 0 0 1-1.5 1.5H8.2A1.5 1.5 0 0 1 6.7 19V8.3L5 7z" />
    <path d="M12 16.5v-6M9.6 12.6 12 10.2l2.4 2.4" />
    <path d="M10 6.8h4" />
  </Svg>
)

export const PropertiesToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.8" y="3.8" width="14" height="16.4" rx="1.6" />
    <path d="M7.2 8.2h1.2M10.6 8.2h4M7.2 12h1.2M10.6 12h2.2M7.2 15.8h1.2" />
    <path d="m17.6 13.2 3 3-3 3-3-3z" fill="#fff" />
  </Svg>
)

export const ViewportToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2.4" />
    <path d="M7.6 16.6h.01" strokeWidth={(p.strokeWidth ?? 1.75) * 1.4} />
  </Svg>
)

export const LayoutToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2.4" />
    <path d="M7.5 15.5h9" />
  </Svg>
)

export const SheetToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3.5" width="14" height="17" rx="2" />
    <path d="M5 8h14" />
  </Svg>
)

/* ---------- BIM ribbon (mockup 04) ---------- */

export const WallToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4.5 11 3v16.5l-4 1.5z" />
    <path d="M11 3h4.5l2 1.5V21H11" />
    <path d="M7 4.5h0M13.5 6v13" />
  </Svg>
)

export const DoorToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 3.5h11v17h-11z" />
    <path d="M9 5.5h6.5v15" />
    <path d="M11 12.5h.01" strokeWidth={(p.strokeWidth ?? 1.75) * 1.6} />
  </Svg>
)

export const WindowToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3.5" width="14" height="17" rx="0.8" />
    <rect x="7.5" y="6" width="9" height="12" />
    <path d="M7.5 10.5h9M12 6v4.5" />
  </Svg>
)

export const SlabToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12 12 7.5l9.5 4.5L12 16.5z" />
    <path d="M2.5 12v2L12 18.5l9.5-4.5v-2" />
    <path d="M8.5 12 12 10.3l3.5 1.7L12 13.7z" />
  </Svg>
)

export const StairToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 19.5h4.5v-3.5H11v-3.5h3.5V9H18V5.5h3" />
    <path d="M3 19.5 6 21h15V5.5l-3-1.5" />
    <path d="M7.5 16 10.5 17.5M11 12.5l3 1.5M14.5 9l3 1.5" />
  </Svg>
)

export const ColumnToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="18" rx="1" />
    <path d="M11.5 5v14" />
  </Svg>
)

export const RoofToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 15.5 10 6l11.5 9" />
    <path d="M10 6l4.5 9.5H21.5M2.5 15.5 6 17.5l4-6.5" />
  </Svg>
)

export const RoomToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <path d="M4 12.5h7V20M14 4v5h6" />
  </Svg>
)

export const LevelToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 17 12 13l8.5 4L12 21z" />
    <path d="M12 3.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 9.5v6.5" />
  </Svg>
)

export const ModelTextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 20.5 12 3.5l6.5 17M8 14h8" />
  </Svg>
)

export const TagToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.6 3.5H19a1.5 1.5 0 0 1 1.5 1.5v6.4a1.5 1.5 0 0 1-.44 1.06l-7.6 7.6a1.5 1.5 0 0 1-2.12 0l-5.4-5.4a1.5 1.5 0 0 1 0-2.12l7.6-7.6a1.5 1.5 0 0 1 1.06-.44z" />
    <circle cx="16" cy="8" r="1.4" />
  </Svg>
)

export const GridToolIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.5v17M16 3.5v17M3.5 8h17M3.5 16h17M12 3.5v17M3.5 12h17" />
  </Svg>
)

export const PlanViewIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.2" />
    <path d="M7 8.5h4v4H7zM13 8.5h4M13 12h2.5M7 15.5h10" />
  </Svg>
)

export const CubeSolidIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.8 20.2 7.4v9.2L12 21.2 3.8 16.6V7.4z" fill="#1b6a70" />
    <path d="M12 2.8 20.2 7.4 12 12 3.8 7.4z" fill="#3aa3a2" />
    <path d="M12 12v9.2l8.2-4.6V7.4z" fill="#145158" />
  </svg>
)
