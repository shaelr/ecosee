import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { setNumberValueCall } from '../climate/comfort-setpoint';
import type { FilterIntervalEdit, IntervalOption } from '../climate/furnace-filter';
import { emitServiceCall } from './service-call-event';
import { reschedulePickerClose } from './overlay-dismiss';

/**
 * `<ecosee-filter-interval-overlay>` — the Furnace Filter Interval picker,
 * reached by tapping the Interval pill on the Furnace Filter section.
 * Structurally identical to `system-mode-overlay.ts` (a single cyan-outlined
 * segmented list, one row per discrete value) — this is the same
 * already-proven "tap a pill → push a list → tap a row → write and
 * auto-close" shape applied to a fourth field, not a new interaction (owner
 * request, following the ADR-0018 date/time pickers: apply the same custom-
 * styled treatment to the remaining native `<select>` menus).
 *
 * Owns no lasting edit state. Choosing an interval is a single discrete
 * write (`number.set_value`, `setNumberValueCall` — the exact call the
 * native `<select>` version made): it highlights the chosen row
 * optimistically on tap (`_pending`, matching System Mode's own issue #38
 * treatment), emits the shared `ecosee-service-call`, then auto-closes after
 * a brief confirm beat (issue #39), returning to the Furnace Filter section.
 */
@customElement('ecosee-filter-interval-overlay')
export class EcoseeFilterIntervalOverlay extends LitElement {
  /** The interval options + entity to write to, derived by the host card
   *  from `toFurnaceFilterModel(...).intervalEdit`. */
  @property({ attribute: false }) model?: FilterIntervalEdit;
  /** The optimistically-chosen value, set on tap so the highlight moves
   *  before the device echoes back; `null` until a pick. Doubles as the "a
   *  pick is settling" guard until the overlay auto-closes. */
  @state() private _pending: number | null = null;
  /** Handle for the pending auto-close, cancelled if the overlay is torn
   *  down first. */
  private _closeTimer?: ReturnType<typeof setTimeout>;

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
      align-items: center;
      justify-content: center;
      padding: calc(10 * var(--ecosee-u, 4.6px));
    }

    .list {
      width: 64cqw;
      max-height: 80cqw;
      overflow: hidden auto;
      border: 0.6cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 6cqw;
      pointer-events: auto;
      /* Hide the OS scrollbar track — still scrollable by touch/wheel/drag
         either way, just without browser chrome bleeding through the
         device's own squircle silhouette. */
      scrollbar-width: none;
    }
    .list::-webkit-scrollbar {
      display: none;
    }

    .option {
      appearance: none;
      background: none;
      margin: 0;
      box-sizing: border-box;
      width: 100%;
      padding: 5.5cqw 4cqw;
      font: inherit;
      font-size: 8cqw;
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

    .option.selected {
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
      cursor: default;
    }
  `;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._closeTimer !== undefined) clearTimeout(this._closeTimer);
  }

  private _select(option: IntervalOption, entityId: string): void {
    if (this._pending === option.value) return; // already the settling pick — nothing to do
    const noChange = this._pending === null && option.selected;
    this._pending = option.value; // move / hold the highlight now
    if (!noChange) emitServiceCall(this, setNumberValueCall(entityId, option.value));
    this._closeTimer = reschedulePickerClose(this, this._closeTimer); // confirm beat, then close
  }

  override render(): TemplateResult | typeof nothing {
    const model = this.model;
    if (!model) return nothing;
    return html`
      <div class="picker">
        <div class="list" role="group" aria-label="Filter replacement interval">
          ${model.options.map((option) => {
            const selected =
              this._pending !== null ? option.value === this._pending : option.selected;
            return html`
              <button
                class="option ${selected ? 'selected' : ''}"
                aria-pressed=${selected}
                @click=${() => this._select(option, model.entityId)}
              >
                ${option.label}
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-filter-interval-overlay': EcoseeFilterIntervalOverlay;
  }
  interface HTMLElementEventMap {
    /** Emitted by the Furnace Filter section's Interval pill — not by this
     *  component itself — asking the host to push this picker. */
    'ecosee-filter-interval-open': CustomEvent<void>;
  }
}
