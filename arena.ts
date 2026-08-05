import { type ArenaLocation, type ArenaOptions, type InspectStruct, type FieldType, type Schema, type IShadowView } from "./interface.d.js"

export const  enum HEADERS {
	TOTAL_LENGTH_0_32 = 0,
	PAYLOAD_LENGTH_0_32 = 1,
	GENERATION_BYTE_0_32 = 2,
	STATUS_8 = 12,
	MAGIC_BYTE_0 = 13,
	MAGIC_BYTE_1 = 14,
	MAGIC_BYTE_2 = 15,
	Total_Size_In_Bytes = 16,
}
export const enum BlockStatus {
	Ready = 0x00,
	Deleted = 0x01,
	Writing = 0x02,
}

interface ArenaTypeMap {
	"Uint8Array": Uint8Array;
	"Uint16Array": Uint16Array;
	"Uint32Array": Uint32Array;
	"BigUint64Array": BigUint64Array;
	"BigInt64Array": BigInt64Array;
	"Float32Array": Float32Array;
	"Float64Array": Float64Array;
	"bigint": bigint;
	"string": string;
	"number": number;
	"Float64": number;
}
type ArenaTypeName = keyof ArenaTypeMap

export class Arena {
	private HEADER_SIZE_BYTES = 16
	private _buffer: ArrayBufferLike
	private _view8: Uint8Array
	private _view32: Uint32Array
	private _offset: number
	private _emptySpots: Uint32Array
	private _alignMask: 7 | 15 | 31 | 63 | number
	private _alignShift: number
	private _bucketOffsets: number[];
	private _bucketCapacities: number[];
	private _bucketcount: number;
	private _next: number = 0;
	private MAX_ARENA_SIZE = (4 * 1024 * 1024 * 1024); // 4GB

	constructor(options?: ArenaOptions) {
		this._buffer = new ArrayBuffer(options?.initialSize || 64 * 1024)

		this._view8 = new Uint8Array(this._buffer);
		this._view32 = new Uint32Array(this._buffer)
		this._offset = 0;

		if ((options?.alignment! & (options?.alignment! - 1)) !== 0) {
			throw new Error("alignment needs to be a power of 2")
		}
		this._alignMask = ((options?.alignment || 8) - 1!) as number
		this._alignShift = Math.log2(this._alignMask + 1);

		this._bucketCapacities = options?.bucketCapacities || [1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024]
		this._bucketOffsets = [];
		this._bucketcount = this._bucketCapacities.length;
		let currentOffset = 0;
		for (const cap of this._bucketCapacities) {
			this._bucketOffsets.push(currentOffset)
			currentOffset += (cap + 1)
		}
		this._emptySpots = new Uint32Array(currentOffset)
	}
	public import(buf: ArrayBufferLike) {
		this._buffer = buf;
		this._offset = buf.byteLength
		this._view8 = new Uint8Array(buf)
		this._view32 = new Uint32Array(buf)
		return this
	}

	private _u(n: number): number {
		return n >>> 0;
	}

	private _idx32(byteOffset: number): number {
		return Math.floor(byteOffset / 4);
	}

	private _makePtr(offset: number, gen: number | bigint): ArenaLocation {
		const bOffset = BigInt(offset);
		const bGen = BigInt(gen ?? 0);
		return ((bOffset << 32n) | (bGen & 0xFFFFFFFFn)) as ArenaLocation;
	}

	private _getOffset(ptr: ArenaLocation): number {
		return Number(BigInt(ptr) >> 32n);
	}

	private _getBucketCount(bucketIdx: number): number {
		return this._emptySpots[this._bucketOffsets[bucketIdx]!]!;
	}

	private _setBucketCount(bucketIdx: number, count: number): void {
		this._emptySpots[this._bucketOffsets[bucketIdx]!] = count;
	}

	private _getBucketOffset(bucketIdx: number, slotIdx: number): number {
		return this._emptySpots[this._bucketOffsets[bucketIdx]! + slotIdx + 1]!;
	}

