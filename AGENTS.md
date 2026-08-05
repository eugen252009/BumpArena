# 🤖 BumpArena: AI Agent & Developer Guidelines

Welcome! This document provides the necessary architectural context, technical specifications, and development rules for AI coding assistants working on the **BumpArena** codebase.

---

## 📌 Project Overview

**BumpArena** is a high-performance memory arena designed for JavaScript and TypeScript (optimized for Bun). It provides contiguous memory allocation, fast pointer-based access, and minimal Garbage Collection (GC) overhead. It is runtime-bound (or "Type-Conversion-Bound") rather than logic-bound, meaning its internal management overhead is negligible (< 7%), and performance scales linearly with hardware capacity.

---

## 📐 Architecture & Memory Specification

### 1. The 16-Byte Packed Binary Header
Every allocated block within the arena starts with a 16-byte header:

| Offset | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `0x00` | `total_length` | `uint32` | Header + Payload + Alignment Padding |
| `0x04` | `payload_length` | `uint32` | Exact size of user data (excluding padding) |
| `0x08` | `generation` | `uint32` | Validation counter to prevent stale pointer access (ABA issues) |
| `0x0C` | `status` | `uint8` | Status flag (`0x00` = Ready/Active, `0x01` = Deleted, `0x02` = Writing) |
| `0x0D` | `magic` | `uint8[2]` | Magic Bytes: `0xDB 0xDB` |
| `0x0F` | `version` | `uint8` | Protocol version: `0x01` |
| `0x10` | **Payload** | `u8[]` | User payload data starts here |

### 2. Alignment Boundaries
- Default alignment is 8-byte boundaries, but can be configured to 16, 32, or 64 bytes via `ArenaOptions` (`alignment`).
- Alignment ensures optimal CPU cache utilization and CPU memory-controller compatibility.

### 3. Stale Pointer Protection (`ArenaLocation`)
- Pointers are represented by `ArenaLocation`, which is branded as `bigint & { readonly __data_pointer: unique symbol }` to ensure compile-time type safety.
- The 64-bit BigInt pointer structure:
  - **Upper 32 bits**: Memory offset of the block.
  - **Lower 32 bits**: Generation counter.
- During a `read` operation, the generation stored in the pointer is compared against the generation stored in the block's header at that offset. If they do not match, the read returns `null`, preventing stale/invalid pointer access.

---

## 🛠️ Core API Reference

### Allocation & Lifecycle
- `alloc(source: ArrayBufferView, startn?: number, length?: number): ArenaLocation`
  - Ingests memory slice from `source`, allocates a block, copies the data, and returns an `ArenaLocation`.
  - Attempts to reuse deleted slots of the matching bucket size before appending to the end of the buffer.
- `allocNoPtr(source: ArrayBufferView, offset?: number, length?: number): void`
  - Performs allocation for fast sequential storage without building/returning a pointer.
- `free(location: ArenaLocation): ArenaLocation`
  - Increments the block's generation and sets the status byte to `1` (Deleted).
  - Pushes the block's offset back into the appropriate recycle bucket (if within capacity).
- `reserve(size: number): Uint8Array`
  - Pre-allocates a block of `size` bytes and returns a direct `Uint8Array` view of its payload area. Excellent for writing directly without intermediate allocations.

### Inspection & Iteration
- `inspect(ptr: ArenaLocation): InspectStruct`
  - Performs validation checks and returns meta-information (e.g. `isSafe`, `totalLength`, `payload`).
- `collectActiveRecords<K>(type: K, callback: (data: K_Type, idx: number) => void)`
  - Traverses the entire arena sequentially and yields active data without creating intermediate array wrappers.
- `records(): Generator<[Uint8Array, ArenaLocation]>`
  - Generator that yields active records sequentially starting from the last set `_next` cursor pointer.

### Zero-Copy Shadow Views (Flyweight Wrapper)
- `createShadowClass<T>(schema: Schema): { new(buffer: ArrayBufferLike): T & IShadowView }`
  - Generates a highly optimized flyweight wrapper class mapped to a binary representation via a property schema.
  - Generates JIT-friendly property getters/setters using `DataView`.
  - Allows mapping fields (`uint8`, `int8`, `uint16`, `int16`, `uint32`, `int32`, `float32`, `float64`, `bigint64`, `biguint64`) to direct properties.
  - Shift targets dynamically with `_setTarget(byteOffset)` on a single wrapper instance to avoid heap object instantiation and prevent Garbage Collection (GC) overhead during loops or traversals.


---

## 🚦 AI Agent Coding Rules

When modifying or extending the BumpArena repository, you **must** adhere to the following rules:

### 1. Zero Garbage Collection (GC) Pressure
- **Rule**: Avoid object instantiation or array allocations inside hot paths (e.g., `alloc`, `read`, iteration, and callbacks).
- **Rationale**: BumpArena's primary value proposition is zero GC overhead. Creating temporary arrays or objects defeats the purpose of the arena.

### 2. Alignment & Size Logic
- **Rule**: All calculations for offsets must respect the alignment mask configuration (`this._alignMask`).
- **Formula**: `alignedSize = (rawSize + this._alignMask) & ~this._alignMask`.
- Do not hardcode size values (like `16` or `8`) where alignment configuration should be used.

### 3. Type Safety
- **Rule**: Do not cast `ArenaLocation` to a normal `bigint` without reason. Preserve type branding.
- **Rule**: Always keep the interface definitions in [`interface.d.ts`](file:///home/eugen/projekte/BumpArena/interface.d.ts) updated when altering public API methods or options.

### 4. Memory Expansion Limits
- **Rule**: Do not exceed `MAX_ARENA_SIZE` (currently `4GB`).
- **Rule**: Prefer the native `.transfer()` method on `ArrayBuffer` if supported (for zero-copy buffer resizing), falling back to array copying only when necessary.
