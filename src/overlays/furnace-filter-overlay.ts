import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { markFilterChangedCall, type FurnaceFilterModel } from '../climate/furnace-filter';
import { icons } from '../icons';
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
 *   nothing to write an arbitrary date onto). Tapping the pill emits
 *   `ecosee-date-picker-open` — the host pushes ecosee's own calendar Overlay
 *   (`date-picker-overlay.ts`, ADR-0018) on top, and its confirm event drives
 *   the actual write (`setLastChangedDateCall`) at the card level, the same
 *   push-a-picker/write-on-confirm shape every other editable value in this
 *   Card uses. This component owns no native form control, no picker-opening
 *   logic, and no write logic for this field at all anymore — see ADR-0017/
 *   0018's corrections for the two browser-engine-specific bugs (a Chrome
 *   desktop rendering quirk, an unimplemented iOS WebKit API) that motivated
 *   moving off the native picker entirely, rather than continuing to patch
 *   around them.
 * - **Interval** renders as a dropdown-styled pill when `intervalEdit` is
 *   present (a live `filter_interval_entity`, not a static
 *   `filter_interval_days`), rather than a free-form numeric input (owner
 *   request: "can the interval be a menu style like the fan duration").
 *   Tapping it emits `ecosee-filter-interval-open` — the host pushes
 *   ecosee's own list-picker Overlay (`filter-interval-overlay.ts`) on top,
 *   which owns the write itself (`setNumberValueCall`, comfort-setpoint.ts —
 *   the same `number.set_value` write Comfort Setpoints uses) and closes
 *   back here on confirm, mirroring System Mode/Comfort Setting's own
 *   already-established pushed-picker shape (owner request, following
 *   ADR-0018's date/time pickers: apply the same custom-styled treatment to
 *   the remaining native `<select>` menus). Absent when there's no live
 *   entity to write to.
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
       Setpoints' own Heat/Cool pills) so it reads as tappable at a glance. */
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
    /* An ordinary opaque <button> carrying the pill's own visual look.
       Tapping it just emits an open event (ecosee-date-picker-open /
       ecosee-filter-interval-open) — there is no native form control
       involved anywhere in this component anymore, since ecosee's own
       Overlays (date-picker-overlay.ts, filter-interval-overlay.ts,
       ADR-0018) replaced every browser-native picker/dropdown this section
       used to rely on. inline-flex + gap (not the outer .pill's own gap) so
       Interval's label+caret pair space correctly now that they're both
       inside the button rather than direct .pill children. */
    .pill-button {
      appearance: none;
      background: none;
      border: none;
      margin: 0;
      padding: 0;
      font: inherit;
      font-weight: inherit;
      color: inherit;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
    }
    .pill-button:focus-visible {
      /* Flush against the pill's own border (no outline-offset) so this
         reads as the border getting thicker, not a second detached ring
         (the double-outline this replaced). */
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: inherit;
    }

    /* The Interval pill's caret, marking it as a menu (fan-overlay.ts's own
       minimum-runtime pill carries the identical caret for the same reason
       — a value pill with no caret reads as a static value, one with a
       caret reads as "tap for a list"). */
    .pill.select .pill-button {
      gap: 1.8cqw;
    }
    .caret {
      width: 3.6cqw;
      height: 3.6cqw;
      flex: none;
      color: var(--ecosee-accent, #62cfe9);
      pointer-events: none;
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

  /** `.pill-button`'s click handler — asks the host to push ecosee's own
   *  calendar Overlay on top (ADR-0018); the write itself happens at the
   *  card level once the picker confirms (see `date-picker-overlay.ts`'s own
   *  module doc). */
  private _openDatePicker(): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-date-picker-open', { bubbles: true, composed: true }),
    );
  }

  /** `.pill-button`'s click handler for Interval — asks the host to push
   *  ecosee's own list-picker Overlay on top (`filter-interval-overlay.ts`);
   *  that picker owns the write itself and closes back here on confirm. */
  private _openIntervalPicker(): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-filter-interval-open', { bubbles: true, composed: true }),
    );
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
        <button
          type="button"
          class="pill-button"
          aria-label="Last changed date, ${this._formatDate(lastChanged)}"
          @click=${this._openDatePicker}
        >
          ${this._formatDate(lastChanged)}
        </button>
      </span>
    </p>`;
  }

  private _renderInterval(model: FurnaceFilterModel): TemplateResult | typeof nothing {
    const edit = model.intervalEdit;
    if (!edit) return nothing;
    const current = edit.options.find((option) => option.selected);
    return html`<p class="row">
      Interval
      <span class="pill select">
        <button
          type="button"
          class="pill-button"
          aria-label="Filter replacement interval, ${current?.label}"
          @click=${this._openIntervalPicker}
        >
          <span class="pill-label">${current?.label}</span>
          <span class="caret">${icons.caretDown}</span>
        </button>
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
  interface HTMLElementEventMap {
    'ecosee-date-picker-open': CustomEvent<void>;
  }
}
