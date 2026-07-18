// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
// Side-effect import: registers <ecosee-furnace-filter-overlay> via @customElement.
import '../src/overlays/furnace-filter-overlay';
import type { EcoseeFurnaceFilterOverlay } from '../src/overlays/furnace-filter-overlay';
import type { FurnaceFilterModel, FilterIntervalEdit } from '../src/climate/furnace-filter';
import type { ServiceCall } from '../src/climate/service-call';

// Render/interaction tests for the Furnace Filter Main Menu section (ADR-0017):
// the last-changed/due readout, overdue styling, and the "I've changed my
// filter" button, which emits the shared ecosee-service-call event rather than
// writing to hass directly.

function model(overrides: Partial<FurnaceFilterModel> = {}): FurnaceFilterModel {
  return {
    available: true,
    lastChanged: new Date(2025, 0, 1),
    intervalDays: 90,
    dueDate: new Date(2025, 3, 1),
    overdue: false,
    daysOverdue: 0,
    canMarkChanged: true,
    canEditLastChanged: false,
    intervalEdit: null,
    ...overrides,
  };
}

async function mount(
  m: FurnaceFilterModel,
  props: { lastChangedEntity?: string; resetEntity?: string } = {},
): Promise<EcoseeFurnaceFilterOverlay> {
  const el = document.createElement('ecosee-furnace-filter-overlay') as EcoseeFurnaceFilterOverlay;
  el.model = m;
  el.lastChangedEntity = props.lastChangedEntity;
  el.resetEntity = props.resetEntity;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function button(el: EcoseeFurnaceFilterOverlay): HTMLButtonElement {
  return el.shadowRoot!.querySelector('.mark-changed') as HTMLButtonElement;
}

function pillInput(el: EcoseeFurnaceFilterOverlay, type: 'date'): HTMLInputElement | null {
  return el.shadowRoot!.querySelector(`.pill-native[type="${type}"]`);
}

function intervalSelect(el: EcoseeFurnaceFilterOverlay): HTMLSelectElement | null {
  return el.shadowRoot!.querySelector('.select-native');
}

function fireChange(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** A representative `FilterIntervalEdit` — a months-ranged 1–12 dropdown,
 *  mirroring the real-world entity shape an owner reported (min 1, max 12,
 *  step 1, unit_of_measurement "months"). `intervalOptions`'s own generation
 *  logic is unit-tested directly in furnace-filter.test.ts; this fixture
 *  only needs to look like its output for the overlay's own render/interaction
 *  tests. */
function intervalEditFixture(current = 6): FilterIntervalEdit {
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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Furnace Filter overlay — availability', () => {
  it('renders nothing when the model is unavailable', async () => {
    const el = await mount(model({ available: false }));
    expect(el.shadowRoot!.querySelector('.filter')).toBeNull();
  });

  it('renders the section title when available', async () => {
    const el = await mount(model());
    expect(el.shadowRoot!.querySelector('.title')?.textContent).toBe('Furnace Filter');
  });
});

describe('Furnace Filter overlay — readout', () => {
  it('shows a due-date row without the overdue class/note when not overdue', async () => {
    const el = await mount(model({ overdue: false }));
    const row = [...el.shadowRoot!.querySelectorAll('.row')].find((r) =>
      r.textContent?.includes('Due'),
    )!;
    expect(row.classList.contains('overdue')).toBe(false);
    expect(el.shadowRoot!.querySelector('.overdue-note')).toBeNull();
  });

  it('shows overdue styling and a day count once past the due date', async () => {
    const el = await mount(model({ overdue: true, daysOverdue: 5 }));
    const row = [...el.shadowRoot!.querySelectorAll('.row')].find((r) =>
      r.textContent?.includes('Was due'),
    )!;
    expect(row.classList.contains('overdue')).toBe(true);
    expect(el.shadowRoot!.querySelector('.overdue-note')?.textContent).toContain(
      'Overdue by 5 days',
    );
  });

  it('singularizes the overdue note at exactly one day', async () => {
    const el = await mount(model({ overdue: true, daysOverdue: 1 }));
    expect(el.shadowRoot!.querySelector('.overdue-note')?.textContent).toContain(
      'Overdue by 1 day',
    );
    expect(el.shadowRoot!.querySelector('.overdue-note')?.textContent).not.toContain('1 days');
  });

  it('omits the due-date row entirely when no interval is configured', async () => {
    const el = await mount(model({ intervalDays: null, dueDate: null }));
    const rows = [...el.shadowRoot!.querySelectorAll('.row')].map((r) => r.textContent);
    expect(rows.some((t) => t?.includes('Due') || t?.includes('Was due'))).toBe(false);
  });
});

describe('Furnace Filter overlay — mark changed button', () => {
  it('is disabled when the model says nothing can be written', async () => {
    const el = await mount(model({ canMarkChanged: false }));
    expect(button(el).disabled).toBe(true);
  });

  it('is enabled when the model allows a write', async () => {
    const el = await mount(model({ canMarkChanged: true }));
    expect(button(el).disabled).toBe(false);
  });

  it('emits ecosee-service-call built from the reset entity when configured', async () => {
    const el = await mount(model(), { resetEntity: 'button.reset_filter' });
    const fired: ServiceCall[] = [];
    el.addEventListener('ecosee-service-call', (e) =>
      fired.push((e as CustomEvent<{ call: ServiceCall }>).detail.call),
    );
    button(el).click();
    expect(fired).toEqual([
      { domain: 'button', service: 'press', data: { entity_id: 'button.reset_filter' } },
    ]);
  });

  it('emits ecosee-service-call built from the last-changed entity when no reset entity is configured', async () => {
    const el = await mount(model(), { lastChangedEntity: 'date.filter' });
    const fired: ServiceCall[] = [];
    el.addEventListener('ecosee-service-call', (e) =>
      fired.push((e as CustomEvent<{ call: ServiceCall }>).detail.call),
    );
    button(el).click();
    expect(fired).toHaveLength(1);
    expect(fired[0].domain).toBe('date');
    expect(fired[0].service).toBe('set_value');
  });

  it('emits nothing when neither entity id can build a call', async () => {
    const el = await mount(model({ canMarkChanged: false }));
    const fired: ServiceCall[] = [];
    el.addEventListener('ecosee-service-call', (e) =>
      fired.push((e as CustomEvent<{ call: ServiceCall }>).detail.call),
    );
    button(el).click();
    expect(fired).toHaveLength(0);
  });
});

describe('Furnace Filter overlay — editable "Last changed"', () => {
  it('renders plain text, no native date input, when canEditLastChanged is false', async () => {
    const el = await mount(model({ canEditLastChanged: false }));
    expect(pillInput(el, 'date')).toBeNull();
    const row = [...el.shadowRoot!.querySelectorAll('.row')].find((r) =>
      r.textContent?.includes('Last changed'),
    )!;
    expect(row.querySelector('.pill')).toBeNull();
    expect(row.querySelector('.value')).not.toBeNull();
  });

  it('renders a tappable pill with a native date input when canEditLastChanged is true', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const input = pillInput(el, 'date');
    expect(input).not.toBeNull();
    expect(input!.value).toBe('2025-01-01');
  });

  it('renders a full-coverage opaque backing layer behind the label, ahead of the native input', async () => {
    // Regression guard: Chrome renders a date input's own value at full
    // system styling while its calendar picker is open, ignoring this
    // input's own color/::selection — .pill-backing physically covers the
    // whole pill rather than relying on the input's own text staying
    // invisible. It must stay a *separate* element from .pill-label (not
    // just a background on the label itself) — .pill-label is the pill's
    // only in-flow child once .pill-native is taken out of flow, so .pill's
    // own width is measured from it; making .pill-label absolutely
    // positioned too (to get full coverage) collapses the whole pill.
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const pill = el.shadowRoot!.querySelector('.pill')!;
    const backing = pill.querySelector('.pill-backing');
    const label = pill.querySelector('.pill-label');
    expect(backing).not.toBeNull();
    expect(backing).not.toBe(label);
  });

  it('caps the native date input at today — no picking a future last-changed date', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const input = pillInput(el, 'date')!;
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    expect(input.max).toBe(today);
  });

  it('emits ecosee-service-call with the picked date on change', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const fired: ServiceCall[] = [];
    el.addEventListener('ecosee-service-call', (e) =>
      fired.push((e as CustomEvent<{ call: ServiceCall }>).detail.call),
    );
    fireChange(pillInput(el, 'date')!, '2026-03-15');
    expect(fired).toEqual([
      {
        domain: 'date',
        service: 'set_value',
        data: { entity_id: 'date.filter', date: '2026-03-15' },
      },
    ]);
  });

  it('does nothing when the picked value is empty (input cleared)', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const fired: ServiceCall[] = [];
    el.addEventListener('ecosee-service-call', (e) =>
      fired.push((e as CustomEvent<{ call: ServiceCall }>).detail.call),
    );
    fireChange(pillInput(el, 'date')!, '');
    expect(fired).toHaveLength(0);
  });

  it('calls the native input’s own showPicker() on click, so the calendar always opens', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const input = pillInput(el, 'date')!;
    const showPicker = vi.fn();
    (input as unknown as { showPicker: () => void }).showPicker = showPicker;
    input.click();
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('does not throw when showPicker is unsupported by the environment', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const input = pillInput(el, 'date')!;
    expect((input as unknown as { showPicker?: unknown }).showPicker).toBeUndefined();
    expect(() => input.click()).not.toThrow();
  });
});

