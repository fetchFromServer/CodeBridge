import * as vscode from 'vscode'
import {
  Logger,
  StatusBarManager,
  excludesToGlobPattern,
  getConfig,
  getFileExtension,
  getGlobalExcludes,
} from '../utils'
import { AnalysisStrategy, ContextManager } from './analysis'
import { collectDiagnostics } from './diagnostics'

interface CopyConfig {
  excludePatterns: string[]
  includeStats: boolean
  disableSuccessNotifications: boolean
  includeDiagnostics: boolean
  raw: boolean
  maxFileSize: number
  lineWarningLimit: number
  codeFence: string
  removeLeadingWhitespace: boolean
  minifyToSingleLine: boolean
  analysisEnabled: boolean
  autoCopyReferences: boolean
  maxAutoFiles: number
  analysisStrategy: AnalysisStrategy
}

interface FileContent {
  path: string
  content: string
  size: number
  lines: number
  words: number
  extension: string
  diagnostics?: string
  impact?: string
}

const SAFETY_MAX_FILE_SIZE = 100 * 1024 * 1024

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.svg',
  '.pdf',
  '.zip',
  '.gz',
  '.rar',
  '.7z',
  '.tar',
  '.bz2',
  '.exe',
  '.dll',
  '.bin',
  '.wasm',
  '.so',
  '.dylib',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.db',
  '.sqlite',
  '.mdb',
  '.accdb',
  '.pyc',
  '.pyo',
  '.class',
  '.jar',
  '.war',
  '.dmg',
  '.iso',
  '.img',
  '.vhd',
  '.vmdk',
  '.node',
  '.whl',
  '.gem',
  '.lock',
])

class FileProcessor {
  private readonly config: CopyConfig
  private readonly logger: Logger
  private readonly cache = new Map<string, FileContent | null>()

  constructor(config: CopyConfig, logger: Logger) {
    this.config = config
    this.logger = logger
  }

  private removeLeadingWhitespaceFromContent(content: string): string {
    return content
      .split('\n')
      .map((line) => line.trimStart())
      .join('\n')
  }

