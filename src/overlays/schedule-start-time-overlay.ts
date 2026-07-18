import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { snapToSlot } from '../schedule/schedule';

/**
 * `<ecosee-schedule-start-time-overlay>` — the Start Time picker reached by
 * tapping an editable block on the Schedule sub-screen (ADR-0014), matching the
 * ecobee app's own "<Comfort Setting> Start Time" screen (owner-supplied
 * reference): a short explainer, "What time should <Comfort Setting> start on
 * <Day>?", a time field, and a "Remove from schedule" action.
 *
 * Like the other discrete-choice pickers (System Mode, Comfort Setting, Fan), a
 * time change is a single write that returns to the Schedule sub-screen — the
 * host pops the nav stack itself once the write (and the day's re-fetch) lands,
 * rather than this element auto-closing on a timer, since the write is a real
 * network round trip rather than an instant local commit.
 *
 * Purely presentational: it owns no schedule-editing logic itself (schedule.ts's
 * `moveBlockStart` / `removeBlock` do the actual repaint-footprint math) and
 * emits `ecosee-schedule-time-confirm` / `ecosee-schedule-block-remove` for the
 * host to apply.
 */
@customElement('ecosee-schedule-start-time-overlay')
export class EcoseeScheduleStartTimeOverlay extends LitElement {
  /** The block's own comfort setting name, e.g. "Sleep". */
  @property({ attribute: false }) comfortSetting = '';
  /** The selected day's full name, e.g. "Thursday" — mirrors the reference
   *  screen's own "on Thursday?" phrasing. */
  @property({ attribute: false }) dayLabel = '';
  /** The block's current start time, in minutes since local midnight. */
  @property({ attribute: false }) startMinutes = 0;
  /** False when there is no in-day preceding block to merge into (schedule.ts's
   *  `removeBlock` would no-op) — hides the removal action rather than offering
   *  a control that can't do anything. */
  @property({ attribute: false }) canRemove = false;

