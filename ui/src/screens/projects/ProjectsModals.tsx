import { useState } from 'react'
import { Building2, Box, Settings, Waves } from 'lucide-react'
import { useT } from '../../i18n'
import { detailsOf, type Discipline, type Project } from '../../state/workspace'
import type { Activity, ProjectEntry } from '../../state/projectSeed'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { Field, TextInput } from '../../components/ui/Field'
import { ActivityRow } from './ProjectInspector'
import s from './ProjectsModals.module.css'

function NameModal({ title, label, initial, submit, onClose, onSave }: {
  title: string; label: string; initial: string; submit: string; onClose: () => void; onSave: (v: string) => void
}) {
  const T = useT().projects.modals
  const [v, setV] = useState(initial)
  const ok = v.trim().length > 0
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <ActionButton onClick={onClose}>{T.cancel}</ActionButton>
      <ActionButton variant="primary" disabled={!ok} onClick={() => ok && onSave(v.trim())}>{submit}</ActionButton>
    </>}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onSave(v.trim()) }}>
        <Field label={label}><TextInput autoFocus value={v} onChange={(e) => setV(e.target.value)} /></Field>
      </form>
    </Modal>
  )
}

export function NewFolderModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const T = useT().projects.modals
  return <NameModal title={T.folderTitle} label={T.folderName} initial="" submit={T.create} onClose={onClose} onSave={onCreate} />
}

export function RenameEntryModal({ entry, onClose, onSave }: { entry: ProjectEntry; onClose: () => void; onSave: (name: string) => void }) {
  const T = useT().projects.modals
  return <NameModal title={T.renameFile} label={T.name} initial={entry.name} submit={T.save} onClose={onClose} onSave={onSave} />
}

const TEMPLATES: { id: 'villa' | 'office' | 'mech' | 'canal'; discipline: Discipline; Icon: typeof Box; folders: string[] }[] = [
  { id: 'villa', discipline: 'architectural', Icon: Building2, folders: ['01_Concept', '02_Architecture', '03_Structural', '04_MEP', '05_Interior'] },
  { id: 'office', discipline: 'bim', Icon: Box, folders: ['01_Model', '02_Views', '03_Sheets', '04_Schedules'] },
  { id: 'mech', discipline: 'mechanical', Icon: Settings, folders: ['01_Parts', '02_Assemblies', '03_Drawings', '04_BOM'] },
  { id: 'canal', discipline: 'civil', Icon: Waves, folders: ['01_Survey', '02_Alignment', '03_Profiles', '04_Cross_Sections', '05_Earthwork'] },
]

export function TemplateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, d: Discipline, folders: string[]) => void }) {
  const t = useT()
  const T = t.projects.modals
  const [pick, setPick] = useState(TEMPLATES[0])
  const [name, setName] = useState('')
  const ok = name.trim().length > 0
  return (
    <Modal title={T.templateTitle} onClose={onClose} footer={<>
      <ActionButton onClick={onClose}>{T.cancel}</ActionButton>
      <ActionButton variant="primary" disabled={!ok} onClick={() => ok && onCreate(name.trim(), pick.discipline, pick.folders)}>{T.create}</ActionButton>
    </>}>
      <div className={s.templates} role="radiogroup">
        {TEMPLATES.map((tp) => (
          <button key={tp.id} type="button" role="radio" aria-checked={pick.id === tp.id} className={`${s.tpl} ${pick.id === tp.id ? s.tplOn : ''}`} onClick={() => setPick(tp)}>
            <tp.Icon size={20} strokeWidth={1.6} />
            <span><b>{T.templates[tp.id].name}</b><small>{T.templates[tp.id].text}</small></span>
          </button>
        ))}
      </div>
      <Field label={T.name}><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t.newProject.namePlaceholder} /></Field>
    </Modal>
  )
}

export function EditProjectModal({ project, onClose, onSave }: {
  project: Project; onClose: () => void; onSave: (p: { name: string; description: string; summary: string }) => void
}) {
  const T = useT().projects.modals
  const d = detailsOf(project)
  const [name, setName] = useState(project.name)
  const [summary, setSummary] = useState(d.summary)
  const [description, setDescription] = useState(d.description)
  const ok = name.trim().length > 0
  return (
    <Modal title={T.editTitle} onClose={onClose} footer={<>
      <ActionButton onClick={onClose}>{T.cancel}</ActionButton>
      <ActionButton variant="primary" disabled={!ok} onClick={() => ok && onSave({ name: name.trim(), summary: summary.trim(), description: description.trim() })}>{T.save}</ActionButton>
    </>}>
      <div className={s.stack}>
        <Field label={T.name}><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={T.summary}><TextInput value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
        <Field label={T.description}>
          <textarea className={s.textarea} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

export function ActivityModal({ items, onClose }: { items: Activity[]; onClose: () => void }) {
  const T = useT().projects
  const now = Date.now()
  return (
    <Modal title={T.modals.allActivity} onClose={onClose}>
      <ul className={s.activity}>
        {items.map((a) => <ActivityRow key={a.id} a={a} now={now} />)}
        {items.length === 0 && <li>{T.inspector.noActivity}</li>}
      </ul>
    </Modal>
  )
}
