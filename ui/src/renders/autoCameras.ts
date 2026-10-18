/**
 * "Góc nhìn 1/2/3": the architectural auto views of a room (renders/interiorRender.ts autoViews) as Renders cameras,
 * next to the saved cameras and bookmarks. Re-running replaces that room's auto cameras (one undo step).
 */
import { useRenders } from '../state/renders'
import type { InteriorDoc } from '../state/interior'
import type { Camera } from './model'
import { autoViews, type AutoView } from './interiorRender'

export const autoCameraId = (room: string, n: number) => `cam-auto-${room}-${n}`

/** Adds (or refreshes) up to 3 auto cameras of `roomId`; returns them (empty when no spot fits a camera). */
export function addAutoCameras(doc: InteriorDoc, roomId: string, name: (n: number) => string, n = 3): { cameras: Camera[]; views: AutoView[] } {
  const views = autoViews(doc, roomId, n)
  if (!views.length) return { cameras: [], views }
  const cameras: Camera[] = views.map((v, k) => ({
    id: autoCameraId(roomId, k + 1), name: name(k + 1), kind: 'Interior - Bookmark', aspect: '16:9', w: 1920, h: 1080, thumb: '/assets/v2/renders/cam3.png',
    view: { scene: 'interior', eye: v.eye, at: v.at, up: v.up, fov: v.fov, level: true, shift: v.shift, lensEq: v.lensEq, room: roomId },
  }))
  const ids = new Set(cameras.map((c) => c.id))
  const prefix = `cam-auto-${roomId}-`
  useRenders.getState().edit(`Auto views ${roomId}`, (d) => ({ ...d, cameras: [...d.cameras.filter((c) => !ids.has(c.id) && !c.id.startsWith(prefix)), ...cameras] }))
  return { cameras, views }
}
