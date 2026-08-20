'use client'

import { Check, ChevronLeft, ChevronRight, Play, Upload } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { JobAgentAutonomy } from '@/lib/jobs/job-agent-policy'
import type { JobEmploymentType, JobWorkplaceType } from '@/lib/jobs/job-domain'

export type JobSetupValues = {
  profileName: string
  titles: string
  locations: string
  preferredCompanies: string
  blockedCompanies: string
  requiredTerms: string
  preferredTerms: string
  excludedTerms: string
  industries: string
  experienceLevels: string
  educationLevels: string
  companySizes: string
  financingStages: string
  minimumSalary: string
  maximumSalary: string
  maximumAgeDays: number
  workplaceTypes: JobWorkplaceType[]
  employmentTypes: JobEmploymentType[]
  minimumMatchScore: number
  dailyContactLimit: number
  autonomy: JobAgentAutonomy
  autoSendResume: boolean
}

export function JobAgentSetup({
  trustedResume,
  resumeEditor,
  analysis,
  values,
  onChange,
  onSave,
  onStart
}: {
  trustedResume: boolean
  resumeEditor: ReactNode
  analysis: { name: string; role: string; suggestedTitles: string[]; skills: string[]; experienceCount: number } | null
  values: JobSetupValues
  onChange: <Key extends keyof JobSetupValues>(key: Key, value: JobSetupValues[Key]) => void
  onSave: () => Promise<boolean>
  onStart: () => Promise<void>
}) {
  const t = useTranslations('jobRadar.setup')
  const [step, setStep] = useState<1 | 2 | 3 | 4>(trustedResume ? 2 : 1)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!trustedResume && step > 1) setStep(1)
  }, [step, trustedResume])

  const saveOptions = async () => {
    setSaving(true)
    try {
      if (await onSave()) setStep(4)
    } finally {
      setSaving(false)
    }
  }

  return <div className="job-setup">
    <header className="job-setup__header"><div><span>{t('eyebrow')}</span><h2>{t('title')}</h2><p>{t('description')}</p></div><ol>{([1, 2, 3, 4] as const).map((value) => <li key={value} data-active={step === value} data-complete={step > value}><span>{step > value ? <Check size={14} /> : value}</span><small>{t(`steps.${value}`)}</small></li>)}</ol></header>

    {step === 1 ? <section className="job-setup__panel"><div className="job-setup__panel-heading"><Upload size={21} /><div><h3>{t('resumeTitle')}</h3><p>{t('resumeHelp')}</p></div></div><div className="job-setup__embedded">{resumeEditor}</div><footer><button type="button" className="job-button job-button--primary" disabled={!trustedResume} onClick={() => setStep(2)}>{t('continue')}<ChevronRight size={15} /></button></footer></section> : null}

    {step === 2 ? <section className="job-setup__panel"><div className="job-setup__panel-heading"><Check size={21} /><div><h3>{t('analysisTitle')}</h3><p>{t('analysisHelp')}</p></div></div>{analysis ? <div className="job-setup__analysis"><article><span>{t('candidate')}</span><strong>{analysis.name || t('unknown')}</strong></article><article><span>{t('currentRole')}</span><strong>{analysis.role || t('unknown')}</strong></article><article><span>{t('experienceCount')}</span><strong>{analysis.experienceCount}</strong></article><article><span>{t('suggestedRoles')}</span><strong>{analysis.suggestedTitles.join('、') || t('unknown')}</strong></article><article className="job-setup__analysis-wide"><span>{t('skills')}</span><div>{analysis.skills.slice(0, 16).map((skill) => <b key={skill}>{skill}</b>)}</div></article></div> : null}<footer><button type="button" className="job-button job-button--secondary" onClick={() => setStep(1)}><ChevronLeft size={15} />{t('back')}</button><button type="button" className="job-button job-button--primary" onClick={() => setStep(3)}>{t('confirmAnalysis')}<ChevronRight size={15} /></button></footer></section> : null}

    {step === 3 ? <section className="job-setup__panel"><div className="job-setup__panel-heading"><div><h3>{t('optionsTitle')}</h3><p>{t('optionsHelp')}</p></div></div><div className="job-setup__fields"><TextField label={t('profileName')} value={values.profileName} onChange={(value) => onChange('profileName', value)} /><TextField label={t('titles')} value={values.titles} onChange={(value) => onChange('titles', value)} required /><TextField label={t('locations')} value={values.locations} onChange={(value) => onChange('locations', value)} /><div className="job-setup__salary"><TextField label={t('minimumSalary')} value={values.minimumSalary} onChange={(value) => onChange('minimumSalary', value)} type="number" /><TextField label={t('maximumSalary')} value={values.maximumSalary} onChange={(value) => onChange('maximumSalary', value)} type="number" /></div><TextField label={t('experienceLevels')} value={values.experienceLevels} onChange={(value) => onChange('experienceLevels', value)} /><TextField label={t('educationLevels')} value={values.educationLevels} onChange={(value) => onChange('educationLevels', value)} /><TextField label={t('industries')} value={values.industries} onChange={(value) => onChange('industries', value)} /><TextField label={t('preferredCompanies')} value={values.preferredCompanies} onChange={(value) => onChange('preferredCompanies', value)} /><TextField label={t('blockedCompanies')} value={values.blockedCompanies} onChange={(value) => onChange('blockedCompanies', value)} /><TextField label={t('companySizes')} value={values.companySizes} onChange={(value) => onChange('companySizes', value)} /><TextField label={t('financingStages')} value={values.financingStages} onChange={(value) => onChange('financingStages', value)} /><TextField label={t('requiredTerms')} value={values.requiredTerms} onChange={(value) => onChange('requiredTerms', value)} /><TextField label={t('preferredTerms')} value={values.preferredTerms} onChange={(value) => onChange('preferredTerms', value)} /><TextField label={t('excludedTerms')} value={values.excludedTerms} onChange={(value) => onChange('excludedTerms', value)} /><label>{t('maximumAgeDays')}<select value={values.maximumAgeDays} onChange={(event) => onChange('maximumAgeDays', Number(event.target.value))}>{[1, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{t('days', { days })}</option>)}</select></label><CheckboxGroup label={t('workplaceTypes')} values={values.workplaceTypes} options={['remote', 'hybrid', 'onsite']} message={(value) => t(`workplace.${value}`)} onChange={(value) => onChange('workplaceTypes', value)} /><CheckboxGroup label={t('employmentTypes')} values={values.employmentTypes} options={['full-time', 'part-time', 'contract', 'internship', 'other']} message={(value) => t(`employment.${value}`)} onChange={(value) => onChange('employmentTypes', value)} /></div><footer><button type="button" className="job-button job-button--secondary" onClick={() => setStep(2)}><ChevronLeft size={15} />{t('back')}</button><button type="button" className="job-button job-button--primary" disabled={saving || !values.titles.trim()} onClick={() => void saveOptions()}>{saving ? t('saving') : t('saveOptions')}<ChevronRight size={15} /></button></footer></section> : null}

    {step === 4 ? <section className="job-setup__panel"><div className="job-setup__panel-heading"><div><h3>{t('delegationTitle')}</h3><p>{t('delegationHelp')}</p></div></div><div className="job-setup__delegation"><label>{t('autonomy')}<select value={values.autonomy} onChange={(event) => onChange('autonomy', event.target.value as JobAgentAutonomy)}><option value="copilot">{t('autonomyMode.copilot')}</option><option value="approval">{t('autonomyMode.approval')}</option><option value="autopilot">{t('autonomyMode.autopilot')}</option></select></label><label>{t('minimumMatchScore')}<input type="number" min="0" max="100" value={values.minimumMatchScore} onChange={(event) => onChange('minimumMatchScore', Number(event.target.value))} /></label><label>{t('dailyContactLimit')}<input type="number" min="1" max="100" value={values.dailyContactLimit} onChange={(event) => onChange('dailyContactLimit', Number(event.target.value))} /></label><label className="job-setup__check"><input type="checkbox" checked={values.autoSendResume} onChange={(event) => onChange('autoSendResume', event.target.checked)} /><span>{t('autoSendResume')}</span></label></div><div className="job-setup__boundary"><strong>{t('boundaryTitle')}</strong><ul><li>{t('boundarySubmission')}</li><li>{t('boundaryCaptcha')}</li><li>{t('boundaryOutcome')}</li></ul></div><footer><button type="button" className="job-button job-button--secondary" onClick={() => setStep(3)}><ChevronLeft size={15} />{t('back')}</button><button type="button" className="job-button job-button--primary" onClick={() => void onStart()}><Play size={15} />{t('start')}</button></footer></section> : null}
  </div>
}

function TextField({ label, value, onChange, required = false, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: 'text' | 'number' }) {
  return <label>{label}<input type={type} value={value} required={required} onChange={(event) => onChange(event.target.value)} /></label>
}

function CheckboxGroup<Value extends string>({ label, values, options, message, onChange }: { label: string; values: Value[]; options: Value[]; message: (value: Value) => string; onChange: (values: Value[]) => void }) {
  return <fieldset><legend>{label}</legend><div>{options.map((option) => <label key={option}><input type="checkbox" checked={values.includes(option)} onChange={(event) => onChange(event.target.checked ? [...values, option] : values.filter((value) => value !== option))} /><span>{message(option)}</span></label>)}</div></fieldset>
}
