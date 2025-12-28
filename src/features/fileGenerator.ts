import * as vscode from 'vscode'
import { Logger, StatusBarManager, getConfig, posixPath } from '../utils'

interface GeneratorConfig {
  overwriteExisting: boolean
  disableFileSelection: boolean
  disableSuccessNotifications: boolean
}

const DEFAULT_EXTENSION = 'txt'
const FENCE_CHARS = ['`', '~']
// AI models love to put filenames in comments above the code block.
const PATH_COMMENT_PREFIXES = ['//', '#', '--', '/*', '*', '<!--', '%', "'"]
const SIMPLE_PATH_REGEX = /^(\.?[\\\/]?[\w\-\s\.\[\]\(\)@+]*[\\\/])*[\w\-\s\[\]\(\)@+]+\.[\w]+/

interface FileData {
  filePath: string
  content: string
}

type OverwritePolicy = {
  value: 'ask' | 'overwrite' | 'skip'
}

// Mapping language hints (e.g. ```javascript) to file extensions.
const LANG_MAP: Record<string, { ext?: string; special?: 'dockerfile' }> = {
  js: { ext: '.js' },
  javascript: { ext: '.js' },
  mjs: { ext: '.mjs' },
  cjs: { ext: '.cjs' },
  jsx: { ext: '.jsx' },
  ts: { ext: '.ts' },
  tsx: { ext: '.tsx' },
  typescript: { ext: '.ts' },
  html: { ext: '.html' },
  css: { ext: '.css' },
  scss: { ext: '.scss' },
  less: { ext: '.less' },
  json: { ext: '.json' },
  jsonc: { ext: '.json' },
  yaml: { ext: '.yaml' },
  yml: { ext: '.yml' },
  ini: { ext: '.ini' },
  toml: { ext: '.toml' },
  sh: { ext: '.sh' },
  bash: { ext: '.sh' },
  shell: { ext: '.sh' },
  powershell: { ext: '.ps1' },
  ps1: { ext: '.ps1' },
  py: { ext: '.py' },
  python: { ext: '.py' },
  rb: { ext: '.rb' },
  ruby: { ext: '.rb' },
  php: { ext: '.php' },
  go: { ext: '.go' },
  rs: { ext: '.rs' },
  rust: { ext: '.rs' },
  c: { ext: '.c' },
  h: { ext: '.h' },
  cpp: { ext: '.cpp' },
  cxx: { ext: '.cpp' },
  cc: { ext: '.cpp' },
  cplusplus: { ext: '.cpp' },
  hpp: { ext: '.hpp' },
  cs: { ext: '.cs' },
  csharp: { ext: '.cs' },
  java: { ext: '.java' },
  kt: { ext: '.kt' },
  kotlin: { ext: '.kt' },
  swift: { ext: '.swift' },
  rspec: { ext: '.rb' },
  md: { ext: '.md' },
  markdown: { ext: '.md' },
  dockerfile: { special: 'dockerfile' },
  svelte: { ext: '.svelte' },
  vue: { ext: '.vue' },
  graphql: { ext: '.graphql' },
  gql: { ext: '.graphql' },
  proto: { ext: '.proto' },
  sql: { ext: '.sql' },
  hcl: { ext: '.hcl' },
  tf: { ext: '.tf' },
  text: { ext: '.txt' },
  plain: { ext: '.txt' },
}

function mapLangToExt(lang?: string): {
  ext: string | null
  special?: 'dockerfile'
} {
  if (!lang) return { ext: null }
  const key = lang.trim().toLowerCase()
  const entry = LANG_MAP[key]
  if (!entry) return { ext: null }
  if (entry.special === 'dockerfile') return { ext: '', special: 'dockerfile' }
  return { ext: entry.ext ?? null }
}

interface CodeBlock {
  startLine: number
  endLine: number
  lang?: string
  content: string
}

