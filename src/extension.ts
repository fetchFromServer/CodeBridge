import * as vscode from "vscode"
import { copyAllContents, selectPrompt } from "./features/copyContents"
import { generateFilesFromLlmOutput } from "./features/fileGenerator"
import { copyProjectTree } from "./features/projectTree"
import { Logger, StatusBarManager } from "./utils"

/**
 * Wraps the vscode.commands.registerCommand function to include a configuration check.
 * The command will only execute if the corresponding configuration key is enabled.
 * @param commandId The ID of the command to register.
 * @param configKey The key in 'codeBridge.commands' configuration to check.
 * @param callback The function to execute when the command is triggered.
 * @param disabledMessage The message to show if the command is disabled.
 * @returns A disposable that can be used to unregister the command.
 */
function registerCommandWithConfigCheck(
    commandId: string,
    configKey: string,
    callback: (...args: any[]) => any,
    disabledMessage: string,
): vscode.Disposable {
    return vscode.commands.registerCommand(commandId, (...args: any[]) => {
        const config = vscode.workspace.getConfiguration("codeBridge.commands")
        if (!config.get(configKey, true)) {
            vscode.window.showWarningMessage(disabledMessage)
            return
        }
        return callback(...args)
    })
}

/**
 * This function is called when the extension is activated.
 * It sets up all the commands, configuration watchers, and UI elements.
 * @param context The extension context provided by VS Code.
 */
export function activate(context: vscode.ExtensionContext) {
    const logger = Logger.getInstance()
    const statusBarManager = StatusBarManager.getInstance()
    logger.log("CodeBridge extension activated.")

    /**
     * Updates the visibility of commands in the UI based on the user's settings.
     * This is controlled by 'when' clauses in package.json that read these contexts.
     */
    const updateContextKeys = () => {
        const config = vscode.workspace.getConfiguration("codeBridge.commands")
        const setContext = vscode.commands.executeCommand
        setContext(
            "codeBridge.copyContentsEnabled",
            config.get("enableCopyContents", true),
        )
        setContext(
            "codeBridge.copyWithPromptEnabled",
            config.get("enableCopyWithPrompt", true),
        )
        setContext(
            "codeBridge.generateFilesEnabled",
            config.get("enableGenerateFiles", true),
        )
        setContext(
            "codeBridge.projectTreeEnabled",
            config.get("enableProjectTree", true),
        )

        if (config.get("enableCopyWithPrompt", true)) {
            statusBarManager.show()
        } else {
            statusBarManager.hide()
        }
    }

    updateContextKeys()

    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("codeBridge.commands")) {
            updateContextKeys()
            logger.log("CodeBridge command visibility settings updated.")
        }
    })

    const copyContentsCommand = registerCommandWithConfigCheck(
        "extension.copyAllContents",
        "enableCopyContents",
        (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) =>
            copyAllContents(clickedUri, selectedUris, logger, statusBarManager),
        "Copy File Contents command is disabled. Enable it in settings.",
    )

    const copyWithPromptCommand = registerCommandWithConfigCheck(
        "extension.copyWithPrompt",
        "enableCopyWithPrompt",
        async (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
            const prompt = await selectPrompt()
            if (prompt === undefined) return
            await copyAllContents(
                clickedUri,
                selectedUris,
                logger,
                statusBarManager,
                prompt,
            )
        },
        "Copy with Prompt command is disabled. Enable it in settings.",
    )

    const generateFromClipboardCommand = registerCommandWithConfigCheck(
        "extension.generateFromClipboard",
        "enableGenerateFiles",
        async (targetDirectoryUri?: vscode.Uri) => {
            let targetUri = targetDirectoryUri
            if (!targetUri) {
                if (vscode.workspace.workspaceFolders?.length) {
                    targetUri = vscode.workspace.workspaceFolders[0].uri
                } else {
                    vscode.window.showErrorMessage("No target folder found.")
                    return
                }
            }
            const clipboardContent = await vscode.env.clipboard.readText()
            if (!clipboardContent.trim()) {
                vscode.window.showWarningMessage("Clipboard is empty.")
                return
            }
            await generateFilesFromLlmOutput(
                clipboardContent,
                targetUri,
                logger,
                statusBarManager,
            )
        },
        "Generate Files command is disabled. Enable it in settings.",
    )

    const projectTreeCommand = registerCommandWithConfigCheck(
        "extension.copyProjectTree",
        "enableProjectTree",
        (uri?: vscode.Uri) => copyProjectTree(uri, logger, statusBarManager),
        "Copy Project Tree command is disabled. Enable it in settings.",
    )

    context.subscriptions.push(
        copyContentsCommand,
        copyWithPromptCommand,
        generateFromClipboardCommand,
        projectTreeCommand,
        statusBarManager,
        configWatcher,
    )
}

/**
 * This function is called when the extension is deactivated.
 * It's used for cleanup, such as disposing of the status bar item.
 */
export function deactivate() {
    const logger = Logger.getInstance()
    StatusBarManager.getInstance().dispose()
    logger.log("CodeBridge extension deactivated.")
}
