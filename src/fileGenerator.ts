import * as path from "path"
import * as vscode from "vscode"

interface GeneratorConfig {
    createDirectories: boolean
    overwriteExisting: boolean
    defaultExtension: string
    pathCommentPrefixes: string[]
    intelligentNaming: boolean
}

interface FileData {
    filePath: string
    content: string
}

type OverwritePolicy = {
    value: "ask" | "overwrite" | "skip"
}

/**
 * Retrieves the user-defined or default configuration for the file generator.
 * @returns A configuration object for the generator.
 */
function getGeneratorConfig(): GeneratorConfig {
    const config = vscode.workspace.getConfiguration("codeBridge")
    return {
        createDirectories: config.get("generator.createDirectories", true),
        overwriteExisting: config.get("generator.overwriteExisting", false),
        defaultExtension: config.get("generator.defaultExtension", "txt"),
        pathCommentPrefixes: config.get("generator.pathCommentPrefixes", [
            "//",
            "#",
            "--",
            "/*",
            "*",
            "<!--",
            "%",
            "'",
        ]),
        intelligentNaming: config.get("generator.intelligentNaming", true),
    }
}

/**
 * Parses the raw text output from an LLM to extract file data.
 * @param llmOutput The raw string from the clipboard.
 * @param config The current generator configuration.
 * @returns An array of objects, each representing a file to be created.
 */
