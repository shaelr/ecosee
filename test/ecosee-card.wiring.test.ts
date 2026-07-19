// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { LitElement } from 'lit';
// Side-effect import: registers <ecosee-card> and every overlay via @customElement.
// Imported for effect (not just the type) so esbuild can't elide it under
// isolatedModules — otherwise the elements never register and createElement is bare.
import '../src/ecosee-card';
import type { EcoseeCard } from '../src/ecosee-card';
import type { HomeAssistant } from '../src/types/hass';
import { PICKER_CONFIRM_MS } from '../src/overlays/overlay-dismiss';
import { fakeHass, climateEntity } from './helpers/fake-hass';

// Wiring tests: these mount the real <ecosee-card> and drive it through the
// documented events, then assert what reaches `hass.callService`. They cover the
// seam the pure model tests can't — the overlay → card event wiring, the nav
// stack, and the apply path — which only became reachable once the card routes
// every Overlay through one descriptor table and one `ecosee-service-call` event.

async function mountCard(hass: HomeAssistant, entity = 'climate.t'): Promise<EcoseeCard> {
  const card = document.createElement('ecosee-card') as EcoseeCard;
  card.setConfig({ type: 'custom:ecosee-card', entity });
  card.hass = hass;
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
}

/** Dispatch a Home Screen action the way <ecosee-home-screen> does. A `setpoint`
 *  rides along the way a setpoint-oval tap does (issue #42); omit it for the
 *  current-temperature number tap. */
function fireAction(card: EcoseeCard, action: string, setpoint?: 'heat' | 'cool'): void {
  card.shadowRoot!.querySelector('ecosee-home-screen')!.dispatchEvent(
    new CustomEvent('ecosee-action', {
      detail: { action, setpoint },
      bubbles: true,
      composed: true,
    }),
  );
}

/** Dispatch a bottom tab-bar tap the way <ecosee-overlay> does — every target is a
 *  Main Menu section (ADR-0017 removed the old `'thermostat'` badge target). */
function fireTabSelect(card: EcoseeCard, target: string): void {
  card
    .shadowRoot!.querySelector('ecosee-overlay')!
    .dispatchEvent(
      new CustomEvent('ecosee-tab-select', { detail: { target }, bubbles: true, composed: true }),
    );
}

/** Dispatch a System sub-screen selection the way <ecosee-system-overlay> does. */
function fireSystemSelect(card: EcoseeCard, target: string): void {
  card.shadowRoot!.querySelector('ecosee-system-overlay')!.dispatchEvent(
    new CustomEvent('ecosee-system-select', {
      detail: { target },
      bubbles: true,
      composed: true,
    }),
  );
}

/** Dispatch the shell's dismiss the way <ecosee-overlay>'s ✕ / backdrop does. */
function fireDismiss(card: EcoseeCard): void {
  card
    .shadowRoot!.querySelector('ecosee-overlay')!
    .dispatchEvent(new CustomEvent('ecosee-overlay-dismiss', { bubbles: true, composed: true }));
}

