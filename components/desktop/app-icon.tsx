'use client'

import {
  Bot,
  BookOpen,
  FileSearch,
  FolderKanban,
  LayoutTemplate,
  Milestone,
  Orbit,
  Settings2,
  Sparkles,
  Terminal,
  type LucideIcon
} from 'lucide-react'
import type { DesktopAppDefinition } from '@/lib/desktop/types'

const icons: Record<DesktopAppDefinition['icon'], LucideIcon> = {
  sparkles: Sparkles,
  bot: Bot,
  'file-search': FileSearch,
  orbit: Orbit,
  'book-open': BookOpen,
  'layout-template': LayoutTemplate,
  'folder-kanban': FolderKanban,
  milestone: Milestone,
  terminal: Terminal,
  'settings-2': Settings2
}

export function AppIcon({ app, size = 20 }: { app: DesktopAppDefinition; size?: number }) {
  const Icon = icons[app.icon]
  return (
    <span className={`desktop-app-icon desktop-app-icon--${app.iconTone}`} aria-hidden="true">
      <Icon size={size} strokeWidth={1.8} />
    </span>
  )
}
