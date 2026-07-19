// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Side-effect import: registers <ecosee-fan-runtime-overlay> via @customElement.
import '../src/overlays/fan-runtime-overlay';
import type { EcoseeFanRuntimeOverlay } from '../src/overlays/fan-runtime-overlay';
import type { MinRuntimeModel } from '../src/climate/fan';
import { PICKER_CONFIRM_MS } from '../src/overlays/overlay-dismiss';
import type { ServiceCall } from '../src/climate/service-call';

// Behaviour tests for the Fan minimum-runtime picker (ADR-0018 follow-up:
// replace the remaining native <select> menus), mirroring System Mode's own
// optimistic-select/confirm-beat/auto-close contract (picker-overlays.test.ts).

function model(current = 0): MinRuntimeModel {
  return {
    entityId: 'number.min',
    value: current,
    summary: `Minimum runtime: ${current} min/hr`,
    options: [0, 5, 10, 15, 20].map((value) => ({
      value,
      label: `${value} min/hr`,
      selected: value === current,
    })),
  };
}

async function mount(m: MinRuntimeModel): Promise<EcoseeFanRuntimeOverlay> {
  const el = document.createElement('ecosee-fan-runtime-overlay') as EcoseeFanRuntimeOverlay;
  el.model = m;
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

describe('Fan Runtime picker — render', () => {
  it('renders one row per option, marking the current value selected', async () => {
    const el = await mount(model(0));
    const options = [...el.shadowRoot!.querySelectorAll('.option')] as HTMLButtonElement[];
    expect(options.map((o) => o.textContent?.trim())).toContain('0 min/hr');
    const selected = options.find((o) => o.classList.contains('selected'))!;
    expect(selected.textContent?.trim()).toBe('0 min/hr');
  });
});

describe('Fan Runtime picker — optimistic select + auto-close', () => {
  it('moves the highlight to the tapped row immediately and emits number.set_value', async () => {
    const el = await mount(model(0));
    const rec = recordEvents(el);

    const options = [...el.shadowRoot!.querySelectorAll('.option')] as HTMLButtonElement[];
    const fifteen = options.find((o) => o.textContent?.trim() === '15 min/hr')!;

    fifteen.click();
    await el.updateComplete;

    expect(fifteen.classList.contains('selected')).toBe(true);
    expect(rec.calls).toEqual([
      {
        domain: 'number',
        service: 'set_value',
        data: { entity_id: 'number.min', value: 15 },
      },
    ]);
    expect(rec.dismisses).toBe(0); // confirm beat still running
  });

  it('auto-closes after the confirm beat', async () => {
    const el = await mount(model(0));
    const rec = recordEvents(el);

    const fifteen = [...el.shadowRoot!.querySelectorAll('.option')].find(
      (o) => o.textContent?.trim() === '15 min/hr',
    ) as HTMLButtonElement;
    fifteen.click();

    vi.advanceTimersByTime(PICKER_CONFIRM_MS - 1);
    expect(rec.dismisses).toBe(0);
    vi.advanceTimersByTime(1);
    expect(rec.dismisses).toBe(1);
  });

  it('tapping the already-selected row writes nothing but still closes', async () => {
    const el = await mount(model(0));
    const rec = recordEvents(el);

    const zero = [...el.shadowRoot!.querySelectorAll('.option')].find(
      (o) => o.textContent?.trim() === '0 min/hr',
    ) as HTMLButtonElement;

    zero.click();
    expect(rec.calls).toHaveLength(0);
    vi.advanceTimersByTime(PICKER_CONFIRM_MS);
    expect(rec.dismisses).toBe(1);
  });
});
