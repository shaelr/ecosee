import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { ScheduleModel, ScheduleBlock, ScheduleDayOption } from '../schedule/schedule';
import { icons } from '../icons';

/**
 * `<ecosee-schedule-overlay>` — the Schedule sub-screen's content (slotted into
 * <ecosee-overlay>, ADR-0014). Laid out like the ecobee app's own Schedule screen
 * (owner-supplied reference): a day-of-week strip (S M T W T F S, the selected day
 * a filled circle) above a vertical agenda for that day — one row per contiguous
 * comfort-setting block, each preceded by a small boundary label (a clock time, or
 * "From previous day" for a block already active at midnight), with a trailing
 * "Until next day" label after the last block.
 *
 * Purely presentational: it renders the already-degraded ScheduleModel and emits
 * `ecosee-schedule-day-select` (day strip tap), `ecosee-schedule-block-select`
 * (tapping an editable block), `ecosee-schedule-add-block-open` (the "+"), and
 * `ecosee-schedule-copy-open` ("Copy schedule to another day") for the host to
 * route — day selection re-fetches that day's events; the rest push their own
 * picker (hub-and-picker, matching how the System sub-screen routes to its
 * pickers). A block that continues from the previous day has no in-day
 * predecessor to shrink/merge into (schedule.ts's module doc) and so isn't
 * independently editable here — rendered without a chevron or tap handler.
 */
