import { Box, FileText, Folder, FolderClosed, Spline, Square, TrendingDown, Waves } from 'lucide-react'
import { fmt, useT } from '../../i18n'
import { toast } from '../../state/toast'
import { useCivil } from '../../state/civil'
import { WsTree, type TreeNode } from '../../components/workspace/Workspace'
import { sta } from '../../civil/model'

const I = { size: 15, strokeWidth: 1.6 }

export function CivilBrowser() {
  const t = useT().civil
  const b = t.browser
  const { doc, browserSel, set } = useCivil()
  const root: TreeNode = {
    key: 'root',
    label: t.names[doc.alignment.site] ?? doc.alignment.site,
    icon: <Folder size={16} strokeWidth={1.6} fill="#3a4352" stroke="#3a4352" />,
    children: [
      { key: 'alignments', label: b.alignments, icon: <FolderClosed {...I} />, children: [
        { key: 'al-canal', label: 'CANAL-01 (Main)', icon: <Spline {...I} /> },
        { key: 'al-road1', label: 'Access Road-01', icon: <TrendingDown {...I} /> },
        { key: 'al-road2', label: 'Access Road-02', icon: <TrendingDown {...I} /> },
      ] },
      { key: 'profiles', label: b.profiles, icon: <FolderClosed {...I} />, children: [
        { key: 'pr-canal', label: 'CANAL-01 - Profile', icon: <TrendingDown {...I} /> },
        { key: 'pr-road', label: 'Road-01 - Profile', icon: <TrendingDown {...I} /> },
      ] },
      { key: 'xsections', label: b.sections, icon: <FolderClosed {...I} />, children: [
        { key: 'xs-canal', label: b.sectionsOf, icon: <FolderClosed {...I} />, children: [0, 100, 200, 300, 400, 500].map((x) => ({ key: `sta-${x}`, label: `STA ${sta(x)}`, icon: <Box {...I} /> })) },
      ] },
      { key: 'surfaces', label: b.surfaces, icon: <FolderClosed {...I} />, children: [
        { key: 'sf-eg', label: doc.survey ? `${b.eg} – ${doc.survey.name}` : b.eg, icon: <Waves {...I} /> },
        { key: 'sf-dg', label: b.dg, icon: <Waves {...I} /> },
      ] },
      { key: 'drainage', label: b.drainage, icon: <FolderClosed {...I} />, children: [
        { key: 'culverts', label: b.culverts, icon: <FolderClosed {...I} />, children: doc.culverts.map((c) => ({ key: `cv-${c.id}`, label: t.names[c.name] ?? c.name, icon: <Square {...I} /> })) },
      ] },
      { key: 'channel', gap: 6, label: b.channelDesign, icon: <FolderClosed {...I} />, children: [
        { key: 'ch-typ', label: b.typical, icon: <Box {...I} /> },
        { key: 'ch-lin', label: b.lining, icon: <Box {...I} /> },
      ] },
      { key: 'sheets', gap: 8, label: b.sheets, icon: <FolderClosed {...I} />, children: [b.sheet1, b.sheet2, b.sheet3, b.sheet4].map((n, i) => ({ key: `sh-${i}`, label: n, icon: <FileText {...I} /> })) },
    ],
  }
  const onSelect = (n: TreeNode) => {
    const k = n.key
    if (k.startsWith('sta-')) return set({ browserSel: k, station: Number(k.slice(4)), view: 'plan' })
    if (k === 'al-canal') return set({ browserSel: k, view: 'plan' })
    if (k === 'pr-canal') return set({ browserSel: k, view: 'profile' })
    if (k.startsWith('cv-')) return set({ browserSel: k, bottom: 'structures', view: 'plan' })
    if (k === 'ch-typ') return set({ browserSel: k, view: 'section' })
    if (k === 'ch-lin') return set({ browserSel: k, bottom: 'channel', view: 'plan' })
    if (k === 'sh-3') return set({ browserSel: k, view: 'schedule' })
    // sheets open the view placed on them
    const sheet = ({ 'sh-0': ['profile', b.profiles], 'sh-1': ['section', b.sections], 'sh-2': ['plan', b.culverts] } as const)[k as 'sh-0']
    if (sheet) {
      set({ browserSel: k, view: sheet[0], ...(k === 'sh-2' ? { bottom: 'structures' as const } : {}) })
      return toast(fmt(t.toast.sheetView, { sheet: n.label, view: sheet[1] }))
    }
    if (k === 'al-road1' || k === 'al-road2' || k === 'pr-road') return toast(fmt(t.toast.notModelled, { what: n.label }))
    if (k === 'sf-eg' && !doc.survey) return set({ browserSel: k, right: 'layers', importOpen: true })
    if (k === 'sf-eg' || k === 'sf-dg') return set({ browserSel: k, right: 'layers' })
    if (!n.children) toast(fmt(t.toast.native, { what: n.label }))
  }
  return <WsTree title={b.title} placeholder={b.search} root={root} active={browserSel} onSelect={onSelect} collapseLabel={b.collapse} expandLabel={b.expand} rowH={20.3} indent={{ base: -3, step: 14, leaf: 26 }} extraTop={6} groupGap={4} />
}
