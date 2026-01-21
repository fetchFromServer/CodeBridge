import * as vscode from 'vscode'

export const posixPath = {
  basename: (p: string, ext?: string) => {
    const base = p.substring(p.lastIndexOf('/') + 1)
    if (ext && base.endsWith(ext)) {
      return base.substring(0, base.length - ext.length)
    }
    return base
  },
  extname: (p: string) => {
    const base = p.substring(p.lastIndexOf('/') + 1)
    const lastDot = base.lastIndexOf('.')
    if (lastDot === -1 || lastDot === 0) return ''
    return base.substring(lastDot)
  },
  normalize: (p: string) => {
    const parts = p.split('/')
    const stack: string[] = []
    for (const part of parts) {
      if (part === '..') stack.pop()
      else if (part !== '.' && part !== '') stack.push(part)
    }
    return (p.startsWith('/') ? '/' : '') + stack.join('/')
  },
}

export class Logger {
  private static instance: Logger
  private readonly outputChannel: vscode.OutputChannel

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Context Tools')
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  public log(message: string): void {
    const timestamp = new Date().toLocaleTimeString()
    this.outputChannel.appendLine(`[INFO ${timestamp}] ${message}`)
    console.log(message)
  }

  public error(message: string, error?: unknown): void {
    const timestamp = new Date().toLocaleTimeString()
    this.outputChannel.appendLine(`[ERROR ${timestamp}] ${message}`)
    if (error instanceof Error) {
      this.outputChannel.appendLine(error.stack || error.message)
    } else {
      this.outputChannel.appendLine(String(error))
    }
  }
}

export type Status = 'idle' | 'working' | 'success' | 'error'

export class StatusBarManager implements vscode.Disposable {
  private static instance: StatusBarManager
  private statusBarItem: vscode.StatusBarItem
  private timeoutId: ReturnType<typeof setTimeout> | undefined

  private constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    this.update('idle')
    this.statusBarItem.show()
  }

  public static getInstance(): StatusBarManager {
    if (!StatusBarManager.instance) {
      StatusBarManager.instance = new StatusBarManager()
    }
    return StatusBarManager.instance
  }

  public update(status: Status, message?: string, revertToIdleDelay?: number): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }

    let icon = ''
    let text = 'Context'
    let command: string | undefined = 'extension.copyWithPrompt'

    switch (status) {
      case 'working':
        icon = '$(sync~spin) '
        text = message || 'Processing...'
        command = undefined
        break
      case 'success':
        icon = '$(check) '
        text = message || 'Done'
        break
      case 'error':
        icon = '$(error) '
        text = message || 'Error'
        break
      case 'idle':
      default:
        icon = '$(beaker) '
        text = 'Context'
        break
    }

    this.statusBarItem.text = `${icon}${text}`
    this.statusBarItem.command = command
    this.statusBarItem.tooltip =
      status === 'idle' ? 'Copy context with instruction' : message || text

    if (revertToIdleDelay && (status === 'success' || status === 'error')) {
      this.timeoutId = setTimeout(() => {
        this.update('idle')
      }, revertToIdleDelay)
    }
  }
  public dispose() {
    if (this.timeoutId) clearTimeout(this.timeoutId)
    this.statusBarItem.dispose()
  }
}

export function excludesToGlobPattern(excludes: string[]): string {
  if (!excludes || excludes.length === 0) return ''
  if (excludes.length === 1) return excludes[0]
  return `{${excludes.join(',')}}`
}

export function getFileExtension(fsPath: string): string {
  return posixPath.extname(fsPath)
}

const REGEX_CACHE = new Map<string, RegExp>()

export function globToRegex(glob: string): RegExp {
  if (REGEX_CACHE.has(glob)) return REGEX_CACHE.get(glob)!

  let p = glob.replace(/\\/g, '/')
  if (!p.includes('/')) p = '**/' + p

  const escaped = p.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')
  let regexStr = escaped
    .replace(/\\\*\\\*\\\//g, '(?:.*/)?')
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '.')

  const regex = new RegExp(`^${regexStr}$`, 'i')
  REGEX_CACHE.set(glob, regex)
  return regex
}

export function isIgnored(relativePath: string, patterns: string[]): boolean {
  if (!patterns || !patterns.length) return false
  const normalizedPath = relativePath.replace(/\\/g, '/')

  for (const pattern of patterns) {
    const p = pattern.replace(/\\/g, '/')
    if (!p.includes('*') && !p.includes('?')) {
      const cleanPattern = p.replace(/\/$/, '')
      if (
        normalizedPath === cleanPattern ||
        normalizedPath.startsWith(cleanPattern + '/') ||
        normalizedPath.includes('/' + cleanPattern + '/') ||
        normalizedPath.endsWith('/' + cleanPattern)
      ) {
        return true
      }
      continue
    }
    const regex = globToRegex(p)
    if (regex.test(normalizedPath)) return true
  }
  return false
}
