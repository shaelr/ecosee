import { describe, it, expect } from 'vitest';
import { toTabBarModel } from '../src/menu/tab-bar';

const ALL = {
  system: true,
  sensors: true,
  fan: true,
  schedule: true,
  setpoints: true,
  filter: true,
};

describe('toTabBarModel', () => {
  it('lists reachable sections in device order (Furnace Filter, sensors, fan, Schedule, Setpoints, System-gear)', () => {
    const model = toTabBarModel('system', ALL);
    expect(model.available).toBe(true);
    expect(model.items.map((i) => [i.target, i.icon])).toEqual([
      ['filter', 'filter'],
      ['sensors', 'sensor'],
      ['fan', 'fan'],
      ['schedule', 'calendar'],
      ['setpoints', 'setpoints'],
      ['system', 'gear'],
    ]);
  });

  it('marks the active section (and only it)', () => {
    const model = toTabBarModel('sensors', ALL);
    expect(model.items.filter((i) => i.active).map((i) => i.target)).toEqual(['sensors']);
  });

  it('drops sections whose data is absent (graceful degradation)', () => {
    const model = toTabBarModel('system', {
      system: true,
      sensors: false,
      fan: false,
      schedule: false,
      setpoints: false,
      filter: false,
    });
    expect(model.items.map((i) => i.target)).toEqual(['system']);
    expect(model.available).toBe(true);
  });

  it('is unavailable when the active screen is not a section (a picker / temperature)', () => {
    expect(toTabBarModel('system-mode', ALL).available).toBe(false);
    expect(toTabBarModel('temperature', ALL).available).toBe(false);
    expect(toTabBarModel('weather', ALL).available).toBe(false);
  });

  it('is unavailable when no section is reachable, even on a section screen', () => {
    const model = toTabBarModel('system', {
      system: false,
      sensors: false,
      fan: false,
      schedule: false,
      setpoints: false,
      filter: false,
    });
    expect(model.available).toBe(false);
    expect(model.items).toEqual([]);
  });

  it('lists the Furnace Filter tab only when it is reachable (ADR-0017)', () => {
    const withoutFilter = toTabBarModel('sensors', { ...ALL, filter: false });
    expect(withoutFilter.items.map((i) => i.target)).not.toContain('filter');
    const withFilter = toTabBarModel('sensors', ALL);
    expect(withFilter.items.map((i) => i.target)).toContain('filter');
  });
});
