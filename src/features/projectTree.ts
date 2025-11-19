import * as vscode from "vscode";
import { Logger, StatusBarManager, getConfig, getGlobalExcludes, isIgnored, posixPath } from "../utils";

interface TreeItem {
  name: string;
  type: vscode.FileType;
  children?: TreeItem[];
}

type TreeStyle = "classic" | "modern" | "minimal" | "markdown";

interface TreeConfig {
  excludePatterns: string[];
  includeHidden: boolean;
  maxDepth: number;
  directoriesOnly: boolean;
  disableSuccessNotifications: boolean;
  style: TreeStyle;
}

// Recursively builds the tree.
// We need a depth counter to stop it from exploding on deep structures (like node_modules if not excluded).
async function buildTreeData(
  uri: vscode.Uri,
  rootPath: string,
  config: TreeConfig,
  logger: Logger,
  currentDepth: number
): Promise<TreeItem[]> {
  if (config.maxDepth > 0 && currentDepth > config.maxDepth) {
    return [];
  }

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(uri);
  } catch (e) {
    logger.error(`Could not read directory ${uri.fsPath}`, e);
    return [];
  }

  const items: TreeItem[] = [];

  for (const [name, type] of entries) {
    if (!config.includeHidden && name.startsWith(".")) continue;
    if (config.directoriesOnly && type !== vscode.FileType.Directory) continue;

    const fullPath = vscode.Uri.joinPath(uri, name);

    // Calculate relative path for exclusion matching
    let relativePath = fullPath.path;

    if (currentDepth === 0) {
      relativePath = name;
    } else {
      const lowerFullPath = fullPath.path.toLowerCase();
      const lowerRootPath = rootPath.toLowerCase();

      if (lowerFullPath.startsWith(lowerRootPath)) {
        relativePath = fullPath.path.substring(rootPath.length);
        if (relativePath.startsWith("/")) relativePath = relativePath.substring(1);
      }
    }

    if (isIgnored(relativePath, config.excludePatterns)) {
      continue;
    }

    const item: TreeItem = { name, type };

    if (type === vscode.FileType.Directory) {
      item.children = await buildTreeData(fullPath, rootPath, config, logger, currentDepth + 1);
    }

    items.push(item);
  }

  // Sort directories first, then files. It just looks cleaner.
  items.sort((a, b) => {
    if (a.type === vscode.FileType.Directory && b.type !== vscode.FileType.Directory) return -1;
    if (a.type !== vscode.FileType.Directory && b.type === vscode.FileType.Directory) return 1;
    return a.name.localeCompare(b.name);
  });

  return items;
}

interface RenderOptions {
  style: TreeStyle;
  directoryIcon: string;
  fileIcon: string;
  directorySuffix: string;
  connectors: {
    branch: string;
    last: string;
    vertical: string;
    space: string;
  };
}

function getRenderOptions(style: TreeStyle): RenderOptions {
  const base = { style };
  switch (style) {
    case "modern":
      return {
        ...base,
        directoryIcon: " ",
        fileIcon: "",
        directorySuffix: "/",
        connectors: { branch: "├── ", last: "└── ", vertical: "    ", space: "    " },
      };
    case "markdown":
      return {
        ...base,
        directoryIcon: "",
        fileIcon: "",
        directorySuffix: "/",
        connectors: { branch: "* ", last: "* ", vertical: "  ", space: "  " },
      };
    case "minimal":
      return {
        ...base,
        directoryIcon: "",
        fileIcon: "",
        directorySuffix: "/",
        connectors: { branch: "", last: "", vertical: "", space: "  " },
      };
    case "classic":
    default:
      return {
        ...base,
        directoryIcon: " ",
        fileIcon: "",
        directorySuffix: "/",
        connectors: { branch: "├── ", last: "└── ", vertical: "│   ", space: "    " },
      };
  }
}

// Recursive renderer for the ASCII art
function renderTreeString(
  items: TreeItem[],
  options: RenderOptions,
  prefix: string = ""
): { text: string; count: number } {
  let result = "";
  let totalCount = 0;

  items.forEach((item, index) => {
    const isLast = index === items.length - 1;
    const connector = isLast ? options.connectors.last : options.connectors.branch;

    const icon = item.type === vscode.FileType.Directory ? options.directoryIcon : options.fileIcon;
    const suffix = item.type === vscode.FileType.Directory ? options.directorySuffix : "";

    result += `${prefix}${connector}${icon}${item.name}${suffix}\n`;
    totalCount++;

    if (item.children && item.children.length > 0) {
      // If it's the last item, we don't need the vertical pipe going down
      const childPrefix = prefix + (isLast ? options.connectors.space : options.connectors.vertical);
      const subResult = renderTreeString(item.children, options, childPrefix);
      result += subResult.text;
      totalCount += subResult.count;
    }
  });

  return { text: result, count: totalCount };
}

export async function copyProjectTree(
  targetUri: vscode.Uri | undefined,
  logger: Logger,
  statusBarManager: StatusBarManager
) {
  let rootUri: vscode.Uri;
  let rootName: string;

  // If specific folder clicked, use that. Otherwise workspace root.
  if (targetUri) {
    try {
      const stat = await vscode.workspace.fs.stat(targetUri);
      if (stat.type === vscode.FileType.Directory) {
        rootUri = targetUri;
      } else {
        rootUri = vscode.Uri.joinPath(targetUri, "..");
      }
    } catch {
      rootUri = targetUri;
    }
    rootName = posixPath.basename(rootUri.path);
  } else {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder found.");
      return;
    }
    const wf = vscode.workspace.workspaceFolders[0];
    rootUri = wf.uri;
    rootName = wf.name;
  }

  const config: TreeConfig = {
    excludePatterns: getGlobalExcludes(),
    includeHidden: getConfig("codeBridge", "tree.includeHidden", false),
    maxDepth: getConfig("codeBridge", "tree.maxDepth", 0),
    directoriesOnly: getConfig("codeBridge", "tree.directoriesOnly", false),
    disableSuccessNotifications: getConfig("codeBridge", "notifications.disableSuccess", false),
    style: getConfig("codeBridge", "tree.style", "classic"),
  };

  try {
    statusBarManager.update("working", "Generating tree...");

    const treeData = await buildTreeData(rootUri, rootUri.path, config, logger, 0);
    const renderOptions = getRenderOptions(config.style);
    const { text, count } = renderTreeString(treeData, renderOptions);

    let rootPrefix = "";
    if (config.style === "markdown") rootPrefix = "* ";

    const output = `# Project Structure: ${rootName}\n\n\`\`\`\n${rootPrefix}${rootName}${renderOptions.directorySuffix}\n${text}\`\`\`\n`;

    await vscode.env.clipboard.writeText(output);

    if (!config.disableSuccessNotifications) {
      statusBarManager.update("success", `Copied tree (${count} items)`, 4000);
    } else {
      statusBarManager.update("idle");
    }
  } catch (error) {
    vscode.window.showErrorMessage("Failed to generate project tree.");
    logger.error("Failed during copyProjectTree", error);
    statusBarManager.update("error", "Tree generation failed", 4000);
  }
}
