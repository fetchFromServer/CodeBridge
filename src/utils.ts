import * as vscode from "vscode";

/**
 * A singleton logger class that writes to a dedicated VS Code output channel.
 */
export class Logger {
  private static instance: Logger;
  private readonly outputChannel: vscode.OutputChannel;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel("CodeBridge");
  }

  /**
   * Gets the singleton instance of the Logger.
   * @returns The Logger instance.
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Logs an informational message.
   * @param message The message to log.
   */
  public log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[INFO ${timestamp}] ${message}`;
    this.outputChannel.appendLine(logMessage);
    console.log(logMessage);
  }

  /**
   * Logs an error message.
   * @param message The error message to log.
   * @param error Optional error object or unknown value to include.
   */
  public error(message: string, error?: unknown): void {
    const timestamp = new Date().toLocaleTimeString();
    const errorMessage = `[ERROR ${timestamp}] ${message}`;
    this.outputChannel.appendLine(errorMessage);
    console.error(errorMessage);

    if (error) {
      if (error instanceof Error) {
        this.outputChannel.appendLine(error.stack || error.message);
      } else {
        this.outputChannel.appendLine(String(error));
      }
      console.error(error);
    }
  }

  /**
   * Shows the output channel in the UI.
   */
  public show(): void {
    this.outputChannel.show();
  }
}

/**
 * Represents the possible states of the status bar item.
 */
export type Status = "idle" | "working" | "success" | "error";

/**
 * A singleton class to manage the extension's status bar item.
 */
export class StatusBarManager implements vscode.Disposable {
  private static instance: StatusBarManager;
  private statusBarItem: vscode.StatusBarItem;
  private timeoutId: ReturnType<typeof setTimeout> | undefined;

  private constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.update("idle");
    this.statusBarItem.show();
  }

  /**
   * Gets the singleton instance of the StatusBarManager.
   * @returns The StatusBarManager instance.
   */
  public static getInstance(): StatusBarManager {
    if (!StatusBarManager.instance) {
      StatusBarManager.instance = new StatusBarManager();
    }
    return StatusBarManager.instance;
  }

  /**
   * Updates the status bar item's text, icon, and command.
   * @param status The new status to display.
   * @param message An optional message to show.
   * @param revertToIdleDelay Optional delay in ms after which to revert to idle state.
   */
  public update(status: Status, message?: string, revertToIdleDelay?: number): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }

    let icon = "";
    let text = "CodeBridge";
    let command: string | undefined = "extension.copyWithPrompt";

    switch (status) {
      case "working":
        icon = "$(sync~spin) ";
        text = message || "Working...";
        command = undefined;
        break;
      case "success":
        icon = "$(check) ";
        text = message || "Success";
        break;
      case "error":
        icon = "$(error) ";
        text = message || "Error";
        break;
      case "idle":
      default:
        icon = "$(beaker) ";
        text = "CodeBridge";
        break;
    }

    this.statusBarItem.text = `${icon}${text}`;
    this.statusBarItem.command = command;
    this.statusBarItem.tooltip = status === "idle" ? "CodeBridge: Copy context with AI prompt" : message || text;

    if (revertToIdleDelay && (status === "success" || status === "error")) {
      this.timeoutId = setTimeout(() => {
        this.update("idle");
      }, revertToIdleDelay);
    }
  }

  /**
   * Shows the status bar item.
   */
  public show() {
    this.statusBarItem.show();
  }

  /**
   * Hides the status bar item.
   */
  public hide() {
    this.statusBarItem.hide();
  }

  /**
   * Disposes of the status bar item resource.
   */
  public dispose() {
    this.statusBarItem.dispose();
  }
}

/**
 * A generic helper function to get a configuration value.
 * @param section The configuration section.
 * @param key The configuration key.
 * @param defaultValue The default value to return if the key is not found.
 * @returns The configuration value or the default.
 */
export function getConfig<T>(section: string, key: string, defaultValue: T): T {
  const config = vscode.workspace.getConfiguration(section);
  return config.get<T>(key, defaultValue);
}

/**
 * A collection of POSIX-style path manipulation functions for consistent behavior across platforms.
 */
export const posixPath = {
  dirname: (p: string) => {
    const lastSlash = p.lastIndexOf("/");
    if (lastSlash === -1) return ".";
    if (lastSlash === 0) return "/";
    return p.substring(0, lastSlash);
  },
  basename: (p: string, ext?: string) => {
    const base = p.substring(p.lastIndexOf("/") + 1);
    if (ext && base.endsWith(ext)) {
      return base.substring(0, base.length - ext.length);
    }
    return base;
  },
  extname: (p: string) => {
    const base = posixPath.basename(p);
    const lastDot = base.lastIndexOf(".");
    if (lastDot === -1) return "";
    return base.substring(lastDot);
  },
  join: (...parts: string[]) => {
    const joined = parts.join("/");
    return joined.replace(/\/+/g, "/");
  },
  normalize: (p: string) => {
    const parts = p.split("/");
    const result: string[] = [];
    for (const part of parts) {
      if (part === "..") {
        result.pop();
      } else if (part !== "." && part) {
        result.push(part);
      }
    }
    return result.join("/") || (parts.length > 0 && parts[0] === "" ? "/" : ".");
  }
};

/**
 * Extracts the file extension from a file path.
 * @param fsPath The file path string.
 * @returns The extension including the dot, or an empty string if not found.
 */
export function getFileExtension(fsPath: string): string {
  const lastDot = fsPath.lastIndexOf(".");
  if (lastDot === -1 || lastDot === 0) {
    return "";
  }
  return fsPath.substring(lastDot);
}

/**
 * Converts a glob pattern string into a regular expression.
 * Supports *, **, ?, [], and {}.
 * @param glob The glob pattern.
 * @returns A RegExp object or null if the pattern is invalid.
 */
export function globToRegex(glob: string): RegExp | null {
  try {
    let regex = "";
    let i = 0;
    while (i < glob.length) {
      const char = glob[i++];
      switch (char) {
        case "*":
          if (glob[i] === "*") {
            regex += ".*";
            i++;
          } else {
            regex += "[^/]*";
          }
          break;
        case "?":
          regex += "[^/]";
          break;
        case "[": {
          const closingIndex = glob.indexOf("]", i);
          if (closingIndex === -1) {
            regex += "\\[";
          } else {
            const classContent = glob.substring(i, closingIndex);
            regex += `[${classContent}]`;
            i = closingIndex + 1;
          }
          break;
        }
        case "{": {
          const closingIndex = glob.indexOf("}", i);
          if (closingIndex === -1) {
            regex += "\\{";
          } else {
            const groupContent = glob.substring(i, closingIndex);
            const alternatives = groupContent.split(",").map((alt) => alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
            regex += `(?:${alternatives.join("|")})`;
            i = closingIndex + 1;
          }
          break;
        }
        case ".":
        case "(":
        case ")":
        case "+":
        case "|":
        case "^":
        case "$":
        case "\\":
          regex += "\\" + char;
          break;
        default:
          regex += char;
      }
    }
    return new RegExp(`^${regex}$`);
  } catch (e) {
    return null;
  }
}

/**
 * Checks if a given relative path matches any of the provided glob patterns.
 * @param relativePath The path to check.
 * @param patterns An array of glob patterns.
 * @returns True if the path matches any pattern, false otherwise.
 */
export function isIgnored(relativePath: string, patterns: string[]): boolean {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  for (const pattern of patterns) {
    const regex = globToRegex(pattern);
    if (regex && regex.test(normalizedPath)) {
      return true;
    }
  }
  return false;
}