	private _setBucketOffset(bucketIdx: number, slotIdx: number, offset: number): void {
		this._emptySpots[this._bucketOffsets[bucketIdx]! + slotIdx + 1] = offset;
	}

	private _initBlock(start: number, dataLength: number) {
		const rawSize = dataLength + this.HEADER_SIZE_BYTES;
		const alignedSize = (rawSize + this._alignMask) & ~this._alignMask;
		const idx = this._idx32(start)
		this._view32[idx + HEADERS.TOTAL_LENGTH_0_32] = alignedSize >>> 0;
		this._view32[idx + HEADERS.PAYLOAD_LENGTH_0_32] = dataLength;
		this._view8[start + HEADERS.MAGIC_BYTE_0] = 0xDB;
		this._view8[start + HEADERS.MAGIC_BYTE_1] = 0xDB;
		this._view8[start + HEADERS.MAGIC_BYTE_2] = 0x01;
		this._view8[start + HEADERS.STATUS_8] = BlockStatus.Writing;
	}

	public read(location: ArenaLocation): Uint8Array | null {
		const { offset: start, generation } = this._smallInspect(location);
		const idx = this._idx32(start)
		const currgen = BigInt(this._view32[idx + HEADERS.GENERATION_BYTE_0_32]!)

		if (generation !== currgen) return null
		if (this._view8[start + HEADERS.STATUS_8] != 0) return null

		const dataLength = this._view32[idx + HEADERS.PAYLOAD_LENGTH_0_32]!;
		return this._view8.subarray(start + this.HEADER_SIZE_BYTES, start + this.HEADER_SIZE_BYTES + dataLength);
	}
	public free(location: ArenaLocation): ArenaLocation {
		const { offset: start } = this._smallInspect(location)
		const idx = this._idx32(start)
		const currgen = this._view32[idx + HEADERS.GENERATION_BYTE_0_32]!

		this._view32[idx + HEADERS.GENERATION_BYTE_0_32] = currgen + 1
		this._view8[this._u(start) + HEADERS.STATUS_8] = 1

		const totalBlockSize = this._view32[this._idx32(start) + HEADERS.TOTAL_LENGTH_0_32]!
		const bucketIdx = (totalBlockSize >> this._alignShift) - 1
		if (bucketIdx >= 0 && bucketIdx < this._bucketcount) {
			const count = this._getBucketCount(bucketIdx)
			const capacity = this._bucketCapacities[bucketIdx]!
			if (count < capacity) {
				this._setBucketOffset(bucketIdx, count, start);
				this._setBucketCount(bucketIdx, count + 1);
			}
		}
		return this._makePtr(0, 0) as ArenaLocation
	}

	private _checkForSpace(size: number): boolean {
		const projectedSize = this._offset + size;
		if (projectedSize > this.MAX_ARENA_SIZE) {
			return true;
		}
		if (this._buffer.byteLength >= projectedSize) return false;
		return true;
	}

	private _resize(needed: number) {
		const currentSize = this._buffer.byteLength;
		const requestedTotal = this._offset + needed;

		let newSize = currentSize * 2;
		if (newSize > this.MAX_ARENA_SIZE) {
			newSize = this.MAX_ARENA_SIZE;
		}

		if (newSize < requestedTotal) {
			console.log("DEBUG:", this._offset, this._buffer.byteLength, "Requested:", requestedTotal);
			throw new Error(
				`Arena Out of Memory: Requested ${requestedTotal} bytes, but 4GB limit reached.`
			);
		}

		//@ts-ignore
		if (this._buffer.transfer) {
			//@ts-ignore
			this._buffer = this._buffer.transfer(newSize);
		} else {
			const newBuffer = new ArrayBuffer(newSize);
			new Uint8Array(newBuffer).set(this._view8);
			this._buffer = newBuffer;
		}

		this._view8 = new Uint8Array(this._buffer);
		this._view32 = new Uint32Array(this._buffer);
	}

