import * as vscode from 'vscode'
import { ConfigEngine } from '../../core/config'
import { isIgnored } from '../../core/utils'
import { AnalysisResult, AnalysisStrategy } from './types'

interface WalkerOptions {
  excludePatterns: string[]
  maxFiles: number
  maxDepth: number
  strategy: AnalysisStrategy
  symbolKinds?: Set<vscode.SymbolKind>
}

const SYMBOL_KIND_MAP: Record<string, vscode.SymbolKind> = {
  class: vscode.SymbolKind.Class,
  function: vscode.SymbolKind.Function,
  interface: vscode.SymbolKind.Interface,
  constant: vscode.SymbolKind.Constant,
  variable: vscode.SymbolKind.Variable,
  enum: vscode.SymbolKind.Enum,
}

const MAX_SYMBOLS_PER_FILE = 25

class DependencyWalker {
  private visited = new Set<string>()
  private queue: { uri: vscode.Uri; depth: number }[] = []
  private results: vscode.Uri[] = []

  constructor(private options: WalkerOptions) {}

  public async walk(rootUri: vscode.Uri): Promise<vscode.Uri[]> {
    this.results = []
    this.visited.clear()
    this.queue = []

    this.addToQueue(rootUri, 0)

    while (this.queue.length > 0) {
      if (this.options.maxFiles > 0 && this.results.length >= this.options.maxFiles) break

      const current = this.queue.shift()!

      if (current.depth >= this.options.maxDepth) continue

      await this.processNode(current.uri, current.depth)
    }

    return this.results
  }

  private addToQueue(uri: vscode.Uri, depth: number) {
    const key = uri.toString()
    if (!this.visited.has(key)) {
      this.visited.add(key)
      if (depth > 0) {
        this.results.push(uri)
      }
      this.queue.push({ uri, depth })
    }
  }

  private async processNode(uri: vscode.Uri, currentDepth: number): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(uri)

      const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
        'vscode.executeLinkProvider',
        uri,
      )

      if (links && Array.isArray(links)) {
        for (const link of links) {
          if (link.target && this.isAllowed(link.target)) {
            this.addToQueue(link.target, currentDepth + 1)
          }
        }
      }

      await this.resolveRelativeImports(doc, uri, currentDepth)

      if (this.options.strategy === 'deep' && this.options.symbolKinds?.size) {
        await this.resolveSymbolReferences(uri, currentDepth)
      }
    } catch (e) {}
  }

  private flattenDocumentSymbols(
    symbols: vscode.DocumentSymbol[],
    out: vscode.DocumentSymbol[] = [],
  ): vscode.DocumentSymbol[] {
    for (const s of symbols) {
      out.push(s)
      if (s.children?.length) this.flattenDocumentSymbols(s.children, out)
    }
    return out
  }

  private async resolveSymbolReferences(uri: vscode.Uri, currentDepth: number): Promise<void> {
    if (this.options.maxFiles > 0 && this.results.length >= this.options.maxFiles) return

    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[] | vscode.SymbolInformation[]
    >('vscode.executeDocumentSymbolProvider', uri)

    if (!symbols || symbols.length === 0) return

    let symbolEntries: Array<{
      kind: vscode.SymbolKind
      position: vscode.Position
    }> = []

    const first = symbols[0] as vscode.DocumentSymbol | vscode.SymbolInformation

    if ('selectionRange' in first) {
      const flat = this.flattenDocumentSymbols(symbols as vscode.DocumentSymbol[])
      symbolEntries = flat.map((s) => ({ kind: s.kind, position: s.selectionRange.start }))
    } else {
      symbolEntries = (symbols as vscode.SymbolInformation[]).map((s) => ({
        kind: s.kind,
        position: s.location.range.start,
      }))
    }

    const allowed = this.options.symbolKinds
    if (!allowed || allowed.size === 0) return

    const candidates = symbolEntries
      .filter((s) => allowed.has(s.kind))
      .slice(0, MAX_SYMBOLS_PER_FILE)

    for (const symbol of candidates) {
      if (this.options.maxFiles > 0 && this.results.length >= this.options.maxFiles) break

      try {
        const refs = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeReferenceProvider',
          uri,
          symbol.position,
        )

        if (!refs || refs.length === 0) continue

        for (const ref of refs) {
          if (this.options.maxFiles > 0 && this.results.length >= this.options.maxFiles) break
          if (ref.uri && this.isAllowed(ref.uri)) {
            this.addToQueue(ref.uri, currentDepth + 1)
          }
        }
      } catch {}
    }
  }

  private async resolveRelativeImports(
    doc: vscode.TextDocument,
    uri: vscode.Uri,
    currentDepth: number,
  ) {
    const text = doc.getText()
    const importPattern = /['"](\.{1,2}\/[^'"]+)['"]/g
    let match: RegExpExecArray | null

    while ((match = importPattern.exec(text)) !== null) {
      const position = doc.positionAt(match.index + 1)
      try {
        const locations = await vscode.commands.executeCommand<
          vscode.Location[] | vscode.LocationLink[]
        >('vscode.executeDefinitionProvider', uri, position)

        if (locations && Array.isArray(locations)) {
          for (const loc of locations) {
            let targetUri: vscode.Uri | undefined
            if ('uri' in loc) targetUri = (loc as vscode.Location).uri
            else if ('targetUri' in loc) targetUri = (loc as vscode.LocationLink).targetUri

            if (targetUri && this.isAllowed(targetUri)) {
              this.addToQueue(targetUri, currentDepth + 1)
            }
          }
        }
      } catch {}
    }
  }

  private isAllowed(uri: vscode.Uri): boolean {
    if (uri.scheme !== 'file' && uri.scheme !== 'vscode-vfs') return false

    const folder = vscode.workspace.getWorkspaceFolder(uri)
    if (!folder) return false

    const relativePath = vscode.workspace.asRelativePath(uri, false)
    return !isIgnored(relativePath, this.options.excludePatterns)
  }
}

export async function getImpactAnalysis(
  uri: vscode.Uri,
  strategy: AnalysisStrategy,
): Promise<AnalysisResult> {
  const result: AnalysisResult = { log: '', relatedUris: [] }

  if (strategy === 'none') return result

  const fullConfig = ConfigEngine.get('copy')
  const analysisConfig = fullConfig.analysis || {}

  const targetDepth = strategy === 'deep' ? 5 : 1

  const rawSymbolKinds: string[] = Array.isArray(analysisConfig.symbolKinds)
    ? analysisConfig.symbolKinds.map((k: unknown) => String(k))
    : []

  const kinds = rawSymbolKinds
    .map((k: string) => SYMBOL_KIND_MAP[k.toLowerCase()] as vscode.SymbolKind | undefined)
    .filter((k: vscode.SymbolKind | undefined): k is vscode.SymbolKind => typeof k === 'number')

  const symbolKinds = kinds.length ? new Set<vscode.SymbolKind>(kinds) : undefined

  const options: WalkerOptions = {
    excludePatterns: fullConfig.excludePatterns || [],
    maxFiles: analysisConfig.maxFiles ?? 0,
    maxDepth: targetDepth,
    strategy,
    symbolKinds,
  }

  const walker = new DependencyWalker(options)
  const dependencies = await walker.walk(uri)

  result.relatedUris = dependencies

  if (dependencies.length > 0) {
    result.log = `> DEPENDENCIES (${strategy.toUpperCase()}): Bundled ${dependencies.length} files`
  } else {
    result.log = strategy === 'deep' ? `> DEEP SCAN: No local dependencies found (Leaf Node)` : ''
  }

  return result
}
