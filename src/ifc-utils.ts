import { Matrix } from "@babylonjs/core";

/**
 * Z-negation matrix for converting between right-handed and left-handed Y-up
 * coordinate systems.
 */
// prettier-ignore
export const NEGATE_Z = Matrix.FromValues(
  1, 0,  0, 0,
  0, 1,  0, 0,
  0, 0, -1, 0,
  0, 0,  0, 1,
);

/** Convert an IFC (right-handed) 4×4 transform to Babylon (left-handed): S · M · S */
export function rhToLhTransform(m: Matrix): Matrix {
  return NEGATE_Z.multiply(m).multiply(NEGATE_Z);
}

/** Material cache key from an RGBA color. */
export function colorKey(c: {
  x: number;
  y: number;
  z: number;
  w: number;
}): string {
  return `${c.x}_${c.y}_${c.z}_${c.w}`;
}
