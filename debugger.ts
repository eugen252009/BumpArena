import { argv, stdout } from "node:process"
import { Arena } from "./arena.ts"

const path = argv[2]
const start = argv[3] || 0
const length = argv[4] || Infinity
if (path == undefined) {
	console.log(`Use: bun debugger.ts file.db [0] [length]`)
	process.exit(1)
}


const a = new Arena().import(Bun.mmap(path).buffer)
const colors = {
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	purple: "\x1b[35m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
	reset: "\x1b[0m",
}
console.log(`${colors.red}total_length ${colors.green}payloadLength ${colors.yellow}generation ${colors.blue}status ${colors.cyan}magic ${colors.purple}payload ${colors.gray}padding${colors.reset}`)

let count = 0;
const offset = Number(start)
const len = Number(length)
for (const item of a.records()) {
	if (count < offset) { count++; continue; }
	if (count == offset + len) break
	count++
	const data = a.inspect(item[1])
	const payload = data.payload!
	for (let j = 0; j < payload.length;) {
		if (j === 0x00) { stdout.write(`${colors.red}${payload.subarray(0x00, 0x04).toHex()}${colors.reset}`); j = 0x04; continue }		// total_length
		if (j === 0x04) { stdout.write(`${colors.green}${payload.subarray(0x04, 0x08).toHex()}${colors.reset}`); j = 0x08; continue }	// payload_length
		if (j === 0x08) { stdout.write(`${colors.yellow}${payload.subarray(0x08, 0x0C).toHex()}${colors.reset}`); j = 0x0C; continue }	// generation
		if (j === 0x0C) { stdout.write(`${colors.blue}${payload.subarray(0x0C, 0x0D).toHex()}${colors.reset}`); j = 0x0D; continue }	// Status
		if (j === 0x0D) { stdout.write(`${colors.cyan}${payload.subarray(0x0D, 0x0F).toHex()}${colors.reset}`); j = 0x10; continue }	// Magic + Version
		if (j === 0x10) { stdout.write(`${colors.purple}${payload.subarray(0x10, 0x10 + data.payloadLength).toHex()}${colors.reset}\n`); break } 					// Payload
	}
}

