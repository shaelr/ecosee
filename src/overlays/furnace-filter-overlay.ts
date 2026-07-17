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
 * the last-changed date, the configured replacement interval and computed due
 * date (styled as a warning once overdue), and a large "I've changed my
 * filter" button at the bottom that writes today's date (or presses/triggers
 * `filter_reset_entity` when configured) via `markFilterChangedCall`.
 *
 * Like the Fan/System Mode pickers, this owns no lasting edit state: the
 * button emits the shared `ecosee-service-call` and the section re-renders
 * once `hass` reflects the write, exactly as every other editing Overlay
 * does. Disabled (not hidden) when `canMarkChanged` is false, since a
 * misconfigured Card (a `filter_last_changed_entity` on a read-only domain
 * with no `filter_reset_entity`) should still show the button's presence, not
 * silently swallow the tap.
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
       standardized to it. */
    .content {
      width: 100%;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: calc(6 * var(--ecosee-u, 4.6px));
      margin-top: calc(4.5 * var(--ecosee-u, 4.6px));
    }

    .icon {
      width: 16cqw;
      height: 16cqw;
      color: var(--ecosee-accent, #62cfe9);
    }

    .readout {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.8cqw;
    }

    .row {
      margin: 0;
      font-size: 5.2cqw;
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
      font-size: 4.4cqw;
      font-weight: 600;
      color: var(--ecosee-heat, #f3a13c);
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
      padding: 3.2cqw 8cqw;
      border-radius: 100cqw;
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
      font: inherit;
      font-size: 5.3cqw;
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

  private _formatDate(date: Date): string {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  override render(): TemplateResult | typeof nothing {
    const model = this.model;
    if (!model || !model.available) return nothing;
    return html`
      <div class="filter">
        <h2 class="title">Furnace Filter</h2>
        <div class="content">
          <span class="icon" aria-hidden="true">${icons.filter}</span>
          <div class="readout">
            ${
              model.lastChanged
                ? html`<p class="row">
                    Last changed <span class="value">${this._formatDate(model.lastChanged)}</span>
                  </p>`
                : nothing
            }
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
