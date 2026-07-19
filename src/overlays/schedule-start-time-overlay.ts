import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * `<ecosee-schedule-start-time-overlay>` — the Start Time picker reached by
 * tapping an editable block on the Schedule sub-screen (ADR-0014), matching the
 * ecobee app's own "<Comfort Setting> Start Time" screen (owner-supplied
 * reference): a short explainer, "What time should <Comfort Setting> start on
 * <Day>?", a time field, and a "Remove from schedule" action.
 *
 * Tapping the time field pushes ecosee's own time-picker Overlay on top
 * (`time-picker-overlay.ts`, ADR-0018); the host applies the write and pops
 * both levels back to Schedule once that picker confirms — the host owns the
 * nav-stack pop itself, rather than this element (or the nested picker)
 * auto-closing on a timer, since the write is a real network round trip
 * rather than an instant local commit.
 *
 * Purely presentational: it owns no schedule-editing logic itself (schedule.ts's
 * `moveBlockStart` / `removeBlock` do the actual repaint-footprint math) and
 * emits `ecosee-time-picker-open` / `ecosee-schedule-block-remove` for the
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

    /* Cyan-outlined time field. Tapping it pushes ecosee's own time-picker
       Overlay (time-picker-overlay.ts, ADR-0018) — there is no native time
       input involved at all anymore. */
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

  /** `.pill-button`'s click handler — asks the host to push ecosee's own
   *  time-picker Overlay on top (ADR-0018); the write itself happens at the
   *  host level once the picker confirms (see the class doc comment). */
  private _openTimePicker(): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-time-picker-open', {
        detail: { target: 'schedule-start-time' },
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
    'ecosee-schedule-block-remove': CustomEvent<void>;
    'ecosee-schedule-day-select': CustomEvent<{ dayIndex: number }>;
    'ecosee-schedule-block-select': CustomEvent<{ blockIndex: number }>;
  }
}
