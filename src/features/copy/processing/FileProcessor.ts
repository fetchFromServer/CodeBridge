import * as vscode from 'vscode'
import { DynamicConfig } from '../../../core/config'
import { Logger, getFileExtension, posixPath } from '../../../core/utils'
import { ContextManager } from '../../analysis/index'
import { collectDiagnostics } from '../../diagnostics/index'
import { calculateDynamicMetrics } from '../../metrics/calculator'
import { MetadataBag } from '../../metrics/types'

const SAFETY_MAX_FILE_SIZE = 100 * 1024 * 1024

export interface FileContent {
  path: string
  content: string
  size: number
  extension: string
  metadata: MetadataBag
  lastModified?: string
  diagnostics?: string
  impact?: string
}

export class FileProcessor {
  private cache = new Map<string, FileContent | null>()

  constructor(
    private config: DynamicConfig,
    private logger: Logger,
  ) {}

  public async processBatch(
    uris: vscode.Uri[],
    onProgress: (m: string) => void,
  ): Promise<FileContent[]> {
    const results: FileContent[] = []
    const chunkSize = 8

    for (let i = 0; i < uris.length; i += chunkSize) {
      const chunk = uris.slice(i, i + chunkSize)
      const settled = await Promise.allSettled(chunk.map((u) => this.processFile(u)))

      for (const res of settled) {
        if (res.status === 'fulfilled' && res.value) results.push(res.value)
      }
      onProgress(`Processing ${Math.min(i + chunkSize, uris.length)}/${uris.length}...`)
    }
    return results
  }

  private async processFile(uri: vscode.Uri): Promise<FileContent | null> {
    const key = uri.toString()
    if (this.cache.has(key)) return this.cache.get(key)!

    try {
      if (!vscode.workspace.isTrusted) return null

      let content = '',
        size = 0,
        mtime = ''

      if (uri.scheme === 'file' || uri.scheme === 'vscode-vfs' || uri.scheme === 'vscode-remote') {
        let stat: vscode.FileStat
        try {
          stat = await vscode.workspace.fs.stat(uri)
        } catch {
          return null
        }
        size = stat.size
        mtime = new Date(stat.mtime).toISOString()

        const max = this.config.limits?.maxFileSize ?? 0
        if (max > 0 && size > max) return null
        if (size > SAFETY_MAX_FILE_SIZE) return null

        const bytes = await vscode.workspace.fs.readFile(uri)
        const ext = getFileExtension(uri.path).toLowerCase()
        if (this.isBinary(bytes, ext)) return null
        content = new TextDecoder('utf-8').decode(bytes)
      } else {
        const doc = await vscode.workspace.openTextDocument(uri)
        content = doc.getText()
        size = content.length
      }

      const transform = this.config.transform || {}

      if (transform.trimWhitespace) {
        content = content
          .split('\n')
          .map((l: string) => l.trimStart())
          .join('\n')
      }

      let relPath = vscode.workspace.asRelativePath(uri, false)
      if (relPath === uri.fsPath) relPath = posixPath.basename(uri.path)
      relPath = relPath.replace(/\\/g, '/')

      const metaConfig = this.config.metadata || {}

      const needDiagnostics =
        this.config.forceDiagnostics || metaConfig.issuesSummary || transform.embedIssues

      let diags = ''
      if (needDiagnostics) {
        try {
          diags = await collectDiagnostics(uri, this.config.embedStyle || 'compact')
        } catch {}
      }

      const metrics = calculateDynamicMetrics(content, diags)

      const analysisConfig = this.config.analysis || {}

      const impact = await ContextManager.getFileMetadata(
        uri,
        analysisConfig.strategy,
        Boolean(metaConfig.stats),
      )

      const embed = this.config.forceDiagnostics || transform.embedIssues

      const result: FileContent = {
        path: relPath,
        content,
        size,
        extension: getFileExtension(relPath),
        metadata: metrics,
        lastModified: mtime,
        diagnostics: embed ? diags : undefined,
        impact,
      }

      this.cache.set(key, result)
      return result
    } catch (e) {
      this.logger.error(`Failed processing ${uri.fsPath}`, e)
      return null
    }
  }

  private isBinary(bytes: Uint8Array, ext: string): boolean {
    const list = this.config.binaryExtensions || []
    const set = new Set(list.map((e: string) => e.toLowerCase()))
    if (set.has(ext)) return true
    try {
      const len = Math.min(bytes.length, 512)
      for (let i = 0; i < len; i++) if (bytes[i] === 0) return true
      return false
    } catch {
      return true
    }
  }
}
