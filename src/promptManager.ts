import * as vscode from "vscode"

/**
 * Displays a quick pick menu for the user to select a predefined or custom prompt.
 * @returns A promise that resolves to the selected prompt string, or undefined if cancelled.
 */
export async function selectPrompt(): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration("codeBridge")
    const customPrompts = config.get<Record<string, string>>(
        "customPrompts",
        {},
    )

    const items = Object.entries(customPrompts).map(([key, value]) => ({
        label: key,
        detail: value,
        prompt: value,
    }))

    items.push({
        label: "Custom Input",
        detail: "Type a custom prompt",
        prompt: "",
    })

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a prompt template for CodeBridge",
    })

    if (!selected) return undefined

    if (selected.label === "Custom Input") {
        return await vscode.window.showInputBox({
            prompt: "Enter your AI prompt",
            placeHolder: "e.g., Review this code for bugs",
        })
    }

    return selected.prompt
}
