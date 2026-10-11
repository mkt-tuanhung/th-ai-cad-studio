import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronRight, Pencil, Plus, Star } from 'lucide-react'
import { fmt, relativeTime, useLang, useT } from '../../i18n'
import { detailsOf, useWorkspace, type Project } from '../../state/workspace'
import { ALL_TAGS, GB_BYTES, PEOPLE, type Activity, type ProjectStatus } from '../../state/projectSeed'
import { getLocalAi, type LocalAiStatus } from '../../services/localAi'
import { useDismissable, PopoverPanel, MenuList } from '../../components/ui/Popover'
import { AiSparkIcon } from '../../components/icons'
import { StatusBadge, badgeOf } from './ProjectGridCard'
import { ActivityModal, EditProjectModal } from './ProjectsModals'
import s from './ProjectInspector.module.css'

export function useActivityText() {
  const T = useT().projects
  return (a: Activity) =>
    fmt(T.activity[a.kind], { target: a.target ?? '', count: a.count ?? 0 })
}

export function ActivityRow({ a, now }: { a: Activity; now: number }) {
  const T = useT().projects
  const lang = useLang()
  const text = useActivityText()
  const person = PEOPLE[a.who]
  // highlight the object of "updated …" like the mockup (blue link colour)
  const body = text(a)
  const target = a.kind === 'updated' && a.target ? a.target : null
  return (
    <li className={s.act}>
      {person ? <img className={s.actAvatar} src={person.avatar} alt="" /> : <span className={s.actAi}><AiSparkIcon size={15} strokeWidth={1.7} /></span>}
      <p className={s.actText}>
        <b>{person ? person.name : T.activity.ai}</b>{' '}
        {target ? (
          <>
            {body.slice(0, body.indexOf(target))}
            <span className={s.actTarget}>{target}</span>
          </>
        ) : (
          body
        )}
      </p>
      <time className={s.actTime}>{relativeTime(a.at, lang, now)}</time>
    </li>
  )
}

