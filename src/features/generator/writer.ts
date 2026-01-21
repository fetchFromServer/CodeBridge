import * as vscode from 'vscode'
import { Logger } from '../../core/utils'
import { FileData, GeneratorConfig, OverwritePolicy } from './types'

async function ensureDirectoryExists(uri: vscode.Uri, logger: Logger): Promise<void> {
  try {
    await vscode.workspace.fs.createDirectory(uri)
  } catch (e) {
    logger.error(`Dir failed`, e)
  }
}

export async function createFile(
  fileData: FileData,
  baseUri: vscode.Uri,
  config: GeneratorConfig,
  policy: OverwritePolicy,
  logger: Logger,
): Promise<'created' | 'skipped' | 'error'> {
  const fileUri = vscode.Uri.joinPath(baseUri, fileData.filePath)
  try {
    try {
      await vscode.workspace.fs.stat(fileUri)
      if (policy.value === 'skip') return 'skipped'
      if (policy.value === 'ask' && !config.overwriteExisting) {
        const ans = await vscode.window.showWarningMessage(
          `File exists: ${fileData.filePath}`,
          { modal: true },
          'Overwrite',
          'Skip',
          'Overwrite All',
          'Skip All',
        )
        if (ans === 'Skip') return 'skipped'
        if (ans === 'Skip All') {
          policy.value = 'skip'
          return 'skipped'
        }
        if (ans === 'Overwrite All') policy.value = 'overwrite'
        if (!ans) return 'skipped'
      }
    } catch {}
    await ensureDirectoryExists(vscode.Uri.joinPath(fileUri, '..'), logger)
    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(fileData.content))
    return 'created'
  } catch {
    return 'error'
  }
}
