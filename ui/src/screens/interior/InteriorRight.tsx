import { useState } from 'react'
import { ChevronRight, Send, Sparkles } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useInterior, type InteriorRight as Tab } from '../../state/interior'
import { DemoTag, NumField, PRow, PSelect, PanelTabs, Section, Select, wsStyles as w } from '../../components/workspace/Workspace'
import { MATERIALS, PRESETS, area, cutList, cutTotals, dimsLabel, perimeter, type Cabinet, type Item, type ItemCategory, type Room } from '../../interior/model'
import { AiResult, useAiAssist } from '../../components/ai/AiAssist'
import { interiorAi } from '../../ai/disciplines/interior'
import s from './Interior.module.css'

const n1 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 })

export function InteriorRight() {
  const t = useT().interior
  const { right, set } = useInterior()
  const tabs: { key: Tab; label: string }[] = [
    { key: 'properties', label: t.right.properties },
    { key: 'materials', label: t.right.materials },
    { key: 'ai', label: t.right.ai },
  ]
  return (
    <section className={`${w.card} ${s.right}`} aria-label={t.right[right]}>
      <PanelTabs tabs={tabs} active={right} onTab={(k) => set({ right: k })} widths={[97, 100, 116]} />
      <div className={`${w.pbody} ${s.rbody}`}>
        {right === 'properties' && <PropsTab />}
        {right === 'materials' && <MaterialsTab />}
        {right === 'ai' && <AiTab />}
      </div>
    </section>
  )
}

function useNames() {
  const t = useT().interior
  return { rn: (n: string) => t.roomNames[n] ?? n, mn: (m: string) => t.matNames[m] ?? m }
}

function report(err: string | null, t: ReturnType<typeof useT>['interior']) {
  if (err) toast(fmt(t.toast.invalid, { why: err }), 'warning')
}

function PropsTab() {
  const t = useT().interior
  const { doc, sel } = useInterior()
  if (!sel) return <p className={w.none}>{t.props.noSel}</p>
  if (sel.kind === 'item') {
    const it = doc.items.find((i) => i.id === sel.id)
    return it ? <ItemProps it={it} /> : <p className={w.none}>{t.props.noSel}</p>
  }
  if (sel.kind === 'cabinet') {
    const c = doc.cabinets.find((x) => x.id === sel.id)
    return c ? <CabinetProps c={c} /> : null
  }
  const r = doc.rooms.find((x) => x.id === sel.id)
  return r ? <RoomProps r={r} /> : null
}

function ItemProps({ it }: { it: Item }) {
  const t = useT().interior
  const p = t.props
  const { doc, edit, set } = useInterior()
  const { rn, mn } = useNames()
  const up = (label: string, patch: Partial<Item>) => report(edit(`${it.name}: ${label}`, (d) => ({ ...d, items: d.items.map((x) => (x.id === it.id ? { ...x, ...patch } : x)) })), t)
  const cab = it.cabinet ? doc.cabinets.find((c) => c.id === it.cabinet) : undefined
  return (
    <>
      <div className={w.elem}>
        {it.thumb ? <img className={w.elemThumb} src={it.thumb} alt="" /> : <span className={s.thumbNone} style={{ width: 56, height: 46 }} />}
        <div className={w.elemText}>
          <strong>{it.name}</strong>
          <span>{p.item} · {t.cats[it.category]}</span>
        </div>
      </div>
      <Section title={p.identity}>
        <PRow label={p.name}><span>{it.name}</span></PRow>
        <PRow label={p.category}>
          <PSelect label={p.category} value={it.category} onChange={(v) => up(p.category, { category: v as ItemCategory })} options={(Object.keys(t.cats) as ItemCategory[]).map((k) => ({ value: k, label: t.cats[k] }))} />
        </PRow>
        <PRow label={p.room}>
          <PSelect label={p.room} value={it.room} onChange={(v) => up(p.room, { room: v })} options={doc.rooms.map((r) => ({ value: r.id, label: rn(r.name) }))} />
        </PRow>
        <PRow label={p.qty}><NumField label={p.qty} value={it.qty} min={1} max={500} onCommit={(v) => up(p.qty, { qty: Math.round(v) })} /></PRow>
        <PRow label={p.status}>
          <PSelect label={p.status} value={it.status} onChange={(v) => up(p.status, { status: v })} options={(['placed', 'planned'] as const).map((k) => ({ value: k, label: t.status[k] }))} />
        </PRow>
      </Section>
      <Section title={p.dims}>
        {it.dia !== undefined ? (
          <PRow label={p.diameter}><NumField label={p.diameter} value={it.dia} min={1} onCommit={(v) => up(p.diameter, { dia: v })} unit="mm" /></PRow>
        ) : (
          <>
            <PRow label={p.width}><NumField label={p.width} value={it.w ?? 0} min={1} onCommit={(v) => up(p.width, { w: v })} unit="mm" /></PRow>
            <PRow label={p.depth}><NumField label={p.depth} value={it.d ?? 0} min={1} onCommit={(v) => up(p.depth, { d: v })} unit="mm" /></PRow>
          </>
        )}
        <PRow label={p.height}><NumField label={p.height} value={it.h} min={1} onCommit={(v) => up(p.height, { h: v })} unit="mm" /></PRow>
      </Section>
      <Section title={p.finish}>
        <PRow label={p.material}>
          <PSelect label={p.material} value={it.material} onChange={(v) => up(p.material, { material: v })} options={MATERIALS.filter((m) => m.kind !== 'board').map((m) => ({ value: m.name, label: mn(m.name) }))} />
        </PRow>
      </Section>
      {cab && (
        <Section title={p.production}>
          <PRow label={p.cabinetKind}>
            <button type="button" className={w.link} onClick={() => set({ sel: { kind: 'cabinet', id: cab.id } })}>{cab.name} <ChevronRight size={11} /></button>
          </PRow>
        </Section>
      )}
    </>
  )
}

