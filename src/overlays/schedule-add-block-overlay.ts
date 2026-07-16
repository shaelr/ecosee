import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
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

    /* max-height + scroll is a safety net, not the normal case: the three rows
       fit comfortably on their own, but this guarantees a wider comfort-setting
       label or different font metrics push the *list* into scrolling instead of
       pushing .confirm past the picker's fixed box — .confirm sits below via
       margin-top: auto, and an element with an explicit height doesn't resize to
       its children, so an overflow here would clip at the shell's edge, not
       visibly shrink anything (matching the day-checklist fix in
       schedule-copy-overlay.ts's own .days). */
    .fields {
      width: 100%;
      max-height: 40cqw;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2.5cqw;
      margin-top: 1cqw;
      overflow-y: auto;
      scrollbar-width: none;
    }
    .fields::-webkit-scrollbar {
      display: none;
    }
    .field-row {
      width: 100%;
      max-width: 78cqw;
      flex: none;
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

    /* Cyan-outlined value pill; a transparent native control (select or time
       input) is layered over it to capture taps/input while the visible label +
       caret ride on top — the same technique fan-overlay.ts's runtime dropdown
       uses. Opts back into pointer events (the shell makes slotted content
       transparent so empty areas dismiss). */
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
    .pill select,
    .pill input {
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
    .pill:focus-within {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: 0.6cqw;
    }
    .select-native option {
      color: var(--ecosee-text, #d4eff9);
      background: var(--ecosee-bg, #0a0d10);
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
              <span class="pill-label">${this._timeString(this._startMinutes)}</span>
              <input
                type="time"
                step="1800"
                .value=${this._timeString(this._startMinutes)}
                aria-label="Start time"
                @change=${this._onStartChange}
              />
            </span>
          </div>
          <div class="field-row">
            <span class="field-label">End</span>
            <span class="pill">
              <span class="pill-label">${this._timeString(this._endMinutes)}</span>
              <input
                type="time"
                step="1800"
                .value=${this._timeString(this._endMinutes)}
                aria-label="End time"
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
