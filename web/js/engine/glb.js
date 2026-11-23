// A small glTF 2.0 binary (.glb) writer and reader: enough for a skinned
// skeleton, a crude mesh and baked animation (engine/rigexport.js). Pure
// JavaScript, no Three.js, so Node can test it.

const FLOAT = 5126;
const UBYTE = 5121;
const USHORT = 5123;
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** Builds the JSON and one binary buffer of a glTF asset. */
export class GltfBuilder {
  constructor(generator = "SpellDirector") {
    this.json = { asset: { version: "2.0", generator }, scene: 0, scenes: [{ nodes: [] }], nodes: [], buffers: [], bufferViews: [], accessors: [] };
    this.chunks = [];
    this.byteLength = 0;
  }

  // Add typed-array data as a buffer view (4-byte aligned). target: 34962 vertex data, 34963 indices.
  view(typed, target) {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.byteLength += pad;
    }
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    this.chunks.push(bytes.slice());
    const v = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
    if (target) v.target = target;
    this.byteLength += bytes.byteLength;
    this.json.bufferViews.push(v);
    return this.json.bufferViews.length - 1;
  }

  /** An accessor over numbers: type "SCALAR" | "VEC3" | ...; kind "float" | "ubyte" | "ushort". */
  accessor(values, type, { kind = "float", target, minmax = false, normalized = false } = {}) {
    const n = SIZES[type];
    const typed = kind === "ubyte" ? new Uint8Array(values) : kind === "ushort" ? new Uint16Array(values) : new Float32Array(values);
    const a = {
      bufferView: this.view(typed, target),
      componentType: kind === "ubyte" ? UBYTE : kind === "ushort" ? USHORT : FLOAT,
      count: values.length / n,
      type,
    };
    if (normalized) a.normalized = true;
    if (minmax) {
      const min = Array(n).fill(Infinity);
      const max = Array(n).fill(-Infinity);
      for (let i = 0; i < values.length; i++) {
        const k = i % n;
        min[k] = Math.min(min[k], typed[i]);
        max[k] = Math.max(max[k], typed[i]);
      }
      a.min = min;
      a.max = max;
    }
    this.json.accessors.push(a);
    return this.json.accessors.length - 1;
  }

  node(def, parent = null) {
    this.json.nodes.push(def);
    const i = this.json.nodes.length - 1;
    if (parent == null) this.json.scenes[0].nodes.push(i);
    else (this.json.nodes[parent].children ||= []).push(i);
    return i;
  }

  add(kind, def) {
    (this.json[kind] ||= []).push(def);
    return this.json[kind].length - 1;
  }

  /** The finished .glb as bytes. */
  toGlb() {
    const bin = new Uint8Array(Math.ceil(this.byteLength / 4) * 4);
    let o = 0;
    for (const c of this.chunks) {
      bin.set(c, o);
      o += c.byteLength;
    }
    this.json.buffers = [{ byteLength: bin.byteLength }];
    let jsonBytes = new TextEncoder().encode(JSON.stringify(this.json));
    const jpad = (4 - (jsonBytes.byteLength % 4)) % 4;
    if (jpad) {
      const padded = new Uint8Array(jsonBytes.byteLength + jpad).fill(0x20);
      padded.set(jsonBytes);
      jsonBytes = padded;
    }
    const total = 12 + 8 + jsonBytes.byteLength + 8 + bin.byteLength;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); // "glTF"
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, jsonBytes.byteLength, true);
    dv.setUint32(16, 0x4e4f534a, true); // "JSON"
    out.set(jsonBytes, 20);
    const b = 20 + jsonBytes.byteLength;
    dv.setUint32(b, bin.byteLength, true);
    dv.setUint32(b + 4, 0x004e4942, true); // "BIN"
    out.set(bin, b + 8);
    return out;
  }
}

/** Read a .glb: { json, accessor(i) -> numbers }. */
export function readGlb(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jsonLen)));
  const b = 20 + jsonLen;
  const binLen = dv.getUint32(b, true);
  const bin = u8.subarray(b + 8, b + 8 + binLen);
  const accessor = (i) => {
    const a = json.accessors[i];
    const v = json.bufferViews[a.bufferView];
    const n = a.count * SIZES[a.type];
    const off = bin.byteOffset + v.byteOffset + (a.byteOffset || 0);
    const buf = bin.buffer;
    const copy = buf.slice(off, off + n * (a.componentType === FLOAT ? 4 : a.componentType === USHORT ? 2 : 1));
    if (a.componentType === FLOAT) return Array.from(new Float32Array(copy));
    if (a.componentType === USHORT) return Array.from(new Uint16Array(copy));
    return Array.from(new Uint8Array(copy));
  };
  return { json, accessor };
}
