import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type {
  ComfortIcon,
  ComfortSettingModel,
  ComfortSettingOption,
} from '../climate/comfort-setting';
import { icons } from '../icons';
import { reschedulePickerClose } from './overlay-dismiss';

/** Maps a derived glyph key onto a Skin icon — the same map
 *  `comfort-setting-overlay.ts` uses, duplicated rather than shared since
 *  the two components' confirm semantics differ (see class doc comment) and
 *  this codebase's own convention keeps each picker Overlay bespoke. */
const GLYPHS: Record<ComfortIcon, TemplateResult> = {
  home: icons.home,
  away: icons.away,
  sleep: icons.sleep,
  comfort: icons.comfort,
};

/**
 * `<ecosee-add-block-comfort-overlay>` — the Comfort Setting picker for the
 * "+" Add to Schedule flow (ADR-0014), reached by tapping the Comfort
 * Setting pill on that screen. Visually identical to
 * `comfort-setting-overlay.ts` (the same icon+label segmented list) — the
 * same already-proven "tap a pill → push a list → tap a row → auto-close"
 * shape, applied here (owner request, following the ADR-0018 date/time
 * pickers: replace the remaining native `<select>` menus).
 *
 * The one real difference from `comfort-setting-overlay.ts`: picking a
 * Comfort Setting here must **not** write to the bound entity — Add to
 * Schedule is still just configuring a new, not-yet-submitted block, not
 * changing what comfort setting is active right now. So instead of
 * `emitServiceCall`, `_select` dispatches `ecosee-add-block-comfort-confirm`
 * with the picked preset, which the host applies to its own buffered
 * `_addBlockComfortSetting` state (mirroring `_onTimePickerConfirm`'s
 * `'add-block-start'`/`'add-block-end'` branches, ADR-0018) — still through
 * the same optimistic-highlight-then-confirm-beat-close rhythm
 * (`reschedulePickerClose`) as every other picker.
 */
@customElement('ecosee-add-block-comfort-overlay')
export class EcoseeAddBlockComfortOverlay extends LitElement {
  /** The bound entity's Comfort Settings, with `selected` already remapped
   *  by the host to reflect the in-progress block's own pick
   *  (`_addBlockComfortSetting`), not the entity's actual current preset —
   *  see `ecosee-card.ts`'s `'add-block-comfort'` render entry. */
  @property({ attribute: false }) model?: ComfortSettingModel;
  /** The optimistically-chosen preset, set on tap so the highlight moves
   *  immediately; `null` until a pick. Doubles as the "a pick is settling"
   *  guard until the overlay auto-closes. */
  @state() private _pending: string | null = null;
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
      width: 68cqw;
      max-height: 80cqw;
      overflow: hidden auto;
      border: 0.6cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 6cqw;
      pointer-events: auto;
    }

    .option {
      appearance: none;
      background: none;
      margin: 0;
      box-sizing: border-box;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 3.5cqw;
      padding: 4.5cqw 4cqw;
      font: inherit;
      font-size: 7.5cqw;
      font-weight: 500;
      color: var(--ecosee-text-accent, #62cfe9);
      text-align: left;
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

    .glyph {
      width: 7.5cqw;
      height: 7.5cqw;
      flex: none;
    }

    .label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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

  private _select(option: ComfortSettingOption): void {
    if (this._pending === option.preset) return; // already the settling pick — nothing to do
    // Tapping the current Comfort Setting with no pick in flight: nothing to
    // confirm, but honour "nothing left to do" by closing anyway (issue #39).
    const noChange = this._pending === null && option.selected;
    this._pending = option.preset; // move / hold the highlight now
    if (!noChange) {
      this.dispatchEvent(
        new CustomEvent('ecosee-add-block-comfort-confirm', {
          detail: { comfortSetting: option.preset },
          bubbles: true,
          composed: true,
        }),
      );
    }
    this._closeTimer = reschedulePickerClose(this, this._closeTimer); // confirm beat, then close
  }

  override render(): TemplateResult | typeof nothing {
    const model = this.model;
    if (!model || !model.available) return nothing;
    return html`
      <div class="picker">
        <div class="list" role="group" aria-label="Comfort Setting">
          ${model.options.map((option) => {
            const selected =
              this._pending !== null ? option.preset === this._pending : option.selected;
            return html`
              <button
                class="option ${selected ? 'selected' : ''}"
                aria-pressed=${selected}
                @click=${() => this._select(option)}
              >
                <span class="glyph">${GLYPHS[option.icon]}</span>
                <span class="label">${option.label}</span>
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
    'ecosee-add-block-comfort-overlay': EcoseeAddBlockComfortOverlay;
  }
  interface HTMLElementEventMap {
    /** Emitted by Add to Schedule's Comfort Setting pill — not by this
     *  component itself — asking the host to push this picker. */
    'ecosee-add-block-comfort-open': CustomEvent<void>;
    'ecosee-add-block-comfort-confirm': CustomEvent<{ comfortSetting: string }>;
  }
}
