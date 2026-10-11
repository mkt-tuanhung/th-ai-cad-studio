import type { ReactNode } from 'react'
import { Check, ChevronDown, ChevronsUpDown, Eye, EyeOff, ImageIcon, Lock, Unlock } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { defaultView, useCad, type RightTab } from '../../state/cad'
import { useCursor } from '../../state/cursor'
import type { Entity } from '../../cad/types'
import { toast } from '../../state/toast'
import { useRouter } from '../../state/router'
import s from './RightPanel.module.css'

const TABS: RightTab[] = ['properties', 'layers', 'blocks', 'references']
/** Tab widths reproduce the mockup's label centres (1266 / 1344 / 1412 / 1494). */
const TAB_W: Record<RightTab, number> = { properties: 84, layers: 68, blocks: 68, references: 96 }

export function RightPanel() {
  const t = useT().cad.panel
  const tab = useCad((st) => st.rightTab)
  const set = useCad((st) => st.set)
  return (
    <section className={s.card}>
      <div className={s.tabs} role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`${s.tab} ${tab === k ? s.tabOn : ''}`} style={{ width: TAB_W[k] }} onClick={() => set({ rightTab: k })}>
            {t[k]}
          </button>
        ))}
      </div>
      <div className={`${s.body} scroll-y`}>
        {tab === 'properties' && <PropertiesTab />}
        {tab === 'layers' && <LayersTab />}
        {tab === 'blocks' && <BlocksTab />}
        {tab === 'references' && <ReferencesTab />}
      </div>
    </section>
  )
}

