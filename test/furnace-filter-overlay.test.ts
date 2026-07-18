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

function datePillButton(el: EcoseeFurnaceFilterOverlay): HTMLButtonElement | null {
  return el.shadowRoot!.querySelector('.pill-button');
}

function dateInput(el: EcoseeFurnaceFilterOverlay): HTMLInputElement | null {
  return el.shadowRoot!.querySelector('.date-native');
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
  it('renders plain text, no pill/button, when canEditLastChanged is false', async () => {
    const el = await mount(model({ canEditLastChanged: false }));
    expect(datePillButton(el)).toBeNull();
    expect(dateInput(el)).toBeNull();
    const row = [...el.shadowRoot!.querySelectorAll('.row')].find((r) =>
      r.textContent?.includes('Last changed'),
    )!;
    expect(row.querySelector('.pill')).toBeNull();
    expect(row.querySelector('.value')).not.toBeNull();
  });

  it('renders a tappable pill button showing the formatted date when canEditLastChanged is true', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const btn = datePillButton(el);
    expect(btn).not.toBeNull();
    expect(btn!.textContent?.trim()).toContain('Jan 1, 2025');
  });

  // Regression guard: an earlier version layered an invisible native
  // <input type="date"> directly over the styled label ("real control
  // captured by an invisible overlay" — the same trick fan-overlay.ts's
  // runtime <select> uses). Chrome renders a *focused* date input's own
  // value/segment-highlight at full system styling while its native picker
  // is open — no CSS on the input itself (transparent color, ::selection,
  // ::-webkit-datetime-edit-*, even an opaque higher-stacked backing layer)
  // could suppress it, confirmed by an owner screenshot after each attempt.
  // The visible pill is now an ordinary <button> — never a form control
  // Chrome could render natively — so there is nothing left for that
  // behavior to apply to.
  it('the visible pill is a real <button>, not a styled label over a native input', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const btn = datePillButton(el);
    expect(btn?.tagName).toBe('BUTTON');
    // The actual date input is a separate, genuinely tiny/invisible element
    // — never layered over the button's own visible text.
    const input = dateInput(el);
    expect(input).not.toBeNull();
    expect(input).not.toBe(btn);
    expect(input!.getAttribute('tabindex')).toBe('-1');
    expect(input!.getAttribute('aria-hidden')).toBe('true');
  });

  it('seeds the hidden date input with the current value', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    expect(dateInput(el)!.value).toBe('2025-01-01');
  });

  it('caps the hidden date input at today — no picking a future last-changed date', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    expect(dateInput(el)!.max).toBe(today);
  });

  it('emits ecosee-service-call with the picked date on change', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const fired: ServiceCall[] = [];
    el.addEventListener('ecosee-service-call', (e) =>
      fired.push((e as CustomEvent<{ call: ServiceCall }>).detail.call),
    );
    fireChange(dateInput(el)!, '2026-03-15');
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
    fireChange(dateInput(el)!, '');
    expect(fired).toHaveLength(0);
  });

  it('clicking the pill button calls the hidden input’s own showPicker()', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const showPicker = vi.fn();
    (dateInput(el) as unknown as { showPicker: () => void }).showPicker = showPicker;
    datePillButton(el)!.click();
    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  // iOS WebKit doesn't implement showPicker() for date/time inputs at all
  // (WebKit bug 261703) — it's a silent no-op there. A WebKit engineer's own
  // suggested workaround is to call .focus() instead, which iOS ties its
  // native picker sheet to regardless of what triggered the focus. Calling
  // both means desktop engines get showPicker()'s "always opens, regardless
  // of where in the pill the tap landed" behavior (ADR-0017) while iOS still
  // gets a working picker via .focus() even though its own showPicker() does
  // nothing.
  it('clicking the pill button also focuses the hidden input directly (the iOS workaround)', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const input = dateInput(el)!;
    datePillButton(el)!.click();
    expect(el.shadowRoot!.activeElement).toBe(input);
  });

  it('still focuses the input even when showPicker is unsupported by the environment', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const input = dateInput(el)!;
    expect((input as unknown as { showPicker?: unknown }).showPicker).toBeUndefined();
    datePillButton(el)!.click();
    expect(el.shadowRoot!.activeElement).toBe(input);
  });

  it('does not throw when showPicker is unsupported by the environment', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    expect((dateInput(el) as unknown as { showPicker?: unknown }).showPicker).toBeUndefined();
    expect(() => datePillButton(el)!.click()).not.toThrow();
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
