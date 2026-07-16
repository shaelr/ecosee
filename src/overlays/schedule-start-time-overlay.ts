import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
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
      padding: calc(13 * var(--ecosee-u, 4.6px)) calc(8 * var(--ecosee-u, 4.6px))
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

    /* Cyan-outlined time field — a native <input type=time> gets the platform's
       own picker UI for free, styled to sit inside the Skin's pill language. */
    .field {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 3cqw 6cqw;
      border: 0.6cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 100cqw;
      pointer-events: auto;
    }
    .field input {
      appearance: none;
      background: none;
      border: none;
      font: inherit;
      font-size: 6.5cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
      text-align: center;
      /* Firefox otherwise renders the native time-field controls in its own
       accent color, clashing with the Skin's cyan (issue #85-adjacent — a
       cross-browser default-styling divergence, not a bug in this rule). */
      color-scheme: dark;
    }
    .field input:focus-visible {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: 0.6cqw;
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
          <input
            type="time"
            step="1800"
            .value=${value}
            aria-label="Start time"
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
