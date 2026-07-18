'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { Locale } from '@/i18n/routing'
import {
  createResumeId,
  createResumeDraft,
  type ResumeData,
  type ResumeDraft,
  type ResumeDraftState,
  type ResumeSnapshot,
  type ResumeSource
} from '@/lib/resume-model'
import { getEmptyResumeData } from '@/lib/resume-sample'
import {
  RESUME_DRAFT_STORAGE_KEY,
  addDraft,
  draftDocumentsEqual,
  deleteDraft,
  emptyDraftDocument,
  evolveDraftDocument,
  inspectDraftState,
  mergeDraftDocuments,
  parseDraftState,
  renameDraft,
  setActiveDraft,
  updateDraftData,
  writeDraftDocument,
  type ResumeDraftDocument
} from '@/lib/resume-store'

type DraftStorage = Pick<Storage, 'getItem' | 'setItem'>

export type ResumeDraftContextValue = {
  state: ResumeDraftState
  hydrated: boolean
  activeResume: ResumeData
  activeDraft: ResumeDraft | null
  createDraft: (data: ResumeData, options?: { name?: string; source?: ResumeSource }) => string
  updateActiveResume: (data: ResumeData, options?: { snapshotReason?: ResumeSnapshot['reason'] }) => void
  renameDraft: (id: string, name: string) => void
  deleteDraft: (id: string) => void
  setActiveDraft: (id: string) => void
}

const ResumeDraftContext = createContext<ResumeDraftContextValue | null>(null)

export function ResumeDraftProvider({
  children,
  locale
}: {
  children: ReactNode
  locale: Locale
}) {
  return <ResumeDraftProviderCore locale={locale}>{children}</ResumeDraftProviderCore>
}

export function ResumeDraftProviderCore({
  children,
  locale,
  storage: storageOverride
}: {
  children: ReactNode
  locale: Locale
  storage?: DraftStorage | null
}) {
  const [document, setDocument] = useState<ResumeDraftDocument>(emptyDraftDocument)
  const state = document.state
  const [hydrationVersion, setHydrationVersion] = useState(0)
  const hydrated = hydrationVersion > 0
  const hydratedStorageRef = useRef<DraftStorage | null | undefined>(undefined)
  const storageRef = useRef<DraftStorage | null>(null)
  const canPersistRef = useRef(false)
  const hydrationMayPersistRef = useRef(false)
  const externallyAppliedDocumentRef = useRef<{
    document: ResumeDraftDocument
    shouldConverge: boolean
  } | null>(null)
  const [actor] = useState(() => createResumeId('tab'))

  useEffect(() => {
    const storage = storageOverride === undefined ? getBrowserStorage() : storageOverride
    storageRef.current = storage

    if (hydratedStorageRef.current !== storage) {
      hydratedStorageRef.current = storage
      canPersistRef.current = false
      hydrationMayPersistRef.current = false
      externallyAppliedDocumentRef.current = null

      const result = storage ? inspectDraftState(storage) : { status: 'empty' as const }
      setDocument(result.status === 'valid' ? result.document : emptyDraftDocument)
      hydrationMayPersistRef.current = Boolean(storage) && result.status !== 'invalid'
      setHydrationVersion((version) => version + 1)
    }

    if (!storage || typeof window === 'undefined') return

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== RESUME_DRAFT_STORAGE_KEY) return
      if (event.storageArea && event.storageArea !== storage) return

      const result = parseDraftState(event.newValue)
      if (result.status === 'invalid') return

      setDocument((current) => {
        const next = result.status === 'empty'
          ? emptyDraftDocument
          : mergeDraftDocuments(current, result.document)
        const shouldConverge = result.status === 'valid' && !draftDocumentsEqual(next, result.document)
        if (draftDocumentsEqual(current, next) && !shouldConverge) return current

        externallyAppliedDocumentRef.current = {
          document: next,
          shouldConverge
        }
        return next
      })
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [storageOverride])

  useEffect(() => {
    if (hydrationVersion > 0) {
      canPersistRef.current = hydrationMayPersistRef.current
    }
  }, [hydrationVersion])

  useEffect(() => {
    if (!canPersistRef.current || !storageRef.current) return
    const external = externallyAppliedDocumentRef.current
    if (external?.document === document) {
      externallyAppliedDocumentRef.current = null
      if (external.shouldConverge) writeDraftDocument(storageRef.current, document)
      return
    }

    writeDraftDocument(storageRef.current, document)
  }, [document, hydrationVersion])

  const emptyResume = useMemo(() => getEmptyResumeData(locale), [locale])
  const activeDraft = useMemo(
    () => state.drafts.find((draft) => draft.id === state.activeDraftId) ?? null,
    [state]
  )
  const activeResume = activeDraft?.data ?? emptyResume

  const createDraft = useCallback((data: ResumeData, options: { name?: string; source?: ResumeSource } = {}) => {
    const draft = createResumeDraft(data, options)
    setDocument((current) => evolveDraftDocument(current, addDraft(current.state, draft), actor))
    return draft.id
  }, [actor])

  const updateActiveResume = useCallback((data: ResumeData, options: { snapshotReason?: ResumeSnapshot['reason'] } = {}) => {
    setDocument((current) => {
      if (!current.state.activeDraftId) return current
      const nextState = updateDraftData(current.state, current.state.activeDraftId, data, options)
      return evolveDraftDocument(current, nextState, actor)
    })
  }, [actor])

  const renameActiveDraft = useCallback((id: string, name: string) => {
    setDocument((current) => evolveDraftDocument(current, renameDraft(current.state, id, name), actor))
  }, [actor])

  const deleteActiveDraft = useCallback((id: string) => {
    setDocument((current) => evolveDraftDocument(current, deleteDraft(current.state, id), actor))
  }, [actor])

  const activateDraft = useCallback((id: string) => {
    setDocument((current) => evolveDraftDocument(current, setActiveDraft(current.state, id), actor))
  }, [actor])

  const value = useMemo<ResumeDraftContextValue>(() => ({
    state,
    hydrated,
    activeResume,
    activeDraft,
    createDraft,
    updateActiveResume,
    renameDraft: renameActiveDraft,
    deleteDraft: deleteActiveDraft,
    setActiveDraft: activateDraft
  }), [
    activateDraft,
    activeDraft,
    activeResume,
    createDraft,
    deleteActiveDraft,
    hydrated,
    renameActiveDraft,
    state,
    updateActiveResume
  ])

  return <ResumeDraftContext.Provider value={value}>{children}</ResumeDraftContext.Provider>
}

export function useResumeDraft() {
  const value = useContext(ResumeDraftContext)
  if (!value) {
    throw new Error('useResumeDraft must be used within ResumeDraftProvider')
  }
  return value
}

export const useResumeDrafts = useResumeDraft

function getBrowserStorage(): DraftStorage | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}
