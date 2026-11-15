// Post-processing shared by the viewer and the sprite exporter: the scene is
// drawn into an HDR render target (so stacked additive light can go past 1),
// bloomed, then written to the canvas in sRGB. Bloom only picks up bright
// pixels, so the ground and stand-ins stay crisp while bolt cores glow.
//
// Rendering stays a pure function of what is drawn: the bloom has no memory
// between frames.

import * as THREE from "three";
import { UnrealBloomPass } from "../../vendor/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../../vendor/postprocessing/OutputPass.js";

export const BLOOM = { strength: 0.6, radius: 0.3, threshold: 0.7 };

export class Post {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.enabled = opts.bloom !== false;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: opts.samples ?? 4,
    });
    const b = { ...BLOOM, ...(opts.settings || {}) };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), b.strength, b.radius, b.threshold);
    this.output = new OutputPass();
    this.output.renderToScreen = true;
    this.width = 0;
    this.height = 0;
  }

  // Size in drawing-buffer pixels.
  setSize(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.target.setSize(w, h);
    this.bloom.setSize(w, h);
    // Blur levels smaller than a few pixels show up as blocky squares in small
    // frames (sprite export cells): leave them out.
    const tints = this.bloom.compositeMaterial.uniforms.bloomTintColors.value;
    tints.forEach((c, i) => c.setScalar(Math.min(w, h) / 2 ** (i + 1) >= 24 ? 1 : 0));
  }

  /**
   * Draw one frame. `views` is a list of {scene, camera, x, y, w, h} in
   * drawing-buffer pixels with a bottom-left origin (like gl.viewport); omit
   * x/y/w/h for the full frame. `bloom` overrides `enabled` for this frame.
   */
  render(views, { bloom } = {}) {
    const r = this.renderer;
    const t = this.target;
    r.setRenderTarget(t);
    t.scissorTest = false;
    t.viewport.set(0, 0, this.width, this.height);
    r.clear();
    for (const v of views) {
      const x = v.x ?? 0;
      const y = v.y ?? 0;
      const w = v.w ?? this.width;
      const h = v.h ?? this.height;
      t.viewport.set(x, y, w, h);
      t.scissor.set(x, y, w, h);
      t.scissorTest = true;
      r.setRenderTarget(t); // re-applies the target's viewport and scissor
      r.render(v.scene, v.camera);
    }
    t.scissorTest = false;
    t.viewport.set(0, 0, this.width, this.height);
    r.setRenderTarget(t);
    if (bloom ?? this.enabled) this.bloom.render(r, null, t, 0, false);
    const scissor = r.getScissorTest();
    r.setScissorTest(false);
    r.setViewport(0, 0, r.domElement.width / r.getPixelRatio(), r.domElement.height / r.getPixelRatio());
    this.output.render(r, null, t);
    r.setScissorTest(scissor);
  }

  dispose() {
    this.target.dispose();
    this.bloom.dispose();
    this.output.dispose();
  }
}
