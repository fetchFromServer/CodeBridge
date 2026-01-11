# CodeBridge: AI Context & Workflow

**The missing link between VS Code and LLMs.**

CodeBridge is the fastest way to get your project's context into any AI chat (ChatGPT, Claude, Copilot) and turn AI responses back into real files. Designed for maximum efficiency, token optimization, and developer control.

---

## Core Features

- **Smart Context Copy:** Copy single files, multi-selections, or entire folders formatted perfectly for LLMs.
- **Diagnostics Integration:** Automatically include VS Code errors and warnings inline with your code.
- **Dependency Bundling:** Deep scan to automatically include imported/referenced files.
- **Persona-Based Prompts:** Use built-in roles (Architect, Senior Engineer) or define your own.
- **Token Optimization:** Reduce token usage with whitespace trimming and minification modes.
- **Project Tree:** Generate a clean, visual directory structure to explain your architecture.
- **File Generator:** Turn AI code blocks back into actual files with a single command.

---

## Quick Start

### Send Context TO AI

1. Right-click any file or folder in the VS Code Explorer.
2. Select **"Copy for AI"** (quick) or open **"CodeBridge Context"** submenu for more options.
3. Paste into ChatGPT/Claude.

### Create Files FROM AI

1. Copy the AI's response (must include code blocks).
2. Right-click the destination folder in VS Code.
3. Select **"Create Files from Clipboard"**.
4. Select which files to create from the list.

### Keyboard Shortcuts

| Shortcut                   | Action                                   |
| -------------------------- | ---------------------------------------- |
| `Ctrl+Alt+C` / `Cmd+Alt+C` | Copy with Instruction (prompt selection) |
| `Ctrl+Alt+V` / `Cmd+Alt+V` | Create Files from Clipboard              |

---

## Commands

| Command                             | Description                                           |
| ----------------------------------- | ----------------------------------------------------- |
| **Copy for AI**                     | Copy selected files/folders with markdown formatting  |
| **Copy with Instruction...**        | Copy with a prompt template prepended                 |
| **Copy with Active Errors**         | Copy code with inline VS Code diagnostics             |
| **Bundle Dependencies (Deep Scan)** | Copy selection + automatically include imported files |
| **Copy Project Structure (Tree)**   | Copy full directory tree                              |
| **Copy Directory Skeleton**         | Copy folder structure only (no files)                 |
| **Copy Top-Level Only**             | Copy tree with depth limit of 1                       |
| **Create Files from Clipboard**     | Parse AI response and generate files                  |

---

## Features in Detail

### Diagnostics Integration

CodeBridge can include active VS Code errors and warnings directly in the copied output:

```
## [!] src/utils.ts
> [ERROR] Line 42 (ts2345): Argument of type 'string' is not assignable...
   -> Suggest: "Change type to number" (Preferred)
```

Enable with `Copy with Active Errors` or set `codeBridge.copy.includeDiagnostics: true`.

### Dependency Bundling

Use **"Bundle Dependencies (Deep Scan)"** to automatically include files that your selection imports or references. The extension uses VS Code's language server to find:

- Import/require targets
- Type definitions
- Symbol references

Limit auto-added files with `codeBridge.analysis.maxAutoFiles` (default: 5).

### Token Optimization

Save context window space:

| Mode            | Setting                              | Effect                           |
| --------------- | ------------------------------------ | -------------------------------- |
| Raw Mode        | `copy.raw: true`                     | No markdown, no paths, just code |
| Trim Whitespace | `copy.removeLeadingWhitespace: true` | Removes leading indentation      |
| Minify          | `copy.minifyToSingleLine: true`      | Collapses to single lines        |

⚠️ `removeLeadingWhitespace` breaks Python/YAML. Use only for C-style languages.

### Project Tree Styles

```
classic (default)     modern              minimal         markdown
├── src/              src/                src/            * src/
│   ├── index.ts          index.ts          index.ts      * index.ts
│   └── utils.ts          utils.ts          utils.ts      * utils.ts
└── package.json      package.json        package.json    * package.json
```

### File Generator

The parser detects filenames from:

