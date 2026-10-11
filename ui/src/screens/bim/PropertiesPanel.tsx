import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, DoorOpen, Ellipsis, Lightbulb, Pencil, SquareDashed } from 'lucide-react'
import { fmt, useLang, useT } from '../../i18n'
import { useBim, type BimRightTab } from '../../state/bim'
import { useRouter } from '../../state/router'
import { toast } from '../../state/toast'
import { levelOf, typeOf, wallArea, wallHeight, wallVolume, type BimModel, type ElementRef, type Wall } from '../../bim/model'
import { CroppedImage } from '../../components/ui/CroppedImage'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import { Modal } from '../../components/ui/Modal'
import { ActionButton } from '../../components/ui/Button'
import { AiSparkIcon } from '../../components/icons'
import s from './PropertiesPanel.module.css'

const TABS: BimRightTab[] = ['properties', 'ai', 'comments']
const mm = (n: number) => `${n.toFixed(1)} mm`

export function PropertiesPanel() {
  const t = useT().bim.props
  const { rightTab, set } = useBim()
  return (
    <section className={s.card}>
      <div className={s.tabs} role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={rightTab === k} className={`${s.tab} ${rightTab === k ? s.tabOn : ''}`} onClick={() => set({ rightTab: k })}>
            {t.tabs[k]}
          </button>
        ))}
      </div>
      <div className={`${s.body} scroll-y`}>
        {rightTab === 'properties' && <PropertiesTab />}
        {rightTab === 'ai' && <AiTab />}
        {rightTab === 'comments' && <CommentsTab />}
      </div>
      {rightTab === 'properties' && <Recommendations />}
    </section>
  )
}

type RowDef = { label: string; value: string; edit?: { kind: 'text' | 'level'; apply: (v: string) => string | null }; muted?: boolean }

function rowsFor(m: BimModel, sel: ElementRef, t: ReturnType<typeof useT>['bim']['props'], updateWall: (id: string, p: Partial<Wall>, label: string) => string | null) {
  const lvl = (id: string) => levelOf(m, id)?.name ?? '—'
  if (sel.category === 'wall') {
    const w = m.walls.find((x) => x.id === sel.id)
    if (!w) return null
    const ty = typeOf(m, w)
    return {
      kind: t.wallKind,
      title: ty.family,
      subtitle: ty.name,
      icon: 'wall' as const,
      sections: [
        {
          title: t.identity,
          rows: [
            { label: t.family, value: ty.family },
            { label: t.type, value: ty.name },
            { label: t.typeMark, value: w.mark, edit: { kind: 'text', apply: (v: string) => updateWall(w.id, { mark: v.trim() || w.mark }, 'Type Mark') } },
            { label: t.description, value: w.description ?? ty.description },
          ] as RowDef[],
        },
        {
          title: t.constraints,
          rows: [
            { label: t.baseLevel, value: lvl(w.baseLevel) },
            { label: t.baseOffset, value: mm(w.baseOffset) },
            { label: t.topLevel, value: lvl(w.topLevel), edit: { kind: 'level', apply: (v: string) => updateWall(w.id, { topLevel: v }, 'Top Level') } },
            { label: t.topOffset, value: mm(w.topOffset) },
            { label: t.unconnected, value: mm(wallHeight(m, w)), muted: true },
          ] as RowDef[],
        },
        {
          title: t.dimensions,
          rows: [
            { label: t.length, value: mm(w.length) },
            { label: t.thickness, value: mm(ty.thickness) },
            { label: t.height, value: mm(wallHeight(m, w)) },
            { label: t.area, value: `${wallArea(m, w).toFixed(2)} m²` },
            { label: t.volume, value: `${wallVolume(m, w).toFixed(2)} m³` },
          ] as RowDef[],
        },
        {
          title: t.materials,
          rows: [
            { label: t.structure, value: ty.structure },
            { label: t.finishExt, value: ty.finishExt },
            { label: t.finishInt, value: ty.finishInt },
          ] as RowDef[],
        },
      ],
    }
  }
  if (sel.category === 'door' || sel.category === 'window') {
    const o = (sel.category === 'door' ? m.doors : m.windows).find((x) => x.id === sel.id)
    if (!o) return null
    const host = m.walls.find((w) => w.id === o.hostWall)
    return {
      kind: sel.category === 'door' ? t.doorKind : t.windowKind,
      title: o.family,
      subtitle: o.type,
      icon: sel.category,
      sections: [
        { title: t.identity, rows: [{ label: t.family, value: o.family }, { label: t.type, value: o.type }, { label: t.typeMark, value: o.mark || '—' }] as RowDef[] },
        { title: t.constraints, rows: [{ label: t.level, value: host ? lvl(host.baseLevel) : '—' }, { label: t.host, value: o.hostWall }, { label: t.offset, value: mm(o.offset) }, { label: t.sill, value: mm(o.sill) }] as RowDef[] },
        { title: t.dimensions, rows: [{ label: t.width, value: mm(o.width) }, { label: t.height, value: mm(o.height) }] as RowDef[] },
      ],
    }
  }
  if (sel.category === 'room') {
    const r = m.rooms.find((x) => x.id === sel.id)
    if (!r) return null
    return {
      kind: t.roomKind,
      title: r.name,
      subtitle: `${t.number} ${r.number}`,
      icon: 'room' as const,
      sections: [
        { title: t.identity, rows: [{ label: t.number, value: r.number }, { label: t.name, value: r.name }] as RowDef[] },
        { title: t.constraints, rows: [{ label: t.level, value: lvl(r.level) }] as RowDef[] },
        { title: t.dimensions, rows: [{ label: t.area, value: `${r.area.toFixed(2)} m²` }] as RowDef[] },
      ],
    }
  }
  const l = m.levels.find((x) => x.id === sel.id)
  if (!l) return null
  return { kind: 'Level', title: l.name, subtitle: 'Level', icon: 'room' as const, sections: [{ title: t.constraints, rows: [{ label: t.elevation, value: mm(l.elevation) }] as RowDef[] }] }
}

