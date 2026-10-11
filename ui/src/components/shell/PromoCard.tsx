import { useT } from '../../i18n'
import s from './PromoCard.module.css'

/** Sidebar promo art. The slogan is baked into the approved asset (see ASSET_USAGE_NOTE.md). */
export function PromoCard({ src }: { src: string }) {
  const t = useT()
  return (
    <div className={s.card}>
      <img className={s.art} src={src} alt={t.promo.alt} draggable={false} />
    </div>
  )
}
