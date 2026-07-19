// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import '../src/overlays/comfort-setpoint-overlay';
import type { EcoseeComfortSetpointOverlay } from '../src/overlays/comfort-setpoint-overlay';
import type { ComfortSetpointValue } from '../src/climate/comfort-setpoint';

// The single-value picker pushed from a Comfort Setpoints card's Heat/Cool
// pill (ADR-0015). Visually modeled on the Temperature Adjust overlay's own
// scrubber, but with a shorter ladder (1 neighbor per side, not 2) since this
// screen also carries a title/subtitle header above it (owner request: same
// look, smaller, to leave room for the titles).

function value(overrides: Partial<ComfortSetpointValue['edit']> = {}): ComfortSetpointValue {
  return {
    entityId: 'number.home_heat',
    unit: '°F',
    edit: { setpoint: 'heat', value: 68, min: 45, max: 92, step: 1, ...overrides },
  };
}

async function mount(
  v: ComfortSetpointValue,
  presetLabel = 'Home',
): Promise<EcoseeComfortSetpointOverlay> {
  const el = document.createElement(
    'ecosee-comfort-setpoint-overlay',
  ) as EcoseeComfortSetpointOverlay;
  el.value = v;
  el.presetLabel = presetLabel;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Comfort Setpoint overlay — rendering', () => {
  it('renders the preset label and setpoint kind as the header', async () => {
    const el = await mount(value(), 'Away');
    expect(el.shadowRoot!.querySelector('.title')?.textContent).toBe('Away');
    expect(el.shadowRoot!.querySelector('.subtitle')?.textContent).toBe('Heat setpoint');
  });

  it('shows the current value in the bubble', async () => {
    const el = await mount(value({ value: 68 }));
    expect(el.shadowRoot!.querySelector('.bubble')?.textContent?.trim()).toBe('68');
  });

  // The whole point of shrinking SCRUBBER_RADIUS to 1 (owner request): the
  // ladder shows exactly one neighbor on each side of the bubble, not two.
  it('shows exactly one neighbor above and one below the selected value', async () => {
    const el = await mount(value({ value: 68, min: 45, max: 92, step: 1 }));
    const above = el.shadowRoot!.querySelector('.stack.above')!;
    const below = el.shadowRoot!.querySelector('.stack.below')!;
    expect(above.querySelectorAll('.neighbor')).toHaveLength(1);
    expect(below.querySelectorAll('.neighbor')).toHaveLength(1);
    expect(above.textContent?.trim()).toBe('69');
    expect(below.textContent?.trim()).toBe('67');
  });

  it('shows fewer neighbors near a bound rather than padding the ladder', async () => {
    const el = await mount(value({ value: 45, min: 45, max: 92, step: 1 })); // at the min
    const above = el.shadowRoot!.querySelector('.stack.above')!;
    const below = el.shadowRoot!.querySelector('.stack.below')!;
    expect(above.querySelectorAll('.neighbor')).toHaveLength(1);
    expect(below.querySelectorAll('.neighbor')).toHaveLength(0);
  });

  it('tints the scrubber/± buttons per setpoint (heat vs cool)', async () => {
    const heat = await mount(value({ setpoint: 'heat' }));
    expect(heat.shadowRoot!.querySelector('.adjust')?.classList.contains('heat')).toBe(true);

    const cool = await mount(value({ setpoint: 'cool' }));
    expect(cool.shadowRoot!.querySelector('.adjust')?.classList.contains('cool')).toBe(true);
  });
});

describe('Comfort Setpoint overlay — ± nudge', () => {
  it('increases the value on the Increase button and reflects it immediately', async () => {
    const el = await mount(value({ value: 68 }));
    (el.shadowRoot!.querySelector('button[aria-label="Increase"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.bubble')?.textContent?.trim()).toBe('69');
  });

  it('decreases the value on the Decrease button and reflects it immediately', async () => {
    const el = await mount(value({ value: 68 }));
    (el.shadowRoot!.querySelector('button[aria-label="Decrease"]') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.bubble')?.textContent?.trim()).toBe('67');
  });
});
