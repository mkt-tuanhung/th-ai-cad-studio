import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, useT } from '../../i18n'
import { Modal } from '../../components/ui/Modal'
import { Field, Select, TextInput } from '../../components/ui/Field'
import { ActionButton } from '../../components/ui/Button'
import { ORDERS, detectFormat, parseShapefile, parseSurvey, previewCsv, type ColumnOrder, type CsvOptions, type Survey } from '../../civil/survey'
import { buildTin, polyLength } from '../../civil/tin'
import { applyPlan, applySurveyImport } from './surveyActions'
import { useCivil } from '../../state/civil'
import { decodeDxf } from '../../cad/dxfImport'
import s from './Civil.module.css'

/** A chosen / dropped survey: one text file, or a shapefile set (.shp with its .dbf / .prj). */
export interface SurveyInput {
  name: string
  text?: string
  shp?: { shp: ArrayBuffer; dbf?: ArrayBuffer; prj?: string }
}

/** Reads the chosen files (DXF in its code page, other text UTF-8, shapefile parts as binary). */
export async function readSurveyFiles(list: FileList | File[]): Promise<SurveyInput | null> {
  const files = Array.from(list)
  const shp = files.find((f) => /\.shp$/i.test(f.name))
  if (shp) {
    const base = shp.name.replace(/\.shp$/i, '').toLowerCase()
    const part = (ext: string) => files.find((f) => f.name.toLowerCase() === `${base}.${ext}`)
    const dbf = part('dbf'), prj = part('prj')
    return { name: shp.name, shp: { shp: await shp.arrayBuffer(), dbf: dbf ? await dbf.arrayBuffer() : undefined, prj: prj ? await prj.text() : undefined } }
  }
  const f = files[0]
  if (!f) return null
  const bytes = new Uint8Array(await f.arrayBuffer())
  return { name: f.name, text: /\.dxf$/i.test(f.name) ? decodeDxf(bytes).text : new TextDecoder('utf-8').decode(bytes) }
}

const n2 = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 })

