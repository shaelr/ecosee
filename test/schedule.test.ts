import { describe, it, expect } from 'vitest';
import {
  scheduleDays,
  getScheduleEventsCall,
  parseScheduleResponse,
  toScheduleBlocks,
  toScheduleModel,
  snapToSlot,
  moveBlockStart,
  removeBlock,
  addBlockCall,
  copyDayCalls,
  dayStart,
  type RawScheduleEvent,
  type ScheduleBlock,
} from '../src/schedule/schedule';
import type { EcoseeCardConfig } from '../src/config';
import type { HassEntityBase, HomeAssistant } from '../src/types/hass';

const config: EcoseeCardConfig = {
  type: 'custom:ecosee-card',
  entity: 'climate.t',
  schedule_entity: 'calendar.t_schedule',
};

function hass(calendar?: HassEntityBase): HomeAssistant {
  return {
    states: calendar ? { [calendar.entity_id]: calendar } : {},
    config: { unit_system: { temperature: '°F' } },
    callService: async () => undefined,
  };
}

const calendarOk: HassEntityBase = {
  entity_id: 'calendar.t_schedule',
  state: 'off',
  attributes: {},
};

// A Thursday, arbitrary but fixed, at local midnight.
const THU = dayStart(new Date(2026, 6, 16, 12, 0, 0));

// A local-time (no UTC offset) ISO-ish string, matching toLocalIso's own format
// — Date.parse interprets a string with no offset suffix as local time, so this
// must NOT go through Date#toISOString (which converts to UTC first).
function iso(date: Date, hours: number, minutes = 0): string {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  );
}

describe('scheduleDays', () => {
  it('lists Sunday-first day labels, marking only the selected index', () => {
    const days = scheduleDays(4);
    expect(days.map((d) => d.label)).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
    expect(days.filter((d) => d.selected).map((d) => d.index)).toEqual([4]);
  });
});

