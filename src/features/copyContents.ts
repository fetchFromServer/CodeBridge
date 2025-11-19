import * as vscode from "vscode";
import { Logger, StatusBarManager, getConfig, getFileExtension, getGlobalExcludes, isIgnored } from "../utils";

interface CopyConfig {
  excludePatterns: string[];
  includeStats: boolean;
  disableSuccessNotifications: boolean;
  raw: boolean;
  maxFileSize: number;
  lineWarningLimit: number;
  codeFence: string;
  removeLeadingWhitespace: boolean;
  minifyToSingleLine: boolean;
}

interface FileContent {
  path: string;
  content: string;
  size: number;
  lines: number;
  words: number;
  extension: string;
}

// Hard limit to prevent extension host from crashing on accidental massive file selection
const SAFETY_MAX_FILE_SIZE = 100 * 1024 * 1024;

// Common binary formats we definitely don't want to cat into a text prompt
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
  ".lock",
]);

class FileProcessor {
  private readonly config: CopyConfig;
  private readonly logger: Logger;
  // Simple memory cache to avoid re-reading files if user spams commands
  private readonly cache = new Map<string, FileContent | null>();

  constructor(config: CopyConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  // Saves tokens by stripping indentation. Careful, this can break python indentation
  // if not consistent, but useful for strict token limits.
  private removeLeadingWhitespaceFromContent(content: string): string {
    return content
      .split("\n")
      .map((line) => line.trimStart())
      .join("\n");
  }

  private minifyContentToSingleLine(content: string): string {
    return content
      .replace(/(\r\n|\n|\r)/gm, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Fallback heuristic: if extension check fails, look for null bytes
  private isBinaryFile(uri: vscode.Uri, bytes: Uint8Array): boolean {
    const ext = getFileExtension(uri.path).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      return true;
    }
    try {
      // Only check start of file to save performance
      const checkLength = Math.min(bytes.length, 8000);
      for (let i = 0; i < checkLength; i++) {
        if (bytes[i] === 0) return true;
      }
      return false;
    } catch (e) {
      return true;
    }
  }

  private countLinesAndWords(content: string): { lines: number; words: number } {
    if (content.length === 0) return { lines: 1, words: 0 };
    const lineMatches = content.match(/\n/g);
    const lines = lineMatches ? lineMatches.length + 1 : 1;
    const words = content.match(/\b[\w']+\b/g)?.length || 0;
    return { lines, words };
  }

  async processFile(fileUri: vscode.Uri): Promise<FileContent | null> {
    const cacheKey = fileUri.toString();
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) || null;

    try {
      const stat = await vscode.workspace.fs.stat(fileUri);

      if (this.config.maxFileSize > 0 && stat.size > this.config.maxFileSize) {
        this.logger.log(`Skipping large file: ${fileUri.fsPath} (${(stat.size / 1024 / 1024).toFixed(2)}MB)`);
        this.cache.set(cacheKey, null);
        return null;
      }

      if (stat.size > SAFETY_MAX_FILE_SIZE) {
        this.logger.log(
          `Skipping massive file (Safety): ${fileUri.fsPath} (${(stat.size / 1024 / 1024).toFixed(2)}MB)`
        );
        this.cache.set(cacheKey, null);
        return null;
      }

      const fileBytes = await vscode.workspace.fs.readFile(fileUri);

      if (this.isBinaryFile(fileUri, fileBytes)) {
        this.logger.log(`Skipping binary file: ${fileUri.fsPath}`);
        this.cache.set(cacheKey, null);
        return null;
      }

      // Using TextDecoder is safer for UTF-8 than raw string conversion
      let content = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);

      if (this.config.minifyToSingleLine) {
        content = this.minifyContentToSingleLine(content);
      } else if (this.config.removeLeadingWhitespace) {
        content = this.removeLeadingWhitespaceFromContent(content);
      }

      const relativePath = vscode.workspace.asRelativePath(fileUri, false).replace(/\\/g, "/");
      const { lines, words } = this.countLinesAndWords(content);
      const extension = getFileExtension(relativePath);

      const result: FileContent = {
        path: relativePath,
        content,
        size: stat.size,
        lines,
        words,
        extension,
      };

      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      this.logger.error(`Error reading ${fileUri.fsPath}`, error);
      this.cache.set(cacheKey, null);
      return null;
    }
  }

  // Batch processing to prevent UI freeze when handling thousands of files
  async processFiles(
    fileUris: vscode.Uri[],
    progressReporter: { report: (message: string) => void }
  ): Promise<FileContent[]> {
    const results: FileContent[] = [];
    // Dynamic chunk size based on total count, clamped between 4 and 32
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
      progressReporter.report(`Processing ${Math.min(i + optimalChunkSize, fileUris.length)}/${fileUris.length}...`);
    }
    return results;
  }
}

// Recursively find files, respecting exclusions.
async function collectFileUrisOptimized(
  uri: vscode.Uri,
  patterns: string[],
  workspaceRootUri: vscode.Uri,
  logger: Logger,
  visitedPaths: Set<string> = new Set()
): Promise<vscode.Uri[]> {
  const normalizedPath = uri.toString();
  // Prevent infinite loops with symlinks
  if (visitedPaths.has(normalizedPath)) return [];
  visitedPaths.add(normalizedPath);

  const relativePath = vscode.workspace.asRelativePath(uri, false);

  // Security check: don't go outside workspace
  if (!uri.path.startsWith(workspaceRootUri.path)) return [];
  if (relativePath && isIgnored(relativePath, patterns)) return [];

  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type === vscode.FileType.File) return [uri];
    if (stat.type === vscode.FileType.Directory) {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      const directoryPromises = entries
        .filter(([name]) => {
          const childPath = relativePath ? `${relativePath}/${name}` : name;
          return !isIgnored(childPath, patterns);
        })
        .map(async ([name, type]) => {
          const childUri = vscode.Uri.joinPath(uri, name);
          if (type === vscode.FileType.File) return [childUri];
          else if (type === vscode.FileType.Directory)
            return collectFileUrisOptimized(childUri, patterns, workspaceRootUri, logger, visitedPaths);
          return [];
        });
      return (await Promise.all(directoryPromises)).flat();
    }
  } catch (error) {
    logger.error(`Could not process ${uri.fsPath}`, error);
  }
  return [];
}

