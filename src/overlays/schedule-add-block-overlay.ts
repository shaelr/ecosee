import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import type { ComfortSettingOption } from '../climate/comfort-setting';
import { icons } from '../icons';

/**
 * `<ecosee-schedule-add-block-overlay>` — the "+" flow reached from the Schedule
 * sub-screen (ADR-0014): pick a Comfort Setting and a start/end time, and a new
 * block is painted onto the selected day. Whatever block(s) currently occupy
 * that range are implicitly trimmed to make room (schedule.ts's `addBlockCall`
 * — the same paint-repaints-only-its-own-footprint model every Schedule write
 * uses), so there is no separate "make space" step here.
 *
 * A new block is deliberately same-day only (no wrapping past midnight) —
 * matching the two plain time fields below, and keeping this flow to a single
 * screen rather than needing a day picker of its own on top of Schedule's.
 * Purely presentational: it owns no schedule-editing logic itself and emits
 * `ecosee-schedule-add-block-confirm` for the host to apply.
 */
@customElement('ecosee-schedule-add-block-overlay')
export class EcoseeScheduleAddBlockOverlay extends LitElement {
  /** The bound entity's Comfort Settings, reused as-is from the Comfort Setting
   *  picker's own model (`selected` is ignored here — a new block starts with
   *  no comfort setting chosen yet, the first option winning by default, the
   *  same way an unset native `<select>` falls back to its first `<option>`). */
  @property({ attribute: false }) comfortSettings: ComfortSettingOption[] = [];
  /** The selected day's full name, e.g. "Thursday" — mirrors the Start Time
   *  picker's own day-scoped phrasing. */
  @property({ attribute: false }) dayLabel = '';

  @state() private _comfortSetting = '';
  @state() private _startMinutes = 8 * 60; // 08:00, a reasonable default window…
  @state() private _endMinutes = 10 * 60; // …through 10:00.

