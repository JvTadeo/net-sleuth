import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Runs a Windows PowerShell script and returns its output.
 * The script travels with -EncodedCommand (UTF-16LE base64), so no quoting or escaping can break it.
 * Scripts that print JSON should set [Console]::OutputEncoding to UTF-8 first.
 */
export async function powershell(script: string, timeout = 60_000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout, encoding: 'utf8' }
  )
  // Windows PowerShell may prefix UTF-8 output with a BOM.
  return stdout.replace(/^﻿/, '').trim()
}

/** Embeds a value in a PowerShell script as base64 JSON; decode it in the script with `fromArg`. */
export function psArg(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
}

/** PowerShell snippet that turns a `psArg` value back into an object. */
export const fromArg = (b64: string): string =>
  `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}')) | ConvertFrom-Json)`

/** PowerShell turns one-item arrays into objects and empty ones into null: normalize. */
export function toArray<T>(v: T | T[] | null | undefined): T[] {
  if (v == null) return []
  return (Array.isArray(v) ? v : [v]).filter((x): x is T => x != null)
}
