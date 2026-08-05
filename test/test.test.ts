import { describe, test } from "node:test"
import { equal } from "node:assert"
import { TestCheckDirectPtrAccess, TestCheckPtrAccess, TestUseAfterFree } from "./ptrs.ts"
import { TestCheckReserve } from "./reserve.ts"
import { TestDirectAlloc } from "./directAccess.ts"
import { TestIteratorAccess } from "./iterator.ts"
import { FuzzAlloc } from "./Fuzz.ts"
import { TestShadowAccess } from "./shadow.ts"
import { nearoverflow, nearoverflow2, nearoverflow3, nearoverflow4 } from "./overflow.ts"

describe("Arena Checks", () => {
	test("Pointer Access", () => equal(TestCheckPtrAccess(), true, "Data corruption is possible!"))
	test("direct Pointer Access", () => equal(TestCheckDirectPtrAccess(), true, "Data corruption is possible!"))
	test("Use after free", () => equal(TestUseAfterFree(), true, "Use after free is possible!"))
	test("Test Reserving Data", () => equal(TestCheckReserve(), true, "Something with the reservation is not working properly"))
	test("Test allocating data directly", () => equal(TestDirectAlloc(), true, "Direct alloc isnt working properly"))
	test("Check Iteration over the Arena", () => equal(TestIteratorAccess(), true, "Check Iteration"))
	test("Testing intger overflow", () => equal(nearoverflow(), true, "Integer Overflow in reading/writing detected"))
	test("Testing intger overflow", () => equal(nearoverflow2(), true, "Integer Overflow in reading/writing detected"))
	test("Testing intger overflow", () => equal(nearoverflow3(), true, "Integer Overflow in reading/writing detected"))
	test("Testing intger overflow", () => equal(nearoverflow4(), true, "Integer Overflow in reading/writing detected"))
	test("Arena Fuzz-Test: Random Alloc/Free & Integrity", () => equal(FuzzAlloc(), true, "Arena Fuzz-Test: Random Alloc/Free & Integrity"))
	test("Shadow Object Access", () => equal(TestShadowAccess(), true, "Shadow Object Access failed!"))
})

