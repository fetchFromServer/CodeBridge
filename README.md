# CodeBridge: AI Code Context

Copy your entire codebase in 2 clicks. Paste AI responses back as real files.

Stop the copy-paste madness. This extension works with **any AI chat** that supports code blocks.

## Quick Start

### Copy Code TO Your AI:
1.  Right-click any file/folder in VS Code.
2.  Select **"Copy + AI Prompt"**.
3.  Choose a prompt template or enter a custom one.
4.  Paste the perfectly formatted context into ChatGPT, Claude, or any AI chat.

### Generate Files FROM Your AI:
1.  Copy the AI's complete response from the chat.
2.  Right-click in the VS Code Explorer where you want the files.
3.  Select **"Generate Files from Clipboard"**.
4.  Confirm which files to create. Done!

## The Problem This Solves

You know the drill. You're working with an AI and you need to:
-   Copy 10+ files one by one into the chat.
-   Manually create each file the AI suggests.
-   Keep track of what goes where.
-   Waste 30 minutes on pure copy-paste work.

CodeBridge fixes this. Copy entire folders at once. Generate all suggested files instantly.

## Features

### Send Code to AI
-   **Flexible Selection:** Copy single files, multiple selected files, or entire project folders.
-   **Clean Formatting:** Automatically formats everything as clean markdown code blocks.
-   **Smart Exclusions:** Ignores `node_modules`, `.git`, and build folders by default (fully configurable).
-   **AI Prompt Library:** Access a library of expert-crafted prompts for professional results, or add your own.

### Generate Files from AI
-   **Universal Parsing:** Paste any AI response containing standard markdown code blocks.
-   **Automatic Path Detection:** Intelligently finds file paths mentioned in headers (`## src/app.js`) or comments (`// path/to/file.ts`).
-   **Folder Creation:** Creates the required folder structure automatically.
-   **Interactive Preview:** Review and select which files to generate before they are created.
-   **Safe Overwriting:** Asks for confirmation before overwriting existing files.

### Built-in & Custom Prompts
The extension comes with a set of professional, built-in prompts for common tasks like code reviews, refactoring, and bug hunting. You have full control to use them or replace them entirely with your own library in the VS Code settings.

## Keyboard Shortcuts

-   **Copy with Prompt:** `Ctrl+Alt+C` (Mac: `Cmd+Alt+C`)
-   **Generate from Clipboard:** `Ctrl+Alt+V` (Mac: `Cmd+Alt+V`)

You can customize these in VS Code's keyboard shortcut settings.

## Configuration

All settings can be found under the "CodeBridge" section in VS Code's settings UI or in your `settings.json` file.

Key settings include:
-   `codeBridge.exclude`: Customize the glob patterns for files and folders to ignore.
-   `codeBridge.prompt.custom`: Define your own library of prompts. This will completely replace the built-in list.
-   `codeBridge.tree.style`: Choose the visual style for the "Copy Tree" command (`classic`, `modern`, `minimal`, or `markdown`).
-   `codeBridge.copy.maxFileSize`: Set a file size limit for copying. Set to `0` to disable the limit.
-   `codeBridge.copy.lineWarningLimit`: Set a line limit for the final output to get a confirmation prompt. Set to `0` to disable the warning.

## FAQ

**How do I use only my own prompts?**  
Define your list in the `codeBridge.prompt.custom` setting. This will automatically replace the default list.

**How do I get an empty prompt list?**  
Set `codeBridge.prompt.custom` to an empty object in your settings:
```json
"codeBridge.prompt.custom": {}
```