import { useRouter } from './router'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fmt, getMessages } from '../i18n'
import { toast } from './toast'
import { useSettings } from './settings'
import { SAMPLE_TURNS, type ChatTurn, type ChatTurnAssistant } from '../ai/sampleSession'
import { recoverAfterRestart, type AiJob } from '../ai/jobs'

export type StudioTab = 'preview' | 'actions' | 'files'

interface AiStudioState {
  turns: ChatTurn[]
  /** True while the conversation shown is the recorded sample (mockup 03). */
  sample: boolean
  option: 1 | 2 | 3
  tab: StudioTab
  compare: boolean
  rejected: number[]
  /** Documents opened by "Approve & Apply" in this profile, newest last (for Undo). */
  applied: { option: number; docId: string; file: string }[]
  draft: string
  /** AI job queue (task presets, one command): persisted with step checkpoints, resumed after a restart. */
  jobs: AiJob[]

  send: (text: string, reply: string) => void
  /** Adds the user turn and a pending assistant turn; returns the assistant turn id. */
  startLive: (text: string, thinking: string) => string
  updateTurn: (id: string, patch: Partial<ChatTurnAssistant>) => void
  pushTool: (title: string, lines: string[]) => void
  newChat: () => void
  openSample: () => void
  set: (patch: Partial<Pick<AiStudioState, 'option' | 'tab' | 'compare' | 'draft'>>) => void
  reject: (n: number) => void
  recordApply: (a: { option: number; docId: string; file: string }) => void
  popApply: () => { option: number; docId: string; file: string } | null
  /** Inserts or replaces a job (every checkpoint goes through here, so it is persisted at once). */
  saveJob: (job: AiJob) => void
  removeJob: (id: string) => void
}

const now = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
let seq = 0
const id = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`

/** A request sent from another screen (CAD 2D AI Assist): AI Studio sends it as soon as the chat opens. */
export const chatInbox: { text: string | null } = { text: null }

/** Opens AI Studio and sends `text` there (routing, preview and approval happen in its chat). */
export function sendToAiStudio(text: string) {
  chatInbox.text = text
  useRouter.getState().navigate('ai-studio')
}

export const useAiStudio = create<AiStudioState>()(
  persist(
    (set, get) => ({
      turns: SAMPLE_TURNS,
      sample: true,
      option: 1,
      tab: 'preview',
      compare: false,
      rejected: [],
      applied: [],
      draft: '',
      jobs: [],

      send: (text, reply) =>
        set({
          turns: [
            ...get().turns,
            { role: 'user', id: id('u'), text, time: now() },
            // Honest notice — no model is attached, so no answer is fabricated.
            { role: 'assistant', id: id('a'), text: reply, tone: 'notice', time: now() },
          ],
          draft: '',
        }),
      startLive: (text, thinking) => {
        const aid = id('a')
        set({
          turns: [...get().turns, { role: 'user', id: id('u'), text, time: now() }, { role: 'assistant', id: aid, text: thinking, tone: 'live', time: now(), pending: true }],
          draft: '',
        })
        return aid
      },
      updateTurn: (tid, patch) =>
        set({ turns: get().turns.map((t) => (t.id === tid && t.role === 'assistant' ? { ...t, ...patch } : t)) }),
      pushTool: (title, lines) => set({ turns: [...get().turns, { role: 'assistant', id: id('t'), text: title, lines, tone: 'tool', time: now() }] }),
      newChat: () => set({ turns: [], sample: false, rejected: [], draft: '' }),
      openSample: () => set({ turns: SAMPLE_TURNS, sample: true, option: 1, rejected: [] }),
      set: (patch) => set(patch),
      reject: (n) => set({ rejected: [...new Set([...get().rejected, n])] }),
      recordApply: (a) => set({ applied: [...get().applied, a] }),
      popApply: () => {
        const last = get().applied.at(-1) ?? null
        if (last) set({ applied: get().applied.slice(0, -1) })
        return last
      },
      saveJob: (job) => {
        const jobs = get().jobs
        set({ jobs: jobs.some((j) => j.id === job.id) ? jobs.map((j) => (j.id === job.id ? job : j)) : [...jobs, job].slice(-100) })
      },
      removeJob: (jid) => set({ jobs: get().jobs.filter((j) => j.id !== jid) }),
    }),
    {
      name: 'thcad.aiStudio',
      version: 1,
      // A generation cannot survive an app restart: never restore a turn as still pending.
      // Proposals live in the engine's queue, which does not survive a restart either.
      onRehydrateStorage: () => (state) => {
        // jobs: resume at the last checkpoint (an apply caught half-way becomes a question, never a re-apply)
        if (state?.jobs?.length) {
          const jobs = state.jobs.map(recoverAfterRestart)
          // deferred: with synchronous storage this runs inside create(), before `useAiStudio` exists
          if (jobs.some((j, i) => j !== state.jobs[i]))
            setTimeout(() => {
              useAiStudio.setState({ jobs: useAiStudio.getState().jobs.map(recoverAfterRestart) })
              const n = jobs.filter((j, i) => j !== state.jobs[i]).length
              toast(fmt(getMessages(useSettings.getState().language).importCal.jobs.interrupted, { n }), 'warning')
            }, 0)
        }
        const stale = (x: ChatTurn) => x.role === 'assistant' && (x.pending || x.proposal?.status === 'pending')
        if (!state?.turns.some(stale)) return
        const c = getMessages(useSettings.getState().language).ai.chat
        useAiStudio.setState({
          turns: state.turns.map((x) => {
            if (x.role !== 'assistant' || !stale(x)) return x
            if (x.pending) return { ...x, pending: false, text: c.liveInterrupted }
            return { ...x, text: c.liveExpired, proposal: x.proposal ? { ...x.proposal, status: 'invalid' } : undefined }
          }),
        })
      },
    },
  ),
)
