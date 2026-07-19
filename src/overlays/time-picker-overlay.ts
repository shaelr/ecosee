import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 30];

/** How many back-to-back copies of a column's values to render so it can
 *  loop: scrolling past the last copy silently jumps back one loop's worth,
 *  landing on identical content, so the wrap is imperceptible. Deliberately
 *  generous (not the smallest value that technically works): the actual
 *  reset only happens once scrolling *settles* (`SCROLL_SETTLE_MS`, this
 *  file's own mobile-flicker fix below), not on every scroll tick, so the
 *  buffer has to survive a full drag-plus-momentum gesture in one go rather
 *  than just the distance between two scroll events. 11 keeps the visible
 *  window comfortably inside copies 3–7 (`CENTER_COPY`) even on Minute's
 *  short 2-value cycle, where a single real fling can otherwise span several
 *  of its short "loops" at once. */
export const LOOP_COPIES = 11;
const CENTER_COPY = Math.floor(LOOP_COPIES / 2);

/** How long to wait, after the *last* scroll event, before treating a scroll
 *  gesture as settled and safe to correct for the loop (`_onHourScroll`'s
 *  own doc comment for why). Long enough that a real drag/momentum gesture's
 *  in-between events (which fire well under 100ms apart) never look settled
 *  mid-gesture; short enough that the correction — invisible either way,
 *  since it only ever jumps by whole copies of identical content — never
 *  reads as a deliberate delay. */
export const SCROLL_SETTLE_MS = 120;

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
 *  column has relative to its visible window.
 *
 *  Corrects by as many `loopHeight`s as needed in one call, not just one —
 *  mobile browsers throttle/batch `scroll` dispatches, so a single event can
 *  span more scroll distance than one `loopHeight` covers. That's rare for
 *  Hour (24 rows per copy) but routine for Minute (just 2), which is why the
 *  flicker this fixes was Minute-only: a single-step correction under-shot,
 *  leaving the tracked "selected" copy briefly wrong until later events
 *  caught it up — visible as the highlight hopping across rows. The
 *  iteration cap is defensive only (a real drift never needs more than a
 *  handful of steps); it keeps a degenerate config (`clientHeight` too large
 *  for any position to ever be "safe") from looping forever. A non-positive
 *  `scrollHeight` (no real layout, e.g. an untested/detached element) is a
 *  no-op rather than a division by zero. */
