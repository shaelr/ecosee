import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { icons } from '../icons';
import { buildCalendarGrid, isSameDay, isAfterDay, type CalendarDay } from './calendar-math';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * `<ecosee-date-picker-overlay>` — ecosee's own calendar date picker (ADR-0018),
 * replacing the browser's native `<input type="date">` picker for Furnace
 * Filter's Last Changed field. A month grid — day-of-week header, day-number
 * cells reusing `schedule-overlay.ts`'s own `.day`/`.day.selected` circle
 * language and `.today-dot` convention — where tapping any valid day confirms
 * and closes immediately (owner decision: no separate confirm step, since a
 * single value doesn't need one the way the two-column time picker does). "A
 * way to back out" is the shell's own ✕, which never writes anything and is
 * already the universal cancel on every Overlay.
 *
 * Purely presentational: it owns no write logic itself and emits
 * `ecosee-date-picker-confirm` for the host to apply.
 */
@customElement('ecosee-date-picker-overlay')
export class EcoseeDatePickerOverlay extends LitElement {
  /** The currently-selected date, highlighted in the grid. */
  @property({ attribute: false }) value?: Date;
  /** The latest selectable date (today, for Furnace Filter's "no future
   *  last-changed date" rule) — days after it render disabled, and month
   *  navigation can't go past its month. Absent ⇒ no upper bound. */
  @property({ attribute: false }) max?: Date;
  /** The picker's own title, e.g. "Last Changed" — a `@property`, not a
   *  hardcoded string, so a second consumer doesn't need to fork this
   *  component. Named `label`, not `title` — the latter shadows
   *  `HTMLElement.prototype.title` (the native tooltip attribute). */
  @property({ attribute: false }) label = 'Date';

  /** Which month is currently displayed — independent of `value` once the
   *  user starts navigating, matching a normal calendar picker. */
  @state() private _viewYear = 0;
  @state() private _viewMonth = 0;

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .picker {
      container-type: inline-size;
      box-sizing: border-box;
      width: var(--ecosee-base-size, 460px);
      height: var(--ecosee-base-size, 460px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: calc(4 * var(--ecosee-u, 4.6px));
      padding: calc(9 * var(--ecosee-u, 4.6px)) calc(8 * var(--ecosee-u, 4.6px))
        calc(7 * var(--ecosee-u, 4.6px));
      text-align: center;
    }

    .title {
      margin: 0;
      font-size: 7.5cqw;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--ecosee-text-accent, #62cfe9);
    }

    .month-header {
      width: 100%;
      max-width: 80cqw;
      display: flex;
      align-items: center;
      justify-content: space-between;
      pointer-events: auto;
    }
    .month-label {
      font-size: 5.5cqw;
      font-weight: 600;
      color: var(--ecosee-text, #d4eff9);
    }
    .nav-btn {
      appearance: none;
      background: none;
      border: none;
      margin: 0;
      padding: 0;
      width: 7cqw;
      height: 7cqw;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--ecosee-accent, #62cfe9);
      cursor: pointer;
    }
    .nav-btn:disabled {
      color: var(--ecosee-muted, #6f96a3);
      cursor: default;
    }
    .nav-btn:focus-visible {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: 0.5cqw;
      border-radius: 2cqw;
    }
    /* A single right-pointing chevron glyph, flipped for "previous" — the same
       trick weather-overlay.ts's own page pager uses. */
    .chev {
      width: 5cqw;
      height: 5cqw;
    }
    .chev.prev {
      transform: scaleX(-1);
    }

    .weekday-row {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(7, 1fr);
    }
    .weekday {
      font-size: 3.6cqw;
      font-weight: 600;
      color: var(--ecosee-muted, #6f96a3);
    }

    .weeks {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 1.2cqw;
      pointer-events: auto;
    }
    .week {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      justify-items: center;
    }

    /* A day cell groups the tappable circle with its own today-dot slot
       beneath, so the dot's reserved space doesn't add height only some rows
       carry — every week row is the same height whether or not it holds
       today (schedule-overlay.ts's own day-strip uses the identical trick). */
    .day-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6cqw;
    }
    .day,
    .day-blank {
      width: 9cqw;
      height: 9cqw;
    }
    .day {
      appearance: none;
      background: none;
      border: none;
      margin: 0;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font: inherit;
      font-size: 4.4cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
      cursor: pointer;
    }
    /* --ecosee-chip-ink, not --ecosee-bg, so a custom canvas background
       (config background_color) can't make this text illegible. */
    .day.selected {
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
    }
    .day.disabled {
      color: var(--ecosee-muted, #6f96a3);
      cursor: default;
    }
    .today-dot {
      width: 1.4cqw;
      height: 1.4cqw;
      border-radius: 50%;
      background: var(--ecosee-accent, #62cfe9);
    }
    .today-dot.hidden {
      visibility: hidden;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    // Open on the selected value's own month (or today, if there's nothing
    // selected yet) — a property, not yet set at construction time.
    const seed = this.value ?? new Date();
    this._viewYear = seed.getFullYear();
    this._viewMonth = seed.getMonth();
  }

  private get _canGoNext(): boolean {
    const max = this.max;
    if (!max) return true;
    return this._viewYear < max.getFullYear() || this._viewMonth < max.getMonth();
  }

  private _shiftMonth(delta: number): void {
    const next = new Date(this._viewYear, this._viewMonth + delta, 1);
    this._viewYear = next.getFullYear();
    this._viewMonth = next.getMonth();
  }

  private _selectDay(date: Date): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-date-picker-confirm', {
        detail: { date },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderDay(day: CalendarDay, today: Date): TemplateResult {
    if (!day.inCurrentMonth) {
      return html`
        <div class="day-col">
          <span class="day-blank" aria-hidden="true"></span>
          <span class="today-dot hidden" aria-hidden="true"></span>
        </div>
      `;
    }
    const disabled = this.max ? isAfterDay(day.date, this.max) : false;
    const selected = this.value ? isSameDay(day.date, this.value) : false;
    const isToday = isSameDay(day.date, today);
    const dayNumber = day.date.getDate();
    return html`
      <div class="day-col">
        <button
          type="button"
          class="day ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}"
          ?disabled=${disabled}
          aria-label=${isToday ? `${dayNumber}, today` : `${dayNumber}`}
          aria-pressed=${selected}
          @click=${() => this._selectDay(day.date)}
        >
          ${dayNumber}
        </button>
        <span class="today-dot ${isToday ? '' : 'hidden'}" aria-hidden="true"></span>
      </div>
    `;
  }

  override render(): TemplateResult {
    const monthLabel = new Date(this._viewYear, this._viewMonth, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
    const weeks = buildCalendarGrid(this._viewYear, this._viewMonth);
    const today = new Date();
    return html`
      <div class="picker">
        <h2 class="title">${this.label}</h2>
        <div class="month-header">
          <button
            type="button"
            class="nav-btn"
            aria-label="Previous month"
            @click=${() => this._shiftMonth(-1)}
          >
            <span class="chev prev">${icons.chevron}</span>
          </button>
          <span class="month-label">${monthLabel}</span>
          <button
            type="button"
            class="nav-btn"
            aria-label="Next month"
            ?disabled=${!this._canGoNext}
            @click=${() => this._shiftMonth(1)}
          >
            <span class="chev">${icons.chevron}</span>
          </button>
        </div>
        <div class="weekday-row" aria-hidden="true">
          ${WEEKDAY_LABELS.map((label) => html`<span class="weekday">${label}</span>`)}
        </div>
        <div class="weeks">
          ${weeks.map(
            (week) =>
              html`<div class="week">${week.map((day) => this._renderDay(day, today))}</div>`,
          )}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-date-picker-overlay': EcoseeDatePickerOverlay;
  }
  interface HTMLElementEventMap {
    'ecosee-date-picker-confirm': CustomEvent<{ date: Date }>;
  }
}
