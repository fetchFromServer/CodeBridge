import { posixPath } from '../../core/utils'
import { FileData } from './types'

const PATH_REGEX = /[\w\-\.\/]+\.\w+/
const DEFAULT_MARKERS = ['file:', 'path:']
type PathDetectionMode = 'auto' | 'marked'

const LANG_MAP: Record<string, string> = {
  js: '.js',
  javascript: '.js',
  mjs: '.mjs',
  cjs: '.cjs',
  jsx: '.jsx',
  ts: '.ts',
  tsx: '.tsx',
  typescript: '.ts',

  html: '.html',
  css: '.css',
  scss: '.scss',
  less: '.less',

  json: '.json',
  jsonc: '.json',
  yaml: '.yaml',
  yml: '.yml',
  ini: '.ini',
  toml: '.toml',

  sh: '.sh',
  bash: '.sh',
  shell: '.sh',
  powershell: '.ps1',
  ps1: '.ps1',

  py: '.py',
  python: '.py',
  rb: '.rb',
  ruby: '.rb',
  rspec: '.rb',
  php: '.php',
  go: '.go',
  rs: '.rs',
  rust: '.rs',

  c: '.c',
  h: '.h',
  cpp: '.cpp',
  cxx: '.cpp',
  cc: '.cpp',
  cplusplus: '.cpp',
  hpp: '.hpp',
  cs: '.cs',
  csharp: '.cs',

  java: '.java',
  kt: '.kt',
  kotlin: '.kt',
  swift: '.swift',

  svelte: '.svelte',
  vue: '.vue',

  graphql: '.graphql',
  gql: '.graphql',
  proto: '.proto',
  sql: '.sql',

  hcl: '.hcl',
  tf: '.tf',
  dockerfile: 'Dockerfile',

  md: '.md',
  markdown: '.md',
  text: '.txt',
  plain: '.txt',
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findMarkedPath(line: string, markers: string[]): string {
  if (!markers.length) return ''
  for (const marker of markers) {
    const pattern = new RegExp(`(^|\\s)${escapeRegex(marker)}\\s*`, 'i')
    const match = line.match(pattern)
    if (!match || match.index === undefined) continue

    const after = line.slice(match.index + match[0].length).trim()
    const pathMatch = after.match(PATH_REGEX)
    if (pathMatch?.[0]) return pathMatch[0]
  }
  return ''
}

export function parseLlmOutput(
  llmOutput: string,
  opts?: {
    filenameWhitelist?: string[]
    pathDetection?: PathDetectionMode
    pathMarkers?: string[]
  },
): FileData[] {
  const lines = llmOutput.split(/\r?\n/)
  const blocks = extractCodeBlocks(lines)
  const files: FileData[] = []
  const filesByPath = new Map<string, FileData>()
  const order: string[] = []
  const whitelist = (opts?.filenameWhitelist || []).map((v) => v.trim()).filter(Boolean)
  const detection = (opts?.pathDetection || 'auto') as PathDetectionMode
  const markers = (opts?.pathMarkers?.length ? opts.pathMarkers : DEFAULT_MARKERS)
    .map((v) => v.trim())
    .filter(Boolean)

  blocks.forEach((block, index) => {
    const contextLines = [
      lines[block.startLine - 1] || '',
      lines[block.startLine - 2] || '',
      block.content.split('\n')[0] || '',
    ]

    let filePath = ''

    for (const line of contextLines) {
      const cleanLine = line.replace(/^[#\*\->\s\/]+/, '').trim()

      const marked = findMarkedPath(cleanLine, markers)
      if (marked) {
        filePath = marked
        break
      }

      if (detection === 'marked') continue

      const match = cleanLine.match(PATH_REGEX)
      if (match) {
        const candidate = match[0]

        if (!candidate.endsWith('.') && !candidate.endsWith(':')) {
          filePath = candidate

          break
        }
      }

      if (!filePath && whitelist.length > 0) {
        for (const name of whitelist) {
          const regex = new RegExp(
            '(^|[\\s\'"`/])([\\w\\-./]*' + escapeRegex(name) + ')(?=$|[\\s\'"`:/])',
          )
          const hit = cleanLine.match(regex)
          if (hit?.[2]) {
            filePath = hit[2]
            break
          }
        }
        if (filePath) break
      }
    }

    if (!filePath) {
      const langKey = block.lang?.toLowerCase().trim() || ''
      const extOrName = LANG_MAP[langKey] || '.txt'

      if (extOrName === 'Dockerfile') {
        filePath = 'Dockerfile'
      } else {
        filePath = `file_${index + 1}${extOrName}`
      }
    }

    filePath = filePath.replace(/^['"`]+|['"`]+$/g, '')

    const normalized = posixPath.normalize(filePath)

    if (!filesByPath.has(normalized)) {
      order.push(normalized)
    }

    filesByPath.set(normalized, { filePath: normalized, content: block.content })
  })

  for (const key of order) {
    const data = filesByPath.get(key)
    if (data) files.push(data)
  }

  return files
}

function extractCodeBlocks(lines: string[]) {
  const blocks = []
  let inBlock = false
  let start = -1
  let lang = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('```')) {
      if (inBlock) {
        blocks.push({
          startLine: start,
          endLine: i,
          lang: lang,
          content: lines.slice(start + 1, i).join('\n'),
        })
        inBlock = false
      } else {
        inBlock = true
        start = i

        lang = line.slice(3).trim().split(/\s+/)[0]
      }
    }
  }
  return blocks
}
