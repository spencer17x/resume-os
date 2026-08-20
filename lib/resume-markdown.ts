import type { ResumeData } from './resume-model'

export function renderResumeMarkdown(resume: ResumeData) {
  const lines: string[] = []
  lines.push(`# ${resume.profile.name || 'Resume'}`)
  const role = resume.profile.title || resume.targetRole
  if (role) lines.push('', `## ${role}`)
  const contact = [resume.profile.location, resume.profile.email, resume.profile.phone].filter(Boolean)
  if (contact.length > 0) lines.push('', contact.join(' | '))
  if (resume.profile.links.length > 0) {
    lines.push('', resume.profile.links.map((link) => `[${link.label || link.url}](${link.url})`).join(' | '))
  }
  if (resume.profile.summary.length > 0) lines.push('', '## Summary', '', ...resume.profile.summary)
  if (resume.skills.length > 0) {
    lines.push('', '## Skills', '')
    for (const group of resume.skills) lines.push(`- **${group.group}:** ${group.items.join(', ')}`)
  }
  if (resume.experiences.length > 0) {
    lines.push('', '## Experience')
    for (const experience of resume.experiences) {
      lines.push('', `### ${experience.company} - ${experience.role}`, '', [experience.period, experience.location].filter(Boolean).join(' | '))
      for (const bullet of experience.bullets) lines.push(`- ${bullet}`)
    }
  }
  if (resume.projects.length > 0) {
    lines.push('', '## Projects')
    for (const project of resume.projects) {
      lines.push('', `### ${project.name}`)
      if (project.tags.length > 0) lines.push('', `**Tags:** ${project.tags.join(', ')}`)
      if (project.summary) lines.push('', project.summary)
      for (const bullet of project.highlights) lines.push(`- ${bullet}`)
    }
  }
  if (resume.openSource.length > 0) {
    lines.push('', '## Open Source')
    for (const item of resume.openSource) lines.push('', `- ${item}`)
  }
  if (resume.education.length > 0) {
    lines.push('', '## Education')
    for (const item of resume.education) lines.push('', `- **${item.school}**${item.degree ? ` - ${item.degree}` : ''}${item.major ? `, ${item.major}` : ''}${item.period ? ` | ${item.period}` : ''}`)
  }
  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()}\n`
}

export function resumeMarkdownFileName(resume: ResumeData, name?: string) {
  const raw = name || resume.profile.name || 'resume'
  const safe = raw.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-').replace(/[-\s]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 120) || 'resume'
  return `${safe}.md`
}
