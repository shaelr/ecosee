import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state, queryAll } from 'lit/decorators.js';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 30];

/**
 * `<ecosee-time-picker-overlay>` — ecosee's own time picker (ADR-0018), replacing
 * the browser's native `<input type="time">` picker everywhere ecosee edits a
 * time value (Schedule's Start/End when adding a block, and a block's own Start
 * Time when editing it). Two independent scrollable columns — Hour (00–23) and
 * Minute (00/30, matching the schedule's own 30-minute grid) — plus an explicit
 * Confirm button: two independent selections can't cleanly auto-confirm on a
 * single tap the way a one-column picker (System Mode, Comfort Setting) can,
 * since picking only the hour or only the minute isn't yet a complete value.
 *
 * Purely presentational: it owns no schedule-editing logic itself and emits
 * `ecosee-time-picker-confirm` for the host to apply. There is no cancel
 * affordance of its own — the shell's own ✕ is the only dismiss path, matching
 * every other Overlay.
 */
@customElement('ecosee-time-picker-overlay')
export class EcoseeTimePickerOverlay extends LitElement {
  /** Seed value: minutes since local midnight. */
  @property({ attribute: false }) minutes = 0;

  @state() private _hour = 0;
  @state() private _minute = 0;

  /** Both columns' currently-selected row, so the picker can scroll to the
   *  seeded value once on first render rather than always opening at the top
   *  of a 24-row hour list. */
  @queryAll('.option.selected') private _selectedOptions!: NodeListOf<HTMLElement>;

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
      gap: calc(5 * var(--ecosee-u, 4.6px));
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

    .columns {
      width: 100%;
      display: flex;
      justify-content: center;
      gap: 5cqw;
      pointer-events: auto;
    }
    .column {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2cqw;
    }
    .column-label {
      font-size: 4.4cqw;
      font-weight: 500;
      color: var(--ecosee-text, #d4eff9);
    }

    /* The scrollable column itself — the same cyan-outlined, vertically-clipped
       list comfort-setting-overlay.ts's own picker uses, narrowed to fit two
       side by side. overflow: hidden auto (not a bare overflow-y) pins the
       x-axis so a column never grows a horizontal scrollbar of its own. */
    .list {
      width: 28cqw;
      max-height: 62cqw;
      overflow: hidden auto;
      border: 0.6cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 6cqw;
      pointer-events: auto;
    }
    .option {
      appearance: none;
      background: none;
      margin: 0;
      box-sizing: border-box;
      width: 100%;
      padding: 4cqw 2cqw;
      font: inherit;
      font-size: 6.5cqw;
      font-weight: 500;
      color: var(--ecosee-text-accent, #62cfe9);
      text-align: center;
      cursor: pointer;
      border: none;
      border-top: 0.4cqw solid color-mix(in srgb, var(--ecosee-accent, #62cfe9) 30%, transparent);
    }
    .option:first-child {
      border-top: none;
    }
    .option:focus-visible {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: -1.5cqw;
    }
    /* Selected row: filled cyan with dark text, matching every other picker's
       selected-row treatment (system-mode-overlay.ts, comfort-setting-overlay.ts). */
    .option.selected {
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
      cursor: default;
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
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    // Seed the buffered selection once from the incoming value — a property,
    // not yet set at construction time, mirroring every other picker's own
    // "default on connect" pattern (schedule-add-block-overlay.ts's Comfort
    // Setting default, etc.).
    this._hour = Math.floor(this.minutes / 60);
    this._minute = this.minutes % 60;
  }

  /** Scrolls both columns to their seeded value once, so the picker opens
   *  centered on the current time rather than always at the top of a 24-row
   *  hour list. Only on first render — a later tap re-renders the selected
   *  row too, but re-scrolling the user's view mid-interaction would be
   *  unwanted. */
  protected override firstUpdated(): void {
    for (const option of this._selectedOptions) {
      option.scrollIntoView({ block: 'center' });
    }
  }

  private _selectHour(hour: number): void {
    this._hour = hour;
  }

  private _selectMinute(minute: number): void {
    this._minute = minute;
  }

  private _confirm(): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-time-picker-confirm', {
        detail: { minutes: this._hour * 60 + this._minute },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render(): TemplateResult {
    return html`
      <div class="picker">
        <h2 class="title">Time</h2>
        <div class="columns">
          <div class="column">
            <span class="column-label">Hour</span>
            <div class="list" role="listbox" aria-label="Hour">
              ${HOURS.map(
                (hour) => html`
                  <button
                    type="button"
                    class="option ${hour === this._hour ? 'selected' : ''}"
                    role="option"
                    aria-selected=${hour === this._hour}
                    @click=${() => this._selectHour(hour)}
                  >
                    ${String(hour).padStart(2, '0')}
                  </button>
                `,
              )}
            </div>
          </div>
          <div class="column">
            <span class="column-label">Minute</span>
            <div class="list" role="listbox" aria-label="Minute">
              ${MINUTES.map(
                (minute) => html`
                  <button
                    type="button"
                    class="option ${minute === this._minute ? 'selected' : ''}"
                    role="option"
                    aria-selected=${minute === this._minute}
                    @click=${() => this._selectMinute(minute)}
                  >
                    ${String(minute).padStart(2, '0')}
                  </button>
                `,
              )}
            </div>
          </div>
        </div>
        <button class="confirm" @click=${this._confirm}>Confirm</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-time-picker-overlay': EcoseeTimePickerOverlay;
  }
  interface HTMLElementEventMap {
    'ecosee-time-picker-confirm': CustomEvent<{ minutes: number }>;
    /** Emitted by whichever field wants to edit a time value (Add to
     *  Schedule's Start/End, a schedule block's own Start Time) — not by
     *  this component itself, but declared here as the single source of
     *  truth for the shared shape every emitter uses. `target` identifies
     *  which field the host should route the eventual confirm back into. */
    'ecosee-time-picker-open': CustomEvent<{
      target: 'add-block-start' | 'add-block-end' | 'schedule-start-time';
    }>;
  }
}
