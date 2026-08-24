import { PROFILES, isProfileId } from '../../profile/profile';
import { colorHex } from '../../utils/colors';

/** The three places a person's face shows up, and nothing in between. */
export type AvatarSize = 'sm' | 'md' | 'lg';

/**
 * Diameter and type size per slot.
 *
 * Written as numbers rather than Tailwind classes because `HB` has to stay
 * legible inside an 18px circle — that needs a 9px letter, and the type scale
 * quite rightly does not offer one. The fill comes from `colors.COLOR_HEX` for
 * the same reason the map pins do: two profiles is not worth eight new static
 * class strings the scanner would have to be taught about.
 */
const SIZES: Record<AvatarSize, { px: number; font: number }> = {
  sm: { px: 18, font: 9 },
  md: { px: 24, font: 11 },
  lg: { px: 64, font: 24 },
};

interface AvatarProps {
  /** A profile id. Anything the app does not recognise renders nothing. */
  id: string;
  size?: AvatarSize;
  className?: string;
  /** Tooltip; defaults to the profile's own label. */
  title?: string;
}

/**
 * One person, as a coloured circle with their initials (M13).
 *
 * Renders **nothing** for an id this build does not know — a card imported from
 * a backup written by some future third profile shows no badge rather than a
 * grey question mark. Every caller can therefore hand it whatever string the
 * model holds without checking first.
 */
export default function Avatar({ id, size = 'sm', className = '', title }: AvatarProps) {
  if (!isProfileId(id)) return null;
  const profile = PROFILES[id];
  const { px, font } = SIZES[size];

  return (
    <span
      data-testid="avatar"
      data-profile={id}
      data-size={size}
      title={title ?? profile.label}
      aria-label={profile.label}
      role="img"
      style={{
        width: px,
        height: px,
        backgroundColor: colorHex(profile.colorToken),
        fontSize: font,
      }}
      className={`inline-grid shrink-0 place-items-center rounded-full font-semibold leading-none tracking-tight text-white select-none ${className}`}
    >
      {profile.initials}
    </span>
  );
}