@customElement('ecosee-schedule-overlay')
export class EcoseeScheduleOverlay extends LitElement {
  /** The already-degraded day strip + block agenda, derived by the host from
   *  `hass` plus the currently-fetched day's raw events. */
  @property({ attribute: false }) model?: ScheduleModel;

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    /* Day strip near the top, the block agenda beneath (matches sensors-overlay's
       breadcrumb-then-list shape). Inline-size container so everything scales with
       cqw off the definite width, with the root's own padding/gap in the fixed unit (calc · --ecosee-u) so they can't couple to the viewport, the real bug — a container-type element resolves its OWN cqw against the viewport (issue #35). */
    .schedule {
      position: relative;
      container-type: inline-size;
      box-sizing: border-box;
      width: var(--ecosee-base-size, 460px);
      height: var(--ecosee-base-size, 460px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      gap: calc(5 * var(--ecosee-u, 4.6px));
      /* Top padding lines the title's own vertical center up with the shell's ✕
         (top: 9u, 9u tall — vertical center 13.5u from the content box's top) —
         the same offset .add (below) already mirrors on the opposite corner. */
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

    /* "+" — add a new block. Mirrors the shell's own ✕ (top-left) at the
       opposite corner: same fixed unit, same size, so the two read as a
       matched pair of header affordances (reference screen: "< Schedule +"). */
    .add {
      appearance: none;
      background: none;
      border: none;
      position: absolute;
      top: calc(9 * var(--ecosee-u, 4.6px));
      right: calc(9 * var(--ecosee-u, 4.6px));
      width: calc(9 * var(--ecosee-u, 4.6px));
      height: calc(9 * var(--ecosee-u, 4.6px));
      padding: calc(1.4 * var(--ecosee-u, 4.6px));
      color: var(--ecosee-accent, #62cfe9);
      cursor: pointer;
      pointer-events: auto;
      z-index: 2;
    }

    /* The Sunday-first day strip. Opts back into pointer events (the shell makes
       slotted content transparent so empty areas dismiss). */
    .days {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2.5cqw;
      pointer-events: auto;
    }
    .day {
      appearance: none;
      background: none;
      border: none;
      margin: 0;
      width: 9cqw;
      height: 9cqw;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font: inherit;
      font-size: 5cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
      cursor: pointer;
    }
    /* --ecosee-chip-ink, not --ecosee-bg, so a custom canvas background (config
       background_color) can't make this text illegible. */
    .day.selected {
      background: var(--ecosee-accent, #62cfe9);
      color: var(--ecosee-chip-ink, #0a0d10);
    }

    /* The agenda. A boundary label (clock time / "From previous day") precedes
       each block; a trailing one ("Until next day") follows the last block. */
    .agenda {
      width: 100%;
      max-height: 60cqw;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 1.6cqw;
      overflow-y: auto;
      pointer-events: auto;
      scrollbar-width: none;
    }
    .agenda::-webkit-scrollbar {
      display: none;
    }
    .boundary {
      margin: 0;
      padding: 0 1cqw;
      font-size: 4.6cqw;
      font-weight: 500;
      color: var(--ecosee-text-muted, #6f96a3);
    }
    .empty {
      margin: 4cqw 0 0;
      font-size: 5cqw;
      color: var(--ecosee-text-muted, #6f96a3);
    }

    /* One block row: a cyan-outlined squircle, matching the Sensors screen's card
       language (this Skin has no per-comfort-setting fill palette — an arbitrary
       custom preset name has no color of its own to draw from). */
    .block {
      appearance: none;
      background: none;
      box-sizing: border-box;
      width: 100%;
      display: flex;
      align-items: center;
      gap: 3.5cqw;
      padding: 3.4cqw 4cqw;
      border: 0.6cqw solid var(--ecosee-accent, #62cfe9);
      border-radius: 5cqw;
      font: inherit;
      cursor: pointer;
    }
    /* A lead-in block (continues from the previous day) has no in-day
       predecessor to edit against — shown, not tappable (schedule.ts doc). */
    .block.static {
      cursor: default;
    }

    .block-icon {
      width: 8cqw;
      height: 8cqw;
      flex: none;
      color: var(--ecosee-accent, #62cfe9);
    }
    .block-name {
      flex: 1;
      min-width: 0;
      text-align: left;
      font-size: 6cqw;
      font-weight: 600;
      color: var(--ecosee-text-accent, #62cfe9);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
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

    .copy {
      appearance: none;
      background: none;
      border: none;
      margin-top: auto;
      padding: 2cqw;
      font: inherit;
      font-size: 4.6cqw;
      font-weight: 600;
      color: var(--ecosee-accent, #62cfe9);
      cursor: pointer;
      pointer-events: auto;
    }
  `;

  private _selectDay(day: ScheduleDayOption): void {
    if (day.selected) return;
    this.dispatchEvent(
      new CustomEvent('ecosee-schedule-day-select', {
        detail: { dayIndex: day.index },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _selectBlock(index: number): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-schedule-block-select', {
        detail: { blockIndex: index },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _openAddBlock(): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-schedule-add-block-open', { bubbles: true, composed: true }),
    );
  }

  private _openCopy(): void {
    this.dispatchEvent(
      new CustomEvent('ecosee-schedule-copy-open', { bubbles: true, composed: true }),
    );
  }

  private _boundaryLabel(block: ScheduleBlock): string {
    if (block.continuesFromPreviousDay) return 'From previous day';
    const hours = Math.floor(block.startMinutes / 60);
    const minutes = block.startMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private _renderBlock(block: ScheduleBlock, index: number): TemplateResult {
    const editable = !block.continuesFromPreviousDay;
    return html`
      <p class="boundary">${this._boundaryLabel(block)}</p>
      <button
        class="block ${editable ? '' : 'static'}"
        ?disabled=${!editable}
        aria-label="${block.comfortSetting}${editable ? ', edit start time' : ''}"
        @click=${editable ? () => this._selectBlock(index) : nothing}
      >
        <span class="block-icon" aria-hidden="true">${icons[block.icon]}</span>
        <span class="block-name">${block.comfortSetting}</span>
        ${editable ? html`<span class="chevron" aria-hidden="true">${icons.chevron}</span>` : nothing}
      </button>
      ${block.continuesIntoNextDay ? html`<p class="boundary">Until next day</p>` : nothing}
    `;
  }

  override render(): TemplateResult | typeof nothing {
    const model = this.model;
    if (!model || !model.available) return nothing;
    return html`
      <div class="schedule">
        <button class="add" aria-label="Add to schedule" @click=${this._openAddBlock}>
          ${icons.plus}
        </button>
        <h2 class="title">Schedule</h2>
        <nav class="days" aria-label="Day of week">
          ${model.days.map(
            (day) => html`
              <button
                class="day ${day.selected ? 'selected' : ''}"
                aria-label=${day.label}
                aria-pressed=${day.selected}
                @click=${() => this._selectDay(day)}
              >
                ${day.label}
              </button>
            `,
          )}
        </nav>
        <div class="agenda" role="list" aria-label="Schedule for the selected day">
          ${
            model.blocks.length === 0
              ? html`<p class="empty">Loading…</p>`
              : repeat(
                  model.blocks,
                  (block, index) => `${block.uid}-${index}`,
                  (block, index) => this._renderBlock(block, index),
                )
          }
        </div>
        <button class="copy" @click=${this._openCopy}>Copy schedule to another day</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecosee-schedule-overlay': EcoseeScheduleOverlay;
  }
}
