import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  setFanModeCall,
  type FanModel,
  type FanOption,
  type MinRuntimeModel,
} from '../climate/fan';
import { icons } from '../icons';
import { emitServiceCall } from './service-call-event';
import { reschedulePickerClose } from './overlay-dismiss';

/**
 * `<ecosee-fan-overlay>` — the Fan sub-screen's content (slotted into
 * <ecosee-overlay>). Laid out as the device is (see docs/reference/fan-mode.jpeg):
 * a "Fan Mode" title, then the On / Auto segmented pill toggle, then — when a
 * `fan_min_on_time` number entity is configured — the minimum-runtime helper copy
 * and its pill. The active fan mode's segment is filled cyan with dark text (the
 * squircle "selected" motif); the rest are cyan on black.
 *
 * Like the System Mode picker (and unlike the Temperature Adjust overlay), this
 * owns no lasting edit state: each choice is a single discrete write. Selecting a
 * fan mode highlights it optimistically on tap (`_pending`, issue #38), emits the
 * shared `ecosee-service-call` with the `climate.set_fan_mode` call, then auto-closes
 * after a brief confirm beat (issue #39) — a correction tap during the beat re-points
 * the pick and restarts it, and tapping the already-active mode commits nothing but
 * still closes.
 *
 * The minimum-runtime pill is a secondary setting on the same screen: tapping it
 * emits `ecosee-fan-runtime-open` — the host pushes ecosee's own list-picker
 * Overlay (`fan-runtime-overlay.ts`) on top, which owns the `number.set_value`
 * write itself and closes back here on confirm (owner request, following
 * ADR-0018's date/time pickers: apply the same custom-styled treatment to the
 * remaining native `<select>` menus). This Fan screen itself stays mounted the
 * whole time — the picker closing pops back to it, not past it — so "set a
 * runtime and a fan mode in one visit" still works exactly as before; there was
 * previously a documented concern that closing this whole screen on a runtime
 * change would feel jarring, which no longer applies now that only the pushed
 * picker closes.
 */
@customElement('ecosee-fan-overlay')
export class EcoseeFanOverlay extends LitElement {
  /** The fan options + optional runtime selector, derived by the host from `hass`. */
  @property({ attribute: false }) model?: FanModel;
  /** The bound climate entity the emitted `set_fan_mode` call targets. */
  @property({ attribute: false }) entityId = '';
  /** The optimistically-chosen fan mode, set on tap so the segment fills before the
   *  device echoes back (issue #38); `null` until a pick. Doubles as the
   *  "a pick is settling" guard until the overlay auto-closes. */
  @state() private _pending: string | null = null;
  /** Handle for the pending auto-close, cancelled if the overlay is torn down first. */
  private _closeTimer?: ReturnType<typeof setTimeout>;

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    /* Title near the top with the controls beneath (fan-mode.jpeg), not a
       vertically-centered cluster. Inline-size container so everything scales with
       cqw off the definite width, with the root's own padding/gap in the fixed unit (calc · --ecosee-u) so they can't couple to the viewport, the real bug — a container-type element resolves its OWN cqw against the viewport (issue #35). */
    .fan {
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
         bottom so the runtime dropdown can't hide behind it — matches
         sensors-overlay.ts's --ecosee-tabbar-inset pattern. This screen stacks
         more content (title + toggle + a 3-line runtime block) than Sensors
         does, so on top of the shared inset it adds its own 3u cushion — the
         shared inset alone left only ~2u of headroom against this screen's
         actual content height, which real font metrics (vs. this file's own
         dev-time measurements) ate into. */
      padding: calc(9 * var(--ecosee-u, 4.6px)) calc(7 * var(--ecosee-u, 4.6px))
        calc(
          var(--ecosee-tabbar-inset, calc(9 * var(--ecosee-u, 4.6px))) + 3 * var(--ecosee-u, 4.6px)
        );
      text-align: center;
    }

    .title {
      margin: 0;
      font-size: 8cqw;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--ecosee-text-accent, #62cfe9);
    }

    /* .content centers the toggle/runtime block within whatever space remains
       below the (fixed-position) title, not the full screen — so a plain
       two-mode fan with no runtime entity doesn't leave a large dead gap
       between the toggle and the tab bar (matching the Home Screen's own
       .cluster). The tightest case (a stacked multi-speed toggle plus the
       3-line runtime block) needs the same total height either way — centering
       doesn't add overflow risk, it only changes where slack space (if any)
       goes. */
    .content {
      width: 100%;
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: calc(4.5 * var(--ecosee-u, 4.6px));
      margin-top: calc(4.5 * var(--ecosee-u, 4.6px));
    }

    /* The On / Auto segmented pill: a cyan-outlined pill holding the segments; the
       selected segment is a filled cyan rounded pill with dark text. Opts back into
       pointer events (the shell makes slotted content transparent so empty areas
       dismiss). */
    .toggle {
      display: inline-flex;
      align-items: stretch;
      border: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 100cqw;
      padding: 1.2cqw;
      pointer-events: auto;
    }