function overlayPresent(card: EcoseeCard, tag: string): boolean {
  return card.shadowRoot!.querySelector(tag) !== null;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('ecosee-card wiring — apply path', () => {
  it('forwards a temperature change from the overlay to hass.callService via the one ecosee-service-call event', async () => {
    const { hass, calls } = fakeHass({
      entities: [
        climateEntity('heat', { temperature: 70, min_temp: 60, max_temp: 80, target_temp_step: 1 }),
      ],
    });
    const card = await mountCard(hass);

    fireAction(card, 'temperature');
    await card.updateComplete;

    const overlay = card.shadowRoot!.querySelector('ecosee-temperature-overlay') as LitElement;
    expect(overlay).toBeTruthy();
    await overlay.updateComplete;

    // Nudge the setpoint up: the overlay emits `ecosee-service-call`, which the card
    // must catch on the shell and forward to Home Assistant. (Proves the listener
    // moved onto <ecosee-overlay> actually receives the unified event.)
    const increase = overlay.shadowRoot!.querySelector(
      'button[aria-label="Increase"]',
    ) as HTMLButtonElement;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    increase.click();
    vi.advanceTimersByTime(650); // the overlay debounces the write

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      domain: 'climate',
      service: 'set_temperature',
      data: { entity_id: 'climate.t', temperature: 71 },
    });
  });

  it('foregrounds the tapped setpoint oval when opening Temperature Adjust (issue #42)', async () => {
    const { hass, calls } = fakeHass({
      entities: [
        climateEntity('heat_cool', {
          target_temp_low: 68,
          target_temp_high: 76,
          min_temp: 60,
          max_temp: 85,
          target_temp_step: 1,
        }),
      ],
    });
    const card = await mountCard(hass);

    // Tapping the heat oval carries `setpoint: 'heat'`, so a nudge must move the
    // *heat* setpoint (target_temp_low), not the cool default the overlay would
    // otherwise foreground in Heat / Cool (Auto).
    fireAction(card, 'temperature', 'heat');
    await card.updateComplete;
    const overlay = card.shadowRoot!.querySelector('ecosee-temperature-overlay') as LitElement;
    await overlay.updateComplete;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    (
      overlay.shadowRoot!.querySelector('button[aria-label="Increase"]') as HTMLButtonElement
    ).click();
    vi.advanceTimersByTime(650); // the overlay debounces the write

    expect(calls[0]).toMatchObject({
      domain: 'climate',
      service: 'set_temperature',
      data: { entity_id: 'climate.t', target_temp_low: 69, target_temp_high: 76 },
    });
  });

  it('defaults to the cool setpoint when the current-temperature number is tapped', async () => {
    const { hass, calls } = fakeHass({
      entities: [
        climateEntity('heat_cool', {
          target_temp_low: 68,
          target_temp_high: 76,
          min_temp: 60,
          max_temp: 85,
          target_temp_step: 1,
        }),
      ],
    });
    const card = await mountCard(hass);

    // No setpoint rides the number tap, so the overlay keeps its own default (cool)
    // — a nudge moves target_temp_high.
    fireAction(card, 'temperature');
    await card.updateComplete;
    const overlay = card.shadowRoot!.querySelector('ecosee-temperature-overlay') as LitElement;
    await overlay.updateComplete;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    (
      overlay.shadowRoot!.querySelector('button[aria-label="Increase"]') as HTMLButtonElement
    ).click();
    vi.advanceTimersByTime(650); // the overlay debounces the write

    expect(calls[0]).toMatchObject({
      domain: 'climate',
      service: 'set_temperature',
      data: { entity_id: 'climate.t', target_temp_low: 68, target_temp_high: 77 },
    });
  });
});

describe('ecosee-card wiring — Resume Schedule (ADR-0012)', () => {
  it('calls ecobee.resume_program with the bound entity when the resume-schedule action fires', async () => {
    const { hass, calls } = fakeHass({
      entities: [
        climateEntity('heat_cool', {
          target_temp_low: 68,
          target_temp_high: 76,
          climate_mode: 'Home',
          preset_mode: 'temp',
        }),
      ],
    });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({ type: 'custom:ecosee-card', entity: 'climate.t', resume_program: true });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;

    // The pill itself is a pure reflection of view.resumeAvailable (covered in
    // home-screen.test.ts); this proves the action reaches hass.callService with
    // the right payload once fired.
    fireAction(card, 'resume-schedule');
    await card.updateComplete;

    expect(calls).toEqual([
      {
        domain: 'ecobee',
        service: 'resume_program',
        data: { entity_id: 'climate.t', resume_all: false },
        returnResponse: undefined,
      },
    ]);
  });

  it('does nothing when resume_program is unset, even if the action somehow fires', async () => {
    const { hass, calls } = fakeHass({
      entities: [climateEntity('heat_cool', { target_temp_low: 68, target_temp_high: 76 })],
    });
    // Default config (no resume_program) — the pill never renders to fire this, but
    // `_resumeSchedule` re-checks the config toggle itself (mirroring `_open`'s
    // availability re-check for Overlays), so a stray action is a safe no-op.
    const card = await mountCard(hass);

    fireAction(card, 'resume-schedule');
    await card.updateComplete;

    expect(calls).toHaveLength(0);
  });
});

