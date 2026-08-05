import { testfile } from "./init.ts"
import { exists, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { fastParseNumber } from "./helper.ts";
const shmPath = "/dev/shm/Bumparena.db";
let ingest: number = 0;
let end: number = 0;
let totalSum = 0n;
let newTotalSum = 0n;

let storage = new ArrayBuffer(2 ** 32)
let arena = new Float64Array(storage)
let arenaidx = 0;
const rf = createReadStream(testfile(), { highWaterMark: 16 * 1024 * 1024 });
const BigStorage = new Float64Array(1024);
let bigstorageidx = 0;
let totalRecords = 0;

function processNumber(buf: Uint8Array) {
	if (bigstorageidx >= 1024) {
		arena.set(BigStorage, arenaidx);
		totalRecords += bigstorageidx;
		arenaidx += bigstorageidx;
		bigstorageidx = 0;
	}

	fastParseNumber(buf, 0, buf.length, BigStorage, bigstorageidx++);
}

(async () => {
	if (await exists(shmPath)) {
		await unlink(shmPath);
	}
	const start = performance.now()
	let leftover: Uint8Array | null = null;

	for await (const chunk of rf) {
		let data = chunk;

		if (leftover) {
			const joined = Buffer.allocUnsafe(leftover.length + chunk.length);
			joined.set(leftover);
			joined.set(chunk, leftover.length);
			data = joined;
			leftover = null;
		}

		let i = 0;
		while (true) {
			const pos = data.indexOf(10, i);

			if (pos === -1) {
				const remaining = data.subarray(i);
				if (remaining.length > 0) {
					leftover = Buffer.allocUnsafe(remaining.length);
					leftover.set(remaining);
				}
				break;
			}

			processNumber(data.subarray(i, pos));
			i = pos + 1;
		}
	};

	if (bigstorageidx > 0) {
		const finalChunk = BigStorage.subarray(0, bigstorageidx);
		arena.set(finalChunk, arenaidx);
		arenaidx += finalChunk.length
		totalRecords += bigstorageidx;
		bigstorageidx = 0
	}

	const populated = arena.subarray(0, arenaidx);
	for (const item of populated) {
		totalSum += BigInt(item)
	}
	ingest = performance.now()
	await Bun.write(shmPath, arena.buffer)
	arenaidx = 0
	const persist = performance.now()
	const newFile = Bun.mmap(shmPath)
	storage = newFile.buffer
	arena = new Float64Array(storage)
	const recover = performance.now()
	const populatedRecovered = arena.subarray(0, totalRecords);
	for (const _ of populatedRecovered) { }
	const recover2 = performance.now()
	for (const item of populatedRecovered) { newTotalSum += BigInt(item) }
	end = performance.now()

	console.log(`Total Time: ${(end - start).toFixed(3)} ms`)
	const stats = {
		throughput_in: Math.round(totalRecords / ((ingest - start) / 1000)).toLocaleString() + " lines/s",
		throughput_out: Math.round(totalRecords / (end - recover2)).toLocaleString() + " lines/s",
		throughput_out_raw: `${Math.round(totalRecords / (recover2 - recover)).toLocaleString()} lines/s`,
		rss: `${(process.memoryUsage().rss / 1024 ** 3).toFixed(3)} GB`,
		heap: `${(process.memoryUsage().heapUsed / 1024 ** 3).toFixed(3)} GB`,
		persist: `${((persist - ingest)).toFixed(3)} ms`,
		recover: `${((recover - persist)).toFixed(3)} ms`,
		items: totalRecords,
	};
	if (process.env.BENCH_JSON) {
		process.stdout.write(`---JSON---${JSON.stringify(stats)}`);
	} else {
		console.log("Integrity Check:", totalSum === newTotalSum && totalSum === 5554728545810779096126n, totalSum);
		console.table(stats);
		console.log(`Arena size: ${arena.length * 8} bytes`)
	}
	if (await exists(shmPath)) {
		await unlink(shmPath);
	}
})()