  /** The tiny, genuinely-invisible `<input type="time">` `.pill-button`'s click
   *  handler triggers `showPicker()` on — see `.time-native`'s own CSS doc comment
   *  and schedule-add-block-overlay.ts's identical split (itself mirroring
   *  furnace-filter-overlay.ts's `.date-native` pattern for the same reason). */
  @query('.time-native') private _timeInput?: HTMLInputElement;

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
      gap: calc(6 * var(--ecosee-u, 4.6px));
      /* Top padding lines the title's own vertical center up with the shell's ✕
         (top: 9u, 9u tall — vertical center 13.5u from the content box's top). */
      padding: calc(9 * var(--ecosee-u, 4.6px)) calc(8 * var(--ecosee-u, 4.6px))
        calc(9 * var(--ecosee-u, 4.6px));
      text-align: center;
    }

    .title {
      margin: 0;
      font-size: 7.5cqw;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--ecosee-text-accent, #62cfe9);
    }
    .hint {
      margin: 0;
      font-size: 4.6cqw;
      font-weight: 400;
      line-height: 1.35;
      color: var(--ecosee-text, #d4eff9);
    }
    .question {
      margin: 0;
      font-size: 5.2cqw;
      font-weight: 500;
      color: var(--ecosee-text-accent, #62cfe9);
    }

    /* Cyan-outlined time field. Tapping it opens the platform's own time picker
       via showPicker() (below) rather than relying on a native <input type=time>
       styled in place — an earlier version of this pattern (used on Add to
       Schedule's Start/End fields until it was replaced) found that an invisible
       full-cover time input only focuses whatever internal segment happens to sit
       under the pointer, with no visible chrome to show which segment that is,
       reading as "tapping does nothing." A real button always has something to
       tap. */
    .field {
      box-sizing: border-box;
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 3cqw 6cqw;
      border: 0.6cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 100cqw;
      pointer-events: auto;
    }
    /* An ordinary opaque <button> carrying the field's own visual look — not a
       styled label with an invisible native time input layered on top. Tapping
       it calls .time-native's showPicker() (below) explicitly, opening the
       browser's own time picker. Mirrors schedule-add-block-overlay.ts's
       identical pill-button/time-native split. */
    .pill-button {
      appearance: none;
      background: none;
      border: none;
      margin: 0;
      padding: 0;
      font: inherit;
      font-size: 6.5cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
      text-align: center;
      cursor: pointer;
    }
    /* Flush against the field's own border (no outline-offset) so a focused
       field reads as its border getting thicker, not a second detached ring
       floating outside it. */
    .field:focus-within {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: 0;
    }
    /* The actual <input type="time"> backing the button above: genuinely tiny
       and invisible, never the tap target and never directly focused by a user
       (tabindex="-1", aria-hidden="true"); .pill-button's click handler calls
       its showPicker() explicitly. */
    .time-native {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 1px;
      height: 1px;
      margin: 0;
      padding: 0;
      border: none;
      opacity: 0;
      pointer-events: none;
    }

    .remove {
      appearance: none;
      background: none;
      border: none;
      margin-top: auto;
      padding: 2cqw;
      font: inherit;
      font-size: 5cqw;
      font-weight: 600;
      color: var(--ecosee-heat, #f3a13c);
      cursor: pointer;
      pointer-events: auto;
    }
  `;

  /** `.pill-button`'s click handler — explicitly opens the native time picker
   *  on the hidden `.time-native` input, rather than relying on a tap landing
   *  on a visible form control (there is none, by design — see `.pill-button`'s
   *  own CSS doc comment). showPicker (Baseline 2023 — Chrome/Edge 99+, Safari
   *  16.4+, Firefox 101+) is declared on TypeScript's own HTMLInputElement type
   *  but not guaranteed present at runtime on an older engine, hence the
   *  explicit existence check rather than a bare call; wrapped in try/catch too
   *  since it can throw (rate-limited, not a genuine user gesture) — either way
   *  there's simply nothing to open in that case. */
  private _openTimePicker(): void {
    const input = this._timeInput;
    if (!input || typeof input.showPicker !== 'function') return;
    try {
      input.showPicker();
    } catch {
      // See doc comment above — no recovery needed.
    }
  }

  private _onTimeChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value; // "HH:MM"
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return;
    const minutes = snapToSlot(Number(match[1]) * 60 + Number(match[2]));
    if (minutes === this.startMinutes) return;
    this.dispatchEvent(
      new CustomEvent('ecosee-schedule-time-confirm', {
        detail: { minutes },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _remove(): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-schedule-block-remove', { bubbles: true, composed: true }),
    );
  }

  override render(): TemplateResult {
    const hours = Math.floor(this.startMinutes / 60);
    const minutes = this.startMinutes % 60;
    const value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    return html`
      <div class="picker">
        <h2 class="title">${this.comfortSetting} Start Time</h2>
        <p class="hint">
          Moves the ${this.comfortSetting} comfort setting's start time on ${this.dayLabel} — the
          block before it shrinks or grows to fill the gap.
        </p>
        <p class="question">What time should ${this.comfortSetting} start on ${this.dayLabel}?</p>
        <div class="field">
          <button
            type="button"
            class="pill-button"
            aria-label="Start time, ${value}"
            @click=${this._openTimePicker}
          >
            ${value}
          </button>
          <input
            class="time-native"
            type="time"
            step="1800"
            tabindex="-1"
            aria-hidden="true"
            .value=${value}
            @change=${this._onTimeChange}
          />
        </div>
        ${
          this.canRemove
            ? html`<button class="remove" @click=${this._remove}>Remove from schedule</button>`
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-schedule-start-time-overlay': EcoseeScheduleStartTimeOverlay;
  }
  interface HTMLElementEventMap {
    'ecosee-schedule-time-confirm': CustomEvent<{ minutes: number }>;
    'ecosee-schedule-block-remove': CustomEvent<void>;
    'ecosee-schedule-day-select': CustomEvent<{ dayIndex: number }>;
    'ecosee-schedule-block-select': CustomEvent<{ blockIndex: number }>;
  }
}
