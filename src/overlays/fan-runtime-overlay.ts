import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { setFanMinOnTimeCall, type MinRuntimeModel, type MinRuntimeOption } from '../climate/fan';
import { emitServiceCall } from './service-call-event';
import { reschedulePickerClose } from './overlay-dismiss';

/**
 * `<ecosee-fan-runtime-overlay>` — the Fan screen's minimum-runtime picker,
 * reached by tapping the runtime pill. Structurally identical to
 * `system-mode-overlay.ts` (a single cyan-outlined segmented list, one row
 * per discrete value) — the same already-proven "tap a pill → push a list →
 * tap a row → write and auto-close" shape applied here, not a new
 * interaction (owner request, following the ADR-0018 date/time pickers).
 *
 * The runtime selector used to be a native `<select>` that stayed inline on
 * the Fan screen rather than closing it — the class doc comment there
 * explained that as "a secondary setting... closing on a native-select
 * change would be jarring." Neither reason applies to a pushed picker: it
 * closes *itself*, popping back to the still-mounted Fan screen underneath,
 * exactly like every other picker in this app.
 *
 * Owns no lasting edit state. Choosing a runtime is a single discrete write
 * (`number.set_value`, `setFanMinOnTimeCall` — the exact call the native
 * `<select>` version made): optimistic highlight on tap, `ecosee-service-call`,
 * confirm-beat auto-close back to Fan.
 */
@customElement('ecosee-fan-runtime-overlay')
export class EcoseeFanRuntimeOverlay extends LitElement {
  /** The runtime options + entity to write to, derived by the host card
   *  from `toFanModel(...).minRuntime`. */
  @property({ attribute: false }) model?: MinRuntimeModel;
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

  private _select(option: MinRuntimeOption, entityId: string): void {
    if (this._pending === option.value) return; // already the settling pick — nothing to do
    const noChange = this._pending === null && option.selected;
    this._pending = option.value; // move / hold the highlight now
    if (!noChange) emitServiceCall(this, setFanMinOnTimeCall(option.value, entityId));
    this._closeTimer = reschedulePickerClose(this, this._closeTimer); // confirm beat, then close
  }

  override render(): TemplateResult | typeof nothing {
    const model = this.model;
    if (!model) return nothing;
    return html`
      <div class="picker">
        <div class="list" role="group" aria-label="Minimum fan runtime">
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
    'ecosee-fan-runtime-overlay': EcoseeFanRuntimeOverlay;
  }
  interface HTMLElementEventMap {
    /** Emitted by the Fan screen's runtime pill — not by this component
     *  itself — asking the host to push this picker. */
    'ecosee-fan-runtime-open': CustomEvent<void>;
  }
}