describe('ecosee-card wiring — background_color', () => {
  it('applies background_color as an inline --ecosee-bg custom property', async () => {
    const { hass } = fakeHass({ entities: [climateEntity('heat', { temperature: 70 })] });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({
      type: 'custom:ecosee-card',
      entity: 'climate.t',
      background_color: '#1a1a2e',
    });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;

    expect(card.style.getPropertyValue('--ecosee-bg')).toBe('#1a1a2e');
  });

  it('accepts "transparent" for no background', async () => {
    const { hass } = fakeHass({ entities: [climateEntity('heat', { temperature: 70 })] });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({
      type: 'custom:ecosee-card',
      entity: 'climate.t',
      background_color: 'transparent',
    });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;

    expect(card.style.getPropertyValue('--ecosee-bg')).toBe('transparent');
  });

  it('leaves --ecosee-bg unset (Skin default) when background_color is absent', async () => {
    const { hass } = fakeHass({ entities: [climateEntity('heat', { temperature: 70 })] });
    const card = await mountCard(hass);

    expect(card.style.getPropertyValue('--ecosee-bg')).toBe('');
  });

  it('clears a previously-set --ecosee-bg when the config is updated to drop background_color', async () => {
    const { hass } = fakeHass({ entities: [climateEntity('heat', { temperature: 70 })] });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({
      type: 'custom:ecosee-card',
      entity: 'climate.t',
      background_color: '#1a1a2e',
    });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;
    expect(card.style.getPropertyValue('--ecosee-bg')).toBe('#1a1a2e');

    card.setConfig({ type: 'custom:ecosee-card', entity: 'climate.t' });
    await card.updateComplete;
    expect(card.style.getPropertyValue('--ecosee-bg')).toBe('');
  });

  // End-to-end regression guard for the exact reported bug: with a transparent
  // background AND a menu open, the Overlay shell's canvas is genuinely
  // transparent (it shares --ecosee-bg) yet the Home Screen underneath it is
  // gone, so there is nothing to bleed through.
  it('opens a fully transparent Main Menu with no Home Screen bleeding through it', async () => {
    const { hass } = fakeHass({
      entities: [climateEntity('heat', { hvac_modes: ['off', 'heat', 'cool'] })],
    });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({
      type: 'custom:ecosee-card',
      entity: 'climate.t',
      background_color: 'transparent',
    });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;

    fireAction(card, 'menu');
    await card.updateComplete;

    expect(card.style.getPropertyValue('--ecosee-bg')).toBe('transparent');
    expect(overlayPresent(card, 'ecosee-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-home-screen')).toBe(false);
  });
});

// Regression guard: the Home Screen must not still be mounted (and therefore not
// still painting its content) while an Overlay is open, or a transparent
// background_color lets it bleed through behind every menu/picker (issue:
// background_color: transparent broke the Main Menu). <ecosee-card> only ever
// mounts one of <ecosee-home-screen> / the Overlay shell at a time, mirroring how
// Standby already fully replaces the Home Screen rather than merely covering it.
describe('ecosee-card wiring — Home Screen unmounts while an Overlay is open', () => {
  it('is present with no Overlay open', async () => {
    const { hass } = fakeHass({ entities: [climateEntity('heat', { temperature: 70 })] });
    const card = await mountCard(hass);

    expect(overlayPresent(card, 'ecosee-home-screen')).toBe(true);
    expect(overlayPresent(card, 'ecosee-overlay')).toBe(false);
  });

  it('unmounts once an Overlay opens, and remounts once it is dismissed', async () => {
    const { hass } = fakeHass({
      entities: [climateEntity('heat', { hvac_modes: ['off', 'heat', 'cool'] })],
    });
    const card = await mountCard(hass);

    fireAction(card, 'system-mode');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-home-screen')).toBe(false);

    fireDismiss(card);
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-overlay')).toBe(false);
    expect(overlayPresent(card, 'ecosee-home-screen')).toBe(true);
  });

  it('stays unmounted through a Main Menu section switch (a picker replacing another Overlay)', async () => {
    const { hass } = fakeHass({
      entities: [
        climateEntity('heat', {
          hvac_modes: ['off', 'heat', 'cool'],
          fan_modes: ['on', 'auto'],
          fan_mode: 'auto',
        }),
      ],
    });
    const card = await mountCard(hass);

    fireAction(card, 'menu');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-home-screen')).toBe(false);

    fireTabSelect(card, 'fan');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-home-screen')).toBe(false);
  });
});

