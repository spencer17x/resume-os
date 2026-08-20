import { resumeDataSchema, type ResumeData } from './resume-model'

const encoder = new TextEncoder()
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 54
const TOP_Y = 792
const BOTTOM_Y = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2

type ResumePdfLine = {
  text: string
  size: number
  lineHeight: number
  gapBefore: number
  color: 'text' | 'heading' | 'muted'
}

export function renderResumePdf(input: ResumeData): Uint8Array {
  const resume = resumeDataSchema.parse(input)
  const lines = resumePdfLines(resume)
  const pages = paginate(lines)
  return buildPdf(pages, resume.metadata.locale)
}

export function resumePdfFileName(input: ResumeData, variantName?: string) {
  const base = (variantName?.trim() || input.profile.name.trim() || 'resume')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80)
  return `${base || 'resume'}.pdf`
}

function resumePdfLines(resume: ResumeData) {
  const lines: ResumePdfLine[] = []
  const add = (text: string, options: Partial<Omit<ResumePdfLine, 'text'>> = {}) => {
    const normalized = text.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '').trim()
    if (!normalized) return
    const line = {
      text: normalized,
      size: options.size ?? 10.5,
      lineHeight: options.lineHeight ?? 15,
      gapBefore: options.gapBefore ?? 0,
      color: options.color ?? 'text'
    } satisfies ResumePdfLine
    for (const wrapped of wrapText(line.text, line.size, CONTENT_WIDTH)) {
      lines.push({ ...line, text: wrapped, gapBefore: lines.length === 0 ? line.gapBefore : line.gapBefore })
      line.gapBefore = 0
    }
  }
  const section = (zh: string, en: string) => add(resume.metadata.locale === 'zh' ? zh : en, {
    size: 13, lineHeight: 19, gapBefore: 12, color: 'heading'
  })
  const bullet = (text: string) => add(`• ${text}`, { lineHeight: 14 })

  add(resume.profile.name || 'Resume', { size: 22, lineHeight: 28, color: 'heading' })
  add(resume.profile.title || resume.targetRole || '', { size: 12, lineHeight: 18, color: 'muted' })
  add([resume.profile.location, resume.profile.email, resume.profile.phone].filter(Boolean).join(' · '), { color: 'muted' })
  if (resume.profile.links.length) add(resume.profile.links.map((link) => link.label || link.url).join(' · '), { color: 'muted' })
  resume.profile.summary.forEach((item) => add(item, { lineHeight: 15 }))

  if (resume.skills.length) {
    section('技能', 'Skills')
    resume.skills.forEach((group) => add(`${group.group}: ${group.items.join(', ')}`))
  }
  if (resume.experiences.length) {
    section('工作经历', 'Experience')
    resume.experiences.forEach((experience) => {
      add([experience.company, experience.role, experience.period].filter(Boolean).join(' · '), { size: 11.5, lineHeight: 17, gapBefore: 5 })
      if (experience.location) add(experience.location, { color: 'muted' })
      experience.bullets.forEach(bullet)
    })
  }
  if (resume.projects.length) {
    section('项目经历', 'Projects')
    resume.projects.forEach((project) => {
      add(project.name, { size: 11.5, lineHeight: 17, gapBefore: 5 })
      add(project.summary)
      project.highlights.forEach(bullet)
    })
  }
  if (resume.education.length) {
    section('教育经历', 'Education')
    resume.education.forEach((education) => {
      add([education.school, education.degree, education.major, education.period].filter(Boolean).join(' · '), { size: 11.5, lineHeight: 17, gapBefore: 5 })
      education.details.forEach(bullet)
    })
  }
  const listSection = (items: string[], zh: string, en: string) => {
    if (!items.length) return
    section(zh, en)
    items.forEach(bullet)
  }
  listSection(resume.certifications, '证书', 'Certifications')
  listSection(resume.awards, '荣誉', 'Awards')
  listSection(resume.languages, '语言', 'Languages')
  listSection(resume.openSource, '开源经历', 'Open Source')
  return lines
}

