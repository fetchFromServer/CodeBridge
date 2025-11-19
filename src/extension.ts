import * as vscode from "vscode";
import { copyAllContents, selectPrompt } from "./features/copyContents";
import { generateFilesFromLlmOutput } from "./features/fileGenerator";
import { copyProjectTree } from "./features/projectTree";
import { Logger, StatusBarManager } from "./utils";

/**
 * Defines the structure of the enabled features configuration object.
 */
interface EnabledFeatures {
  copyContents: boolean;
  copyWithPrompt: boolean;
  generateFiles: boolean;
  projectTree: boolean;
}

// Helper to keep command registration clean.
// We check the config inside the callback so we don't have to restart VS Code
// if the user toggles a feature setting.
function registerCommandWithConfigCheck(
  commandId: string,
  featureKey: keyof EnabledFeatures,
  callback: (...args: any[]) => any,
  disabledMessage: string
): vscode.Disposable {
  return vscode.commands.registerCommand(commandId, (...args: any[]) => {
    const config = vscode.workspace.getConfiguration("codeBridge");
    const features = config.get<EnabledFeatures>("enabledFeatures", {
      copyContents: true,
      copyWithPrompt: true,
      generateFiles: true,
      projectTree: true,
    });

    if (!features[featureKey]) {
      vscode.window.showWarningMessage(disabledMessage);
      return;
    }
    return callback(...args);
  });
}

export function activate(context: vscode.ExtensionContext) {
  const logger = Logger.getInstance();
  const statusBarManager = StatusBarManager.getInstance();
  logger.log("CodeBridge extension activated.");

  // Syncs the VS Code 'when' clauses with our config.
  // This ensures context menu items disappear immediately if disabled in settings.
  const updateContextKeys = () => {
    const config = vscode.workspace.getConfiguration("codeBridge");
    const features = config.get<EnabledFeatures>("enabledFeatures", {
      copyContents: true,
      copyWithPrompt: true,
      generateFiles: true,
      projectTree: true,
    });

    const setContext = vscode.commands.executeCommand;

    setContext("codeBridge.copyContentsEnabled", features.copyContents);
    setContext("codeBridge.copyWithPromptEnabled", features.copyWithPrompt);
    setContext("codeBridge.generateFilesEnabled", features.generateFiles);
    setContext("codeBridge.projectTreeEnabled", features.projectTree);

    // Only show the status bar item if the main prompt feature is active
    if (features.copyWithPrompt) {
      statusBarManager.show();
    } else {
      statusBarManager.hide();
    }
  };

  // Initial sync
  updateContextKeys();

  // Watch for config changes so we don't need a reload
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("codeBridge.enabledFeatures")) {
      updateContextKeys();
      logger.log("CodeBridge enabled features settings updated.");
    }
  });

  const copyContentsCommand = registerCommandWithConfigCheck(
    "extension.copyAllContents",
    "copyContents",
    (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) =>
      copyAllContents(clickedUri, selectedUris, logger, statusBarManager),
    "Copy File Contents command is disabled. Enable it in settings."
  );

  const copyWithPromptCommand = registerCommandWithConfigCheck(
    "extension.copyWithPrompt",
    "copyWithPrompt",
    async (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      const prompt = await selectPrompt();
      // User cancelled the prompt selection
      if (prompt === undefined) return;
      await copyAllContents(clickedUri, selectedUris, logger, statusBarManager, prompt);
    },
    "Copy with Prompt command is disabled. Enable it in settings."
  );

  const generateFromClipboardCommand = registerCommandWithConfigCheck(
    "extension.generateFromClipboard",
    "generateFiles",
    async (targetDirectoryUri?: vscode.Uri) => {
      let targetUri = targetDirectoryUri;

      // Fallback to root workspace if command wasn't triggered from explorer context
      if (!targetUri) {
        if (vscode.workspace.workspaceFolders?.length) {
          targetUri = vscode.workspace.workspaceFolders[0].uri;
        } else {
          vscode.window.showErrorMessage("No target folder found.");
          return;
        }
      }

      const clipboardContent = await vscode.env.clipboard.readText();
      if (!clipboardContent.trim()) {
        vscode.window.showWarningMessage("Clipboard is empty.");
        return;
      }
      await generateFilesFromLlmOutput(clipboardContent, targetUri, logger, statusBarManager);
    },
    "Generate Files command is disabled. Enable it in settings."
  );

  const projectTreeCommand = registerCommandWithConfigCheck(
    "extension.copyProjectTree",
    "projectTree",
    (uri?: vscode.Uri) => copyProjectTree(uri, logger, statusBarManager),
    "Copy Project Tree command is disabled. Enable it in settings."
  );

  context.subscriptions.push(
    copyContentsCommand,
    copyWithPromptCommand,
    generateFromClipboardCommand,
    projectTreeCommand,
    statusBarManager,
    configWatcher
  );
}

export function deactivate() {
  const logger = Logger.getInstance();
  StatusBarManager.getInstance().dispose();
  logger.log("CodeBridge extension deactivated.");
}
