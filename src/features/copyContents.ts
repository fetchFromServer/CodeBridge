import * as vscode from "vscode";
import { Logger, StatusBarManager, getConfig, getFileExtension, isIgnored } from "../utils";

/**
 * Configuration settings for the copy contents feature.
 */
interface CopyConfig {
  excludePatterns: string[];
  ignoreBinaryFiles: boolean;
  maxFileSize: number;
  includeStats: boolean;
  lineWarningLimit: number;
  disableSuccessNotifications: boolean;
  addPrompt: boolean;
  defaultPrompt: string;
  removeLeadingWhitespace: boolean;
  minifyToSingleLine: boolean;
  raw: boolean;
  codeFence: string;
}

/**
 * Represents the processed content of a single file.
 */
interface FileContent {
  path: string;
  content: string;
  size: number;
  lines: number;
  words: number;
}

/**
 * A set of file extensions that are commonly considered binary.
 */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".rar",
  ".7z",
  ".tar",
  ".bz2",
  ".exe",
  ".dll",
  ".bin",
  ".wasm",
  ".so",
  ".dylib",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".eot",
  ".db",
  ".sqlite",
  ".mdb",
  ".accdb",
  ".pyc",
  ".pyo",
  ".class",
  ".jar",
  ".war",
  ".dmg",
  ".iso",
  ".img",
  ".vhd",
  ".vmdk",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".sketch",
  ".fig",
  ".psd",
  ".ai",
  ".eps",
  ".node",
  ".whl",
  ".gem",
  ".egg",
  ".parquet",
  ".avro",
  ".orc",
  ".feather",
  ".cab",
  ".msi",
  ".deb",
  ".rpm",
  ".pkg",
  ".dat",
  ".pak",
  ".idx",
  ".lock"
]);

/**
 * Handles the logic of reading, processing, and caching file contents.
 */
class FileProcessor {
  private readonly config: CopyConfig;
  private readonly logger: Logger;
  private readonly cache = new Map<string, FileContent | null>();

  constructor(config: CopyConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Entfernt führende Leerzeichen von jeder Zeile in einem String.
   * @param content Der ursprüngliche String-Inhalt.
   * @returns Der Inhalt, bei dem von jeder Zeile die führenden Leerzeichen entfernt wurden.
   */
  private removeLeadingWhitespaceFromContent(content: string): string {
    return content
      .split("\n")
      .map((line) => line.trimStart())
      .join("\n");
  }

  /**
   * Wandelt einen String in eine einzelne Zeile um, indem Zeilenumbrüche ersetzt
   * und überflüssige Leerzeichen entfernt werden.
   * @param content Der ursprüngliche String-Inhalt.
   * @returns Der minifizierte String in einer Zeile.
   */
  private minifyContentToSingleLine(content: string): string {
    return content
      .replace(/(\r\n|\n|\r)/gm, " ") // Ersetze alle Zeilenumbrüche durch ein Leerzeichen
      .replace(/\s+/g, " ") // Ersetze mehrere Leerzeichen durch ein einziges
      .trim(); // Entferne Leerzeichen am Anfang/Ende
  }

  /**
   * Checks if a file is likely binary.
   * First checks against a list of known binary extensions.
   * As a fallback, it tries to decode the file as UTF-8; if it fails, it's considered binary.
   * @param uri The URI of the file.
   * @param bytes The file content as a byte array.
   * @returns True if the file is considered binary, false otherwise.
   */
  private isBinaryFile(uri: vscode.Uri, bytes: Uint8Array): boolean {
    const ext = getFileExtension(uri.path).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return true;
    }

    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      decoder.decode(bytes);
      return false;
    } catch (e) {
      return true;
    }
  }

  /**
   * Efficiently counts the number of lines and words in a string.
   * @param content The string content to analyze.
   * @returns An object containing the line and word count.
   */
  private countLinesAndWords(content: string): {
    lines: number;
    words: number;
  } {
    if (content.length === 0) {
      return { lines: 1, words: 0 };
    }
    const lineMatches = content.match(/\n/g);
    const lines = lineMatches ? lineMatches.length + 1 : 1;
    const words = content.match(/\b[\w']+\b/g)?.length || 0;
    return { lines, words };
  }

  /**
   * Processes a single file: reads it, checks constraints, and extracts content.
   * Uses a cache to avoid reprocessing the same file.
   * @param fileUri The URI of the file to process.
   * @returns A FileContent object or null if the file is skipped.
   */
  async processFile(fileUri: vscode.Uri): Promise<FileContent | null> {
    const cacheKey = fileUri.toString();
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) || null;
    }

    try {
      const stat = await vscode.workspace.fs.stat(fileUri);

      if (this.config.maxFileSize > 0 && stat.size > this.config.maxFileSize) {
        this.logger.log(`Skipping large file: ${fileUri.fsPath} (${(stat.size / 1024 / 1024).toFixed(2)}MB)`);
        this.cache.set(cacheKey, null);
        return null;
      }

      const fileBytes = await vscode.workspace.fs.readFile(fileUri);

      if (this.config.ignoreBinaryFiles && this.isBinaryFile(fileUri, fileBytes)) {
        this.logger.log(`Skipping binary file: ${fileUri.fsPath}`);
        this.cache.set(cacheKey, null);
        return null;
      }

      let content = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);

      if (this.config.minifyToSingleLine) {
        content = this.minifyContentToSingleLine(content);
      } else if (this.config.removeLeadingWhitespace) {
        content = this.removeLeadingWhitespaceFromContent(content);
      }

      const relativePath = vscode.workspace.asRelativePath(fileUri, false).replace(/\\/g, "/");
      const { lines, words } = this.countLinesAndWords(content);

      const result: FileContent = {
        path: relativePath,
        content,
        size: stat.size,
        lines,
        words
      };

      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      this.logger.error(`Error reading ${fileUri.fsPath}`, error);
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  /**
   * Processes a list of file URIs in parallel chunks.
   * @param fileUris An array of file URIs to process.
   * @param progressReporter An object with a report method to update the UI.
   * @returns A promise that resolves to an array of processed FileContent objects.
   */
  async processFiles(
    fileUris: vscode.Uri[],
    progressReporter: { report: (message: string) => void }
  ): Promise<FileContent[]> {
    const results: FileContent[] = [];

    const optimalChunkSize = Math.min(Math.max(4, Math.floor(fileUris.length / 10)), 32);

    for (let i = 0; i < fileUris.length; i += optimalChunkSize) {
      const chunk = fileUris.slice(i, Math.min(i + optimalChunkSize, fileUris.length));
      const chunkPromises = chunk.map((uri) => this.processFile(uri));
      const chunkResults = await Promise.allSettled(chunkPromises);

      for (const result of chunkResults) {
        if (result.status === "fulfilled" && result.value !== null) {
          results.push(result.value);
        }
      }

      const processed = Math.min(i + optimalChunkSize, fileUris.length);
      progressReporter.report(`Processing ${processed}/${fileUris.length}...`);
    }

    return results;
  }
}