describe('Furnace Filter overlay — editable "Interval" (dropdown menu)', () => {
  it('omits the Interval row entirely when intervalEdit is null', async () => {
    const el = await mount(model({ intervalEdit: null }));
    expect(intervalSelect(el)).toBeNull();
    const rows = [...el.shadowRoot!.querySelectorAll('.row')].map((r) => r.textContent);
    expect(rows.some((t) => t?.includes('Interval'))).toBe(false);
  });

  it('renders a dropdown pill labeled with the current value, listing every option', async () => {
    const el = await mount(model({ intervalEdit: intervalEditFixture(6) }));
    const row = [...el.shadowRoot!.querySelectorAll('.row')].find((r) =>
      r.textContent?.includes('Interval'),
    )!;
    expect(row.querySelector('.pill-label')?.textContent).toBe('6 months');
    const select = intervalSelect(el)!;
    expect([...select.options].map((o) => o.value)).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i + 1)),
    );
    expect([...select.options].map((o) => o.textContent?.trim())).toContain('1 month');
    // Checked on the individual <option>'s own attribute rather than the
    // parent <select>'s .value — happy-dom doesn't recompute .value from a
    // programmatically-set `selected` attribute the way a real browser does.
    const selectedOption = [...select.options].find((o) => o.hasAttribute('selected'));
    expect(selectedOption?.value).toBe('6');
  });

  it('emits ecosee-service-call via number.set_value on change, in the entity’s own unit', async () => {
    const el = await mount(model({ intervalEdit: intervalEditFixture(6) }));
    const fired: ServiceCall[] = [];
    el.addEventListener('ecosee-service-call', (e) =>
      fired.push((e as CustomEvent<{ call: ServiceCall }>).detail.call),
    );
    fireChange(intervalSelect(el)!, '9');
    expect(fired).toEqual([
      {
        domain: 'number',
        service: 'set_value',
        data: { entity_id: 'number.filter_interval', value: 9 },
      },
    ]);
  });
});