	public size(): number {
		return this._offset
	}

	public getBuffer(): Uint8Array {
		return this._view8.subarray(0, this._offset)
	}
	public reserve(size: number): Uint8Array {
		const step = this._alignMask + 1;
		const start = this._offset;
		const totalNeededForThisBlock = size + this.HEADER_SIZE_BYTES;
		const newOffset = Math.ceil((start + totalNeededForThisBlock) / step) * step;
		if (this._checkForSpace(newOffset)) {
			this._resize(newOffset);
		}
		this._initBlock(start, size);
		this._offset = newOffset;
		this._view8[start + HEADERS.STATUS_8] = 0x01;
		return this._view8.subarray(
			start + this.HEADER_SIZE_BYTES,
			start + this.HEADER_SIZE_BYTES + size
		);
	}

	private _smallInspect(ptr: ArenaLocation) {
		const offset = this._getOffset(ptr)
		const generation = ptr & 0xFFFFFFFFn;
		return { offset, generation }
	}
	public inspect(ptr: ArenaLocation): InspectStruct {
		const offset = this._getOffset(ptr)
		const generation_ptr = Number(ptr & 0xFFFFFFFFn);

		const totalLength = this._view32[this._idx32(offset)]!
		const generation = Number(this._view32[this._idx32(offset) + HEADERS.GENERATION_BYTE_0_32]!)
		return {
			offset,
			generation_ptr,
			generation,
			isSafe: generation === Number(generation_ptr),
			totalLength,
			payloadLength: this._view32[this._idx32(offset) + HEADERS.PAYLOAD_LENGTH_0_32]!,
			isDeleted: this._view8[offset + HEADERS.STATUS_8] == 1,
			payload: this._view8.subarray(offset, offset + totalLength),
		}
	}

	collectActiveRecords<K extends ArenaTypeName>(
		type: K = "Uint8" as K,
		callback: (data: ArenaTypeMap[K], idx: number) => void,
	): void {
		let cursor = 0;
		let idx = 0;

		const v8 = this._view8;
		const v32 = this._view32;
		const buffer = v8.buffer;
		const baseOffset = v8.byteOffset;
		const limit = this._offset;
		const headerSize = this.HEADER_SIZE_BYTES;

		const vBigInt64 = new BigInt64Array(buffer);
		const vUint32 = new Uint32Array(buffer);
		const vFloat64 = new Float64Array(buffer);

		while (cursor < limit) {
			const idx32 = cursor / 4;
			const totalLength = v32[idx32 + HEADERS.TOTAL_LENGTH_0_32]! >>> 0;

			if (totalLength < headerSize) break;

			if (v8[cursor + HEADERS.STATUS_8] === 0) {
				const payloadLength = v32[idx32 + HEADERS.PAYLOAD_LENGTH_0_32]!;
				const dataOffset = cursor + headerSize;
				let data: any;

				switch (type) {
					case "bigint":
						data = vBigInt64[(baseOffset + dataOffset) / 8];
						break;
					case "number":
						data = vUint32[dataOffset / 4];
						break;
					case "string":
						data = Buffer.from(v8.subarray(dataOffset, dataOffset + payloadLength)).toString("utf8");
						break;
					case "Float64":
						data = vFloat64[(baseOffset + dataOffset) / 8]!;
						break

					default:
						if (type === "BigInt64Array") data = new BigInt64Array(buffer, baseOffset + dataOffset, payloadLength / 8);
						else if (type === "Uint32Array") data = new Uint32Array(buffer, dataOffset, payloadLength / 4);
						else if (type === "Float64Array") data = new Float64Array(buffer, dataOffset, payloadLength / 8);
						else data = v8.subarray(dataOffset, dataOffset + payloadLength);
				}

				callback(data, idx++);
			}
			cursor += totalLength;
		}
	}
	public estimate(size: number, amnt: number): number {
		const step = this._alignMask + 1
		return ((Math.ceil(size + this.HEADER_SIZE_BYTES) / step) * step) * amnt;
	}

