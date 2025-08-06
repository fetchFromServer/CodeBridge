import * as path from "path"
import * as vscode from "vscode"

/**
 * Defines the structure for the configuration object used by the copy functionality.
 */
export interface CopyConfig {
    excludePatterns: string[]
    ignoreBinaryFiles: boolean
    maxFileSize: number
    outputFormat: "xml" | "markdown" | "plain"
    includeStats: boolean
    addPrompt: boolean
    defaultPrompt: string
    customPrompts: Record<string, string>
    tokenWarningLimit: number
    xmlWrapper: { open: string; close: string }
    markdownCodeBlock: string
}

/**
 * Retrieves the user-defined or default configuration for the extension.
 * @returns A configuration object.
 */
export function getConfiguration(): CopyConfig {
    const config = vscode.workspace.getConfiguration("codeBridge")
    return {
        excludePatterns: config.get("exclude", ["**/node_modules", "**/.git"]),
        ignoreBinaryFiles: config.get("ignoreBinaryFiles", true),
        maxFileSize: config.get("maxFileSize", 1048576),
        outputFormat: config.get("outputFormat", "markdown"),
        includeStats: config.get("includeStats", true),
        addPrompt: config.get("addPrompt", false),
        defaultPrompt: config.get("defaultPrompt", ""),
        customPrompts: config.get("customPrompts", {}),
        tokenWarningLimit: config.get("tokenWarningLimit", 100000),
        xmlWrapper: config.get("xmlWrapper", {
            open: "<codebase>",
            close: "</codebase>",
        }),
        markdownCodeBlock: config.get("markdownCodeBlock", "```"),
    }
}

/**
 * Converts a glob pattern to a regular expression.
 * @param glob The glob pattern.
 * @returns A RegExp object.
 */
