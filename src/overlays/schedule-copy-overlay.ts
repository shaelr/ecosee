import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/** One selectable target day in the "Copy Schedule" list. */
export interface CopyDayOption {
  index: number;
  label: string;
}

/**
 * `<ecosee-schedule-copy-overlay>` — the "Copy schedule to another day" flow
 * reached from the Schedule sub-screen (ADR-0014): a multi-select list of the
 * other six days of the week, and a Copy action that paints the source day's
 * whole arrangement onto every day checked (schedule.ts's `copyDayCalls` — one
 * `calendar.create_event` per source block, per target day; overwrites each
 * target day entirely, the same paint-only model every Schedule write uses).
 *
 * Purely presentational: it owns no schedule-editing logic itself and emits
 * `ecosee-schedule-copy-confirm` with the checked day indices for the host to
 * apply.
 */
@customElement('ecosee-schedule-copy-overlay')
export class EcoseeScheduleCopyOverlay extends LitElement {
  /** The day being copied FROM, e.g. "Thursday". */
  @property({ attribute: false }) sourceDayLabel = '';
  /** The other six days of the week (the source day is excluded upstream —
   *  copying a day onto itself is a no-op with nothing to confirm). */
  @property({ attribute: false }) days: CopyDayOption[] = [];

  @state() private _selected = new Set<number>();

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
    .subtitle {
      margin: 0;
      font-size: 4.8cqw;
      font-weight: 400;
      color: var(--ecosee-text, #d4eff9);
    }

    /* The day checklist — six rows don't fit the remaining canvas height
       alongside the title/subtitle/confirm button, so it scrolls internally
       (matching the Schedule agenda's own .agenda) rather than pushing the
       confirm button off-canvas or clipping the last rows unreachably. Opts
       back into pointer events (the shell makes slotted content transparent
       so empty areas dismiss). */
    .days {
      width: 100%;
      max-width: 78cqw;
      max-height: 42cqw;
      display: flex;
      flex-direction: column;
      gap: 2cqw;
      margin-top: 1cqw;
      overflow-y: auto;
      pointer-events: auto;
      scrollbar-width: none;
    }
    .days::-webkit-scrollbar {
      display: none;
    }
    .day {
      appearance: none;
      background: none;
      box-sizing: border-box;
      flex: none;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 3cqw;
      padding: 2.8cqw 4.5cqw;
      border: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 100cqw;
      font: inherit;
      font-size: 5cqw;
      font-weight: 500;
      color: var(--ecosee-text-accent, #62cfe9);
      cursor: pointer;
    }
    /* --ecosee-chip-ink, not --ecosee-bg, so a custom canvas background (config
       background_color) can't make this text illegible. */
    .day.checked {
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
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

  private _toggle(index: number): void {
    const next = new Set(this._selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    this._selected = next;
  }

  private _confirm(): void {
    if (this._selected.size === 0) return;
    this.dispatchEvent(
      new CustomEvent('ecosee-schedule-copy-confirm', {
        detail: { targetDayIndices: [...this._selected] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render(): TemplateResult {
    return html`
      <div class="picker">
        <h2 class="title">Copy Schedule</h2>
        <p class="subtitle">Copy ${this.sourceDayLabel}'s schedule to:</p>
        <div class="days" role="group" aria-label="Target days">
          ${this.days.map((day) => {
            const checked = this._selected.has(day.index);
            return html`
              <button
                class="day ${checked ? 'checked' : ''}"
                role="checkbox"
                aria-checked=${checked}
                @click=${() => this._toggle(day.index)}
              >
                ${day.label}
              </button>
            `;
          })}
        </div>
        <button class="confirm" ?disabled=${this._selected.size === 0} @click=${this._confirm}>
          Copy
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-schedule-copy-overlay': EcoseeScheduleCopyOverlay;
  }
  interface HTMLElementEventMap {
    'ecosee-schedule-copy-confirm': CustomEvent<{ targetDayIndices: number[] }>;
  }
}
