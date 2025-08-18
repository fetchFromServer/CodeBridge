import * as vscode from "vscode"
import { Logger, StatusBarManager, getConfig, posixPath } from "../utils"

/**
 * Configuration for the file generator
 */
interface GeneratorConfig {
    createDirectories: boolean
    overwriteExisting: boolean
    disableFileSelection: boolean
    defaultExtension: string
    pathCommentPrefixes: string[]
    disableSuccessNotifications: boolean
    openFencePattern: string
    closeFencePattern: string
    filePathPattern: string
}

/**
 * Represents a file to be created
 */
interface FileData {
    filePath: string
    content: string
}

/**
 * Policy for handling existing files during generation
 */
type OverwritePolicy = {
    value: "ask" | "overwrite" | "skip"
}

/**
 * Language to file extension mapping
 */
const LANG_MAP: Record<string, { ext?: string; special?: "dockerfile" }> = {
    js: { ext: ".js" },
    javascript: { ext: ".js" },
    mjs: { ext: ".mjs" },
    cjs: { ext: ".cjs" },
    jsx: { ext: ".jsx" },
    ts: { ext: ".ts" },
    tsx: { ext: ".tsx" },
    typescript: { ext: ".ts" },
    html: { ext: ".html" },
    css: { ext: ".css" },
    scss: { ext: ".scss" },
    less: { ext: ".less" },
    json: { ext: ".json" },
    jsonc: { ext: ".json" },
    yaml: { ext: ".yaml" },
    yml: { ext: ".yml" },
    ini: { ext: ".ini" },
    toml: { ext: ".toml" },
    sh: { ext: ".sh" },
    bash: { ext: ".sh" },
    shell: { ext: ".sh" },
    powershell: { ext: ".ps1" },
    ps1: { ext: ".ps1" },
    py: { ext: ".py" },
    python: { ext: ".py" },
    rb: { ext: ".rb" },
    ruby: { ext: ".rb" },
    php: { ext: ".php" },
    go: { ext: ".go" },
    rs: { ext: ".rs" },
    rust: { ext: ".rs" },
    c: { ext: ".c" },
    h: { ext: ".h" },
    cpp: { ext: ".cpp" },
    cxx: { ext: ".cpp" },
    cc: { ext: ".cpp" },
    cplusplus: { ext: ".cpp" },
    hpp: { ext: ".hpp" },
    cs: { ext: ".cs" },
    csharp: { ext: ".cs" },
    java: { ext: ".java" },
    kt: { ext: ".kt" },
    kotlin: { ext: ".kt" },
    swift: { ext: ".swift" },
    rspec: { ext: ".rb" },
    md: { ext: ".md" },
    markdown: { ext: ".md" },
    dockerfile: { special: "dockerfile" },
    svelte: { ext: ".svelte" },
    vue: { ext: ".vue" },
    graphql: { ext: ".graphql" },
    gql: { ext: ".graphql" },
    proto: { ext: ".proto" },
    sql: { ext: ".sql" },
    hcl: { ext: ".hcl" },
    tf: { ext: ".tf" },
    text: { ext: ".txt" },
    plain: { ext: ".txt" },
}

/**
 * Maps a language identifier to its corresponding file extension
 * @param lang The language identifier (e.g., "typescript", "js")
 * @returns Object containing the extension or special handling instructions
 */
function mapLangToExt(lang?: string): {
    ext: string | null
    special?: "dockerfile"
} {
    if (!lang) return { ext: null }
    const key = lang.trim().toLowerCase()
    const entry = LANG_MAP[key]
    if (!entry) return { ext: null }
    if (entry.special === "dockerfile")
        return { ext: "", special: "dockerfile" }
    return { ext: entry.ext ?? null }
}

/**
 * Represents a detected code block in the input
 */
interface CodeBlock {
    startLine: number
    endLine: number
    lang?: string
    content: string
}

/**
 * Extracts code blocks from the input text using configurable fence patterns
 * @param input The input text containing code blocks
 * @param config The generator configuration with regex patterns
 * @param logger Logger instance for error reporting
 * @returns Array of detected code blocks with line positions and content
 */