function CabinetProps({ c }: { c: Cabinet }) {
  const t = useT().interior
  const p = t.props
  const { edit, set } = useInterior()
  const { mn } = useNames()
  const up = (label: string, patch: Partial<Cabinet>) => report(edit(`${c.name}: ${label}`, (d) => {
    const next = { ...c, ...patch }
    // the furniture item that represents this cabinet follows its size
    return { ...d, cabinets: d.cabinets.map((x) => (x.id === c.id ? next : x)), items: d.items.map((i) => (i.cabinet === c.id ? { ...i, w: next.w, d: next.d, h: next.h } : i)) }
  }), t)
  const tot = cutTotals(cutList(c))
  return (
    <>
      <div className={w.elem}>
        <span className={s.thumbNone} style={{ width: 56, height: 46 }} />
        <div className={w.elemText}>
          <strong>{c.name}</strong>
          <span>{p.cabinetKind} · {dimsLabel(c)}</span>
        </div>
      </div>
      <Section title={p.dims}>
        <PRow label={p.width}><NumField label={p.width} value={c.w} min={300} max={6000} onCommit={(v) => up(p.width, { w: v })} unit="mm" /></PRow>
        <PRow label={p.depth}><NumField label={p.depth} value={c.d} min={250} max={900} onCommit={(v) => up(p.depth, { d: v })} unit="mm" /></PRow>
        <PRow label={p.height}><NumField label={p.height} value={c.h} min={300} max={2800} onCommit={(v) => up(p.height, { h: v })} unit="mm" /></PRow>
        <PRow label={p.thickness}><NumField label={p.thickness} value={c.t} min={12} max={25} onCommit={(v) => up(p.thickness, { t: v })} unit="mm" /></PRow>
        <PRow label={p.doors}><NumField label={p.doors} value={c.doors} min={0} max={12} onCommit={(v) => up(p.doors, { doors: Math.round(v) })} /></PRow>
        <PRow label={p.shelves}><NumField label={p.shelves} value={c.shelves} min={0} max={10} onCommit={(v) => up(p.shelves, { shelves: Math.round(v) })} /></PRow>
      </Section>
      <Section title={p.finish}>
        <PRow label={p.board}>
          <PSelect label={p.board} value={c.board} onChange={(v) => up(p.board, { board: v })} options={MATERIALS.filter((m) => m.kind === 'board' && m.name.startsWith('MFC')).map((m) => ({ value: m.name, label: mn(m.name) }))} />
        </PRow>
        <PRow label={p.front}>
          <PSelect label={p.front} value={c.front} onChange={(v) => up(p.front, { front: v })} options={MATERIALS.filter((m) => m.kind === 'board' && m.name.startsWith('MFC')).map((m) => ({ value: m.name, label: mn(m.name) }))} />
        </PRow>
      </Section>
      <Section title={p.production}>
        <PRow label={p.parts}>
          <button type="button" className={w.link} onClick={() => set({ bottom: 'cutlist' })}>
            {fmt(t.cut.totals, { parts: tot.parts, area: tot.boardArea.toFixed(2), edge: tot.edge.toFixed(2) })}
          </button>
        </PRow>
      </Section>
    </>
  )
}

