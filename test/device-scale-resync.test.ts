// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
// Side-effect import: registers <ecosee-card> via @customElement (see
// ecosee-card.wiring.test.ts's own comment on why this must be a value import).
import '../src/ecosee-card';
import type { EcoseeCard } from '../src/ecosee-card';
import { fakeHass, climateEntity } from './helpers/fake-hass';

// Regression guard (owner report: "sometimes the card renders smaller than it
// should", not fixed by resizing or reloading, but occasionally self-correcting).
// Root cause: --ecosee-scale/--ecosee-rendered-size were only ever set from a
// clientWidth read taken synchronously at connect time (plus whatever the
// ResizeObserver caught afterward) — but a host framework's own JS-driven layout
// (e.g. Home Assistant's masonry view balancing column widths) can still be
// mid-settle at that exact instant, so the very first reading can be too narrow.
// connectedCallback now re-measures after a double requestAnimationFrame, which
// is the actual fix (see the second test below); the `hass`-push resync in
// `updated()` (the first test) is a secondary backstop for the one case the rAF
// pair doesn't cover — a host re-parenting an already-connected card into a
// differently-sized slot without ever calling connectedCallback again (e.g. a
// dashboard editor's preview pane).
describe('ecosee-card — device scale resync', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('recomputes --ecosee-scale / --ecosee-rendered-size from a fresh clientWidth reading on a plain hass update, with no resize involved', async () => {
    const { hass } = fakeHass({ entities: [climateEntity('heat_cool')] });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({ type: 'custom:ecosee-card', entity: 'climate.t' });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;

    // happy-dom has no ResizeObserver (guarded in connectedCallback) and always
    // reports clientWidth 0, so nothing but an explicit hass-triggered call could
    // ever produce a non-empty --ecosee-scale here — stub a distinctive width to
    // make that call's effect unambiguous.
    Object.defineProperty(card, 'clientWidth', { configurable: true, get: () => 333 });

    // A plain background state update — not a resize, not a reload.
    card.hass = {
      ...hass,
      states: {
        ...hass.states,
        'climate.t': climateEntity('heat_cool', { current_temperature: 76 }),
      },
    };
    await card.updateComplete;

    expect(card.style.getPropertyValue('--ecosee-rendered-size')).toBe('333px');
    expect(card.style.getPropertyValue('--ecosee-scale')).toBe(String(333 / 460));
  });

  // Root-cause guard, not just the hass-push backstop above: a host framework's
  // own JS-driven layout (e.g. Home Assistant's masonry view balancing column
  // widths) can still be settling the instant this element connects, so the
  // synchronous clientWidth read in connectedCallback can be too early. The
  // double requestAnimationFrame there re-measures once the browser — and
  // whatever layout pass the host queued off the connect — has actually
  // finished, without needing any hass push or resize event to trigger it.
  it('re-measures after connecting via a double rAF, catching a width that only settles a frame later', async () => {
    const { hass } = fakeHass({ entities: [climateEntity('heat_cool')] });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({ type: 'custom:ecosee-card', entity: 'climate.t' });
    card.hass = hass;

    // happy-dom has no ResizeObserver (guarded in connectedCallback), so only the
    // double-rAF path in connectedCallback can be responsible for any change here.
    let width = 0; // "not yet settled" at the instant of connecting
    Object.defineProperty(card, 'clientWidth', { configurable: true, get: () => width });

    document.body.appendChild(card); // connectedCallback's synchronous read sees 0
    width = 333; // the host's own layout pass settles one frame later

    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    );

    expect(card.style.getPropertyValue('--ecosee-rendered-size')).toBe('333px');
    expect(card.style.getPropertyValue('--ecosee-scale')).toBe(String(333 / 460));
  });

  // Further owner report: still happened occasionally even with the rAF pair
  // above, on a dashboard where the same vertical-stack holds several HACS
  // custom cards (each lazy-loading its own element definition, one evaluating
  // Jinja templates over the websocket) — a column that can keep reflowing for
  // hundreds of milliseconds, well past two animation frames. The owner's own
  // screenshot showed the card noticeably narrower than a sibling card sharing
  // the same stack on the Home Screen, matching that sibling's width once a
  // Main Menu section was opened — i.e. still unsettled long after connect,
  // self-correcting only once something else (a hass push, a nav change)
  // happened to trigger a re-read later. These two staggered timeouts close
  // that gap without needing either to land first.
  it('re-measures again via a 500ms timeout backstop, catching a slower settle than the rAF pair covers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { hass } = fakeHass({ entities: [climateEntity('heat_cool')] });
      const card = document.createElement('ecosee-card') as EcoseeCard;
      card.setConfig({ type: 'custom:ecosee-card', entity: 'climate.t' });
      card.hass = hass;

      let width = 0; // still unsettled at connect, and past the rAF pair's window
      Object.defineProperty(card, 'clientWidth', { configurable: true, get: () => width });

      document.body.appendChild(card);
      width = 333; // the host's own layout only finishes settling later

      await vi.advanceTimersByTimeAsync(500);

      expect(card.style.getPropertyValue('--ecosee-rendered-size')).toBe('333px');
      expect(card.style.getPropertyValue('--ecosee-scale')).toBe(String(333 / 460));
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-measures again via a 2000ms timeout backstop, catching an even slower settle', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { hass } = fakeHass({ entities: [climateEntity('heat_cool')] });
      const card = document.createElement('ecosee-card') as EcoseeCard;
      card.setConfig({ type: 'custom:ecosee-card', entity: 'climate.t' });
      card.hass = hass;

      let width = 0;
      Object.defineProperty(card, 'clientWidth', { configurable: true, get: () => width });

      document.body.appendChild(card);
      await vi.advanceTimersByTimeAsync(500); // the 500ms backstop fires too early to help
      width = 333; // settles only after that

      await vi.advanceTimersByTimeAsync(1500); // total 2000ms since connect

      expect(card.style.getPropertyValue('--ecosee-rendered-size')).toBe('333px');
      expect(card.style.getPropertyValue('--ecosee-scale')).toBe(String(333 / 460));
    } finally {
      vi.useRealTimers();
    }
  });

  // The owner's own report ("opening a Main Menu section always shows the
  // correct size") shouldn't be a coincidence of a hass push happening to land
  // around the same moment — navigating resyncs directly.
  it('recomputes on a navigation change alone, with no hass push involved', async () => {
    const { hass } = fakeHass({
      entities: [climateEntity('heat_cool', { hvac_modes: ['off', 'heat_cool'] })],
    });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({ type: 'custom:ecosee-card', entity: 'climate.t' });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;

    Object.defineProperty(card, 'clientWidth', { configurable: true, get: () => 333 });

    // Open the Main Menu — a navigation change, not a hass push. Needs at
    // least one Main Menu section actually available (hvac_modes backs
    // System Mode) or _openMenu finds nothing and _nav never changes.
    const home = card.shadowRoot!.querySelector('ecosee-home-screen')!;
    home.dispatchEvent(
      new CustomEvent('ecosee-action', {
        detail: { action: 'menu' },
        bubbles: true,
        composed: true,
      }),
    );
    await card.updateComplete;

    expect(card.style.getPropertyValue('--ecosee-rendered-size')).toBe('333px');
    expect(card.style.getPropertyValue('--ecosee-scale')).toBe(String(333 / 460));
  });
});
