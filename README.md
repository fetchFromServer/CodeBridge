# CodeBridge: AI Code Context

Copy your entire codebase in 2 clicks. Paste AI responses back as real files.

Stop the copy-paste madness. This extension works with **any AI chat** that supports code blocks.

## Quick Start

### Copy Code TO Your AI:
1. Right-click any file/folder in VS Code
2. Select **"Copy with AI Prompt"**
3. Paste in ChatGPT, Claude, or any AI chat

### Generate Files FROM Your AI:
1. Copy the AI's complete response
2. Right-click where you want the files
3. Select **"Generate Files from Clipboard"**
4. Done - files created automatically

## The Problem This Solves

You know the drill. You're working with ChatGPT or Claude, and you need to:
- Copy 10+ files one by one into the chat
- Manually create each file the AI suggests
- Keep track of what goes where
- Waste 30 minutes on pure copy-paste work

CodeBridge fixes this. Copy entire folders at once. Generate all suggested files instantly.

## Features

### Send Code to AI
- Copy single files or entire project folders
- Automatically formats as clean markdown code blocks
- Excludes `node_modules`, `.git`, and build folders (configurable)
- Shows token count to avoid AI limits
- Access a library of expert-crafted prompts for professional results

### Generate Files from AI
- Paste any AI response containing code blocks
- Auto-detects file paths from headers like `## src/app.js`
- Creates folder structure automatically
- Preview what will be created
- Handles existing files intelligently

### Built-in & Custom Prompts
The extension comes with a set of professional, built-in prompts for common tasks. You have full control to use them, disable them, or replace them entirely with your own library.

- **Set Conversation Context:** Load the entire codebase for complex, multi-step questions.
- **Critical Review:** Perform a detailed audit for bugs, vulnerabilities, and performance issues.
- **Refactor:** Improve code structure, readability, and apply modern design patterns.
- **Generate Docs:** Create comprehensive documentation in standard formats.
- **Explain Architecture:** Get a high-level overview of the code's structure and logic.
- **Analyze Performance:** Find and fix performance bottlenecks.

## Installation

**From VS Code:**
1. Open Extensions (`Ctrl+Shift+X`)
2. Search: **"CodeBridge"**
3. Install

**From Marketplace:**
[Install from Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=fetchFromServer.codebridge)

## Prompt Configuration

You have two main ways to manage the prompt list:

### 1. Disable Default Prompts
If you prefer a completely empty list and want to type a custom prompt every time, you can disable the built-in ones in your `settings.json`:
```json
"codeBridge.useDefaultPrompts": false
```

### 2. Replace Default Prompts
To use your own library of prompts, simply define them in your `settings.json`. **This will completely replace the built-in list.**
```json
"codeBridge.customPrompts": {
    "Translate to Python": "Translate the following code to idiomatic Python, maintaining all functionality.",
    "Write Unit Tests": "Generate unit tests for this code using Jest, covering all major logic paths and edge cases."
}
```

## Keyboard Shortcuts

- **Copy with Prompt:** `Ctrl+Shift+Alt+C` (Mac: `Cmd+Shift+Alt+C`)

You can customize this in VS Code's keyboard settings.

## FAQ

**How do I use only my own prompts?**  
Define your list in the `codeBridge.customPrompts` setting. This will automatically replace the defaults.

**How do I turn off the built-in prompts without adding my own?**  
Set `codeBridge.useDefaultPrompts` to `false` in your settings.