# CodeBridge: AI Context & Workflow

**The missing link between VS Code and LLMs.**

CodeBridge is the fastest way to get your project's context into any AI chat (ChatGPT, Claude, Copilot) and turn AI responses back into real files. Designed for maximum efficiency, token optimization, and developer control.

### Core Features

- **Smart Context Copy:** Copy single files, multi-selections, or entire folders formatted perfectly for LLMs.
- **Persona-Based Prompts:** Use built-in roles (Architect, Senior Engineer, Security Auditor) to get higher-quality answers.
- **Token Optimization:** Reduce token usage by up to 40% with whitespace trimming and minification modes.
- **Project Tree:** Generate a clean, visual directory structure to explain your architecture to the AI.
- **File Generator:** Turn AI code blocks back into actual files with a single command.

---

## Quick Start

#### 1. Send Context TO AI

1.  Right-click any file or folder in the VS Code Explorer.
2.  Select **"Copy + AI Prompt"**.
3.  Choose a persona (e.g., _"Deep Code Review"_ or _"Refactor to Modern Standards"_).
4.  Paste into ChatGPT/Claude.

#### 2. Create Files FROM AI

1.  Copy the AI's response (make sure it includes code blocks).
2.  Right-click the destination folder in VS Code.
3.  Select **"Generate Files from Clipboard"**.
4.  Select exactly which files you want to create from the list.

---

## Detailed Features

### Smart Context Copy

- **Intelligent Formatting:** Automatically wraps code in Markdown fences with language tags and file paths.
- **Binary Safety:** Automatically skips images, PDFs, and binaries to prevent clipboard clutter.
- **Global Excludes:** Respects your `.gitignore` and VS Code's `files.exclude` settings automatically.

### Token Optimization

Save money and context window space with advanced copy modes:

- **Raw Mode:** Copies code only. No markdown, no paths, no headers.
- **Whitespace Trimming:** Removes leading indentation from every line.
- **Single-Line Minification:** Collapses files into single lines (aggressive savings).

### Project Tree

Explain your app structure without copying the code.

- **Styles:** Choose between `classic` (├──), `modern` (clean), `minimal` (indentation), or `markdown`.
- **Depth Control:** Limit how deep the tree generation goes to keep it readable.

### AI File Generator

- **Smart Parsing:** Detects filenames from code comments (`// src/utils.ts`) or headers.
- **Auto-Directory:** Automatically creates missing folders (e.g., `src/components/ui`).
- **Safe Mode:** Interactive checklist lets you pick files and warns before overwriting existing ones.

---

## Configuration Reference

Adjust behavior in **Settings > CodeBridge**.

| Setting                                     | Description                                               | Default      |
| :------------------------------------------ | :-------------------------------------------------------- | :----------- |
| **General**                                 |                                                           |              |
| `codeBridge.enabledFeatures`                | Toggle specific commands on/off to declutter your menu.   | `All True`   |
| `codeBridge.notifications.disableSuccess`   | Hide "Success" toasts (Errors still shown).               | `false`      |
| **Prompts**                                 |                                                           |              |
| `codeBridge.prompt.custom`                  | Define your own prompt library / personas.                | `(See JSON)` |
| **Copying**                                 |                                                           |              |
| `codeBridge.copy.includeStats`              | Add file count, token estimates, and language breakdown.  | `false`      |
| `codeBridge.copy.raw`                       | Copy plain text only (no markdown formatting).            | `false`      |
| `codeBridge.copy.codeFence`                 | Custom fence string (e.g. `~~~` or ````).                 | ````         |
| `codeBridge.copy.removeLeadingWhitespace`   | Trim indentation to save tokens.                          | `false`      |
| `codeBridge.copy.minifyToSingleLine`        | Collapse code into single lines.                          | `false`      |
| `codeBridge.copy.maxFileSize`               | Max bytes per file to copy (0 = unlimited).               | `0`          |
| `codeBridge.copy.lineWarningLimit`          | Warn before copying more than X lines.                    | `50000`      |
| **Project Tree**                            |                                                           |              |
| `codeBridge.tree.style`                     | Visual style: `classic`, `modern`, `minimal`, `markdown`. | `classic`    |
| `codeBridge.tree.maxDepth`                  | Max directory depth to traverse.                          | `0`          |
| `codeBridge.tree.includeHidden`             | Show dotfiles (like `.env`) in the tree.                  | `false`      |
| `codeBridge.tree.directoriesOnly`           | Hide files, show folders only.                            | `false`      |
| **Generator**                               |                                                           |              |
| `codeBridge.generator.overwriteExisting`    | Overwrite files without asking.                           | `false`      |
| `codeBridge.generator.disableFileSelection` | Skip the review list and generate immediately.            | `false`      |

---

## FAQ

**How do I add my own prompts?**
Go to Settings -> Search "CodeBridge Prompts" -> Edit in `settings.json`. You can add your own keys and values there. The extension will prioritize your workspace or user settings over the defaults.

**Why isn't `node_modules` being copied?**
CodeBridge automatically uses your standard VS Code `files.exclude` and `search.exclude` settings. If a folder is grayed out or hidden in your Explorer, CodeBridge won't copy it.

**Does the Token Optimization break code?**

- `removeLeadingWhitespace`: Safe for C-style languages (JS, TS, Java, C#). **Do not use** for Python or YAML.
- `minifyToSingleLine`: Useful for CSS/JSON or if the AI just needs to "read" the logic, but it destroys readability.
