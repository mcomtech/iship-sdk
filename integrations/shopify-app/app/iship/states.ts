/**
 * The life of a Shipment row.
 *
 *   new ──► awaiting_payment ──(orders/paid)──► new
 *    │
 *    ├──► ready ──(merchant clicks Create)──► queued      [manual mode]
 *    ├──► queued                                          [automatic mode]
 *    ├──► needs_review ──(merchant fixes, retries)──► queued
 *    └──► skipped / cancelled
 *
 *   queued ──► created ──► fulfilled ──(status sync)──► fulfilled …
 *      └────► needs_review   (iShip refused it)
 */
export const State = {
  New: "new",
  AwaitingPayment: "awaiting_payment",
  Ready: "ready",
  Queued: "queued",
  NeedsReview: "needs_review",
  Created: "created",
  Fulfilled: "fulfilled",
  Cancelled: "cancelled",
  Skipped: "skipped",
} as const;

export type State = (typeof State)[keyof typeof State];

/** States the worker picks up when `runAfter` has passed. */
export const WORKING_STATES: State[] = [State.New, State.Queued, State.Created];

/** States in which no parcel exists yet, so the order can simply be dropped. */
export const PRE_SHIPMENT_STATES: State[] = [
  State.New,
  State.AwaitingPayment,
  State.Ready,
  State.Queued,
  State.NeedsReview,
];
