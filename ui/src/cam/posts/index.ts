/** The post-processor registry. All UNVERIFIED until a machine profile is commissioned with one of them. */
import { grbl11 } from './grbl11'
import { isoGeneric } from './isoGeneric'
import { linuxcnc } from './linuxcnc'
import { ncstudio } from './ncstudio'
import type { Post, PostId } from './common'

export type { Post, PostId, PostOptions, PostProgram, PostResult } from './common'
export { codesIn } from './common'

export const POSTS: Record<PostId, Post> = { grbl11, linuxcnc, iso_generic: isoGeneric, ncstudio }
export const POST_IDS: PostId[] = ['grbl11', 'linuxcnc', 'iso_generic', 'ncstudio']

export const getPost = (id: string | null | undefined): Post | null => (id && id in POSTS ? POSTS[id as PostId] : null)

/** Old CamSettings dialects ('grbl' | 'iso') and the new post ids → a post. */
export function postFor(dialect: string): Post {
  if (dialect === 'grbl' || dialect === 'grbl11') return grbl11
  if (dialect === 'linuxcnc') return linuxcnc
  if (dialect === 'ncstudio') return ncstudio
  return isoGeneric
}