/**
 * Recursively collects all file URIs from a given starting URI, respecting ignore patterns.
 * @param uri The starting URI (can be a file or directory).
 * @param patterns An array of glob patterns to ignore.
 * @param workspaceRootUri The root URI of the workspace for relative path calculations.
 * @param logger The logger instance.
 * @param visitedPaths A set to track visited paths and prevent circular recursion.
 * @returns A promise that resolves to an array of file URIs.
 */
async function collectFileUrisOptimized(
  uri: vscode.Uri,
  patterns: string[],
  workspaceRootUri: vscode.Uri,
  logger: Logger,
  visitedPaths: Set<string> = new Set()
): Promise<vscode.Uri[]> {
  const normalizedPath = uri.toString();
  if (visitedPaths.has(normalizedPath)) {
    return [];
  }
  visitedPaths.add(normalizedPath);

  const relativePath = vscode.workspace.asRelativePath(uri, false);
  if (!uri.path.startsWith(workspaceRootUri.path)) {
    return [];
  }
  if (relativePath && isIgnored(relativePath, patterns)) {
    return [];
  }

  try {
    const stat = await vscode.workspace.fs.stat(uri);

    if (stat.type === vscode.FileType.File) {
      return [uri];
    }

    if (stat.type === vscode.FileType.Directory) {
      const entries = await vscode.workspace.fs.readDirectory(uri);

      const directoryPromises = entries
        .filter(([name]) => {
          const childPath = relativePath ? `${relativePath}/${name}` : name;
          return !isIgnored(childPath, patterns);
        })
        .map(async ([name, type]) => {
          const childUri = vscode.Uri.joinPath(uri, name);

          if (type === vscode.FileType.File) {
            return [childUri];
          } else if (type === vscode.FileType.Directory) {
            return collectFileUrisOptimized(childUri, patterns, workspaceRootUri, logger, visitedPaths);
          }
          return [];
        });

      const nestedResults = await Promise.all(directoryPromises);
      return nestedResults.flat();
    }
  } catch (error) {
    logger.error(`Could not process ${uri.fsPath}`, error);
  }

  return [];
}

