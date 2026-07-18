import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import {
  markFilterChangedCall,
  setLastChangedDateCall,
  parseFilterDate,
  formatIntervalUnit,
  toIsoDate,
  type FurnaceFilterModel,
} from '../climate/furnace-filter';
import { setNumberValueCall } from '../climate/comfort-setpoint';
import { emitServiceCall } from './service-call-event';

/**
 * `<ecosee-furnace-filter-overlay>` — the Furnace Filter Main Menu section's
 * content (slotted into <ecosee-overlay>, ADR-0017). A Card addition with no
 * physical-device screen — modeled on the ecobee app's own filter-change
 * confirmation screen (the owner's own reference): a "Furnace Filter" title,
 * the last-changed date, the configured replacement interval, the computed
 * due date (styled as a warning once overdue), and a large "I've changed my
 * filter" button at the bottom.
 *
 * Two of those readings are themselves editable in place, not just derived
 * text (owner correction: "you should be able to set the date last changed
 * manually, as well as set the interval timing (from the entity)"):
 *
 * - **Last changed** renders as a tappable pill when `canEditLastChanged`
 *   (the entity's own domain is directly writable — a read-only `sensor`
 *   backed only by `filter_reset_entity` stays plain text, since there's
 *   nothing to write an arbitrary date onto). The pill layers a transparent
 *   native `<input type="date">` over the styled label — the same
 *   "real native control captured by an invisible overlay, styled pill
 *   underneath" trick `fan-overlay.ts`'s runtime `<select>` already uses —
 *   so tapping it opens the platform's own date picker rather than this file
 *   building calendar-grid UI from scratch, and the write goes through
 *   `setLastChangedDateCall`.
 * - **Interval** renders the same pill treatment when `intervalEdit` is
 *   present (a live `filter_interval_entity`, not a static
 *   `filter_interval_days`) via a native `<input type="number">` bounded to
 *   the entity's own `min`/`max`/`step`, writing through the already-exported
 *   `setNumberValueCall` (comfort-setpoint.ts) — the exact same
 *   `number.set_value` write Comfort Setpoints uses, reused rather than
 *   duplicated. Absent when there's no live entity to write to.
 *
 * Otherwise unchanged from before: no lasting edit state, every write emits
 * the shared `ecosee-service-call` and the section re-renders once `hass`
 * reflects it, exactly like every other editing Overlay. The "I've changed
 * my filter" button is disabled (not hidden) when `canMarkChanged` is false.
 */
@customElement('ecosee-furnace-filter-overlay')
export class EcoseeFurnaceFilterOverlay extends LitElement {
  @property({ attribute: false }) model?: FurnaceFilterModel;
  /** `config.filter_last_changed_entity` — passed straight through (not the
   *  whole config) so this component stays a scalar-props leaf like every
   *  other editing Overlay (`entityId`, etc.). */
  @property({ attribute: false }) lastChangedEntity?: string;
  /** `config.filter_reset_entity`. */
  @property({ attribute: false }) resetEntity?: string;

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    /* Title near the top with the readout + button beneath, matching every
       other Main Menu section (sensors-overlay.ts, fan-overlay.ts). Inline-size
       container so content scales with cqw off the definite width (issue #35). */
    .filter {
      container-type: inline-size;
      box-sizing: border-box;
      width: var(--ecosee-base-size, 460px);
      height: var(--ecosee-base-size, 460px);
      display: flex;
      flex-direction: column;
      align-items: center;
      /* Top padding lines the title's own vertical center up with the shell's ✕
         (top: 9u, 9u tall). Horizontal padding matches every other section (7u).
         Bottom keeps content clear of the tab bar. */
      padding: calc(9 * var(--ecosee-u, 4.6px)) calc(7 * var(--ecosee-u, 4.6px))
        var(--ecosee-tabbar-inset, calc(7 * var(--ecosee-u, 4.6px)));
      text-align: center;
    }

    .title {
      margin: 0;
      font-size: 8cqw;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--ecosee-text-accent, #62cfe9);
    }

    /* Centers the readout + button within whatever space remains below the
       title, matching the Home Screen's own .cluster and every other section
       standardized to it. Tighter gap than the earlier icon-led layout — one
       more row (Interval) now competes for the same vertical budget. */
    .content {
      width: 100%;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: calc(5 * var(--ecosee-u, 4.6px));
      margin-top: calc(3 * var(--ecosee-u, 4.6px));
    }

    .readout {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.6cqw;
    }

