// Spell classification (the template's `classification`): what a spell is
// built from and what it does, on five axes. Pure, so the viewer, the
// exports and Node tests share the labels and the engine notes.
//
//   stages:   cast > travel > impact > linger (the parts it has, in order)
//   category: damage, buff, debuff, control, heal, utility (+ `also`)
//   delivery: projectile, beam, chain, strike, melee, emanate, applied, placed
//   area:     single, multi, self, group, targeted_aoe, pbae, ground_aoe, cone, line
//   duration: instant, channeled, lingering, sustained

export const STAGES = ["cast", "travel", "impact", "linger"];

export const STAGE_LABEL = { cast: "Cast", travel: "Travel", impact: "Impact", linger: "Linger" };

export const CATEGORY_LABEL = {
  damage: "Damage", buff: "Buff", debuff: "Debuff", control: "Control", heal: "Heal", utility: "Utility",
};

export const DELIVERY_LABEL = {
  projectile: "Projectile", beam: "Beam", chain: "Chain", strike: "Strike", melee: "Melee",
  emanate: "From the caster", applied: "On the body", placed: "Placed",
};

export const AREA_LABEL = {
  single: "Single target", multi: "Several targets", self: "Self", group: "Group (allies)",
  targeted_aoe: "Targeted AoE", pbae: "Point-blank AoE", ground_aoe: "Ground AoE", cone: "Cone", line: "Line",
};

export const DURATION_LABEL = { instant: "Instant", channeled: "Channeled", lingering: "Ground lingering", sustained: "Sustained" };

export const AXES = [
  { key: "category", label: "Category", values: CATEGORY_LABEL },
  { key: "area", label: "Area", values: AREA_LABEL },
  { key: "delivery", label: "Delivery", values: DELIVERY_LABEL },
  { key: "duration", label: "Duration", values: DURATION_LABEL },
];

// What each value means for someone rebuilding the spell in an engine.
const STAGE_HOOK = {
  cast: "Cast: plays on the caster while the spell charges or winds up (the anticipation beats). Start it when the cast starts; cancel it if the cast is interrupted.",
  travel: "Travel: something moves from the caster (or the sky) to the target (the travel beats). Drive it from the game's projectile or hit timing, and keep the impact waiting for it.",
  impact: "Impact: the hit, burst or landing (the impact beats). Fire it when the game says the spell lands, at the target or the area's centre.",
  linger: "Linger: something stays after the hit (a pool, a field, a buff, an affliction). It loops its sustain (timing.loop_range when there is one) until the game removes it, then plays its end.",
};

const DURATION_HOOK = {
  instant: "Instant: one shot. Spawn it, let it play to the end and destroy it.",
  channeled: "Channeled: lasts while the caster holds it. Loop the held part while the channel runs and play the end when it stops or is interrupted.",
  lingering: "Lingering: leaves something in the world. Spawn the lingering part as its own object at the spot, independent of the caster, and let the game end it.",
  sustained: "Sustained: stays on a character. Attach it to that character, loop it while the effect lasts and play its end when the game removes it.",
};

const has = (c) => !!c && typeof c === "object";

// "Cast > Travel > Impact > Linger"
export function stagesLabel(tpl, sep = " > ") {
  const c = tpl?.classification;
  return has(c) ? (c.stages || []).map((s) => STAGE_LABEL[s] || s).join(sep) : "";
}

// "Damage (also control) · Projectile · Targeted AoE · Instant"
export function classificationLabel(tpl, sep = " · ") {
  const c = tpl?.classification;
  if (!has(c)) return "";
  const cat = CATEGORY_LABEL[c.category] || c.category;
  const also = (c.also || []).map((x) => (CATEGORY_LABEL[x] || x).toLowerCase());
  return [
    also.length ? `${cat} (also ${also.join(", ")})` : cat,
    DELIVERY_LABEL[c.delivery] || c.delivery,
    AREA_LABEL[c.area] || c.area,
    DURATION_LABEL[c.duration] || c.duration,
  ].filter(Boolean).join(sep);
}

// The classification as plain data for an export's JSON.
export function classificationOut(tpl) {
  const c = tpl?.classification;
  if (!has(c)) return null;
  return {
    stages: [...(c.stages || [])],
    category: c.category,
    also: [...(c.also || [])],
    delivery: c.delivery,
    area: c.area,
    duration: c.duration,
    summary: `${stagesLabel(tpl)} | ${classificationLabel(tpl, " | ")}`,
  };
}

// Markdown for an export's guide: what kind of spell this is and how each
// part maps onto game events.
export function classificationGuideLines(tpl) {
  const c = tpl?.classification;
  if (!has(c)) return [];
  const lines = ["## What kind of spell this is", ""];
  lines.push(
    `- **Stages**: ${stagesLabel(tpl)}`,
    `- **Category**: ${CATEGORY_LABEL[c.category] || c.category}${c.also?.length ? ` (also ${c.also.map((x) => (CATEGORY_LABEL[x] || x).toLowerCase()).join(", ")})` : ""}`,
    `- **Delivery**: ${DELIVERY_LABEL[c.delivery] || c.delivery}`,
    `- **Area**: ${AREA_LABEL[c.area] || c.area}`,
    `- **Duration**: ${DURATION_LABEL[c.duration] || c.duration}`,
    "",
    "Wire each stage to its game event, so the effect follows the game instead of a fixed clock:",
    "",
  );
  for (const s of c.stages || []) if (STAGE_HOOK[s]) lines.push(`- ${STAGE_HOOK[s]}`);
  if (DURATION_HOOK[c.duration]) lines.push(`- ${DURATION_HOOK[c.duration]}`);
  lines.push("");
  return lines;
}
