import * as vscode from 'vscode'
import { Logger, getGlobalExcludes, isIgnored } from '../utils'

export type AnalysisStrategy = 'shallow' | 'deep'
export interface AnalysisResult {
  log: string
  relatedUris: vscode.Uri[]
}

function isValidTarget(uri: vscode.Uri, excludePatterns: string[]): boolean {
  if (!vscode.workspace.getWorkspaceFolder(uri)) return false

  const relativePath = vscode.workspace.asRelativePath(uri, false)
  if (isIgnored(relativePath, excludePatterns)) return false

  return true
}

async function resolveDependenciesShallow(
  document: vscode.TextDocument,
  excludePatterns: string[]
): Promise<vscode.Uri[]> {
  const results: vscode.Uri[] = []
  const distinctPaths = new Set<string>()

  try {
    const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
      'vscode.executeLinkProvider',
      document.uri
    )

    if (links) {
      for (const link of links) {
        if (link.target && link.target.toString() !== document.uri.toString()) {
          if (isValidTarget(link.target, excludePatterns)) {
            if (!distinctPaths.has(link.target.fsPath)) {
              distinctPaths.add(link.target.fsPath)
              results.push(link.target)
            }
          }
        }
      }
    }
  } catch (e) {}

  return results
}

async function resolveDependenciesDeep(
  document: vscode.TextDocument,
  excludePatterns: string[]
): Promise<vscode.Uri[]> {
  const results: vscode.Uri[] = []
  const distinctPaths = new Set<string>()
  const text = document.getText()

  const identifierPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g
  const uniqueTokens = new Map<string, vscode.Position>()
  let match
  let count = 0

  while ((match = identifierPattern.exec(text)) !== null) {
    if (match[0].length < 3 || uniqueTokens.has(match[0])) continue
    uniqueTokens.set(match[0], document.positionAt(match.index))
    if (++count >= 2000) break
  }

  const tokens = Array.from(uniqueTokens.entries())

  for (let i = 0; i < tokens.length; i += 10) {
    await Promise.all(
      tokens.slice(i, i + 10).map(async ([_, pos]) => {
        try {
          const defs = await vscode.commands.executeCommand<vscode.Location[] | vscode.LocationLink[]>(
            'vscode.executeDefinitionProvider',
            document.uri,
            pos
          )

          if (!defs) return
          const locs = Array.isArray(defs) ? defs : [defs as any]

          for (const loc of locs) {
            const tUri = 'targetUri' in loc ? loc.targetUri : loc.uri
            if (tUri && tUri.toString() !== document.uri.toString()) {
              if (isValidTarget(tUri, excludePatterns)) {
                if (!distinctPaths.has(tUri.fsPath)) {
                  distinctPaths.add(tUri.fsPath)
                  results.push(tUri)
                }
              }
            }
          }
        } catch {}
      })
    )
  }

  return results
}

async function getImpactAnalysis(uri: vscode.Uri, strategy: AnalysisStrategy): Promise<AnalysisResult> {
  const result: AnalysisResult = { log: '', relatedUris: [] }
  const uniquePaths = new Set<string>()
  const excludes = getGlobalExcludes()

  try {
    const doc = await vscode.workspace.openTextDocument(uri)
    const deps =
      strategy === 'deep'
        ? await resolveDependenciesDeep(doc, excludes)
        : await resolveDependenciesShallow(doc, excludes)

    deps.forEach((u) => {
      if (!uniquePaths.has(u.fsPath)) {
        uniquePaths.add(u.fsPath)
        result.relatedUris.push(u)
      }
    })

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      uri
    )

    if (symbols && symbols.length > 0) {
      const targets = symbols
        .filter((s) =>
          [
            vscode.SymbolKind.Class,
            vscode.SymbolKind.Function,
            vscode.SymbolKind.Variable,
            vscode.SymbolKind.Interface,
          ].includes(s.kind)
        )
        .slice(0, 5)

      await Promise.all(
        targets.map(async (s) => {
          try {
            const refs = await vscode.commands.executeCommand<vscode.Location[]>(
              'vscode.executeReferenceProvider',
              uri,
              s.selectionRange.start
            )

            if (refs)
              refs.forEach((r) => {
                if (
                  r.uri.toString() !== uri.toString() &&
                  !uniquePaths.has(r.uri.fsPath) &&
                  isValidTarget(r.uri, excludes)
                ) {
                  uniquePaths.add(r.uri.fsPath)
                  result.relatedUris.push(r.uri)
                }
              })
          } catch {}
        })
      )
    }
  } catch (e) {
    Logger.getInstance().error(`Analysis failed for ${uri.fsPath}`, e)
  }

  if (result.relatedUris.length > 0) {
    result.log = `> CONTEXT (${strategy.toUpperCase()}): Found ${
      result.relatedUris.length
    } related files: ${result.relatedUris.map((u) => u.fsPath.split(/[\\/]/).pop()).join(', ')}`
  }

  return result
}

export class ContextManager {
  static async getFileMetadata(uri: vscode.Uri, enabled: boolean): Promise<string> {
    if (!enabled) return ''
    try {
      return (await getImpactAnalysis(uri, 'shallow')).log
    } catch {
      return ''
    }
  }

  static async expandContext(
    initial: vscode.Uri[],
    config: { enabled: boolean; strategy: AnalysisStrategy; maxFiles: number; excludePatterns: string[] },
    onProgress: (m: string) => void
  ): Promise<{ uris: Set<string>; addedCount: number }> {
    const finalUris = new Set<string>(initial.map((u) => u.toString()))
    let addedCount = 0

    const excludesGlob = config.excludePatterns.length > 0 ? `{${config.excludePatterns.join(',')}}` : undefined

    onProgress('Analyzing context...')
    const targets: vscode.Uri[] = []

    for (const uri of initial) {
      try {
        const stat = await vscode.workspace.fs.stat(uri)
        if (stat.type === vscode.FileType.Directory) {
          const files = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, '**/*'), excludesGlob)
          for (const file of files) {
            targets.push(file)
          }
        } else {
          const rel = vscode.workspace.asRelativePath(uri, false)
          if (!isIgnored(rel, config.excludePatterns)) {
            targets.push(uri)
          }
        }
      } catch {
        targets.push(uri)
      }
    }

    if (!config.enabled) {
      targets.forEach((t) => finalUris.add(t.toString()))
      return { uris: finalUris, addedCount: 0 }
    }

    for (const uri of targets) {
      if (addedCount >= config.maxFiles) break
      const res = await getImpactAnalysis(uri, config.strategy)
      for (const rUri of res.relatedUris) {
        if (addedCount >= config.maxFiles) break
        if (!finalUris.has(rUri.toString())) {
          finalUris.add(rUri.toString())
          addedCount++
        }
      }
    }
    return { uris: finalUris, addedCount }
  }
}