  /** The tiny, genuinely-invisible `<input type="time">` elements `.pill-button`
   *  clicks trigger `showPicker()` on — see `.time-native`'s own CSS doc comment
   *  and furnace-filter-overlay.ts's identical `.date-native` pattern. */
  @query('.start-native') private _startInput?: HTMLInputElement;
  @query('.end-native') private _endInput?: HTMLInputElement;

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
      gap: calc(3.5 * var(--ecosee-u, 4.6px));
      padding: calc(9 * var(--ecosee-u, 4.6px)) calc(8 * var(--ecosee-u, 4.6px))
        calc(7 * var(--ecosee-u, 4.6px));
      text-align: center;
    }

    .title {
      margin: 0;
      font-size: 6.5cqw;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--ecosee-text-accent, #62cfe9);
    }
    .subtitle {
      margin: 0;
      font-size: 4.4cqw;
      font-weight: 500;
      color: var(--ecosee-text, #d4eff9);
    }

    .fields {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2.5cqw;
      margin-top: 1cqw;
    }
    .field-row {
      width: 100%;
      max-width: 78cqw;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 3cqw;
    }
    .field-label {
      font-size: 4.8cqw;
      font-weight: 500;
      color: var(--ecosee-text, #d4eff9);
    }

    /* Cyan-outlined value pill. Comfort Setting keeps a transparent native
       <select> layered over it to capture taps (fan-overlay.ts's runtime
       dropdown uses the same technique — a <select> opens its native list
       from a tap anywhere in its box, so an invisible full-cover overlay
       works reliably there). Opts back into pointer events (the shell makes
       slotted content transparent so empty areas dismiss). */
    .pill {
      position: relative;
      box-sizing: border-box;
      min-width: 30cqw;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 2cqw;
      padding: 2cqw 4cqw;
      border: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 100cqw;
      pointer-events: auto;
    }
    .pill-label {
      font-size: 5cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
      pointer-events: none;
    }
    .caret {
      width: 3.6cqw;
      height: 3.6cqw;
      flex: none;
      color: var(--ecosee-accent, #62cfe9);
      pointer-events: none;
    }
    .pill select {
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
    /* Flush against the pill's own border (no outline-offset) so a focused
       pill reads as its border getting thicker, not a second detached ring
       floating outside it (the double-outline this replaced). */
    .pill:focus-within {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: 0;
    }
    .select-native option {
      color: var(--ecosee-text, #d4eff9);
      background: var(--ecosee-bg, #0a0d10);
    }

    /* Start/End: an ordinary opaque <button> carrying the pill's own visual
       look, not a styled label with an invisible native time input layered
       on top — unlike a <select>, a tap anywhere on a time input's box only
       focuses whatever internal segment (hour/minute) happens to sit under
       the pointer, with no visible native chrome to show which segment that
       is once the input itself is invisible. A real button sidesteps that:
       tapping it calls .time-native's showPicker() (below) explicitly,
       opening the browser's own time picker. Mirrors furnace-filter-overlay.ts's
       identical pill-button/date-native split for the same reason. */
    .pill-button {
      appearance: none;
      background: none;
      border: none;
      margin: 0;
      padding: 0;
      font: inherit;
      font-size: 5cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
      cursor: pointer;
      pointer-events: auto;
    }
    /* The actual <input type="time"> backing the button above: genuinely tiny
       and invisible, never the tap target and never directly focused by a
       user (tabindex="-1", aria-hidden="true"); .pill-button's click handler
       calls its showPicker() explicitly. */
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

    .error {
      margin: 0;
      font-size: 4.4cqw;
      color: var(--ecosee-heat, #f3a13c);
      min-height: 1.4em;
    }

    .confirm {
      appearance: none;
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
      border: none;
      margin-top: auto;
      padding: 2.6cqw 8cqw;
      border-radius: 100cqw;
      font: inherit;
      font-size: 5.2cqw;
      font-weight: 600;
      cursor: pointer;
      pointer-events: auto;
    }
    .confirm:disabled {
      opacity: 0.4;
      cursor: default;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    // Default the selector to the entity's first listed Comfort Setting once
    // the model actually arrives (it's a property, not yet set at construction).
    if (!this._comfortSetting && this.comfortSettings.length > 0) {
      this._comfortSetting = this.comfortSettings[0].preset;
    }
  }

  private _timeString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  private _parseTime(value: string): number | null {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  private _onComfortChange(event: Event): void {
    this._comfortSetting = (event.target as HTMLSelectElement).value;
  }

  /** `.pill-button`'s click handler for Start/End — explicitly opens the
   *  native time picker on the hidden `.time-native` input, rather than
   *  relying on a tap landing on a visible form control (there is none, by
   *  design — see `.pill-button`'s own CSS doc comment).
   *
   *  Two calls, for two different engines: `.focus()` unconditionally first
   *  — iOS WebKit doesn't implement `showPicker()` for date/time inputs at
   *  all (WebKit bug 261703, open since 2023; only file inputs support it
   *  there) and is a silent no-op there, but ties its native picker sheet to
   *  the input receiving real focus, from *any* source, not just a raw tap —
   *  a WebKit engineer's own suggested workaround for the bug. Then
   *  showPicker() itself, feature-detected (`typeof input.showPicker ===
   *  'function'`, Baseline 2023 — Chrome/Edge 99+, Safari 16.4+, Firefox
   *  101+) and wrapped in try/catch (the spec allows it to throw when
   *  rate-limited or called outside a genuine user gesture) — it forces the
   *  picker open unconditionally on engines that support it, where
   *  `.focus()` alone would not (see furnace-filter-overlay.ts's identical
   *  split and ADR-0017's corrections for the desktop history this mirrors). */
  private _openTimePicker(input?: HTMLInputElement): void {
    if (!input) return;
    input.focus();
    if (typeof input.showPicker !== 'function') return;
    try {
      input.showPicker();
    } catch {
      // See doc comment above — no recovery needed.
    }
  }

  private _onStartChange(event: Event): void {
    const minutes = this._parseTime((event.target as HTMLInputElement).value);
    if (minutes !== null) this._startMinutes = minutes;
  }

  private _onEndChange(event: Event): void {
    const minutes = this._parseTime((event.target as HTMLInputElement).value);
    if (minutes !== null) this._endMinutes = minutes;
  }

  private _confirm(): void {
    if (this._endMinutes <= this._startMinutes || !this._comfortSetting) return;
    this.dispatchEvent(
      new CustomEvent('ecosee-schedule-add-block-confirm', {
        detail: {
          comfortSetting: this._comfortSetting,
          startMinutes: this._startMinutes,
          endMinutes: this._endMinutes,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render(): TemplateResult {
    const invalid = this._endMinutes <= this._startMinutes;
    const current = this.comfortSettings.find((option) => option.preset === this._comfortSetting);
    return html`
      <div class="picker">
        <h2 class="title">Add to Schedule</h2>
        <p class="subtitle">New block on ${this.dayLabel}</p>
        <div class="fields">
          <div class="field-row">
            <span class="field-label">Comfort Setting</span>
            <span class="pill">
              <span class="pill-label">${current?.label ?? this._comfortSetting}</span>
              <span class="caret">${icons.caretDown}</span>
              <select
                class="select-native"
                aria-label="Comfort Setting"
                .value=${this._comfortSetting}
                @change=${this._onComfortChange}
              >
                ${this.comfortSettings.map(
                  (option) => html`<option value=${option.preset}>${option.label}</option>`,
                )}
              </select>
            </span>
          </div>
          <div class="field-row">
            <span class="field-label">Start</span>
            <span class="pill">
              <button
                type="button"
                class="pill-button"
                aria-label="Start time, ${this._timeString(this._startMinutes)}"
                @click=${() => this._openTimePicker(this._startInput)}
              >
                ${this._timeString(this._startMinutes)}
              </button>
              <input
                class="time-native start-native"
                type="time"
                step="1800"
                tabindex="-1"
                aria-hidden="true"
                .value=${this._timeString(this._startMinutes)}
                @change=${this._onStartChange}
              />
            </span>
          </div>
          <div class="field-row">
            <span class="field-label">End</span>
            <span class="pill">
              <button
                type="button"
                class="pill-button"
                aria-label="End time, ${this._timeString(this._endMinutes)}"
                @click=${() => this._openTimePicker(this._endInput)}
              >
                ${this._timeString(this._endMinutes)}
              </button>
              <input
                class="time-native end-native"
                type="time"
                step="1800"
                tabindex="-1"
                aria-hidden="true"
                .value=${this._timeString(this._endMinutes)}
                @change=${this._onEndChange}
              />
            </span>
          </div>
        </div>
        <p class="error">${invalid ? 'End time must be after start time.' : ''}</p>
        <button class="confirm" ?disabled=${invalid} @click=${this._confirm}>
          Add to Schedule
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-schedule-add-block-overlay': EcoseeScheduleAddBlockOverlay;
  }
  interface HTMLElementEventMap {
    'ecosee-schedule-add-block-confirm': CustomEvent<{
      comfortSetting: string;
      startMinutes: number;
      endMinutes: number;
    }>;
  }
}