function wrapText(text: string, size: number, maximumWidth: number) {
  const output: string[] = []
  let line = ''
  for (const character of [...text]) {
    const candidate = line + character
    if (line && estimatedTextWidth(candidate, size) > maximumWidth) {
      output.push(line.trimEnd())
      line = character.trimStart()
    } else {
      line = candidate
    }
  }
  if (line) output.push(line)
  return output.length ? output : ['']
}

function estimatedTextWidth(text: string, size: number) {
  return [...text].reduce((width, character) => width + (character.codePointAt(0)! > 0xff ? size : size * 0.54), 0)
}

function paginate(lines: ResumePdfLine[]) {
  const pages: Array<Array<ResumePdfLine & { y: number }>> = [[]]
  let y = TOP_Y
  for (const line of lines) {
    const required = line.gapBefore + line.lineHeight
    if (y - required < BOTTOM_Y && pages.at(-1)!.length > 0) {
      pages.push([])
      y = TOP_Y
    }
    y -= line.gapBefore
    pages.at(-1)!.push({ ...line, y })
    y -= line.lineHeight
  }
  return pages
}

function buildPdf(pages: Array<Array<ResumePdfLine & { y: number }>>, locale: 'zh' | 'en') {
  const objects = new Map<number, Uint8Array>()
  objects.set(1, ascii('<< /Type /Catalog /Pages 2 0 R >>'))
  objects.set(3, ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))
  objects.set(4, ascii('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>'))
  objects.set(5, ascii('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>'))
  const unicodeValues = new Set<number>()
  pages.flat().forEach((line) => [...line.text].forEach((character) => {
    const value = character.charCodeAt(0)
    if (value > 0x7f && value <= 0xffff) unicodeValues.add(value)
  }))
  const toUnicode = createToUnicodeCMap([...unicodeValues].sort((left, right) => left - right))
  objects.set(6, streamObject(ascii(toUnicode)))
  objects.set(7, streamObject(ascii('')))
  let nextObjectId = 8
  let hiddenFontSequence = 0
  const hiddenFonts = pages.map((page) => page.map((line) => {
    if (locale !== 'zh') return null
    hiddenFontSequence += 1
    const fontId = nextObjectId++
    const cmapId = nextObjectId++
    const characters = [...new Set([...line.text])]
    const characterCodes = new Map(characters.map((character, index) => [character, index + 1]))
    const glyphNames = characters.map((_, index) => `/g${index + 1}`)
    const charProcs = glyphNames.map((name) => `${name} 7 0 R`).join(' ')
    const widths = characters.map(() => '0').join(' ')
    objects.set(fontId, ascii(`<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << ${charProcs} >> /Encoding << /Type /Encoding /Differences [1 ${glyphNames.join(' ')}] >> /FirstChar 1 /LastChar ${characters.length} /Widths [${widths}] /Resources << >> /ToUnicode ${cmapId} 0 R >>`))
    objects.set(cmapId, streamObject(ascii(createSingleByteToUnicodeCMap(characters))))
    return {
      fontName: `H${hiddenFontSequence}`,
      fontId,
      encodedText: [...line.text].map((character) => characterCodes.get(character)!.toString(16).padStart(2, '0').toUpperCase()).join('')
    }
  }))
  const firstPageObject = nextObjectId
  const pageObjects = pages.map((_, index) => firstPageObject + index * 2)
  objects.set(2, ascii(`<< /Type /Pages /Kids [${pageObjects.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`))
  pages.forEach((page, index) => {
    const pageId = pageObjects[index]
    const contentId = pageId + 1
    const content = page.map((line, lineIndex) => pdfTextCommand(line, locale, hiddenFonts[index][lineIndex])).join('\n')
    const pageHiddenFonts = hiddenFonts[index].flatMap((font) => font ? [`/${font.fontName} ${font.fontId} 0 R`] : []).join(' ')
    objects.set(pageId, ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R ${pageHiddenFonts} >> >> /Contents ${contentId} 0 R >>`))
    objects.set(contentId, streamObject(ascii(content)))
  })
  return serializePdf(objects)
}

function pdfTextCommand(
  line: ResumePdfLine & { y: number },
  locale: 'zh' | 'en',
  hiddenFont: { fontName: string; encodedText: string } | null
) {
  const color = line.color === 'heading' ? '0.12 0.25 0.48 rg' : line.color === 'muted' ? '0.35 g' : '0 g'
  const text = locale === 'zh' ? `<${utf16BeHex(line.text)}>` : `(${escapePdfLiteral(line.text)})`
  const command = `BT ${color} /${locale === 'zh' ? 'F2' : 'F1'} ${line.size} Tf 1 0 0 1 ${MARGIN_X} ${line.y.toFixed(2)} Tm ${text} Tj ET`
  return locale === 'zh'
    ? `/Artifact BMC ${command} EMC\nBT 3 Tr /${hiddenFont!.fontName} ${line.size} Tf 1 0 0 1 ${MARGIN_X} ${line.y.toFixed(2)} Tm <${hiddenFont!.encodedText}> Tj ET`
    : command
}

function utf16BeHex(value: string) {
  let output = ''
  for (let index = 0; index < value.length; index += 1) output += value.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase()
  return output
}

function escapePdfLiteral(value: string) {
  return value.replace(/[^\x20-\x7e]/gu, '?').replace(/([\\()])/gu, '\\$1')
}

function createToUnicodeCMap(values: number[]) {
  const mappings = values.map((value) => `<${value.toString(16).padStart(4, '0').toUpperCase()}> <${value.toString(16).padStart(4, '0').toUpperCase()}>`)
  const chunks: string[] = []
  for (let index = 0; index < mappings.length; index += 100) {
    const group = mappings.slice(index, index + 100)
    chunks.push(`${group.length} beginbfchar\n${group.join('\n')}\nendbfchar`)
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /ResumeOS-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`
}

function createSingleByteToUnicodeCMap(characters: string[]) {
  const mappings = characters.map((character, index) => {
    const source = (index + 1).toString(16).padStart(2, '0').toUpperCase()
    const target = utf16BeHex(character)
    return `<${source}> <${target}>`
  })
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /ResumeOS-Line-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n${mappings.length} beginbfchar\n${mappings.join('\n')}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`
}

function streamObject(bytes: Uint8Array) {
  return concatBytes([ascii(`<< /Length ${bytes.length} >>\nstream\n`), bytes, ascii('\nendstream')])
}

function serializePdf(objects: Map<number, Uint8Array>) {
  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])
  const parts: Uint8Array[] = [header]
  const offsets = new Map<number, number>()
  let offset = header.length
  const maximumId = Math.max(...objects.keys())
  for (let id = 1; id <= maximumId; id += 1) {
    const body = objects.get(id)
    if (!body) throw new TypeError(`Missing PDF object ${id}`)
    const object = concatBytes([ascii(`${id} 0 obj\n`), body, ascii('\nendobj\n')])
    offsets.set(id, offset)
    parts.push(object)
    offset += object.length
  }
  const xrefOffset = offset
  const xref = [`xref`, `0 ${maximumId + 1}`, '0000000000 65535 f ']
  for (let id = 1; id <= maximumId; id += 1) xref.push(`${offsets.get(id)!.toString().padStart(10, '0')} 00000 n `)
  xref.push(`trailer`, `<< /Size ${maximumId + 1} /Root 1 0 R >>`, `startxref`, String(xrefOffset), '%%EOF')
  parts.push(ascii(`${xref.join('\n')}\n`))
  return concatBytes(parts)
}

function ascii(value: string) {
  return encoder.encode(value)
}

function concatBytes(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}
