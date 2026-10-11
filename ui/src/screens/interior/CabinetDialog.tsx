import { useState } from 'react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useInterior, validateInterior } from '../../state/interior'
import { Modal } from '../../components/ui/Modal'
import { Field, TextInput } from '../../components/ui/Field'
import { ActionButton } from '../../components/ui/Button'
import { cutList, type Cabinet } from '../../interior/model'
import s from './Interior.module.css'

/** Cabinet Parametric: adds a cabinet (furniture item + cut-list definition) to the current room. */
export function CabinetDialog({ onClose }: { onClose: () => void }) {
  const t = useT().interior
  const c = t.cabinet
  const { doc, room, edit, set } = useInterior()
  const [v, setV] = useState({ name: fmt(c.defaultName, { n: doc.cabinets.length + 1 }), w: '1200', d: '600', h: '850', doors: '2', shelves: '1' })
  const num = (k: keyof typeof v) => Number(v[k])
  const id = `c${Date.now()}`
  const cab: Cabinet = { id, name: v.name.trim() || 'Cabinet', room, w: num('w'), d: num('d'), h: num('h'), t: 18, shelves: num('shelves'), doors: num('doors'), board: 'MFC 18 - Oak', front: 'MFC 18 - Oak' }
  const draft = { ...doc, cabinets: [...doc.cabinets, cab] }
  const err = validateInterior(draft)
  const add = () => {
    if (err) return
    const e = edit(`Add ${cab.name}`, (d) => ({
      ...d,
      cabinets: [...d.cabinets, cab],
      items: [...d.items, { id: `i${Date.now()}`, name: cab.name, category: 'cabinet', room, w: cab.w, d: cab.d, h: cab.h, material: 'Wood - Oak', qty: 1, status: 'planned', cabinet: id }],
    }))
    if (e) return toast(fmt(t.toast.invalid, { why: e }), 'warning')
    set({ sel: { kind: 'cabinet', id }, right: 'properties', bottom: 'cutlist' })
    toast(fmt(t.toast.added, { name: cab.name, n: cutList(cab).reduce((a, p) => a + p.qty, 0) }), 'success')
    onClose()
  }
  const field = (k: keyof typeof v, label: string) => (
    <Field label={label}>
      <TextInput value={v[k]} inputMode={k === 'name' ? 'text' : 'numeric'} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-label={label} />
    </Field>
  )
  return (
    <Modal
      title={c.title}
      onClose={onClose}
      footer={
        <>
          <ActionButton onClick={onClose}>{c.cancel}</ActionButton>
          <ActionButton variant="primary" onClick={add} disabled={!!err}>{c.add}</ActionButton>
        </>
      }
    >
      <div className={s.cabGrid}>
        {field('name', c.name)}
        {field('w', c.width)}
        {field('d', c.depth)}
        {field('h', c.height)}
        {field('doors', c.doors)}
        {field('shelves', c.shelves)}
      </div>
      {err && <p className={s.cabErr}>{fmt(t.props.invalid, { why: err })}</p>}
    </Modal>
  )
}