function PropertiesTab() {
  const T = useT()
  const t = T.bim.props
  const { model, selection, updateWall, set } = useBim()
  const [menuOpen, setMenuOpen, menuRef] = useDismissable<HTMLDivElement>()
  if (!selection) return <p className={s.empty}>{t.noSelection}</p>
  const data = rowsFor(model, selection, t, updateWall)
  if (!data) return <p className={s.empty}>{t.noSelection}</p>
  return (
    <>
      <div className={s.elem}>
        {data.icon === 'wall' ? (
          <CroppedImage className={s.thumb} src="/assets/bim_properties_panel.png" natW={272} natH={661} crop={{ x: 49, y: 22, w: 52, h: 50 }} alt="" />
        ) : (
          <span className={`${s.thumb} ${s.thumbIcon}`}>{data.icon === 'door' ? <DoorOpen size={26} strokeWidth={1.4} /> : <SquareDashed size={26} strokeWidth={1.4} />}</span>
        )}
        <span className={s.elemText}>
          <strong>{data.title}</strong>
          <span>{data.subtitle}</span>
        </span>
        <div className={s.anchor} ref={menuRef}>
          <button type="button" className={s.dots} aria-label={t.more} onClick={() => setMenuOpen(!menuOpen)}>
            <Ellipsis size={18} strokeWidth={2.2} />
          </button>
          {menuOpen && (
            <PopoverPanel width={190}>
              <MenuList
                onClose={() => setMenuOpen(false)}
                items={[
                  { label: t.showInSchedule, onSelect: () => set({ view: 'schedule', scheduleCat: selection.category === 'wall' ? 'walls' : selection.category === 'door' ? 'doors' : selection.category === 'window' ? 'windows' : 'rooms' }) },
                  { label: t.copyMark, onSelect: () => navigator.clipboard?.writeText(data.sections[0].rows.find((r) => r.label === t.typeMark)?.value ?? '') },
                ]}
              />
            </PopoverPanel>
          )}
        </div>
      </div>
      {data.sections.map((sec) => (
        <Section key={sec.title} title={sec.title}>
          {sec.rows.map((r) => (
            <PropRow key={r.label} row={r} levels={model.levels} />
          ))}
        </Section>
      ))}
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className={s.section}>
      <button type="button" className={s.secHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={s.bullet}>•</span>
        <span className={s.secTitle}>{title}</span>
        <ChevronDown size={13} strokeWidth={1.9} className={open ? '' : s.flip} />
      </button>
      {open && <div className={s.rows}>{children}</div>}
    </div>
  )
}

function PropRow({ row, levels }: { row: RowDef; levels: BimModel['levels'] }) {
  const T = useT()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(row.value)
  const commit = (v: string) => {
    const err = row.edit!.apply(v)
    if (err) toast(fmt(T.bim.props.invalid, { mark: err }), 'warning')
    setEditing(false)
  }
  return (
    <div className={s.row}>
      <span className={`${s.label} ${row.muted ? s.mutedLabel : ''}`}>{row.label}</span>
      <span className={`${s.value} ${row.muted ? s.muted : ''}`}>
        {editing && row.edit?.kind === 'text' && (
          <input
            className={s.input}
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => commit(val)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(val)
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        )}
        {editing && row.edit?.kind === 'level' && (
          <select className={s.input} autoFocus defaultValue={levels.find((l) => l.name === row.value)?.id} onChange={(e) => commit(e.target.value)} onBlur={() => setEditing(false)}>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {!editing && <span className={s.valueText}>{row.value}</span>}
        {row.edit && !editing && (
          <button
            type="button"
            className={s.pencil}
            aria-label={`${T.bim.props.edit} ${row.label}`}
            onClick={() => {
              setVal(row.value)
              setEditing(true)
            }}
          >
            <Pencil size={11} strokeWidth={1.9} />
          </button>
        )}
      </span>
    </div>
  )
}

function Recommendations() {
  const T = useT()
  const t = T.bim.rec
  const { model, updateWall, appliedRecommendation, set } = useBim()
  const [confirm, setConfirm] = useState(false)
  const [details, setDetails] = useState(false)
  const w1 = model.walls.find((w) => w.id === 'W1')!
  const from = typeOf(model, w1)
  const to = model.wallTypes.find((x) => x.id === 'I250')!
  const preview = { ...model, walls: model.walls.map((w) => (w.id === 'W1' ? { ...w, typeId: 'I250' } : w)) }
  const pw = preview.walls.find((w) => w.id === 'W1')!
  return (
    <div className={s.rec} data-source="demo">
      <div className={s.recHead}>
        <span className={s.bulb}>
          <Lightbulb size={17} strokeWidth={1.7} />
        </span>
        <strong>{t.title}</strong>
        <span className={s.badge}>3</span>
      </div>
      <p className={s.recText}>{t.text}</p>
      <div className={s.recBtns}>
        <button type="button" className={s.apply} disabled={appliedRecommendation || from.id === 'I250'} onClick={() => setConfirm(true)}>
          {appliedRecommendation || from.id === 'I250' ? (
            <>
              <Check size={14} strokeWidth={2.4} /> {t.applied}
            </>
          ) : (
            t.apply
          )}
        </button>
        <button type="button" className={s.details} onClick={() => setDetails(true)}>
          {t.details}
        </button>
      </div>
      {confirm && (
        <Modal
          title={t.confirmTitle}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <ActionButton onClick={() => setConfirm(false)}>{T.newProject.cancel}</ActionButton>
              <ActionButton
                variant="primary"
                onClick={() => {
                  const err = updateWall('W1', { typeId: 'I250' }, 'Apply suggestion W1')
                  setConfirm(false)
                  if (err) return toast(fmt(T.bim.props.invalid, { mark: err }), 'warning')
                  set({ appliedRecommendation: true, selection: { category: 'wall', id: 'W1' } })
                  toast(fmt(t.done, { mark: 'W1', to: to.name }), 'success')
                }}
              >
                {t.confirm}
              </ActionButton>
            </>
          }
        >
          <p className={s.modalText}>{fmt(t.confirmBody, { mark: 'W1', from: from.name, to: to.name, area: wallArea(model, w1).toFixed(2), volume: wallVolume(preview, pw).toFixed(2) })}</p>
          <p className={s.modalNote}>{t.sample}</p>
        </Modal>
      )}
      {details && (
        <Modal title={t.title} onClose={() => setDetails(false)} footer={<ActionButton onClick={() => setDetails(false)}>{T.newProject.cancel}</ActionButton>}>
          <ol className={s.recList}>
            {t.list.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
          <p className={s.modalNote}>{t.sample}</p>
        </Modal>
      )}
    </div>
  )
}

function AiTab() {
  const t = useT().bim.ai
  const navigate = useRouter((st) => st.navigate)
  return (
    <div className={s.aiTab}>
      <AiSparkIcon size={28} strokeWidth={1.5} className={s.aiIcon} />
      <p>{t.notConnected}</p>
      <ActionButton variant="primary" onClick={() => navigate('ai-studio')}>
        {t.open}
      </ActionButton>
    </div>
  )
}

function CommentsTab() {
  const T = useT()
  const t = T.bim.comments
  const lang = useLang()
  const { comments, addComment, selection, model } = useBim()
  const [text, setText] = useState('')
  const markOf = (id: string | null) => (id ? (model.walls.find((w) => w.id === id)?.mark ?? [...model.doors, ...model.windows].find((o) => o.id === id)?.mark ?? model.rooms.find((r) => r.id === id)?.number ?? id) : null)
  return (
    <div className={s.comments}>
      <form
        className={s.commentForm}
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          addComment(text.trim())
          setText('')
        }}
      >
        <textarea value={text} rows={3} placeholder={t.placeholder} aria-label={t.placeholder} onChange={(e) => setText(e.target.value)} />
        <ActionButton type="submit" variant="primary" disabled={!text.trim()}>
          {t.add}
          {selection && ` · ${markOf(selection.id)}`}
        </ActionButton>
      </form>
      {comments.length === 0 && <p className={s.empty}>{t.empty}</p>}
      <ul className={s.commentList}>
        {[...comments].reverse().map((c) => (
          <li key={c.id}>
            <p>{c.text}</p>
            <small>
              {new Date(c.at).toLocaleString(lang)} · {c.elementId ? fmt(t.on, { mark: markOf(c.elementId) ?? '' }) : t.general}
            </small>
          </li>
        ))}
      </ul>
    </div>
  )
}