describe('ecosee-card wiring — navigation (tab bar)', () => {
  it('the gear opens a Main Menu section directly; a tab switch replaces it; dismiss returns Home', async () => {
    const { hass } = fakeHass({
      entities: [
        climateEntity('heat', {
          hvac_modes: ['off', 'heat', 'cool'],
          fan_modes: ['on', 'auto'],
          fan_mode: 'auto',
        }),
      ],
    });
    const card = await mountCard(hass);

    // The gear lands directly on the first reachable section (System) — no
    // drill-down list in between.
    fireAction(card, 'menu');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-system-overlay')).toBe(true);

    // A tab tap replaces the section (a flat switch, not a push).
    fireTabSelect(card, 'fan');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-fan-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-system-overlay')).toBe(false);

    // Dismissing a section returns Home (there is no menu to fall back to).
    fireDismiss(card);
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-fan-overlay')).toBe(false);
  });

  it('the Furnace Filter tab (ADR-0017) opens its section from a sibling section; dismiss returns Home', async () => {
    const { hass } = fakeHass({
      entities: [
        climateEntity('heat', { hvac_modes: ['off', 'heat', 'cool'] }),
        { entity_id: 'date.filter', state: '2025-01-01', attributes: {} },
      ],
    });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({
      type: 'custom:ecosee-card',
      entity: 'climate.t',
      filter_last_changed_entity: 'date.filter',
    });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;

    fireAction(card, 'menu');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-system-overlay')).toBe(true);

    fireTabSelect(card, 'filter');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-furnace-filter-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-system-overlay')).toBe(false);

    fireDismiss(card);
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-furnace-filter-overlay')).toBe(false);
  });

  it('opens the Fan sub-screen from the Home top-row shortcut, dismissing back to Home (issue #45)', async () => {
    const { hass } = fakeHass({
      entities: [
        climateEntity('cool', {
          fan_modes: ['auto', 'on', 'low', 'medium', 'high'],
          fan_mode: 'auto',
        }),
      ],
    });
    const card = await mountCard(hass);

    // The Home shortcut fires a bare `fan` action (no setpoint); it opens the Fan
    // overlay straight from Home.
    fireAction(card, 'fan');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-fan-overlay')).toBe(true);

    // Opened from Home, so a single dismiss lands back on the bare Home Screen.
    fireDismiss(card);
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-overlay')).toBe(false);
  });

  it('does not open the Fan shortcut when the entity exposes no fan control (availability gate)', async () => {
    const { hass } = fakeHass({ entities: [climateEntity('cool', {})] });
    const card = await mountCard(hass);

    fireAction(card, 'fan');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-fan-overlay')).toBe(false);
    expect(overlayPresent(card, 'ecosee-overlay')).toBe(false);
  });

  it('does not open an Overlay whose backing data is absent (availability gate)', async () => {
    const { hass } = fakeHass({ entities: [climateEntity('off', {})] });
    const card = await mountCard(hass);

    // 'off' entity exposes no hvac_modes, so the System Mode picker has nothing to
    // show: the gate in `_open` keeps it closed.
    fireAction(card, 'system-mode');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-system-mode-overlay')).toBe(false);
    expect(overlayPresent(card, 'ecosee-overlay')).toBe(false);
  });
});