function parseLlmOutput(
    llmOutput: string,
    config: GeneratorConfig,
): FileData[] {
    const files: FileData[] = []
    const usedNames = new Set<string>()
    const processedContent = new Set<string>()

    const allCodeBlocks: Array<{
        index: number
        end: number
        lang: string
        content: string
    }> = []
    const codeBlockRegex = /```(?:(\w+))?\s*\n([\s\S]*?)```/g

    for (const match of llmOutput.matchAll(codeBlockRegex)) {
        if (match.index === undefined) continue
        const lang = match[1] || config.defaultExtension
        const content = match[2].trim()
        if (!content) continue
        allCodeBlocks.push({
            index: match.index,
            end: match.index + match[0].length,
            lang,
            content,
        })
    }

    for (let i = 0; i < allCodeBlocks.length; i++) {
        const block = allCodeBlocks[i]
        if (processedContent.has(block.content)) continue

        let filePath: string | null = null
        const prevBlockEnd = i > 0 ? allCodeBlocks[i - 1].end : 0
        const context = llmOutput.substring(prevBlockEnd, block.index)

        const headerMatch = context.match(/(?:^|\n)##\s+([^\n]+)/m)
        if (headerMatch && headerMatch[1]) {
            const pathMatch = headerMatch[1]
                .trim()
                .match(/([\w\-.\\/]+\.[\w]+)/)
            if (pathMatch) filePath = pathMatch[1]
        }

        if (!filePath) {
            const firstLine = block.content.split("\n")[0]
            const prefixes = config.pathCommentPrefixes
                .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .join("|")
            const commentMatch = firstLine.match(
                new RegExp(`^(?:${prefixes})\\s*([\\w\\-.\\\\/]+\\.[\\w]+)`),
            )
            if (commentMatch && commentMatch[1]) {
                filePath = commentMatch[1]
                block.content = block.content
                    .substring(block.content.indexOf("\n") + 1)
                    .trim()
            }
        }

        if (!filePath) {
            let tempName = `temp_file_${i + 1}`
            if (config.intelligentNaming) {
                const patterns = [
                    /(?:export\s+)?(?:default\s+)?(?:class|interface|function|const|let|var)\s+(\w+)/,
                    /(?:def|class)\s+(\w+)/,
                ]
                for (const pattern of patterns) {
                    const nameMatch = block.content.match(pattern)
                    if (nameMatch && nameMatch[1]) {
                        tempName = nameMatch[1].toLowerCase()
                        break
                    }
                }
            }
            filePath = `${tempName}.${block.lang}`
        }

        let finalName = filePath
        let counter = 1
        while (usedNames.has(finalName)) {
            const ext = path.extname(filePath)
            const base = path.basename(filePath, ext)
            finalName = `${base}_${counter}${ext}`
            counter++
        }

        files.push({ filePath: finalName, content: block.content })
        usedNames.add(finalName)
        processedContent.add(block.content)
    }
    return files
}

/**
 * Creates a single file on disk, handling directory creation and overwrite logic.
 * @param fileData The file path and content.
 * @param baseDirUri The base directory where the file should be created.
 * @param config The current generator configuration.
 * @param overwritePolicy A mutable object that tracks the user's overwrite decision for the current operation.
 * @returns A promise that resolves to "created", "skipped", or "error".
 */
async function createFile(
    fileData: FileData,
    baseDirUri: vscode.Uri,
    config: GeneratorConfig,
    overwritePolicy: OverwritePolicy,
): Promise<"created" | "skipped" | "error"> {
    const cleanPath = fileData.filePath.replace(/\\/g, "/")
    const fileUri = vscode.Uri.joinPath(baseDirUri, cleanPath)

    try {
        const fileExists = await vscode.workspace.fs.stat(fileUri).then(
            () => true,
            () => false,
        )

        if (fileExists) {
            if (
                overwritePolicy.value === "skip" ||
                (overwritePolicy.value === "ask" && !config.overwriteExisting)
            ) {
                const answer = await vscode.window.showWarningMessage(
                    `File exists: ${cleanPath}`,
                    { modal: true },
                    "Overwrite",
                    "Skip",
                    "Overwrite All",
                    "Skip All",
                )
                if (answer === "Skip") return "skipped"
                if (answer === "Skip All") {
                    overwritePolicy.value = "skip"
                    return "skipped"
                }
                if (answer === "Overwrite All") {
                    overwritePolicy.value = "overwrite"
                }
                if (!answer) return "skipped"
            }
        }

        if (config.createDirectories) {
            const dirUri = vscode.Uri.joinPath(fileUri, "..")
            await vscode.workspace.fs.createDirectory(dirUri)
        }

        await vscode.workspace.fs.writeFile(
            fileUri,
            Buffer.from(fileData.content, "utf8"),
        )
        return "created"
    } catch (e) {
        console.error(`Failed to create ${cleanPath}:`, e)
        return "error"
    }
}

/**
 * Main command function to parse clipboard content and generate files.
 * @param llmOutput The raw string from the clipboard.
 * @param targetDirectoryUri The directory where files should be generated.
 */
export async function generateFilesFromLlmOutput(
    llmOutput: string,
    targetDirectoryUri: vscode.Uri,
) {
    const config = getGeneratorConfig()
    const files = parseLlmOutput(llmOutput, config)

    if (!files.length) {
        vscode.window.showWarningMessage("No code blocks found in clipboard.")
        return
    }

    let preview = `Found ${files.length} file(s) to generate:\n\n`
    const filesByDir = files.reduce((acc, file) => {
        const dir = path.dirname(file.filePath)
        if (!acc[dir]) acc[dir] = []
        acc[dir].push(path.basename(file.filePath))
        return acc
    }, {} as Record<string, string[]>)

    for (const [dir, fileNames] of Object.entries(filesByDir)) {
        preview += `📁 ${dir === "." ? "root" : dir}/\n`
        for (const fileName of fileNames.slice(0, 5)) {
            preview += `  📄 ${fileName}\n`
        }
        if (fileNames.length > 5) {
            preview += `  ... and ${fileNames.length - 5} more\n`
        }
    }

    const result = await vscode.window.showInformationMessage(
        preview,
        { modal: true },
        "Generate All",
    )
    if (result !== "Generate All") return

    const results = { created: 0, skipped: 0, errors: 0 }
    const errorMessages: string[] = []
    const overwritePolicy: OverwritePolicy = { value: "ask" }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "CodeBridge: Generating files...",
            cancellable: true,
        },
        async (progress, token) => {
            for (let i = 0; i < files.length; i++) {
                if (token.isCancellationRequested) break
                const file = files[i]
                progress.report({
                    increment: 100 / files.length,
                    message: `(${i + 1}/${files.length}) ${file.filePath}`,
                })
                const status = await createFile(
                    file,
                    targetDirectoryUri,
                    config,
                    overwritePolicy,
                )
                if (status === "created") results.created++
                else if (status === "skipped") results.skipped++
                else {
                    results.errors++
                    errorMessages.push(file.filePath)
                }
            }
        },
    )

    if (results.created > 0) {
        await vscode.commands.executeCommand(
            "workbench.files.action.refreshFilesExplorer",
        )
    }

    const parts = []
    if (results.created > 0) parts.push(`✅ ${results.created} created`)
    if (results.skipped > 0) parts.push(`⏭️ ${results.skipped} skipped`)
    if (results.errors > 0) parts.push(`❌ ${results.errors} failed`)
    const message = parts.join(" | ")

    if (results.errors > 0) {
        vscode.window.showErrorMessage(
            `${message}\n\nFailed files:\n${errorMessages.join("\n")}`,
        )
    } else if (results.created > 0 || results.skipped > 0) {
        vscode.window.showInformationMessage(message)
    }
}
