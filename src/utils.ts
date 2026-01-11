import * as vscode from 'vscode'

export class Logger {
  private static instance: Logger
  private readonly outputChannel: vscode.OutputChannel

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('CodeBridge')
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger()
    }
    return Logger.instance
  }

  public log(message: string): void {
    const timestamp = new Date().toLocaleTimeString()
    const logMessage = `[INFO ${timestamp}] ${message}`
    this.outputChannel.appendLine(logMessage)
    console.log(logMessage)
  }

  public error(message: string, error?: unknown): void {
    const timestamp = new Date().toLocaleTimeString()
    const errorMessage = `[ERROR ${timestamp}] ${message}`
    this.outputChannel.appendLine(errorMessage)
    console.error(errorMessage)

    if (error) {
      if (error instanceof Error) {
        this.outputChannel.appendLine(error.stack || error.message)
      } else {
        this.outputChannel.appendLine(String(error))
      }
      console.error(error)
    }
  }

  public show(): void {
    this.outputChannel.show()
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
    let text = 'CodeBridge'
    let command: string | undefined = 'extension.copyWithPrompt'

    switch (status) {
      case 'working':
        icon = '$(sync~spin) '
        text = message || 'Working...'
        command = undefined
        break
      case 'success':
        icon = '$(check) '
        text = message || 'Success'
        break
      case 'error':
        icon = '$(error) '
        text = message || 'Error'
        break
      case 'idle':
      default:
        icon = '$(beaker) '
        text = 'CodeBridge'
        break
    }

    this.statusBarItem.text = `${icon}${text}`
    this.statusBarItem.command = command
    this.statusBarItem.tooltip = status === 'idle' ? 'CodeBridge: Copy context with AI prompt' : message || text

    if (revertToIdleDelay && (status === 'success' || status === 'error')) {
      this.timeoutId = setTimeout(() => {
        this.update('idle')
      }, revertToIdleDelay)
    }
  }

  public show() {
    this.statusBarItem.show()
  }

  public hide() {
    this.statusBarItem.hide()
  }

  public dispose() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }
    this.statusBarItem.dispose()
  }
}

export function getConfig<T>(section: string, key: string, defaultValue: T): T {
  const config = vscode.workspace.getConfiguration(section)
  return config.get<T>(key, defaultValue)
}

export function getGlobalExcludes(): string[] {
  const config = vscode.workspace.getConfiguration()

  const filesExclude = config.get<Record<string, boolean>>('files.exclude') || {}
  const searchExclude = config.get<Record<string, boolean>>('search.exclude') || {}

  const codeBridgeConfig = vscode.workspace.getConfiguration('codeBridge')
  const myExcludes = codeBridgeConfig.get<string[]>('exclude') || []

  const patterns = new Set<string>()

  for (const [pattern, enabled] of Object.entries(filesExclude)) {
    if (enabled) patterns.add(pattern)
  }

  for (const [pattern, enabled] of Object.entries(searchExclude)) {
    if (enabled) patterns.add(pattern)
  }

  myExcludes.forEach((pattern) => patterns.add(pattern))
  patterns.add('**/.git')

  return Array.from(patterns)
}

export function excludesToGlobPattern(excludes: string[]): string {
  if (excludes.length === 0) return ''
  if (excludes.length === 1) return excludes[0]
  return `{${excludes.join(',')}}`
}

export const posixPath = {
  dirname: (p: string) => {
    const lastSlash = p.lastIndexOf('/')
    if (lastSlash === -1) return '.'
    if (lastSlash === 0) return '/'
    return p.substring(0, lastSlash)
  },
  basename: (p: string, ext?: string) => {
    const base = p.substring(p.lastIndexOf('/') + 1)
    if (ext && base.endsWith(ext)) {
      return base.substring(0, base.length - ext.length)
    }
    return base
  },
  extname: (p: string) => {
    const base = posixPath.basename(p)
    const lastDot = base.lastIndexOf('.')
    if (lastDot === -1) return ''
    return base.substring(lastDot)
  },
  join: (...parts: string[]) => {
    const joined = parts.join('/')
    return joined.replace(/\/+/g, '/')
  },
  normalize: (p: string) => {
    const parts = p.split('/')
    const result: string[] = []
    for (const part of parts) {
      if (part === '..') {
        result.pop()
      } else if (part !== '.' && part) {
        result.push(part)
      }
    }
    return result.join('/') || (parts.length > 0 && parts[0] === '' ? '/' : '.')
  },
}

export function getFileExtension(fsPath: string): string {
  const lastDot = fsPath.lastIndexOf('.')
  if (lastDot === -1 || lastDot === 0) {
    return ''
  }
  return fsPath.substring(lastDot)
}

const REGEX_CACHE = new Map<string, RegExp>()

export function globToRegex(glob: string): RegExp {
  if (REGEX_CACHE.has(glob)) {
    return REGEX_CACHE.get(glob)!
  }

  let p = glob.replace(/\\/g, '/')

  if (!p.includes('/') && !p.includes('*')) {
    p = `**/${p}/**`
  }

  let regexStr = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\/\*\*\//g, '(?:/.*)?/')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\/\*\*/g, '(?:/.*)?')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')

  const regex = new RegExp(`^${regexStr}$`, 'i')
  REGEX_CACHE.set(glob, regex)
  return regex
}

export function isIgnored(relativePath: string, patterns: string[]): boolean {
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
