export function hms(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function ms(msValue: number): string {
  const total = Math.floor(msValue / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function clock(t: number): string {
  return new Date(t).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

export const int = (n: number) => Math.round(n).toLocaleString();

export const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Stable display token for a badge, for when names must not be shown. */
export function pseudonym(badgeId: string): string {
  let h = 0;
  for (let i = 0; i < badgeId.length; i++) h = (h * 31 + badgeId.charCodeAt(i)) >>> 0;
  return `OP-${(h % 9000 + 1000).toString()}`;
}

/** 24h HH:MM. */
export function hhmm(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Label for hour slot i on the 24h axis that starts at dayStart: "17:00". */
export function hourLabel(dayStart: number, i: number): string {
  return hhmm(dayStart + i * 3_600_000);
}

export function minutes(msValue: number): string {
  const m = Math.round(msValue / 60_000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Minutes (as a number) for display; under a minute shows seconds, so a short outage is never "0 min". */
export function mins(m: number): string {
  if (m <= 0) return '0 min';
  if (m < 1) return `${Math.max(1, Math.round(m * 60))} s`;
  return minutes(m * 60_000);
}

export const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Money, whole units — reports are read at a glance, not reconciled to the cent. */
export function cur(n: number, currency: string): string {
  const v = Math.round(n);
  try {
    return new Intl.NumberFormat([], { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${currency} ${v.toLocaleString()}`;
  }
}

/** Money with cents, for per-line figures where the cents are the whole story. */
export function cur2(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat([], { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Signed money, so an over-spend reads as "+" without the reader doing the sign in their head. */
export const curSigned = (n: number, currency: string) => `${n >= 0 ? '+' : '−'}${cur(Math.abs(n), currency)}`;

/** Hours to one decimal: "7.4 h". */
export const hrs = (h: number) => `${h.toFixed(1)} h`;
