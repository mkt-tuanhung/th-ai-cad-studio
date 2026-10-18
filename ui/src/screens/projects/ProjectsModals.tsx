import { useState } from 'react'
import { BedDouble, Briefcase, Building, Building2, Box, CookingPot, Home, PaintRoller, Settings, Waves } from 'lucide-react'
import { TEMPLATES as CONTENT_TEMPLATES, type TemplateId } from '../../platform/templates'
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

const CONTENT_ICONS: Record<TemplateId, typeof Box> = { apartment: Building, house: Home, oneRoom: BedDouble, kitchen: CookingPot, office: Briefcase, fitout: PaintRoller }

/**
 * From Template: templates with real content (platform/templates.ts — BIM model, interior design, plan drawing)
 * and the folder-structure templates.
 */
export function TemplateModal({ onClose, onCreate, onCreateContent }: {
  onClose: () => void
  onCreate: (name: string, d: Discipline, folders: string[]) => void
  onCreateContent: (id: TemplateId, name: string) => void
}) {
  const t = useT()
  const T = t.projects.modals
  const C = t.platform.templates
  const [pick, setPick] = useState<{ kind: 'content'; id: TemplateId } | { kind: 'folders'; tp: (typeof TEMPLATES)[number] }>({ kind: 'content', id: CONTENT_TEMPLATES[0].id })
  const [name, setName] = useState('')
  const ok = name.trim().length > 0
  const create = () => {
    if (!ok) return
    if (pick.kind === 'content') onCreateContent(pick.id, name.trim())
    else onCreate(name.trim(), pick.tp.discipline, pick.tp.folders)
  }
  return (
    <Modal title={T.templateTitle} onClose={onClose} width={560} footer={<>
      <ActionButton onClick={onClose}>{T.cancel}</ActionButton>
      <ActionButton variant="primary" disabled={!ok} onClick={create}>{T.create}</ActionButton>
    </>}>
      <div className={s.templates} role="radiogroup" aria-label={T.templateTitle}>
        <b className={s.tplGroup}>{C.content}</b>
        {CONTENT_TEMPLATES.map((tp) => {
          const Icon = CONTENT_ICONS[tp.id]
          const on = pick.kind === 'content' && pick.id === tp.id
          return (
            <button key={tp.id} type="button" role="radio" aria-checked={on} data-template={tp.id} className={`${s.tpl} ${on ? s.tplOn : ''}`} onClick={() => setPick({ kind: 'content', id: tp.id })}>
              <Icon size={20} strokeWidth={1.6} />
              <span><b>{C.items[tp.id].name}</b><small>{C.items[tp.id].text} · v{tp.version}</small></span>
            </button>
          )
        })}
        <b className={s.tplGroup}>{C.folders}</b>
        {TEMPLATES.map((tp) => {
          const on = pick.kind === 'folders' && pick.tp.id === tp.id
          return (
            <button key={tp.id} type="button" role="radio" aria-checked={on} className={`${s.tpl} ${on ? s.tplOn : ''}`} onClick={() => setPick({ kind: 'folders', tp })}>
              <tp.Icon size={20} strokeWidth={1.6} />
              <span><b>{T.templates[tp.id].name}</b><small>{T.templates[tp.id].text}</small></span>
            </button>
          )
        })}
      </div>
      {pick.kind === 'content' && <p className={s.tplNote}>{C.loads}</p>}
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
