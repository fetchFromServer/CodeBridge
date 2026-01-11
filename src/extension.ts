import * as vscode from 'vscode'
import { copyAllContents, selectPrompt } from './features/copyContents'
import { generateFilesFromLlmOutput } from './features/fileGenerator'
import { copyProjectTree } from './features/projectTree'
import { Logger, StatusBarManager } from './utils'

interface EnabledFeatures {
  copyContents: boolean
  copyWithPrompt: boolean
  generateFiles: boolean
  projectTree: boolean
}

function registerCommandWithConfigCheck(
  commandId: string,
  featureKey: keyof EnabledFeatures,
  callback: (...args: any[]) => any,
  disabledMessage: string
): vscode.Disposable {
  return vscode.commands.registerCommand(commandId, (...args: any[]) => {
    const config = vscode.workspace.getConfiguration('codeBridge')
    const features = config.get<EnabledFeatures>('enabledFeatures', {
      copyContents: true,
      copyWithPrompt: true,
      generateFiles: true,
      projectTree: true,
    })

    if (!features[featureKey]) {
      vscode.window.showWarningMessage(disabledMessage)
      return
    }
    return callback(...args)
  })
}

export function activate(context: vscode.ExtensionContext) {
  const logger = Logger.getInstance()
  const statusBarManager = StatusBarManager.getInstance()
  logger.log('CodeBridge extension activated.')

  const updateContextKeys = () => {
    const config = vscode.workspace.getConfiguration('codeBridge')
    const features = config.get<EnabledFeatures>('enabledFeatures', {
      copyContents: true,
      copyWithPrompt: true,
      generateFiles: true,
      projectTree: true,
    })

    vscode.commands.executeCommand('setContext', 'codeBridge.copyContentsEnabled', features.copyContents)
    vscode.commands.executeCommand('setContext', 'codeBridge.copyWithPromptEnabled', features.copyWithPrompt)
    vscode.commands.executeCommand('setContext', 'codeBridge.generateFilesEnabled', features.generateFiles)
    vscode.commands.executeCommand('setContext', 'codeBridge.projectTreeEnabled', features.projectTree)

    if (features.copyWithPrompt) {
      statusBarManager.show()
    } else {
      statusBarManager.hide()
    }
  }

  updateContextKeys()

  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('codeBridge.enabledFeatures')) {
      updateContextKeys()
      logger.log('CodeBridge enabled features settings updated.')
    }
  })

  const copyContentsCommand = registerCommandWithConfigCheck(
    'extension.copyAllContents',
    'copyContents',
    (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) =>
      copyAllContents(clickedUri, selectedUris, logger, statusBarManager, undefined, false, 'shallow', 'off'),
    'Disabled in settings.'
  )

  const copyWithDiagnosticsCommand = registerCommandWithConfigCheck(
    'extension.copyWithDiagnostics',
    'copyContents',
    (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) =>
      copyAllContents(clickedUri, selectedUris, logger, statusBarManager, undefined, true, 'shallow', 'off'),
    'Disabled in settings.'
  )

  const copyWithPromptCommand = registerCommandWithConfigCheck(
    'extension.copyWithPrompt',
    'copyWithPrompt',
    async (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      const prompt = await selectPrompt()
      if (prompt === undefined) return

      await copyAllContents(clickedUri, selectedUris, logger, statusBarManager, prompt, false, 'shallow', 'config')
    },
    'Copy with Prompt command is disabled. Enable it in settings.'
  )

  const copyWithDeepAnalysisCommand = registerCommandWithConfigCheck(
    'extension.copyWithDeepAnalysis',
    'copyContents',
    async (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      await copyAllContents(clickedUri, selectedUris, logger, statusBarManager, undefined, false, 'deep', 'force')
    },
    'Disabled in settings.'
  )

  const generateFromClipboardCommand = registerCommandWithConfigCheck(
    'extension.generateFromClipboard',
    'generateFiles',
    async (targetDirectoryUri?: vscode.Uri) => {
      let targetUri = targetDirectoryUri
      if (!targetUri) {
        if (vscode.workspace.workspaceFolders?.length) {
          targetUri = vscode.workspace.workspaceFolders[0].uri
        } else {
          vscode.window.showErrorMessage('No target folder found.')
          return
        }
      }
      const clipboardContent = await vscode.env.clipboard.readText()
      if (!clipboardContent.trim()) {
        vscode.window.showWarningMessage('Clipboard is empty.')
        return
      }
      await generateFilesFromLlmOutput(clipboardContent, targetUri, logger, statusBarManager)
    },
    'Generate Files command is disabled. Enable it in settings.'
  )

  const projectTreeCommand = registerCommandWithConfigCheck(
    'extension.copyProjectTree',
    'projectTree',
    (uri?: vscode.Uri) => copyProjectTree(uri, logger, statusBarManager, {}),
    'Copy Project Tree command is disabled. Enable it in settings.'
  )

  const projectTreeFoldersCommand = registerCommandWithConfigCheck(
    'extension.copyProjectTreeFolders',
    'projectTree',
    (uri?: vscode.Uri) => copyProjectTree(uri, logger, statusBarManager, { directoriesOnly: true }),
    'Copy Project Tree command is disabled. Enable it in settings.'
  )

  const projectTreeShallowCommand = registerCommandWithConfigCheck(
    'extension.copyProjectTreeShallow',
    'projectTree',
    (uri?: vscode.Uri) => copyProjectTree(uri, logger, statusBarManager, { maxDepth: 1 }),
    'Copy Project Tree command is disabled. Enable it in settings.'
  )

  context.subscriptions.push(
    copyContentsCommand,
    copyWithDiagnosticsCommand,
    copyWithPromptCommand,
    copyWithDeepAnalysisCommand,
    generateFromClipboardCommand,
    projectTreeCommand,
    projectTreeFoldersCommand,
    projectTreeShallowCommand,
    statusBarManager,
    configWatcher
  )
}

export function deactivate() {
  const logger = Logger.getInstance()
  StatusBarManager.getInstance().dispose()
  logger.log('CodeBridge extension deactivated.')
}
