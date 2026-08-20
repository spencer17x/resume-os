import { resumeDataSchema, type ResumeData } from './resume-model'

const encoder = new TextEncoder()

export function renderResumeDocx(input: ResumeData): Uint8Array {
  const resume = resumeDataSchema.parse(input)
  const entries = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    },
    { name: 'word/document.xml', content: resumeDocumentXml(resume) }
  ]
  return createStoredZip(entries.map((entry) => ({ name: entry.name, bytes: encoder.encode(entry.content) })))
}

export function resumeDocxFileName(input: ResumeData, variantName?: string) {
  const base = (variantName?.trim() || input.profile.name.trim() || 'resume')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-')
    .replace(/\s+/gu, '-')
    .slice(0, 80)
  return `${base || 'resume'}.docx`
}

function resumeDocumentXml(resume: ResumeData) {
  const paragraphs: string[] = []
  const heading = (text: string, level = 1) => paragraphs.push(paragraph(text, { bold: true, size: level === 1 ? 32 : 24 }))
  const line = (text: string) => { if (text.trim()) paragraphs.push(paragraph(text)) }
  const bullet = (text: string) => { if (text.trim()) paragraphs.push(paragraph(`• ${text}`)) }

  heading(resume.profile.name || 'Resume')
  line(resume.profile.title || resume.targetRole || '')
  line([resume.profile.location, resume.profile.email, resume.profile.phone].filter(Boolean).join(' · '))
  resume.profile.summary.forEach(line)

  if (resume.skills.length) {
    heading(resume.metadata.locale === 'zh' ? '技能' : 'Skills', 2)
    resume.skills.forEach((group) => line(`${group.group}: ${group.items.join(', ')}`))
  }
  if (resume.experiences.length) {
    heading(resume.metadata.locale === 'zh' ? '工作经历' : 'Experience', 2)
    resume.experiences.forEach((experience) => {
      line([experience.company, experience.role, experience.period].filter(Boolean).join(' · '))
      experience.bullets.forEach(bullet)
    })
  }
  if (resume.projects.length) {
    heading(resume.metadata.locale === 'zh' ? '项目经历' : 'Projects', 2)
    resume.projects.forEach((project) => {
      line(project.name)
      line(project.summary)
      project.highlights.forEach(bullet)
    })
  }
  if (resume.education.length) {
    heading(resume.metadata.locale === 'zh' ? '教育经历' : 'Education', 2)
    resume.education.forEach((education) => {
      line([education.school, education.degree, education.major, education.period].filter(Boolean).join(' · '))
      education.details.forEach(bullet)
    })
  }
  if (resume.certifications.length) {
    heading(resume.metadata.locale === 'zh' ? '证书' : 'Certifications', 2)
    resume.certifications.forEach(bullet)
  }
  if (resume.languages.length) {
    heading(resume.metadata.locale === 'zh' ? '语言' : 'Languages', 2)
    resume.languages.forEach(bullet)
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`
}

function paragraph(text: string, style: { bold?: boolean; size?: number } = {}) {
  const runProperties = style.bold || style.size
    ? `<w:rPr>${style.bold ? '<w:b/>' : ''}${style.size ? `<w:sz w:val="${style.size}"/>` : ''}</w:rPr>`
    : ''
  return `<w:p><w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character] ?? character)
}

function createStoredZip(entries: Array<{ name: string; bytes: Uint8Array }>) {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const checksum = crc32(entry.bytes)
    const local = new Uint8Array(30 + name.length + entry.bytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 0, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, entry.bytes.length, true)
    localView.setUint32(22, entry.bytes.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(entry.bytes, 30 + name.length)
    localParts.push(local)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x0800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, entry.bytes.length, true)
    centralView.setUint32(24, entry.bytes.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    centralParts.push(central)
    offset += local.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  return concatBytes([...localParts, ...centralParts, end])
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

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
