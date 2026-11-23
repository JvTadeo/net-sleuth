import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { PORTABLE_DATA_FLAG, portableDataDir, portableExecutable } from './portable'

const run = promisify(execFile)

let cached: boolean | null = null

/** True when the app runs with administrator rights. `net session` only succeeds when elevated. */
export async function isAdmin(): Promise<boolean> {
  if (cached !== null) return cached
  if (process.platform !== 'win32') {
    cached = process.getuid?.() === 0
    return cached
  }
  try {
    await run('net', ['session'], { windowsHide: true, timeout: 5000 })
    cached = true
  } catch {
    cached = false
  }
  return cached
}

/** Command-line flags understood at startup. */
export const FLAGS = {
  /** This instance was started by an elevation relaunch: wait for the old instance to exit. */
  relaunch: '--relaunch',
  /** Dev only: the Vite dev server URL (an elevated process does not inherit the environment). */
  rendererUrl: '--renderer-url='
} as const

export function argValue(prefix: string, argv = process.argv): string | undefined {
  const hit = argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : undefined
}

export interface Relaunch {
  /** False when the UAC prompt was declined (or PowerShell failed). */
  ok: boolean
  /** Resolves when the elevated copy exits. */
  exited: Promise<void>
}

/** Dev mode only: this instance stays alive, windowless, to keep the Vite dev server up for the elevated copy. */
let handedOff = false
export const isHandedOff = (): boolean => handedOff
export const markHandedOff = (): void => {
  handedOff = true
}

/**
 * Starts a new, elevated copy of the app through UAC.
 *
 * PowerShell prints the new process id as soon as UAC is accepted, then waits for that process to exit,
 * so the caller learns both "accepted" (resolve) and "elevated copy closed" (`exited`).
 */
export function relaunchElevated(): Promise<Relaunch> {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, exited: Promise.resolve() })
  const args: string[] = []
  if (!app.isPackaged) args.push(app.getAppPath())
  args.push(FLAGS.relaunch)
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) args.push(FLAGS.rendererUrl + devUrl)
  // Portable: relaunch the original .exe (the unpacked copy may be cleaned up) and keep the same data folder.
  const portableExe = portableExecutable()
  const dataDir = portableDataDir()
  if (dataDir) args.push(PORTABLE_DATA_FLAG + dataDir)
  const exe = portableExe ?? process.execPath

  // Start-Process joins -ArgumentList with spaces, so each argument carries its own double quotes
  // (paths like "F:\Programming Projects\..." must survive). Single quotes are PowerShell literals.
  const ps = (s: string): string => `'${s.replace(/'/g, "''")}'`
  const list = args.map((a) => ps(`"${a.replace(/\\$/, '\\\\')}"`)).join(',')
  const script = [
    `$p = Start-Process -FilePath ${ps(exe)} -ArgumentList ${list} -Verb RunAs -PassThru -ErrorAction Stop`,
    `[Console]::Out.WriteLine('PID:' + $p.Id)`,
    `[Console]::Out.Flush()`,
    `$p.WaitForExit()`
  ].join('; ')

  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    let started = false
    let markExited: () => void = () => {}
    const exited = new Promise<void>((r) => (markExited = r))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (!started && chunk.includes('PID:')) {
        started = true
        resolve({ ok: true, exited })
      }
    })
    const done = (): void => {
      markExited()
      if (!started) resolve({ ok: false, exited }) // declined, or PowerShell failed before starting it
    }
    child.on('exit', done)
    child.on('error', done)
  })
}
