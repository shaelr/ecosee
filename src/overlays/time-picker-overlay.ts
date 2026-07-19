import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 30];

/** How many back-to-back copies of a column's values to render so it can
 *  loop: scrolling past the last copy silently jumps back one loop's worth
 *  (`_onListScroll`), landing on identical content, so the wrap is
 *  imperceptible. 5 keeps the visible window comfortably inside copies 2–4
 *  (`CENTER_COPY`), so a user has to scroll roughly two full loops in one
 *  direction before ever approaching a real edge. */
const LOOP_COPIES = 5;
const CENTER_COPY = Math.floor(LOOP_COPIES / 2);

function repeated(values: readonly number[]): number[] {
  return Array.from({ length: values.length * LOOP_COPIES }, (_, i) => values[i % values.length]!);
}

const HOUR_ROWS = repeated(HOURS);
const MINUTE_ROWS = repeated(MINUTES);

/** Positive modulo (JS's `%` can return negative) — used to fold an unbounded
 *  "which loop iteration" counter (`_hourCopy`/`_minuteCopy`, see their own
 *  doc comment) back into a real `[0, LOOP_COPIES)` copy index. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Pure decision logic behind the loop: given a list's current `scrollTop`,
 *  its total `scrollHeight`, and its visible `clientHeight` (`copies`
 *  back-to-back identical copies of the same content), returns the
 *  `scrollTop` to jump to once the *viewport* has scrolled into the first or
 *  last copy, or `scrollTop` unchanged otherwise. Split out from the DOM
 *  event handler (`_onListScroll`) so the actual wrap math can be
 *  unit-tested directly, without a real browser layout engine to produce
 *  meaningful `scrollHeight`/`clientHeight` values — the same DOM-measure/
 *  pure-decision split `styles/font-probe.ts` uses.
 *
 *  The trigger compares the viewport's *edges* (`scrollTop` and `scrollTop +
 *  clientHeight`) against the first/last copy boundary, not a fixed offset
 *  from `scrollTop` alone (issue: the Minute column, with only 2 values, has
 *  a `clientHeight` that is a large fraction of one whole copy's height, so
 *  a fixed "half a loop height past `scrollTop` 0" threshold sat beyond the
 *  scrollable range entirely — the down-loop could never trigger, only up).
 *  Comparing edges keeps the trigger reachable regardless of how few rows a
 *  column has relative to its visible window. A non-positive `scrollHeight`
 *  (no real layout, e.g. an untested/detached element) is a no-op rather
 *  than a division by zero. */
export function loopScrollTop(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  copies = LOOP_COPIES,
): number {
  const loopHeight = scrollHeight / copies;
  if (loopHeight <= 0) return scrollTop;
  if (scrollTop < loopHeight) return scrollTop + loopHeight;
  if (scrollTop + clientHeight > scrollHeight - loopHeight) return scrollTop - loopHeight;
  return scrollTop;
}

/**
 * `<ecosee-time-picker-overlay>` — ecosee's own time picker (ADR-0018), replacing
 * the browser's native `<input type="time">` picker everywhere ecosee edits a
 * time value (Schedule's Start/End when adding a block, and a block's own Start
 * Time when editing it). Two independent scrollable columns — Hour (00–23) and
 * Minute (00/30, matching the schedule's own 30-minute grid) — plus an explicit
 * Confirm button: two independent selections can't cleanly auto-confirm on a
 * single tap the way a one-column picker (System Mode, Comfort Setting) can,
 * since picking only the hour or only the minute isn't yet a complete value
 * (owner correction: a brief auto-confirm-after-tap experiment made it too
 * easy to close the picker after adjusting only one of the two columns).
 *
 * Both columns loop (owner request, following up on the ADR-0018 pickers
 * shipping): scrolling past the last hour wraps to the first and vice versa,
 * like a wheel. A plain `overflow: auto` list has no native "loop" behavior,
 * so each column renders its values repeated `LOOP_COPIES` times back to
 * back and `_onListScroll` silently resets `scrollTop` by one loop's worth
 * whenever the user scrolls into the first or last copy — since every copy
 * is identical content, the reset is imperceptible, and the visible window
 * stays put while the underlying scroll position "teleports" back toward
 * the middle. This is the standard infinite-carousel trick, not a real
 * infinite list — `LOOP_COPIES` just needs to be large enough that a single
 * scroll gesture can't outrun the reset, which 5 comfortably covers for a
 * touch/wheel-driven picker.
 *
 * Purely presentational: it owns no schedule-editing logic itself and emits
 * `ecosee-time-picker-confirm` for the host to apply. There is no cancel
 * affordance of its own — the shell's own ✕ is the only dismiss path, matching
 * every other Overlay.
 */