  private minifyContentToSingleLine(content: string): string {
    return content
      .replace(/(\r\n|\n|\r)/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private isBinaryFile(uri: vscode.Uri, bytes: Uint8Array): boolean {
    const ext = getFileExtension(uri.path).toLowerCase()
    if (BINARY_EXTENSIONS.has(ext)) return true
    try {
      const checkLength = Math.min(bytes.length, 8000)
      for (let i = 0; i < checkLength; i++) {
        if (bytes[i] === 0) return true
      }
      return false
    } catch (e) {
      return true
    }
  }

  private countLinesAndWords(content: string): { lines: number; words: number } {
    if (content.length === 0) return { lines: 1, words: 0 }
    const lineMatches = content.match(/\n/g)
    const lines = lineMatches ? lineMatches.length + 1 : 1
    const words = content.match(/\b[\w']+\b/g)?.length || 0
    return { lines, words }
  }

  async processFile(fileUri: vscode.Uri): Promise<FileContent | null> {
    const cacheKey = fileUri.toString()
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) || null

    try {
      let content = ''
      let fileSize = 0

      if (fileUri.scheme === 'file') {
        const stat = await vscode.workspace.fs.stat(fileUri)
        fileSize = stat.size

        if (this.config.maxFileSize > 0 && fileSize > this.config.maxFileSize) {
          this.cache.set(cacheKey, null)
          return null
        }
        if (fileSize > SAFETY_MAX_FILE_SIZE) {
          this.cache.set(cacheKey, null)
          return null
        }

        const fileBytes = await vscode.workspace.fs.readFile(fileUri)
        if (this.isBinaryFile(fileUri, fileBytes)) {
          this.cache.set(cacheKey, null)
          return null
        }
        content = new TextDecoder('utf-8', { fatal: false }).decode(fileBytes)
      } else if (fileUri.scheme === 'untitled') {
        const doc = await vscode.workspace.openTextDocument(fileUri)
        content = doc.getText()
        fileSize = content.length
      } else {
        try {
          const fileBytes = await vscode.workspace.fs.readFile(fileUri)
          content = new TextDecoder('utf-8').decode(fileBytes)
          fileSize = fileBytes.byteLength
        } catch (e) {
          return null
        }
      }

      if (this.config.minifyToSingleLine) {
        content = this.minifyContentToSingleLine(content)
      } else if (this.config.removeLeadingWhitespace) {
        content = this.removeLeadingWhitespaceFromContent(content)
      }

      const relativePath = vscode.workspace.asRelativePath(fileUri, false).replace(/\\/g, '/')
      const { lines, words } = this.countLinesAndWords(content)
      const extension = getFileExtension(relativePath)

      let diagnosticsStr = ''
      if (this.config.includeDiagnostics) {
        try {
          diagnosticsStr = await collectDiagnostics(fileUri)
        } catch (e) {
          this.logger.error(`Diagnostics failed for ${fileUri.fsPath}`, e)
        }
      }

      const shouldCheckStats = this.config.analysisEnabled && this.config.includeStats
      const impactStr = await ContextManager.getFileMetadata(fileUri, shouldCheckStats)

      const result: FileContent = {
        path: relativePath,
        content,
        size: fileSize,
        lines,
        words,
        extension,
        diagnostics: diagnosticsStr,
        impact: impactStr,
      }

      this.cache.set(cacheKey, result)
      return result
    } catch (error) {
      this.logger.error(`Error processing ${fileUri.fsPath}`, error)
      this.cache.set(cacheKey, null)
      return null
    }
  }

  async processFiles(
    fileUris: vscode.Uri[],
    progressReporter: { report: (message: string) => void }
  ): Promise<FileContent[]> {
    const results: FileContent[] = []
    const optimalChunkSize = Math.min(Math.max(4, Math.floor(fileUris.length / 10)), 32)

    for (let i = 0; i < fileUris.length; i += optimalChunkSize) {
      const chunk = fileUris.slice(i, Math.min(i + optimalChunkSize, fileUris.length))
      const chunkPromises = chunk.map((uri) => this.processFile(uri))
      const chunkResults = await Promise.allSettled(chunkPromises)

      for (const result of chunkResults) {
        if (result.status === 'fulfilled' && result.value !== null) {
          results.push(result.value)
        }
      }
      progressReporter.report(`Processing ${Math.min(i + optimalChunkSize, fileUris.length)}/${fileUris.length}...`)
    }
    return results
  }
}

function getDynamicFence(content: string, defaultFence: string): string {
  const matches = content.match(/`+/g)
  if (!matches) return defaultFence
  const maxLength = Math.max(...matches.map((m) => m.length))
  return maxLength >= defaultFence.length ? '`'.repeat(maxLength + 1) : defaultFence
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatOutput(
  files: FileContent[],
  config: Pick<CopyConfig, 'includeStats' | 'raw' | 'codeFence'>,
  prompt?: string
): { output: string; sizeBytes: number } {
  let totalBytes = 0
  for (const file of files) totalBytes += file.size

  if (config.raw) {
    const contentOutput = files.map((file) => file.content).join('\n\n')
    return { output: contentOutput, sizeBytes: totalBytes }
  }

  const parts: string[] = []

  if (prompt) {
    parts.push(`${prompt}\n\n---\n`)
  }

  if (config.includeStats) {
    let totalLines = 0
    const typeCount = new Map<string, number>()
    for (const file of files) {
      totalLines += file.lines
      const ext = file.extension || 'no-ext'
      typeCount.set(ext, (typeCount.get(ext) || 0) + 1)
    }
    const sortedTypes = Array.from(typeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([ext, count]) => `${ext}: ${count}`)
      .join(', ')
    const timestamp = new Date().toISOString()

    parts.push(
      `CONTEXT SUMMARY\n` +
        `Timestamp: ${timestamp}\n` +
        `Files:      ${files.length}\n` +
        `Size:       ${formatSize(totalBytes)}\n` +
        `Lines:      ${totalLines}\n` +
        `Types:      ${sortedTypes}\n` +
        `---\n`
    )
  }

  for (const file of files) {
    const ext = file.extension.slice(1) || 'txt'
    const fence = getDynamicFence(file.content, config.codeFence)
    const hasDiagnostics = file.diagnostics && file.diagnostics.length > 0

    let header = `## ${file.path}`
    const metaLines: string[] = []

    if (config.includeStats) {
      metaLines.push(`> Lines: ${file.lines} | Size: ${formatSize(file.size)} | Lang: ${ext}`)
      if (file.impact) metaLines.push(file.impact)
    }

    if (hasDiagnostics) {
      metaLines.push(file.diagnostics!.trimEnd())
    }

    const metaBlock = metaLines.length > 0 ? metaLines.join('\n') + '\n' : ''
    parts.push(`${header}\n` + `${metaBlock}` + `${fence}${ext}\n` + `${file.content}\n` + `${fence}\n`)
  }

  return { output: parts.join('\n'), sizeBytes: totalBytes }
}

export async function copyAllContents(
  clickedUri: vscode.Uri | undefined,
  selectedUris: vscode.Uri[] | undefined,
  logger: Logger,
  statusBarManager: StatusBarManager,
  prompt?: string,
  forceDiagnostics: boolean = false,
  analysisStrategy: AnalysisStrategy = 'shallow',
  expansionMode: 'off' | 'config' | 'force' = 'off'
) {
  const globalAutoRef = getConfig('codeBridge', 'analysis.autoCopyReferences', false)
  let finalAutoCopy = false

  if (expansionMode === 'force') finalAutoCopy = true
  else if (expansionMode === 'config') finalAutoCopy = globalAutoRef
  else finalAutoCopy = false

  const config: CopyConfig = {
    excludePatterns: getGlobalExcludes(),
    disableSuccessNotifications: getConfig('codeBridge', 'notifications.disableSuccess', false),
    includeStats: getConfig('codeBridge', 'copy.includeStats', false),
    includeDiagnostics: forceDiagnostics ? true : getConfig('codeBridge', 'copy.includeDiagnostics', true),
    raw: getConfig('codeBridge', 'copy.raw', false),
    maxFileSize: getConfig('codeBridge', 'copy.maxFileSize', 0),
    lineWarningLimit: getConfig('codeBridge', 'copy.lineWarningLimit', 50000),
    codeFence: getConfig('codeBridge', 'copy.codeFence', '```'),
    removeLeadingWhitespace: getConfig('codeBridge', 'copy.removeLeadingWhitespace', false),
    minifyToSingleLine: getConfig('codeBridge', 'copy.minifyToSingleLine', false),
    analysisEnabled: getConfig('codeBridge', 'analysis.enabled', true),
    maxAutoFiles: getConfig('codeBridge', 'analysis.maxAutoFiles', 5),
    analysisStrategy: analysisStrategy,
    autoCopyReferences: finalAutoCopy,
  }

  const initial: vscode.Uri[] = []
  if (selectedUris?.length) initial.push(...selectedUris)
  else if (clickedUri) initial.push(clickedUri)
  else {
    const active = vscode.window.activeTextEditor?.document?.uri
    if (active) initial.push(active)
  }

  if (!initial.length) {
    vscode.window.showWarningMessage('No files or folders selected.')
    return
  }

  const expansionResult = await ContextManager.expandContext(
    initial,
    {
      enabled: config.analysisEnabled && config.autoCopyReferences,
      strategy: config.analysisStrategy,
      maxFiles: config.maxAutoFiles,
      excludePatterns: config.excludePatterns,
    },
    (msg) => statusBarManager.update('working', msg)
  )

  const finalUrisSet = expansionResult.uris
  const totalAnalysisAdded = expansionResult.addedCount
  const expandedUris = Array.from(finalUrisSet).map((u) => vscode.Uri.parse(u))

  try {
    statusBarManager.update('working', 'Discovering files...')

    const sortedUris: vscode.Uri[] = []

    if (expandedUris.length > 0) {
      const distinctPaths = new Set<string>()
      const excludeGlob = excludesToGlobPattern(config.excludePatterns)

      for (const uri of expandedUris) {
        try {
          const stat = await vscode.workspace.fs.stat(uri)
          if (stat.type === vscode.FileType.Directory) {
            const pattern = new vscode.RelativePattern(uri, '**/*')
            const files = await vscode.workspace.findFiles(pattern, excludeGlob)
            files.forEach((f) => {
              if (!distinctPaths.has(f.toString())) {
                distinctPaths.add(f.toString())
                sortedUris.push(f)
              }
            })
          } else {
            if (!distinctPaths.has(uri.toString())) {
              distinctPaths.add(uri.toString())
              sortedUris.push(uri)
            }
          }
        } catch {
          if (!distinctPaths.has(uri.toString())) {
            distinctPaths.add(uri.toString())
            sortedUris.push(uri)
          }
        }
      }
    }

    if (sortedUris.length === 0) {
      vscode.window.showInformationMessage('No files found (check exclude settings).')
      statusBarManager.update('idle')
      return
    }

    if (sortedUris.length > 500) {
      const proceed = await vscode.window.showWarningMessage(
        `About to process ${sortedUris.length} files. Continue?`,
        'Yes',
        'No'
      )
      if (proceed !== 'Yes') {
        statusBarManager.update('idle')
        return
      }
    }

    const processor = new FileProcessor(config, logger)
    const fileContents = await processor.processFiles(sortedUris, {
      report: (msg) => statusBarManager.update('working', msg),
    })

    if (fileContents.length === 0) {
      vscode.window.showInformationMessage('No readable files found.')
      statusBarManager.update('idle')
      return
    }

    const { output: finalContent, sizeBytes } = formatOutput(fileContents, config, prompt)
    const finalLineCount = (finalContent.match(/\n/g) || []).length + 1

    if (config.lineWarningLimit > 0 && finalLineCount > config.lineWarningLimit) {
      const proceed = await vscode.window.showWarningMessage(
        `Output contains ${finalLineCount.toLocaleString()} lines. Continue?`,
        'Yes',
        'No'
      )
      if (proceed !== 'Yes') {
        statusBarManager.update('idle')
        return
      }
    }

    const MAX_CLIPBOARD_SIZE = 50 * 1024 * 1024
    if (finalContent.length > MAX_CLIPBOARD_SIZE) {
      const answer = await vscode.window.showErrorMessage(
        `Output is ${(finalContent.length / 1024 / 1024).toFixed(1)}MB - too large. Save to file?`,
        'Save to File',
        'Cancel'
      )
      if (answer === 'Save to File') {
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file('codebridge-output.md'),
          filters: { Markdown: ['md'], Text: ['txt'] },
        })
        if (saveUri) {
          await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(finalContent))
          vscode.window.showInformationMessage(`Saved to ${saveUri.fsPath}`)
        }
      }
      statusBarManager.update('idle')
      return
    }

    await vscode.env.clipboard.writeText(finalContent)

    if (!config.disableSuccessNotifications) {
      const sizeMB =
        sizeBytes > 1024 * 1024 ? `${(sizeBytes / 1024 / 1024).toFixed(2)}MB` : `${(sizeBytes / 1024).toFixed(1)}KB`

      let fileCountMsg = `${sortedUris.length} files`
      if (totalAnalysisAdded > 0) {
        fileCountMsg = `${sortedUris.length} files (${totalAnalysisAdded} auto-added)`
      }

      statusBarManager.update(
        'success',
        `Copied ${fileCountMsg} | ${finalLineCount.toLocaleString()} lines | ${sizeMB}`,
        4000
      )
    } else {
      statusBarManager.update('idle')
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to copy contents.`)
    logger.error('Failed during copyAllContents', error)
    statusBarManager.update('error', 'Copy failed', 4000)
  }
}

export async function selectPrompt(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('codeBridge')
  const inspection = config.inspect<Record<string, string>>('prompt.custom')
  const workspacePrompts = inspection?.workspaceValue
  const userPrompts = inspection?.globalValue
  const defaultPrompts = inspection?.defaultValue || {}
  let finalPrompts: Record<string, string>

  if (workspacePrompts !== undefined) finalPrompts = workspacePrompts
  else if (userPrompts !== undefined) finalPrompts = userPrompts
  else finalPrompts = defaultPrompts

  const items = Object.entries(finalPrompts).map(([key, value]) => ({
    label: key,
    detail: value,
    prompt: value,
  }))

  items.push({
    label: 'Custom Input',
    detail: 'Type a custom prompt',
    prompt: '',
  })

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a prompt template for CodeBridge',
  })

  if (!selected) return undefined

  if (selected.label === 'Custom Input') {
    return await vscode.window.showInputBox({
      prompt: 'Enter your AI prompt',
      placeHolder: 'e.g., Review this code for bugs',
    })
  }
  return selected.prompt
}
