/**
 * The persistent bottom tab bar shown across the Main Menu's section screens
 * (System, Sensors, Fan, Schedule, Setpoints, Furnace Filter), mirroring the
 * device's bottom navigation. It replaces the drill-down Main Menu list:
 * opening the menu lands directly on a section and the bar switches between
 * the sibling sections.
 *
 * The left slot used to be a temperature badge that returned to the thermostat
 * (the Home Screen) — removed in ADR-0017 as redundant with the shell's own ✕
 * (every section opens via the same `_open(kind, 'home')` path, so ✕ already
 * lands on the same bare Home Screen the badge did) and replaced with the
 * Furnace Filter tab in that same leftmost slot, a Card addition (no
 * physical-device equivalent, like Schedule/Setpoints below).
 *
 * Weather is reached from the Home Screen's own affordance, not the bar — as on
 * the device, whose bottom bar carries the thermostat, sensors, fan, voice, and
 * settings, but not weather. The voice/mic tab has no Home Assistant meaning and
 * is dropped; settings maps to the System section (the gear glyph, kept rightmost
 * as on the device). Schedule (ADR-0014), Comfort Setpoints (ADR-0015), and
 * Furnace Filter (ADR-0017) are Card additions — the physical device has no
 * equivalent bottom-bar tab for any of them, but each is a Main Menu section the
 * same way Sensors and Fan are, so all follow the same reachable-when-configured
 * rule.
 *
 * This module is the pure seam: it takes the active screen and which sections
 * are reachable, and returns the ordered, marked-up tab model. The
 * `<ecosee-overlay>` shell renders it; the card supplies the availability from
 * its single overlay-descriptor table so the predicates aren't duplicated here.
 */

/** The Main Menu sections that carry (and are reachable from) the tab bar, in no
 *  particular order — the single source of "what is a section" so the card guard,
 *  the availability shape, and the render order below can't drift apart. */
export const TAB_SECTIONS = [
  'filter',
  'system',
  'sensors',
  'fan',
  'schedule',
  'setpoints',
] as const;

/** A Main Menu section that carries (and is reachable from) the tab bar. */
export type TabSection = (typeof TAB_SECTIONS)[number];

/** A tab-bar destination — always a section; the old `'thermostat'` badge
 *  target was removed in ADR-0017 (see module doc comment). */
export type TabTarget = TabSection;

/** Which glyph a section tab shows. `gear` is the System (settings) tab. */
export type TabIcon = 'gear' | 'sensor' | 'fan' | 'calendar' | 'setpoints' | 'filter';

export interface TabItem {
  target: TabSection;
  icon: TabIcon;
  /** Accessible label (the section name); the bar itself is icon-only. */
  label: string;
  /** Whether this tab is the screen currently shown. */
  active: boolean;
}

export interface TabBarModel {
  /** Whether a bar should render: the active screen is a section and at least one
   *  section is reachable. The card treats `false` as "no bar". */
  available: boolean;
  items: TabItem[];
}

/** Left-to-right section order: Furnace Filter takes the leftmost slot the temp
 *  badge used to occupy (ADR-0017), then sensors, fan, schedule, setpoints, and
 *  finally System (the gear, rightmost — matching the device's settings
 *  position). */
const ORDER: readonly { target: TabSection; icon: TabIcon; label: string }[] = [
  { target: 'filter', icon: 'filter', label: 'Furnace Filter' },
  { target: 'sensors', icon: 'sensor', label: 'Sensors' },
  { target: 'fan', icon: 'fan', label: 'Fan' },
  { target: 'schedule', icon: 'calendar', label: 'Schedule' },
  { target: 'setpoints', icon: 'setpoints', label: 'Setpoints' },
  { target: 'system', icon: 'gear', label: 'System' },
];

/** Build the tab-bar model for the current overlay. Shows only on a section screen,
 *  and only lists sections that are reachable for the bound entity (graceful
 *  degradation — a bare `climate` entity won't sprout empty tabs). */
export function toTabBarModel(
  active: string,
  availability: Record<TabSection, boolean>,
): TabBarModel {
  const onSection = (TAB_SECTIONS as readonly string[]).includes(active);
  const items: TabItem[] = ORDER.filter((entry) => availability[entry.target]).map((entry) => ({
    target: entry.target,
    icon: entry.icon,
    label: entry.label,
    active: entry.target === active,
  }));
  return { available: onSection && items.length > 0, items };
}
