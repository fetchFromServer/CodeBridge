import * as vscode from 'vscode'
import { ConfigEngine, DynamicConfig } from '../../core/config'
import { Logger, StatusBarManager } from '../../core/utils'
import { WorkflowEngine } from '../../core/workflow'
import { AnalysisStrategy } from '../analysis'

import { aggregateMetadata } from '../metrics'
import {
  ContextExpansionStep,
  CopyWorkflowContext,
  FileProcessingStep,
  OutputGenerationStep,
} from './steps'

export async function selectPrompt(): Promise<string | undefined> {
  const config = ConfigEngine.get('global')
  const custom = config.prompts || {}

  const items: vscode.QuickPickItem[] = Object.entries(custom).map(([k, v]) => ({
    label: k,
    detail: v as string,
    description: 'Template',
  }))
  items.push({
    label: 'Custom Input',
    detail: 'Type a custom instruction',
    iconPath: new vscode.ThemeIcon('edit'),
  })

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select instruction',
    title: 'Copy with Instruction',
  })

  if (!selected) return undefined
  if (selected.label === 'Custom Input') {
    const input = await vscode.window.showInputBox({
      title: 'Custom Instruction',
      placeHolder: 'e.g. Refactor this...',
    })
    if (!input) return undefined

    const nameInput = await vscode.window.showInputBox({
      title: 'Save Prompt As',
      placeHolder: 'e.g. Refactor (Strict)',
      value: 'Custom Prompt',
    })

    const baseName = (nameInput || 'Custom Prompt').trim() || 'Custom Prompt'
    const configRoot = vscode.workspace.getConfiguration('codeBridge')
    const existing = configRoot.get<Record<string, string>>('general.prompts', {})
    const next = { ...existing }

    let finalName = baseName
    let counter = 2
    while (next[finalName]) {
      finalName = `${baseName} ${counter}`
      counter++
    }

    next[finalName] = input
    await configRoot.update('general.prompts', next, vscode.ConfigurationTarget.Global)

    return input
  }
  return (selected as any).detail
}

export async function copyAllContents(
  clickedUri: vscode.Uri | undefined,
  selectedUris: vscode.Uri[] | undefined,
  logger: Logger,
  statusBar: StatusBarManager,
  prompt?: string,
  forceDiagnostics: boolean = false,
  analysisStrategy: AnalysisStrategy = 'shallow',
  expansionMode: 'off' | 'config' | 'force' = 'off',
) {
  const overrides: DynamicConfig = {
    forceDiagnostics,
    analysis: {
      strategy: analysisStrategy,
      autoExpand: expansionMode === 'force' ? true : expansionMode === 'off' ? false : undefined,
    },
  }

  const config = ConfigEngine.get('copy', overrides)

  const roots = selectedUris?.length ? selectedUris : clickedUri ? [clickedUri] : []
  if (!roots.length && vscode.window.activeTextEditor) {
    roots.push(vscode.window.activeTextEditor.document.uri)
  }
  if (!roots.length) {
    vscode.window.showWarningMessage('No selection found.')
    return
  }

  const engine = new WorkflowEngine<CopyWorkflowContext>(logger)

  engine
    .addParallel('Prepare', new ContextExpansionStep())
    .addStep(new FileProcessingStep())
    .addStep(new OutputGenerationStep())

  const context: CopyWorkflowContext = {
    config: config,
    logger: logger,
    state: {},
    initialUris: roots,
    statusBar: statusBar,
    userPrompt: prompt,
    expandedUris: [],
    processedFiles: [],
    finalOutput: '',
  }

  try {
    await engine.run(context)

    if (!context.finalOutput) {
      if (context.processedFiles.length === 0)
        vscode.window.showInformationMessage('No readable files found.')
      statusBar.update('idle')
      return
    }

    const limit = config.limits.clipboardThreshold
    if (limit > 0) {
      const bytes = new TextEncoder().encode(context.finalOutput).length
      if (bytes > limit) {
        const mb = (bytes / 1024 / 1024).toFixed(1)
        const choice = await vscode.window.showWarningMessage(
          `Result is ${mb}MB. Copy?`,
          'Copy Anyway',
          'Save to File',
          'Cancel',
        )
        if (choice === 'Save to File') {
          const dest = await vscode.window.showSaveDialog({ filters: { Markdown: ['md'] } })
          if (dest)
            await vscode.workspace.fs.writeFile(dest, new TextEncoder().encode(context.finalOutput))
          statusBar.update('idle')
          return
        }
        if (choice !== 'Copy Anyway') {
          statusBar.update('idle')
          return
        }
      }
    }

    await vscode.env.clipboard.writeText(context.finalOutput)

    if (config.showSuccessNotifications) {
      const stats = aggregateMetadata(context.processedFiles)
      const lines = (stats.values.lines || 0).toLocaleString()

      statusBar.update(
        'success',
        `Copied ${context.processedFiles.length} files (${lines} lines)`,
        4000,
      )
    } else {
      statusBar.update('idle')
    }
  } catch (e) {
    logger.error('Copy Workflow Failed', e)
    if (config.showErrorNotifications) statusBar.update('error', 'Failed')
    else statusBar.update('idle')
  }
}