@customElement('ecosee-time-picker-overlay')
export class EcoseeTimePickerOverlay extends LitElement {
  /** Seed value: minutes since local midnight. */
  @property({ attribute: false }) minutes = 0;

  @state() private _hour = 0;
  @state() private _minute = 0;

  /** Which *physical* copy (of the `LOOP_COPIES` back-to-back repeats) is
   *  the one currently carrying the "selected" highlight — not just which
   *  value is selected. Both columns render every repeat of a value's row,
   *  so with only 2 Minute values a 3-row viewport can show two different
   *  copies of the same value at once; marking every row with a matching
   *  *value* as selected (the original approach) highlighted both. Tracking
   *  a specific copy instead — the one actually tapped, or `CENTER_COPY`
   *  where `_centerOn` starts every seeded value — keeps exactly one row lit
   *  at a time. Deliberately unbounded (not clamped to `[0, LOOP_COPIES)`):
   *  `_onListScroll` nudges it by ±1 on every wrap so it keeps tracking the
   *  same *visual* row across any number of wraps in either direction (a
   *  forward wrap re-backs a given screen position with the next copy over,
   *  so the tracked index must follow); `mod()` folds it back into a real
   *  copy index only at comparison time (render). */
  @state() private _hourCopy = CENTER_COPY;
  @state() private _minuteCopy = CENTER_COPY;