function extractCodeBlocks(
    input: string,
    config: GeneratorConfig,
    logger: Logger,
): CodeBlock[] {
    const lines = input.split(/\r?\n/)

    const defaultOpenPattern = "^[ \\t]*```([^\\s`]+)?[ \\t]*$"
    const defaultClosePattern = "^[ \\t]*```[ \\t]*$"

    const openPattern = config.openFencePattern || defaultOpenPattern
    const closePattern = config.closeFencePattern || defaultClosePattern

    let openRe: RegExp
    let closeRe: RegExp

    try {
        openRe = new RegExp(openPattern)
    } catch (e) {
        logger.error(
            `Invalid open fence pattern, using default: ${openPattern}`,
            e,
        )
        openRe = new RegExp(defaultOpenPattern)
    }

    try {
        closeRe = new RegExp(closePattern)
    } catch (e) {
        logger.error(
            `Invalid close fence pattern, using default: ${closePattern}`,
            e,
        )
        closeRe = new RegExp(defaultClosePattern)
    }

    const blocks: CodeBlock[] = []
    let i = 0

    while (i < lines.length) {
        let open: RegExpExecArray | null = null
        try {
            open = openRe.exec(lines[i])
        } catch (e) {
            logger.error(`Error executing open fence pattern at line ${i}`, e)
            i++
            continue
        }

        if (!open) {
            i++
            continue
        }

        const lang = open[1]
        const startLine = i
        let j = i + 1

        while (j < lines.length) {
            try {
                if (closeRe.test(lines[j])) break
            } catch (e) {
                logger.error(
                    `Error executing close fence pattern at line ${j}`,
                    e,
                )
                break
            }
            j++
        }

        if (j >= lines.length) {
            i = startLine + 1
            continue
        }

        const content = lines.slice(startLine + 1, j).join("\n")
        if (content.length > 0) {
            blocks.push({ startLine, endLine: j, lang, content })
        }
        i = j + 1
    }

    return blocks
}

/**
 * Parses LLM output to extract file paths and code blocks
 * @param llmOutput The raw output from an LLM containing code blocks
 * @param config The generator configuration
 * @param logger Logger instance for error reporting
 * @returns Array of FileData objects ready for file creation
 */
function parseLlmOutput(
    llmOutput: string,
    config: GeneratorConfig,
    logger: Logger,
): FileData[] {
    const files: FileData[] = []
    const usedNames = new Set<string>()

    const lines = llmOutput.split(/\r?\n/)
    const blocks = extractCodeBlocks(llmOutput, config, logger)

    const cleanLine = (line: string): string => {
        const trimmed = line.trim()
        for (const prefix of config.pathCommentPrefixes) {
            if (trimmed.startsWith(prefix))
                return trimmed.slice(prefix.length).trim()
        }
        return trimmed
    }

    const defaultFilePathPattern =
        "(?:^|[\\s*#:/<_-])((?:[a-zA-Z0-9._-]+(?:[\\\\/]))*[a-zA-Z0-9._-]+\\.[a-zA-Z0-9_]+)"
    const filePathPattern = config.filePathPattern || defaultFilePathPattern

    let filePathRegex: RegExp
    try {
        filePathRegex = new RegExp(filePathPattern)
    } catch (e) {
        logger.error(
            `Invalid file path pattern, using default: ${filePathPattern}`,
            e,
        )
        filePathRegex = new RegExp(defaultFilePathPattern)
    }

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i]
        let filePath: string | null = null
        let finalContent = block.content
        let extInfo = mapLangToExt(block.lang)

        const contentLines = finalContent.split("\n")
        const firstLine = contentLines[0] ?? ""
        const firstLineTrim = firstLine.trim()

        if (firstLineTrim) {
            const cleaned = cleanLine(firstLine)
            try {
                const m = cleaned.match(filePathRegex)
                if (m && m[1]) {
                    filePath = m[1]
                    finalContent = contentLines
                        .slice(1)
                        .join("\n")
                        .replace(/^\n/, "")
                }
            } catch (e) {
                logger.error(
                    `Error matching file path pattern in first line`,
                    e,
                )
            }

            if (!filePath && !block.lang) {
                const maybeLang = firstLineTrim.toLowerCase()
                const mapped = mapLangToExt(maybeLang)
                if (mapped.ext !== null || mapped.special) {
                    extInfo = mapped
                    finalContent = contentLines.slice(1).join("\n")
                }
            }
        }

        if (!filePath) {
            const prevEnd = i > 0 ? blocks[i - 1].endLine : -1

            for (let j = block.startLine - 1; j > prevEnd; j--) {
                const line = lines[j]
                if (!line || !line.trim()) continue
                const cleaned = cleanLine(line)

                try {
                    const m = cleaned.match(filePathRegex)
                    if (m && m[1]) {
                        filePath = m[1]
                        break
                    }
                    const token = cleaned.split(/\s+/)[0]
                    const m2 = token.match(filePathRegex)
                    if (m2 && m2[1]) {
                        filePath = m2[1]
                        break
                    }
                } catch (e) {
                    logger.error(
                        `Error matching file path pattern at line ${j}`,
                        e,
                    )
                }
            }
        }

        if (!filePath) {
            if (extInfo.special === "dockerfile") {
                filePath = "Dockerfile"
            } else {
                const temp = `temp_file_${i + 1}`
                const ext =
                    extInfo.ext || `.${config.defaultExtension || "txt"}`
                filePath = `${temp}${ext}`
            }
        }

        let finalName = filePath.replace(/\\/g, "/")
        finalName = posixPath.normalize(finalName)

        const currentExt = posixPath.extname(finalName)
        if (!currentExt) {
            if (extInfo.special === "dockerfile") {
                const dir = posixPath.dirname(finalName)
                const base = posixPath.basename(finalName)
                if (base.toLowerCase() !== "dockerfile") {
                    finalName =
                        dir === "."
                            ? "Dockerfile"
                            : posixPath.join(dir, "Dockerfile")
                }
            } else if (extInfo.ext) {
                finalName = `${finalName}${extInfo.ext}`
            }
        }

        let unique = finalName
        let counter = 1
        while (usedNames.has(unique)) {
            const dir = posixPath.dirname(unique)
            const ext = posixPath.extname(unique)
            const base = posixPath.basename(unique, ext)
            const nextBase = `${base}_${counter++}`
            unique =
                dir === "."
                    ? `${nextBase}${ext}`
                    : posixPath.join(dir, `${nextBase}${ext}`)
        }

        files.push({ filePath: unique, content: finalContent })
        usedNames.add(unique)
    }

    return files
}

