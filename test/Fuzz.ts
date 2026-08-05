import { Arena } from "../arena.js"
const isCI = !!process.env.CI;
const iterations = isCI ? 5_000 : 10_0000;

export function FuzzAlloc() {
	const arena = new Arena({ initialSize: 1024 * 1024 * 10 });
	const activePointers: { ptr: any, data: Uint8Array }[] = [];

	for (let i = 0; i < iterations; i++) {
		const action = Math.random();

		if (action > 0.3 || activePointers.length === 0) {
			const size = Math.floor(Math.random() * 100) + 1;
			const mockData = new Uint8Array(size).fill(i % 255);
			const ptr = arena.alloc(mockData, 0, mockData.length);

			activePointers.push({ ptr, data: mockData });
		} else {
			const randomIdx = Math.floor(Math.random() * activePointers.length);
			const { ptr } = activePointers[randomIdx]!;

			arena.free(ptr);
			
			// O(1) swap-and-pop
			const last = activePointers.pop()!;
			if (randomIdx < activePointers.length) {
				activePointers[randomIdx] = last;
			}
		}
	}

	console.log(`Fuzzing ended. active Records: ${activePointers.length}`);

	for (const { ptr, data } of activePointers) {
		const storedData = arena.read(ptr)!;
		if (Buffer.from(storedData).compare(data) !== 0) throw new Error("data isn't matching!");
	}
	console.log(`Checking integrity of the Data ended.`);

	let foundCount = 0;
	arena.collectActiveRecords("Uint8Array", () => { foundCount++ });

	if (foundCount !== activePointers.length) return false
	return true
};