describe('getScheduleEventsCall', () => {
  it('builds a calendar.get_events call spanning exactly [start, start+24h)', () => {
    const call = getScheduleEventsCall('calendar.t_schedule', THU);
    expect(call.domain).toBe('calendar');
    expect(call.service).toBe('get_events');
    expect(call.data.entity_id).toBe('calendar.t_schedule');
    const start = new Date(call.data.start_date_time as string);
    const end = new Date(call.data.end_date_time as string);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('parseScheduleResponse', () => {
  it('unwraps { response: { <entity_id>: { events: [...] } } }', () => {
    const response = {
      response: {
        'calendar.t_schedule': {
          events: [
            { uid: 'a', start: '2026-07-16T06:30:00', end: '2026-07-16T23:00:00', summary: 'Home' },
          ],
        },
      },
    };
    expect(parseScheduleResponse(response, 'calendar.t_schedule')).toEqual([
      { uid: 'a', start: '2026-07-16T06:30:00', end: '2026-07-16T23:00:00', summary: 'Home' },
    ]);
  });

  it('degrades to an empty array for every missing layer', () => {
    expect(parseScheduleResponse(undefined, 'calendar.t_schedule')).toEqual([]);
    expect(parseScheduleResponse({}, 'calendar.t_schedule')).toEqual([]);
    expect(parseScheduleResponse({ response: {} }, 'calendar.t_schedule')).toEqual([]);
    expect(
      parseScheduleResponse({ response: { 'calendar.t_schedule': {} } }, 'calendar.t_schedule'),
    ).toEqual([]);
    expect(
      parseScheduleResponse(
        { response: { 'calendar.t_schedule': { events: 'not-an-array' } } },
        'calendar.t_schedule',
      ),
    ).toEqual([]);
  });

  it('drops individual malformed events but keeps the well-formed ones', () => {
    const response = {
      response: {
        'calendar.t_schedule': {
          events: [
            { start: '2026-07-16T00:00:00', end: '2026-07-16T06:30:00', summary: 'Sleep' },
            { start: 5, end: '2026-07-16T23:00:00', summary: 'Home' }, // bad start
            { start: '2026-07-16T23:00:00', end: '2026-07-17T00:00:00' }, // missing summary
          ],
        },
      },
    };
    const events = parseScheduleResponse(response, 'calendar.t_schedule');
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Sleep');
  });

  it('defaults a missing uid to an empty string rather than dropping the event', () => {
    const response = {
      response: {
        'calendar.t_schedule': {
          events: [{ start: '2026-07-16T00:00:00', end: '2026-07-16T06:30:00', summary: 'Sleep' }],
        },
      },
    };
    expect(parseScheduleResponse(response, 'calendar.t_schedule')[0].uid).toBe('');
  });
});

describe('toScheduleBlocks', () => {
  it('derives minute offsets from local midnight for a day with three blocks', () => {
    const events: RawScheduleEvent[] = [
      { uid: 'sleep-1', start: iso(THU, 0), end: iso(THU, 6, 30), summary: 'Sleep' },
      { uid: 'home-1', start: iso(THU, 6, 30), end: iso(THU, 23), summary: 'Home' },
      {
        uid: 'sleep-2',
        start: iso(THU, 23),
        end: iso(new Date(THU.getTime() + 86400000), 0),
        summary: 'Sleep',
      },
    ];
    const blocks = toScheduleBlocks(events, THU, config);
    expect(blocks.map((b) => [b.comfortSetting, b.startMinutes, b.endMinutes])).toEqual([
      ['Sleep', 0, 390],
      ['Home', 390, 1380],
      ['Sleep', 1380, 1440],
    ]);
  });

  it('marks the first block continuesFromPreviousDay when it starts at midnight', () => {
    const events: RawScheduleEvent[] = [
      { uid: 'sleep-1', start: iso(THU, 0), end: iso(THU, 6, 30), summary: 'Sleep' },
      { uid: 'home-1', start: iso(THU, 6, 30), end: iso(THU, 23), summary: 'Home' },
    ];
    const blocks = toScheduleBlocks(events, THU, config);
    expect(blocks[0].continuesFromPreviousDay).toBe(true);
    expect(blocks[1].continuesFromPreviousDay).toBe(false);
  });

  it('marks the last block continuesIntoNextDay when it ends at the next midnight', () => {
    const events: RawScheduleEvent[] = [
      { uid: 'home-1', start: iso(THU, 6, 30), end: iso(THU, 23), summary: 'Home' },
      {
        uid: 'sleep-2',
        start: iso(THU, 23),
        end: iso(new Date(THU.getTime() + 86400000), 0),
        summary: 'Sleep',
      },
    ];
    const blocks = toScheduleBlocks(events, THU, config);
    expect(blocks[0].continuesIntoNextDay).toBe(false);
    expect(blocks[1].continuesIntoNextDay).toBe(true);
  });

  it('sorts out-of-order events by start time', () => {
    const events: RawScheduleEvent[] = [
      { uid: 'home-1', start: iso(THU, 6, 30), end: iso(THU, 23), summary: 'Home' },
      { uid: 'sleep-1', start: iso(THU, 0), end: iso(THU, 6, 30), summary: 'Sleep' },
    ];
    const blocks = toScheduleBlocks(events, THU, config);
    expect(blocks.map((b) => b.comfortSetting)).toEqual(['Sleep', 'Home']);
  });

  it('resolves each block’s icon from its comfort setting name', () => {
    const events: RawScheduleEvent[] = [
      { uid: 'home-1', start: iso(THU, 0), end: iso(THU, 12), summary: 'Home' },
      { uid: 'custom-1', start: iso(THU, 12), end: iso(THU, 23, 59), summary: 'Guest Mode' },
    ];
    const blocks = toScheduleBlocks(events, THU, config);
    expect(blocks[0].icon).toBe('home');
    expect(blocks[1].icon).toBe('comfort');
  });
});

describe('toScheduleModel', () => {
  it('is unavailable when schedule_entity is unset', () => {
    const model = toScheduleModel(
      hass(calendarOk),
      { ...config, schedule_entity: undefined },
      [],
      THU,
      4,
    );
    expect(model.available).toBe(false);
    expect(model.blocks).toEqual([]);
  });

  it('is unavailable when the configured entity is missing', () => {
    const model = toScheduleModel(hass(), config, [], THU, 4);
    expect(model.available).toBe(false);
  });

  it('is unavailable when the configured entity is unavailable', () => {
    const model = toScheduleModel(
      hass({ ...calendarOk, state: 'unavailable' }),
      config,
      [],
      THU,
      4,
    );
    expect(model.available).toBe(false);
  });

  it('is available with the entity present, even before any events have loaded', () => {
    const model = toScheduleModel(hass(calendarOk), config, [], THU, 4);
    expect(model.available).toBe(true);
    expect(model.blocks).toEqual([]);
    expect(model.days.find((d) => d.selected)?.index).toBe(4);
  });
});

describe('snapToSlot', () => {
  it('snaps to the nearest 30-minute slot', () => {
    expect(snapToSlot(37)).toBe(30); // 37/30 = 1.23 -> rounds down to slot 1 (30)
    expect(snapToSlot(50)).toBe(60); // 50/30 = 1.67 -> rounds up to slot 2 (60)
  });

  it('clamps into [0, 1410]', () => {
    expect(snapToSlot(-10)).toBe(0);
    expect(snapToSlot(10000)).toBe(1410);
  });
});

describe('moveBlockStart — grow (earlier start) repaints this block’s own footprint', () => {
  const blocks: ScheduleBlock[] = [
    {
      uid: 'sleep-1',
      comfortSetting: 'Sleep',
      icon: 'sleep',
      startMinutes: 0,
      endMinutes: 390,
      continuesFromPreviousDay: true,
      continuesIntoNextDay: false,
    },
    {
      uid: 'home-1',
      comfortSetting: 'Home',
      icon: 'home',
      startMinutes: 390,
      endMinutes: 1380,
      continuesFromPreviousDay: false,
      continuesIntoNextDay: false,
    },
    {
      uid: 'sleep-2',
      comfortSetting: 'Sleep',
      icon: 'sleep',
      startMinutes: 1380,
      endMinutes: 1440,
      continuesFromPreviousDay: false,
      continuesIntoNextDay: true,
    },
  ];

  it('repaints the block’s own uid, keeping its own end and summary', () => {
    const message = moveBlockStart('calendar.t_schedule', blocks, 2, THU, 1350); // 22:30, earlier than 23:00
    expect(message).toEqual({
      type: 'calendar/event/update',
      entity_id: 'calendar.t_schedule',
      uid: 'sleep-2',
      event: {
        dtstart: expect.stringContaining('T22:30:00'),
        dtend: expect.stringContaining('T00:00:00'),
        summary: 'Sleep',
      },
    });
  });

  it('shrinking extends the PRECEDING block instead, keeping ITS summary', () => {
    const message = moveBlockStart('calendar.t_schedule', blocks, 2, THU, 1410); // 23:30, later than 23:00
    expect(message).toEqual({
      type: 'calendar/event/update',
      entity_id: 'calendar.t_schedule',
      uid: 'home-1',
      event: {
        dtstart: expect.stringContaining('T06:30:00'),
        dtend: expect.stringContaining('T23:30:00'),
        summary: 'Home',
      },
    });
  });

  it('is a no-op when the new start equals the current start', () => {
    expect(moveBlockStart('calendar.t_schedule', blocks, 1, THU, 390)).toBeNull();
  });

  it('is null for a block that continues from the previous day', () => {
    expect(moveBlockStart('calendar.t_schedule', blocks, 0, THU, 60)).toBeNull();
  });

  it('is null when shrinking a block with no preceding block', () => {
    // Block 0 is excluded above by continuesFromPreviousDay; construct a case
    // where index 0 does NOT continue from the previous day (a day that starts
    // with a genuine transition) to isolate the "no predecessor" branch.
    const noLeadIn: ScheduleBlock[] = [
      { ...blocks[0], continuesFromPreviousDay: false },
      blocks[1],
    ];
    expect(moveBlockStart('calendar.t_schedule', noLeadIn, 0, THU, 450)).toBeNull();
  });

  it('is null when shrinking past the block’s own end', () => {
    expect(moveBlockStart('calendar.t_schedule', blocks, 2, THU, 1440)).toBeNull();
  });
});

describe('removeBlock', () => {
  const blocks: ScheduleBlock[] = [
    {
      uid: 'home-1',
      comfortSetting: 'Home',
      icon: 'home',
      startMinutes: 0,
      endMinutes: 390,
      continuesFromPreviousDay: false,
      continuesIntoNextDay: false,
    },
    {
      uid: 'sleep-1',
      comfortSetting: 'Sleep',
      icon: 'sleep',
      startMinutes: 390,
      endMinutes: 480,
      continuesFromPreviousDay: false,
      continuesIntoNextDay: false,
    },
    {
      uid: 'home-2',
      comfortSetting: 'Home',
      icon: 'home',
      startMinutes: 480,
      endMinutes: 1440,
      continuesFromPreviousDay: false,
      continuesIntoNextDay: false,
    },
  ];

  it('merges the block into its predecessor, extending the predecessor’s end', () => {
    const message = removeBlock('calendar.t_schedule', blocks, 1, THU);
    expect(message).toEqual({
      type: 'calendar/event/update',
      entity_id: 'calendar.t_schedule',
      uid: 'home-1',
      event: {
        dtstart: expect.stringContaining('T00:00:00'),
        dtend: expect.stringContaining('T08:00:00'),
        summary: 'Home',
      },
    });
  });

  it('is null for the day’s first block (no predecessor)', () => {
    expect(removeBlock('calendar.t_schedule', blocks, 0, THU)).toBeNull();
  });

  it('is null when the block itself continues from the previous day, even if not at index 0', () => {
    const withLeadIn: ScheduleBlock[] = [
      blocks[0],
      { ...blocks[1], continuesFromPreviousDay: true },
    ];
    expect(removeBlock('calendar.t_schedule', withLeadIn, 1, THU)).toBeNull();
  });
});

describe('addBlockCall', () => {
  it('builds a calendar.create_event call painting the chosen range', () => {
    const call = addBlockCall('calendar.t_schedule', 'Away', THU, 540, 1020); // 09:00-17:00
    expect(call).toEqual({
      domain: 'calendar',
      service: 'create_event',
      data: {
        entity_id: 'calendar.t_schedule',
        summary: 'Away',
        start_date_time: expect.stringContaining('T09:00:00'),
        end_date_time: expect.stringContaining('T17:00:00'),
      },
    });
  });

  it('is null when the end does not come after the start', () => {
    expect(addBlockCall('calendar.t_schedule', 'Away', THU, 540, 540)).toBeNull();
    expect(addBlockCall('calendar.t_schedule', 'Away', THU, 540, 480)).toBeNull();
  });
});

describe('copyDayCalls', () => {
  const sourceBlocks: ScheduleBlock[] = [
    {
      uid: 'sleep-1',
      comfortSetting: 'Sleep',
      icon: 'sleep',
      startMinutes: 0,
      endMinutes: 390,
      continuesFromPreviousDay: true,
      continuesIntoNextDay: false,
    },
    {
      uid: 'home-1',
      comfortSetting: 'Home',
      icon: 'home',
      startMinutes: 390,
      endMinutes: 1380,
      continuesFromPreviousDay: false,
      continuesIntoNextDay: false,
    },
    {
      uid: 'sleep-2',
      comfortSetting: 'Sleep',
      icon: 'sleep',
      startMinutes: 1380,
      endMinutes: 1440,
      continuesFromPreviousDay: false,
      continuesIntoNextDay: true,
    },
  ];
  // A different day, e.g. Friday — the calendar day one after THU.
  const FRI = new Date(THU.getTime() + 86400000);

  it('builds one create_event call per source block, dated on the target day', () => {
    const calls = copyDayCalls('calendar.t_schedule', sourceBlocks, FRI);
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.data.summary)).toEqual(['Sleep', 'Home', 'Sleep']);
    expect(calls[1]).toEqual({
      domain: 'calendar',
      service: 'create_event',
      data: {
        entity_id: 'calendar.t_schedule',
        summary: 'Home',
        start_date_time: expect.stringContaining('T06:30:00'),
        end_date_time: expect.stringContaining('T23:00:00'),
      },
    });
  });

  it('re-derives each block’s date from the target day, not the source day', () => {
    const calls = copyDayCalls('calendar.t_schedule', sourceBlocks, FRI);
    const friDateStr = `${FRI.getFullYear()}-${String(FRI.getMonth() + 1).padStart(2, '0')}-${String(FRI.getDate()).padStart(2, '0')}`;
    expect(calls[1].data.start_date_time).toContain(friDateStr);
  });

  it('returns an empty array for an empty source day', () => {
    expect(copyDayCalls('calendar.t_schedule', [], FRI)).toEqual([]);
  });
});