/** Survey / GIS import: format detection, CSV column mapping, preview of the surface, then one undoable edit. */
export function ImportSurveyDialog({ initial, onClose }: { initial?: SurveyInput | null; onClose: () => void }) {
  const t = useT().civil.survey
  const [file, setFile] = useState<SurveyInput | null>(initial ?? null)
  const [csv, setCsv] = useState<CsvOptions>({})
  const [maxEdge, setMaxEdge] = useState('')
  const [useAl, setUseAl] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setFile(initial ?? null), [initial])

  const parsed = useMemo((): { survey?: Survey; error?: string } => {
    if (!file) return {}
    try {
      if (file.shp) return { survey: parseShapefile(file.name, file.shp.shp, file.shp.dbf, file.shp.prj) }
      return { survey: parseSurvey(file.name, file.text ?? '', csv) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [file, csv])
  const format = file?.text !== undefined ? detectFormat(file.name, file.text) : null
  const pv = useMemo(() => (file?.text !== undefined && format === 'csv' ? previewCsv(file.text, csv) : null), [file, format, csv])
  const edge = maxEdge.trim() === '' ? null : Number(maxEdge)
  const alignmentOnly = !!parsed.survey && parsed.survey.x.length < 3
  const hasSurface = !!useCivil((st) => st.doc.survey)
  const tin = useMemo(() => (parsed.survey && !alignmentOnly ? buildTin(parsed.survey, edge && edge > 0 ? edge : null) : null), [parsed.survey, edge, alignmentOnly])

  const doImport = () => {
    if (alignmentOnly && parsed.survey?.alignment && hasSurface) {
      applyPlan(parsed.survey.alignment, t)
      return onClose()
    }
    if (!parsed.survey || !tin) return
    if (applySurveyImport(parsed.survey, useAl && !!parsed.survey.alignment, edge && edge > 0 ? edge : null, t)) onClose()
  }

  const sv = parsed.survey
  return (
    <Modal
      title={t.title}
      width={620}
      onClose={onClose}
      footer={
        <>
          <ActionButton onClick={onClose}>{t.cancel}</ActionButton>
          <ActionButton variant="primary" onClick={doImport} disabled={alignmentOnly ? !hasSurface : !sv || !tin || tin.tri.length === 0}>{t.import}</ActionButton>
        </>
      }
    >
      <div className={s.importBox} data-testid="survey-import">
        <p className={s.importNote}>{t.formats}</p>
        <Field label={t.file}>
          <div className={s.importFile}>
            <ActionButton onClick={() => input.current?.click()}>{t.choose}</ActionButton>
            <span>{file?.name ?? t.drop}</span>
            <input
              ref={input}
              type="file"
              hidden
              multiple
              accept=".csv,.txt,.xyz,.pnezd,.xml,.landxml,.geojson,.json,.dxf,.shp,.dbf,.prj"
              aria-label={t.file}
              onChange={async (e) => {
                const f = e.target.files && (await readSurveyFiles(e.target.files))
                if (f) setFile(f)
                e.target.value = ''
              }}
            />
          </div>
        </Field>
        {pv && (
          <div className={s.importRow}>
            <Field label={t.order}>
              <Select value={pv.order} aria-label={t.order} onChange={(e) => setCsv({ ...csv, order: e.target.value as ColumnOrder })}>
                {ORDERS.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Field>
            <Field label={t.delimiter}>
              <Select value={pv.delimiter} aria-label={t.delimiter} onChange={(e) => setCsv({ ...csv, delimiter: e.target.value as CsvOptions['delimiter'] })}>
                {[[',', ', (comma)'], [';', '; (semicolon)'], ['\t', 'Tab'], [' ', 'Space']].map(([v, l]) => <option key={l} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label={t.units}>
              <Select value={String(csv.scale ?? 1)} aria-label={t.units} onChange={(e) => setCsv({ ...csv, scale: Number(e.target.value) })}>
                <option value="1">{t.unitM}</option>
                <option value="0.3048">{t.unitFt}</option>
                <option value={String(1200 / 3937)}>{t.unitUsft}</option>
              </Select>
            </Field>
          </div>
        )}
        {pv && (
          <table className={s.importTable} aria-label={t.preview}>
            <thead><tr>{pv.order.split('').map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
            <tbody>{pv.rows.slice(0, 5).map((r, i) => <tr key={i}>{pv.order.split('').map((_, j) => <td key={j}>{j === pv.order.length - 1 && pv.order.endsWith('D') ? r.slice(j).join(' ') : r[j]}</td>)}</tr>)}</tbody>
          </table>
        )}
        {parsed.error && <p className={s.importErr} role="alert">{fmt(t.error, { why: parsed.error })}</p>}
        {alignmentOnly && sv?.alignment && (
          <p className={hasSurface ? s.importNote : s.importErr} role={hasSurface ? undefined : 'alert'}>
            {fmt(hasSurface ? t.alignmentOnly : t.alignmentNeedsSurface, { name: sv.alignmentName ?? sv.name, l: n2(polyLength(sv.alignment)) })}
          </p>
        )}
        {sv && tin && (
          <dl className={s.importStats}>
            <div><dt>{t.format}</dt><dd>{sv.format.toUpperCase()}</dd></div>
            <div><dt>{t.crs}</dt><dd>{sv.crs}</dd></div>
            <div><dt>{t.points}</dt><dd>{sv.x.length.toLocaleString('en-US')}</dd></div>
            <div><dt>{t.triangles}</dt><dd>{(tin.tri.length / 3).toLocaleString('en-US')}</dd></div>
            <div><dt>{t.area}</dt><dd>{n2(tin.area)} m² ({n2(tin.area / 10000)} ha)</dd></div>
            <div><dt>{t.zRange}</dt><dd>{tin.zmin.toFixed(3)} … {tin.zmax.toFixed(3)} m</dd></div>
            <div><dt>{t.extent}</dt><dd>{n2(tin.bounds.x1 - tin.bounds.x0)} × {n2(tin.bounds.y1 - tin.bounds.y0)} m</dd></div>
            <div><dt>{t.alignment}</dt><dd>{sv.alignment ? `${sv.alignmentName ?? '—'} · ${n2(polyLength(sv.alignment))} m` : t.none}</dd></div>
          </dl>
        )}
        {sv && !sv.faces && (
          <div className={s.importRow}>
            <Field label={t.maxEdge}>
              <TextInput value={maxEdge} inputMode="decimal" placeholder={fmt(t.auto, { v: tin?.maxEdge ? n2(tin.maxEdge) : '—' })} aria-label={t.maxEdge} onChange={(e) => setMaxEdge(e.target.value)} />
            </Field>
          </div>
        )}
        {sv?.alignment && (
          <label className={s.importCheck}>
            <input type="checkbox" checked={useAl} onChange={(e) => setUseAl(e.target.checked)} />
            {t.useAlignment}
          </label>
        )}
        {sv && sv.warnings.length > 0 && (
          <p className={s.importNote}><b>{t.warnings}:</b> {sv.warnings.join(' · ')}</p>
        )}
      </div>
    </Modal>
  )
}
