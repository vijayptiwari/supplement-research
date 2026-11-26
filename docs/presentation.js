// Small shared display helpers. Dataset validation stays in the build.
export const finite = (n) => typeof n === "number" && Number.isFinite(n);
export const positive = (n) => finite(n) && n > 0;
export const isoDate = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
export const https = (s) => {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
};
export const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function formatDate(date) {
  return isoDate(date)
    ? new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(date + "T00:00:00Z"))
    : "Not recorded";
}