// Manual parser for markdown code blocks. We don't use a library here to keep
// the extension size small and dependencies low.
function extractCodeBlocks(input: string): CodeBlock[] {
  const lines = input.split(/\r?\n/)
  const blocks: CodeBlock[] = []

  let inBlock = false
  let startLine = -1
  let lang = ''
  let currentFence = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Detect start/end of blocks
    if (FENCE_CHARS.some((char) => trimmed.startsWith(char))) {
      const match = trimmed.match(/^([`~]{3,})/)

      if (match) {
        const fence = match[1]

        if (inBlock) {
          // Closing fence must match length and char of opening fence
          if (fence.length >= currentFence.length && fence.charAt(0) === currentFence.charAt(0)) {
            const content = lines.slice(startLine + 1, i).join('\n')
            // Filter out empty blocks or artifacts
            if (content.trim().length > 0 || lines.length > startLine + 1) {
              blocks.push({ startLine, endLine: i, lang, content })
            }
            inBlock = false
            lang = ''
            startLine = -1
            currentFence = ''
          }
        } else {
          inBlock = true
          startLine = i
          currentFence = fence

          // Extract language info from the same line (e.g. ```typescript)
          const rawMetadata = trimmed.slice(fence.length).trim()
          const cleanedMetadata = rawMetadata.replace(/^[`~]+/, '').trim()
          lang = cleanedMetadata.split(/\s+/)[0]
        }
      }
    }
  }
  return blocks
}

function parseLlmOutput(llmOutput: string): FileData[] {
  const files: FileData[] = []
  const usedNames = new Set<string>()
  const lines = llmOutput.split(/\r?\n/)

  const blocks = extractCodeBlocks(llmOutput)

  const cleanLine = (line: string): string => {
    const trimmed = line.trim()
    for (const prefix of PATH_COMMENT_PREFIXES) {
      if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim()
    }
    return trimmed
  }

  // Extracts file paths from markdown headers (e.g. "**File: src/index.ts**", "`path/file.js`")
  const extractPathFromHeader = (line: string): string | null => {
    if (line.includes('console.') || line.includes('import ') || line.includes('require(')) {
      return null
    }

    let cleaned = line
      .replace(/[*`#]/g, '')
      .replace(/^(?:File|Path|Filename|Location|Pfad|Die Datei|Datei|Eine File)[:\s]+/i, '')
      .trim()

    for (const token of cleaned.split(/\s+/)) {
      let candidate = token.replace(/[,;:!?"']+$/, '')

      if (!/\.[a-zA-Z0-9]{1,10}$/.test(candidate)) continue

      if (/[;{}=<>"'`]/.test(candidate)) continue

      if (candidate.includes('/') || candidate.includes('\\') || /^[.@]/.test(candidate)) {
        if (candidate.length > 2) return candidate
      }
    }

    for (const token of cleaned.split(/\s+/)) {
      const c = token.replace(/[,;:!?"']+$/, '').toLowerCase()
      if (
        ['makefile', 'dockerfile', '.gitignore', '.dockerignore', '.editorconfig'].includes(c) ||
        c.startsWith('.env')
      ) {
        return token.replace(/[,;:!?"']+$/, '')
      }
    }

    return null
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    let filePath: string | null = null
    let finalContent = block.content
    let extInfo = mapLangToExt(block.lang)

    // Strategy 1: Look 1-3 lines ABOVE the block for a filename
    if (!filePath) {
      const prevEnd = i > 0 ? blocks[i - 1].endLine : -1
      for (let j = block.startLine - 1; j > prevEnd && j >= block.startLine - 3; j--) {
        const line = lines[j]
        if (!line.trim()) continue
        const potentialPath = extractPathFromHeader(line)
        if (potentialPath) {
          filePath = potentialPath
          break
        }
      }
    }

    // Strategy 2: Look INSIDE the first line of the block (e.g. // src/index.ts)
    if (!filePath) {
      const contentLines = finalContent.split('\n')
      const firstLine = contentLines[0] ?? ''
      const firstLineTrim = firstLine.trim()

      if (firstLineTrim) {
        const cleaned = cleanLine(firstLine)

        let candidate = cleaned
        const statsIndex = candidate.indexOf(' [')
        if (statsIndex !== -1) candidate = candidate.substring(0, statsIndex).trim()

        if (SIMPLE_PATH_REGEX.test(candidate)) {
          filePath = candidate
          // Remove the filename line so it doesn't end up in the code
          finalContent = contentLines.slice(1).join('\n').replace(/^\n/, '')
        } else {
          // Sometimes the first line is just "typescript"
          if (!block.lang) {
            const maybeLang = firstLineTrim.toLowerCase()
            const mapped = mapLangToExt(maybeLang)
            if (mapped.ext !== null || mapped.special) {
              extInfo = mapped
              finalContent = contentLines.slice(1).join('\n')
            }
          }
        }
      }
    }

    // Skip tree structures that might look like code blocks
    if (!filePath) {
      if (
        finalContent.includes('├──') ||
        finalContent.includes('└──') ||
        finalContent.includes('│')
      ) {
        continue
      }
    }

    // Fallback: Name it temp_file_X if we really can't find a name
    if (!filePath) {
      if (extInfo.special === 'dockerfile') {
        filePath = 'Dockerfile'
      } else {
        const temp = `temp_file_${i + 1}`
        const ext = extInfo.ext || `.${DEFAULT_EXTENSION}`
        filePath = `${temp}${ext}`
      }
    }

    let finalName = filePath.replace(/\\/g, '/')
    finalName = posixPath.normalize(finalName)

    if (finalName.endsWith('/')) continue

    // Append extension if missing
    const currentExt = posixPath.extname(finalName)
    if (!currentExt) {
      if (extInfo.special === 'dockerfile') {
        const dir = posixPath.dirname(finalName)
        const base = posixPath.basename(finalName)
        if (base.toLowerCase() !== 'dockerfile') {
          finalName = dir === '.' ? 'Dockerfile' : posixPath.join(dir, 'Dockerfile')
        }
      } else if (extInfo.ext) {
        finalName = `${finalName}${extInfo.ext}`
      }
    }

    // Handle duplicate filenames in the same output by appending counters
    let unique = finalName
    let counter = 1
    while (usedNames.has(unique)) {
      const dir = posixPath.dirname(unique)
      const ext = posixPath.extname(unique)
      const base = posixPath.basename(unique, ext)
      const nextBase = `${base}_${counter++}`
      unique = dir === '.' ? `${nextBase}${ext}` : posixPath.join(dir, `${nextBase}${ext}`)
    }

    files.push({ filePath: unique, content: finalContent })
    usedNames.add(unique)
  }

  return files
}

async function ensureDirectoryExists(directoryUri: vscode.Uri, logger: Logger): Promise<void> {
  const parentUri = vscode.Uri.joinPath(directoryUri, '..')
  // Root check
  if (parentUri.path === directoryUri.path) return

  try {
    await vscode.workspace.fs.stat(parentUri)
  } catch {
    // Recursive creation
    await ensureDirectoryExists(parentUri, logger)
  }

  try {
    await vscode.workspace.fs.createDirectory(directoryUri)
  } catch (e) {
    // Check if it's actually a file blocking the directory creation
    try {
      const stat = await vscode.workspace.fs.stat(directoryUri)
      if (stat.type !== vscode.FileType.Directory) {
        const message = `Cannot create directory. A file with the same name exists: ${directoryUri.fsPath}`
        logger.error(message)
        throw new Error(message)
      }
    } catch (statError) {
      logger.error(`Failed to create or stat directory ${directoryUri.fsPath}`, e)
      throw e
    }
  }
}

async function createFile(
  fileData: FileData,
  baseDirUri: vscode.Uri,
  config: GeneratorConfig,
  overwritePolicy: OverwritePolicy,
  logger: Logger
): Promise<'created' | 'skipped' | 'error'> {
  const normalized = posixPath.normalize(fileData.filePath)

  // Safety: prevent AI from writing to /etc/passwd or similar via ../../../
  if (normalized.startsWith('..') || normalized.startsWith('/')) {
    logger.error(`Path traversal blocked: ${normalized}`)
    return 'error'
  }

  const fileUri = vscode.Uri.joinPath(baseDirUri, normalized)

  try {
    try {
      await vscode.workspace.fs.stat(fileUri)
      // File exists, check policy
      if (overwritePolicy.value === 'skip') return 'skipped'
      if (overwritePolicy.value === 'ask' && !config.overwriteExisting) {
        const answer = await vscode.window.showWarningMessage(
          `File exists: ${normalized}`,
          { modal: true },
          'Overwrite',
          'Skip',
          'Overwrite All',
          'Skip All'
        )
        if (answer === 'Skip') return 'skipped'
        if (answer === 'Skip All') {
          overwritePolicy.value = 'skip'
          return 'skipped'
        }
        if (answer === 'Overwrite All') {
          overwritePolicy.value = 'overwrite'
        }
        if (!answer) return 'skipped'
      }
    } catch {}

    const dirUri = vscode.Uri.joinPath(fileUri, '..')
    await ensureDirectoryExists(dirUri, logger)

    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(fileData.content))
    logger.log(`File created successfully: ${fileUri.fsPath}`)
    return 'created'
  } catch (e) {
    logger.error(`Failed to create file ${fileUri.fsPath}`, e)
    return 'error'
  }
}

export async function generateFilesFromLlmOutput(
  llmOutput: string,
  targetDirectoryUri: vscode.Uri,
  logger: Logger,
  statusBarManager: StatusBarManager
) {
  const config: GeneratorConfig = {
    overwriteExisting: getConfig('codeBridge', 'generator.overwriteExisting', false),
    disableFileSelection: getConfig('codeBridge', 'generator.disableFileSelection', false),
    disableSuccessNotifications: getConfig('codeBridge', 'notifications.disableSuccess', false),
  }

  const parsed = parseLlmOutput(llmOutput)

  if (!parsed.length) {
    vscode.window.showWarningMessage('No code blocks found in clipboard.')
    return
  }

  // Sort by depth (folders first-ish) and name to keep the UI list organized
  parsed.sort((a, b) => {
    const pa = a.filePath.split('/')
    const pb = b.filePath.split('/')
    const len = Math.min(pa.length, pb.length)
    for (let i = 0; i < len; i++) {
      const lastA = i === pa.length - 1
      const lastB = i === pb.length - 1
      if (lastA && !lastB) return 1
      if (!lastA && lastB) return -1
      const cmp = pa[i].localeCompare(pb[i])
      if (cmp !== 0) return cmp
    }
    return pa.length - pb.length
  })

  let filesToCreate: FileData[] = []

  if (config.disableFileSelection) {
    filesToCreate = parsed
  } else {
    const items = parsed.map((file) => {
      const lineCount = file.content.split(/\r\n|\r|\n/).length
      const sizeKB = (file.content.length / 1024).toFixed(1)

      return {
        label: file.filePath,
        description: `$(list-unordered) ${lineCount} Lines  $(database) ${sizeKB} KB`,
        picked: true,
        fileData: file,
      }
    })

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: `Found ${parsed.length} files. Select which ones to generate.`,
      ignoreFocusOut: true,
    })

    if (!selected || selected.length === 0) {
      vscode.window.showInformationMessage('File generation cancelled.')
      return
    }
    filesToCreate = selected.map((i) => i.fileData)
  }

  if (!filesToCreate.length) {
    vscode.window.showInformationMessage('No files selected to generate.')
    return
  }

  const results = { created: 0, skipped: 0, errors: 0 }
  const errorMessages: string[] = []
  const overwritePolicy: OverwritePolicy = { value: 'ask' }

  try {
    statusBarManager.update('working', `Generating ${filesToCreate.length} file(s)...`)

    for (let i = 0; i < filesToCreate.length; i++) {
      const f = filesToCreate[i]
      statusBarManager.update('working', `(${i + 1}/${filesToCreate.length}) ${f.filePath}`)
      const status = await createFile(f, targetDirectoryUri, config, overwritePolicy, logger)
      if (status === 'created') results.created++
      else if (status === 'skipped') results.skipped++
      else {
        results.errors++
        errorMessages.push(f.filePath)
      }
    }

    if (results.created > 0) {
      // Trigger VS Code to update the explorer view so the new files show up
      await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer')
    }

    const parts = [] as string[]
    if (results.created > 0) parts.push(`${results.created} created`)
    if (results.skipped > 0) parts.push(`${results.skipped} skipped`)
    if (results.errors > 0) parts.push(`${results.errors} failed`)
    const message = parts.join(' | ')

    if (results.errors > 0) {
      vscode.window.showErrorMessage(`${message}\n\nFailed files:\n${errorMessages.join('\n')}`)
      statusBarManager.update('error', 'Generation failed', 4000)
    } else if (
      !config.disableSuccessNotifications &&
      (results.created > 0 || results.skipped > 0)
    ) {
      statusBarManager.update('success', message, 4000)
    } else {
      statusBarManager.update('idle')
    }
  } catch (error) {
    vscode.window.showErrorMessage('Failed to generate files.')
    logger.error('Failed during generateFilesFromLlmOutput', error)
    statusBarManager.update('error', 'Generation failed', 4000)
  }
}