// If the code contains backticks (e.g. markdown files), we need to increase the fence size
// (``` -> ````) to avoid breaking the formatting.
function getDynamicFence(content: string, defaultFence: string): string {
  const matches = content.match(/`+/g);
  if (!matches) return defaultFence;
  const maxLength = Math.max(...matches.map((m) => m.length));
  return maxLength >= defaultFence.length ? "`".repeat(maxLength + 1) : defaultFence;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatOutput(
  files: FileContent[],
  config: Pick<CopyConfig, "includeStats" | "raw" | "codeFence">,
  prompt?: string
): { output: string; sizeBytes: number } {
  let totalBytes = 0;
  for (const file of files) totalBytes += file.size;

  // Raw mode is just concatenation, useful for pure data
  if (config.raw) {
    const contentOutput = files.map((file) => file.content).join("\n\n");
    return { output: contentOutput, sizeBytes: totalBytes };
  }

  const chunks: string[] = [];
  const useDetailedHeaders = config.includeStats;

  for (const file of files) {
    const ext = file.extension.slice(1) || "text";
    const fence = getDynamicFence(file.content, config.codeFence);

    let header = `## ${file.path}`;

    if (useDetailedHeaders) {
      const langName =
        ext === "ts" ? "TypeScript" : ext === "js" ? "JavaScript" : ext === "py" ? "Python" : ext.toUpperCase();

      header += ` [${langName} | ${file.lines} Lines | ${formatSize(file.size)}]`;
    }

    const chunk = `${header}\n\n${fence}${ext}\n${file.content}\n${fence}\n\n`;
    chunks.push(chunk);
  }

  const contentOutput = chunks.join("").trimEnd();
  const finalParts: string[] = [];

  if (prompt) {
    finalParts.push(`${prompt}\n\n---\n\n`);
  }

  if (config.includeStats) {
    let totalLines = 0;
    let totalWords = 0;
    const typeCount = new Map<string, number>();

    for (const file of files) {
      totalLines += file.lines;
      totalWords += file.words;
      const ext = file.extension || "no-ext";
      typeCount.set(ext, (typeCount.get(ext) || 0) + 1);
    }

    // Sort by frequency so the most common file types appear first
    const sortedTypes = Array.from(typeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([ext, count]) => `${ext}(${count})`)
      .join(", ");

    const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);

    finalParts.push(
      `> Context Generated: ${timestamp}\n` +
        `> Files: ${files.length} (${sortedTypes})\n` +
        `> Total Size: ${formatSize(totalBytes)}\n` +
        `> Total Lines: ${totalLines.toLocaleString()}\n` +
        `> Total Words: ${totalWords.toLocaleString()}\n\n`
    );
  }

  finalParts.push(contentOutput);
  return { output: finalParts.join(""), sizeBytes: totalBytes };
}

