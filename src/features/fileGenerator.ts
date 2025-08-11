import * as vscode from "vscode"
import { Logger, StatusBarManager, getConfig, posixPath } from "../utils"

/**
 * Configuration settings for the file generator feature.
 */
interface GeneratorConfig {
    createDirectories: boolean
    overwriteExisting: boolean
    disableFileSelection: boolean
    defaultExtension: string
    pathCommentPrefixes: string[]
    disableSuccessNotifications: boolean
}

/**
 * Represents a file to be created, including its path and content.
 */
interface FileData {
    filePath: string
    content: string
}

/**
 * Defines the policy for handling existing files.
 */
type OverwritePolicy = {
    value: "ask" | "overwrite" | "skip"
}

/**
 * Parses the output from an LLM to extract file paths and code blocks.
 * @param llmOutput The raw string output from the language model.
 * @param config The generator configuration.
 * @returns An array of FileData objects.
 */
function parseLlmOutput(
    llmOutput: string,
    config: GeneratorConfig,
): FileData[] {
    const files: FileData[] = []
    const usedNames = new Set<string>()

    const allCodeBlocks: Array<{
        index: number
        end: number
        lang: string
        content: string
    }> = []
    const codeBlockRegex = /```(?:([^\s`]+))?\s*\n([\s\S]*?)```/g

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

    const cleanLine = (line: string): string => {
        const trimmed = line.trim()
        for (const prefix of config.pathCommentPrefixes) {
            if (trimmed.startsWith(prefix)) {
                return trimmed.slice(prefix.length).trim()
            }
        }
        return trimmed
    }

    const filePathRegex =
        /(?:^|[\s*#:/<_-])((?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.[a-zA-Z0-9_]+)/

    let lastBlockEnd = 0
    for (let i = 0; i < allCodeBlocks.length; i++) {
        const block = allCodeBlocks[i]
        let filePath: string | null = null
        let finalContent = block.content

        const lines = block.content.split(/\r?\n/)
        const firstLine = lines[0]?.trim()
        if (firstLine) {
            const cleanedFirstLine = cleanLine(firstLine)
            const match = cleanedFirstLine.match(filePathRegex)
            if (match && match[1]) {
                filePath = match[1]
                finalContent = lines.slice(1).join("\n").trim()
            }
        }

        if (!filePath) {
            const searchSpaceBefore = llmOutput.substring(
                lastBlockEnd,
                block.index,
            )
            const linesBefore = searchSpaceBefore.trim().split(/\r?\n/)
            for (let j = linesBefore.length - 1; j >= 0; j--) {
                const line = linesBefore[j].trim()
                if (!line) continue
                const cleanedLine = cleanLine(line)
                const match = cleanedLine.match(filePathRegex)
                if (match && match[1]) {
                    filePath = match[1]
                    break
                }
            }
        }

        if (!filePath) {
            const tempName = `temp_file_${i + 1}`
            filePath = `${tempName}.${block.lang}`
        }

        let finalName = filePath.replace(/\\/g, "/")
        let counter = 1
        while (usedNames.has(finalName)) {
            const dir = posixPath.dirname(finalName)
            const ext = posixPath.extname(finalName)
            const base = posixPath.basename(finalName, ext)
            const newBase = `${base}_${counter}`
            finalName =
                dir === "."
                    ? `${newBase}${ext}`
                    : posixPath.join(dir, `${newBase}${ext}`)
            counter++
        }

        files.push({ filePath: finalName, content: finalContent })
        usedNames.add(finalName)
        lastBlockEnd = block.end
    }
    return files
}

/**
 * Recursively ensures that a directory path exists, creating it if necessary.
 * @param directoryUri The URI of the directory to create.
 * @param logger The logger instance.
 */
async function ensureDirectoryExists(
    directoryUri: vscode.Uri,
    logger: Logger,
): Promise<void> {
    const parentUri = vscode.Uri.joinPath(directoryUri, "..")
    if (parentUri.path === directoryUri.path) {
        return
    }

    try {
        await vscode.workspace.fs.stat(parentUri)
    } catch (e) {
        await ensureDirectoryExists(parentUri, logger)
    }

    try {
        await vscode.workspace.fs.createDirectory(directoryUri)
    } catch (e) {
        try {
            const stat = await vscode.workspace.fs.stat(directoryUri)
            if (stat.type !== vscode.FileType.Directory) {
                const message = `Cannot create directory. A file with the same name exists: ${directoryUri.fsPath}`
                logger.error(message)
                throw new Error(message)
            }
        } catch (statError) {
            logger.error(
                `Failed to create or stat directory ${directoryUri.fsPath}`,
                e,
            )
            throw e
        }
    }
}

/**
 * Creates a single file on disk, handling overwrites and directory creation.
 * @param fileData The file's path and content.
 * @param baseDirUri The base directory where the file will be created.
 * @param config The generator configuration.
 * @param overwritePolicy The current policy for overwriting files.
 * @param logger The logger instance.
 * @returns A status string: "created", "skipped", or "error".
 */
async function createFile(
    fileData: FileData,
    baseDirUri: vscode.Uri,
    config: GeneratorConfig,
    overwritePolicy: OverwritePolicy,
    logger: Logger,
): Promise<"created" | "skipped" | "error"> {
    const normalized = posixPath.normalize(fileData.filePath)

    if (normalized.startsWith("..") || normalized.startsWith("/")) {
        logger.error(`Path traversal blocked: ${normalized}`)
        return "error"
    }

    const fileUri = vscode.Uri.joinPath(baseDirUri, normalized)

    try {
        try {
            await vscode.workspace.fs.stat(fileUri)
            if (overwritePolicy.value === "skip") {
                return "skipped"
            }
            if (overwritePolicy.value === "ask" && !config.overwriteExisting) {
                const answer = await vscode.window.showWarningMessage(
                    `File exists: ${normalized}`,
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
        } catch {}

        if (config.createDirectories) {
            const dirUri = vscode.Uri.joinPath(fileUri, "..")
            await ensureDirectoryExists(dirUri, logger)
        }

        await vscode.workspace.fs.writeFile(
            fileUri,
            new TextEncoder().encode(fileData.content),
        )
        logger.log(`File created successfully: ${fileUri.fsPath}`)
        return "created"
    } catch (e) {
        logger.error(`Failed to create file ${fileUri.fsPath}`, e)
        return "error"
    }
}

/**
 * Main command handler for generating files from LLM output in the clipboard.
 * @param llmOutput The string content from the clipboard.
 * @param targetDirectoryUri The directory where files should be created.
 * @param logger The logger instance.
 * @param statusBarManager The status bar manager instance.
 */
export async function generateFilesFromLlmOutput(
    llmOutput: string,
    targetDirectoryUri: vscode.Uri,
    logger: Logger,
    statusBarManager: StatusBarManager,
) {
    const config: GeneratorConfig = {
        createDirectories: getConfig(
            "codeBridge",
            "generator.createDirectories",
            true,
        ),
        overwriteExisting: getConfig(
            "codeBridge",
            "generator.overwriteExisting",
            false,
        ),
        disableFileSelection: getConfig(
            "codeBridge",
            "generator.disableFileSelection",
            false,
        ),
        defaultExtension: getConfig(
            "codeBridge",
            "generator.defaultExtension",
            "txt",
        ),
        pathCommentPrefixes: ["//", "#", "--", "/*", "*", "<!--", "%", "'"],
        disableSuccessNotifications: getConfig(
            "codeBridge",
            "notifications.disableSuccess",
            false,
        ),
    }
    const allParsedFiles = parseLlmOutput(llmOutput, config)

    if (!allParsedFiles.length) {
        vscode.window.showWarningMessage("No code blocks found in clipboard.")
        return
    }

    allParsedFiles.sort((a, b) => {
        const partsA = a.filePath.split("/")
        const partsB = b.filePath.split("/")
        const len = Math.min(partsA.length, partsB.length)

        for (let i = 0; i < len; i++) {
            const isLastA = i === partsA.length - 1
            const isLastB = i === partsB.length - 1

            if (isLastA && !isLastB) return 1
            if (!isLastA && isLastB) return -1

            const comp = partsA[i].localeCompare(partsB[i])
            if (comp !== 0) return comp
        }

        return partsA.length - partsB.length
    })

    let filesToCreate: FileData[] = []

    if (config.disableFileSelection) {
        filesToCreate = allParsedFiles
    } else {
        const quickPickItems = allParsedFiles.map(file => {
            const dir = posixPath.dirname(file.filePath)
            return {
                label: file.filePath,
                description:
                    dir === "." ? "Directory: (root)" : `Directory: ${dir}`,
                picked: true,
                fileData: file,
            }
        })

        const selectedItems = await vscode.window.showQuickPick(
            quickPickItems,
            {
                canPickMany: true,
                placeHolder: `Found ${allParsedFiles.length} files. Select which ones to generate.`,
                ignoreFocusOut: true,
            },
        )

        if (!selectedItems || selectedItems.length === 0) {
            vscode.window.showInformationMessage("File generation cancelled.")
            return
        }
        filesToCreate = selectedItems.map(item => item.fileData)
    }

    if (filesToCreate.length === 0) {
        vscode.window.showInformationMessage("No files selected to generate.")
        return
    }

    const results = { created: 0, skipped: 0, errors: 0 }
    const errorMessages: string[] = []
    const overwritePolicy: OverwritePolicy = { value: "ask" }

    try {
        statusBarManager.update(
            "working",
            `Generating ${filesToCreate.length} file(s)...`,
        )

        for (let i = 0; i < filesToCreate.length; i++) {
            const file = filesToCreate[i]
            statusBarManager.update(
                "working",
                `(${i + 1}/${filesToCreate.length}) ${file.filePath}`,
            )
            const status = await createFile(
                file,
                targetDirectoryUri,
                config,
                overwritePolicy,
                logger,
            )
            if (status === "created") results.created++
            else if (status === "skipped") results.skipped++
            else {
                results.errors++
                errorMessages.push(file.filePath)
            }
        }

        if (results.created > 0) {
            await vscode.commands.executeCommand(
                "workbench.files.action.refreshFilesExplorer",
            )
        }

        const parts = []
        if (results.created > 0) parts.push(`${results.created} created`)
        if (results.skipped > 0) parts.push(`${results.skipped} skipped`)
        if (results.errors > 0) parts.push(`${results.errors} failed`)
        const message = parts.join(" | ")

        if (results.errors > 0) {
            vscode.window.showErrorMessage(
                `${message}\n\nFailed files:\n${errorMessages.join("\n")}`,
            )
            statusBarManager.update("error", "Generation failed", 4000)
        } else if (
            !config.disableSuccessNotifications &&
            (results.created > 0 || results.skipped > 0)
        ) {
            statusBarManager.update("success", message, 4000)
        } else {
            statusBarManager.update("idle")
        }
    } catch (error) {
        vscode.window.showErrorMessage("Failed to generate files.")
        logger.error("Failed during generateFilesFromLlmOutput", error)
        statusBarManager.update("error", "Generation failed", 4000)
    }
}