export function ProjectInspector({ project }: { project: Project | null }) {
  const t = useT()
  const T = t.projects
  const I = T.inspector
  const lang = useLang()
  const ws = useWorkspace()
  const [ai, setAi] = useState<LocalAiStatus | null>(null)
  const [modal, setModal] = useState<null | 'edit' | 'activity'>(null)
  const [tagOpen, setTagOpen, tagRef] = useDismissable<HTMLDivElement>()
  const [teamOpen, setTeamOpen, teamRef] = useDismissable<HTMLDivElement>()
  const now = Date.now()

  useEffect(() => {
    getLocalAi().status().then(setAi)
  }, [])

  const usedBytes = useMemo(
    () => (project ? ws.entries.filter((e) => e.projectId === project.id).reduce((n, e) => n + (e.sizeBytes ?? 0), 0) : 0),
    [ws.entries, project],
  )
  const activity = useMemo(() => (project ? ws.activity.filter((a) => a.projectId === project.id) : []), [ws.activity, project])

  if (!project) return <aside className={s.panel}><p className={s.none}>{I.none}</p></aside>
  const d = detailsOf(project)
  const creator = PEOPLE[d.createdBy] ?? PEOPLE.hoang
  const usedGb = usedBytes / GB_BYTES
  const missingTags = ALL_TAGS.filter((x) => !d.tags.includes(x))
  const statusKinds: ProjectStatus[] = ['active', 'in-progress', 'draft', 'archived']
  const date = new Date(`${d.startDate}T00:00:00`)
  const dateLabel = Number.isNaN(date.getTime()) ? d.startDate : date.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const modelLabel = ai ? (ai.modelName ?? I.aiNone) : '…'

  return (
    <aside className={s.panel} aria-label={project.name}>
      <div className={s.hero}>
        {d.hero || d.cover ? <img src={d.hero ?? d.cover} alt="" draggable={false} /> : <div className={s.heroEmpty} />}
        <StatusBadge kind={badgeOf(project)} className={s.heroBadge} />
        <button type="button" className={s.edit} onClick={() => setModal('edit')}>
          <Pencil size={15} strokeWidth={1.8} />
          {I.edit}
        </button>
      </div>

      <div className={s.nameRow}>
        <h2 className={s.name}>{project.name}</h2>
        <button type="button" className={`${s.fav} ${project.favorite ? s.favOn : ''}`} aria-pressed={project.favorite}
          aria-label={project.favorite ? T.menu.unfavorite : T.menu.favorite} onClick={() => ws.toggleFavorite(project.id)}>
          <Star size={19} strokeWidth={1.6} fill={project.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      <p className={s.path}>/Projects/{project.name}</p>
      <p className={s.desc}>{d.description || d.summary}</p>

      <div className={s.tags}>
        {d.tags.map((tag) => (
          <span key={tag} className={s.tag}>{T.tags[tag]}</span>
        ))}
        {missingTags.length > 0 && (
          <div className={s.tagAdd} ref={tagRef}>
            <button type="button" aria-label={I.addTag} aria-expanded={tagOpen} onClick={() => setTagOpen(!tagOpen)}>
              <Plus size={15} strokeWidth={1.8} />
            </button>
            {tagOpen && (
              <PopoverPanel width={170}>
                <MenuList onClose={() => setTagOpen(false)} items={missingTags.map((x) => ({ label: T.tags[x], onSelect: () => ws.updateDetails(project.id, { tags: [...d.tags, x] }) }))} />
              </PopoverPanel>
            )}
          </div>
        )}
      </div>

      <dl className={s.fields}>
        <dt>{I.status}</dt>
        <dd>
          <label className={`${s.control} ${s.statusSel} ${s[`st_${d.status.replace('-', '_')}`]}`}>
            <i />
            <span>{T.status[d.status]}</span>
            <select value={d.status} onChange={(e) => ws.setStatus(project.id, e.target.value as ProjectStatus)} aria-label={I.status}>
              {statusKinds.map((k) => (
                <option key={k} value={k}>{T.status[k]}</option>
              ))}
            </select>
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
          </label>
        </dd>

        <dt>{I.startDate}</dt>
        <dd>
          <label className={`${s.control} ${s.dateCtl}`}>
            <span>{dateLabel}</span>
            <CalendarDays size={16} strokeWidth={1.6} aria-hidden="true" />
            <input type="date" value={d.startDate} onChange={(e) => e.target.value && ws.updateDetails(project.id, { startDate: e.target.value })} aria-label={I.startDate} />
          </label>
        </dd>

        <dt>{I.lastModified}</dt>
        <dd className={s.text}>{relativeTime(project.modifiedAt, lang, now)}</dd>

        <dt>{I.createdBy}</dt>
        <dd className={s.person}>
          <img src={creator.avatar} alt="" />
          {creator.name}
        </dd>

        <dt className={s.teamDt}>{I.team}</dt>
        <dd className={s.teamDd} ref={teamRef}>
          <button type="button" className={s.teamBtn} aria-expanded={teamOpen} onClick={() => setTeamOpen(!teamOpen)}>
            {project.id === 'villa-riverside' ? (
              <img className={s.teamImg} src="/assets/v2/people/team_villa.png" width={71} height={26} alt="" />
            ) : (
              d.members.map((m) => PEOPLE[m] && <img key={m} className={s.teamOne} src={PEOPLE[m].avatar} alt="" />)
            )}
            {d.team && d.team.extra > 0 && <span className={s.extra}>+{d.team.extra}</span>}
            <ChevronRight size={16} strokeWidth={1.8} className={s.teamChev} />
          </button>
          {teamOpen && (
            <PopoverPanel width={200}>
              <MenuList onClose={() => setTeamOpen(false)} items={d.members.map((m) => ({ label: PEOPLE[m]?.name ?? m, onSelect: () => undefined }))} />
            </PopoverPanel>
          )}
        </dd>

        <dt>{I.storage}</dt>
        <dd className={s.storage}>
          <span className={s.bar}><span style={{ width: `${Math.min(100, (usedGb / d.storageQuotaGb) * 100)}%` }} /></span>
          <span>{usedGb.toFixed(1)} / {d.storageQuotaGb} GB</span>
        </dd>

        <dt>{I.autoSave}</dt>
        <dd className={s.toggleRow}>
          <button type="button" role="switch" aria-checked={d.autoSave.enabled} aria-label={I.autoSave} className={`${s.switch} ${d.autoSave.enabled ? s.on : ''}`}
            onClick={() => ws.updateDetails(project.id, { autoSave: { ...d.autoSave, enabled: !d.autoSave.enabled } })}>
            <i />
          </button>
          <span>{d.autoSave.enabled ? fmt(I.everyMinutes, { n: d.autoSave.minutes }) : I.off}</span>
        </dd>

        <dt>{I.aiModel}</dt>
        <dd>
          <div className={`${s.control} ${s.readonly}`} title={ai?.source === 'demo' ? I.aiDemo : undefined}>
            <span>{modelLabel}</span>
            {ai?.source === 'demo' && <em className={s.demo}>DEMO</em>}
          </div>
        </dd>

        <dt>{I.units}</dt>
        <dd>
          <label className={s.control}>
            <span>{d.units === 'metric' ? I.metric : I.imperial}</span>
            <select value={d.units} onChange={(e) => ws.updateDetails(project.id, { units: e.target.value as 'metric' | 'imperial' })} aria-label={I.units}>
              <option value="metric">{I.metric}</option>
              <option value="imperial">{I.imperial}</option>
            </select>
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
          </label>
        </dd>
      </dl>

      <div className={s.recentHead}>
        <h3>{I.recent}</h3>
        <button type="button" onClick={() => setModal('activity')}>{I.viewAll}</button>
      </div>
      <ul className={s.acts}>
        {activity.slice(0, 4).map((a) => (
          <ActivityRow key={a.id} a={a} now={now} />
        ))}
        {activity.length === 0 && <li className={s.noAct}>{I.noActivity}</li>}
      </ul>

      {modal === 'edit' && (
        <EditProjectModal
          project={project}
          onClose={() => setModal(null)}
          onSave={(patch) => {
            if (patch.name && patch.name !== project.name) ws.renameProject(project.id, patch.name)
            ws.updateDetails(project.id, { description: patch.description, summary: patch.summary })
            setModal(null)
          }}
        />
      )}
      {modal === 'activity' && <ActivityModal items={activity} onClose={() => setModal(null)} />}
    </aside>
  )
}
