import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  formatSetpointValue,
  nudgeSetpoint,
  scrubSetpoint,
  setNumberValueCall,
  type ComfortSetpointValue,
} from '../climate/comfort-setpoint';
import { scrubberWindow, type SetpointEdit } from '../climate/temperature-adjust';
import { icons } from '../icons';
import { emitServiceCall } from './service-call-event';
import { emitOverlayDismiss } from './overlay-dismiss';

/** Neighbors shown on each side of the selected value in the scrubber, matching
 *  the Temperature Adjust overlay's own scrubber. */
const SCRUBBER_RADIUS = 2;

/** Vertical drag distance (px) that scrubs one step — same feel as the
 *  Temperature Adjust overlay's scrubber. */
const PX_PER_STEP = 22;

/** Trailing debounce before a change is written to the entity, coalescing a
 *  held ± button or a rapid scrub burst into one `number.set_value` call — the
 *  same reasoning as the Temperature Adjust overlay's own debounce: these are
 *  still ecobee cloud-backed entities, so a burst of writes risks the same
 *  rate-limit/revert behavior. */
const WRITE_DEBOUNCE_MS = 600;

/**
 * `<ecosee-comfort-setpoint-overlay>` — the single-value picker pushed from a
 * Comfort Setpoints card's Heat/Cool pill (ADR-0015). Visually and
 * interactively modeled on the Temperature Adjust overlay's scrubber (vertical
 * drag + ± nudge, a gradient squircle bubble showing the selected value with
 * dimmer neighbors above/below) but simplified for editing one independent
 * `number` entity: no setpoint-switching chips (there is only one target,
 * chosen by which pill opened this screen), and no optimistic-hold/reconcile
 * dance against incoming `hass` updates — `model` is read once on connect
 * (matching `schedule-add-block-overlay.ts`'s own one-time seed), and this
 * component's local edit is authoritative for the rest of its lifetime rather
 * than racing a live poll the way the climate entity's hold setpoints do.
 *
 * Purely presentational aside from that local edit state: it emits the shared
 * `ecosee-service-call` (`number.set_value`) for the host card to apply. A
 * value-neutral tap on the bubble dismisses without writing, matching the
 * Temperature Adjust overlay and the device.
 */
@customElement('ecosee-comfort-setpoint-overlay')
export class EcoseeComfortSetpointOverlay extends LitElement {
  /** The field being edited, read once on connect. */
  @property({ attribute: false }) value?: ComfortSetpointValue;
  /** The owning Comfort Setting's display label, e.g. "Away". */
  @property({ attribute: false }) presetLabel = '';

