import { posixPath } from '../../core/utils'
import { FileData } from './types'

const PATH_REGEX = /[\w\-\.\/]+\.\w+/

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

export function parseLlmOutput(
  llmOutput: string,
  opts?: { filenameWhitelist?: string[] },
): FileData[] {
  const lines = llmOutput.split(/\r?\n/)
  const blocks = extractCodeBlocks(lines)
  const files: FileData[] = []
  const usedNames = new Set<string>()
  const whitelist = (opts?.filenameWhitelist || []).map((v) => v.trim()).filter(Boolean)

  blocks.forEach((block, index) => {
    const contextLines = [
      lines[block.startLine - 1] || '',
      lines[block.startLine - 2] || '',
      block.content.split('\n')[0] || '',
    ]

    let filePath = ''

    for (const line of contextLines) {
      const cleanLine = line.replace(/^[#\*\->\s\/]+/, '').trim()

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

    let uniqueName = posixPath.normalize(filePath)
    let counter = 1

    while (usedNames.has(uniqueName)) {
      const parts = uniqueName.lastIndexOf('.')
      if (parts > -1) {
        uniqueName = `${uniqueName.substring(0, parts)}_${counter}${uniqueName.substring(parts)}`
      } else {
        uniqueName = `${uniqueName}_${counter}`
      }
      counter++
    }

    usedNames.add(uniqueName)
    files.push({ filePath: uniqueName, content: block.content })
  })

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
