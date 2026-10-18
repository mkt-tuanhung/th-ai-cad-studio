import { useEffect, useRef } from 'react'
import { Check, Ellipsis, Mic, Paperclip, Pencil, Plus, SendHorizontal, Wrench } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { useCad } from '../../state/cad'
import { useRouter } from '../../state/router'
import { getHost } from '../../services/host'
import { nativeAiReady, requestNativeEdit } from '../../services/liveAi'
import { answer as aiAnswer, route as aiRoute } from '../../ai/chat'
import { useVoice } from '../../ai/voice'
import { useLang } from '../../i18n'
import { fromNativeOps } from '../../services/nativeCad'
import { cadMirror } from '../../state/cad'
import { chatInbox, useAiStudio } from '../../state/aiStudio'
import { toast } from '../../state/toast'
import { PROPOSALS, type ChatTurn } from '../../ai/sampleSession'
import { AiSparkIcon } from '../../components/icons'
import { MenuList, PopoverPanel, useDismissable } from '../../components/ui/Popover'
import { ProposalIcon } from './ProposalIcon'
import s from './ChatPanel.module.css'

const CHIPS = ['e.g. "Tối ưu mặt bằng"', '"Fix wall intersections"', '"Convert PDF to CAD"', '"Compare two versions"']

export function ChatPanel() {
  const T = useT()
  const t = T.ai.chat
  const { turns, sample, newChat, openSample, send, draft, set, startLive, updateTurn } = useAiStudio()
  const [menuOpen, setMenuOpen, menuRef] = useDismissable<HTMLDivElement>()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Voice CAD: on-device speech → the composer (the user reads it, then sends)
  const lang = useLang()
  const base = useRef('')
  const voice = useVoice(
    lang === 'vi' ? 'vi-VN' : 'en-US',
    (text) => set({ draft: (base.current ? base.current + ' ' : '') + text }),
    (why) => toast(why === 'browser' ? t.voiceNative : fmt(t.voiceUnavailable, { why }), 'warning'),
    (used, why) => toast(fmt(t.voiceFallback, { why, used })),
    (st) => (st === 'transcribing' ? toast(t.voiceTranscribing) : st === 'silence' ? toast(t.voiceSilence, 'warning') : undefined),
  )
  const toggleVoice = () => {
    if (!voice.listening) {
      base.current = useAiStudio.getState().draft.trim()
      toast(t.voiceListening)
    }
    void voice.toggle()
  }
  useEffect(() => {
    const onVoice = () => toggleVoice()
    window.addEventListener('thcad-voice', onVoice)
    return () => window.removeEventListener('thcad-voice', onVoice)
  })

  useEffect(() => {
    if (!sample) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, sample])

  // a request sent from CAD 2D (AI Assist): shown in the composer, then sent — its result is still a preview
  useEffect(() => {
    const text = chatInbox.text
    if (!text) return
    chatInbox.text = null
    set({ draft: text })
    void submit(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (queued?: string) => {
    const text = (queued ?? draft).trim()
    if (!text) return
    // Desktop app with a loaded local model → real inference; otherwise the honest notice.
    if (!(await nativeAiReady())) return send(text, t.runtimeReply)
    const host = await getHost()
    const doc = useCad.getState().activeDoc()
    const tid = startLive(text, t.thinking)
    // questions get a written answer; requests to change the open drawing go to the edit pipeline
    const where = host ? await aiRoute(host, text) : 'no-model'
    if (where !== 'edit' || !doc) {
      if (!host || where === 'no-model') return updateTurn(tid, { pending: false, text: t.runtimeReply })
      const a = await aiAnswer(host, text, useAiStudio.getState().turns.filter((x) => x.id !== tid))
      return updateTurn(tid, {
        pending: false,
        text: a.ok ? a.text : fmt(t.liveInvalid, { error: a.error ?? 'empty reply' }),
        stats: a.seconds ? fmt(t.liveStats, { seconds: a.seconds.toFixed(1), tps: Math.round(a.tokensPerSecond ?? 0) }) + (where === 'edit' ? ` · ${t.liveNoDoc}` : '') : undefined,
      })
    }
    const r = await requestNativeEdit(text, doc)
    const p = r.proposal
    updateTurn(tid, {
      pending: false,
      docId: doc.id,
      proposal: p,
      text: r.ok && p ? fmt(t.liveProposal, { added: p.added, erased: p.erased, modified: p.modified }) : fmt(t.liveInvalid, { error: r.message }),
      stats: r.seconds ? fmt(t.liveStats, { seconds: r.seconds.toFixed(1), tps: Math.round(r.tokensPerSecond ?? 0) }) : undefined,
    })
  }

  return (
    <div className={s.column}>
      <section className={s.card}>
        <header className={s.head}>
          <h2 className={s.title}>{t.title}</h2>
          <button type="button" className={s.newChat} onClick={newChat}>
            <Plus size={17} strokeWidth={1.7} />
            {t.newChat}
          </button>
          <div className={s.anchor} ref={menuRef}>
            <button type="button" className={s.more} aria-label={t.more} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
              <Ellipsis size={17} strokeWidth={2} />
            </button>
            {menuOpen && (
              <PopoverPanel width={260}>
                <p className={s.menuNote}>{t.sampleNote}</p>
                <MenuList onClose={() => setMenuOpen(false)} items={[{ label: t.openSample, onSelect: openSample }, { label: T.importCal.presets.menu, onSelect: () => window.dispatchEvent(new CustomEvent('thcad-presets', { detail: 'presets' })) }, { label: T.importCal.jobs.menu, onSelect: () => window.dispatchEvent(new CustomEvent('thcad-presets', { detail: 'jobs' })) }]} />
              </PopoverPanel>
            )}
          </div>
        </header>
        <div ref={listRef} className={`${s.list} scroll-y`} data-source={sample ? 'demo' : 'local'}>
          {turns.length === 0 && <p className={s.empty}>{t.empty}</p>}
          {turns.map((turn) => (
            <Turn
              key={turn.id}
              turn={turn}
              onEdit={(text) => {
                set({ draft: text.replace(/\n/g, ' ') })
                inputRef.current?.focus()
              }}
            />
          ))}
        </div>
      </section>

      <form
        className={s.composer}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <button type="button" className={s.cbtn} aria-label={t.attach} title={t.attach} onClick={() => fileRef.current?.click()}>
          <Paperclip size={21} strokeWidth={1.6} />
        </button>
        <input
          ref={inputRef}
          className={s.input}
          value={draft}
          placeholder={t.placeholder}
          aria-label={t.placeholder}
          onChange={(e) => set({ draft: e.target.value })}
        />
        <button type="button" className={`${s.cbtn} ${voice.listening ? s.cbtnOn : ''}`} aria-label={t.voice} title={t.voice} aria-pressed={voice.listening} aria-busy={voice.busy} disabled={voice.busy} onClick={toggleVoice}>
          <Mic size={20} strokeWidth={1.6} />
        </button>
        <button type="submit" className={s.send} aria-label={t.send} disabled={!draft.trim() || turns.some((x) => x.role === 'assistant' && x.pending)}>
          <SendHorizontal size={17} strokeWidth={1.8} />
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/*,.pdf,.dxf,.dwg"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) set({ draft: `${draft ? draft + ' ' : ''}[${f.name}]` })
            e.target.value = ''
          }}
        />
      </form>
      <div className={s.chips}>
        {CHIPS.map((c) => (
          <button key={c} type="button" className={s.chip} onClick={() => set({ draft: c.replace(/^e\.g\. /, '').replace(/"/g, '') })}>
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}

function Turn({ turn, onEdit }: { turn: ChatTurn; onEdit: (text: string) => void }) {
  const T = useT()
  const t = T.ai.chat
  const { set, rejected, updateTurn } = useAiStudio()
  const navigate = useRouter((st) => st.navigate)
  if (turn.role === 'user') {
    return (
      <div className={s.row}>
        <img className={s.avatar} src="/assets/extracted/avatar_user.png" alt="" />
        <div className={s.userBubble}>
          <p className={s.userText}>{turn.text}</p>
          {turn.translation && (
            <>
              <div className={s.rule} />
              <p className={s.translation}>{turn.translation}</p>
            </>
          )}
          <div className={s.meta}>
            <span>{turn.time}</span>
            <button type="button" aria-label={t.edit} title={t.edit} onClick={() => onEdit(turn.text)}>
              <Pencil size={14} strokeWidth={1.7} />
            </button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className={s.row}>
      <span className={`${s.botAvatar} ${turn.tone ? s.botMuted : ''}`}>{turn.tone === 'tool' ? <Wrench size={19} strokeWidth={1.7} /> : <AiSparkIcon size={23} strokeWidth={1.6} />}</span>
      <div className={`${s.botCard} ${turn.tone === 'notice' ? s.notice : ''} ${turn.pending ? s.pending : ''}`}>
        <p className={s.botText}>{turn.text}</p>
        {turn.lines && (
          <ul className={s.toolLines}>
            {turn.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
        {turn.steps && (
          <ul className={s.steps}>
            {turn.steps.map((st) => (
              <li key={st}>
                <span className={s.check}>
                  <Check size={11} strokeWidth={3} />
                </span>
                {st}
              </li>
            ))}
          </ul>
        )}
        {turn.done && (
          <div className={s.done}>
            <span className={s.check}>
              <Check size={11} strokeWidth={3} />
            </span>
            <span className={s.doneText}>{turn.done.label}</span>
            <span className={s.doneSep}>·</span>
            <span>{`${turn.done.seconds} ${turn.done.unit}`}</span>
            <span className={s.doneTime}>{turn.time}</span>
          </div>
        )}
        {turn.proposals && (
          <div className={s.proposals}>
            <h3 className={s.propTitle}>{turn.proposalsHeading ?? t.proposals}</h3>
            {PROPOSALS.map((p) => (
              <div key={p.n} className={`${s.prop} ${rejected.includes(p.n) ? s.propRejected : ''}`}>
                <span className={s.propIcon}>
                  <ProposalIcon kind={p.icon} />
                </span>
                <span className={s.propText}>
                  <span className={s.propName}>
                    <strong>Phương án {p.n}</strong> – {p.chatTitle}
                  </span>
                  <span className={s.propDesc}>{p.chatDesc}</span>
                </span>
                <button type="button" className={s.propBtn} onClick={() => set({ option: p.n, tab: 'preview' })}>
                  {t.preview}
                </button>
              </div>
            ))}
          </div>
        )}
        {turn.tone === 'live' && turn.proposal?.status === 'pending' && (
          <div className={s.liveBtns}>
            <button
              type="button"
              className={s.liveApprove}
              onClick={async () => {
                const p = turn.proposal!
                const cad = useCad.getState()
                if (turn.docId && cad.docs[turn.docId]) cad.setActive(turn.docId)
                // the engine approves first (re-validated against its current document) …
                const host = await getHost()
                const res = host ? await host.approveProposal(p.id) : { ok: true }
                if (!res.ok) {
                  const e = (res as { error?: { code: string; detail: string } }).error
                  return updateTurn(turn.id, { text: fmt(t.liveInvalid, { error: `${e?.code ?? ''} ${e?.detail ?? ''}` }), proposal: { ...p, status: 'invalid' } })
                }
                // … then the UI applies the same ops as one undo step (not re-sent to the engine)
                cadMirror.suspended = true
                let err
                try {
                  err = cad.execBatch(fromNativeOps(p.ops, `AI: ${p.title}`), `AI: ${p.title}`)
                } finally {
                  cadMirror.suspended = false
                }
                if (err) return updateTurn(turn.id, { text: fmt(t.liveInvalid, { error: `${err.code} ${err.detail}` }), proposal: { ...p, status: 'invalid' } })
                updateTurn(turn.id, { text: fmt(t.liveApproved, { name: useCad.getState().activeDoc()?.name ?? '' }), proposal: { ...p, status: 'approved' } })
              }}
            >
              <Check size={14} strokeWidth={2.4} />
              {t.liveApprove}
            </button>
            <button
              type="button"
              className={s.liveReject}
              onClick={async () => {
                ;(await getHost())?.rejectProposal(turn.proposal!.id)
                updateTurn(turn.id, { text: t.liveRejected, proposal: { ...turn.proposal!, status: 'rejected' } })
              }}
            >
              {t.liveReject}
            </button>
          </div>
        )}
        {turn.tone === 'live' && turn.proposal?.status === 'approved' && (
          <button type="button" className={s.liveLink} onClick={() => navigate('cad2d')}>
            {t.liveOpenCad} →
          </button>
        )}
        {turn.stats && <div className={s.liveStats}>{turn.stats}</div>}
        {turn.tone && turn.time && <div className={s.noticeTime}>{turn.time}</div>}
      </div>
    </div>
  )
}