    .row {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 1.6cqw;
      font-size: 4.8cqw;
      font-weight: 500;
      color: var(--ecosee-text-accent, #62cfe9);
    }
    .row .value {
      font-weight: 600;
    }

    /* Overdue styling: the due-date row turns the same amber the Heat setpoint
       uses elsewhere, plus an explicit "overdue by N days" line — a warning by
       color AND text, not color alone. */
    .row.overdue {
      color: var(--ecosee-heat, #f3a13c);
    }
    .overdue-note {
      margin: 0;
      font-size: 4.1cqw;
      font-weight: 600;
      color: var(--ecosee-heat, #f3a13c);
    }

    /* An editable reading (Last changed / Interval): a small cyan-outlined
       pill, matching the value-pill language used elsewhere (Comfort
       Setpoints' own Heat/Cool pills) so it reads as tappable at a glance.
       A transparent native input is layered on top (.pill-native) — the
       same "real platform control captured by an invisible overlay, styled
       pill underneath" trick fan-overlay.ts's .select-native runtime
       dropdown already uses, so the platform's own date/number picker opens
       on tap rather than this file building custom picker UI. */
    .pill {
      position: relative;
      display: inline-flex;
      align-items: center;
      padding: 0.6cqw 2.6cqw;
      border: 0.45cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 100cqw;
      font-weight: 600;
      pointer-events: auto;
    }
    .pill-label {
      pointer-events: none;
    }
    .pill-native {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      border: none;
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      color: transparent;
      font: inherit;
      cursor: pointer;
      /* Suppress the browser's own default focus ring on the native control
         itself — .pill:focus-within below draws the one visible focus cue,
         now that removing opacity: 0 (next comment) lets the native ring
         actually paint instead of being hidden along with everything else. */
      outline: none;
    }
    /* No opacity: 0 — some mobile browsers (notably iOS Safari) treat a
       near-zero-opacity form control as invisible enough to suppress its own
       native picker/keyboard from opening on tap, even though the element
       still receives focus (the double-outline/dead-tap bug this replaced).
       Fully transparent color/background achieves the same invisible LOOK
       without opacity, so the platform still treats it as a real, interactive
       control. The calendar-icon affordance date inputs render internally is
       hidden the same way rather than left to clash with the pill. */
    .pill-native::-webkit-calendar-picker-indicator {
      background: transparent;
      cursor: pointer;
    }
    /* A date input's individual segment (month/day/year) shows a highlighted
       "currently selected" state while focused/edited via keyboard or tap —
       rendered through ::selection, which color: transparent on the input
       itself does NOT reach (selected-text rendering is a separate paint
       pass with its own default background/foreground). Left alone, tapping
       or tabbing to the pill briefly reveals a solid highlighted box with
       real digits in it, defeating the whole invisible-input trick. */
    .pill-native::selection {
      background: transparent;
      color: transparent;
    }
    .pill:focus-within {
      /* Flush against the pill's own border (no outline-offset) so this
         reads as the border getting thicker, not a second detached ring. */
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
    }

    /* Large call-to-action button (ecobee app's own "I've changed my filter"
       screen, the owner's reference) — filled cyan pill with dark text,
       matching the squircle "selected"/primary-action fill used elsewhere
       (fan-overlay.ts's .segment.selected, system-mode-overlay.ts's active row)
       rather than the reference app's literal green, so it stays the Skin's own
       accent rather than a one-off color. */
    .mark-changed {
      appearance: none;
      border: none;
      margin: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2.8cqw 8cqw;
      border-radius: 100cqw;
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
      font: inherit;
      font-size: 5cqw;
      font-weight: 600;
      cursor: pointer;
      pointer-events: auto;
    }
    .mark-changed:focus-visible {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: 1cqw;
    }
    .mark-changed:disabled {
      opacity: 0.45;
      cursor: default;
    }
  `;

  private _markChanged(): void {
    const call = markFilterChangedCall(this.lastChangedEntity, this.resetEntity);
    if (call) emitServiceCall(this, call);
  }

  private _onLastChangedInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!this.lastChangedEntity || !value) return;
    const date = parseFilterDate(value);
    if (!date) return;
    const call = setLastChangedDateCall(this.lastChangedEntity, date);
    if (call) emitServiceCall(this, call);
  }

  private _onIntervalInput(event: Event, entityId: string): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    emitServiceCall(this, setNumberValueCall(entityId, value));
  }

  private _formatDate(date: Date): string {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private _renderLastChanged(model: FurnaceFilterModel, lastChanged: Date): TemplateResult {
    if (!model.canEditLastChanged) {
      return html`<p class="row">
        Last changed <span class="value">${this._formatDate(lastChanged)}</span>
      </p>`;
    }
    return html`<p class="row">
      Last changed
      <span class="pill">
        <span class="pill-label">${this._formatDate(lastChanged)}</span>
        <input
          class="pill-native"
          type="date"
          aria-label="Last changed date"
          max=${toIsoDate(new Date())}
          .value=${toIsoDate(lastChanged)}
          @change=${(e: Event) => this._onLastChangedInput(e)}
        />
      </span>
    </p>`;
  }

  private _renderInterval(model: FurnaceFilterModel): TemplateResult | typeof nothing {
    const edit = model.intervalEdit;
    if (!edit) return nothing;
    return html`<p class="row">
      Interval
      <span class="pill">
        <span class="pill-label">${formatIntervalUnit(edit.value, edit.unit)}</span>
        <input
          class="pill-native"
          type="number"
          aria-label="Filter replacement interval"
          min=${edit.min ?? nothing}
          max=${edit.max ?? nothing}
          step=${edit.step}
          .value=${String(edit.value)}
          @change=${(e: Event) => this._onIntervalInput(e, edit.entityId)}
        />
      </span>
    </p>`;
  }

  override render(): TemplateResult | typeof nothing {
    const model = this.model;
    if (!model || !model.available || !model.lastChanged) return nothing;
    const lastChanged = model.lastChanged;
    return html`
      <div class="filter">
        <h2 class="title">Furnace Filter</h2>
        <div class="content">
          <div class="readout">
            ${this._renderLastChanged(model, lastChanged)} ${this._renderInterval(model)}
            ${
              model.dueDate
                ? html`<p class="row ${model.overdue ? 'overdue' : ''}">
                    ${model.overdue ? 'Was due' : 'Due'}
                    <span class="value">${this._formatDate(model.dueDate)}</span>
                  </p>`
                : nothing
            }
            ${
              model.overdue
                ? html`<p class="overdue-note">
                    Overdue by ${model.daysOverdue} day${model.daysOverdue === 1 ? '' : 's'}
                  </p>`
                : nothing
            }
          </div>
          <button
            class="mark-changed"
            ?disabled=${!model.canMarkChanged}
            @click=${this._markChanged}
          >
            I've changed my filter
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-furnace-filter-overlay': EcoseeFurnaceFilterOverlay;
  }
}