function RoomProps({ r }: { r: Room }) {
  const t = useT().interior
  const p = t.props
  const { edit } = useInterior()
  const { rn, mn } = useNames()
  const up = (label: string, patch: Partial<Room>) => report(edit(`${r.name}: ${label}`, (d) => ({ ...d, rooms: d.rooms.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) })), t)
  const fin = (k: 'floorFinish' | 'wallFinish' | 'ceilingFinish', kinds: string[]) => (
    <PSelect label={p[k]} value={r[k]} onChange={(v) => up(p[k], { [k]: v } as Partial<Room>)} options={MATERIALS.filter((m) => kinds.includes(m.kind)).map((m) => ({ value: m.name, label: mn(m.name) }))} />
  )
  return (
    <>
      <div className={w.elem}>
        <span className={s.roomIcon}>⌂</span>
        <div className={w.elemText}>
          <strong>{rn(r.name)}</strong>
          <span>{p.roomKind} · {t.viewer.level1}</span>
        </div>
      </div>
      <Section title={p.geometry}>
        <PRow label={p.area}><span>{area(r.outline).toFixed(1)} m²</span></PRow>
        <PRow label={p.perimeter}><span>{perimeter(r.outline).toFixed(1)} m</span></PRow>
        <PRow label={p.ceilingHeight}><NumField label={p.ceilingHeight} value={r.ceilingHeight} min={2200} max={6000} onCommit={(v) => up(p.ceilingHeight, { ceilingHeight: v })} unit="mm" /></PRow>
      </Section>
      <Section title={p.finish}>
        <PRow label={p.floorFinish}>{fin('floorFinish', ['tile', 'wood', 'stone'])}</PRow>
        <PRow label={p.wallFinish}>{fin('wallFinish', ['paint', 'tile', 'wood'])}</PRow>
        <PRow label={p.ceilingFinish}>{fin('ceilingFinish', ['gypsum', 'paint', 'wood'])}</PRow>
      </Section>
    </>
  )
}