  @state() private _edit?: SetpointEdit;

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    button {
      appearance: none;
      background: none;
      border: none;
      margin: 0;
      padding: 0;
      color: inherit;
      font: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .nudge button,
    .scrubber {
      pointer-events: auto;
    }

    .picker {
      container-type: inline-size;
      box-sizing: border-box;
      width: var(--ecosee-base-size, 460px);
      height: var(--ecosee-base-size, 460px);
      /* Top padding lines the title's own vertical center up with the shell's ✕
         (top: 9u, 9u tall — vertical center 13.5u from the content box's top). */
      padding: calc(9 * var(--ecosee-u, 4.6px)) calc(7 * var(--ecosee-u, 4.6px))
        calc(8 * var(--ecosee-u, 4.6px));
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: calc(3 * var(--ecosee-u, 4.6px));
    }

    .header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1cqw;
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
      font-size: 5cqw;
      font-weight: 500;
      color: var(--ecosee-text, #d4eff9);
    }

    /* Two columns: vertical scrubber (center) | ± nudge buttons (right) — the
       Temperature Adjust overlay's own grid, minus its setpoint-chip column
       (there's nothing to switch between here). */
    .adjust {
      flex: 1;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr max-content;
      align-items: center;
      gap: calc(3 * var(--ecosee-u, 4.6px));
    }

    .nudge {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14cqw;
    }
    .nudge button {
      width: 12cqw;
      height: 12cqw;
    }
    .adjust.cool .nudge button {
      color: var(--ecosee-cool, #49b6ea);
    }
    .adjust.heat .nudge button {
      color: var(--ecosee-heat, #f3a13c);
    }

    .scrubber {
      align-self: stretch;
      display: grid;
      grid-template-rows: 1fr auto 1fr;
      justify-items: center;
      gap: 3cqw;
      touch-action: none;
      cursor: ns-resize;
    }
    .scrubber:focus-visible {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: 1.5cqw;
      border-radius: 8cqw;
    }
    .stack {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4cqw;
    }
    .stack.above {
      align-self: end;
    }
    .stack.below {
      align-self: start;
    }
    .neighbor {
      font-size: 11cqw;
      font-weight: 300;
      color: var(--ecosee-muted, #6f96a3);
      opacity: 0.85;
    }
    .neighbor.far {
      font-size: 9cqw;
      opacity: 0.5;
    }
    .bubble {
      width: 36cqw;
      height: 36cqw;
      border-radius: 28%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 15cqw;
      font-weight: 200;
      color: var(--ecosee-fg, #d4eff9);
    }
    .adjust.cool .bubble {
      background: var(--ecosee-cool-grad, #49b6ea);
    }
    .adjust.heat .bubble {
      background: var(--ecosee-heat-grad, #f3a13c);
    }
  `;

  /** In-progress drag: the pointer Y and value at press. Mirrors the
   *  Temperature Adjust overlay's own drag/tap classification exactly. */
  private _drag: { startY: number; startValue: number; moved: boolean } | null = null;
  private _tapToDismiss = false;
  private _writeTimer: ReturnType<typeof setTimeout> | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    // Seed once from the value the host resolved when this picker was opened —
    // deliberately not re-seeded on later `value` property churn (e.g. an
    // unrelated hass refresh recomputing the host's model), so a mid-scrub or
    // mid-debounce edit can't be yanked out from under the user.
    if (!this._edit && this.value) this._edit = this.value.edit;
  }

  private _emit(edit: SetpointEdit): void {
    if (!this.value) return;
    emitServiceCall(this, setNumberValueCall(this.value.entityId, edit.value));
  }

  private _commit(next: SetpointEdit): void {
    this._edit = next;
    if (this._writeTimer) clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => {
      this._writeTimer = null;
      if (this._edit) this._emit(this._edit);
    }, WRITE_DEBOUNCE_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Flush any pending write so closing right after a nudge/scrub still commits.
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
      if (this._edit) this._emit(this._edit);
    }
  }

  private _onScrubberDown = (event: PointerEvent): void => {
    const edit = this._edit;
    if (!edit) return;
    this._tapToDismiss = false;
    const el = event.currentTarget as HTMLElement;
    el.focus({ preventScroll: true });
    this._drag = { startY: event.clientY, startValue: edit.value, moved: false };
    el.setPointerCapture(event.pointerId);
  };

  private _onScrubberMove = (event: PointerEvent): void => {
    if (!this._drag || !this._edit) return;
    this._edit = scrubSetpoint(
      this._edit,
      this._drag.startValue,
      event.clientY - this._drag.startY,
      PX_PER_STEP,
    );
    if (this._edit.value !== this._drag.startValue) this._drag.moved = true;
  };

  private _onScrubberUp = (event: PointerEvent): void => {
    const drag = this._drag;
    if (!drag) return;
    this._drag = null;
    const el = event.currentTarget as HTMLElement;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    if (this._edit && this._edit.value !== drag.startValue) {
      this._commit(this._edit);
      return;
    }
    this._tapToDismiss = event.type === 'pointerup' && !drag.moved;
  };

  private _onScrubberClick = (): void => {
    if (!this._tapToDismiss) return;
    this._tapToDismiss = false;
    emitOverlayDismiss(this);
  };

  private _onScrubberTouchMove = {
    handleEvent: (event: TouchEvent): void => {
      if (this._drag) event.preventDefault();
    },
    passive: false,
  };

  private _onScrubberKey = (event: KeyboardEvent): void => {
    const edit = this._edit;
    if (!edit) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      this._commit(nudgeSetpoint(edit, 1));
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      this._commit(nudgeSetpoint(edit, -1));
    }
  };

  override render(): TemplateResult | typeof nothing {
    const edit = this._edit;
    const value = this.value;
    if (!edit || !value) return nothing;
    const label = edit.setpoint === 'cool' ? 'Cool' : 'Heat';

    return html`
      <div class="picker">
        <div class="header">
          <h2 class="title">${this.presetLabel}</h2>
          <p class="subtitle">${label} setpoint</p>
        </div>
        <div class="adjust ${edit.setpoint}">
          ${this._renderScrubber(edit, value)}
          <div class="nudge">
            <button aria-label="Increase" @click=${() => this._commit(nudgeSetpoint(edit, 1))}>
              ${icons.plus}
            </button>
            <button aria-label="Decrease" @click=${() => this._commit(nudgeSetpoint(edit, -1))}>
              ${icons.minus}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderScrubber(edit: SetpointEdit, value: ComfortSetpointValue): TemplateResult {
    const values = scrubberWindow(edit, SCRUBBER_RADIUS);
    const above = values.filter((v) => v > edit.value).reverse();
    const below = values.filter((v) => v < edit.value).reverse();
    const neighbor = (v: number): TemplateResult => {
      const far = Math.abs(v - edit.value) > edit.step * 1.5;
      return html`<div class="neighbor ${far ? 'far' : ''}">${formatSetpointValue(v)}</div>`;
    };
    return html`
      <div
        class="scrubber"
        role="slider"
        tabindex="0"
        aria-label=${`${edit.setpoint === 'cool' ? 'Cool' : 'Heat'} setpoint for ${this.presetLabel}`}
        aria-valuenow=${edit.value}
        aria-valuemin=${edit.min ?? nothing}
        aria-valuemax=${edit.max ?? nothing}
        aria-valuetext=${`${formatSetpointValue(edit.value)}${value.unit}`}
        @pointerdown=${this._onScrubberDown}
        @pointermove=${this._onScrubberMove}
        @pointerup=${this._onScrubberUp}
        @pointercancel=${this._onScrubberUp}
        @click=${this._onScrubberClick}
        @touchmove=${this._onScrubberTouchMove}
        @keydown=${this._onScrubberKey}
      >
        <div class="stack above">${above.map(neighbor)}</div>
        <div class="bubble">${formatSetpointValue(edit.value)}</div>
        <div class="stack below">${below.map(neighbor)}</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-comfort-setpoint-overlay': EcoseeComfortSetpointOverlay;
  }
}
