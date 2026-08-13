import "server-only";

export function monthlySubscriptionAmount(amount: number, frequency: string) {
  if (frequency === "MONTHLY") return amount;
  if (frequency === "QUARTERLY") return amount / 3;
  if (frequency === "SEMI_ANNUAL") return amount / 6;
  if (frequency === "ANNUAL") return amount / 12;
  return 0;
}

function clampedDate(year: number, month: number, day: number) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

export function nextSubscriptionDueDate(subscription: {
  frequency: string;
  startsOn: Date;
  endsOn: Date | null;
  dueDay: number | null;
}, from = new Date()) {
  const today = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  if (subscription.frequency === "ONE_TIME") {
    return subscription.startsOn >= today ? subscription.startsOn : null;
  }

  const monthStep = subscription.frequency === "MONTHLY" ? 1
    : subscription.frequency === "QUARTERLY" ? 3
      : subscription.frequency === "SEMI_ANNUAL" ? 6 : 12;
  let cycle = new Date(Date.UTC(subscription.startsOn.getUTCFullYear(), subscription.startsOn.getUTCMonth(), 1));
  let candidate = clampedDate(cycle.getUTCFullYear(), cycle.getUTCMonth(), subscription.dueDay ?? subscription.startsOn.getUTCDate());
  if (candidate < subscription.startsOn) {
    cycle = new Date(Date.UTC(cycle.getUTCFullYear(), cycle.getUTCMonth() + monthStep, 1));
    candidate = clampedDate(cycle.getUTCFullYear(), cycle.getUTCMonth(), subscription.dueDay ?? subscription.startsOn.getUTCDate());
  }
  while (candidate < today) {
    cycle = new Date(Date.UTC(cycle.getUTCFullYear(), cycle.getUTCMonth() + monthStep, 1));
    candidate = clampedDate(cycle.getUTCFullYear(), cycle.getUTCMonth(), subscription.dueDay ?? subscription.startsOn.getUTCDate());
  }
  if (subscription.endsOn && candidate > subscription.endsOn) return null;
  return candidate;
}

export function calendarDaysBetween(start: Date, end: Date) {
  return Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
}