function MaterialsTab() {
  const t = useT().interior
  const { doc, sel, edit } = useInterior()
  const { mn } = useNames()
  const item = sel?.kind === 'item' ? doc.items.find((i) => i.id === sel.id) : undefined
  return (
    <>
      <p className={s.matHint}>{item ? `${t.mats.assign}: ${item.name}` : t.mats.pick}</p>
      <ul className={s.matList}>
        {MATERIALS.filter((m) => m.kind !== 'board').map((m) => {
          const n = doc.items.filter((i) => i.material === m.name).length + doc.rooms.filter((r) => [r.floorFinish, r.wallFinish, r.ceilingFinish].includes(m.name)).length
          return (
            <li key={m.name}>
              <button
                type="button"
                className={item?.material === m.name ? s.matOn : undefined}
                disabled={!item}
                onClick={() => {
                  if (!item) return
                  const err = edit(`${item.name}: ${t.props.material}`, (d) => ({ ...d, items: d.items.map((x) => (x.id === item.id ? { ...x, material: m.name } : x)) }))
                  if (err) report(err, t)
                  else toast(fmt(t.toast.assigned, { material: mn(m.name), name: item.name }), 'success')
                }}
              >
                <i className={s.swatch} style={{ background: m.color }} />
                <span>{mn(m.name)}</span>
                <small>{n ? fmt(t.mats.usedBy, { n }) : t.mats.none}</small>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function AiTab() {
  const T = useT()
  const t = T.interior
  const a = t.aiPanel
  const { doc, room, styles, prompt, appliedPreset, edit, set } = useInterior()
  const { rn, mn } = useNames()
  const [sub, setSub] = useState<'suggestions' | 'generate' | 'modify'>('suggestions')
  const [sent, setSent] = useState(false)
  // desktop: the brief goes to the local model, which proposes changes to approve (see components/ai)
  const ai = useAiAssist(interiorAi, doc, (label, next) => edit(label, () => next))
  const brief = () => {
    const styleText = styles.length ? ` (${styles.map((k) => a.styles[k as 'modern']).join(', ')})` : ''
    return `${prompt ?? a.defaultPrompt}${styleText} — room: ${r.id}`
  }
  const r = doc.rooms.find((x) => x.id === room) ?? doc.rooms[0]
  const applyPreset = (key: (typeof PRESETS)[number]['key']) => {
    const pr = PRESETS.find((p) => p.key === key)!
    let n = 0
    const err = edit(`${a.presets[key]} → ${r.name}`, (d) => ({
      ...d,
      items: d.items.map((i) => {
        const m = i.room === r.id ? pr.materials[i.category] : undefined
        if (m && m !== i.material) n++
        return m ? { ...i, material: m } : i
      }),
      rooms: d.rooms.map((x) => (x.id === r.id ? { ...x, wallFinish: pr.wallFinish } : x)),
    }))
    if (err) return report(err, t)
    set({ appliedPreset: key })
    toast(fmt(t.toast.applied, { name: a.presets[key], room: rn(r.name), n }), 'success')
  }
  return (
    <>
      <div className={s.aiHead}>
        <span className={s.aiIcon}><Sparkles size={30} strokeWidth={1.5} /></span>
        <div>
          <h3>{a.title}</h3>
          <p>{a.desc}</p>
        </div>
      </div>
      <div className={s.seg} role="tablist">
        {(['suggestions', 'generate', 'modify'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={sub === k} className={sub === k ? s.segOn : undefined} onClick={() => setSub(k)}>
            {a.tabs[k]}
          </button>
        ))}
      </div>
      <div className={s.ctx}>
        <div className={s.ctxRow}>
          <b>{a.context}</b>
          <Select label={a.context} value={r.id} onChange={(v) => set({ room: v })} options={doc.rooms.map((x) => ({ value: x.id, label: rn(x.name) }))} className={s.ctxSel} />
        </div>
        <div className={s.chips}>
          {(['modern', 'warm', 'minimal', 'natural'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={styles.includes(k)} className={styles.includes(k) ? s.chipOn : undefined} onClick={() => set({ styles: styles.includes(k) ? styles.filter((x) => x !== k) : [...styles, k] })}>
              {a.styles[k]}
            </button>
          ))}
        </div>
        <div className={s.prompt}>
          <textarea value={prompt ?? a.defaultPrompt} onChange={(e) => { set({ prompt: e.target.value }); setSent(false) }} aria-label={a.context} />
          <button type="button" className={s.send} aria-label={a.send} title={a.send} disabled={ai.busy} onClick={() => { setSent(true); if (ai.host) void ai.send(brief()); else toast(t.toast.brief) }}>
            <Send size={15} strokeWidth={1.8} />
          </button>
        </div>
        {ai.host ? <AiResult a={ai} /> : (sent || sub !== 'suggestions') && <p className={s.note}>{sub === 'generate' ? a.generateNote : sub === 'modify' ? a.modifyNote : a.notConnected}</p>}
      </div>

      <section className={s.sugg}>
        <header>
          <Sparkles size={16} strokeWidth={1.6} />
          <b>{a.suggestions}</b>
          <DemoTag />
          <button type="button" className={w.link} onClick={() => toast(a.presetNote)}>{a.viewAll}</button>
        </header>
        {PRESETS.map((p) => (
          <figure key={p.key} className={s.suggCard}>
            <img src={p.image} alt={a.presets[p.key]} draggable={false} />
            <figcaption>{a.presets[p.key]}</figcaption>
            <button type="button" onClick={() => applyPreset(p.key)}>{appliedPreset === p.key ? a.applied : a.apply}</button>
          </figure>
        ))}
        <img className={s.suggMore} src="/assets/v2/interior/sugg-third.png" alt="" draggable={false} />
      </section>

      <section className={s.roomInfo}>
        <header>
          <span className={s.riIcon}>⊡</span>
          <b>{t.roomInfo.title}</b>
          <Select label={t.roomInfo.title} value={r.id} onChange={(v) => set({ room: v })} options={doc.rooms.map((x) => ({ value: x.id, label: rn(x.name) }))} className={s.riSel} />
        </header>
        <div className={s.riGrid}>
          <span>{t.roomInfo.floorArea}</span><b>{n1(area(r.outline))} m²</b>
          <span>{t.roomInfo.perimeter}</span><b>{n1(perimeter(r.outline))} m</b>
          <span>{t.roomInfo.ceilingHeight}</span><b>{r.ceilingHeight} mm</b>
          <span>{t.roomInfo.wallFinish}</span><b>{mn(r.wallFinish)}</b>
        </div>
        <button type="button" className={s.riRow} onClick={() => set({ sel: { kind: 'room', id: r.id }, right: 'properties' })}>
          <span>{t.roomInfo.floorFinish}</span><b>{mn(r.floorFinish)}</b><ChevronRight size={13} />
        </button>
        <button type="button" className={s.riRow} onClick={() => set({ sel: { kind: 'room', id: r.id }, right: 'properties' })}>
          <span>{t.roomInfo.ceilingFinish}</span><b>{mn(r.ceilingFinish)}</b><ChevronRight size={13} />
        </button>
      </section>
    </>
  )
}
