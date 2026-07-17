import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { formatTemp } from '../climate/home-view';
import type { SensorsModel, SensorCard } from '../sensors/sensors';
import { icons } from '../icons';

/**
 * `<ecosee-sensors-overlay>` — the Sensors sub-screen's content (slotted into
 * <ecosee-overlay>). Laid out as the device is (see docs/reference/sensors.jpeg):
 * a "Sensors" title near the top (the section's own name — no separate "Main
 * Menu" breadcrumb, matching Fan/Schedule's single-title header), then a
 * vertical stack of horizontal **cards** — each a cyan-outlined squircle with a
 * sensor glyph, the
 * sensor name, a `73° | Occupied` reading line, and a circled expand chevron.
 *
 * Read-only (no "participating in average" control — Home Assistant can't back
 * it, issue #9) but not inert: tapping a card fires the standard
 * `hass-more-info` DOM event (bubbling + composed, the same event every stock
 * Lovelace card's entity row fires — confirmed against
 * home-assistant/frontend's own `handle-action.ts`) carrying that sensor's
 * entity id, so Home Assistant's own more-info dialog opens with its History
 * graph — no history data is fetched or rendered here, the Card only asks HA
 * to show what it already knows how to show. The chevron is this tap target's
 * affordance, not a separate control. Dismissal is the shell's job (✕ /
 * outside-tap), which returns to the Main Menu (hub-and-picker).
 */
@customElement('ecosee-sensors-overlay')
export class EcoseeSensorsOverlay extends LitElement {
  /** The already-degraded sensor cards, derived by the host card from `hass`. */
  @property({ attribute: false }) model?: SensorsModel;

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    /* Breadcrumb header near the top, the card stack beneath (sensors.jpeg), not a
       vertically-centered cluster. Inline-size container so cards scale with cqw
       off the definite width, with the root's own padding/gap in the fixed unit (calc · --ecosee-u) so they can't couple to the viewport, the real bug — a container-type element resolves its OWN cqw against the viewport (issue #35). */
    .sensors {
      container-type: inline-size;
      box-sizing: border-box;
      width: var(--ecosee-base-size, 460px);
      height: var(--ecosee-base-size, 460px);
      display: flex;
      flex-direction: column;
      align-items: center;
      /* Top padding lines the title's own vertical center up with the shell's ✕
         (top: 9u, 9u tall — vertical center 13.5u from the content box's top).
         Horizontal padding matches every other Main Menu section (7u, the same
         value schedule-overlay.ts uses). Reserve the tab bar's zone at the
         bottom so the scrolling list can't hide its last card behind it. The
         size is the shell's --ecosee-tabbar-inset (it owns the bar's
         geometry); this falls back to the normal 7u when no bar is present. */
      padding: calc(9 * var(--ecosee-u, 4.6px)) calc(7 * var(--ecosee-u, 4.6px))
        var(--ecosee-tabbar-inset, calc(7 * var(--ecosee-u, 4.6px)));
    }

    .title {
      margin: 0;
      font-size: 8cqw;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--ecosee-text-accent, #62cfe9);
    }

    /* .content centers the card stack within whatever space remains below the
       (fixed-position) title, not the full screen — so one or two sensors don't
       leave a large dead gap between the list and the tab bar (matching the
       Home Screen's own .cluster). A long list still hits .list's own
       max-height and scrolls exactly as before; .content only changes where
       a SHORT list sits. */
    .content {
      width: 100%;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin-top: calc(5 * var(--ecosee-u, 4.6px));
    }

    /* The card stack. Opts back into pointer events (the shell makes slotted
       content transparent so empty areas dismiss) so a long list can scroll;
       empty margins still fall through to the backdrop. Full width (matching
       schedule-overlay.ts's own agenda) rather than a further-inset 84cqw —
       the container's own horizontal padding is already the inset. */
    .list {
      width: 100%;
      /* Caps how many cards are visible before the list scrolls (the last one peeks,
         as on the device, matching schedule-overlay.ts's own agenda cap); the
         root's bottom inset keeps it clear of the tab bar. */
      max-height: 60cqw;
      display: flex;
      flex-direction: column;
      gap: 3cqw;
      overflow-y: auto;
      pointer-events: auto;
      /* Hide the scrollbar — the device has none (it's a touchscreen). */
      scrollbar-width: none;
    }
    .list::-webkit-scrollbar {
      display: none;
    }

    /* One horizontal sensor card: a cyan-outlined squircle, and — unlike a
       plain div — a real tap target (opens the entity's history via
       hass-more-info), so it carries its own button reset rather than
       inheriting one from elsewhere in this file. */
    .card {
      appearance: none;
      width: 100%;
      box-sizing: border-box;
      flex: none;
      display: flex;
      align-items: center;
      gap: 3.5cqw;
      padding: 3.4cqw 4cqw;
      background: none;
      border: 0.6cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 5cqw;
      font: inherit;
      text-align: left;
      color: inherit;
      cursor: pointer;
    }
    .card:focus-visible {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: 1cqw;
    }

    .card-icon {
      width: 8cqw;
      height: 8cqw;
      flex: none;
      color: var(--ecosee-accent, #62cfe9);
    }

    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.8cqw;
    }
    .name {
      font-size: 6cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .reading {
      display: flex;
      align-items: baseline;
      gap: 2cqw;
      font-size: 5cqw;
      font-weight: 500;
      color: var(--ecosee-text-accent, #62cfe9);
    }
    /* The vertical-bar divider between temperature and occupancy, dimmed. */
    .sep {
      color: color-mix(in srgb, var(--ecosee-accent, #62cfe9) 45%, transparent);
    }

    /* The circled expand chevron (fidelity affordance; read-only). */
    .chevron {
      box-sizing: border-box;
      width: 8cqw;
      height: 8cqw;
      flex: none;
      padding: 1.7cqw;
      border: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 50%;
      color: var(--ecosee-accent, #62cfe9);
    }
  `;

  /** Ask Home Assistant to open its own more-info dialog (History graph
   *  included) for this sensor's entity — the standard `hass-more-info` event
   *  every stock Lovelace entity row fires, not a screen this Card renders
   *  itself. `card.key` is the entity id (`sensors.ts`'s own doc comment). */
  private _showHistory(card: SensorCard): void {
    this.dispatchEvent(
      new CustomEvent('hass-more-info', {
        detail: { entityId: card.key },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderCard(card: SensorCard, unit: string): TemplateResult {
    return html`
      <button
        class="card"
        aria-label="${card.name}, view history"
        @click=${() => this._showHistory(card)}
      >
        <span class="card-icon" aria-hidden="true">
          ${card.isThermostat ? icons.thermostat : icons.sensor}
        </span>
        <div class="text">
          <div class="name">${card.name}</div>
          <div class="reading">
            <span class="temp">${formatTemp(card.temp, unit)}°</span>
            ${
              card.occupied === null
                ? nothing
                : html`<span class="sep" aria-hidden="true">|</span>
                    <span class="occ">${card.occupied ? 'Occupied' : 'Unoccupied'}</span>`
            }
          </div>
        </div>
        <span class="chevron" aria-hidden="true">${icons.chevron}</span>
      </button>
    `;
  }

  override render(): TemplateResult | typeof nothing {
    const model = this.model;
    if (!model || !model.available) return nothing;
    return html`
      <div class="sensors">
        <h2 class="title">Sensors</h2>
        <div class="content">
          <div class="list" role="list" aria-label="Sensors">
            ${repeat(
              model.cards,
              (card) => card.key,
              (card) => this._renderCard(card, model.unit),
            )}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-sensors-overlay': EcoseeSensorsOverlay;
  }
}