describe('ecosee-card wiring — pickers close on selection (issues #38/#39)', () => {
  // Only setTimeout/clearTimeout are faked so Lit's microtask-based render still runs.
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('applies the mode and then auto-closes a Home-opened System Mode picker back to Home', async () => {
    const { hass, calls } = fakeHass({
      entities: [climateEntity('cool', { hvac_modes: ['off', 'heat', 'cool'] })],
    });
    const card = await mountCard(hass);

    fireAction(card, 'system-mode');
    await card.updateComplete;
    const overlay = card.shadowRoot!.querySelector('ecosee-system-mode-overlay') as LitElement;
    await overlay.updateComplete;

    const heat = [...overlay.shadowRoot!.querySelectorAll('.option')].find(
      (o) => o.textContent?.trim() === 'Heat',
    ) as HTMLButtonElement;
    heat.click();

    // The write goes out immediately…
    expect(calls).toEqual([
      {
        domain: 'climate',
        service: 'set_hvac_mode',
        data: { entity_id: 'climate.t', hvac_mode: 'heat' },
        returnResponse: undefined,
      },
    ]);
    // …the picker is still up during the confirm beat…
    expect(overlayPresent(card, 'ecosee-system-mode-overlay')).toBe(true);

    // …then it auto-closes all the way back to the bare Home Screen.
    vi.advanceTimersByTime(PICKER_CONFIRM_MS);
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-overlay')).toBe(false);
  });

  it('a picker opened from a section returns to that section (System), not Home', async () => {
    const { hass } = fakeHass({
      entities: [climateEntity('cool', { hvac_modes: ['off', 'heat', 'cool'] })],
    });
    const card = await mountCard(hass);

    // The gear lands on the System section; its selectors push focused pickers.
    fireAction(card, 'menu');
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-system-overlay')).toBe(true);

    fireSystemSelect(card, 'system-mode');
    await card.updateComplete;
    const overlay = card.shadowRoot!.querySelector('ecosee-system-mode-overlay') as LitElement;
    await overlay.updateComplete;

    (
      [...overlay.shadowRoot!.querySelectorAll('.option')].find(
        (o) => o.textContent?.trim() === 'Heat',
      ) as HTMLButtonElement
    ).click();
    vi.advanceTimersByTime(PICKER_CONFIRM_MS);
    await card.updateComplete;

    // One level popped: back to the System sub-screen, not all the way Home.
    expect(overlayPresent(card, 'ecosee-system-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-system-mode-overlay')).toBe(false);
  });
});

