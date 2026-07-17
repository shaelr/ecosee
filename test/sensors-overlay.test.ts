// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
// Side-effect import: registers <ecosee-sensors-overlay> via @customElement.
import '../src/overlays/sensors-overlay';
import type { EcoseeSensorsOverlay } from '../src/overlays/sensors-overlay';
import type { SensorsModel } from '../src/sensors/sensors';

// Render/interaction tests for the Sensors sub-screen's cards: tapping one asks
// Home Assistant to open its own more-info dialog (History graph included) via
// the standard `hass-more-info` DOM event, rather than the Card building any
// history UI of its own.

function model(overrides: Partial<SensorsModel> = {}): SensorsModel {
  return {
    unit: '°F',
    available: true,
    cards: [
      { key: 'climate.t', name: 'Living Room', temp: 72, occupied: null, isThermostat: true },
      { key: 'sensor.hallway', name: 'Hallway', temp: 70, occupied: true, isThermostat: false },
    ],
    ...overrides,
  };
}

async function mount(m: SensorsModel): Promise<EcoseeSensorsOverlay> {
  const el = document.createElement('ecosee-sensors-overlay') as EcoseeSensorsOverlay;
  el.model = m;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function cards(el: EcoseeSensorsOverlay): HTMLButtonElement[] {
  return [...el.shadowRoot!.querySelectorAll('.card')] as HTMLButtonElement[];
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Sensors cards — tap to view history', () => {
  it('renders each card as a real button, not a decorative div', () => {
    return mount(model()).then((el) => {
      const list = cards(el);
      expect(list).toHaveLength(2);
      expect(list[0].tagName).toBe('BUTTON');
    });
  });

  it('fires hass-more-info with the tapped sensor’s entity id', async () => {
    const el = await mount(model());
    const fired: Array<{ entityId: string }> = [];
    el.addEventListener('hass-more-info', (e) =>
      fired.push((e as CustomEvent<{ entityId: string }>).detail),
    );
    cards(el)[1].click();
    expect(fired).toEqual([{ entityId: 'sensor.hallway' }]);
  });

  it('uses the thermostat card’s own bound entity id, not a synthetic one', async () => {
    const el = await mount(model());
    const fired: Array<{ entityId: string }> = [];
    el.addEventListener('hass-more-info', (e) =>
      fired.push((e as CustomEvent<{ entityId: string }>).detail),
    );
    cards(el)[0].click();
    expect(fired).toEqual([{ entityId: 'climate.t' }]);
  });

  it('bubbles and composes past the shadow boundary, matching hass-more-info’s own contract', async () => {
    const el = await mount(model());
    const fired: CustomEvent[] = [];
    document.addEventListener('hass-more-info', (e) => fired.push(e as CustomEvent));
    cards(el)[0].click();
    expect(fired).toHaveLength(1);
    expect(fired[0].bubbles).toBe(true);
    expect(fired[0].composed).toBe(true);
  });

  it('gives each card an accessible label naming the sensor and the action', async () => {
    const el = await mount(model());
    expect(cards(el)[1].getAttribute('aria-label')).toBe('Hallway, view history');
  });
});
