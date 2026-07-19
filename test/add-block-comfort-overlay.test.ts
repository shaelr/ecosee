// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Side-effect import: registers <ecosee-add-block-comfort-overlay> via @customElement.
import '../src/overlays/add-block-comfort-overlay';
import type { EcoseeAddBlockComfortOverlay } from '../src/overlays/add-block-comfort-overlay';
import type { ComfortSettingModel } from '../src/climate/comfort-setting';
import { PICKER_CONFIRM_MS } from '../src/overlays/overlay-dismiss';
import type { ServiceCall } from '../src/climate/service-call';

// Behaviour tests for Add to Schedule's Comfort Setting picker (ADR-0018
// follow-up: replace the remaining native <select> menus). Visually and
// behaviourally the same optimistic-select/confirm-beat/auto-close contract
// as comfort-setting-overlay.ts (picker-overlays.test.ts), but selecting a
// row must NOT write to the entity — it must dispatch a local confirm event
// instead, since Add to Schedule is still just configuring a new,
// not-yet-submitted block.

function model(selectedPreset = 'home'): ComfortSettingModel {
  return {
    available: true,
    options: [
      { preset: 'home', label: 'Home', icon: 'home', selected: selectedPreset === 'home' },
      { preset: 'away', label: 'Away', icon: 'away', selected: selectedPreset === 'away' },
      { preset: 'sleep', label: 'Sleep', icon: 'sleep', selected: selectedPreset === 'sleep' },
    ],
  };
}

async function mount(m: ComfortSettingModel): Promise<EcoseeAddBlockComfortOverlay> {
  const el = document.createElement(
    'ecosee-add-block-comfort-overlay',
  ) as EcoseeAddBlockComfortOverlay;
  el.model = m;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function recordEvents(el: Element): {
  confirms: { comfortSetting: string }[];
  calls: ServiceCall[];
  dismisses: number;
} {
  const record = {
    confirms: [] as { comfortSetting: string }[],
    calls: [] as ServiceCall[],
    dismisses: 0,
  };
  el.addEventListener('ecosee-add-block-comfort-confirm', (e) =>
    record.confirms.push((e as CustomEvent<{ comfortSetting: string }>).detail),
  );
  el.addEventListener('ecosee-service-call', (e) =>
    record.calls.push((e as CustomEvent<{ call: ServiceCall }>).detail.call),
  );
  el.addEventListener('ecosee-overlay-dismiss', () => (record.dismisses += 1));
  return record;
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Add Block Comfort picker — render', () => {
  it('renders one row per Comfort Setting, marking the current pick selected', async () => {
    const el = await mount(model('home'));
    const options = [...el.shadowRoot!.querySelectorAll('.option')] as HTMLButtonElement[];
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Home', 'Away', 'Sleep']);
    const selected = options.find((o) => o.classList.contains('selected'))!;
    expect(selected.textContent?.trim()).toBe('Home');
  });
});

describe('Add Block Comfort picker — optimistic select + auto-close', () => {
  it('moves the highlight, dispatches a local confirm event, and writes nothing to the entity', async () => {
    const el = await mount(model('home'));
    const rec = recordEvents(el);

    const options = [...el.shadowRoot!.querySelectorAll('.option')] as HTMLButtonElement[];
    const away = options.find((o) => o.textContent?.trim() === 'Away')!;

    away.click();
    await el.updateComplete;

    expect(away.classList.contains('selected')).toBe(true);
    expect(rec.confirms).toEqual([{ comfortSetting: 'away' }]);
    expect(rec.calls).toHaveLength(0); // no entity write — nothing is submitted yet
    expect(rec.dismisses).toBe(0); // confirm beat still running
  });

  it('auto-closes after the confirm beat', async () => {
    const el = await mount(model('home'));
    const rec = recordEvents(el);

    const away = [...el.shadowRoot!.querySelectorAll('.option')].find(
      (o) => o.textContent?.trim() === 'Away',
    ) as HTMLButtonElement;
    away.click();

    vi.advanceTimersByTime(PICKER_CONFIRM_MS - 1);
    expect(rec.dismisses).toBe(0);
    vi.advanceTimersByTime(1);
    expect(rec.dismisses).toBe(1);
  });

  it('tapping the already-selected row dispatches nothing but still closes', async () => {
    const el = await mount(model('home'));
    const rec = recordEvents(el);

    const home = [...el.shadowRoot!.querySelectorAll('.option')].find(
      (o) => o.textContent?.trim() === 'Home',
    ) as HTMLButtonElement;

    home.click();
    expect(rec.confirms).toHaveLength(0);
    vi.advanceTimersByTime(PICKER_CONFIRM_MS);
    expect(rec.dismisses).toBe(1);
  });
});
