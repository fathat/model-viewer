import { describe, it, expect } from "vitest";
import { Matrix } from "@babylonjs/core";
import { colorKey, rhToLhTransform, NEGATE_Z } from "./ifc-utils.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectMatrixCloseTo(actual: Matrix, expected: Matrix, precision = 5) {
  const a = actual.toArray();
  const e = expected.toArray();
  for (let i = 0; i < 16; i++) {
    expect(a[i]).toBeCloseTo(e[i], precision);
  }
}

// ---------------------------------------------------------------------------
// colorKey
// ---------------------------------------------------------------------------

describe("colorKey", () => {
  it("produces a deterministic string from RGBA components", () => {
    expect(colorKey({ x: 0.8, y: 0.2, z: 0.5, w: 1 })).toBe("0.8_0.2_0.5_1");
  });

  it("distinguishes colors that differ only in alpha", () => {
    const opaque = colorKey({ x: 1, y: 0, z: 0, w: 1 });
    const transparent = colorKey({ x: 1, y: 0, z: 0, w: 0.5 });
    expect(opaque).not.toBe(transparent);
  });

  it("returns identical keys for identical colors", () => {
    const a = colorKey({ x: 0.1, y: 0.2, z: 0.3, w: 0.4 });
    const b = colorKey({ x: 0.1, y: 0.2, z: 0.3, w: 0.4 });
    expect(a).toBe(b);
  });

  it("differentiates all four channels", () => {
    const keys = new Set([
      colorKey({ x: 1, y: 0, z: 0, w: 0 }),
      colorKey({ x: 0, y: 1, z: 0, w: 0 }),
      colorKey({ x: 0, y: 0, z: 1, w: 0 }),
      colorKey({ x: 0, y: 0, z: 0, w: 1 }),
    ]);
    expect(keys.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// NEGATE_Z
// ---------------------------------------------------------------------------

describe("NEGATE_Z", () => {
  it("is its own inverse (S² = I)", () => {
    expectMatrixCloseTo(NEGATE_Z.multiply(NEGATE_Z), Matrix.Identity());
  });

  it("negates only the Z column", () => {
    const m = NEGATE_Z.toArray();
    // Diagonal: 1, 1, -1, 1
    expect(m[0]).toBe(1);
    expect(m[5]).toBe(1);
    expect(m[10]).toBe(-1);
    expect(m[15]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// rhToLhTransform
// ---------------------------------------------------------------------------

describe("rhToLhTransform", () => {
  it("preserves the identity matrix", () => {
    expectMatrixCloseTo(rhToLhTransform(Matrix.Identity()), Matrix.Identity());
  });

  it("negates Z in a pure translation", () => {
    expectMatrixCloseTo(
      rhToLhTransform(Matrix.Translation(3, 5, 7)),
      Matrix.Translation(3, 5, -7),
    );
  });

  it("preserves X and Y in a translation with Z=0", () => {
    const m = Matrix.Translation(10, 20, 0);
    expectMatrixCloseTo(rhToLhTransform(m), m);
  });

  it("preserves uniform scaling", () => {
    expectMatrixCloseTo(
      rhToLhTransform(Matrix.Scaling(2, 3, 4)),
      Matrix.Scaling(2, 3, 4),
    );
  });

  it("is an involution — applying twice returns the original", () => {
    const m = Matrix.Translation(1, 2, 3);
    expectMatrixCloseTo(rhToLhTransform(rhToLhTransform(m)), m);
  });

  it("is an involution for rotation matrices too", () => {
    const m = Matrix.RotationX(Math.PI / 6);
    expectMatrixCloseTo(rhToLhTransform(rhToLhTransform(m)), m);
  });

  it("is a homomorphism: f(A·B) = f(A)·f(B)", () => {
    const a = Matrix.Translation(1, 2, 3);
    const b = Matrix.Scaling(2, 2, 2);
    const lhs = rhToLhTransform(a.multiply(b));
    const rhs = rhToLhTransform(a).multiply(rhToLhTransform(b));
    expectMatrixCloseTo(lhs, rhs);
  });

  it("homomorphism holds for rotation × translation", () => {
    const a = Matrix.RotationX(Math.PI / 4);
    const b = Matrix.Translation(0, 5, 10);
    const lhs = rhToLhTransform(a.multiply(b));
    const rhs = rhToLhTransform(a).multiply(rhToLhTransform(b));
    expectMatrixCloseTo(lhs, rhs);
  });
});
