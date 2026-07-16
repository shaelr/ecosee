// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
// Side-effect import: registers <ecosee-card> via @customElement (see
// ecosee-card.wiring.test.ts's own comment on why this must be a value import).
import '../src/ecosee-card';
import type { EcoseeCard } from '../src/ecosee-card';
import { fakeHass, climateEntity } from './helpers/fake-hass';

// Regression guard (owner report: "sometimes the card renders smaller than it
// should", not fixed by resizing or reloading, but occasionally self-correcting):
// --ecosee-scale/--ecosee-rendered-size were only ever recomputed by the
// ResizeObserver's own callback — a dashboard's layout can still be mid-settle
// (masonry/grid columns not yet at their final width) the moment that callback
// first fires, latching in a too-small reading nothing ever revisited if the
// host's own box happened not to resize again afterward. `updated()` now also
// re-triggers the sync on every `hass` push, a much more frequent and reliable
// self-heal trigger than waiting on an actual box resize.
describe('ecosee-card — device scale resyncs on every hass push', () => {
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
});