    .segment {
      appearance: none;
      background: none;
      border: none;
      margin: 0;
      font: inherit;
      font-size: 5.5cqw;
      font-weight: 500;
      color: var(--ecosee-text-accent, #62cfe9);
      padding: 2.2cqw 7cqw;
      min-width: 18cqw;
      border-radius: 100cqw;
      cursor: pointer;
    }
    .segment:focus-visible {
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      outline-offset: 0.6cqw;
    }
    /* --ecosee-chip-ink, not --ecosee-bg, so a custom canvas background (config
       background_color) can't make this text illegible. */
    .segment.selected {
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
      cursor: default;
    }

    /* Multi-speed layout (issue #44): past the device's two modes a horizontal pill
       gets cramped, so stack the segments into a proper N-way selector — a rounded
       cyan-outlined panel of full-width capsule segments, the active one filled. Each
       segment keeps the same fill/outline language, so a two-mode fan (the common
       case) is untouched. */
    .toggle.stacked {
      flex-direction: column;
      align-items: stretch;
      gap: 1.2cqw;
      width: 64cqw;
      max-width: 100%;
      border-radius: 9cqw;
    }
    .toggle.stacked .segment {
      min-width: 0;
      width: 100%;
      padding: 2.2cqw 4cqw;
    }

    /* Minimum-runtime block: bold summary line, instructional hint, then the
       dropdown selector. Both text sizes were originally tuned in isolation from
       the rest of the screen and, together with the title + toggle above them,
       ran taller than the space above the shell's tab bar — the hint wrapped to
       three lines and its last line sat behind the tab bar icons. Smaller sizes
       here keep the full block (and the dropdown beneath it) clear of the bar. */
    .runtime {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2.5cqw;
    }
    .summary {
      margin: 0;
      font-size: 5.5cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
    }
    .hint {
      margin: 0;
      font-size: 4.4cqw;
      font-weight: 400;
      line-height: 1.3;
      color: var(--ecosee-text-accent, #62cfe9);
      opacity: 0.85;
    }

    /* Cyan-outlined pill (fan-mode.jpeg), now an ordinary opaque <button> —
       tapping it just emits ecosee-fan-runtime-open (below). There is no
       native form control involved anymore; ecosee's own list-picker Overlay
       (fan-runtime-overlay.ts) replaced the browser's native dropdown. */
    .select-pill {
      appearance: none;
      background: none;
      margin: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 2.4cqw;
      padding: 2.2cqw 6cqw;
      border: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 100cqw;
      color: var(--ecosee-text-accent, #62cfe9);
      font: inherit;
      font-size: 5.3cqw;
      font-weight: 500;
      cursor: pointer;
      pointer-events: auto;
    }
    .select-pill:focus-visible {
      /* Flush against the pill's own border (no outline-offset) so this
         reads as the border getting thicker, not a second detached ring. */
      outline: 0.5cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: inherit;
    }
    .select-label {
      pointer-events: none;
    }
    .caret {
      width: 4.3cqw;
      height: 4.3cqw;
      flex: none;
      color: var(--ecosee-accent, #62cfe9);
      pointer-events: none;
    }
  `;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._closeTimer !== undefined) clearTimeout(this._closeTimer);
  }

  private _selectMode(option: FanOption): void {
    if (this._pending === option.fanMode) return; // already the settling pick — nothing to do
    // Tapping the current fan mode with no pick in flight: nothing to write, but
    // honour "nothing left to do" by closing anyway (issue #39).
    const noChange = this._pending === null && option.selected;
    this._pending = option.fanMode; // fill / hold the segment now (issue #38)
    if (!noChange) emitServiceCall(this, setFanModeCall(option.fanMode, this.entityId));
    this._closeTimer = reschedulePickerClose(this, this._closeTimer); // confirm beat, then close
  }

  /** `.select-pill`'s click handler for the runtime pill — asks the host to
   *  push ecosee's own list-picker Overlay on top (`fan-runtime-overlay.ts`);
   *  that picker owns the write itself and closes back here on confirm. */
  private _openRuntimePicker(): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-fan-runtime-open', { bubbles: true, composed: true }),
    );
  }

  override render(): TemplateResult | typeof nothing {
    const model = this.model;
    if (!model || !model.available) return nothing;
    // Two modes (the device's On / Auto) fit the horizontal pill; more than that
    // (a multi-speed fan: low / medium / high / …) would cram a stretched pill, so
    // stack them into a vertical N-way selector instead (issue #44).
    const stacked = model.options.length > 2;
    return html`
      <div class="fan">
        <h2 class="title">Fan Mode</h2>
        <div class="content">
          <div class="toggle ${stacked ? 'stacked' : ''}" role="group" aria-label="Fan Mode">
            ${model.options.map((option) => {
              // Once a pick is settling, the optimistic choice wins the fill;
              // otherwise it follows the entity's reported fan mode.
              const selected =
                this._pending !== null ? option.fanMode === this._pending : option.selected;
              return html`
                <button
                  class="segment ${selected ? 'selected' : ''}"
                  aria-pressed=${selected}
                  @click=${() => this._selectMode(option)}
                >
                  ${option.label}
                </button>
              `;
            })}
          </div>
          ${this._renderRuntime(model.minRuntime)}
        </div>
      </div>
    `;
  }

  private _renderRuntime(runtime: MinRuntimeModel | null): TemplateResult | typeof nothing {
    if (!runtime) return nothing;
    const current = runtime.options.find((option) => option.selected);
    return html`
      <div class="runtime">
        <p class="summary">${runtime.summary}</p>
        <p class="hint">
          You can change your fan's minimum hourly runtime by tapping the setting below.
        </p>
        <button
          type="button"
          class="select-pill"
          aria-label="Minimum fan runtime, ${current?.label}"
          @click=${this._openRuntimePicker}
        >
          <span class="select-label">${current?.label}</span>
          <span class="caret">${icons.caretDown}</span>
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-fan-overlay': EcoseeFanOverlay;
  }
}