export function loopScrollTop(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  copies = LOOP_COPIES,
): number {
  const loopHeight = scrollHeight / copies;
  if (loopHeight <= 0) return scrollTop;
  let next = scrollTop;
  const maxSteps = copies * 2;
  for (let steps = 0; next < loopHeight && steps < maxSteps; steps++) next += loopHeight;
  for (
    let steps = 0;
    next + clientHeight > scrollHeight - loopHeight && steps < maxSteps;
    steps++
  ) {
    next -= loopHeight;
  }
  return next;
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
 * back and, once a scroll gesture *settles* (`SCROLL_SETTLE_MS` — not on
 * every scroll event; see `_onHourScroll`'s own doc comment for why),
 * silently resets `scrollTop` by however many loop-heights are needed
 * whenever the user has scrolled into the first or last copy — since every
 * copy is identical content, the reset is imperceptible, and the visible
 * window stays put while the underlying scroll position "teleports" back
 * toward the middle. This is the standard infinite-carousel trick, not a
 * real infinite list — `LOOP_COPIES`' own doc comment covers why it's more
 * generous than the bare minimum.
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

  /** Pending "gesture settled" checks (`SCROLL_SETTLE_MS`), cancelled and
   *  restarted on every scroll event of their own column. */
  private _hourSettleTimer?: ReturnType<typeof setTimeout>;
  private _minuteSettleTimer?: ReturnType<typeof setTimeout>;

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

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._hourSettleTimer !== undefined) clearTimeout(this._hourSettleTimer);
    if (this._minuteSettleTimer !== undefined) clearTimeout(this._minuteSettleTimer);
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

  /** The loop's trigger: (re)schedules a "gesture settled" check
   *  `SCROLL_SETTLE_MS` after the *last* scroll event, cancelling any check
   *  already pending — so a continuous drag or momentum glide, whose events
   *  fire far more often than that, never actually runs the correction
   *  mid-gesture.
   *
   *  This — not correcting on every scroll event, as an earlier version of
   *  this fix did — is what actually stops the flicker reported on mobile:
   *  writing `scrollTop` (or even calling `scrollTo`) while a touch-driven
   *  scroll is still animating fights the browser's own native scroll
   *  physics, which run on a separate thread from JS on iOS Safari in
   *  particular. Two correct-looking scrollTop values a JS-timed frame apart
   *  can still show a visible glitch when one of them lands mid-animation;
   *  deferring the correction until nothing is animating avoids that
   *  category of conflict entirely, not just the render-timing race the
   *  earlier version of this fix addressed (which was real, but not the
   *  whole story). `LOOP_COPIES`'s own doc comment covers the follow-on
   *  cost: settling only at the end means the buffer has to survive a whole
   *  gesture, not just the gap between two events. */
  private _onHourScroll(event: Event): void {
    const list = event.currentTarget as HTMLElement;
    if (this._hourSettleTimer !== undefined) clearTimeout(this._hourSettleTimer);
    this._hourSettleTimer = setTimeout(() => this._settleHourScroll(list), SCROLL_SETTLE_MS);
  }

  /** Same as `_onHourScroll`, for the Minute column's own `_minuteSettleTimer`. */
  private _onMinuteScroll(event: Event): void {
    const list = event.currentTarget as HTMLElement;
    if (this._minuteSettleTimer !== undefined) clearTimeout(this._minuteSettleTimer);
    this._minuteSettleTimer = setTimeout(() => this._settleMinuteScroll(list), SCROLL_SETTLE_MS);
  }

  /** Runs once the Hour column's scroll gesture has settled
   *  (`_onHourScroll`'s own doc comment): hands the list's current,
   *  now-static scroll position to `loopScrollTop` (the pure decision
   *  logic) and, if a correction is needed, moves the "selected" highlight
   *  via `_shiftSelectedRow` and applies the corrected position in the same
   *  synchronous tick — both still matter even though the write no longer
   *  races live scroll animation: the highlight must move in lockstep with
   *  the jump regardless of when it happens, and `scrollTo({behavior:
   *  'instant'})` (not a bare `scrollTop =`) makes the jump itself an
   *  explicit, non-animated write rather than one that could inherit an
   *  ambient smooth-scroll behavior. */
  private _settleHourScroll(list: HTMLElement): void {
    this._hourSettleTimer = undefined;
    const next = loopScrollTop(list.scrollTop, list.scrollHeight, list.clientHeight);
    const steps = this._loopSteps(next, list.scrollTop, list.scrollHeight);
    if (steps === 0) return;
    this._hourCopy = this._shiftSelectedRow(list, HOURS, this._hour, this._hourCopy, steps);
    list.scrollTo({ top: next, behavior: 'instant' });
  }

  /** Same as `_settleHourScroll`, for the Minute column's own `_minuteCopy`. */
  private _settleMinuteScroll(list: HTMLElement): void {
    this._minuteSettleTimer = undefined;
    const next = loopScrollTop(list.scrollTop, list.scrollHeight, list.clientHeight);
    const steps = this._loopSteps(next, list.scrollTop, list.scrollHeight);
    if (steps === 0) return;
    this._minuteCopy = this._shiftSelectedRow(list, MINUTES, this._minute, this._minuteCopy, steps);
    list.scrollTo({ top: next, behavior: 'instant' });
  }

  /** How many whole `loopHeight`s `loopScrollTop` just corrected by —
   *  `Math.round`, not a division left as a float, since floating-point
   *  drift could otherwise land a hair off an exact integer. */
  private _loopSteps(next: number, prevScrollTop: number, scrollHeight: number): number {
    const loopHeight = scrollHeight / LOOP_COPIES;
    if (loopHeight <= 0) return 0;
    return Math.round((next - prevScrollTop) / loopHeight);
  }

  /** Moves the `.selected`/`aria-selected` DOM state from `oldCopy` to
   *  `oldCopy + steps` — see `_onHourScroll`'s own doc comment for why this
   *  must be a direct, synchronous DOM update rather than a `@state`-driven
   *  re-render, and why `steps` isn't always ±1. Returns the new copy index
   *  (still unbounded — `mod()`'d only at comparison time, matching
   *  `_hourCopy`/`_minuteCopy`'s own doc comment). */
  private _shiftSelectedRow(
    list: HTMLElement,
    values: readonly number[],
    value: number,
    oldCopy: number,
    steps: number,
  ): number {
    const newCopy = oldCopy + steps;
    const valueIndex = values.indexOf(value);
    if (valueIndex !== -1) {
      const oldRow = list.children[mod(oldCopy, LOOP_COPIES) * values.length + valueIndex];
      const newRow = list.children[mod(newCopy, LOOP_COPIES) * values.length + valueIndex];
      oldRow?.classList.remove('selected');
      oldRow?.setAttribute('aria-selected', 'false');
      newRow?.classList.add('selected');
      newRow?.setAttribute('aria-selected', 'true');
    }
    return newCopy;
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
