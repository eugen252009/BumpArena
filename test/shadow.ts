import { Arena, createShadowClass } from "../arena.ts";

export function TestShadowAccess(): boolean {
	const arena = new Arena();

	const PointSchema = {
		id: { type: "uint32" as const, offset: 0 },
		x: { type: "float64" as const, offset: 8 },
		y: { type: "float64" as const, offset: 16 }
	};

	interface IPoint {
		id: number;
		x: number;
		y: number;
	}

	const PointShadow = createShadowClass<IPoint>(PointSchema);

	// Reserve 24 bytes in the arena (4 bytes for uint32 id, padding, 8 bytes float64 x, 8 bytes float64 y)
	const buf1 = arena.reserve(24);
	const ptr1 = arena.getBuffer();

	// Create dynamic shadow pointing to the reserve block
	// The payload is located after the 16-byte header
	const shadow = new PointShadow(ptr1.buffer);
	
	// Since buf1 is a view inside the buffer, we find its actual byte offset in ptr1.buffer
	const payloadOffset = buf1.byteOffset;
	shadow._setTarget(payloadOffset);

	// Write fields
	shadow.id = 42;
	shadow.x = 3.14159;
	shadow.y = 2.71828;

	// Verify reads
	if (shadow.id !== 42) throw new Error("ID mismatch");
	if (Math.abs(shadow.x - 3.14159) > 0.000001) throw new Error("X mismatch");
	if (Math.abs(shadow.y - 2.71828) > 0.000001) throw new Error("Y mismatch");

	// Add another point
	const buf2 = arena.reserve(24);
	const ptr2 = arena.getBuffer();
	const shadow2 = new PointShadow(ptr2.buffer);
	
	shadow2._setTarget(buf2.byteOffset);
	shadow2.id = 100;
	shadow2.x = 99.9;
	shadow2.y = 88.8;

	// Verify target changing on the flyweight
	shadow._setTarget(buf2.byteOffset);
	if ((shadow.id as number) !== 100) throw new Error("Flyweight target change failed (ID)");
	if (Math.abs((shadow.x as number) - 99.9) > 0.000001) throw new Error("Flyweight target change failed (X)");

	return true;
}