	public allocNoPtr(source: ArrayBufferView, offset: number = 0, length: number = source.byteLength - offset) {
		const step = this._alignMask + 1;
		const len = length;
		const rawNeeded = len + this.HEADER_SIZE_BYTES;
		const alignedBlockSize = Math.ceil(rawNeeded / step) * step;
		const bucketIdx = (alignedBlockSize >> this._alignShift) - 1;
		const blob = new Uint8Array(
			source.buffer,
			source.byteOffset + offset,
			len
		)
		if (bucketIdx >= 0 && bucketIdx < this._bucketcount) {
			const count = this._getBucketCount(bucketIdx);
			if (count > 0) {
				const recycledOffset = this._getBucketOffset(bucketIdx, count - 1);
				this._setBucketCount(bucketIdx, count - 1);
				this._initBlock(recycledOffset, len);

				this._view8.set(blob, recycledOffset + this.HEADER_SIZE_BYTES);

				const gen = this._view32[this._idx32(recycledOffset) + HEADERS.GENERATION_BYTE_0_32]!;

				this._view8[recycledOffset + HEADERS.STATUS_8] = BlockStatus.Ready;
				return this._makePtr(recycledOffset, gen);
			}
		}

		const start = this._offset;
		const nextOffset = start + alignedBlockSize;

		this._initBlock(start, len);
		this._view8.set(blob, start + this.HEADER_SIZE_BYTES);
		this._view8[start + HEADERS.STATUS_8] = BlockStatus.Ready;
		this._offset = nextOffset;
	}
	public alloc(source: ArrayBufferView, startn: number = 0, length: number = source.byteLength - startn): ArenaLocation {
		const step = this._alignMask + 1;
		const len = length;
		const rawNeeded = len + this.HEADER_SIZE_BYTES;
		const alignedBlockSize = Math.ceil(rawNeeded / step) * step;
		const bucketIdx = (alignedBlockSize >> this._alignShift) - 1;
		const blob = new Uint8Array(
			source.buffer,
			source.byteOffset + startn,
			len
		)
		if (bucketIdx >= 0 && bucketIdx < this._bucketcount) {
			const count = this._getBucketCount(bucketIdx);
			if (count > 0) {
				const recycledOffset = this._getBucketOffset(bucketIdx, count - 1);
				this._setBucketCount(bucketIdx, count - 1);
				this._initBlock(recycledOffset, len);

				this._view8.set(blob, recycledOffset + this.HEADER_SIZE_BYTES);
				const gen = this._view32[this._idx32(recycledOffset) + HEADERS.GENERATION_BYTE_0_32]!;
				this._view8[recycledOffset + HEADERS.STATUS_8] = BlockStatus.Ready;
				return this._makePtr(recycledOffset, gen);
			}
		}
		const start = this._offset;
		const nextOffset = start + alignedBlockSize;
		if (nextOffset > this._buffer.byteLength) {
			this._resize(alignedBlockSize);
		}
		this._initBlock(start, len);
		this._view8.set(blob, start + this.HEADER_SIZE_BYTES);
		this._offset = nextOffset;
		const gen = this._view32[this._idx32(start) + HEADERS.GENERATION_BYTE_0_32]!;
		this._view8[start + HEADERS.STATUS_8] = BlockStatus.Ready;
		return this._makePtr(start, gen);
	}

	public clear() {
		this._offset = 0
		this._emptySpots.fill(0)
	}