/**
 * Recursively ensures a directory exists, creating parent directories as needed
 * @param directoryUri The URI of the directory to ensure exists
 * @param logger Logger instance for error reporting
 */
async function ensureDirectoryExists(
    directoryUri: vscode.Uri,
    logger: Logger,
): Promise<void> {
    const parentUri = vscode.Uri.joinPath(directoryUri, "..")
    if (parentUri.path === directoryUri.path) return

    try {
        await vscode.workspace.fs.stat(parentUri)
    } catch {
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
 * Creates a single file on disk with proper error handling and overwrite policy
 * @param fileData The file data containing path and content
 * @param baseDirUri The base directory URI for file creation
 * @param config The generator configuration
 * @param overwritePolicy The policy for handling existing files
 * @param logger Logger instance for error reporting
 * @returns Status of the file creation operation
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
            if (overwritePolicy.value === "skip") return "skipped"
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
 * Main function to generate files from LLM output in clipboard
 * @param llmOutput The LLM output containing code blocks
 * @param targetDirectoryUri The target directory for file generation
 * @param logger Logger instance for error reporting
 * @param statusBarManager Status bar manager for UI updates
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
        pathCommentPrefixes: getConfig(
            "codeBridge",
            "generator.pathCommentPrefixes",
            ["//", "#", "--", "/*", "*", "<!--", "%", "'"],
        ),
        disableSuccessNotifications: getConfig(
            "codeBridge",
            "notifications.disableSuccess",
            false,
        ),
        openFencePattern: getConfig(
            "codeBridge",
            "generator.openFencePattern",
            "^[ \\t]*```([^\\s`]+)?[ \\t]*$",
        ),
        closeFencePattern: getConfig(
            "codeBridge",
            "generator.closeFencePattern",
            "^[ \\t]*```[ \\t]*$",
        ),
        filePathPattern: getConfig(
            "codeBridge",
            "generator.filePathPattern",
            "(?:^|[\\s*#:/<_-])((?:[a-zA-Z0-9._-]+(?:[\\\\/]))*[a-zA-Z0-9._-]+\\.[a-zA-Z0-9_]+)",
        ),
    }

    const parsed = parseLlmOutput(llmOutput, config, logger)

    if (!parsed.length) {
        vscode.window.showWarningMessage("No code blocks found in clipboard.")
        return
    }

    parsed.sort((a, b) => {
        const pa = a.filePath.split("/")
        const pb = b.filePath.split("/")
        const len = Math.min(pa.length, pb.length)
        for (let i = 0; i < len; i++) {
            const lastA = i === pa.length - 1
            const lastB = i === pb.length - 1
            if (lastA && !lastB) return 1
            if (!lastA && lastB) return -1
            const cmp = pa[i].localeCompare(pb[i])
            if (cmp !== 0) return cmp
        }
        return pa.length - pb.length
    })

    let filesToCreate: FileData[] = []

    if (config.disableFileSelection) {
        filesToCreate = parsed
    } else {
        const items = parsed.map(file => {
            const dir = posixPath.dirname(file.filePath)
            return {
                label: file.filePath,
                description:
                    dir === "." ? "Directory: (root)" : `Directory: ${dir}`,
                picked: true,
                fileData: file,
            }
        })

        const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: `Found ${parsed.length} files. Select which ones to generate.`,
            ignoreFocusOut: true,
        })

        if (!selected || selected.length === 0) {
            vscode.window.showInformationMessage("File generation cancelled.")
            return
        }
        filesToCreate = selected.map(i => i.fileData)
    }

    if (!filesToCreate.length) {
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
            const f = filesToCreate[i]
            statusBarManager.update(
                "working",
                `(${i + 1}/${filesToCreate.length}) ${f.filePath}`,
            )
            const status = await createFile(
                f,
                targetDirectoryUri,
                config,
                overwritePolicy,
                logger,
            )
            if (status === "created") results.created++
            else if (status === "skipped") results.skipped++
            else {
                results.errors++
                errorMessages.push(f.filePath)
            }
        }

        if (results.created > 0) {
            await vscode.commands.executeCommand(
                "workbench.files.action.refreshFilesExplorer",
            )
        }

        const parts = [] as string[]
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
