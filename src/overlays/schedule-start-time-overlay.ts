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

    /* Cyan-outlined time field: a visible label rides on top while a
       transparent native <input type=time> covers the whole field to capture
       the tap — the same technique schedule-add-block-overlay.ts's Start/End
       fields and the Comfort Setting/Interval dropdowns elsewhere use. A tap
       anywhere on the field lands directly on the real input, giving it
       genuine focus, which is what actually opens the picker on iOS (it ties
       its native picker sheet to real focus, not to any particular API call).
       A version of this field routed the tap through a separate visible
       <button> whose click handler called the hidden input's showPicker()
       instead — that worked on desktop Chrome/Firefox/Safari, but showPicker()
       is unimplemented for date/time inputs on iOS WebKit (only file inputs
       support it there — WebKit bug 261703, open since 2023), so the button
       never opened anything on an iPhone. */
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
    .pill-label {
      font-size: 6.5cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
      pointer-events: none;
    }
    .field input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      border: none;
      appearance: none;
      -webkit-appearance: none;
      background: none;
      color: transparent;
      font: inherit;
      opacity: 0;
      cursor: pointer;
      pointer-events: auto;
    }
    /* Flush against the field's own border (no outline-offset) so a focused
       field reads as its border getting thicker, not a second detached ring
       floating outside it. */
    .field:focus-within {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: 0;
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
          <span class="pill-label">${value}</span>
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
