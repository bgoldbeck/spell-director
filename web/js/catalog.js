// Groups templates by spell type (the template's `element`) for the viewer's
// Type and Spell dropdowns. Pure functions, so Node can test them.

export const ALL = "all";

const label = (s) => String(s).replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function typeLabel(type) {
  return type === ALL ? "All types" : label(type || "other");
}

// [{ type, label, templates: [...] }], types and spells sorted by name.
export function groupByType(templates) {
  const groups = new Map();
  for (const tpl of templates) {
    const type = tpl.element || "other";
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(tpl);
  }
  const byName = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, list]) => ({ type, label: typeLabel(type), templates: list.slice().sort(byName) }));
}

// Spell lines (the template's optional `line`: a class, school or skill line
// such as Bard or Necromancer) as extra groups after the elements. Their type
// is "line:<name>" and they carry `line: true`; "All types" skips them so no
// spell is listed twice.
export const LINE_PREFIX = "line:";

export function groupByLine(templates) {
  const groups = new Map();
  for (const tpl of templates) {
    if (!tpl.line) continue;
    if (!groups.has(tpl.line)) groups.set(tpl.line, []);
    groups.get(tpl.line).push(tpl);
  }
  const byName = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id));
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([line, list]) => ({ type: LINE_PREFIX + line, label: line, line: true, templates: list.slice().sort(byName) }));
}

// Element groups followed by spell-line groups: what the Type dropdown lists.
export function groupCatalog(templates) {
  return [...groupByType(templates), ...groupByLine(templates)];
}

// The templates the Spell dropdown shows for a type, in dropdown order.
export function spellsFor(groups, type) {
  if (type === ALL) return groups.filter((g) => !g.line).flatMap((g) => g.templates);
  return groups.find((g) => g.type === type)?.templates ?? [];
}

// The template `step` places from `current` within `type`, wrapping around.
export function step(groups, type, currentId, delta) {
  const list = spellsFor(groups, type);
  if (!list.length) return null;
  const i = list.findIndex((t) => t.id === currentId);
  if (i < 0) return list[0];
  return list[(((i + delta) % list.length) + list.length) % list.length];
}

// Resolves the ?template= and ?type= URL parameters.
// Returns { template, type, error }; error is a message when a parameter names nothing.
export function resolveStart(groups, { template: wantId, type: wantType } = {}) {
  const all = spellsFor(groups, ALL);
  let error = null;
  let type = ALL;
  if (wantType) {
    if (wantType === ALL || groups.some((g) => g.type === wantType)) type = wantType;
    else error = `No spells of type "${wantType}". Showing all types.`;
  }
  let template = null;
  if (wantId) {
    template = all.find((t) => t.id === wantId) ?? null;
    if (template) {
      if (type !== ALL && !spellsFor(groups, type).includes(template)) type = template.element || "other";
    } else {
      const fallback = spellsFor(groups, type)[0];
      error = `No template with id "${wantId}".` + (fallback ? ` Showing ${fallback.name || fallback.id} instead.` : "");
    }
  }
  template ??= spellsFor(groups, type)[0] ?? null;
  return { template, type, error };
}
