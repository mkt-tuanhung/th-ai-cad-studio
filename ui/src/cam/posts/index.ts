/** The post-processor registry. All UNVERIFIED until a machine profile is commissioned with one of them. */
import { grbl11 } from './grbl11'
import { isoGeneric } from './isoGeneric'
import { linuxcnc } from './linuxcnc'
import { ncstudio } from './ncstudio'
import { fanuc, lnc, mach3, osai, richauto, siemens840d, syntec, twincat, weihong } from './family'
import { sawCutList } from './sawCutList'
import type { Post, PostId } from './common'

export type { Post, PostId, PostOptions, PostProgram, PostResult } from './common'
export { codesIn } from './common'

export const POSTS: Record<PostId, Post> = { grbl11, linuxcnc, iso_generic: isoGeneric, ncstudio, syntec, mach3, fanuc, siemens840d, osai, richauto, weihong, lnc, twincat, saw_cutlist: sawCutList }
/** Posts offered for profiles (Machines & Tools). */
export const POST_IDS: PostId[] = ['grbl11', 'linuxcnc', 'iso_generic', 'ncstudio', 'syntec', 'mach3', 'fanuc', 'siemens840d', 'osai', 'richauto', 'weihong', 'lnc', 'twincat', 'saw_cutlist']
/** Posts for a preview without a profile post (Nesting & CNC selector, old CamSettings dialects). */
export const PREVIEW_POST_IDS: PostId[] = ['grbl11', 'linuxcnc', 'iso_generic', 'ncstudio']

export const getPost = (id: string | null | undefined): Post | null => (id && id in POSTS ? POSTS[id as PostId] : null)

/** Old CamSettings dialects ('grbl' | 'iso') and the new post ids → a post. */
export function postFor(dialect: string): Post {
  if (dialect === 'grbl' || dialect === 'grbl11') return grbl11
  if (dialect === 'linuxcnc') return linuxcnc
  if (dialect === 'ncstudio') return ncstudio
  return isoGeneric
}

/** The post a controller family maps to (null = proprietary: vendor CAM writes the program). */
export function postIdForFamily(family: string | null | undefined, machineType?: string): PostId | null {
  if (machineType === 'PANEL_SAW') return 'saw_cutlist'
  switch (family) {
    case 'SYNTEC': return 'syntec'
    case 'WEIHONG_NCSTUDIO': return 'weihong'
    case 'RICHAUTO_DSP': return 'richauto'
    case 'MACH3': return 'mach3'
    case 'FANUC': return 'fanuc'
    case 'SIEMENS_840D': return 'siemens840d'
    case 'OSAI': return 'osai'
    case 'LINUXCNC': return 'linuxcnc'
    case 'GRBL': return 'grbl11'
    case 'LNC': return 'lnc'
    case 'BECKHOFF_TWINCAT': return 'twincat'
    default: return null
  }
}
