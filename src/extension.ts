import * as vscode from 'vscode'
import { collectFileUrisByFs, Logger, StatusBarManager } from './core/utils'
import { copyAllContents, selectPrompt } from './features/copy/index'
import { generateDiagnosticsReport } from './features/diagnostics/index'
import { generateFilesFromLlmOutput } from './features/generator'
import { copyProjectTree } from './features/tree'

interface CommandBinding {
  id: string
  action: 'copy' | 'diagnostics' | 'generate' | 'tree'
  params?: Record<string, any>
}

const COMMAND_REGISTRY: CommandBinding[] = [
  { id: 'extension.copyAllContents', action: 'copy', params: { mode: 'std' } },
  { id: 'extension.copyWithDiagnostics', action: 'copy', params: { diagnostics: true } },
  { id: 'extension.copyWithPrompt', action: 'copy', params: { prompt: true, expansion: 'config' } },
  { id: 'extension.copyDiagnosticsOnly', action: 'diagnostics' },
  { id: 'extension.generateFromClipboard', action: 'generate' },
  { id: 'extension.copyProjectTree', action: 'tree' },
  { id: 'extension.copyProjectTreeFolders', action: 'tree', params: { directoriesOnly: true } },
  { id: 'extension.copyProjectTreeMarkdown', action: 'tree', params: { style: 'markdown' } },
  { id: 'extension.copyProjectTreeModern', action: 'tree', params: { style: 'modern' } },
  { id: 'extension.copyProjectTreeClassic', action: 'tree', params: { style: 'classic' } },
  { id: 'extension.copyProjectTreeShallow', action: 'tree', params: { maxDepth: 1 } },
]

interface HandlerContext {
  logger: Logger
  statusBar: StatusBarManager
}

const ACTION_HANDLERS: Record<
  string,
  (
    uri: vscode.Uri | undefined,
    selected: vscode.Uri[] | undefined,
    ctx: HandlerContext,
    params: any,
  ) => Promise<void>
> = {
  copy: async (uri, selected, ctx, params) => {
    let prompt: string | undefined
    if (params?.prompt) {
      prompt = await selectPrompt()
      if (prompt === undefined) return
    }

    await copyAllContents(
      uri,
      selected,
      ctx.logger,
      ctx.statusBar,
      prompt,
      params?.diagnostics || false,
      params?.analysis || 'shallow',
      params?.expansion || 'off',
    )
  },

  diagnostics: async (uri, selected, ctx) => {
    const uris = await resolveUris(uri, selected)
    if (uris.length) {
      await generateDiagnosticsReport(uris, ctx.logger, ctx.statusBar)
    } else {
      vscode.window.showWarningMessage('No files found for diagnostics.')
    }
  },

  generate: async (uri, _, ctx) => {
    const clip = await vscode.env.clipboard.readText()
    const target = uri || vscode.workspace.workspaceFolders?.[0].uri

    if (!target) {
      vscode.window.showErrorMessage('No target workspace selected.')
      return
    }

    if (clip) {
      await generateFilesFromLlmOutput(clip, target, ctx.logger, ctx.statusBar)
    } else {
      vscode.window.showWarningMessage('Clipboard is empty.')
    }
  },

  tree: async (uri, _, ctx, params) => {
    await copyProjectTree(uri, ctx.logger, ctx.statusBar, params || {})
  },
}

export function activate(context: vscode.ExtensionContext) {
  const logger = Logger.getInstance()
  const statusBar = StatusBarManager.getInstance()
  const ctx = { logger, statusBar }

  logger.log('Context Tools activating via Generic Engine...')

  COMMAND_REGISTRY.forEach((binding) => {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        binding.id,
        async (uri?: vscode.Uri, selected?: vscode.Uri[]) => {
          const handler = ACTION_HANDLERS[binding.action]
          if (handler) {
            try {
              await handler(uri, selected, ctx, binding.params)
            } catch (e) {
              const message =
                e instanceof Error
                  ? e.message || `Command failed: ${binding.id}`
                  : typeof e === 'string'
                    ? e
                    : `Command failed: ${binding.id}`
              logger.error(`Command execution failed: ${binding.id}`, e)
              statusBar.update('error', message, 4000)
              vscode.window.showErrorMessage(message)
            }
          }
        },
      ),
    )
  })

  context.subscriptions.push(statusBar)
}

export function deactivate() {
  StatusBarManager.getInstance().dispose()
}

async function resolveUris(
  clicked: vscode.Uri | undefined,
  selected: vscode.Uri[] | undefined,
): Promise<vscode.Uri[]> {
  const roots = selected?.length
    ? selected
    : clicked
      ? [clicked]
      : vscode.window.activeTextEditor
        ? [vscode.window.activeTextEditor.document.uri]
        : []

  if (!roots.length) return []

  const finalUris: vscode.Uri[] = []

  for (const root of roots) {
    try {
      const stat = await vscode.workspace.fs.stat(root)
      if (stat.type === vscode.FileType.Directory) {
        const files = await collectFileUrisByFs(root, { includeHidden: true })
        finalUris.push(...files)
      } else {
        finalUris.push(root)
      }
    } catch {
      finalUris.push(root)
    }
  }
  return finalUris
}
