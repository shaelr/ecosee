import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import {
  markFilterChangedCall,
  setLastChangedDateCall,
  parseFilterDate,
  toIsoDate,
  type FurnaceFilterModel,
} from '../climate/furnace-filter';
import { setNumberValueCall } from '../climate/comfort-setpoint';
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
 *   nothing to write an arbitrary date onto). The visible pill is an
 *   ordinary opaque `<button>` (`.pill-button`), not a styled label with an
 *   invisible native `<input type="date">` layered on top of it — an
 *   earlier version tried exactly that (mirroring `fan-overlay.ts`'s
 *   `.select-native` trick), but Chrome renders a *focused* date input's own
 *   value/segment-highlight at full system styling while its native picker
 *   UI is open, a deliberate "stay legible while showing" behavior no
 *   combination of `color`/`::selection`/`::-webkit-datetime-edit-*`/an
 *   opaque higher-stacked backing layer could suppress (confirmed by an
 *   owner screenshot after each attempt — see ADR-0017's corrections). A
 *   real `<button>` sidesteps the category entirely: it is never a form
 *   control Chrome could render natively, so there is nothing for that
 *   behavior to apply to. The actual `<input type="date">` (`.date-native`)
 *   still exists — genuinely tiny and invisible, tucked at the pill's own
 *   corner, never itself the tap target — purely so the button's click
 *   handler can call its `showPicker()` explicitly and its `change` event
 *   can drive the write (`setLastChangedDateCall`).
 * - **Interval** renders as a dropdown-menu pill when `intervalEdit` is
 *   present (a live `filter_interval_entity`, not a static
 *   `filter_interval_days`) — a native `<select>` of the entity's own
 *   discrete `min`..`max` (by `step`) values, the same pattern (and the same
 *   underlying `.select-native` trick) as the Fan screen's own
 *   minimum-runtime selector, rather than a free-form numeric input (owner
 *   request: "can the interval be a menu style like the fan duration").
 *   Writes through the already-exported `setNumberValueCall`
 *   (comfort-setpoint.ts) — the exact same `number.set_value` write Comfort
 *   Setpoints uses, reused rather than duplicated. Absent when there's no
 *   live entity to write to.
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
  /** The tiny, genuinely-invisible `<input type="date">` `.pill-button`'s
   *  click handler calls `showPicker()` on — see `.date-native`'s own CSS
   *  doc comment. Only rendered (and only ever non-null) once
   *  `canEditLastChanged` is true. */
  @query('.date-native') private _dateInput?: HTMLInputElement;

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
    /* Last changed: an ordinary opaque <button> carrying the pill's own
       visual look (font/color/appearance:none, inheriting .pill's border
       etc.) — not a styled label with an invisible native input layered on
       top. Earlier attempts along that road (transparent color,
       ::selection, ::-webkit-datetime-edit-* overrides, an opaque backing
       layer with a higher z-index) all still lost to Chrome rendering a
       focused date input's own value/segment-highlight at full system
       styling while its native picker UI is active — a deliberate
       "stay legible while showing" browser behavior that page-level CSS
       cannot reach, confirmed by an owner screenshot after each attempt. A
       real button sidesteps the whole category: it is never a form control
       Chrome could decide to render natively, so there is nothing for that
       behavior to apply to. Tapping it calls .date-native's showPicker()
       (below) explicitly. */
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
    }
    .pill-button:focus-visible {
      /* Flush against the pill's own border (no outline-offset) so this
         reads as the border getting thicker, not a second detached ring
         (the double-outline this replaced). */
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: inherit;
    }
    /* The actual <input type="date"> backing the button above: genuinely
       tiny and invisible (not just styled to look that way), tucked at the
       pill's own corner. It is never the tap target and never directly
       focused by a user (tabindex="-1", aria-hidden="true" — the button is
       what keyboard/screen-reader users reach); .pill-button's click
       handler calls its showPicker() explicitly. Because nothing about it
       is ever meant to be seen or tapped directly, opacity: 0 is safe here
       — the earlier "invisible inputs can suppress the native picker on tap"
       finding was specifically about relying on a raw tap landing on an
       invisible element's own hit-region, which a programmatic showPicker()
       call doesn't depend on.

       Known rough edge, confirmed in testing, not yet addressed: the
       calendar popup itself doesn't anchor next to this input the way it
       would for a normal, unscaled page — it opens near the top of the
       viewport instead. Tried both this 1px sizing and a full-pill-sized
       input; sizing made no difference, which points at the whole Card's
       own .root transform: scale(...) rule (the fixed-canvas architecture
       every screen relies on) confusing the browser's own popup-anchor
       calculation, not this element specifically. A fixed-position input
       wouldn't escape it either — a transformed ancestor becomes the
       containing block for fixed descendants too, per spec. The real fix
       would be rendering this input outside the transformed subtree
       entirely (a portal to document.body, positioned via
       getBoundingClientRect() at click time) — deferred until confirmed
       against a real device, not just headless Chromium. */
    .date-native {
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

    /* The Interval pill's caret, marking it as a menu (fan-overlay.ts's own
       minimum-runtime dropdown carries the identical caret for the same
       reason — a value pill with no caret reads as a static value, one with
       a caret reads as "tap for a list"). */
    .pill.select {
      gap: 1.8cqw;
    }
    .caret {
      width: 3.6cqw;
      height: 3.6cqw;
      flex: none;
      color: var(--ecosee-accent, #62cfe9);
      pointer-events: none;
    }
    /* A native <select>, unlike <input type="date">/<input type="number">,
       isn't subject to the opacity-suppresses-the-picker WebKit quirk above
       — fan-overlay.ts's own .select-native has used opacity: 0 successfully
       since that dropdown shipped — so this one keeps the simpler trick
       rather than the transparent-color workaround .pill-native needs. */
    .select-native {
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
    }
    .select-native option {
      color: var(--ecosee-text, #d4eff9);
      background: var(--ecosee-bg, #0a0d10);
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

  /** `.pill-button`'s click handler — explicitly opens the calendar picker
   *  on the hidden `.date-native` input, rather than relying on a native tap
   *  landing on a form control at all (there is no visible form control to
   *  tap here, by design — see `.pill-button`'s own CSS doc comment).
   *
   *  Two calls, for two different engines: `.focus()` unconditionally first
   *  — iOS WebKit doesn't implement `showPicker()` for date/time inputs at
   *  all (WebKit bug 261703, open since 2023; only file inputs support it
   *  there) and is a silent no-op there, but ties its native picker sheet to
   *  the input receiving real focus, from *any* source, not just a raw tap —
   *  a WebKit engineer's own suggested workaround for the bug. Then
   *  `showPicker()` itself, feature-detected (`typeof input.showPicker ===
   *  'function'`, Baseline 2023 — Chrome/Edge 99+, Safari 16.4+, Firefox
   *  101+) and wrapped in try/catch (the spec allows it to throw when
   *  rate-limited or called outside a genuine user gesture) — it forces the
   *  calendar open unconditionally on engines that support it, where
   *  `.focus()` alone would not (see ADR-0017's "showPicker() forces the
   *  calendar open on every tap" correction). */
  private _openDatePicker(): void {
    const input = this._dateInput;
    if (!input) return;
    input.focus();
    if (typeof input.showPicker !== 'function') return;
    try {
      input.showPicker();
    } catch {
      // See doc comment above — no recovery needed.
    }
  }

  private _onIntervalChange(event: Event, entityId: string): void {
    const raw = (event.target as HTMLSelectElement).value;
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
        <button
          type="button"
          class="pill-button"
          aria-label="Last changed date, ${this._formatDate(lastChanged)}"
          @click=${this._openDatePicker}
        >
          ${this._formatDate(lastChanged)}
        </button>
        <input
          class="date-native"
          type="date"
          tabindex="-1"
          aria-hidden="true"
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
    const current = edit.options.find((option) => option.selected);
    return html`<p class="row">
      Interval
      <span class="pill select">
        <span class="pill-label">${current?.label}</span>
        <span class="caret">${icons.caretDown}</span>
        <select
          class="select-native"
          aria-label="Filter replacement interval"
          @change=${(e: Event) => this._onIntervalChange(e, edit.entityId)}
        >
          ${edit.options.map(
            (option) =>
              html`<option value=${option.value} ?selected=${option.selected}>
                ${option.label}
              </option>`,
          )}
        </select>
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