// ecosee's own date/time pickers (ADR-0018), replacing native <input
// type="date">/<input type="time"> everywhere. These are the most
// architecturally novel part of that change: the time picker is reached
// from three different screens, at two different nav depths, with two
// different close behaviors depending on which one opened it — exactly the
// kind of routing a pure component test can't exercise, since it lives
// entirely in the card's own event wiring.
describe('ecosee-card wiring — date/time pickers (ADR-0018)', () => {
  /** Today's date, at local midnight, as an ISO-ish date-only string — the
   *  Schedule sub-screen always opens on today's day-of-week
   *  (`_scheduleDayIndex`'s own default), so a calendar event fixture has to
   *  be anchored to "today," not a hardcoded date, to land in the fetched
   *  window regardless of when this test happens to run. */
  function todayDateString(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  it('Furnace Filter: opens the date picker, applies the write, and pops one level back to Furnace Filter', async () => {
    const { hass, calls } = fakeHass({
      entities: [
        climateEntity('heat', { hvac_modes: ['off', 'heat', 'cool'] }),
        { entity_id: 'date.filter', state: '2025-01-01', attributes: {} },
      ],
    });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({
      type: 'custom:ecosee-card',
      entity: 'climate.t',
      filter_last_changed_entity: 'date.filter',
    });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;

    fireAction(card, 'menu');
    await card.updateComplete;
    card.shadowRoot!.querySelector('ecosee-overlay')!.dispatchEvent(
      new CustomEvent('ecosee-tab-select', {
        detail: { target: 'filter' },
        bubbles: true,
        composed: true,
      }),
    );
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-furnace-filter-overlay')).toBe(true);

    const filterOverlay = card.shadowRoot!.querySelector(
      'ecosee-furnace-filter-overlay',
    ) as LitElement;
    await filterOverlay.updateComplete;
    (filterOverlay.shadowRoot!.querySelector('.pill-button') as HTMLButtonElement).click();
    await card.updateComplete;

    expect(overlayPresent(card, 'ecosee-date-picker-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-furnace-filter-overlay')).toBe(false);

    const datePicker = card.shadowRoot!.querySelector('ecosee-date-picker-overlay') as LitElement;
    await datePicker.updateComplete;
    const someDay = datePicker.shadowRoot!.querySelector('.day') as HTMLButtonElement;
    someDay.click();
    // The write is async (await this.hass.callService(...)) — let it and the
    // subsequent close settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await card.updateComplete;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ domain: 'date', service: 'set_value' });
    // One level popped: back to Furnace Filter, not further.
    expect(overlayPresent(card, 'ecosee-furnace-filter-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-date-picker-overlay')).toBe(false);
  });

  it('Add to Schedule: opens the time picker for Start, applies the value locally, and pops one level back to Add to Schedule (no entity write yet)', async () => {
    const { hass, calls } = fakeHass({
      entities: [
        climateEntity('heat_cool', {
          hvac_modes: ['off', 'heat', 'cool', 'heat_cool'],
          preset_modes: ['home', 'away'],
          preset_mode: 'home',
        }),
        { entity_id: 'calendar.sched', state: 'off', attributes: {} },
      ],
      response: { response: { 'calendar.sched': { events: [] } } },
    });
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({
      type: 'custom:ecosee-card',
      entity: 'climate.t',
      schedule_entity: 'calendar.sched',
    });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;

    fireAction(card, 'menu');
    await card.updateComplete;
    card.shadowRoot!.querySelector('ecosee-overlay')!.dispatchEvent(
      new CustomEvent('ecosee-tab-select', {
        detail: { target: 'schedule' },
        bubbles: true,
        composed: true,
      }),
    );
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-schedule-overlay')).toBe(true);

    card
      .shadowRoot!.querySelector('ecosee-overlay')!
      .dispatchEvent(
        new CustomEvent('ecosee-schedule-add-block-open', { bubbles: true, composed: true }),
      );
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-schedule-add-block-overlay')).toBe(true);

    const addBlock = card.shadowRoot!.querySelector(
      'ecosee-schedule-add-block-overlay',
    ) as LitElement;
    await addBlock.updateComplete;
    const startPill = addBlock
      .shadowRoot!.querySelectorAll('.field-row')[1]!
      .querySelector('.pill-button') as HTMLButtonElement;
    expect(startPill.textContent?.trim()).toBe('08:00'); // the card's own seeded default
    startPill.click();
    await card.updateComplete;

    expect(overlayPresent(card, 'ecosee-time-picker-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-schedule-add-block-overlay')).toBe(false);

    // Opening Schedule already fired its own calendar.get_events fetch; the
    // count from here on is what matters — picking a time must add nothing.
    const callsBeforeConfirm = calls.length;
    const timePicker = card.shadowRoot!.querySelector('ecosee-time-picker-overlay') as LitElement;
    await timePicker.updateComplete;
    (timePicker.shadowRoot!.querySelector('.confirm') as HTMLButtonElement).click();
    await card.updateComplete;

    // Add to Schedule isn't submitted by picking a time — no entity write yet.
    expect(calls).toHaveLength(callsBeforeConfirm);
    // One level popped: back to Add to Schedule, not all the way to Schedule.
    expect(overlayPresent(card, 'ecosee-schedule-add-block-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-time-picker-overlay')).toBe(false);
    // The seeded 08:00 default survived the round trip through the picker
    // unaffected (Confirm without picking a row keeps the seeded value) —
    // proof the card's own buffered state, not local component state, is
    // what the field reflects after the picker unmounted and remounted it.
    const startPillAfter = card
      .shadowRoot!.querySelector('ecosee-schedule-add-block-overlay')!
      .shadowRoot!.querySelectorAll('.field-row')[1]!
      .querySelector('.pill-button');
    expect(startPillAfter?.textContent?.trim()).toBe('08:00');
  });

  it('Schedule Start Time: opens the time picker for an existing block, applies the write, and pops TWO levels straight back to Schedule (not the Start Time screen)', async () => {
    const today = todayDateString();
    const { hass, calls } = fakeHass({
      entities: [
        climateEntity('heat_cool', { hvac_modes: ['off', 'heat', 'cool', 'heat_cool'] }),
        { entity_id: 'calendar.sched', state: 'off', attributes: {} },
      ],
      response: {
        response: {
          'calendar.sched': {
            events: [
              { uid: 'e1', start: `${today}T08:00:00`, end: `${today}T17:00:00`, summary: 'Home' },
            ],
          },
        },
      },
    });
    // hass.connection is required for the actual moveBlockStart websocket
    // write; a minimal stub is enough to let it resolve without throwing —
    // this test's real focus is the nav-stack depth, not the write payload.
    (hass as unknown as { connection: unknown }).connection = {
      sendMessagePromise: async () => ({}),
    };
    const card = document.createElement('ecosee-card') as EcoseeCard;
    card.setConfig({
      type: 'custom:ecosee-card',
      entity: 'climate.t',
      schedule_entity: 'calendar.sched',
    });
    card.hass = hass;
    document.body.appendChild(card);
    await card.updateComplete;

    fireAction(card, 'menu');
    await card.updateComplete;
    card.shadowRoot!.querySelector('ecosee-overlay')!.dispatchEvent(
      new CustomEvent('ecosee-tab-select', {
        detail: { target: 'schedule' },
        bubbles: true,
        composed: true,
      }),
    );
    await card.updateComplete;
    // Let the async calendar.get_events fetch (fired from the schedule
    // descriptor's onOpen) resolve and re-render before reading blocks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await card.updateComplete;

    card.shadowRoot!.querySelector('ecosee-overlay')!.dispatchEvent(
      new CustomEvent('ecosee-schedule-block-select', {
        detail: { blockIndex: 0 },
        bubbles: true,
        composed: true,
      }),
    );
    await card.updateComplete;
    expect(overlayPresent(card, 'ecosee-schedule-start-time-overlay')).toBe(true);

    const startTime = card.shadowRoot!.querySelector(
      'ecosee-schedule-start-time-overlay',
    ) as LitElement;
    await startTime.updateComplete;
    (startTime.shadowRoot!.querySelector('.pill-button') as HTMLButtonElement).click();
    await card.updateComplete;

    // Three deep now: schedule -> schedule-start-time -> time-picker.
    expect(overlayPresent(card, 'ecosee-time-picker-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-schedule-start-time-overlay')).toBe(false);

    const timePicker = card.shadowRoot!.querySelector('ecosee-time-picker-overlay') as LitElement;
    await timePicker.updateComplete;
    (timePicker.shadowRoot!.querySelector('.confirm') as HTMLButtonElement).click();
    await card.updateComplete;
    // The write is async (calendar/event/update over the websocket
    // connection) — let it and the subsequent re-fetch/close settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await card.updateComplete;

    // Lands directly on Schedule — NOT the Start Time screen it was pushed
    // from, and not still on the time picker either. This is the one
    // genuinely new piece of nav logic ADR-0018 introduced (_closeToSchedule,
    // pop-by-name rather than pop-one) — the whole reason this test exists.
    expect(overlayPresent(card, 'ecosee-schedule-overlay')).toBe(true);
    expect(overlayPresent(card, 'ecosee-schedule-start-time-overlay')).toBe(false);
    expect(overlayPresent(card, 'ecosee-time-picker-overlay')).toBe(false);
    void calls; // the exact write payload is schedule.test.ts's concern; this test is about nav depth.
  });
});
