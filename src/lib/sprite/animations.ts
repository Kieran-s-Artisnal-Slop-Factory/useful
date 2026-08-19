/**
 * The animation vocabulary for <PixelSprite>, ported and extended from
 * workoutt's pet game (which shipped `idle` and `happy`). Every animation is
 * a pure-CSS keyframe set living in PixelSprite.svelte; this module is the
 * catalogue the UI reads (names + labels) and the shared type.
 *
 * The two building blocks the app used — squash/stretch from the feet, and
 * translation by whole grid pixels (`--pet-px`) so motion stays pixel-aligned
 * at any display size — are the basis for all of these. All are disabled
 * under `prefers-reduced-motion: reduce`.
 */

export type SpriteAnimation =
  | 'none'
  | 'idle'
  | 'happy'
  | 'breathe'
  | 'float'
  | 'wiggle'
  | 'jump'
  | 'spin';

export interface AnimationPreset {
  id: SpriteAnimation;
  label: string;
  /** One-line description of the motion. */
  description: string;
}

export const SPRITE_ANIMATIONS: AnimationPreset[] = [
  { id: 'none', label: 'None', description: 'Static — no motion.' },
  { id: 'idle', label: 'Idle', description: 'Two-frame JRPG bob; snaps by exactly one pixel.' },
  { id: 'happy', label: 'Happy', description: 'Squash-and-stretch hop, landing on its feet.' },
  { id: 'breathe', label: 'Breathe', description: 'Gentle squash/stretch in place.' },
  { id: 'float', label: 'Float', description: 'Smooth vertical drift.' },
  { id: 'wiggle', label: 'Wiggle', description: 'Rocks side to side from the feet.' },
  { id: 'jump', label: 'Jump', description: 'A taller hop with anticipation and a landing squash.' },
  { id: 'spin', label: 'Spin', description: 'Horizontal flip, like turning around.' },
];

export const ANIMATION_IDS = SPRITE_ANIMATIONS.map((a) => a.id);
