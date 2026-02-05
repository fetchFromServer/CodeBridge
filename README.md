# CodeBridge: Workflow Utilities

A collection of utilities to bridge the gap between your codebase and external tools. Copy code with full context, visualize structures, and scaffold files directly from clipboard text.

## Features

- **Contextual Copy**: Format selected files for documentation, chat apps, or issue trackers. Includes paths and metadata.
- **Structure Visualization**: Generate ASCII trees of your project folder.
- **Diagnostics Export**: Include VS Code errors/warnings inline with your code snippets.
- **Dependency Analysis**: Automatically detect and include referenced files (imports/types).
- **File Scaffolding**: Turn text blocks containing code (e.g., from documentation or specs) into real files.

---

## Usage

### 1. Copying Context

Right-click any file or folder in the Explorer:

- **Copy Context**: Formats selection with Markdown fences and headers.
- **Copy with Template...**: Prepend a custom instruction (e.g., "Code Review", "Documentation").
- **Bundle Dependencies**: Scans imports and includes relevant files automatically.

### 2. Generating Files

If you have text in your clipboard that contains code blocks (e.g., from a tutorial or spec):

1.  Right-click the destination folder.
2.  Select **"Scaffold Files from Clipboard"**.
3.  Confirm the files to create.

### 3. Visualizing Structure

Use **"Copy Project Tree"** to get a text representation of your directory, ideal for documentation or explaining architecture.

---

## Configuration

| Setting                                 | Description                                                |
| :-------------------------------------- | :--------------------------------------------------------- |
| `codeBridge.copy.format`                | Output format (`markdown` or `text`).                      |
| `codeBridge.copy.includeDiagnostics`    | Inject active errors into the output.                      |
| `codeBridge.analysis.enabled`           | Enable dependency scanning.                                |
| `codeBridge.tree.style`                 | Tree visualization style (`classic`, `modern`, `minimal`). |
| `codeBridge.generator.conflictStrategy` | Behavior when files exist (`ask`, `overwrite`, `skip`).    |

## Shortcuts

- `Ctrl+Alt+C` (Cmd+Alt+C): Copy with Template
- `Ctrl+Alt+V` (Cmd+Alt+V): Scaffold Files from Clipboard
