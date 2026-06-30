import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { EquipmentStatus, HomeView } from '../climate/home-view';
import { formatTemp } from '../climate/home-view';
import { icons } from '../icons';

/** Actions the Home Screen surfaces to the host card. `temperature` opens the
 *  Temperature Adjust overlay; `weather` / `menu` open later Overlays; `resume`
 *  clears the active Hold. */
export type HomeAction = 'menu' | 'temperature' | 'weather' | 'resume';

/**
 * The default Card view, laid out as the device is (see
 * docs/reference/home-hold.jpeg): a top row of affordance glyphs (weather left,
 * equipment center, menu right), the humidity line and the large current
 * temperature centered beneath, and the horizontal Hold pill below the number.
 * Purely presentational — it renders whatever the already-degraded HomeView says,
 * and emits `ecosee-action` events for the host card to handle.
 */
@customElement('ecosee-home-screen')
export class EcoseeHomeScreen extends LitElement {
  @property({ attribute: false }) view?: HomeView;

  static override styles = css`
    :host {
      display: block;
    }

    /* Responsive squircle: a sized container so children can scale with cqw, with
       a legible floor (min-size) and a capped ceiling (max-size). */
    .face {
      container-type: size;
      position: relative;
      box-sizing: border-box;
      width: clamp(var(--ecosee-min-size, 220px), 100%, var(--ecosee-max-size, 460px));
      aspect-ratio: var(--ecosee-aspect, 1 / 1);
      margin: 0 auto;
      padding: 7cqw 8cqw;
      display: flex;
      flex-direction: column;
      background: var(--ecosee-bg, #0a0d10);
      border-radius: var(--ecosee-radius, 15%);
      color: var(--ecosee-fg, #d4eff9);
      font-family: var(--ecosee-font, system-ui, sans-serif);
      overflow: hidden;
      user-select: none;
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

    /* Top row: weather (left), equipment (center), menu (right). Explicit columns
       keep each anchored even when weather or equipment is absent. */
    .top {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
    }
    .weather {
      grid-column: 1;
      justify-self: start;
      width: 11cqw;
      height: 11cqw;
      color: var(--ecosee-weather, #7fd08a);
    }
    .equip {
      grid-column: 2;
      justify-self: center;
      width: 12cqw;
      height: 12cqw;
    }
    .equip.cooling {
      color: var(--ecosee-cool, #49b6ea);
    }
    .equip.heating {
      color: var(--ecosee-heat, #f3a13c);
    }
    .equip.idle {
      color: var(--ecosee-idle, #6f96a3);
    }
    .menu {
      grid-column: 3;
      justify-self: end;
      width: 11cqw;
      height: 11cqw;
      color: var(--ecosee-accent, #62cfe9);
    }

    /* Centered cluster: humidity above the dominant number, Hold pill below. */
    .body {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3cqw;
    }

    .hum {
      display: inline-flex;
      align-items: center;
      gap: 1.6cqw;
      font-size: 7cqw;
      font-weight: 300;
      letter-spacing: 0.02em;
      color: var(--ecosee-accent, #62cfe9);
    }
    .hum .glyph {
      width: 6cqw;
      height: 6cqw;
    }

    .temp {
      font-size: 42cqw;
      font-weight: 200;
      line-height: 0.84;
      letter-spacing: -0.04em;
      color: var(--ecosee-fg, #d4eff9);
      cursor: pointer;
    }

    /* Horizontal Hold pill: heat – cool, then the Resume ✕ (the device's
       "until 5:28pm" expiry is omitted — HA can't express it, ADR-0003). */
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 2.5cqw;
      padding: 2.4cqw 4cqw;
      border: 0.6cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 999px;
      font-size: 8cqw;
      font-weight: 500;
      line-height: 1;
    }
    .pill .heat {
      color: var(--ecosee-heat, #f3a13c);
    }
    .pill .cool {
      color: var(--ecosee-cool, #49b6ea);
    }
    .pill .dash {
      color: var(--ecosee-muted, #6f96a3);
    }
    .resume {
      width: 8.5cqw;
      height: 8.5cqw;
      border-radius: 50%;
      border: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-accent, #62cfe9);
      padding: 1.4cqw;
      margin-left: 0.5cqw;
    }

    .unavailable {
      font-size: 8cqw;
      font-weight: 300;
      color: var(--ecosee-muted, #6f96a3);
    }

    /* Adapt when the container is narrow: ease the number down. */
    @container (max-width: 300px) {
      .temp {
        font-size: 38cqw;
      }
    }
  `;

  private _emit(action: HomeAction): void {
    this.dispatchEvent(
      new CustomEvent<{ action: HomeAction }>('ecosee-action', {
        detail: { action },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render(): TemplateResult | typeof nothing {
    const view = this.view;
    if (!view) return nothing;

    return html`
      <div class="face" part="face">
        ${this._renderTop(view)}
        <div class="body">
          ${
            view.available
              ? html`
                  ${
                  view.humidity !== null
                    ? html`<div class="hum">
                        <span class="glyph">${icons.humidity}</span>${Math.round(view.humidity)}%
                      </div>`
                    : nothing
                }
                  <button
                    class="temp"
                    aria-label="Adjust temperature"
                    @click=${() => this._emit('temperature')}
                  >
                    ${formatTemp(view.currentTemp, view.unit)}
                  </button>
                  ${this._renderPill(view)}
                `
              : html`<div class="unavailable">${view.name} unavailable</div>`
          }
        </div>
      </div>
    `;
  }

  private _renderTop(view: HomeView): TemplateResult {
    return html`
      <div class="top">
        ${
          view.weatherAvailable
            ? html`<button
                class="weather"
                aria-label="Weather"
                @click=${() => this._emit('weather')}
              >
                ${icons.sun}
              </button>`
            : nothing
        }
        ${
          view.equipment
            ? html`<div
                class="equip ${view.equipment}"
                aria-label=${this._equipLabel(view.equipment)}
              >
                ${this._equipIcon(view.equipment)}
              </div>`
            : nothing
        }
        <button class="menu" aria-label="Open menu" @click=${() => this._emit('menu')}>
          ${icons.menu}
        </button>
      </div>
    `;
  }

  private _renderPill(view: HomeView): TemplateResult | typeof nothing {
    const hold = view.hold;
    if (!hold || (hold.heat === null && hold.cool === null)) return nothing;
    return html`
      <div class="pill" part="hold-pill">
        ${
          hold.heat !== null
            ? html`<span class="heat">${formatTemp(hold.heat, view.unit)}</span>`
            : nothing
        }
        ${hold.heat !== null && hold.cool !== null ? html`<span class="dash">–</span>` : nothing}
        ${
          hold.cool !== null
            ? html`<span class="cool">${formatTemp(hold.cool, view.unit)}</span>`
            : nothing
        }
        ${
          view.canResume
            ? html`<button
                class="resume"
                aria-label="Resume schedule"
                @click=${() => this._emit('resume')}
              >
                ${icons.close}
              </button>`
            : nothing
        }
      </div>
    `;
  }

  private _equipIcon(equipment: EquipmentStatus): TemplateResult {
    if (equipment === 'cooling') return icons.snowflake;
    if (equipment === 'heating') return icons.heat;
    return icons.idle;
  }

  private _equipLabel(equipment: EquipmentStatus): string {
    if (equipment === 'cooling') return 'Cooling';
    if (equipment === 'heating') return 'Heating';
    return 'Idle';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-home-screen': EcoseeHomeScreen;
  }
}