function globToRegex(glob: string): RegExp {
    const regex = glob
        .replace(/[\-\[\]\/\{\}\(\)\+\.\\\^\$\|\#\s]/g, "\\$&")
        .replace(/\*\*/g, "(.+)")
        .replace(/\*/g, "([^/]+)")
        .replace(/\?/g, "([^/])")
    return new RegExp(`^${regex}$`)
}

/**
 * Checks if a given path matches any of the provided glob patterns.
 * @param relativePath The file path to check.
 * @param patterns An array of glob patterns.
 * @returns True if the path matches a pattern, false otherwise.
 */
function isIgnored(relativePath: string, patterns: string[]): boolean {
    const normalizedPath = relativePath.replace(/\\/g, "/")
    for (const pattern of patterns) {
        const regex = globToRegex(pattern)
        if (regex.test(normalizedPath)) {
            return true
        }
    }
    return false
}

/**
 * Checks if a file is likely a binary file by searching for a null byte.
 * @param fileUri The URI of the file to check.
 * @returns A promise that resolves to true if the file is binary, false otherwise.
 */
async function isBinary(fileUri: vscode.Uri): Promise<boolean> {
    try {
        const fileContents = await vscode.workspace.fs.readFile(fileUri)
        const sample = fileContents.slice(0, 1024)
        for (let i = 0; i < sample.length; i++) {
            if (sample[i] === 0) return true
        }
        return false
    } catch {
        return false
    }
}

/**
 * Reads the content of a single file, respecting size and binary file constraints.
 * @param fileUri The URI of the file to read.
 * @param config The current copy configuration.
 * @returns A promise that resolves to an object with the path and content, or null if skipped.
 */
export async function getFormattedFileContent(
    fileUri: vscode.Uri,
    config: CopyConfig,
): Promise<{ path: string; content: string } | null> {
    try {
        const stat = await vscode.workspace.fs.stat(fileUri)
        if (stat.size > config.maxFileSize) {
            console.log(
                `Skipping large file: ${fileUri.fsPath} (${stat.size} bytes)`,
            )
            return null
        }

        if (config.ignoreBinaryFiles && (await isBinary(fileUri))) {
            console.log(`Skipping binary file: ${fileUri.fsPath}`)
            return null
        }

        const fileContents = await vscode.workspace.fs.readFile(fileUri)
        const content = Buffer.from(fileContents).toString("utf8")
        const relativePath = vscode.workspace.asRelativePath(fileUri, false)

        return { path: relativePath, content }
    } catch (error) {
        console.log(`Error reading ${fileUri.fsPath}: ${error}`)
        return null
    }
}

/**
 * Recursively collects all file URIs from a starting URI, respecting exclusion patterns.
 * @param uri The starting URI (can be a file or directory).
 * @param patterns An array of glob patterns to exclude.
 * @param workspaceRootUri The URI of the workspace root for relative path calculation.
 * @returns A promise that resolves to an array of file URIs.
 */
export async function collectFileUrisRecursively(
    uri: vscode.Uri,
    patterns: string[],
    workspaceRootUri: vscode.Uri,
): Promise<vscode.Uri[]> {
    const relativePath = path.relative(workspaceRootUri.fsPath, uri.fsPath)
    if (relativePath && isIgnored(relativePath, patterns)) {
        return []
    }

    try {
        const stat = await vscode.workspace.fs.stat(uri)

        if (stat.type === vscode.FileType.File) {
            return [uri]
        }

        if (stat.type === vscode.FileType.Directory) {
            const entries = await vscode.workspace.fs.readDirectory(uri)
            const promises = entries.map(([name]) => {
                const childUri = vscode.Uri.joinPath(uri, name)
                return collectFileUrisRecursively(
                    childUri,
                    patterns,
                    workspaceRootUri,
                )
            })
            const nestedUris = await Promise.all(promises)
            return nestedUris.flat()
        }
    } catch (error) {
        console.log(`Could not process ${uri.fsPath}: ${error}`)
    }
    return []
}

/**
 * Formats the collected file contents into a single string based on the chosen output format.
 * @param files An array of file objects with path and content.
 * @param config The current copy configuration.
 * @param prompt An optional prompt to prepend to the output.
 * @returns The final formatted string for the clipboard.
 */
function formatOutput(
    files: { path: string; content: string }[],
    config: CopyConfig,
    prompt?: string,
): string {
    let output = ""

    if (prompt || (config.addPrompt && config.defaultPrompt)) {
        output += `${prompt || config.defaultPrompt}\n\n---\n\n`
    }

    const statsMarker = "___STATS___"
    if (config.includeStats) {
        output += statsMarker + "\n\n"
    }

    switch (config.outputFormat) {
        case "xml":
            output += config.xmlWrapper.open + "\n"
            files.forEach(file => {
                output += `<file path="${file.path}">\n${file.content}\n</file>\n\n`
            })
            output += config.xmlWrapper.close
            break

        case "markdown":
            files.forEach(file => {
                const ext = path.extname(file.path).slice(1) || "text"
                output += `## ${file.path}\n\n${config.markdownCodeBlock}${ext}\n${file.content}\n${config.markdownCodeBlock}\n\n`
            })
            break

        case "plain":
        default:
            files.forEach(file => {
                output += `// FILE: ${file.path}\n\n${file.content}\n\n---\n\n`
            })
            break
    }

    if (config.includeStats) {
        const totalChars = output.length - statsMarker.length - 2
        const estimatedTokens = Math.round(totalChars / 4)
        const sizeKB = (totalChars / 1024).toFixed(1)
        const statsLine = `📊 Files: ${files.length} | Size: ${sizeKB}KB | ~${estimatedTokens} tokens`
        output = output.replace(statsMarker, statsLine)
    }

    return output
}

/**
 * Main command function to collect, format, and copy the contents of selected files/folders.
 * @param clickedUri The URI that was right-clicked.
 * @param selectedUris An array of all selected URIs.
 * @param prompt An optional prompt to include in the output.
 */
export async function copyAllContents(
    clickedUri: vscode.Uri,
    selectedUris: vscode.Uri[],
    prompt?: string,
) {
    const config = getConfiguration()
    const urisToProcess = selectedUris?.length > 0 ? selectedUris : [clickedUri]

    if (!urisToProcess.length) {
        vscode.window.showWarningMessage("No files or folders selected.")
        return
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        urisToProcess[0],
    )
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found.")
        return
    }

    try {
        const allFileUris = (
            await Promise.all(
                urisToProcess.map(uri =>
                    collectFileUrisRecursively(
                        uri,
                        config.excludePatterns,
                        workspaceFolder.uri,
                    ),
                ),
            )
        ).flat()

        if (allFileUris.length === 0) {
            vscode.window.showInformationMessage(
                "No files found (check exclude settings).",
            )
            return
        }

        const fileContents = (
            await Promise.all(
                allFileUris.map(uri => getFormattedFileContent(uri, config)),
            )
        ).filter((f): f is { path: string; content: string } => f !== null)

        if (fileContents.length === 0) {
            vscode.window.showInformationMessage("No readable files found.")
            return
        }

        const finalContent = formatOutput(fileContents, config, prompt)
        const estimatedTokens = Math.round(finalContent.length / 4)

        if (estimatedTokens > config.tokenWarningLimit) {
            const proceed = await vscode.window.showWarningMessage(
                `Output is ~${estimatedTokens} tokens. Continue?`,
                "Yes",
                "No",
            )
            if (proceed !== "Yes") return
        }

        await vscode.env.clipboard.writeText(finalContent)

        vscode.window.showInformationMessage(
            `Copied ${fileContents.length} files | ~${estimatedTokens} tokens`,
        )
    } catch (error) {
        vscode.window.showErrorMessage(`Failed: ${error}`)
    }
}