/**
 * Formats the collected file contents into a single string for the clipboard.
 * @param files An array of processed FileContent objects.
 * @param config The current copy configuration.
 * @param prompt An optional AI prompt to prepend to the output.
 * @returns An object containing the final formatted string and total size in bytes.
 */
function formatOutput(
  files: FileContent[],
  config: Pick<CopyConfig, "includeStats" | "addPrompt" | "defaultPrompt" | "raw" | "codeFence">,
  prompt?: string
): {
  output: string;
  sizeBytes: number;
} {
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
  }

  if (config.raw) {
    const contentOutput = files.map((file) => file.content).join("\n\n");
    return {
      output: contentOutput,
      sizeBytes: totalBytes
    };
  }

  const chunks: string[] = [];

  for (const file of files) {
    const ext = getFileExtension(file.path).slice(1) || "text";
    const chunk = `## ${file.path}\n\n${config.codeFence}${ext}\n${file.content}\n${config.codeFence}\n\n`;
    chunks.push(chunk);
  }

  const contentOutput = chunks.join("").trimEnd();
  const finalParts: string[] = [];

  if (prompt || (config.addPrompt && config.defaultPrompt)) {
    const promptText = `${prompt || config.defaultPrompt}\n\n---\n\n`;
    finalParts.push(promptText);
  }

  if (config.includeStats) {
    let totalLines = 0;
    let totalWords = 0;
    for (const file of files) {
      totalLines += file.lines;
      totalWords += file.words;
    }
    const sizeKB = (totalBytes / 1024).toFixed(1);
    const sizeMB = totalBytes > 1024 * 1024 ? ` (${(totalBytes / 1024 / 1024).toFixed(2)}MB)` : "";
    const statsLine = `Files: ${
      files.length
    } | Lines: ${totalLines.toLocaleString()} | Words: ${totalWords.toLocaleString()} | Size: ${sizeKB}KB${sizeMB}`;
    finalParts.push(statsLine + "\n\n");
  }

  finalParts.push(contentOutput);

  return {
    output: finalParts.join(""),
    sizeBytes: totalBytes
  };
}

/**
 * Main command handler for copying file and folder contents.
 * @param clickedUri The URI of the item that was right-clicked.
 * @param selectedUris An array of all selected URIs in the explorer.
 * @param logger The logger instance.
 * @param statusBarManager The status bar manager instance.
 * @param prompt An optional AI prompt to prepend to the output.
 */
