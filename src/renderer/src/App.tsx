import { lazy, Suspense, useEffect, useRef } from 'react'
import { TitleBar } from '@/components/layout/TitleBar'
import { Sidebar } from '@/components/layout/Sidebar'
import Connection from '@/pages/Connection'
import { useApp } from '@/store/app'

// The first page ships in the main bundle; the others load only when opened.
const Fixes = lazy(() => import('@/pages/Fixes'))
const Dns = lazy(() => import('@/pages/Dns'))
const Ping = lazy(() => import('@/pages/Ping'))
const Security = lazy(() => import('@/pages/Security'))
const Passwords = lazy(() => import('@/pages/Passwords'))
const Devices = lazy(() => import('@/pages/Devices'))
const Settings = lazy(() => import('@/pages/Settings'))

function CurrentPage() {
  const page = useApp((s) => s.page)
  switch (page) {
    case 'fixes':
      return <Fixes />
    case 'dns':
      return <Dns />
    case 'ping':
      return <Ping />
    case 'security':
      return <Security />
    case 'passwords':
      return <Passwords />
    case 'devices':
      return <Devices />
    case 'settings':
      return <Settings />
    default:
      return <Connection />
  }
}

export default function App() {
  const page = useApp((s) => s.page)
  const mainRef = useRef<HTMLElement>(null)
  // Each page starts at the top.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [page])
  const syncTheme = useApp((s) => s.syncTheme)
  const loadAppInfo = useApp((s) => s.loadAppInfo)
  const refreshNet = useApp((s) => s.refreshNet)
  const setDeviceScan = useApp((s) => s.setDeviceScan)
  const setPage = useApp((s) => s.setPage)

  // Background device scans and "open the app on this page" requests from notifications.
  useEffect(() => {
    const offDevices = window.api.devices.onChanged(setDeviceScan)
    const offNavigate = window.api.app.onNavigate(setPage)
    return () => {
      offDevices()
      offNavigate()
    }
  }, [setDeviceScan, setPage])

  useEffect(() => {
    void window.api.theme.get().then(syncTheme)
    const offTheme = window.api.theme.onChange(syncTheme)
    void loadAppInfo()
    // Read the connection after the first frame, so it never delays startup.
    setTimeout(() => void refreshNet(), 0)
    // Notify the main process after the first painted frame (measures startup time).
    requestAnimationFrame(() => window.api.app.ready())
    return () => offTheme()
  }, [syncTheme, loadAppInfo, refreshNet])

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main ref={mainRef} className="flex min-w-0 flex-1 flex-col overflow-y-auto px-7 py-6">
          <Suspense fallback={null}>
            {/* A new key per page replays the enter animation. */}
            <div key={page} className="page-enter flex min-h-0 flex-1 flex-col gap-5">
              <CurrentPage />
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  )
}
