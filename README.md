# CodeBridge

CodeBridge is a Visual Studio Code extension designed to streamline the developer workflow when interacting with Large Language Models (LLMs). It eliminates the tedious process of manually copying and pasting code snippets by providing a robust, context-aware bridge between your editor and any AI chat interface.

The core purpose of this tool is to facilitate two primary workflows: gathering sufficient context from your project to provide to an AI, and integrating the AI's generated code back into your project structure seamlessly.

## Core Features

*   **Effortless Context Gathering**: Right-click any file or folder in the Explorer to copy its contents and structure into a single, clean Markdown block. This is ideal for providing context for tasks like code review, refactoring, or documentation generation.

*   **Integrated AI Prompts**: Augment your copied code with predefined or custom prompts. Use the "Copy with AI Prompt" command to select from a list of templates (e.g., "Review this code for security vulnerabilities") or input a unique instruction on the fly.

*   **Automated File Generation**: Parse a complete code response from an AI model directly from your clipboard. CodeBridge intelligently detects file paths from Markdown headers or code comments and recreates the described file and directory structure within your workspace.

*   **Advanced Configuration**: Tailor the extension's behavior to your needs. Configure file exclusion patterns, set the output format (Markdown, XML, or Plain Text), and manage your personal library of custom prompts through the settings.

*   **Optimized for Performance**: The extension is built with performance in mind, utilizing lazy activation to ensure it has zero impact on VS Code's startup time. It only loads when one of its commands is executed.

*   **Remote and Virtual Workspace Ready**: CodeBridge is fully compatible with remote development environments (SSH, Dev Containers) and virtual workspaces (such as github.dev), as it relies on VS Code's native filesystem API.

## Usage

### Gathering Code for an AI Assistant

1.  In the VS Code Explorer, right-click on a file or a folder.
2.  Select **CodeBridge: Copy Contents** for a direct copy, or **CodeBridge: Copy with AI Prompt** to add instructions.
3.  Paste the resulting formatted text into your AI chat interface.

### Integrating AI-Generated Code

1.  Copy the complete code response from the AI model to your clipboard. Ensure the response includes file paths (e.g., `## src/components/Button.tsx`).
2.  In the VS Code Explorer, right-click on the target directory for the new files.
3.  Select **CodeBridge: Generate Files from Clipboard**.
4.  A preview of the files to be created will be displayed. Confirm the operation to proceed.

## Installation

1.  Launch Visual Studio Code.
2.  Go to the **Extensions** view (`Ctrl+Shift+X`).
3.  Search for `fetchFromServer.codebridge`.
4.  Click the **Install** button.

Alternatively, you can install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=fetchFromServer.codebridge) or by running the following command in the command palette (`Ctrl+Shift+P`):