export async function copyAllContents(
  clickedUri: vscode.Uri | undefined,
  selectedUris: vscode.Uri[] | undefined,
  logger: Logger,
  statusBarManager: StatusBarManager,
  prompt?: string
) {
  const config: CopyConfig = {
    excludePatterns: getGlobalExcludes(),
    disableSuccessNotifications: getConfig("codeBridge", "notifications.disableSuccess", false),
    includeStats: getConfig("codeBridge", "copy.includeStats", false),
    raw: getConfig("codeBridge", "copy.raw", false),
    maxFileSize: getConfig("codeBridge", "copy.maxFileSize", 0),
    lineWarningLimit: getConfig("codeBridge", "copy.lineWarningLimit", 50000),
    codeFence: getConfig("codeBridge", "copy.codeFence", "```"),
    removeLeadingWhitespace: getConfig("codeBridge", "copy.removeLeadingWhitespace", false),
    minifyToSingleLine: getConfig("codeBridge", "copy.minifyToSingleLine", false),
  };

  // Resolve what the user actually wants to copy.
  // Priority: specific selection > right-clicked item > active editor
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

  // Group by workspace folder to handle multi-root workspaces correctly
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
      for (const uriList of groupResults) for (const u of uriList) fileSet.set(u.fsPath, u);
    }

    const allFileUris = [...fileSet.values()].sort((a, b) => a.fsPath.localeCompare(b.fsPath));

    if (allFileUris.length === 0) {
      vscode.window.showInformationMessage("No files found (check exclude settings).");
      statusBarManager.update("idle");
      return;
    }

    // Safety check for massive accidental copies (e.g. copying node_modules)
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
      report: (msg) => statusBarManager.update("working", msg),
    });

    if (fileContents.length === 0) {
      vscode.window.showInformationMessage("No readable files found.");
      statusBarManager.update("idle");
      return;
    }

    const { output: finalContent, sizeBytes } = formatOutput(fileContents, config, prompt);
    const finalLineCount = (finalContent.match(/\n/g) || []).length + 1;

    // Warn before flooding the clipboard
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

    const MAX_CLIPBOARD_SIZE = 50 * 1024 * 1024; // 50MB usually crashes clipboards
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
          filters: { Markdown: ["md"], Text: ["txt"] },
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
      statusBarManager.update(
        "success",
        `Copied ${fileContents.length} files | ${finalLineCount.toLocaleString()} lines | ${sizeMB}`,
        4000
      );
    } else {
      statusBarManager.update("idle");
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to copy contents.`);
    logger.error("Failed during copyAllContents", error);
    statusBarManager.update("error", "Copy failed", 4000);
  }
}

export async function selectPrompt(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration("codeBridge");
  const inspection = config.inspect<Record<string, string>>("prompt.custom");

  // Hierarchy: Workspace settings > User settings > Defaults
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
    prompt: value,
  }));

  items.push({
    label: "Custom Input",
    detail: "Type a custom prompt",
    prompt: "",
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a prompt template for CodeBridge",
  });

  if (!selected) return undefined;

  if (selected.label === "Custom Input") {
    return await vscode.window.showInputBox({
      prompt: "Enter your AI prompt",
      placeHolder: "e.g., Review this code for bugs",
    });
  }
  return selected.prompt;
}