/** Blocks inserted from the Components library (grouped by name); a row selects all its instances. */
function BlocksTab() {
  const t = useT().cad.panel
  const doc = useCad((st) => st.activeDoc())
  const selection = useCad((st) => st.selection)
  const setSelection = useCad((st) => st.setSelection)
  const navigate = useRouter((st) => st.navigate)
  if (!doc) return null
  const blocks = new Map<string, { ids: string[]; inst: Set<string>; layer: string }>()
  for (const e of doc.entities) {
    if (!e.block) continue
    const b = blocks.get(e.block.name) ?? { ids: [], inst: new Set<string>(), layer: e.layer }
    b.ids.push(e.id)
    b.inst.add(e.block.id)
    blocks.set(e.block.name, b)
  }
  const sel = new Set(selection)
  return (
    <>
      {blocks.size === 0 && <p className={s.empty}>{t.noBlocks}</p>}
      {blocks.size > 0 && (
        <ul className={s.blocks}>
          {[...blocks].map(([name, b]) => (
            <li key={name}>
              <button type="button" className={b.ids.every((id) => sel.has(id)) ? s.blockOn : ''} title={fmt(t.blockSelect, { name })} onClick={() => setSelection(b.ids)}>
                <b>{name}</b>
                <small>{fmt(t.blockStats, { n: b.inst.size, m: b.ids.length })} · {b.layer}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={s.libLink} onClick={() => navigate('components')}>{t.openLibrary}</button>
    </>
  )
}

function common<T>(items: Entity[], get: (e: Entity) => T): T | '*' {
  if (!items.length) return '*'
  const v = get(items[0])
  return items.every((e) => get(e) === v) ? v : '*'
}

function PropertiesTab() {
  const T = useT()
  const t = T.cad.panel
  const doc = useCad((st) => st.activeDoc())
  const selection = useCad((st) => st.selection)
  const exec = useCad((st) => st.exec)
  const print = useCad((st) => st.print)
  const view = useCad((st) => (doc ? st.views[doc.id] : undefined))
  const vp = useCursor((st) => st.viewport)
  if (!doc) return null
  const selSet = new Set(selection)
  const sel = doc.entities.filter((e) => selSet.has(e.id))
  const v = view ?? defaultView(doc)
  const kinds = new Set(sel.map((e) => e.kind))
  const objectType = !sel.length
    ? t.noSelection
    : kinds.size === 1
      ? fmt(t.selectedN, { kind: T.cad.kinds[sel[0].kind], n: sel.length })
      : fmt(t.selectedN, { kind: T.cad.kinds.mixed, n: sel.length })

  const layerName = sel.length ? common(sel, (e) => e.layer) : doc.currentLayer
  const color = sel.length ? common(sel, (e) => e.color) : 'ByLayer'
  const linetype = sel.length ? common(sel, (e) => e.linetype) : 'ByLayer'
  const lineweight = sel.length ? common(sel, (e) => e.lineweight) : 'ByLayer'
  const transparency = sel.length ? common(sel, (e) => e.transparency) : 0
  const layerColor = doc.layers.find((l) => l.name === layerName)?.color ?? '#111827'

  const patch = (p: Partial<Entity>) => {
    if (!sel.length) return
    const err = exec({ type: 'replace', label: 'PROPERTIES', entities: sel.map((e) => ({ ...e, ...p }) as Entity) })
    if (err) print(err.code === 'locked-layer' ? T.cad.prompts.locked : err.detail, 'error')
  }
  const byLayer = (x: string) => (x === 'ByLayer' ? t.byLayer : x === '*' ? t.varies : x)

  return (
    <div className={s.inner}>
      <Section title={t.general}>
        <Row label={t.objectType}>
          <div className={s.field}>{objectType}</div>
        </Row>
        <Row label={t.layer}>
          <SelectField
            value={layerName === '*' ? '' : layerName}
            display={layerName === '*' ? t.varies : layerName}
            swatch={<span className={s.swatch} style={{ background: layerColor }} />}
            options={doc.layers.map((l) => ({ value: l.name, label: l.name }))}
            onChange={(name) => (sel.length ? patch({ layer: name }) : exec({ type: 'setCurrentLayer', layer: name, label: 'CLAYER' }))}
          />
        </Row>
        <Row label={t.color}>
          <SelectField
            value={color === '*' ? '' : color}
            display={byLayer(color)}
            swatch={<span className={`${s.swatch} ${s.swatchOutline}`} style={color !== 'ByLayer' && color !== '*' ? { background: color } : undefined} />}
            options={[
              { value: 'ByLayer', label: t.byLayer },
              { value: '#d92d20', label: 'Red' },
              { value: '#e8a400', label: 'Yellow' },
              { value: '#16a34a', label: 'Green' },
              { value: '#0e9aa7', label: 'Cyan' },
              { value: '#2563eb', label: 'Blue' },
              { value: '#111827', label: 'Black' },
            ]}
            disabled={!sel.length}
            onChange={(c) => patch({ color: c })}
          />
        </Row>
        <Row label={t.linetype}>
          <SelectField
            value={linetype === '*' ? '' : linetype}
            display={byLayer(linetype)}
            swatch={<span className={s.lineSample} />}
            rightAligned
            options={['ByLayer', 'Continuous', 'Dashed', 'DashDot'].map((x) => ({ value: x, label: x === 'ByLayer' ? t.byLayer : x }))}
            disabled={!sel.length}
            onChange={(x) => patch({ linetype: x as Entity['linetype'] })}
          />
        </Row>
        <Row label={t.lineweight}>
          <SelectField
            value={lineweight === '*' ? '' : lineweight}
            display={byLayer(lineweight)}
            swatch={<span className={`${s.lineSample} ${s.lineHeavy}`} />}
            rightAligned
            options={['ByLayer', '0.13', '0.25', '0.35', '0.50'].map((x) => ({ value: x, label: x === 'ByLayer' ? t.byLayer : `${x} mm` }))}
            disabled={!sel.length}
            onChange={(x) => patch({ lineweight: x as Entity['lineweight'] })}
          />
        </Row>
        <Row label={t.transparency}>
          <label className={`${s.field} ${s.spin}`}>
            <input
              type="number"
              min={0}
              max={90}
              value={transparency === '*' ? '' : transparency}
              placeholder={t.varies}
              disabled={!sel.length}
              onChange={(e) => patch({ transparency: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })}
            />
            <ChevronsUpDown size={14} strokeWidth={1.8} />
          </label>
        </Row>
      </Section>
      <div className={s.rule} />
      <Section title={t.view}>
        <Row label={t.centerX}>
          <div className={`${s.field} ${s.readonly}`}>{v.center.x.toFixed(3)}</div>
        </Row>
        <Row label={t.centerY}>
          <div className={`${s.field} ${s.readonly}`}>{v.center.y.toFixed(3)}</div>
        </Row>
        <Row label={t.height}>
          <div className={`${s.field} ${s.readonly}`}>{(vp.h * v.mmPerPx).toFixed(3)}</div>
        </Row>
        <Row label={t.width}>
          <div className={`${s.field} ${s.readonly}`}>{(vp.w * v.mmPerPx).toFixed(3)}</div>
        </Row>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={s.section}>
      <div className={s.sectionHead}>
        <span>{title}</span>
        <ChevronDown size={14} strokeWidth={1.8} />
      </div>
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.row}>
      <span className={s.label}>{label}</span>
      {children}
    </div>
  )
}

function SelectField({
  value,
  display,
  swatch,
  options,
  onChange,
  disabled,
  rightAligned,
}: {
  value: string
  display: string
  swatch?: ReactNode
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  disabled?: boolean
  rightAligned?: boolean
}) {
  return (
    <label className={`${s.field} ${s.select} ${rightAligned ? s.rightAligned : ''}`}>
      {swatch}
      <span className={s.selectText}>{display}</span>
      <ChevronDown size={15} strokeWidth={1.8} className={s.chev} />
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={display}>
        {!value && <option value="">{display}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function LayersTab() {
  const t = useT().cad.panel
  const doc = useCad((st) => st.activeDoc())
  const exec = useCad((st) => st.exec)
  if (!doc) return null
  return (
    <ul className={s.layers}>
      {doc.layers.map((l) => {
        const current = l.name === doc.currentLayer
        return (
          <li key={l.name} className={`${s.layerRow} ${current ? s.layerCurrent : ''}`}>
            <button type="button" className={s.layerName} onClick={() => exec({ type: 'setCurrentLayer', layer: l.name, label: 'CLAYER' })} title={t.current}>
              <span className={s.currentMark}>{current && <Check size={13} strokeWidth={2.4} />}</span>
              <span className={s.swatch} style={{ background: l.color }} />
              {l.name}
            </button>
            <button type="button" className={s.iconBtn} aria-pressed={l.visible} aria-label={`${t.on} ${l.name}`} onClick={() => exec({ type: 'layerProps', name: l.name, patch: { visible: !l.visible }, label: 'LAYER' })}>
              {l.visible ? <Eye size={15} /> : <EyeOff size={15} />}
            </button>
            <button type="button" className={s.iconBtn} aria-pressed={l.locked} aria-label={`${t.lock} ${l.name}`} onClick={() => exec({ type: 'layerProps', name: l.name, patch: { locked: !l.locked }, label: 'LAYER' })}>
              {l.locked ? <Lock size={15} /> : <Unlock size={15} />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function ReferencesTab() {
  const t = useT().cad.panel
  const doc = useCad((st) => st.activeDoc())
  if (!doc?.underlay) return <p className={s.empty}>{t.noRefs}</p>
  const u = doc.underlay
  return (
    <button type="button" className={s.ref} onClick={() => toast(t.imageNote)}>
      <ImageIcon size={18} strokeWidth={1.6} />
      <span>
        <strong>{u.name}</strong>
        <small>{fmt(t.imageRef, { w: u.natW, h: u.natH })}</small>
        <small>{t.imageNote}</small>
      </span>
    </button>
  )
}