  @query('.list-hour') private _hourList?: HTMLElement;
  @query('.list-minute') private _minuteList?: HTMLElement;

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
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: calc(5 * var(--ecosee-u, 4.6px));
      padding: calc(9 * var(--ecosee-u, 4.6px)) calc(8 * var(--ecosee-u, 4.6px))
        calc(7 * var(--ecosee-u, 4.6px));
      text-align: center;
    }

    .title {
      margin: 0;
      font-size: 7.5cqw;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--ecosee-text-accent, #62cfe9);
    }

    .columns {
      width: 100%;
      display: flex;
      justify-content: center;
      gap: 5cqw;
      pointer-events: auto;
    }
    .column {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2cqw;
    }
    .column-label {
      font-size: 4.4cqw;
      font-weight: 500;
      color: var(--ecosee-text, #d4eff9);
    }

    /* The scrollable column itself — the same cyan-outlined, vertically-clipped
       list comfort-setting-overlay.ts's own picker uses, narrowed to fit two
       side by side. overflow: hidden auto (not a bare overflow-y) pins the
       x-axis so a column never grows a horizontal scrollbar of its own.
       scrollbar-width/::-webkit-scrollbar hide the *track* (still scrollable
       by touch/wheel/drag either way) — a visible OS scrollbar reads as
       browser chrome bleeding through the device's own squircle silhouette,
       not a physical wheel-picker groove. */
    .list {
      width: 28cqw;
      max-height: 58cqw;
      overflow: hidden auto;
      border: 0.6cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 6cqw;
      pointer-events: auto;
      scrollbar-width: none;
    }
    .list::-webkit-scrollbar {
      display: none;
    }
    .option {
      appearance: none;
      background: none;
      margin: 0;
      box-sizing: border-box;
      width: 100%;
      padding: 4cqw 2cqw;
      font: inherit;
      font-size: 6.5cqw;
      font-weight: 500;
      color: var(--ecosee-text-accent, #62cfe9);
      text-align: center;
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
    /* Selected row: filled cyan with dark text, matching every other picker's
       selected-row treatment (system-mode-overlay.ts, comfort-setting-overlay.ts).
       Applied to exactly one of the LOOP_COPIES repeats of the current value
       — the one _hourCopy/_minuteCopy tracks (its own doc comment) — not
       every repeat, or a short-cycling column (Minute: just 00/30) could
       show two lit rows at once within the same viewport. */
    .option.selected {
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
      cursor: default;
    }

    .confirm {
      appearance: none;
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
      border: none;
      margin-top: auto;
      padding: 2.2cqw 8cqw;
      border-radius: 100cqw;
      font: inherit;
      font-size: 5cqw;
      font-weight: 600;
      cursor: pointer;
      pointer-events: auto;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    // Seed the buffered selection once from the incoming value — a property,
    // not yet set at construction time, mirroring every other picker's own
    // "default on connect" pattern (schedule-add-block-overlay.ts's Comfort
    // Setting default, etc.).
    this._hour = Math.floor(this.minutes / 60);
    this._minute = this.minutes % 60;
  }

  /** Centers both columns on their seeded value, in the middle copy
   *  (`CENTER_COPY`) of the repeated list — not just "somewhere the value
   *  appears" — so there's equal room to scroll in either direction before
   *  `_onListScroll` ever needs to wrap. Only on first render; a later
   *  selection re-renders the highlighted row but must not re-scroll the
   *  user's own in-progress scroll position. */
  protected override firstUpdated(): void {
    this._centerOn(this._hourList, HOURS, this._hour);
    this._centerOn(this._minuteList, MINUTES, this._minute);
  }

  private _centerOn(list: HTMLElement | undefined, values: readonly number[], value: number): void {
    if (!list) return;
    const index = values.indexOf(value);
    if (index === -1) return;
    const rowHeight = list.scrollHeight / (values.length * LOOP_COPIES);
    const targetRow = CENTER_COPY * values.length + index;
    list.scrollTop = rowHeight * targetRow - (list.clientHeight - rowHeight) / 2;
  }

  /** The loop itself: hands the list's current scroll position to
   *  `loopScrollTop` (the pure decision logic) and applies whatever it
   *  returns. Runs on every `scroll` event rather than only once the user
   *  stops, so a long fling can't outrun it mid-gesture. A wrap also nudges
   *  `_hourCopy` by ±1 (its own doc comment) — forward (scrollTop increases)
   *  advances it, backward retreats it — so the "selected" highlight keeps
   *  following the same visual row through the teleport. */
  private _onHourScroll(event: Event): void {
    const list = event.currentTarget as HTMLElement;
    const next = loopScrollTop(list.scrollTop, list.scrollHeight, list.clientHeight);
    if (next > list.scrollTop) this._hourCopy += 1;
    else if (next < list.scrollTop) this._hourCopy -= 1;
    list.scrollTop = next;
  }

  /** Same as `_onHourScroll`, for the Minute column's own `_minuteCopy`. */
  private _onMinuteScroll(event: Event): void {
    const list = event.currentTarget as HTMLElement;
    const next = loopScrollTop(list.scrollTop, list.scrollHeight, list.clientHeight);
    if (next > list.scrollTop) this._minuteCopy += 1;
    else if (next < list.scrollTop) this._minuteCopy -= 1;
    list.scrollTop = next;
  }

  private _selectHour(hour: number, copy: number): void {
    this._hour = hour;
    this._hourCopy = copy;
  }

  private _selectMinute(minute: number, copy: number): void {
    this._minute = minute;
    this._minuteCopy = copy;
  }

  private _confirm(): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-time-picker-confirm', {
        detail: { minutes: this._hour * 60 + this._minute },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render(): TemplateResult {
    return html`
      <div class="picker">
        <h2 class="title">Time</h2>
        <div class="columns">
          <div class="column">
            <span class="column-label">Hour</span>
            <div
              class="list list-hour"
              role="listbox"
              aria-label="Hour"
              @scroll=${this._onHourScroll}
            >
              ${HOUR_ROWS.map((hour, i) => {
                const copy = Math.floor(i / HOURS.length);
                const selected = hour === this._hour && copy === mod(this._hourCopy, LOOP_COPIES);
                return html`
                  <button
                    type="button"
                    class="option ${selected ? 'selected' : ''}"
                    role="option"
                    aria-selected=${selected}
                    @click=${() => this._selectHour(hour, copy)}
                  >
                    ${String(hour).padStart(2, '0')}
                  </button>
                `;
              })}
            </div>
          </div>
          <div class="column">
            <span class="column-label">Minute</span>
            <div
              class="list list-minute"
              role="listbox"
              aria-label="Minute"
              @scroll=${this._onMinuteScroll}
            >
              ${MINUTE_ROWS.map((minute, i) => {
                const copy = Math.floor(i / MINUTES.length);
                const selected =
                  minute === this._minute && copy === mod(this._minuteCopy, LOOP_COPIES);
                return html`
                  <button
                    type="button"
                    class="option ${selected ? 'selected' : ''}"
                    role="option"
                    aria-selected=${selected}
                    @click=${() => this._selectMinute(minute, copy)}
                  >
                    ${String(minute).padStart(2, '0')}
                  </button>
                `;
              })}
            </div>
          </div>
        </div>
        <button class="confirm" @click=${this._confirm}>Confirm</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-time-picker-overlay': EcoseeTimePickerOverlay;
  }
  interface HTMLElementEventMap {
    'ecosee-time-picker-confirm': CustomEvent<{ minutes: number }>;
    /** Emitted by whichever field wants to edit a time value (Add to
     *  Schedule's Start/End, a schedule block's own Start Time) — not by
     *  this component itself, but declared here as the single source of
     *  truth for the shared shape every emitter uses. `target` identifies
     *  which field the host should route the eventual confirm back into. */
    'ecosee-time-picker-open': CustomEvent<{
      target: 'add-block-start' | 'add-block-end' | 'schedule-start-time';
    }>;
  }
}
