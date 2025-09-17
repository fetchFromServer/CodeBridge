# CodeBridge: AI Code Context

The essential VS Code extension for AI-driven development. CodeBridge is the fastest way to get your project's context into any AI chat, designed for maximum efficiency and control.

### Core Features
-   **Full Project Copying:** Copy entire project folders into any AI chat with one command.
-   **Advanced Token Optimization:** Drastically reduce token usage with raw code mode, whitespace trimming, and single-line minification.
-   **Project Tree Formatting:** Copy a clean, visual representation of your project structure for high-level context.
-   **Custom Prompt Library:** Use a built-in library of expert prompts or define your own for consistent, high-quality results.

## Quick Start

#### 1. Copy Code TO Your AI
1.  Right-click any file or folder in the VS Code Explorer.
2.  Select **"Copy + AI Prompt"**.
3.  Choose a prompt template or enter a custom one.
4.  Paste the perfectly formatted context into any AI chat.

#### 2. Generate Files from AI Responses (Experimental)
1.  Copy the AI's complete response, including code blocks.
2.  Right-click in the VS Code Explorer where you want the files.
3.  Select **"Generate Files from Clipboard"**.
4.  Review and confirm which files to create.

## Detailed Features

### Send Code to AI
-   **Flexible Selection:** Copy single files, multiple selections, or entire folders.
-   **Smart Formatting:** Automatically formats all files as clean, labeled Markdown code blocks.
-   **Configurable Exclusions:** Ignores `node_modules`, `.git`, and other clutter by default.
-   **Token Optimization:**
    -   **Raw Mode:** Copies only code, stripping all formatting, paths, and stats.
    -   **Whitespace Trimming:** Removes leading whitespace from every line.
    -   **Single-Line Minification:** Collapses each file into a single line for maximum token savings.

### Project Tree
-   **One-Click Tree Copy:** Generate a clean project structure tree with the "Copy Tree" command.
-   **Multiple Styles:** Choose between `classic`, `modern`, `minimal`, and `markdown` tree styles in the settings.

### File Generation (Experimental)
-   **Universal Parsing:** Works with any AI response that uses standard Markdown code blocks.
-   **Automatic Path Detection:** Intelligently finds file paths from headers (`## src/app.js`) or comments (`// path/to/file.ts`).
-   **Automatic Folder Creation:** Creates the required directory structure on the fly.
-   **Interactive Preview:** Review and select which files to generate before they are written to disk.
-   **Safe Overwriting:** Asks for confirmation before overwriting existing files.

## Configuration Reference
All settings are found under the "CodeBridge" section in VS Code settings.

| Setting                                     | Description                                          | Default                    |
|---------------------------------------------|------------------------------------------------------|----------------------------|
| **General**                                 |                                                      |                            |
| `codeBridge.exclude`                        | Glob patterns for files/folders to exclude.          | `["**/node_modules", ...]` |
| `codeBridge.notifications.disableSuccess`   | Suppress success notifications.                      | `false`                    |
| **Commands**                                |                                                      |                            |
| `codeBridge.commands.enable...`             | Show or hide specific commands in the context menu.  | `true`                     |
| **Copy Content**                            |                                                      |                            |
| `codeBridge.copy.raw`                       | Copy raw code only, without Markdown formatting.     | `false`                    |
| `codeBridge.copy.includeStats`              | Prepend file/line/word count statistics.             | `false`                    |
| `codeBridge.copy.removeLeadingWhitespace`   | Remove leading whitespace from each line.            | `false`                    |
| `codeBridge.copy.minifyToSingleLine`        | Collapse each file into a single line.               | `false`                    |
| `codeBridge.copy.codeFence`                 | The string for Markdown code fences.                 | `"` ``` `"`                |
| `codeBridge.copy.ignoreBinaryFiles`         | Skip binary files when copying.                      | `true`                     |
| `codeBridge.copy.maxFileSize`               | Max file size in bytes for copying. `0` disables.    | `0`                        |
| `codeBridge.copy.lineWarningLimit`          | Warn if total lines exceed this limit. `0` disables. | `50000`                    |
| **Prompts**                                 |                                                      |                            |
| `codeBridge.prompt.custom`                  | Define your own library of prompt templates.         | `{...}`                    |
| `codeBridge.prompt.addDefault`              | Always prepend the default prompt to 'Copy Code'.    | `false`                    |
| `codeBridge.prompt.default`                 | The default prompt to use when the above is enabled. | `""`                       |
| **Project Tree**                            |                                                      |                            |
| `codeBridge.tree.style`                     | The visual style of the project tree.                | `classic`                  |
| `codeBridge.tree.includeHidden`             | Include hidden files/folders (dotfiles) in the tree. | `false`                    |
| **File Generator (Experimental)**           |                                                      |                            |
| `codeBridge.generator.createDirectories`    | Automatically create missing directories.            | `true`                     |
| `codeBridge.generator.overwriteExisting`    | Overwrite existing files without confirmation.       | `false`                    |
| `codeBridge.generator.disableFileSelection` | Generate all files without a selection prompt.       | `false`                    |


## FAQ

**How do I use only my own prompts?**
Define your list in the `codeBridge.prompt.custom` setting. This will automatically replace the default list. To get an empty prompt list, set it to `{}`.

**When should I use the token-saving options?**
They are ideal for large codebases or token-limited models. Be cautious: `minifyToSingleLine` and `removeLeadingWhitespace` can break code in languages where indentation is syntactically important.
