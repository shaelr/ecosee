// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
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

  // ADR-0018: this field no longer owns any native form control at all —
  // ecosee's own calendar Overlay (date-picker-overlay.ts) replaced the
  // browser's native date picker entirely, sidestepping the whole category
  // of cross-engine bugs (a Chrome desktop rendering quirk, an unimplemented
  // iOS WebKit API) the earlier button+hidden-input architecture existed to
  // work around.
  it('tapping the pill emits ecosee-date-picker-open, asking the host to push the calendar Overlay', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    let fired = 0;
    el.addEventListener('ecosee-date-picker-open', () => (fired += 1));

    datePillButton(el)!.click();

    expect(fired).toBe(1);
  });

  it('owns no write logic of its own for this field — no ecosee-service-call from tapping the pill', async () => {
    const el = await mount(model({ canEditLastChanged: true }), {
      lastChangedEntity: 'date.filter',
    });
    const fired: ServiceCall[] = [];
    el.addEventListener('ecosee-service-call', (e) =>
      fired.push((e as CustomEvent<{ call: ServiceCall }>).detail.call),
    );

    datePillButton(el)!.click();

    expect(fired).toHaveLength(0);
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
