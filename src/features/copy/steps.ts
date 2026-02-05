import * as vscode from 'vscode'
import { DynamicConfig } from '../../core/config'
import { collectFileUrisByFs, StatusBarManager } from '../../core/utils'
import { IWorkflowStep, WorkflowContext } from '../../core/workflow'
import { ContextManager } from '../analysis/index'
import { FileContent, FileProcessor } from './processing/FileProcessor'
import { OutputFormatter } from './processing/OutputFormatter'

export interface CopyWorkflowContext extends WorkflowContext<DynamicConfig> {
  initialUris: vscode.Uri[]
  statusBar: StatusBarManager
  userPrompt?: string
  expandedUris: vscode.Uri[]
  processedFiles: FileContent[]
  finalOutput: string
}

export class ContextExpansionStep implements IWorkflowStep<CopyWorkflowContext> {
  name = 'Expand Context'
  async execute(ctx: CopyWorkflowContext) {
    if (ctx.initialUris.length === 0) return

    const analysisConfig = ctx.config.analysis || {}
    const autoCopy = analysisConfig.autoExpand ?? false
    const strategy = analysisConfig.strategy || 'shallow'
    const enabled = strategy !== 'none'

    if (!enabled && !autoCopy) {
      ctx.expandedUris = [...ctx.initialUris]
      return
    }

    ctx.statusBar.update('working', 'Analyzing context...')

    const rawMax = analysisConfig.maxFiles ?? 5
    const effectiveMax = rawMax === 0 ? Number.MAX_SAFE_INTEGER : rawMax

    const opts = {
      enabled: autoCopy,
      strategy: strategy,
      maxFiles: effectiveMax,
      excludePatterns: ctx.config.excludePatterns || [],
    }

    const expansion = await ContextManager.expandContext(ctx.initialUris, opts, (msg) =>
      ctx.statusBar.update('working', msg),
    )

    const seen = new Set<string>()
    const targets: vscode.Uri[] = []

    const candidates = Array.from(expansion.uris).map((u) => vscode.Uri.parse(u))

    for (const uri of candidates) {
      try {
        const stat = await vscode.workspace.fs.stat(uri)
        if (stat.type === vscode.FileType.Directory) {
          const children = await collectFileUrisByFs(uri, {
            includeHidden: true,
            excludePatterns: ctx.config.excludePatterns || [],
          })
          for (const c of children) {
            if (!seen.has(c.toString())) {
              seen.add(c.toString())
              targets.push(c)
            }
          }
        } else {
          if (!seen.has(uri.toString())) {
            seen.add(uri.toString())
            targets.push(uri)
          }
        }
      } catch {}
    }
    ctx.expandedUris = targets
  }
}

export class FileProcessingStep implements IWorkflowStep<CopyWorkflowContext> {
  name = 'Process Files'
  async execute(ctx: CopyWorkflowContext) {
    if (ctx.expandedUris.length === 0) return

    const processor = new FileProcessor(ctx.config, ctx.logger)
    ctx.processedFiles = await processor.processBatch(ctx.expandedUris, (msg) =>
      ctx.statusBar.update('working', msg),
    )
  }
}

export class OutputGenerationStep implements IWorkflowStep<CopyWorkflowContext> {
  name = 'Generate Output'
  async execute(ctx: CopyWorkflowContext) {
    if (ctx.processedFiles.length === 0) return

    const meta: Record<string, string> = {}
    const metaConfig = ctx.config.metadata || {}

    if (metaConfig.gitContext) {
      meta['Project'] = vscode.workspace.name || 'Untitled'
    }
    if (metaConfig.systemInfo) {
      meta['Environment'] = 'VS Code'
    }

    ctx.finalOutput = OutputFormatter.format(ctx.processedFiles, ctx.config, ctx.userPrompt, meta)
  }
}
