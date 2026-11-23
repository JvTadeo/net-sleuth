import { useEffect, useState } from 'react'
import { RiCheckboxBlankLine, RiCheckboxMultipleBlankLine, RiCloseLine, RiSubtractLine } from '@remixicon/react'
import { AppLogo } from './AppLogo'
import { cn } from '@/lib/utils'

const winBtn =
  'no-drag inline-flex h-10 w-11.5 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent outline-none'

/** Custom title bar (the window is frameless). Dragging and double-click work through the "drag" region. */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizedChange(setMaximized)
  }, [])

  return (
    <header className="drag flex h-10 shrink-0 items-center justify-between border-b border-sidebar-border bg-sidebar pl-4">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <AppLogo size={20} />
        net-sleuth
      </div>
      <div className="flex">
        <button type="button" aria-label="Minimizar" className={winBtn} onClick={() => window.api.window.minimize()}>
          <RiSubtractLine size={16} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restaurar' : 'Maximizar'}
          className={winBtn}
          onClick={() => window.api.window.toggleMaximize()}
        >
          {maximized ? <RiCheckboxMultipleBlankLine size={14} aria-hidden /> : <RiCheckboxBlankLine size={13} aria-hidden />}
        </button>
        <button
          type="button"
          aria-label="Fechar"
          className={cn(winBtn, 'hover:bg-[#c42b1c] hover:text-white focus-visible:bg-[#c42b1c] focus-visible:text-white')}
          onClick={() => window.api.window.close()}
        >
          <RiCloseLine size={16} aria-hidden />
        </button>
      </div>
    </header>
  )
}
