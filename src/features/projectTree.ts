import * as vscode from 'vscode'
import { Logger, StatusBarManager, excludesToGlobPattern, getConfig, getGlobalExcludes, posixPath } from '../utils'

interface TreeItem {
  name: string
  type: vscode.FileType
  children?: TreeItem[]
}

type TreeStyle = 'classic' | 'modern' | 'minimal' | 'markdown'

export interface TreeCommandOptions {
  maxDepth?: number
  directoriesOnly?: boolean
}

interface TreeConfig {
  excludePatterns: string[]
  includeHidden: boolean
  disableSuccessNotifications: boolean
  style: TreeStyle
  maxDepth: number
  directoriesOnly: boolean
}

async function buildTreeData(uris: vscode.Uri[], rootPath: string, config: TreeConfig): Promise<TreeItem[]> {
  const rootItems: TreeItem[] = []

  const map = new Map<string, TreeItem[]>()
  map.set('', rootItems)

  const sortedUris = uris.sort((a, b) => a.path.localeCompare(b.path))

  for (const uri of sortedUris) {
    let relative = uri.path
    if (relative.startsWith(rootPath)) {
      relative = relative.substring(rootPath.length)
      if (relative.startsWith('/')) relative = relative.substring(1)
    }

    if (relative === '') continue

    const parts = relative.split('/')
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isFile = i === parts.length - 1
      const parentChildren = map.get(currentPath)!

      if (!parentChildren) continue

      let item = parentChildren.find((c) => c.name === part)
      if (!item) {
        if (!config.includeHidden && part.startsWith('.')) {
          break
        }

        const type = isFile ? vscode.FileType.File : vscode.FileType.Directory

        if (config.directoriesOnly && type !== vscode.FileType.Directory) {
          break
        }

        item = { name: part, type }
        if (!isFile) {
          item.children = []
        }
        parentChildren.push(item)
      }

      if (isFile) break

      currentPath = currentPath ? currentPath + '/' + part : part
      if (!map.has(currentPath) && item.children) {
        map.set(currentPath, item.children)
      }
    }
  }

  if (config.maxDepth > 0) {
    pruneTree(rootItems, 0, config.maxDepth)
  }

  sortTree(rootItems)
  return rootItems
}

function pruneTree(items: TreeItem[], currentDepth: number, maxDepth: number) {
  if (currentDepth >= maxDepth) {
    items.length = 0
    return
  }
  for (const item of items) {
    if (item.children) {
      pruneTree(item.children, currentDepth + 1, maxDepth)
    }
  }
}

function sortTree(items: TreeItem[]) {
  items.sort((a, b) => {
    if (a.type === vscode.FileType.Directory && b.type !== vscode.FileType.Directory) return -1
    if (a.type !== vscode.FileType.Directory && b.type === vscode.FileType.Directory) return 1
    return a.name.localeCompare(b.name)
  })
  if (items) {
    for (const item of items) {
      if (item.children) sortTree(item.children)
    }
  }
}

interface RenderOptions {
  style: TreeStyle
  directoryIcon: string
  fileIcon: string
  directorySuffix: string
  connectors: {
    branch: string
    last: string
    vertical: string
    space: string
  }
}

function getRenderOptions(style: TreeStyle): RenderOptions {
  const base = { style }
  switch (style) {
    case 'modern':
      return {
        ...base,
        directoryIcon: ' ',
        fileIcon: '',
        directorySuffix: '/',
        connectors: { branch: '├── ', last: '└── ', vertical: '    ', space: '    ' },
      }
    case 'markdown':
      return {
        ...base,
        directoryIcon: '',
        fileIcon: '',
        directorySuffix: '/',
        connectors: { branch: '* ', last: '* ', vertical: '  ', space: '  ' },
      }
    case 'minimal':
      return {
        ...base,
        directoryIcon: '',
        fileIcon: '',
        directorySuffix: '/',
        connectors: { branch: '', last: '', vertical: '', space: '  ' },
      }
    case 'classic':
    default:
      return {
        ...base,
        directoryIcon: ' ',
        fileIcon: '',
        directorySuffix: '/',
        connectors: { branch: '├── ', last: '└── ', vertical: '│   ', space: '    ' },
      }
  }
}

function renderTreeString(
  items: TreeItem[],
  options: RenderOptions,
  prefix: string = ''
): { text: string; count: number } {
  let result = ''
  let totalCount = 0

  items.forEach((item, index) => {
    const isLast = index === items.length - 1
    const connector = isLast ? options.connectors.last : options.connectors.branch

    const icon = item.type === vscode.FileType.Directory ? options.directoryIcon : options.fileIcon
    const suffix = item.type === vscode.FileType.Directory ? options.directorySuffix : ''

    result += `${prefix}${connector}${icon}${item.name}${suffix}\n`
    totalCount++

    if (item.children && item.children.length > 0) {
      const childPrefix = prefix + (isLast ? options.connectors.space : options.connectors.vertical)
      const subResult = renderTreeString(item.children, options, childPrefix)
      result += subResult.text
      totalCount += subResult.count
    }
  })

  return { text: result, count: totalCount }
}

export async function copyProjectTree(
  targetUri: vscode.Uri | undefined,
  logger: Logger,
  statusBarManager: StatusBarManager,
  options: TreeCommandOptions = {}
) {
  let rootUri: vscode.Uri
  let rootName: string

  if (targetUri) {
    try {
      const stat = await vscode.workspace.fs.stat(targetUri)
      if (stat.type === vscode.FileType.Directory) {
        rootUri = targetUri
      } else {
        rootUri = vscode.Uri.joinPath(targetUri, '..')
      }
    } catch {
      rootUri = targetUri
    }
    rootName = posixPath.basename(rootUri.path)
  } else {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('No workspace folder found.')
      return
    }
    const wf = vscode.workspace.workspaceFolders[0]
    rootUri = wf.uri
    rootName = wf.name
  }

  const config: TreeConfig = {
    excludePatterns: getGlobalExcludes(),
    includeHidden: getConfig('codeBridge', 'tree.includeHidden', false),
    disableSuccessNotifications: getConfig('codeBridge', 'notifications.disableSuccess', false),
    style: getConfig('codeBridge', 'tree.style', 'classic'),
    maxDepth: options.maxDepth ?? getConfig('codeBridge', 'tree.maxDepth', 0),
    directoriesOnly: options.directoriesOnly ?? getConfig('codeBridge', 'tree.directoriesOnly', false),
  }

  try {
    statusBarManager.update('working', 'Generating tree...')

    const pattern = new vscode.RelativePattern(rootUri, '**/*')
    const excludeGlob = excludesToGlobPattern(config.excludePatterns)
    const uris = await vscode.workspace.findFiles(pattern, excludeGlob)

    const treeData = await buildTreeData(uris, rootUri.path, config)
    const renderOptions = getRenderOptions(config.style)
    const { text, count } = renderTreeString(treeData, renderOptions)

    let rootPrefix = ''
    if (config.style === 'markdown') rootPrefix = '* '

    const output = `# Project Structure: ${rootName}\n\n\`\`\`\n${rootPrefix}${rootName}${renderOptions.directorySuffix}\n${text}\`\`\`\n`

    await vscode.env.clipboard.writeText(output)

    if (!config.disableSuccessNotifications) {
      statusBarManager.update('success', `Copied tree (${count} items)`, 4000)
    } else {
      statusBarManager.update('idle')
    }
  } catch (error) {
    vscode.window.showErrorMessage('Failed to generate project tree.')
    logger.error('Failed during copyProjectTree', error)
    statusBarManager.update('error', 'Tree generation failed', 4000)
  }
}
