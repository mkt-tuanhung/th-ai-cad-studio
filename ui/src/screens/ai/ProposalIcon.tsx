import { Armchair, Focus, Target } from 'lucide-react'

export function ProposalIcon({ kind, size = 17 }: { kind: 'focus' | 'open' | 'balance'; size?: number }) {
  const Icon = kind === 'focus' ? Focus : kind === 'open' ? Armchair : Target
  return <Icon size={size} strokeWidth={1.7} />
}
