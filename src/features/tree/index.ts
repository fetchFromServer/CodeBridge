import * as vscode from 'vscode'
import { ConfigEngine } from '../../core/config'
import { collectFileUrisByFs, Logger, posixPath, StatusBarManager } from '../../core/utils'

interface Node {
  name: string
  type: 'file' | 'directory'
  children?: Node[]
}

export async function copyProjectTree(
  uri: vscode.Uri | undefined,
  logger: Logger,
  statusBar: StatusBarManager,
  options: any = {},
) {
  const config = ConfigEngine.get('tree', options)
  let rootUri = uri || vscode.workspace.workspaceFolders?.[0].uri
  if (!rootUri) {
    const message = 'No workspace folder selected.'
    if (config.showErrorNotifications) {
      statusBar.update('error', message, 4000)
      vscode.window.showWarningMessage(message)
    } else {
      statusBar.update('idle')
    }
    return
  }

  if (uri) {
    const wsFolder = vscode.workspace.getWorkspaceFolder(uri)
    if (wsFolder) {
      try {
        const stat = await vscode.workspace.fs.stat(uri)
        if (stat.type === vscode.FileType.File) rootUri = wsFolder.uri
      } catch (e) {
        logger.error(`Failed to stat URI: ${uri.fsPath}`, e)
        rootUri = wsFolder.uri
      }
    }
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Generating tree...', cancellable: true },
    async (_, token) => {
      const uris = await collectTreeUris(rootUri, config, token, logger)

      const rootNodes: Node[] = []
      const rootPathLen = rootUri.path.length + (rootUri.path.endsWith('/') ? 0 : 1)

      uris.sort((a, b) => a.path.localeCompare(b.path))

      const maxDepth = config.maxDepth ?? 0

      for (const fileUri of uris) {
        const rawParts = fileUri.path.substring(rootPathLen).split('/')
        const isDepthLimited = maxDepth > 0 && rawParts.length > maxDepth
        const parts = isDepthLimited ? rawParts.slice(0, maxDepth) : rawParts

        let currentLevel = rootNodes
        for (let i = 0; i < parts.length; i++) {
          const part = decodeURIComponent(parts[i])
          const isFile = !isDepthLimited && i === parts.length - 1

          if (!config.includeHidden && part.startsWith('.')) break
          if (config.directoriesOnly && isFile) break

          let node = currentLevel.find((n) => n.name === part)
          if (!node) {
            node = {
              name: part,
              type: isFile ? 'file' : 'directory',
              children: isFile ? undefined : [],
            }
            currentLevel.push(node)
          }

          if (node.children) {
            currentLevel = node.children
          }
        }
      }

      const sortNodes = (nodes: Node[]) => {
        nodes.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        nodes.forEach((n) => n.children && sortNodes(n.children))
      }
      sortNodes(rootNodes)

      const wsFolder = vscode.workspace.getWorkspaceFolder(rootUri)
      const isSubFolder = !wsFolder || wsFolder.uri.toString() !== rootUri.toString()
      const rootName = isSubFolder
        ? posixPath.basename(rootUri.path)
        : wsFolder?.name || posixPath.basename(rootUri.path)
      const rootNode: Node = { name: rootName, type: 'directory', children: rootNodes }

      let output = ''

      if (config.style === 'json') {
        output = JSON.stringify(rootNode, null, 2)
      } else {
        const header = `${rootNode.name}/\n`
        output = header + renderNodes(rootNode.children || [], config.style)
      }

      if (output) {
        await vscode.env.clipboard.writeText(output)
        if (config.showSuccessNotifications) statusBar.update('success', 'Copied tree', 4000)
        else statusBar.update('idle')
        logger.log(`Tree generated for ${rootUri.fsPath}`)
      } else {
        const message = 'Tree is empty.'
        if (config.showErrorNotifications) {
          statusBar.update('error', message, 4000)
          vscode.window.showWarningMessage(message)
        } else {
          statusBar.update('idle')
        }
      }
    },
  )
}

async function collectTreeUris(
  rootUri: vscode.Uri,
  config: any,
  token: vscode.CancellationToken,
  logger: Logger,
): Promise<vscode.Uri[]> {
  try {
    return await collectFileUrisByFs(
      rootUri,
      { includeHidden: Boolean(config.includeHidden), excludePatterns: config.excludePatterns },
      token,
    )
  } catch (e) {
    logger.error('FS traversal failed while generating tree', e)
    return []
  }
}

function renderNodes(nodes: Node[], style: string, prefix = ''): string {
  const presets: Record<string, any> = {
    modern: { branch: '├── ', last: '└── ', vert: '│   ', space: '    ' },
    classic: { branch: '├── ', last: '└── ', vert: '│   ', space: '    ' },
    markdown: { branch: '* ', last: '* ', vert: '  ', space: '  ' },
    minimal: { branch: '  ', last: '  ', vert: '  ', space: '  ' },
  }
  const theme = presets[style] || presets.modern

  const suffix = style === 'modern' || style === 'classic' ? '/' : ''

  let res = ''
  nodes.forEach((node, i) => {
    const isLast = i === nodes.length - 1
    const connector = isLast ? theme.last : theme.branch

    res += `${prefix}${connector}${node.name}${node.type === 'directory' ? suffix : ''}\n`

    if (node.children && node.children.length > 0) {
      const childPrefix = prefix + (isLast ? theme.space : theme.vert)
      res += renderNodes(node.children, style, childPrefix)
    }
  })
  return res
}