	public *records(): (Generator<[Uint8Array, ArenaLocation]>) {
		while (this._next < this._offset) {
			const start = this._next
			const totalLength = this._view32[this._idx32(start) + HEADERS.TOTAL_LENGTH_0_32]!
			const payloadLength = this._view32[this._idx32(start) + HEADERS.PAYLOAD_LENGTH_0_32]!
			const generation = this._view32[this._idx32(start) + HEADERS.GENERATION_BYTE_0_32]!
			if (totalLength === 0) {
				this._next = (start + 16) & ~15
			}
			const isAvailable = this._view8[start + HEADERS.STATUS_8] !== 0
			const ptr = this._makePtr(start, generation)
			this._next += totalLength

			if (!isAvailable) {
				yield [
					this._view8.subarray(start + this.HEADER_SIZE_BYTES, start + this.HEADER_SIZE_BYTES + payloadLength),
					ptr
				]
			}
		}
	}
	public reset() {
		this._next = 0
	}
}

export function createShadowClass<T>(schema: Schema) {
	const proto = Object.create(null);

	for (const [key, field] of Object.entries(schema)) {
		const { type, offset } = field;

		let getter: () => any;
		let setter: (val: any) => void;

		switch (type) {
			case "uint8":
				getter = function(this: any) { return this._view.getUint8(this._baseOffset + offset); };
				setter = function(this: any, val: number) { this._view.setUint8(this._baseOffset + offset, val); };
				break;
			case "int8":
				getter = function(this: any) { return this._view.getInt8(this._baseOffset + offset); };
				setter = function(this: any, val: number) { this._view.setInt8(this._baseOffset + offset, val); };
				break;
			case "uint16":
				getter = function(this: any) { return this._view.getUint16(this._baseOffset + offset, true); };
				setter = function(this: any, val: number) { this._view.setUint16(this._baseOffset + offset, val, true); };
				break;
			case "int16":
				getter = function(this: any) { return this._view.getInt16(this._baseOffset + offset, true); };
				setter = function(this: any, val: number) { this._view.setInt16(this._baseOffset + offset, val, true); };
				break;
			case "uint32":
				getter = function(this: any) { return this._view.getUint32(this._baseOffset + offset, true); };
				setter = function(this: any, val: number) { this._view.setUint32(this._baseOffset + offset, val, true); };
				break;
			case "int32":
				getter = function(this: any) { return this._view.getInt32(this._baseOffset + offset, true); };
				setter = function(this: any, val: number) { this._view.setInt32(this._baseOffset + offset, val, true); };
				break;
			case "float32":
				getter = function(this: any) { return this._view.getFloat32(this._baseOffset + offset, true); };
				setter = function(this: any, val: number) { this._view.setFloat32(this._baseOffset + offset, val, true); };
				break;
			case "float64":
				getter = function(this: any) { return this._view.getFloat64(this._baseOffset + offset, true); };
				setter = function(this: any, val: number) { this._view.setFloat64(this._baseOffset + offset, val, true); };
				break;
			case "bigint64":
				getter = function(this: any) { return this._view.getBigInt64(this._baseOffset + offset, true); };
				setter = function(this: any, val: bigint) { this._view.setBigInt64(this._baseOffset + offset, val, true); };
				break;
			case "biguint64":
				getter = function(this: any) { return this._view.getBigUint64(this._baseOffset + offset, true); };
				setter = function(this: any, val: bigint) { this._view.setBigUint64(this._baseOffset + offset, val, true); };
				break;
			default:
				throw new Error(`Unsupported field type: ${type}`);
		}

		Object.defineProperty(proto, key, {
			get: getter,
			set: setter,
			enumerable: true,
			configurable: false
		});
	}

	class ShadowWrapper implements IShadowView {
		public _view: DataView;
		public _baseOffset: number = 0;

		constructor(buffer: ArrayBufferLike) {
			this._view = new DataView(buffer);
		}

		public _setTarget(offset: number) {
			this._baseOffset = offset;
		}
	}

	Object.setPrototypeOf(ShadowWrapper.prototype, proto);
	return ShadowWrapper as any as {
		new (buffer: ArrayBufferLike): T & IShadowView;
	};
}

