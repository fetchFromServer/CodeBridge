import * as vscode from 'vscode'
import { ConfigEngine } from '../../core/config'
import { Logger, StatusBarManager } from '../../core/utils'
import { parseLlmOutput } from './parser'
import { OverwritePolicy } from './types'
import { createFile } from './writer'

type GeneratorMode = 'ask' | 'overwrite' | 'skip'

export async function generateFilesFromLlmOutput(
  output: string,
  targetUri: vscode.Uri,
  logger: Logger,
  statusBar: StatusBarManager,
) {
  const configData = ConfigEngine.get('generator')

  const conflictStrategy = (configData.conflictStrategy || 'ask') as GeneratorMode

  const config = {
    overwriteExisting: conflictStrategy === 'overwrite',
    confirmBeforeWrite: conflictStrategy === 'ask',
    filenameWhitelist: configData.filenameWhitelist || [],
  }

  const parsed = parseLlmOutput(output, {
    filenameWhitelist: configData.filenameWhitelist,
    pathDetection: configData.pathDetection,
    pathMarkers: configData.pathMarkers,
  })

  if (!parsed.length) {
    vscode.window.showWarningMessage('No blocks found.')
    return
  }

  let filesToCreate = parsed
  if (config.confirmBeforeWrite) {
    const selected = await vscode.window.showQuickPick(
      parsed.map((f) => ({ label: f.filePath, picked: true, fileData: f })),
      { canPickMany: true },
    )
    if (!selected?.length) return
    filesToCreate = selected.map((s) => s.fileData)
  }

  const results = { created: 0, skipped: 0, errors: 0 }
  const policy: OverwritePolicy = { value: conflictStrategy }

  statusBar.update('working', `Generating ${filesToCreate.length} files...`)

  for (const f of filesToCreate) {
    const status = await createFile(f, targetUri, config, policy, logger)
    if (status === 'created') results.created++
    else if (status === 'skipped') results.skipped++
    else results.errors++
  }
  if (results.errors > 0) {
    if (configData.showErrorNotifications) {
      statusBar.update('error', `Created ${results.created} files`, 4000)
    } else {
      statusBar.update('idle')
    }
  } else {
    if (configData.showSuccessNotifications) {
      statusBar.update('success', `Created ${results.created} files`, 4000)
    } else {
      statusBar.update('idle')
    }
  }
}