- Markdown headers: `## src/index.ts`
- Code comments: `// src/utils.ts` or `# config.py`
- Language hints: ` ```typescript ` → `.ts` extension

Auto-creates nested directories and warns before overwriting.

---

## Configuration Reference

### General

| Setting                                   | Description                                        | Default                               |
| ----------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| `codeBridge.enabledFeatures`              | Toggle individual commands on/off                  | `All true`                            |
| `codeBridge.notifications.disableSuccess` | Hide success toasts (errors still shown)           | `false`                               |
| `codeBridge.exclude`                      | Glob patterns to exclude (extends `files.exclude`) | `["node_modules/**", "dist/**", ...]` |

### Copying

| Setting                                   | Description                                    | Default |
| ----------------------------------------- | ---------------------------------------------- | ------- |
| `codeBridge.copy.raw`                     | Plain text only, no markdown                   | `false` |
| `codeBridge.copy.includeStats`            | Add file count, size, language breakdown       | `false` |
| `codeBridge.copy.includeDiagnostics`      | Include VS Code errors/warnings inline         | `true`  |
| `codeBridge.copy.codeFence`               | Custom fence string                            | ` ``` ` |
| `codeBridge.copy.removeLeadingWhitespace` | Trim indentation                               | `false` |
| `codeBridge.copy.minifyToSingleLine`      | Collapse to single lines                       | `false` |
| `codeBridge.copy.maxFileSize`             | Skip files larger than X bytes (0 = unlimited) | `0`     |
| `codeBridge.copy.lineWarningLimit`        | Warn before copying more than X lines          | `50000` |

### Diagnostics

| Setting                                    | Description              | Default                                                  |
| ------------------------------------------ | ------------------------ | -------------------------------------------------------- |
| `codeBridge.diagnostics.allowedSeverities` | Filter by severity level | `{error: true, warning: true, info: false, hint: false}` |

### Analysis

| Setting                                  | Description                    | Default |
| ---------------------------------------- | ------------------------------ | ------- |
| `codeBridge.analysis.enabled`            | Enable dependency parsing      | `true`  |
| `codeBridge.analysis.autoCopyReferences` | Auto-include referencing files | `false` |
| `codeBridge.analysis.maxAutoFiles`       | Max files to auto-add          | `5`     |

### Project Tree

| Setting                           | Description                                | Default   |
| --------------------------------- | ------------------------------------------ | --------- |
| `codeBridge.tree.style`           | `classic`, `modern`, `minimal`, `markdown` | `classic` |
| `codeBridge.tree.maxDepth`        | Max directory depth (0 = unlimited)        | `0`       |
| `codeBridge.tree.includeHidden`   | Show dotfiles                              | `false`   |
| `codeBridge.tree.directoriesOnly` | Folders only, no files                     | `false`   |

### Generator

| Setting                                     | Description                            | Default |
| ------------------------------------------- | -------------------------------------- | ------- |
| `codeBridge.generator.overwriteExisting`    | Overwrite without asking               | `false` |
| `codeBridge.generator.disableFileSelection` | Skip review list, generate immediately | `false` |

### Prompts

| Setting                    | Description                    | Default          |
| -------------------------- | ------------------------------ | ---------------- |
| `codeBridge.prompt.custom` | Your prompt library / personas | `(See settings)` |

---

## FAQ

**How do I add my own prompts?**
Settings → Search "CodeBridge prompt.custom" → Edit in `settings.json`. Workspace settings override user settings.

**Why isn't `node_modules` being copied?**
CodeBridge respects `files.exclude`, `search.exclude`, and its own `codeBridge.exclude` patterns. Default excludes: `node_modules/**`, `dist/**`, `build/**`, `*.lock`, `*.svg`, `*.png`.

**What's the difference between "Copy for AI" and "Bundle Dependencies"?**
"Copy for AI" copies exactly what you select. "Bundle Dependencies" additionally scans for imports and includes those files automatically (up to `maxAutoFiles` limit).

**Does Token Optimization break code?**

- `removeLeadingWhitespace`: Safe for JS/TS/Java/C#. **Breaks** Python/YAML.
- `minifyToSingleLine`: Destroys readability but useful when AI just needs to analyze logic.
