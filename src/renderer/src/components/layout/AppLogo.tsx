/** The app mark: signal bars on a dark tile (same drawing as resources/icon-small.svg). */
export function AppLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="7" fill="#18181b" />
      <rect x="6" y="19" width="5" height="7" rx="1.5" fill="#14b8a6" />
      <rect x="13.5" y="13" width="5" height="13" rx="1.5" fill="#f59e0b" />
      <rect x="21" y="6" width="5" height="20" rx="1.5" fill="#3b82f6" />
    </svg>
  )
}
