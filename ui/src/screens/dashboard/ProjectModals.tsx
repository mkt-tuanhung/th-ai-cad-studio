import { useState } from 'react'
import { useT } from '../../i18n'
import type { Discipline, FileFormat, Project } from '../../state/workspace'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { Field, Select, TextInput } from '../../components/ui/Field'

const DISCIPLINES: Discipline[] = ['architectural', 'bim', 'mechanical', 'interior', 'mep', 'civil']
const DEFAULT_FORMAT: Record<Discipline, FileFormat> = {
  architectural: 'DWG',
  bim: 'RVT',
  mechanical: 'STEP',
  interior: 'DWG',
  mep: 'DWG',
  civil: 'DWG',
}
const FORMATS: FileFormat[] = ['DWG', 'DXF', 'RVT', 'IFC', 'STEP']

export function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (p: { name: string; discipline: Discipline; format: FileFormat }) => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [discipline, setDiscipline] = useState<Discipline>('architectural')
  const [format, setFormat] = useState<FileFormat>('DWG')
  const [error, setError] = useState<string>()

  const submit = () => {
    if (!name.trim()) return setError(t.newProject.nameRequired)
    onCreate({ name: name.trim(), discipline, format })
  }

  return (
    <Modal
      title={t.newProject.title}
      onClose={onClose}
      footer={
        <>
          <ActionButton onClick={onClose}>{t.newProject.cancel}</ActionButton>
          <ActionButton variant="primary" onClick={submit}>
            {t.newProject.create}
          </ActionButton>
        </>
      }
    >
      <form
        style={{ display: 'contents' }}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={t.newProject.name} error={error}>
          <TextInput
            autoFocus
            value={name}
            placeholder={t.newProject.namePlaceholder}
            onChange={(e) => {
              setName(e.target.value)
              setError(undefined)
            }}
          />
        </Field>
        <Field label={t.newProject.discipline}>
          <Select
            value={discipline}
            onChange={(e) => {
              const d = e.target.value as Discipline
              setDiscipline(d)
              setFormat(DEFAULT_FORMAT[d])
            }}
          >
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {t.disciplines[d]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.newProject.format}>
          <Select value={format} onChange={(e) => setFormat(e.target.value as FileFormat)}>
            {FORMATS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </Select>
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

export function RenameProjectModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (name: string) => void }) {
  const t = useT()
  const [name, setName] = useState(project.name)
  const [error, setError] = useState<string>()
  const submit = () => (name.trim() ? onSave(name.trim()) : setError(t.newProject.nameRequired))
  return (
    <Modal
      title={t.rename.title}
      onClose={onClose}
      footer={
        <>
          <ActionButton onClick={onClose}>{t.newProject.cancel}</ActionButton>
          <ActionButton variant="primary" onClick={submit}>
            {t.rename.save}
          </ActionButton>
        </>
      }
    >
      <form
        style={{ display: 'contents' }}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label={t.newProject.name} error={error}>
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Modal>
  )
}
