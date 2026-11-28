// Groups templates by spell type (the template's `element`) for the viewer's
// Type and Spell dropdowns. Pure functions, so Node can test them.

import { AXES, STAGE_LABEL } from "./engine/classification.js";

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

// Kinds of spell that cut across elements and lines. "Auras": persistent
// effects around the caster that loop while they last (templates with a
// timing.loop_range), whatever their element or line. Type "kind:aura".
// "Status effects": lingering afflictions on a target (archetype "status":
// burning, frozen, poisoned, asleep...) that apply, loop while they last and
// expire. Type "kind:status".
// "Buffs": see isBuff. "Warcries": see isWarcry.
export const KIND_PREFIX = "kind:";

const loops = (tpl) => {
  const r = tpl?.timing?.loop_range;
  return !!r && typeof r.start_ms === "number" && typeof r.end_ms === "number" && r.end_ms > r.start_ms;
};

export function isStatusEffect(tpl) {
  return tpl?.archetype === "status";
}

export function isAura(tpl) {
  return loops(tpl) && !isStatusEffect(tpl);
}

// "Buffs": spells cast on a character to help them (tagged "buff"): a
// shield, haste, strength, a resistance. Type "kind:buff".
export function isBuff(tpl) {
  return Array.isArray(tpl?.tags) && tpl.tags.includes("buff");
}

// "Warcries": the caster shouts and a shockwave or aura rolls out over the
// allies or enemies round them (tagged "warcry"): a roar that knocks foes
// back, a rallying banner, a fear howl, a battle fury. Type "kind:warcry".
export function isWarcry(tpl) {
  return Array.isArray(tpl?.tags) && tpl.tags.includes("warcry");
}

export function groupByKind(templates) {
  const byName = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id));
  const groups = [];
  const auras = templates.filter(isAura).sort(byName);
  if (auras.length) groups.push({ type: `${KIND_PREFIX}aura`, label: "Auras", kind: true, templates: auras });
  const buffs = templates.filter(isBuff).sort(byName);
  if (buffs.length) groups.push({ type: `${KIND_PREFIX}buff`, label: "Buffs", kind: true, templates: buffs });
  const warcries = templates.filter(isWarcry).sort(byName);
  if (warcries.length) groups.push({ type: `${KIND_PREFIX}warcry`, label: "Warcries", kind: true, templates: warcries });
  const statuses = templates.filter(isStatusEffect).sort(byName);
  if (statuses.length) groups.push({ type: `${KIND_PREFIX}status`, label: "Status effects", kind: true, templates: statuses });
  return groups;
}

// Classification groups (the template's `classification`): one group per
// value on each axis, under the axis's name (`axis`, e.g. "Category"), in
// the axis's own order. A spell is in its category and in each of its
// `also` categories. "Stages" groups spells by their whole stage pattern
// ("Cast > Travel > Impact"), most common first. Type "class:<axis>:<value>".
export const CLASS_PREFIX = "class:";

export function groupByClass(templates) {
  const byName = (a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id));
  const groups = [];
  const classed = templates.filter((t) => t?.classification && typeof t.classification === "object");
  const patterns = new Map();
  for (const t of classed) {
    const key = (t.classification.stages || []).join("-");
    if (!key) continue;
    if (!patterns.has(key)) patterns.set(key, []);
    patterns.get(key).push(t);
  }
  [...patterns.entries()]
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .forEach(([key, list]) => groups.push({
      type: `${CLASS_PREFIX}stages:${key}`, label: key.split("-").map((s) => STAGE_LABEL[s] || s).join(" > "),
      axis: "Stages", templates: list.slice().sort(byName),
    }));
  for (const { key, label, values } of AXES) {
    for (const value of Object.keys(values)) {
      const list = classed.filter((t) => t.classification[key] === value || (key === "category" && (t.classification.also || []).includes(value)));
      if (list.length) groups.push({ type: `${CLASS_PREFIX}${key}:${value}`, label: values[value], axis: label, templates: list.sort(byName) });
    }
  }
  return groups;
}

// Element groups, then spell-line groups, kinds and classifications: what the Type dropdown lists.
export function groupCatalog(templates) {
  return [...groupByType(templates), ...groupByLine(templates), ...groupByKind(templates), ...groupByClass(templates)];
}

// Line, kind and classification groups list spells that an element group already lists.
export const isExtra = (g) => !!(g.line || g.kind || g.axis);

// The templates the Spell dropdown shows for a type, in dropdown order.
export function spellsFor(groups, type) {
  if (type === ALL) return groups.filter((g) => !isExtra(g)).flatMap((g) => g.templates);
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
