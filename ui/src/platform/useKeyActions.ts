import { useEffect, useRef } from 'react'
import { registerActions } from './keymap'

/** A screen says what its profile actions do while it is mounted (handlers may change between renders). */
export function useKeyActions(map: Record<string, () => void>) {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    const stable: Record<string, () => void> = {}
    for (const id of Object.keys(ref.current)) stable[id] = () => ref.current[id]?.()
    return registerActions(stable)
    // the action ids of a screen are fixed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
