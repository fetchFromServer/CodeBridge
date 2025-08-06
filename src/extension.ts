import * as vscode from "vscode"
import { copyAllContents } from "./copyContents"
import { generateFilesFromLlmOutput } from "./fileGenerator"
import { selectPrompt } from "./promptManager"

/**
 * This method is called when the extension is activated.
 * It registers all commands and sets up the status bar item.
 * @param context The extension context provided by VS Code.
 */
export function activate(context: vscode.ExtensionContext) {
    const copyContentsCommand = vscode.commands.registerCommand(
        "extension.copyAllContents",
        (clickedUri: vscode.Uri, selectedUris: vscode.Uri[]) => {
            copyAllContents(clickedUri, selectedUris)
        },
    )

    const copyWithPromptCommand = vscode.commands.registerCommand(
        "extension.copyWithPrompt",
        async (clickedUri: vscode.Uri, selectedUris: vscode.Uri[]) => {
            const prompt = await selectPrompt()
            if (prompt === undefined) return
            copyAllContents(clickedUri, selectedUris, prompt)
        },
    )

    const generateFromClipboardCommand = vscode.commands.registerCommand(
        "extension.generateFromClipboard",
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

            await generateFilesFromLlmOutput(clipboardContent, targetUri)
        },
    )

    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100,
    )
    statusBar.command = "extension.copyWithPrompt"
    statusBar.text = "$(beaker) CodeBridge"
    statusBar.tooltip = "CodeBridge: Copy code with AI prompt"
    statusBar.show()

    context.subscriptions.push(
        copyContentsCommand,
        copyWithPromptCommand,
        generateFromClipboardCommand,
        statusBar,
    )
}

/**
 * This method is called when the extension is deactivated.
 */
export function deactivate() {}
