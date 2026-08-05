export type ArenaLocation = bigint & { readonly __data_pointer: unique symbol };
export interface ArenaOptions {
	initialSize?: number
	alignment?: 8 | 16 | 32 | 64
	bucketOffsets?: number[];
	bucketCapacities?: number[];
}
export interface InspectStruct {
	offset: number;
	generation_ptr: number;
	generation: number;
	isSafe: boolean;
	totalLength: number;
	payloadLength: number;
	isDeleted: boolean;
	payload?: Uint8Array;
}
export interface IStorageStrategy {
	alloc(data: Uint8Array, headers?: ArenaCustomHeaders): ArenaLocation
	read(location: ArenaLocation): Uint8Array | null
	free(location: ArenaLocation): ArenaLocation
	estimate(size: number, amnt: number): number
	reset(): void
	clear(): void

	collectActiveRecords<T extends ArenaType = "Uint8Array">(
		callback: (data: any, ptr: ArenaLocation, idx: number) => void,
		type: T = "Uint8" as T
	): void;
	records(): [Uint8Array, ArenaLocation] | undefined;
}

export type FieldType = "uint8" | "int8" | "uint16" | "int16" | "uint32" | "int32" | "float32" | "float64" | "bigint64" | "biguint64";

export interface FieldDescriptor {
	type: FieldType;
	offset: number;
}

export interface Schema {
	[key: string]: FieldDescriptor;
}

export interface IShadowView {
	_setTarget(offset: number): void;
	_view: DataView;
	_baseOffset: number;
}

