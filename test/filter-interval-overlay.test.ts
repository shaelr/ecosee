// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Side-effect import: registers <ecosee-filter-interval-overlay> via @customElement.
import '../src/overlays/filter-interval-overlay';
import type { EcoseeFilterIntervalOverlay } from '../src/overlays/filter-interval-overlay';
import type { FilterIntervalEdit } from '../src/climate/furnace-filter';
import { PICKER_CONFIRM_MS } from '../src/overlays/overlay-dismiss';
import type { ServiceCall } from '../src/climate/service-call';

// Behaviour tests for the Furnace Filter Interval picker (ADR-0018 follow-up:
// replace the remaining native <select> menus), mirroring System Mode's own
// optimistic-select/confirm-beat/auto-close contract (picker-overlays.test.ts).

function edit(current = 6): FilterIntervalEdit {
  return {
    entityId: 'number.filter_interval',
    value: current,
    unit: 'months',
    options: Array.from({ length: 12 }, (_, i) => i + 1).map((value) => ({
      value,
      label: `${value} ${value === 1 ? 'month' : 'months'}`,
      selected: value === current,
    })),
  };
}

async function mount(model: FilterIntervalEdit): Promise<EcoseeFilterIntervalOverlay> {
  const el = document.createElement(
    'ecosee-filter-interval-overlay',
  ) as EcoseeFilterIntervalOverlay;
  el.model = model;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function recordEvents(el: Element): { calls: ServiceCall[]; dismisses: number } {
  const record = { calls: [] as ServiceCall[], dismisses: 0 };
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

describe('Filter Interval picker — render', () => {
  it('renders one row per option, marking the current value selected', async () => {
    const el = await mount(edit(6));
    const options = [...el.shadowRoot!.querySelectorAll('.option')] as HTMLButtonElement[];
    expect(options.map((o) => o.textContent?.trim())).toContain('6 months');
    const selected = options.find((o) => o.classList.contains('selected'))!;
    expect(selected.textContent?.trim()).toBe('6 months');
  });
});

describe('Filter Interval picker — optimistic select + auto-close', () => {
  it('moves the highlight to the tapped row immediately and emits number.set_value', async () => {
    const el = await mount(edit(6));
    const rec = recordEvents(el);

    const options = [...el.shadowRoot!.querySelectorAll('.option')] as HTMLButtonElement[];
    const nine = options.find((o) => o.textContent?.trim() === '9 months')!;

    nine.click();
    await el.updateComplete;

    expect(nine.classList.contains('selected')).toBe(true);
    expect(rec.calls).toEqual([
      {
        domain: 'number',
        service: 'set_value',
        data: { entity_id: 'number.filter_interval', value: 9 },
      },
    ]);
    expect(rec.dismisses).toBe(0); // confirm beat still running
  });

  it('auto-closes after the confirm beat', async () => {
    const el = await mount(edit(6));
    const rec = recordEvents(el);

    const nine = [...el.shadowRoot!.querySelectorAll('.option')].find(
      (o) => o.textContent?.trim() === '9 months',
    ) as HTMLButtonElement;
    nine.click();

    vi.advanceTimersByTime(PICKER_CONFIRM_MS - 1);
    expect(rec.dismisses).toBe(0);
    vi.advanceTimersByTime(1);
    expect(rec.dismisses).toBe(1);
  });

  it('tapping the already-selected row writes nothing but still closes', async () => {
    const el = await mount(edit(6));
    const rec = recordEvents(el);

    const six = [...el.shadowRoot!.querySelectorAll('.option')].find(
      (o) => o.textContent?.trim() === '6 months',
    ) as HTMLButtonElement;

    six.click();
    expect(rec.calls).toHaveLength(0);
    vi.advanceTimersByTime(PICKER_CONFIRM_MS);
    expect(rec.dismisses).toBe(1);
  });
});
