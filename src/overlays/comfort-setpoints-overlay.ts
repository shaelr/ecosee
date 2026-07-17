import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  formatSetpointValue,
  type ComfortSetpointsModel,
  type ComfortSetpointPreset,
  type ComfortSetpointValue,
} from '../climate/comfort-setpoint';
import type { Setpoint } from '../climate/temperature-adjust';
import { icons } from '../icons';

/** `ecosee-comfort-setpoint-select` detail: which field of which Comfort
 *  Setting the user tapped, so the host can look up its `ComfortSetpointValue`
 *  and push the single-value picker (`comfort-setpoint-overlay.ts`). */
export interface ComfortSetpointSelectDetail {
  preset: string;
  field: Setpoint;
}

/**
 * `<ecosee-comfort-setpoints-overlay>` — the Comfort Setpoints Main Menu
 * section's content (slotted into <ecosee-overlay>, ADR-0015). Laid out like the
 * Sensors sub-screen (`sensors-overlay.ts`): a "Setpoints" title (the section's
 * own name — no separate "Main Menu" breadcrumb, matching Fan/Schedule's
 * single-title header), then a scrollable vertical stack of cyan-outlined
 * cards, one per configured Comfort
 * Setting. Each card carries the setting's own glyph/name and up to two small
 * value pills (Heat amber, Cool blue, matching the Temperature Adjust overlay's
 * own setpoint tinting) — tapping a pill emits `ecosee-comfort-setpoint-select`
 * for the host to open the single-value picker.
 *
 * Purely presentational: it renders the already-degraded ComfortSetpointsModel
 * and owns no edit state itself — each field's current value is exactly what
 * `hass` last reported, same as the Comfort Setting picker.
 */
@customElement('ecosee-comfort-setpoints-overlay')
export class EcoseeComfortSetpointsOverlay extends LitElement {
  @property({ attribute: false }) model?: ComfortSetpointsModel;

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .setpoints {
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
         value schedule-overlay.ts uses). */
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
       (fixed-position) title, not the full screen — so one or two Comfort
       Settings don't leave a large dead gap between the list and the tab bar
       (matching the Home Screen's own .cluster). A long list still hits
       .list's own max-height and scrolls exactly as before; .content only
       changes where a SHORT list sits. */
    .content {
      width: 100%;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin-top: calc(5 * var(--ecosee-u, 4.6px));
    }

    /* Full width (matching schedule-overlay.ts's own agenda) rather than a
       further-inset 84cqw — the container's own horizontal padding is
       already the inset. max-height matches schedule-overlay.ts's own
       agenda cap. */
    .list {
      width: 100%;
      max-height: 60cqw;
      display: flex;
      flex-direction: column;
      gap: 3cqw;
      overflow-y: auto;
      pointer-events: auto;
      scrollbar-width: none;
    }
    .list::-webkit-scrollbar {
      display: none;
    }

    .card {
      box-sizing: border-box;
      flex: none;
      display: flex;
      align-items: center;
      gap: 3.5cqw;
      padding: 3.4cqw 4cqw;
      border: 0.6cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 5cqw;
    }
    .card-icon {
      width: 8cqw;
      height: 8cqw;
      flex: none;
      color: var(--ecosee-accent, #62cfe9);
    }
    .name {
      flex: 1;
      min-width: 0;
      font-size: 6cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .fields {
      flex: none;
      display: flex;
      gap: 2cqw;
    }
    .field {
      appearance: none;
      background: none;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 1.2cqw;
      padding: 1.6cqw 2.8cqw;
      border-radius: 100cqw;
      font: inherit;
      font-size: 4.6cqw;
      font-weight: 600;
      cursor: pointer;
      pointer-events: auto;
    }
    .field .glyph {
      width: 4.4cqw;
      height: 4.4cqw;
      flex: none;
    }
    .field.heat {
      border: 0.5cqw solid var(--ecosee-heat, #f3a13c);
      color: var(--ecosee-heat, #f3a13c);
    }
    .field.cool {
      border: 0.5cqw solid var(--ecosee-cool, #49b6ea);
      color: var(--ecosee-cool, #49b6ea);
    }
  `;

  private _select(preset: string, field: Setpoint): void {
    this.dispatchEvent(
      new CustomEvent<ComfortSetpointSelectDetail>('ecosee-comfort-setpoint-select', {
        detail: { preset, field },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderField(
    preset: string,
    field: Setpoint,
    value: ComfortSetpointValue | null,
  ): TemplateResult | typeof nothing {
    if (!value) return nothing;
    const glyph = field === 'cool' ? icons.snowflake : icons.heat;
    const label = `${field === 'cool' ? 'Cool' : 'Heat'} setpoint for ${preset}`;
    return html`
      <button class="field ${field}" aria-label=${label} @click=${() => this._select(preset, field)}>
        <span class="glyph">${glyph}</span>${formatSetpointValue(value.edit.value)}
      </button>
    `;
  }

  private _renderCard(preset: ComfortSetpointPreset): TemplateResult {
    return html`
      <div class="card" role="listitem">
        <span class="card-icon" aria-hidden="true">${icons[preset.icon]}</span>
        <span class="name">${preset.label}</span>
        <div class="fields">
          ${this._renderField(preset.preset, 'heat', preset.heat)}
          ${this._renderField(preset.preset, 'cool', preset.cool)}
        </div>
      </div>
    `;
  }

  override render(): TemplateResult | typeof nothing {
    const model = this.model;
    if (!model || !model.available) return nothing;
    return html`
      <div class="setpoints">
        <h2 class="title">Setpoints</h2>
        <div class="content">
          <div class="list" role="list" aria-label="Comfort Setting setpoints">
            ${repeat(
              model.presets,
              (preset) => preset.preset,
              (preset) => this._renderCard(preset),
            )}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-comfort-setpoints-overlay': EcoseeComfortSetpointsOverlay;
  }
  interface HTMLElementEventMap {
    'ecosee-comfort-setpoint-select': CustomEvent<ComfortSetpointSelectDetail>;
  }
}