export async function copyAllContents(
  clickedUri: vscode.Uri | undefined,
  selectedUris: vscode.Uri[] | undefined,
  logger: Logger,
  statusBarManager: StatusBarManager,
  prompt?: string
) {
  const config: CopyConfig = {
    excludePatterns: getConfig("codeBridge", "exclude", ["**/node_modules", "**/.git"]),
    disableSuccessNotifications: getConfig("codeBridge", "notifications.disableSuccess", false),
    ignoreBinaryFiles: getConfig("codeBridge", "copy.ignoreBinaryFiles", true),
    maxFileSize: getConfig("codeBridge", "copy.maxFileSize", 0),
    includeStats: getConfig("codeBridge", "copy.includeStats", false),
    lineWarningLimit: getConfig("codeBridge", "copy.lineWarningLimit", 50000),
    addPrompt: getConfig("codeBridge", "prompt.addDefault", false),
    defaultPrompt: getConfig("codeBridge", "prompt.default", ""),
    removeLeadingWhitespace: getConfig("codeBridge", "copy.removeLeadingWhitespace", false),
    minifyToSingleLine: getConfig("codeBridge", "copy.minifyToSingleLine", false),
    raw: getConfig("codeBridge", "copy.raw", false),
    codeFence: getConfig("codeBridge", "copy.codeFence", "```")
  };

  const initial: vscode.Uri[] = [];
  if (selectedUris?.length) initial.push(...selectedUris);
  else if (clickedUri) initial.push(clickedUri);
  else {
    const active = vscode.window.activeTextEditor?.document?.uri;
    if (active) initial.push(active);
  }

  if (!initial.length) {
    vscode.window.showWarningMessage("No files or folders selected.");
    return;
  }

  const groups = new Map<string, { folder: vscode.WorkspaceFolder; uris: vscode.Uri[] }>();

  for (const uri of initial) {
    const wf = vscode.workspace.getWorkspaceFolder(uri);
    if (!wf) continue;
    const key = wf.uri.toString();
    if (!groups.has(key)) groups.set(key, { folder: wf, uris: [] });
    groups.get(key)!.uris.push(uri);
  }

  if (!groups.size) {
    vscode.window.showErrorMessage("No workspace folder found.");
    return;
  }

  try {
    statusBarManager.update("working", "Discovering files...");

    const fileSet = new Map<string, vscode.Uri>();
    const visitedPaths = new Set<string>();
    for (const { folder, uris } of groups.values()) {
      const groupPromises = uris.map((uri) =>
        collectFileUrisOptimized(uri, config.excludePatterns, folder.uri, logger, visitedPaths)
      );
      const groupResults = await Promise.all(groupPromises);
      for (const uriList of groupResults) {
        for (const u of uriList) {
          fileSet.set(u.fsPath, u);
        }
      }
    }

    const allFileUris = [...fileSet.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));

    if (allFileUris.length === 0) {
      vscode.window.showInformationMessage("No files found (check exclude settings).");
      statusBarManager.update("idle");
      return;
    }

    if (allFileUris.length > 500) {
      const proceedMany = await vscode.window.showWarningMessage(
        `About to process ${allFileUris.length} files. Continue?`,
        "Yes",
        "No"
      );
      if (proceedMany !== "Yes") {
        statusBarManager.update("idle");
        return;
      }
    }

    const processor = new FileProcessor(config, logger);
    const fileContents = await processor.processFiles(allFileUris, {
      report: (message: string) => {
        statusBarManager.update("working", message);
      }
    });

    if (fileContents.length === 0) {
      vscode.window.showInformationMessage("No readable files found.");
      statusBarManager.update("idle");
      return;
    }

    const { output: finalContent, sizeBytes } = formatOutput(fileContents, config, prompt);

    const finalLineCount = (finalContent.match(/\n/g) || []).length + 1;

    if (config.lineWarningLimit > 0 && finalLineCount > config.lineWarningLimit) {
      const proceed = await vscode.window.showWarningMessage(
        `Output contains ${finalLineCount.toLocaleString()} lines. Continue?`,
        "Yes",
        "No"
      );
      if (proceed !== "Yes") {
        statusBarManager.update("idle");
        return;
      }
    }

    const MAX_CLIPBOARD_SIZE = 50 * 1024 * 1024;
    if (finalContent.length > MAX_CLIPBOARD_SIZE) {
      const answer = await vscode.window.showErrorMessage(
        `Output is ${(finalContent.length / 1024 / 1024).toFixed(
          1
        )}MB - too large for clipboard. Save to file instead?`,
        "Save to File",
        "Cancel"
      );
      if (answer === "Save to File") {
        const saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file("codebridge-output.md"),
          filters: { Markdown: ["md"], Text: ["txt"] }
        });
        if (saveUri) {
          await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(finalContent));
          vscode.window.showInformationMessage(`Saved to ${saveUri.fsPath}`);
        }
      }
      statusBarManager.update("idle");
      return;
    }

    await vscode.env.clipboard.writeText(finalContent);

    if (!config.disableSuccessNotifications) {
      const sizeMB =
        sizeBytes > 1024 * 1024 ? `${(sizeBytes / 1024 / 1024).toFixed(2)}MB` : `${(sizeBytes / 1024).toFixed(1)}KB`;
      const message = `Copied ${fileContents.length} files | ${finalLineCount.toLocaleString()} lines | ${sizeMB}`;
      statusBarManager.update("success", message, 4000);
    } else {
      statusBarManager.update("idle");
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to copy contents.`);
    logger.error("Failed during copyAllContents", error);
    statusBarManager.update("error", "Copy failed", 4000);
  }
}

/**
 * Displays a Quick Pick menu for the user to select a predefined AI prompt or enter a custom one.
 * @returns A promise that resolves to the selected prompt string, or undefined if the user cancels.
 */
export async function selectPrompt(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("codeBridge");
  const inspection = config.inspect<Record<string, string>>("prompt.custom");

  const workspacePrompts = inspection?.workspaceValue;
  const userPrompts = inspection?.globalValue;
  const defaultPrompts = inspection?.defaultValue || {};

  let finalPrompts: Record<string, string>;

  if (workspacePrompts !== undefined) {
    finalPrompts = workspacePrompts;
  } else if (userPrompts !== undefined) {
    finalPrompts = userPrompts;
  } else {
    finalPrompts = defaultPrompts;
  }

  const items = Object.entries(finalPrompts).map(([key, value]) => ({
    label: key,
    detail: value,
    prompt: value
  }));

  items.push({
    label: "Custom Input",
    detail: "Type a custom prompt",
    prompt: ""
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a prompt template for CodeBridge"
  });

  if (!selected) return undefined;

  if (selected.label === "Custom Input") {
    return await vscode.window.showInputBox({
      prompt: "Enter your AI prompt",
      placeHolder: "e.g., Review this code for bugs"
    });
  }
  return selected.prompt;
}
