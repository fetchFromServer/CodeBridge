import * as vscode from "vscode";
import { Logger, StatusBarManager, getConfig, isIgnored, posixPath } from "../utils";

/**
 * Defines the available visual styles for the project tree.
 */
type TreeStyle = "classic" | "modern" | "minimal" | "markdown";

/**
 * Configuration options for building the project tree.
 */
interface TreeOptions {
  excludePatterns: string[];
  includeHidden: boolean;
  directoryIcon: string;
  fileIcon: string;
  directorySuffix: string;
  connectors: {
    branch: string;
    last: string;
    line: string;
    extension: string;
  };
  disableSuccessNotifications: boolean;
}

/**
 * Recursively builds a string representation of the directory tree.
 * @param uri The URI of the directory to start from.
 * @param options The formatting and filtering options for the tree.
 * @param rootUri The root URI of the entire operation.
 * @param logger The logger instance.
 * @param prefix The string prefix for the current line, used for indentation.
 * @returns A promise that resolves to an object containing the tree string and total item count.
 */
async function buildTree(
  uri: vscode.Uri,
  options: TreeOptions,
  rootUri: vscode.Uri,
  logger: Logger,
  prefix = ""
): Promise<{ tree: string; count: number }> {
  let entries: [string, vscode.FileType][] = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(uri);
  } catch (e) {
    logger.error(`Could not read directory ${uri.fsPath}`, e);
    return { tree: "", count: 0 };
  }

  const filteredEntries: [string, vscode.FileType][] = [];
  for (const [name, type] of entries) {
    if (!options.includeHidden && name.startsWith(".")) continue;

    const fullPath = vscode.Uri.joinPath(uri, name);
    const relativePath = vscode.workspace.asRelativePath(fullPath, false).replace(/\\/g, "/");

    if (isIgnored(relativePath, options.excludePatterns)) {
      continue;
    }
    filteredEntries.push([name, type]);
  }

  const sorted = filteredEntries.sort((a, b) => {
    if (a[1] === vscode.FileType.Directory && b[1] !== vscode.FileType.Directory) return -1;
    if (a[1] !== vscode.FileType.Directory && b[1] === vscode.FileType.Directory) return 1;
    return a[0].localeCompare(b[0]);
  });

  const result: string[] = [];
  let totalCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    const [name, type] = sorted[i];
    const isLast = i === sorted.length - 1;
    const connector = isLast ? options.connectors.last : options.connectors.branch;
    const extension = isLast ? options.connectors.extension : options.connectors.line;

    if (type === vscode.FileType.Directory) {
      const dirUri = vscode.Uri.joinPath(uri, name);
      const subResult = await buildTree(dirUri, options, rootUri, logger, prefix + extension);
      totalCount += subResult.count;

      result.push(`${prefix}${connector}${options.directoryIcon}${name}${options.directorySuffix}`);
      if (subResult.tree) result.push(subResult.tree);
    } else if (type === vscode.FileType.File) {
      totalCount += 1;
      result.push(`${prefix}${connector}${options.fileIcon}${name}`);
    }
  }

  return { tree: result.join("\n"), count: totalCount };
}

/**
 * Main command handler for copying the project tree structure.
 * @param targetUri The URI to generate the tree from. Defaults to the workspace root.
 * @param logger The logger instance.
 * @param statusBarManager The status bar manager instance.
 */
export async function copyProjectTree(
  targetUri: vscode.Uri | undefined,
  logger: Logger,
  statusBarManager: StatusBarManager
) {
  const baseWorkspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!baseWorkspaceFolder) {
    vscode.window.showErrorMessage("No workspace folder found.");
    return;
  }

  let treeRootUri = baseWorkspaceFolder.uri;
  let treeRootName = baseWorkspaceFolder.name;

  if (targetUri) {
    try {
      const stat = await vscode.workspace.fs.stat(targetUri);
      if (stat.type === vscode.FileType.Directory) {
        treeRootUri = targetUri;
      } else if (stat.type === vscode.FileType.File) {
        treeRootUri = vscode.Uri.joinPath(targetUri, "..");
      }
      treeRootName = posixPath.basename(treeRootUri.path);
    } catch (e) {
      logger.error(`Failed to stat target URI ${targetUri.fsPath}`, e);
    }
  }

  const treeStyle = getConfig<TreeStyle>("codeBridge", "tree.style", "classic");
  const baseOptions = {
    excludePatterns: getConfig("codeBridge", "exclude", ["**/node_modules", "**/.git"]),
    includeHidden: getConfig("codeBridge", "tree.includeHidden", false),
    disableSuccessNotifications: getConfig("codeBridge", "notifications.disableSuccess", false)
  };

  let styleOptions;
  let initialPrefix = "";
  let rootPrefix = "";

  switch (treeStyle) {
    case "modern":
      styleOptions = {
        directoryIcon: " ",
        fileIcon: "",
        directorySuffix: "/",
        connectors: {
          branch: "├── ",
          last: "└── ",
          line: "    ",
          extension: "    "
        }
      };
      initialPrefix = "";
      rootPrefix = "";
      break;
    case "markdown":
      styleOptions = {
        directoryIcon: "",
        fileIcon: "",
        directorySuffix: "/",
        connectors: {
          branch: "* ",
          last: "* ",
          line: "  ",
          extension: "  "
        }
      };
      initialPrefix = "  ";
      rootPrefix = "* ";
      break;
    case "minimal":
      styleOptions = {
        directoryIcon: "",
        fileIcon: "",
        directorySuffix: "/",
        connectors: { branch: "", last: "", line: "", extension: "  " }
      };
      initialPrefix = "";
      rootPrefix = "";
      break;
    case "classic":
    default:
      styleOptions = {
        directoryIcon: " ",
        fileIcon: "",
        directorySuffix: "/",
        connectors: {
          branch: "├── ",
          last: "└── ",
          line: "│   ",
          extension: "    "
        }
      };
      initialPrefix = "";
      rootPrefix = "";
      break;
  }

  const options: TreeOptions = { ...baseOptions, ...styleOptions };

  try {
    statusBarManager.update("working", "Generating tree...");
    const { tree } = await buildTree(treeRootUri, options, treeRootUri, logger, initialPrefix);
    const output = `# Project Structure: ${treeRootName}\n\n\`\`\`\n${rootPrefix}${treeRootName}${options.directorySuffix}\n${tree}\n\`\`\`\n`;

    await vscode.env.clipboard.writeText(output);

    if (!options.disableSuccessNotifications) {
      const lines = tree.split("\n").filter((line) => line.trim() !== "").length;
      const message = `Copied tree (${lines} items)`;
      statusBarManager.update("success", message, 4000);
    } else {
      statusBarManager.update("idle");
    }
  } catch (error) {
    vscode.window.showErrorMessage("Failed to generate project tree.");
    logger.error("Failed during copyProjectTree", error);
    statusBarManager.update("error", "Tree generation failed", 4000);
  }
}
