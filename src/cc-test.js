const { compile } = require('../dist/cc');
const { VM } = require('../dist/vm');

let passCount = 0;
let failCount = 0;

function assert(condition, msg) {
    if (condition) {
        passCount++;
    } else {
        throw new Error(msg);
    }
}

async function test(name, fn) {
    try {
        await fn();
        console.log(`  PASS: ${name}`);
    } catch (e) {
        failCount++;
        console.log(`  FAIL: ${name} - ${e.message}`);
    }
}

async function compileAndRun(source, maxCycles = 200000) {
    const { debugInfo, rom } = await compile(source);
    if (!rom) return null;
    const vm = new VM(rom, { wdt: false });
    vm.run(maxCycles);
    return { vm, debugInfo };
}

function readRam(vm, addr) {
    return vm.getState().ram[addr];
}

function getVarAddr(debugInfo, scope, varName) {
    let varAddr = null;
    [, varName, idx] = varName.match(/([^A-Z0-9_]+)\[(\d+)\]/) || [, varName, '0'];
    debugInfo.varMap.get(scope)?.find(({ name, ramAddr }) => {
        if (varName === name) {
            varAddr = ramAddr;
            return true;
        }
    });
    return varAddr + parseInt(idx);
}

async function runTests() {
    await test(`x << 1: 0x03 << 1 = 0x06`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 3; unsigned char y; void main() { y = x << 1; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 0x06, `expected 0x06, got 0x${readRam(vm, addrY).toString(16)}`);
    });

    await test(`x << 1: 0x80 << 1 = 0x00 (not 0x01 circular)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 128; unsigned char y; void main() { y = x << 1; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 0x00, `expected 0x00, got 0x${readRam(vm, addrY).toString(16)}`);
    });

    await test(`x << 2: 0x03 << 2 = 0x0C`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 3; unsigned char y; void main() { y = x << 2; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 0x0C, `expected 0x0C, got 0x${readRam(vm, addrY).toString(16)}`);
    });

    await test(`x << 3: 0x01 << 3 = 0x08`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 1; unsigned char y; void main() { y = x << 3; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 0x08, `expected 0x08, got 0x${readRam(vm, addrY).toString(16)}`);
    });

    await test(`x >> 1: 0x06 >> 1 = 0x03`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 6; unsigned char y; void main() { y = x >> 1; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 0x03, `expected 0x03, got 0x${readRam(vm, addrY).toString(16)}`);
    });

    await test(`x >> 1: 0x81 >> 1 = 0x40 (not 0xC0 circular)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 129; unsigned char y; void main() { y = x >> 1; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 0x40, `expected 0x40, got 0x${readRam(vm, addrY).toString(16)}`);
    });

    await test(`x >> 2: 0x0C >> 2 = 0x03`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 12; unsigned char y; void main() { y = x >> 2; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 0x03, `expected 0x03, got 0x${readRam(vm, addrY).toString(16)}`);
    });

    await test(`x * 2: 5 * 2 = 10`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 5; unsigned char y; void main() { y = x * 2; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 10, `expected 10, got ${readRam(vm, addrY)}`);
    });

    await test(`x * 2: 128 * 2 = 0 (overflow)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 128; unsigned char y; void main() { y = x * 2; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 0, `expected 0, got ${readRam(vm, addrY)}`);
    });

    await test(`x / 2: 10 / 2 = 5`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 10; unsigned char y; void main() { y = x / 2; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 5, `expected 5, got ${readRam(vm, addrY)}`);
    });

    await test(`x / 2: 11 / 2 = 5 (integer division)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 11; unsigned char y; void main() { y = x / 2; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 5, `expected 5, got ${readRam(vm, addrY)}`);
    });

    await test(`a - b: 10 - 3 = 7`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; unsigned char b = 3; unsigned char c; void main() { c = a - b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 7, `expected 7, got ${readRam(vm, addrC)}`);
    });

    await test(`a -= b: 10 -= 3 = 7`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; unsigned char b = 3; void main() { a -= b; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 7, `expected 7, got ${readRam(vm, addrA)}`);
    });

    await test(`a -= 3: 10 -= 3 = 7`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; void main() { a -= 3; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 7, `expected 7, got ${readRam(vm, addrA)}`);
    });

    await test(`-x: -(1) = 0xFF (two complement)`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char a; signed char b = 1; void main() { a = -b; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 0xFF, `expected 0xFF, got 0x${readRam(vm, addrA).toString(16)}`);
    });

    await test(`-x: -(0) = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char a; signed char b = 0; void main() { a = -b; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 0, `expected 0, got ${readRam(vm, addrA)}`);
    });

    await test(`unsigned char x = 42 should initialize x to 42`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 42; void main() { }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 42, `expected 42, got ${readRam(vm, addrX)}`);
    });

    await test(`unsigned char x = 255 should initialize x to 255`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 255; void main() { }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 255, `expected 255, got ${readRam(vm, addrX)}`);
    });

    await test(`a + b: 10 + 20 = 30`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; unsigned char b = 20; unsigned char c; void main() { c = a + b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 30, `expected 30, got ${readRam(vm, addrC)}`);
    });

    await test(`a += b: 10 += 20 = 30`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; unsigned char b = 20; void main() { a += b; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 30, `expected 30, got ${readRam(vm, addrA)}`);
    });

    await test(`a & b: 0xFF & 0x0F = 0x0F`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 255; unsigned char b = 15; unsigned char c; void main() { c = a & b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 0x0F, `expected 0x0F, got 0x${readRam(vm, addrC).toString(16)}`);
    });

    await test(`a | b: 0xF0 | 0x0F = 0xFF`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 240; unsigned char b = 15; unsigned char c; void main() { c = a | b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 0xFF, `expected 0xFF, got 0x${readRam(vm, addrC).toString(16)}`);
    });

    await test(`a ^ b: 0xFF ^ 0x0F = 0xF0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 255; unsigned char b = 15; unsigned char c; void main() { c = a ^ b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 0xF0, `expected 0xF0, got 0x${readRam(vm, addrC).toString(16)}`);
    });

    await test(`5 < 10 should be true (1)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b = 10; unsigned char c; void main() { c = (a < b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`switch: case 2 match`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 2; unsigned char c; void main() { switch(x) { case 1: c = 10; break; case 2: c = 20; break; default: c = 30; } }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 20, `expected 20, got ${readRam(vm, addrC)}`);
    });

    await test(`switch: case 1 match`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 1; unsigned char c; void main() { switch(x) { case 1: c = 10; break; case 2: c = 20; break; default: c = 30; } }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 10, `expected 10, got ${readRam(vm, addrC)}`);
    });

    await test(`switch: default match`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 5; unsigned char c; void main() { switch(x) { case 1: c = 10; break; case 2: c = 20; break; default: c = 30; } }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 30, `expected 30, got ${readRam(vm, addrC)}`);
    });

    await test(`switch: fall-through`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 1; unsigned char c; void main() { switch(x) { case 1: c = 10; case 2: c = 20; break; default: c = 30; } }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 20, `expected 20 (fall-through), got ${readRam(vm, addrC)}`);
    });

    await test(`add(3, add(4, 5)) = 12`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char add(unsigned char x, unsigned char y) { return x + y; } unsigned char c; void main() { c = add(3, add(4, 5)); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 12, `expected 12, got ${readRam(vm, addrC)}`);
    });

    await test(`c = (a=5, b=10, a+b) = 15`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 1; unsigned char b = 2; unsigned char c; void main() { c = (a = 5, b = 10, a + b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 15, `expected 15, got ${readRam(vm, addrC)}`);
    });

    await test(`c = (a = 5) => c=5, a=5`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a; unsigned char c; void main() { c = (a = 5); }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrA) === 5, `a expected 5, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrC) === 5, `c expected 5, got ${readRam(vm, addrC)}`);
    });

    await test(`c = (a += 5) => a=8, c=8`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char c; void main() { c = (a += 5); }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrA) === 8, `a expected 8, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrC) === 8, `c expected 8, got ${readRam(vm, addrC)}`);
    });

    await test(`arr[5]={1,2,3,4,5}, arr[2]=3`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[5] = {1, 2, 3, 4, 5}; unsigned char c; void main() { c = arr[2]; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 3, `expected 3, got ${readRam(vm, addrC)}`);
    });

    await test(`char literal: c = 'A' should be 65`, async () => {
        const { debugInfo, vm } = await compileAndRun("unsigned char c; void main() { c = 'A'; }");
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 65, `expected 65, got ${readRam(vm, addrC)}`);
    });

    await test(`char literal: c = '0' should be 48`, async () => {
        const { debugInfo, vm } = await compileAndRun("unsigned char c; void main() { c = '0'; }");
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 48, `expected 48, got ${readRam(vm, addrC)}`);
    });

    await test(`void function with return value should error`, async () => {
        try {
            await compileAndRun('void foo() { return 5; } void main() { foo(); }');
            assert(false, 'should have thrown error');
        } catch (e) {
            assert(e.message.includes('void'), `expected void error, got: ${e.message}`);
        }
    });

    await test(`void function with bare return should work`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 0; void foo() { x = 5; return; } void main() { foo(); }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 5, `expected 5, got ${readRam(vm, addrX)}`);
    });

    await test(`arr[5]={1,2,3,4,5}, arr[0]=1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[5] = {1, 2, 3, 4, 5}; unsigned char c; void main() { c = arr[0]; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`arr[5]={1,2,3,4,5}, arr[4]=5`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[5] = {1, 2, 3, 4, 5}; unsigned char c; void main() { c = arr[4]; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 5, `expected 5, got ${readRam(vm, addrC)}`);
    });

    await test(`return a++ returns old value`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char foo() { return a++; } unsigned char c; void main() { c = foo(); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 5, `expected 5, got ${readRam(vm, addrC)}`);
    });

    await test(`return (a = 5) returns 5`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char foo() { return (a = 5); } unsigned char c; void main() { c = foo(); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 5, `expected 5, got ${readRam(vm, addrC)}`);
    });

    await test(`return ternary expression`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char foo(unsigned char x) { return x > 5 ? 10 : 20; } unsigned char c; void main() { c = foo(3); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 20, `expected 20, got ${readRam(vm, addrC)}`);
    });

    await test(`10 < 5 should be false (0)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; unsigned char b = 5; unsigned char c; void main() { c = (a < b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 0, `expected 0, got ${readRam(vm, addrC)}`);
    });

    await test(`5 == 5 should be true (1)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b = 5; unsigned char c; void main() { c = (a == b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`5 != 10 should be true (1)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b = 10; unsigned char c; void main() { c = (a != b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`a++: 5++ = 6`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; void main() { a++; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 6, `expected 6, got ${readRam(vm, addrA)}`);
    });

    await test(`a--: 5-- = 4`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; void main() { a--; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 4, `expected 4, got ${readRam(vm, addrA)}`);
    });

    await test(`10 / 3 = 3`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; unsigned char b = 3; unsigned char c; void main() { c = a / b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 3, `expected 3, got ${readRam(vm, addrC)}`);
    });

    await test(`10 % 3 = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; unsigned char b = 3; unsigned char c; void main() { c = a % b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`local var: a = 10, b = 3, c = a + b = 13`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 10; unsigned char b = 3; unsigned char c; c = a + b; }');
        const addrC = getVarAddr(debugInfo, 'main', 'c');
        assert(addrC !== null, 'should find local var c');
        assert(readRam(vm, addrC) === 13, `expected 13, got ${readRam(vm, addrC)}`);
    });

    await test(`local var: a = 10, a += 5 = 15`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 10; a += 5; }');
        const addrA = getVarAddr(debugInfo, 'main', 'a');
        assert(addrA !== null, 'should find local var a');
        assert(readRam(vm, addrA) === 15, `expected 15, got ${readRam(vm, addrA)}`);
    });

    await test(`a &= 0x0F: 0xAB &= 0x0F = 0x0B`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 171; void main() { a &= 15; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 0x0B, `expected 0x0B, got 0x${readRam(vm, addrA).toString(16)}`);
    });

    await test(`a |= 0x0F: 0xF0 |= 0x0F = 0xFF`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 240; void main() { a |= 15; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 0xFF, `expected 0xFF, got 0x${readRam(vm, addrA).toString(16)}`);
    });

    await test(`a ^= 0xFF: 0x55 ^= 0xFF = 0xAA`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 85; void main() { a ^= 255; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 0xAA, `expected 0xAA, got 0x${readRam(vm, addrA).toString(16)}`);
    });

    await test(`if (1) x = 5 else x = 10 => x = 5`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x; void main() { if (1) { x = 5; } else { x = 10; } }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 5, `expected 5, got ${readRam(vm, addrX)}`);
    });

    await test(`if (0) x = 5 else x = 10 => x = 10`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x; void main() { if (0) { x = 5; } else { x = 10; } }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 10, `expected 10, got ${readRam(vm, addrX)}`);
    });

    await test(`while loop: sum 1+2+3 = 6`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char sum = 0; unsigned char i = 1; void main() { while (i <= 3) { sum += i; i++; } }');
        const addrSum = getVarAddr(debugInfo, 'global', 'sum');
        assert(readRam(vm, addrSum) === 6, `expected 6, got ${readRam(vm, addrSum)}`);
    });

    await test(`for loop: sum 1+2+3 = 6`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char sum; unsigned char i; void main() { sum = 0; for (i = 1; i <= 3; i++) { sum += i; } }');
        const addrSum = getVarAddr(debugInfo, 'global', 'sum');
        assert(readRam(vm, addrSum) === 6, `expected 6, got ${readRam(vm, addrSum)}`);
    });

    await test(`function call: add(3, 4) = 7`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char add(unsigned char a, unsigned char b) { return a + b; } unsigned char result; void main() { result = add(3, 4); }');
        const addrResult = getVarAddr(debugInfo, 'global', 'result');
        assert(readRam(vm, addrResult) === 7, `expected 7, got ${readRam(vm, addrResult)}`);
    });

    await test(`arr[2] = 42, read arr[2] = 42`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[5]; void main() { arr[2] = 42; }');
        const addrArr2 = getVarAddr(debugInfo, 'global', 'arr[2]');
        assert(addrArr2 !== null, 'should find arr[2]');
        assert(readRam(vm, addrArr2) === 42, `expected 42, got ${readRam(vm, addrArr2)}`);
    });

    await test(`arr[2] = 42, x = arr[2] => x = 42`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[5]; unsigned char x; void main() { arr[2] = 42; x = arr[2]; }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 42, `expected 42, got ${readRam(vm, addrX)}`);
    });

    await test(`3 <= 3 should be true (1)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 3; unsigned char c; void main() { c = (a <= b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`3 > 3 should be false (0)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 3; unsigned char c; void main() { c = (a > b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 0, `expected 0, got ${readRam(vm, addrC)}`);
    });

    await test(`3 >= 3 should be true (1)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 3; unsigned char c; void main() { c = (a >= b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`5 > 3 should be true (1)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b = 3; unsigned char c; void main() { c = (a > b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`0xFF << 1 = 0xFE (not circular)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 255; unsigned char y; void main() { y = x << 1; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 0xFE, `expected 0xFE, got 0x${readRam(vm, addrY).toString(16)}`);
    });

    await test(`1 >> 1 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 1; unsigned char y; void main() { y = x >> 1; }');
        const addrY = getVarAddr(debugInfo, 'global', 'y');
        assert(readRam(vm, addrY) === 0, `expected 0, got ${readRam(vm, addrY)}`);
    });

    await test(`3 - 10 = 0xF9 (unsigned underflow)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 10; unsigned char c; void main() { c = a - b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 0xF9, `expected 0xF9, got 0x${readRam(vm, addrC).toString(16)}`);
    });

    await test(`nested if: if(1) if(0) x=5 else x=10 => x=10`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x; void main() { if (1) { if (0) { x = 5; } else { x = 10; } } }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 10, `expected 10, got ${readRam(vm, addrX)}`);
    });

    await test(`local arr[3]; arr[1] = 99 => arr[1] = 99`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3]; arr[1] = 99; }');
        const addrArr1 = getVarAddr(debugInfo, 'main', 'arr[1]');
        assert(addrArr1 !== null, 'should find arr[1]');
        assert(readRam(vm, addrArr1) === 99, `expected 99, got ${readRam(vm, addrArr1)}`);
    });

    await test(`1 && 1 = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char c; void main() { c = (1 && 1); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`1 && 0 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char c; void main() { c = (1 && 0); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 0, `expected 0, got ${readRam(vm, addrC)}`);
    });

    await test(`0 || 1 = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char c; void main() { c = (0 || 1); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`0 || 0 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char c; void main() { c = (0 || 0); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 0, `expected 0, got ${readRam(vm, addrC)}`);
    });

    await test(`!0 = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char c; void main() { c = !0; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`!5 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char c; void main() { c = !5; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 0, `expected 0, got ${readRam(vm, addrC)}`);
    });

    await test(`do-while: sum 1+2+3 = 6`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char sum = 0; unsigned char i = 0; void main() { do { i++; sum += i; } while (i < 3); }');
        const addrSum = getVarAddr(debugInfo, 'global', 'sum');
        assert(readRam(vm, addrSum) === 6, `expected 6, got ${readRam(vm, addrSum)}`);
    });

    await test(`x <<= 1: 4<<=1 = 8`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 4; void main() { x <<= 1; }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 8, `expected 8, got ${readRam(vm, addrX)}`);
    });

    await test(`x >>= 1: 16>>=1 = 8`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 16; void main() { x >>= 1; }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 8, `expected 8, got ${readRam(vm, addrX)}`);
    });

    await test(`x *= 3: 5*=3 = 15`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 5; void main() { x *= 3; }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 15, `expected 15, got ${readRam(vm, addrX)}`);
    });

    await test(`x /= 3: 10/=3 = 3`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 10; void main() { x /= 3; }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 3, `expected 3, got ${readRam(vm, addrX)}`);
    });

    await test(`x %= 3: 10%=3 = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 10; void main() { x %= 3; }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 1, `expected 1, got ${readRam(vm, addrX)}`);
    });

    await test(`b = a++: a=5, b should be 5 (old value), a should be 6`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b; void main() { b = a++; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        assert(readRam(vm, addrA) === 6, `expected a=6, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 5, `expected b=5, got ${readRam(vm, addrB)}`);
    });

    await test(`b = ++a: a=5, b should be 6 (new value), a should be 6`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b; void main() { b = ++a; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        assert(readRam(vm, addrA) === 6, `expected a=6, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 6, `expected b=6, got ${readRam(vm, addrB)}`);
    });

    await test(`b = a--: a=5, b should be 5 (old value), a should be 4`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b; void main() { b = a--; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        assert(readRam(vm, addrA) === 4, `expected a=4, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 5, `expected b=5, got ${readRam(vm, addrB)}`);
    });

    await test(`b = --a: a=5, b should be 4 (new value), a should be 4`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b; void main() { b = --a; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        assert(readRam(vm, addrA) === 4, `expected a=4, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 4, `expected b=4, got ${readRam(vm, addrB)}`);
    });

    await test(`1 ? 10 : 20 = 10`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char c; void main() { c = (1 ? 10 : 20); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 10, `expected 10, got ${readRam(vm, addrC)}`);
    });

    await test(`0 ? 10 : 20 = 20`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char c; void main() { c = (0 ? 10 : 20); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 20, `expected 20, got ${readRam(vm, addrC)}`);
    });

    await test(`arr[i] = val with variable index`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[5]; unsigned char i = 2; unsigned char val = 42; void main() { arr[i] = val; }');
        const addrArr = getVarAddr(debugInfo, 'global', 'arr[0]');
        assert(readRam(vm, addrArr + 2) === 42, `expected arr[2]=42, got ${readRam(vm, addrArr + 2)}`);
    });

    await test(`c = arr[i] with variable index`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[5]; unsigned char i = 3; unsigned char c; void main() { arr[3] = 77; c = arr[i]; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 77, `expected c=77, got ${readRam(vm, addrC)}`);
    });

    await test(`for loop with break`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char sum = 0; unsigned char i; void main() { for (i = 1; i <= 5; i++) { if (i == 3) break; sum += i; } }');
        const addrSum = getVarAddr(debugInfo, 'global', 'sum');
        assert(readRam(vm, addrSum) === 3, `expected sum=3, got ${readRam(vm, addrSum)}`);
    });

    await test(`for loop with continue`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char sum = 0; unsigned char i; void main() { for (i = 1; i <= 5; i++) { if (i == 3) continue; sum += i; } }');
        const addrSum = getVarAddr(debugInfo, 'global', 'sum');
        assert(readRam(vm, addrSum) === 12, `expected sum=12, got ${readRam(vm, addrSum)}`);
    });

    await test(`a < b with both variables`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 10; unsigned char c; void main() { c = (a < b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`a > b with both variables`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; unsigned char b = 3; unsigned char c; void main() { c = (a > b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`a <= b with equal values`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b = 5; unsigned char c; void main() { c = (a <= b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`a >= b with equal values`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b = 5; unsigned char c; void main() { c = (a >= b); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 1, `expected 1, got ${readRam(vm, addrC)}`);
    });

    await test(`global init with constant expression: 0xFF - 1 = 254`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 0xFF - 1; void main() { }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 254, `expected 254, got ${readRam(vm, addrA)}`);
    });

    await test(`global init with constant expression: (3 + 4) * 2 = 14`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = (3 + 4) * 2; void main() { }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 14, `expected 14, got ${readRam(vm, addrA)}`);
    });

    await test(`global init with bitwise NOT: ~0x0F = 0xF0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = ~0x0F; void main() { }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 0xF0, `expected 0xF0, got ${readRam(vm, addrA).toString(16)}`);
    });

    await test(`global init with negative: -1 = 0xFF`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = -1; void main() { }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 0xFF, `expected 0xFF, got ${readRam(vm, addrA).toString(16)}`);
    });

    await test(`runtime: a - (-1) = a + 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char c; void main() { c = a - (-1); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 6, `expected 6, got ${readRam(vm, addrC)}`);
    });

    await test(`runtime: a + (-1) = a - 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char c; void main() { c = a + (-1); }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 4, `expected 4, got ${readRam(vm, addrC)}`);
    });

    await test(`global init with constant comparison: 5 > 3 = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = (5 > 3); void main() { }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 1, `expected 1, got ${readRam(vm, addrA)}`);
    });

    await test(`global init with constant logical: (1 && 0) = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = (1 && 0); void main() { }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 0, `expected 0, got ${readRam(vm, addrA)}`);
    });

    await test(`a << b with variable b: 3 << 2 = 12`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 2; unsigned char c; void main() { c = a << b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 12, `expected 12, got ${readRam(vm, addrC)}`);
    });

    await test(`a >> b with variable b: 0x0C >> 2 = 3`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 0x0C; unsigned char b = 2; unsigned char c; void main() { c = a >> b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 3, `expected 3, got ${readRam(vm, addrC)}`);
    });

    await test(`a <<= b with variable b: 3 <<= 2 = 12`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 2; void main() { a <<= b; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 12, `expected 12, got ${readRam(vm, addrA)}`);
    });

    await test(`a >>= b with variable b: 16 >>= 2 = 4`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 16; unsigned char b = 2; void main() { a >>= b; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 4, `expected 4, got ${readRam(vm, addrA)}`);
    });

    await test(`a << 0 with variable b=0: 3 << 0 = 3`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 0; unsigned char c; void main() { c = a << b; }');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrC) === 3, `expected 3, got ${readRam(vm, addrC)}`);
    });

    await test(`global/local same name: local shadows global`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 10; void main() { unsigned char x = 20; unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 20, `local x should shadow global, r=${readRam(vm, addrR)}`);
    });

    await test(`global/local same name: global still accessible from other func`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 10; unsigned char r; void foo() { r = x; } void main() { unsigned char x = 20; foo(); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 10, `foo should see global x=10, r=${readRam(vm, addrR)}`);
    });

    await test(`nested if-else chain`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0; unsigned char a = 5; if (a > 10) { x = 1; } else if (a > 3) { x = 2; } else { x = 3; } }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 2, `a=5 > 3, expected x=2, got ${readRam(vm, addrX)}`);
    });

    await test(`nested if-else chain: last else`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0; unsigned char a = 1; if (a > 10) { x = 1; } else if (a > 3) { x = 2; } else { x = 3; } }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 3, `a=1 <= 3, expected x=3, got ${readRam(vm, addrX)}`);
    });

    await test(`for loop with break and continue`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char s = 0; unsigned char i; for (i = 1; i <= 10; i++) { if (i == 3) continue; if (i == 7) break; s += i; } }');
        const addrS = getVarAddr(debugInfo, 'main', 's');
        assert(readRam(vm, addrS) === 1 + 2 + 4 + 5 + 6, `expected 18, got ${readRam(vm, addrS)}`);
    });

    await test(`while loop with nested condition`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 100; unsigned char count = 0; while (x > 1) { x = x / 2; count++; } }');
        const addrCount = getVarAddr(debugInfo, 'main', 'count');
        assert(readRam(vm, addrCount) === 6, `100/2^6=1, expected count=6, got ${readRam(vm, addrCount)}`);
    });

    await test(`complex expression: (a + b) * (c - d)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 10; unsigned char b = 5; unsigned char c = 8; unsigned char d = 3; unsigned char r = (a + b) * (c - d); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 15 * 5, `expected 75, got ${readRam(vm, addrR)}`);
    });

    await test(`multiple return paths`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char classify(unsigned char x) { if (x > 100) { return 3; } if (x > 10) { return 2; } return 1; } void main() { unsigned char a = classify(5); unsigned char b = classify(50); unsigned char c = classify(150); }');
        const addrA = getVarAddr(debugInfo, 'main', 'a');
        const addrB = getVarAddr(debugInfo, 'main', 'b');
        const addrC = getVarAddr(debugInfo, 'main', 'c');
        assert(readRam(vm, addrA) === 1, `classify(5)=1, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 2, `classify(50)=2, got ${readRam(vm, addrB)}`);
        assert(readRam(vm, addrC) === 3, `classify(150)=3, got ${readRam(vm, addrC)}`);
    });

    await test(`recursive fibonacci`, async () => {
        try {
            const { debugInfo, vm } = await compileAndRun('unsigned char fib(unsigned char n) { if (n <= 1) return n; return fib(n-1) + fib(n-2); } void main() { unsigned char r = fib(6); }', 500000);
            const addrR = getVarAddr(debugInfo, 'main', 'r');
            assert(readRam(vm, addrR) === 8, `fib(6)=8, got ${readRam(vm, addrR)}`);
        } catch (e) {
            assert(e.message.includes('not supported'), `expected not supported error, got: ${e.message}`);
        }
    });

    await test(`array passed index from function`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char idx() { return 2; } void main() { unsigned char arr[5]; arr[0] = 10; arr[1] = 20; arr[2] = 30; arr[3] = 40; arr[4] = 50; unsigned char r = arr[idx()]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `arr[idx()]=30, got ${readRam(vm, addrR)}`);
    });

    await test(`compound bitwise with variable`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 0xAB; unsigned char b = 0x0F; a &= b; }');
        const addrA = getVarAddr(debugInfo, 'main', 'a');
        assert(readRam(vm, addrA) === 0x0B, `0xAB & 0x0F = 0x0B, got 0x${readRam(vm, addrA).toString(16)}`);
    });

    await test(`nested ternary`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char r = a > 10 ? 1 : a > 3 ? 2 : 3; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 2, `5>10?1:5>3?2:3 = 2, got ${readRam(vm, addrR)}`);
    });

    await test(`logical NOT with comparison`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char r = !(a > 10); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `!(5>10)=1, got ${readRam(vm, addrR)}`);
    });

    await test(`double negation`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char r = !!a; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `!!5=1, got ${readRam(vm, addrR)}`);
    });

    await test(`comparison as value in arithmetic`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char b = 3; unsigned char r = (a > b) + (a == b); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `(5>3)+(5==3)=1+0=1, got ${readRam(vm, addrR)}`);
    });

    await test(`chained comparison logic`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char b = 3; unsigned char c = 7; unsigned char r = (a > b) && (c > a); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `(5>3)&&(7>5)=1, got ${readRam(vm, addrR)}`);
    });

    await test(`switch with char literal case`, async () => {
        const { debugInfo, vm } = await compileAndRun("void main() { unsigned char c = 'B'; unsigned char r = 0; switch(c) { case 'A': r = 1; break; case 'B': r = 2; break; case 'C': r = 3; break; default: r = 9; } }");
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 2, `switch('B')=2, got ${readRam(vm, addrR)}`);
    });

    await test(`cross-bank: function with bank1 locals`, async () => {
        let code = 'unsigned char g0 = 0; unsigned char g1 = 1; unsigned char g2 = 2; unsigned char g3 = 3; unsigned char g4 = 4; unsigned char g5 = 5; unsigned char g6 = 6; unsigned char g7 = 7; unsigned char g8 = 8; unsigned char g9 = 9; unsigned char g10 = 10; unsigned char g11 = 11; unsigned char g12 = 12; unsigned char g13 = 13; unsigned char g14 = 14; unsigned char g15 = 15; unsigned char g16 = 16; unsigned char g17 = 17; unsigned char g18 = 18; unsigned char g19 = 19; unsigned char g20 = 20; unsigned char g21 = 21; unsigned char g22 = 22; unsigned char g23 = 23; unsigned char g24 = 24; unsigned char g25 = 25; unsigned char g26 = 26; unsigned char g27 = 27; unsigned char g28 = 28; unsigned char g29 = 29; unsigned char g30 = 30; unsigned char g31 = 31; unsigned char g32 = 32; unsigned char g33 = 33; unsigned char g34 = 34; unsigned char g35 = 35; unsigned char g36 = 36; unsigned char g37 = 37; unsigned char g38 = 38; unsigned char g39 = 39; unsigned char g40 = 40; unsigned char g41 = 41; unsigned char g42 = 42; unsigned char g43 = 43; unsigned char g44 = 44; unsigned char g45 = 45; unsigned char g46 = 46; unsigned char g47 = 47; unsigned char g48 = 48; unsigned char g49 = 49; unsigned char g50 = 50; unsigned char g51 = 51; unsigned char g52 = 52; unsigned char g53 = 53; unsigned char g54 = 54; unsigned char g55 = 55; unsigned char g56 = 56; unsigned char g57 = 57; unsigned char g58 = 58; unsigned char g59 = 59; ';
        code += 'void main() { unsigned char a = 100; unsigned char b = 200; unsigned char r = a + b; }';
        const { debugInfo, vm } = await compileAndRun(code);
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((100 + 200) & 0xFF), `100+200=44(0x2C), got ${readRam(vm, addrR)}`);
    });

    await test(`cross-bank: bank1 array access`, async () => {
        let code = 'unsigned char g0 = 0; unsigned char g1 = 1; unsigned char g2 = 2; unsigned char g3 = 3; unsigned char g4 = 4; unsigned char g5 = 5; unsigned char g6 = 6; unsigned char g7 = 7; unsigned char g8 = 8; unsigned char g9 = 9; unsigned char g10 = 10; unsigned char g11 = 11; unsigned char g12 = 12; unsigned char g13 = 13; unsigned char g14 = 14; unsigned char g15 = 15; unsigned char g16 = 16; unsigned char g17 = 17; unsigned char g18 = 18; unsigned char g19 = 19; unsigned char g20 = 20; unsigned char g21 = 21; unsigned char g22 = 22; unsigned char g23 = 23; unsigned char g24 = 24; unsigned char g25 = 25; unsigned char g26 = 26; unsigned char g27 = 27; unsigned char g28 = 28; unsigned char g29 = 29; unsigned char g30 = 30; unsigned char g31 = 31; unsigned char g32 = 32; unsigned char g33 = 33; unsigned char g34 = 34; unsigned char g35 = 35; unsigned char g36 = 36; unsigned char g37 = 37; unsigned char g38 = 38; unsigned char g39 = 39; unsigned char g40 = 40; unsigned char g41 = 41; unsigned char g42 = 42; unsigned char g43 = 43; unsigned char g44 = 44; unsigned char g45 = 45; unsigned char g46 = 46; unsigned char g47 = 47; unsigned char g48 = 48; unsigned char g49 = 49; unsigned char g50 = 50; unsigned char g51 = 51; unsigned char g52 = 52; unsigned char g53 = 53; unsigned char g54 = 54; unsigned char g55 = 55; unsigned char g56 = 56; unsigned char g57 = 57; unsigned char g58 = 58; unsigned char g59 = 59; ';
        code += 'void main() { unsigned char arr[5]; arr[0] = 10; arr[1] = 20; arr[2] = 30; arr[3] = 40; arr[4] = 50; unsigned char r = arr[2]; }';
        const { debugInfo, vm } = await compileAndRun(code);
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `arr[2]=30, got ${readRam(vm, addrR)}`);
    });

    await test(`cross-bank: bank1 dynamic array index`, async () => {
        let code = 'unsigned char g0 = 0; unsigned char g1 = 1; unsigned char g2 = 2; unsigned char g3 = 3; unsigned char g4 = 4; unsigned char g5 = 5; unsigned char g6 = 6; unsigned char g7 = 7; unsigned char g8 = 8; unsigned char g9 = 9; unsigned char g10 = 10; unsigned char g11 = 11; unsigned char g12 = 12; unsigned char g13 = 13; unsigned char g14 = 14; unsigned char g15 = 15; unsigned char g16 = 16; unsigned char g17 = 17; unsigned char g18 = 18; unsigned char g19 = 19; unsigned char g20 = 20; unsigned char g21 = 21; unsigned char g22 = 22; unsigned char g23 = 23; unsigned char g24 = 24; unsigned char g25 = 25; unsigned char g26 = 26; unsigned char g27 = 27; unsigned char g28 = 28; unsigned char g29 = 29; unsigned char g30 = 30; unsigned char g31 = 31; unsigned char g32 = 32; unsigned char g33 = 33; unsigned char g34 = 34; unsigned char g35 = 35; unsigned char g36 = 36; unsigned char g37 = 37; unsigned char g38 = 38; unsigned char g39 = 39; unsigned char g40 = 40; unsigned char g41 = 41; unsigned char g42 = 42; unsigned char g43 = 43; unsigned char g44 = 44; unsigned char g45 = 45; unsigned char g46 = 46; unsigned char g47 = 47; unsigned char g48 = 48; unsigned char g49 = 49; unsigned char g50 = 50; unsigned char g51 = 51; unsigned char g52 = 52; unsigned char g53 = 53; unsigned char g54 = 54; unsigned char g55 = 55; unsigned char g56 = 56; unsigned char g57 = 57; unsigned char g58 = 58; unsigned char g59 = 59; ';
        code += 'void main() { unsigned char arr[5]; unsigned char i = 3; arr[0] = 10; arr[1] = 20; arr[2] = 30; arr[3] = 40; arr[4] = 50; unsigned char r = arr[i]; }';
        const { debugInfo, vm } = await compileAndRun(code);
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 40, `arr[3]=40, got ${readRam(vm, addrR)}`);
    });

    await test(`division: 10 / 3 = 3`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 10; unsigned char y = 3; unsigned char r; void main() { r = x / y; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 3, `10/3=3, got ${readRam(vm, addrR)}`);
    });

    await test(`division: 7 / 7 = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 7; unsigned char y = 7; unsigned char r; void main() { r = x / y; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 1, `7/7=1, got ${readRam(vm, addrR)}`);
    });

    await test(`division: 0 / 5 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 0; unsigned char y = 5; unsigned char r; void main() { r = x / y; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0, `0/5=0, got ${readRam(vm, addrR)}`);
    });

    await test(`modulo: 10 % 3 = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 10; unsigned char y = 3; unsigned char r; void main() { r = x % y; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 1, `10%3=1, got ${readRam(vm, addrR)}`);
    });

    await test(`modulo: 7 % 7 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 7; unsigned char y = 7; unsigned char r; void main() { r = x % y; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0, `7%7=0, got ${readRam(vm, addrR)}`);
    });

    await test(`multiply: 7 * 6 = 42`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 7; unsigned char y = 6; unsigned char r; void main() { r = x * y; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 42, `7*6=42, got ${readRam(vm, addrR)}`);
    });

    await test(`multiply: 0 * 255 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 0; unsigned char y = 255; unsigned char r; void main() { r = x * y; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0, `0*255=0, got ${readRam(vm, addrR)}`);
    });

    await test(`negate: -1 = 0xFF`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 1; unsigned char r; void main() { r = -x; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0xFF, `-1=0xFF, got 0x${readRam(vm, addrR).toString(16)}`);
    });

    await test(`bitwise NOT: ~0x55 = 0xAA`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 0x55; unsigned char r; void main() { r = ~x; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0xAA, `~0x55=0xAA, got 0x${readRam(vm, addrR).toString(16)}`);
    });

    await test(`logical NOT: !0 = 1, !5 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 0; unsigned char y = 5; unsigned char r1; unsigned char r2; void main() { r1 = !x; r2 = !y; }');
        const addrR1 = getVarAddr(debugInfo, 'global', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'global', 'r2');
        assert(readRam(vm, addrR1) === 1, `!0=1, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 0, `!5=0, got ${readRam(vm, addrR2)}`);
    });

    await test(`comparison as value: (5 > 3) = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char r; void main() { r = (5 > 3); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 1, `(5>3)=1, got ${readRam(vm, addrR)}`);
    });

    await test(`comparison as value: (3 > 5) = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char r; void main() { r = (3 > 5); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0, `(3>5)=0, got ${readRam(vm, addrR)}`);
    });

    await test(`nested ternary: (a > b) ? 10 : (a > c) ? 20 : 30`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 5; unsigned char c = 1; unsigned char r; void main() { r = (a > b) ? 10 : (a > c) ? 20 : 30; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 20, `nested ternary=20, got ${readRam(vm, addrR)}`);
    });

    await test(`function with multiple params`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char add(unsigned char a, unsigned char b) { return a + b; } void main() { unsigned char r = add(10, 20); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `add(10,20)=30, got ${readRam(vm, addrR)}`);
    });

    await test(`function call in expression`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char dbl(unsigned char x) { return x * 2; } void main() { unsigned char r = dbl(5) + 3; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 13, `dbl(5)+3=13, got ${readRam(vm, addrR)}`);
    });

    await test(`for loop with complex update`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char sum = 0; unsigned char i; for (i = 1; i <= 5; i++) { sum += i; } }');
        const addrSum = getVarAddr(debugInfo, 'main', 'sum');
        assert(readRam(vm, addrSum) === 15, `1+2+3+4+5=15, got ${readRam(vm, addrSum)}`);
    });

    await test(`while loop with break`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char i = 0; unsigned char sum = 0; while (1) { sum += i; i++; if (i > 5) break; } }');
        const addrSum = getVarAddr(debugInfo, 'main', 'sum');
        assert(readRam(vm, addrSum) === 15, `sum 0..5=15, got ${readRam(vm, addrSum)}`);
    });

    await test(`array compound assign: arr[i] += 5`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3]; arr[0] = 10; arr[1] = 20; arr[2] = 30; unsigned char i = 1; arr[i] += 5; }');
        const addrArr1 = getVarAddr(debugInfo, 'main', 'arr');
        assert(readRam(vm, addrArr1 + 1) === 25, `arr[1]+=5=25, got ${readRam(vm, addrArr1 + 1)}`);
    });

    await test(`array compound assign: arr[i] -= 5`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3]; arr[0] = 10; arr[1] = 20; arr[2] = 30; unsigned char i = 1; arr[i] -= 5; }');
        const addrArr1 = getVarAddr(debugInfo, 'main', 'arr');
        assert(readRam(vm, addrArr1 + 1) === 15, `arr[1]-=5=15, got ${readRam(vm, addrArr1 + 1)}`);
    });

    await test(`variable shift: x << y`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 3; unsigned char y = 2; unsigned char r; void main() { r = x << y; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 12, `3<<2=12, got ${readRam(vm, addrR)}`);
    });

    await test(`variable shift: x >> y`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 12; unsigned char y = 2; unsigned char r; void main() { r = x >> y; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 3, `12>>2=3, got ${readRam(vm, addrR)}`);
    });

    await test(`variable shift by 0: x << 0 = x`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 42; unsigned char y = 0; unsigned char r; void main() { r = x << y; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 42, `42<<0=42, got ${readRam(vm, addrR)}`);
    });

    await test(`global array init`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[4] = {10, 20, 30, 40}; unsigned char r; void main() { r = arr[2]; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 30, `arr[2]=30, got ${readRam(vm, addrR)}`);
    });

    await test(`local array init`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3] = {100, 200, 50}; unsigned char r = arr[1]; }');
        const addrArr = getVarAddr(debugInfo, 'main', 'arr');
        assert(readRam(vm, addrArr + 1) === 200, `arr[1]=200, got ${readRam(vm, addrArr + 1)}`);
    });

    await test(`chained comparison: a < b && b < c`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 5; unsigned char c = 7; unsigned char r; void main() { r = (a < b) && (b < c); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 1, `3<5 && 5<7=1, got ${readRam(vm, addrR)}`);
    });

    await test(`chained comparison: a < b && b > c`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 5; unsigned char c = 7; unsigned char r; void main() { r = (a < b) && (b > c); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0, `3<5 && 5>7=0, got ${readRam(vm, addrR)}`);
    });

    await test(`OR comparison: a > b || b > c`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 5; unsigned char c = 7; unsigned char r; void main() { r = (a > b) || (b > c); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0, `3>5 || 5>7=0, got ${readRam(vm, addrR)}`);
    });

    await test(`OR comparison: a < b || b > c`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 5; unsigned char c = 7; unsigned char r; void main() { r = (a < b) || (b > c); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 1, `3<5 || 5>7=1, got ${readRam(vm, addrR)}`);
    });

    await test(`cast expression: (unsigned char)5`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char r; void main() { r = (unsigned char)5; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 5, `(unsigned char)5=5, got ${readRam(vm, addrR)}`);
    });

    await test(`sizeof array`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[10]; unsigned char r; void main() { r = sizeof(arr); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 10, `sizeof(arr)=10, got ${readRam(vm, addrR)}`);
    });

    await test(`comma expression in for`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char sum = 0; unsigned char i; for (i = 0; i < 5; i++) { sum += i; } }');
        const addrSum = getVarAddr(debugInfo, 'main', 'sum');
        assert(readRam(vm, addrSum) === 10, `0+1+2+3+4=10, got ${readRam(vm, addrSum)}`);
    });

    await test(`assignment as value: a = b = 5`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a; unsigned char b; void main() { a = b = 5; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        assert(readRam(vm, addrA) === 5, `a=5, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 5, `b=5, got ${readRam(vm, addrB)}`);
    });

    await test(`compound assign as value: (a += 5)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; unsigned char b; void main() { b = (a += 5); }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        assert(readRam(vm, addrA) === 15, `a=15, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 15, `b=15, got ${readRam(vm, addrB)}`);
    });

    await test(`do-while loop`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char i = 0; unsigned char sum = 0; do { sum += i; i++; } while (i < 5); }');
        const addrSum = getVarAddr(debugInfo, 'main', 'sum');
        assert(readRam(vm, addrSum) === 10, `0+1+2+3+4=10, got ${readRam(vm, addrSum)}`);
    });

    await test(`do-while executes at least once`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char r = 0; do { r = 1; } while (0); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `do-while runs once, got ${readRam(vm, addrR)}`);
    });

    await test(`continue in for loop`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char sum = 0; unsigned char i; for (i = 0; i < 10; i++) { if (i % 2 == 0) continue; sum += i; } }');
        const addrSum = getVarAddr(debugInfo, 'main', 'sum');
        assert(readRam(vm, addrSum) === 25, `1+3+5+7+9=25, got ${readRam(vm, addrSum)}`);
    });

    await test(`switch fall-through`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 2; unsigned char r = 0; switch(x) { case 1: r = 10; case 2: r = 20; case 3: r = 30; break; default: r = 99; } }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `fall-through to 30, got ${readRam(vm, addrR)}`);
    });

    await test(`negative constant: -1 as initializer`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = -1; unsigned char r; void main() { r = x; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0xFF, `-1=0xFF, got 0x${readRam(vm, addrR).toString(16)}`);
    });

    await test(`constant expression: 3 + 4 * 2 = 11`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char r; void main() { r = 3 + 4 * 2; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 11, `3+4*2=11, got ${readRam(vm, addrR)}`);
    });

    await test(`constant expression: (3 + 4) * 2 = 14`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char r; void main() { r = (3 + 4) * 2; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 14, `(3+4)*2=14, got ${readRam(vm, addrR)}`);
    });

    await test(`XOR swap: a ^= b; b ^= a; a ^= b;`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 0x55; unsigned char b = 0xAA; void main() { a ^= b; b ^= a; a ^= b; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        assert(readRam(vm, addrA) === 0xAA, `a=0xAA, got 0x${readRam(vm, addrA).toString(16)}`);
        assert(readRam(vm, addrB) === 0x55, `b=0x55, got 0x${readRam(vm, addrB).toString(16)}`);
    });

    await test(`array name as address`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[5]; unsigned char r; void main() { r = (unsigned char)arr; }');
        const addrArr = getVarAddr(debugInfo, 'global', 'arr');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === addrArr, `arr addr=${addrArr}, got ${readRam(vm, addrR)}`);
    });

    await test(`division by variable: 20 / 4 = 5`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 20; unsigned char b = 4; unsigned char r; void main() { r = a / b; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 5, `20/4=5, got ${readRam(vm, addrR)}`);
    });

    await test(`modulo by variable: 17 % 5 = 2`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 17; unsigned char b = 5; unsigned char r; void main() { r = a % b; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 2, `17%5=2, got ${readRam(vm, addrR)}`);
    });

    await test(`multiply by variable: 6 * 7 = 42`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 6; unsigned char b = 7; unsigned char r; void main() { r = a * b; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 42, `6*7=42, got ${readRam(vm, addrR)}`);
    });

    await test(`division: 255 / 1 = 255`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 255; unsigned char b = 1; unsigned char r; void main() { r = a / b; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 255, `255/1=255, got ${readRam(vm, addrR)}`);
    });

    await test(`division: 1 / 255 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 1; unsigned char b = 255; unsigned char r; void main() { r = a / b; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0, `1/255=0, got ${readRam(vm, addrR)}`);
    });

    await test(`modulo: 255 % 1 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 255; unsigned char b = 1; unsigned char r; void main() { r = a % b; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0, `255%1=0, got ${readRam(vm, addrR)}`);
    });

    await test(`compound: a *= 3`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 7; void main() { a *= 3; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 21, `7*3=21, got ${readRam(vm, addrA)}`);
    });

    await test(`compound: a /= 3`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; void main() { a /= 3; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 3, `10/3=3, got ${readRam(vm, addrA)}`);
    });

    await test(`compound: a %= 3`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; void main() { a %= 3; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 1, `10%3=1, got ${readRam(vm, addrA)}`);
    });

    await test(`nested function calls`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char inc(unsigned char x) { return x + 1; } unsigned char dbl(unsigned char x) { return x * 2; } void main() { unsigned char r = dbl(inc(5)); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 12, `dbl(inc(5))=12, got ${readRam(vm, addrR)}`);
    });

    await test(`function with 3 params`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char max3(unsigned char a, unsigned char b, unsigned char c) { unsigned char m = a; if (b > m) m = b; if (c > m) m = c; return m; } void main() { unsigned char r = max3(3, 7, 5); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 7, `max3(3,7,5)=7, got ${readRam(vm, addrR)}`);
    });

    await test(`return from middle of function`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char find(unsigned char x) { if (x == 5) return 1; if (x == 10) return 2; return 0; } void main() { unsigned char r = find(10); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 2, `find(10)=2, got ${readRam(vm, addrR)}`);
    });

    await test(`return from middle: no match`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char find(unsigned char x) { if (x == 5) return 1; if (x == 10) return 2; return 0; } void main() { unsigned char r = find(3); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0, `find(3)=0, got ${readRam(vm, addrR)}`);
    });

    await test(`multiple return paths with ternary`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char classify(unsigned char x) { return (x > 10) ? 2 : (x > 5) ? 1 : 0; } void main() { unsigned char r = classify(7); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `classify(7)=1, got ${readRam(vm, addrR)}`);
    });

    await test(`array passed by address simulation`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[4] = {1, 2, 3, 4}; unsigned char sum; void main() { unsigned char i; sum = 0; for (i = 0; i < 4; i++) { sum += arr[i]; } }');
        const addrSum = getVarAddr(debugInfo, 'global', 'sum');
        assert(readRam(vm, addrSum) === 10, `1+2+3+4=10, got ${readRam(vm, addrSum)}`);
    });

    await test(`dynamic array store then load`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5]; unsigned char i; for (i = 0; i < 5; i++) { arr[i] = i * 10; } unsigned char r = arr[3]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `arr[3]=30, got ${readRam(vm, addrR)}`);
    });

    await test(`complex expression: (a + b) * (c - d)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 10; unsigned char b = 5; unsigned char c = 8; unsigned char d = 3; unsigned char r; void main() { r = (a + b) * (c - d); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 75, `(10+5)*(8-3)=75, got ${readRam(vm, addrR)}`);
    });

    await test(`boolean in condition: if (flag)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char flag = 1; unsigned char r = 0; if (flag) r = 42; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 42, `if(1) r=42, got ${readRam(vm, addrR)}`);
    });

    await test(`boolean in condition: if (0)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char r = 42; if (0) r = 0; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 42, `if(0) skip, got ${readRam(vm, addrR)}`);
    });

    await test(`pre/post increment in expression`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char r = ++a; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        const addrA = getVarAddr(debugInfo, 'main', 'a');
        assert(readRam(vm, addrR) === 6, `++a=6, got ${readRam(vm, addrR)}`);
        assert(readRam(vm, addrA) === 6, `a=6, got ${readRam(vm, addrA)}`);
    });

    await test(`post increment in expression`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char r = a++; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        const addrA = getVarAddr(debugInfo, 'main', 'a');
        assert(readRam(vm, addrR) === 5, `a++=5, got ${readRam(vm, addrR)}`);
        assert(readRam(vm, addrA) === 6, `a=6, got ${readRam(vm, addrA)}`);
    });

    await test(`pre decrement in expression`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char r = --a; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        const addrA = getVarAddr(debugInfo, 'main', 'a');
        assert(readRam(vm, addrR) === 4, `--a=4, got ${readRam(vm, addrR)}`);
        assert(readRam(vm, addrA) === 4, `a=4, got ${readRam(vm, addrA)}`);
    });

    await test(`post decrement in expression`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char r = a--; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        const addrA = getVarAddr(debugInfo, 'main', 'a');
        assert(readRam(vm, addrR) === 5, `a--=5, got ${readRam(vm, addrR)}`);
        assert(readRam(vm, addrA) === 4, `a=4, got ${readRam(vm, addrA)}`);
    });

    await test(`bitwise AND/OR in condition`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0x55; unsigned char r = 0; if (x & 0x01) r = 1; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `0x55 & 0x01=true, got ${readRam(vm, addrR)}`);
    });

    await test(`bitwise AND in condition: false`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0x54; unsigned char r = 0; if (x & 0x01) r = 1; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0, `0x54 & 0x01=false, got ${readRam(vm, addrR)}`);
    });

    await test(`left shift assign: a <<= 2`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; void main() { a <<= 2; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 12, `3<<2=12, got ${readRam(vm, addrA)}`);
    });

    await test(`right shift assign: a >>= 2`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 12; void main() { a >>= 2; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 3, `12>>2=3, got ${readRam(vm, addrA)}`);
    });

    await test(`variable left shift assign: a <<= b`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3; unsigned char b = 2; void main() { a <<= b; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 12, `3<<2=12, got ${readRam(vm, addrA)}`);
    });

    await test(`variable right shift assign: a >>= b`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 12; unsigned char b = 2; void main() { a >>= b; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        assert(readRam(vm, addrA) === 3, `12>>2=3, got ${readRam(vm, addrA)}`);
    });

    await test(`constant folding: array size with constant expr`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[2 + 3]; void main() { arr[0] = 10; arr[4] = 50; }');
        const addrArr = getVarAddr(debugInfo, 'global', 'arr');
        assert(readRam(vm, addrArr) === 10, `arr[0]=10, got ${readRam(vm, addrArr)}`);
        assert(readRam(vm, addrArr + 4) === 50, `arr[4]=50, got ${readRam(vm, addrArr + 4)}`);
    });

    await test(`unsigned overflow: 255 + 1 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 255; unsigned char r; void main() { r = a + 1; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0, `255+1=0, got ${readRam(vm, addrR)}`);
    });

    await test(`unsigned underflow: 0 - 1 = 255`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 0; unsigned char r; void main() { r = a - 1; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0xFF, `0-1=255, got ${readRam(vm, addrR)}`);
    });

    await test(`multiple declaration: unsigned char a, b, c`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 1, b = 2, c = 3; unsigned char r = a + b + c; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 6, `1+2+3=6, got ${readRam(vm, addrR)}`);
    });

    await test(`global var init with expression`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 3 + 4; unsigned char r; void main() { r = a; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 7, `3+4=7, got ${readRam(vm, addrR)}`);
    });

    await test(`for loop variable scope`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char i; unsigned char s = 0; for (i = 0; i < 5; i++) { s += i; } }');
        const addrS = getVarAddr(debugInfo, 'main', 's');
        assert(readRam(vm, addrS) === 10, `0+1+2+3+4=10, got ${readRam(vm, addrS)}`);
    });

    await test(`nested loop`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char i; unsigned char j; unsigned char count = 0; for (i = 0; i < 3; i++) { for (j = 0; j < 4; j++) { count++; } } }');
        const addrC = getVarAddr(debugInfo, 'main', 'count');
        assert(readRam(vm, addrC) === 12, `3*4=12, got ${readRam(vm, addrC)}`);
    });

    await test(`short-circuit AND: right side not evaluated`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char called = 0; unsigned char getVal() { called = 1; return 1; } void main() { unsigned char r = 0 && getVal(); }');
        const addrCalled = getVarAddr(debugInfo, 'global', 'called');
        assert(readRam(vm, addrCalled) === 0, `getVal should not be called, called=${readRam(vm, addrCalled)}`);
    });

    await test(`short-circuit OR: right side not evaluated`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char called = 0; unsigned char getVal() { called = 1; return 1; } void main() { unsigned char r = 1 || getVal(); }');
        const addrCalled = getVarAddr(debugInfo, 'global', 'called');
        assert(readRam(vm, addrCalled) === 0, `getVal should not be called, called=${readRam(vm, addrCalled)}`);
    });

    await test(`global array with dynamic index in bank1`, async () => {
        let code = 'unsigned char g0 = 0; unsigned char g1 = 1; unsigned char g2 = 2; unsigned char g3 = 3; unsigned char g4 = 4; unsigned char g5 = 5; unsigned char g6 = 6; unsigned char g7 = 7; unsigned char g8 = 8; unsigned char g9 = 9; unsigned char g10 = 10; unsigned char g11 = 11; unsigned char g12 = 12; unsigned char g13 = 13; unsigned char g14 = 14; unsigned char g15 = 15; unsigned char g16 = 16; unsigned char g17 = 17; unsigned char g18 = 18; unsigned char g19 = 19; unsigned char g20 = 20; unsigned char g21 = 21; unsigned char g22 = 22; unsigned char g23 = 23; unsigned char g24 = 24; unsigned char g25 = 25; unsigned char g26 = 26; unsigned char g27 = 27; unsigned char g28 = 28; unsigned char g29 = 29; unsigned char g30 = 30; unsigned char g31 = 31; unsigned char g32 = 32; unsigned char g33 = 33; unsigned char g34 = 34; unsigned char g35 = 35; unsigned char g36 = 36; unsigned char g37 = 37; unsigned char g38 = 38; unsigned char g39 = 39; unsigned char g40 = 40; unsigned char g41 = 41; unsigned char g42 = 42; unsigned char g43 = 43; unsigned char g44 = 44; unsigned char g45 = 45; unsigned char g46 = 46; unsigned char g47 = 47; unsigned char g48 = 48; unsigned char g49 = 49; unsigned char g50 = 50; unsigned char g51 = 51; unsigned char g52 = 52; unsigned char g53 = 53; unsigned char g54 = 54; unsigned char g55 = 55; unsigned char g56 = 56; unsigned char g57 = 57; unsigned char g58 = 58; unsigned char g59 = 59; ';
        code += 'unsigned char arr[5] = {10, 20, 30, 40, 50}; void main() { unsigned char i = 2; unsigned char r = arr[i]; }';
        const { debugInfo, vm } = await compileAndRun(code);
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `arr[2]=30, got ${readRam(vm, addrR)}`);
    });

    await test(`local array initialization`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10, 20, 30, 40, 50}; unsigned char r = arr[2]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `local arr[2]=30, got ${readRam(vm, addrR)}`);
    });

    await test(`local array partial init`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10, 20}; unsigned char r = arr[0] + arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `arr[0]+arr[1]=30, got ${readRam(vm, addrR)}`);
    });

    await test(`array compound assign += const index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10, 20, 30, 40, 50}; arr[2] += 5; unsigned char r = arr[2]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 35, `arr[2]+=5 => 35, got ${readRam(vm, addrR)}`);
    });

    await test(`array compound assign -= const index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10, 20, 30, 40, 50}; arr[1] -= 5; unsigned char r = arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 15, `arr[1]-=5 => 15, got ${readRam(vm, addrR)}`);
    });

    await test(`array compound assign &= const index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10, 20, 30, 40, 50}; arr[0] &= 0x0F; unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === (10 & 0x0F), `arr[0]&=0x0F => ${10 & 0x0F}, got ${readRam(vm, addrR)}`);
    });

    await test(`array compound assign |= const index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10, 20, 30, 40, 50}; arr[0] |= 0x01; unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === (10 | 0x01), `arr[0]|=0x01 => ${10 | 0x01}, got ${readRam(vm, addrR)}`);
    });

    await test(`array compound assign += dynamic index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10, 20, 30, 40, 50}; unsigned char i = 2; arr[i] += 5; unsigned char r = arr[i]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 35, `arr[i]+=5 => 35, got ${readRam(vm, addrR)}`);
    });

    await test(`array compound assign *= const index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10, 20, 30, 40, 50}; arr[2] *= 3; unsigned char r = arr[2]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((30 * 3) & 0xFF), `arr[2]*=3 => ${(30 * 3) & 0xFF}, got ${readRam(vm, addrR)}`);
    });

    await test(`array compound assign /= const index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10, 20, 30, 40, 50}; arr[2] /= 7; unsigned char r = arr[2]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === Math.floor(30 / 7), `arr[2]/=7 => ${Math.floor(30 / 7)}, got ${readRam(vm, addrR)}`);
    });

    await test(`array assignment as value`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5]; unsigned char x; x = arr[2] = 5; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        const addrArr2 = getVarAddr(debugInfo, 'main', 'arr[2]');
        assert(readRam(vm, addrX) === 5, `x=5, got ${readRam(vm, addrX)}`);
        assert(readRam(vm, addrArr2) === 5, `arr[2]=5, got ${readRam(vm, addrArr2)}`);
    });

    await test(`array compound assign <<= const index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10,20,30,40,50}; arr[1] <<= 2; unsigned char r = arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((20 << 2) & 0xFF), `arr[1]<<=2 => ${(20 << 2) & 0xFF}, got ${readRam(vm, addrR)}`);
    });

    await test(`array compound assign >>= const index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10,20,30,40,50}; arr[2] >>= 1; unsigned char r = arr[2]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === (30 >> 1), `arr[2]>>=1 => ${30 >> 1}, got ${readRam(vm, addrR)}`);
    });

    await test(`array compound assign %= const index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5] = {10,20,30,40,50}; arr[2] %= 7; unsigned char r = arr[2]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === (30 % 7), `arr[2]%=7 => ${30 % 7}, got ${readRam(vm, addrR)}`);
    });

    await test(`switch with multiple case values (case 1: case 2:)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 2; unsigned char r = 0; void main() { switch(x) { case 1: case 2: r = 10; break; case 3: r = 20; break; default: r = 30; } }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 10, `switch(2) case 1:case 2: => 10, got ${readRam(vm, addrR)}`);
    });

    await test(`switch with multiple case values - first case`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 1; unsigned char r = 0; void main() { switch(x) { case 1: case 2: r = 10; break; case 3: r = 20; break; default: r = 30; } }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 10, `switch(1) case 1:case 2: => 10, got ${readRam(vm, addrR)}`);
    });

    await test(`parenthesized assignment (x) = val`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x; (x) = 42; unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 42, `(x)=42 => 42, got ${readRam(vm, addrR)}`);
    });

    await test(`array shift assign arr[i] >>= 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3] = {0,8,0}; arr[1] >>= 1; unsigned char r = arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 4, `arr[1]>>=1 => 4, got ${readRam(vm, addrR)}`);
    });

    await test(`array shift assign arr[i] <<= 2`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3] = {0,3,0}; arr[1] <<= 2; unsigned char r = arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 12, `arr[1]<<=2 => 12, got ${readRam(vm, addrR)}`);
    });

    await test(`array -= with expression index (arr[expr] -= val)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3] = {0,10,0}; unsigned char i = 1; arr[i] -= 3; unsigned char r = arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 7, `arr[i]-=3 => 7, got ${readRam(vm, addrR)}`);
    });

    await test(`array -= with expression rhs (arr[i] -= expr)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3] = {0,10,0}; unsigned char v = 4; arr[1] -= v; unsigned char r = arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 6, `arr[1]-=v => 6, got ${readRam(vm, addrR)}`);
    });

    await test(`subtraction with array element (arr[i] - val)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3] = {0,10,0}; unsigned char v = 3; unsigned char r = arr[1] - v; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 7, `arr[1]-v => 7, got ${readRam(vm, addrR)}`);
    });

    await test(`switch with continue in for loop`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char s = 0; unsigned char i; for (i = 0; i < 5; i++) { switch(i) { case 1: continue; default: s += i; } } }');
        const addrS = getVarAddr(debugInfo, 'main', 's');
        assert(readRam(vm, addrS) === 9, `0+2+3+4=9, got ${readRam(vm, addrS)}`);
    });

    await test(`switch with continue multiple cases`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char s = 0; unsigned char i; for (i = 0; i < 5; i++) { switch(i) { case 1: continue; case 3: continue; default: s += i; } } }');
        const addrS = getVarAddr(debugInfo, 'main', 's');
        assert(readRam(vm, addrS) === 6, `0+2+4=6, got ${readRam(vm, addrS)}`);
    });

    await test(`switch with continue and break mixed`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char s = 0; unsigned char i; for (i = 0; i < 5; i++) { switch(i) { case 1: continue; case 4: break; default: s += i; } } }');
        const addrS = getVarAddr(debugInfo, 'main', 's');
        assert(readRam(vm, addrS) === 5, `0+2+3=5, got ${readRam(vm, addrS)}`);
    });

    await test(`switch with continue in while loop`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char s = 0; unsigned char i = 0; while (i < 5) { switch(i) { case 2: i++; continue; default: s += i; i++; } } }');
        const addrS = getVarAddr(debugInfo, 'main', 's');
        assert(readRam(vm, addrS) === 8, `0+1+3+4=8, got ${readRam(vm, addrS)}`);
    });

    await test(`global for continue with uninit global`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char s; unsigned char i; void main() { for (i = 0; i < 5; i++) { if (i == 2) continue; s += i; } }');
        const addrS = getVarAddr(debugInfo, 'global', 's');
        assert(readRam(vm, addrS) === 8, `0+1+3+4=8, got ${readRam(vm, addrS)}`);
    });

    await test(`global for break result`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char r; unsigned char i; void main() { for (i = 0; i < 10; i++) { if (i == 5) break; } r = i; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 5, `break at i=5, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char comparison: -5 < 3`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -5; unsigned char r = (x < 3); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `-5 < 3 = 1, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char comparison: -5 < -3`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -5; signed char y = -3; unsigned char r = (x < y); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `-5 < -3 = 1, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char comparison: 3 > -5`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = 3; signed char y = -5; unsigned char r = (x > y); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `3 > -5 = 1, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char division: -10 / 3 = -3`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -10; unsigned char r = x / 3; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-10 / 3 | 0) & 0xFF), `-10/3 = ${((-10 / 3 | 0) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char modulo: -10 % 3 = -1`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -10; unsigned char r = x % 3; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-10 % 3) & 0xFF), `-10%3 = ${((-10 % 3) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char arithmetic right shift: -8 >> 1 = -4`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -8; x >>= 1; unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-8 >> 1) & 0xFF), `-8>>1 = ${((-8 >> 1) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char division: -7 / -3 = 2`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -7; signed char y = -3; unsigned char r = x / y; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-7 / -3 | 0) & 0xFF), `-7/-3 = ${((-7 / -3 | 0) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char modulo: -7 % -3 = -1`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -7; signed char y = -3; unsigned char r = x % y; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-7 % -3) & 0xFF), `-7%-3 = ${((-7 % -3) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char variable right shift: -32 >> 2 = -8`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -32; signed char y = 2; x >>= y; unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-32 >> 2) & 0xFF), `-32>>2 = ${((-32 >> 2) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char function returning negative used in shift`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char neg(signed char x) { return -x; } void main() { signed char x = neg(4); x >>= 1; unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-4 >> 1) & 0xFF), `neg(4)>>1 = ${((-4 >> 1) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char abs function`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char abs_s(signed char x) { return (x < 0) ? -x : x; } void main() { unsigned char r = abs_s(-7) + abs_s(3); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 10, `abs_s(-7)+abs_s(3)=10, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char loop with negative range`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char sum = 0; for (signed char i = -3; i <= 3; i++) sum += i; unsigned char r = sum; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0, `sum(-3..3)=0, got ${readRam(vm, addrR)}`);
    });

    await test(`signed array compound >>= with negative`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char arr[2]; arr[0] = -8; arr[0] >>= 1; unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-8 >> 1) & 0xFF), `arr[0]=-8>>1 = ${((-8 >> 1) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed array compound /= with negative`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char arr[2]; arr[0] = -10; arr[0] /= 3; unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-10 / 3 | 0) & 0xFF), `arr[0]=-10/3 = ${((-10 / 3 | 0) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed array compound %= with negative`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char arr[2]; arr[0] = -10; arr[0] %= 3; unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-10 % 3) & 0xFF), `arr[0]=-10%3 = ${((-10 % 3) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char boundary: -128 / 2 = -64`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -128; unsigned char r = x / 2; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-128 / 2 | 0) & 0xFF), `-128/2 = ${((-128 / 2 | 0) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char: -1 / 2 = 0 (truncation toward zero)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -1; unsigned char r = x / 2; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0, `-1/2 = 0, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char: -1 >> 1 = -1 (arithmetic shift)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -1; x >>= 1; unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0xFF, `-1>>1 = 0xFF, got 0x${readRam(vm, addrR).toString(16)}`);
    });

    await test(`signed char global var init`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char g = -5; void main() { unsigned char r = g; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-5) & 0xFF), `g=-5 => ${((-5) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char global var modify`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char g = -5; void main() { g += 3; unsigned char r = g; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-5 + 3) & 0xFF), `g=-5+3 => ${((-5 + 3) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char global var comparison`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char g = -5; void main() { unsigned char r = 0; if (g < 0) r = 1; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `g<0 => 1, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char as array index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5]; arr[0] = 10; arr[1] = 20; arr[2] = 30; signed char i = 1; unsigned char r = arr[i]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 20, `arr[1]=20, got ${readRam(vm, addrR)}`);
    });

    await test(`cast signed to unsigned`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -5; unsigned char r = (unsigned char)x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-5) & 0xFF), `(unsigned char)(-5) = ${((-5) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char in do-while`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -3; unsigned char count = 0; do { x++; count++; } while (x < 3); unsigned char r = count; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 6, `count from -3 to 2 = 6, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char nested loop`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char i, j; unsigned char sum = 0; for (i = -1; i <= 1; i++) for (j = -1; j <= 1; j++) sum++; unsigned char r = sum; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 9, `3*3=9, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char switch with negative case`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -2; unsigned char r = 0; switch (x) { case -1: r = 1; break; case -2: r = 2; break; default: r = 3; } }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 2, `switch(-2) case -2 => 2, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char function return negative`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char negate(signed char x) { return -x; } void main() { unsigned char r = negate(5); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-5) & 0xFF), `negate(5) = ${((-5) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char compound /= negative`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -15; x /= 4; unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-15 / 4 | 0) & 0xFF), `-15/4 = ${((-15 / 4 | 0) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char compound %= negative`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -15; x %= 4; unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-15 % 4) & 0xFF), `-15%4 = ${((-15 % 4) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char conditional assign (max)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -5; signed char y = 3; signed char max = (x > y) ? x : y; unsigned char r = max; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 3, `max(-5,3)=3, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char logical AND/OR`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -5; signed char y = 0; unsigned char r1 = (x || y) ? 1 : 0; unsigned char r2 = (x && y) ? 1 : 0; }');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        assert(readRam(vm, addrR1) === 1, `-5||0 = 1, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 0, `-5&&0 = 0, got ${readRam(vm, addrR2)}`);
    });

    await test(`signed char while decrement`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = 5; unsigned char count = 0; while (x > -3) { x--; count++; } unsigned char r = count; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 8, `5 to -3 = 8 steps, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char array with negative init`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char arr[3] = {-1, -2, -3}; unsigned char r = arr[0] + arr[2]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === (((-1) + (-3)) & 0xFF), `(-1)+(-3) = ${(((-1) + (-3)) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char global array`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char garr[3]; void main() { garr[0] = -1; garr[1] = -2; garr[2] = -3; unsigned char r = garr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-2) & 0xFF), `garr[1]=-2 => ${((-2) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char in if-else chain`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -5; unsigned char r; if (x > 0) r = 1; else if (x == -5) r = 2; else r = 3; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 2, `x==-5 => 2, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char comparison chain`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -5; unsigned char r = 0; if (x >= -10 && x <= -3) r = 1; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `-5 >= -10 && -5 <= -3 => 1, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char boundary -128 and 127`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -128; signed char y = 127; unsigned char r = 0; if (x < -127 && y > 126) r = 1; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `boundary check, got ${readRam(vm, addrR)}`);
    });

    await test(`signed array *= negative`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char arr[2]; arr[0] = 5; arr[0] *= -3; unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((5 * (-3)) & 0xFF), `5*(-3) = ${((5 * (-3)) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed arr >>= variable`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char arr[2]; arr[0] = -32; signed char y = 2; arr[0] >>= y; unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-32 >> 2) & 0xFF), `-32>>2 = ${((-32 >> 2) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed modulo: 7 % -3 = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = 7; signed char y = -3; unsigned char r = x % y; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((7 % (-3)) & 0xFF), `7%-3 = ${((7 % (-3)) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed modulo: -128 % 7`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -128; unsigned char r = x % 7; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-128 % 7) & 0xFF), `-128%7 = ${((-128 % 7) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed fn shift in return`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char shr_s(signed char a, unsigned char b) { return a >> b; } void main() { unsigned char r = shr_s(-32, 3); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-32 >> 3) & 0xFF), `shr_s(-32,3) = ${((-32 >> 3) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed global fn div`, async () => {
        const { debugInfo, vm } = await compileAndRun('signed char g = -10; signed char get_g() { return g; } void main() { unsigned char r = get_g() / 3; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-10 / 3 | 0) & 0xFF), `get_g()/3 = ${((-10 / 3 | 0) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed dynamic arr >>= variable`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char arr[3]; arr[0] = -32; unsigned char i = 0; signed char y = 2; arr[i] >>= y; unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-32 >> 2) & 0xFF), `arr[i]>>=y = ${((-32 >> 2) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed dynamic arr /= variable`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char arr[3]; arr[0] = -20; unsigned char i = 0; signed char y = 3; arr[i] /= y; unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-20 / 3 | 0) & 0xFF), `arr[i]/=y = ${((-20 / 3 | 0) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed dynamic arr %= variable`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char arr[3]; arr[0] = -20; unsigned char i = 0; signed char y = 3; arr[i] %= y; unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-20 % 3) & 0xFF), `arr[i]%=y = ${((-20 % 3) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`signed complex shift expression`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -10; signed char y = 2; unsigned char r = (x >> y) + (x << y); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === (((-10 >> 2) + ((-10) << 2)) & 0xFF), `(-10>>2)+(-10<<2) = ${(((-10 >> 2) + ((-10) << 2)) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`parenthesized signed shift`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -8; unsigned char r = ((x)) >> 1; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === ((-8 >> 1) & 0xFF), `((x))>>1 = ${((-8 >> 1) & 0xFF)}, got ${readRam(vm, addrR)}`);
    });

    await test(`pointer: & operator (address-of)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 42; unsigned char *ptr = &x; }');
        const addrPtr = getVarAddr(debugInfo, 'main', 'ptr');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrPtr) === addrX, `ptr should be address of x, got ${readRam(vm, addrPtr)} expected ${addrX}`);
    });

    await test(`pointer: * operator (dereference read)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 42; unsigned char *ptr = &x; unsigned char y = *ptr; }');
        const addrY = getVarAddr(debugInfo, 'main', 'y');
        assert(readRam(vm, addrY) === 42, `*ptr should be 42, got ${readRam(vm, addrY)}`);
    });

    await test(`pointer: * operator (dereference write)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x; unsigned char *ptr = &x; *ptr = 99; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 99, `*ptr=99, x should be 99, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: dereference write then read`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x; unsigned char *ptr = &x; *ptr = 77; unsigned char y = *ptr; }');
        const addrY = getVarAddr(debugInfo, 'main', 'y');
        assert(readRam(vm, addrY) === 77, `y should be 77, got ${readRam(vm, addrY)}`);
    });

    await test(`pointer: assign address then dereference in separate statements`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 10; unsigned char *ptr; ptr = &x; unsigned char y = *ptr; }');
        const addrY = getVarAddr(debugInfo, 'main', 'y');
        assert(readRam(vm, addrY) === 10, `y should be 10, got ${readRam(vm, addrY)}`);
    });

    await test(`pointer: address macro read`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define TMR0 (*(u8 *)0x01)\nvoid main() { unsigned char x = TMR0; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        const tmr0 = readRam(vm, 0x01);
        assert(readRam(vm, addrX) === tmr0, `x should equal TMR0=${tmr0}, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: address macro write`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define TMR0 (*(u8 *)0x01)\nvoid main() { TMR0 = 0x55; }');
        assert(readRam(vm, 0x01) === 0x55, `TMR0 should be 0x55, got 0x${readRam(vm, 0x01).toString(16)}`);
    });

    await test(`pointer: address macro compound assign`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define REG (*(u8 *)0x05)\nvoid main() { REG = 0x00; REG = REG | 0x10; }');
        assert(readRam(vm, 0x05) === 0x10, `REG should be 0x10, got 0x${readRam(vm, 0x05).toString(16)}`);
    });

    await test(`pointer: modify through pointer then read variable`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char *p = &a; *p = 50; unsigned char b = a; }');
        const addrB = getVarAddr(debugInfo, 'main', 'b');
        assert(readRam(vm, addrB) === 50, `b should be 50 (read a after *p=50), got ${readRam(vm, addrB)}`);
    });

    await test(`pointer: *p += constant (Bug 73)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char *p = &x; *p += 10; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 15, `*p += 10: x should be 15, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: *p -= constant`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 20; unsigned char *p = &x; *p -= 7; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 13, `*p -= 7: x should be 13, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: *p |= constant`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0x05; unsigned char *p = &x; *p |= 0x10; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 0x15, `*p |= 0x10: x should be 0x15, got 0x${readRam(vm, addrX).toString(16)}`);
    });

    await test(`pointer: *p &= constant`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0xFF; unsigned char *p = &x; *p &= 0x0F; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 0x0F, `*p &= 0x0F: x should be 0x0F, got 0x${readRam(vm, addrX).toString(16)}`);
    });

    await test(`pointer: *p ^= constant`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0xFF; unsigned char *p = &x; *p ^= 0x0F; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 0xF0, `*p ^= 0x0F: x should be 0xF0, got 0x${readRam(vm, addrX).toString(16)}`);
    });

    await test(`pointer: *p += variable`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char d = 3; unsigned char *p = &x; *p += d; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 8, `*p += d: x should be 8, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: &arr[variable] (Bug 72)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[4]; arr[0] = 10; arr[1] = 20; arr[2] = 30; arr[3] = 40; unsigned char i = 2; unsigned char *p = &arr[i]; unsigned char v = *p; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        assert(readRam(vm, addrV) === 30, `&arr[i]: v should be 30, got ${readRam(vm, addrV)}`);
    });

    await test(`pointer: *p = val as expression value (Bug 78)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x; unsigned char *p = &x; unsigned char y = (*p = 42); }');
        const addrY = getVarAddr(debugInfo, 'main', 'y');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 42, `*p=42: x should be 42, got ${readRam(vm, addrX)}`);
        assert(readRam(vm, addrY) === 42, `y = (*p=42): y should be 42, got ${readRam(vm, addrY)}`);
    });

    await test(`pointer: ++*p (prefix increment dereferenced)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char *p = &x; ++*p; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 6, `++*p: x should be 6, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: --*p (prefix decrement dereferenced)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char *p = &x; --*p; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 4, `--*p: x should be 4, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: *p++ (postfix increment pointer, read old value)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3]; arr[0] = 11; arr[1] = 22; arr[2] = 33; unsigned char *p = &arr[0]; unsigned char v = *p++; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        const addrP = getVarAddr(debugInfo, 'main', 'p');
        const addrArr0 = getVarAddr(debugInfo, 'main', 'arr');
        assert(readRam(vm, addrV) === 11, `*p++: v should be 11, got ${readRam(vm, addrV)}`);
        assert(readRam(vm, addrP) === (addrArr0 + 1), `*p++: p should be arr+1, got ${readRam(vm, addrP)}`);
    });

    await test(`pointer: *++p (prefix increment pointer, read new value)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3]; arr[0] = 11; arr[1] = 22; arr[2] = 33; unsigned char *p = &arr[0]; unsigned char v = *++p; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        const addrP = getVarAddr(debugInfo, 'main', 'p');
        const addrArr0 = getVarAddr(debugInfo, 'main', 'arr');
        assert(readRam(vm, addrV) === 22, `*++p: v should be 22, got ${readRam(vm, addrV)}`);
        assert(readRam(vm, addrP) === (addrArr0 + 1), `*++p: p should be arr+1, got ${readRam(vm, addrP)}`);
    });

    await test(`pointer: &arr[0] constant index`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[4]; arr[0] = 10; unsigned char *p = &arr[0]; unsigned char v = *p; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        assert(readRam(vm, addrV) === 10, `&arr[0]: v should be 10, got ${readRam(vm, addrV)}`);
    });

    await test(`pointer: (*p)++ dereference then increment (Bug 79)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char *p = &x; (*p)++; unsigned char v = x; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        assert(readRam(vm, addrV) === 6, `(*p)++: v should be 6, got ${readRam(vm, addrV)}`);
    });

    await test(`pointer: (*p)-- dereference then decrement (Bug 79)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char *p = &x; (*p)--; unsigned char v = x; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        assert(readRam(vm, addrV) === 4, `(*p)--: v should be 4, got ${readRam(vm, addrV)}`);
    });

    await test(`pointer: (*p)++ as value returns old value (Bug 79)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char *p = &x; unsigned char v = (*p)++; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        assert(readRam(vm, addrV) === 5, `(*p)++ value: v should be 5, got ${readRam(vm, addrV)}`);
    });

    await test(`pointer: ++(*p) as value returns new value (Bug 79)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char *p = &x; unsigned char v = ++(*p); }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        assert(readRam(vm, addrV) === 6, `++(*p) value: v should be 6, got ${readRam(vm, addrV)}`);
    });

    await test(`pointer: *a=*b FSR overwrite in swap (Bug 80)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void swap(unsigned char *a, unsigned char *b) { unsigned char t = *a; *a = *b; *b = t; } void main() { unsigned char x = 3; unsigned char y = 7; swap(&x, &y); }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        const addrY = getVarAddr(debugInfo, 'main', 'y');
        assert(readRam(vm, addrX) === 7, `swap: x should be 7, got ${readRam(vm, addrX)}`);
        assert(readRam(vm, addrY) === 3, `swap: y should be 3, got ${readRam(vm, addrY)}`);
    });

    await test(`pointer: *p *= constant`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char *p = &x; *p *= 3; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 15, `*p*=3: x should be 15, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: *p /= constant`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 10; unsigned char *p = &x; *p /= 2; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 5, `*p/=2: x should be 5, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: *p %= constant`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 10; unsigned char *p = &x; *p %= 3; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 1, `*p%=3: x should be 1, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: ptr - n subtraction`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[4]; arr[0]=10; arr[1]=20; arr[2]=30; unsigned char *p = &arr[2]; unsigned char *q = p - 2; unsigned char v = *q; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        assert(readRam(vm, addrV) === 10, `ptr-2: v should be 10, got ${readRam(vm, addrV)}`);
    });

    await test(`pointer: ptr - ptr difference`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[4]; unsigned char *p = &arr[0]; unsigned char *q = &arr[2]; unsigned char v = q - p; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        assert(readRam(vm, addrV) === 2, `q-p: v should be 2, got ${readRam(vm, addrV)}`);
    });

    await test(`pointer: p += n then dereference`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3]; arr[0]=10; arr[1]=20; arr[2]=30; unsigned char *p = &arr[0]; p += 2; unsigned char v = *p; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        assert(readRam(vm, addrV) === 30, `p+=2: v should be 30, got ${readRam(vm, addrV)}`);
    });

    await test(`pointer: p -= n then dereference`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3]; arr[0]=10; arr[1]=20; arr[2]=30; unsigned char *p = &arr[2]; p -= 1; unsigned char v = *p; }');
        const addrV = getVarAddr(debugInfo, 'main', 'v');
        assert(readRam(vm, addrV) === 20, `p-=1: v should be 20, got ${readRam(vm, addrV)}`);
    });

    await test(`pointer: *p <<= variable (Bug 81)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 3; unsigned char s = 2; unsigned char *p = &x; *p <<= s; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 12, `*p<<=s: x should be 12, got ${readRam(vm, addrX)}`);
    });

    await test(`pointer: *p >>= variable (Bug 81)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 12; unsigned char s = 2; unsigned char *p = &x; *p >>= s; }');
        const addrX = getVarAddr(debugInfo, 'main', 'x');
        assert(readRam(vm, addrX) === 3, `*p>>=s: x should be 3, got ${readRam(vm, addrX)}`);
    });

    await test(`error: function called with too many args (Bug 82)`, async () => {
        try {
            await compileAndRun('unsigned char add(unsigned char a, unsigned char b) { return a + b; } void main() { unsigned char r = add(1, 2, 3); }');
            assert(false, 'should have thrown error for too many arguments');
        } catch (e) {
            assert(e.message.includes('argument'), `expected argument count error, got: ${e.message}`);
        }
    });

    await test(`error: function called with too few args (Bug 82)`, async () => {
        try {
            await compileAndRun('unsigned char add(unsigned char a, unsigned char b) { return a + b; } void main() { add(1); }');
            assert(false, 'should have thrown error for too few arguments');
        } catch (e) {
            assert(e.message.includes('argument'), `expected argument count error, got: ${e.message}`);
        }
    });

    await test(`static variable persists across calls (Bug 83)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char counter() { static unsigned char n = 0; n++; return n; } void main() { unsigned char r1 = counter(); unsigned char r2 = counter(); unsigned char r3 = counter(); }');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        const addrR3 = getVarAddr(debugInfo, 'main', 'r3');
        assert(readRam(vm, addrR1) === 1, `1st call: n=1, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 2, `2nd call: n=2, got ${readRam(vm, addrR2)}`);
        assert(readRam(vm, addrR3) === 3, `3rd call: n=3, got ${readRam(vm, addrR3)}`);
    });

    await test(`static variable with non-zero init (Bug 83)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char counter() { static unsigned char n = 5; n++; return n; } void main() { unsigned char r1 = counter(); unsigned char r2 = counter(); }');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        assert(readRam(vm, addrR1) === 6, `1st call: n=6, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 7, `2nd call: n=7, got ${readRam(vm, addrR2)}`);
    });

    await test(`error: void function used as value (Bug 84)`, async () => {
        try {
            await compileAndRun('void noop() { } void main() { unsigned char r = noop(); }');
            assert(false, 'should have thrown error for void function used as value');
        } catch (e) {
            assert(e.message.includes('void'), `expected void error, got: ${e.message}`);
        }
    });

    await test(`error: duplicate function definition (Bug 85)`, async () => {
        try {
            await compileAndRun('unsigned char foo() { return 1; } unsigned char foo() { return 2; } void main() { }');
            assert(false, 'should have thrown error for duplicate function');
        } catch (e) {
            assert(e.message.includes('already defined'), `expected already defined error, got: ${e.message}`);
        }
    });

    await test(`error: duplicate global variable (Bug 86)`, async () => {
        try {
            await compileAndRun('unsigned char x = 5; unsigned char x = 10; void main() { }');
            assert(false, 'should have thrown error for duplicate variable');
        } catch (e) {
            assert(e.message.includes('already defined'), `expected already defined error, got: ${e.message}`);
        }
    });

    await test(`error: undeclared variable (Bug 87)`, async () => {
        try {
            await compileAndRun('void main() { unsigned char r = x; }');
            assert(false, 'should have thrown error for undeclared variable');
        } catch (e) {
            assert(e.message.includes('not defined'), `expected not defined error, got: ${e.message}`);
        }
    });

    await test(`error: undeclared function (Bug 87)`, async () => {
        try {
            await compileAndRun('void main() { unsigned char r = foo(); }');
            assert(false, 'should have thrown error for undeclared function');
        } catch (e) {
            assert(e.message.includes('not defined'), `expected not defined error, got: ${e.message}`);
        }
    });

    await test(`for loop with no condition and break`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char i = 0; unsigned char sum = 0; for (;;) { sum += i; i++; if (i > 4) break; } }');
        const addrSum = getVarAddr(debugInfo, 'main', 'sum');
        assert(readRam(vm, addrSum) === 10, `0+1+2+3+4=10, got ${readRam(vm, addrSum)}`);
    });

    await test(`chained assignment: a = b = c = 5`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a; unsigned char b; unsigned char c; void main() { a = b = c = 5; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        const addrC = getVarAddr(debugInfo, 'global', 'c');
        assert(readRam(vm, addrA) === 5, `a=5, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 5, `b=5, got ${readRam(vm, addrB)}`);
        assert(readRam(vm, addrC) === 5, `c=5, got ${readRam(vm, addrC)}`);
    });

    await test(`nested ternary`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 1; unsigned char b = 0; unsigned char r; void main() { r = a ? (b ? 1 : 2) : 3; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 2, `1?(0?1:2):3=2, got ${readRam(vm, addrR)}`);
    });

    await test(`overflow: 255 + 1 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 255; unsigned char r; void main() { r = a + 1; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 0, `255+1=0, got ${readRam(vm, addrR)}`);
    });

    await test(`underflow: 0 - 1 = 255`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 0; unsigned char r; void main() { r = a - 1; }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 255, `0-1=255, got ${readRam(vm, addrR)}`);
    });

    await test(`switch fall-through without break`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 1; unsigned char r; void main() { switch(x) { case 1: r = 10; case 2: r = 20; break; default: r = 30; } }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 20, `fall-through: r=20, got ${readRam(vm, addrR)}`);
    });

    await test(`do-while executes at least once`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char count = 0; do { count++; } while (0); }');
        const addrCount = getVarAddr(debugInfo, 'main', 'count');
        assert(readRam(vm, addrCount) === 1, `do-while(0): count=1, got ${readRam(vm, addrCount)}`);
    });

    await test(`logical OR short-circuit`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 0; unsigned char side() { x = 99; return 1; } unsigned char r; void main() { r = (1 || side()); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrR) === 1, `1||side()=1, got ${readRam(vm, addrR)}`);
        assert(readRam(vm, addrX) === 0, `side() not called: x=0, got ${readRam(vm, addrX)}`);
    });

    await test(`logical AND short-circuit`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 0; unsigned char side() { x = 99; return 1; } unsigned char r; void main() { r = (0 && side()); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrR) === 0, `0&&side()=0, got ${readRam(vm, addrR)}`);
        assert(readRam(vm, addrX) === 0, `side() not called: x=0, got ${readRam(vm, addrX)}`);
    });

    await test(`array bubble sort`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5]; arr[0] = 5; arr[1] = 3; arr[2] = 1; arr[3] = 4; arr[4] = 2; unsigned char i; unsigned char j; unsigned char tmp; for (i = 0; i < 4; i++) { for (j = 0; j < 4 - i; j++) { if (arr[j] > arr[j + 1]) { tmp = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = tmp; } } } unsigned char r0 = arr[0]; unsigned char r1 = arr[1]; unsigned char r2 = arr[2]; unsigned char r3 = arr[3]; unsigned char r4 = arr[4]; }');
        const addrR0 = getVarAddr(debugInfo, 'main', 'r0');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        const addrR3 = getVarAddr(debugInfo, 'main', 'r3');
        const addrR4 = getVarAddr(debugInfo, 'main', 'r4');
        assert(readRam(vm, addrR0) === 1, `arr[0]=1, got ${readRam(vm, addrR0)}`);
        assert(readRam(vm, addrR1) === 2, `arr[1]=2, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 3, `arr[2]=3, got ${readRam(vm, addrR2)}`);
        assert(readRam(vm, addrR3) === 4, `arr[3]=4, got ${readRam(vm, addrR3)}`);
        assert(readRam(vm, addrR4) === 5, `arr[4]=5, got ${readRam(vm, addrR4)}`);
    });

    await test(`XOR swap`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char a = 5; unsigned char b = 10; void main() { a ^= b; b ^= a; a ^= b; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        assert(readRam(vm, addrA) === 10, `a=10, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 5, `b=5, got ${readRam(vm, addrB)}`);
    });

    await test(`for loop with complex update: i += 2`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char sum = 0; for (unsigned char i = 0; i < 10; i += 2) { sum += i; } }');
        const addrSum = getVarAddr(debugInfo, 'main', 'sum');
        assert(readRam(vm, addrSum) === 20, `0+2+4+6+8=20, got ${readRam(vm, addrSum)}`);
    });

    await test(`signed char in for loop`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char i; unsigned char count = 0; for (i = -3; i <= 3; i++) { count++; } }');
        const addrCount = getVarAddr(debugInfo, 'main', 'count');
        assert(readRam(vm, addrCount) === 7, `-3..3: count=7, got ${readRam(vm, addrCount)}`);
    });

    await test(`bitwise NOT: ~x`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0x0F; unsigned char r = ~x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0xF0, `~0x0F=0xF0, got 0x${readRam(vm, addrR).toString(16)}`);
    });

    await test(`unary minus on unsigned: -x`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char r = -x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0xFB, `-5=0xFB, got 0x${readRam(vm, addrR).toString(16)}`);
    });

    await test(`signed char negation: -(-5) = 5`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -5; unsigned char r = -x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 5, `-(-5)=5, got ${readRam(vm, addrR)}`);
    });

    await test(`multiple OR: a || b || c`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 0; unsigned char b = 0; unsigned char c = 1; unsigned char r = (a || b || c); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `0||0||1=1, got ${readRam(vm, addrR)}`);
    });

    await test(`multiple AND: a && b && c`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 1; unsigned char b = 1; unsigned char c = 0; unsigned char r = (a && b && c); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0, `1&&1&&0=0, got ${readRam(vm, addrR)}`);
    });

    await test(`mixed && and ||: a && b || c`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 1; unsigned char b = 0; unsigned char c = 1; unsigned char r = (a && b || c); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `1&&0||1=1, got ${readRam(vm, addrR)}`);
    });

    await test(`comma operator: (a, b) returns b`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a = 5; unsigned char b = 10; unsigned char r = (a, b); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 10, `(5,10)=10, got ${readRam(vm, addrR)}`);
    });

    await test(`sizeof with array`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5]; unsigned char r = sizeof(arr); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 5, `sizeof(arr)=5, got ${readRam(vm, addrR)}`);
    });

    await test(`function with 3 parameters`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char max3(unsigned char a, unsigned char b, unsigned char c) { unsigned char m = a; if (b > m) m = b; if (c > m) m = c; return m; } void main() { unsigned char r = max3(3, 7, 5); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 7, `max3(3,7,5)=7, got ${readRam(vm, addrR)}`);
    });

    await test(`pointer arithmetic in function: *(p + i)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char get_at(unsigned char *p, unsigned char i) { return *(p + i); } void main() { unsigned char arr[3]; arr[0] = 10; arr[1] = 20; arr[2] = 30; unsigned char r = get_at(arr, 2); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `get_at(arr,2)=30, got ${readRam(vm, addrR)}`);
    });

    await test(`preprocessor #if with constant expression`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define VER 3\n#if VER == 3\nunsigned char r = 30;\n#else\nunsigned char r = 10;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 30, `VER==3: r=30, got ${readRam(vm, addrR)}`);
    });

    await test(`preprocessor #elif`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define VER 2\n#if VER == 1\nunsigned char r = 10;\n#elif VER == 2\nunsigned char r = 20;\n#else\nunsigned char r = 30;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 20, `VER==2: r=20, got ${readRam(vm, addrR)}`);
    });

    await test(`preprocessor #undef`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define X 10\nunsigned char a = X;\n#undef X\n#define X 20\nunsigned char b = X;\nvoid main() { }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        assert(readRam(vm, addrA) === 10, `a=10, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 20, `b=20, got ${readRam(vm, addrB)}`);
    });

    await test(`preprocessor #ifdef with #else (undefined)`, async () => {
        const { debugInfo, vm } = await compileAndRun('#ifdef UNDEFINED_MACRO\nunsigned char r = 10;\n#else\nunsigned char r = 20;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 20, `undefined: r=20, got ${readRam(vm, addrR)}`);
    });

    await test(`preprocessor #ifndef with #else (undefined)`, async () => {
        const { debugInfo, vm } = await compileAndRun('#ifndef UNDEFINED_MACRO\nunsigned char r = 10;\n#else\nunsigned char r = 20;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 10, `!defined: r=10, got ${readRam(vm, addrR)}`);
    });

    await test(`preprocessor function macro with complex argument`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define ADD(a,b) ((a)+(b))\nunsigned char r; void main() { r = ADD(3+1, 4+2); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 10, `ADD(3+1,4+2)=10, got ${readRam(vm, addrR)}`);
    });

    await test(`null pointer: p == 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char *p = 0; unsigned char r = (p == 0); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `p==0=1, got ${readRam(vm, addrR)}`);
    });

    await test(`pointer comparison: p != 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char *p = &x; unsigned char r = (p != 0); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `p!=0=1, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char: -1 < 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -1; unsigned char r = (x < 0); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `-1 < 0 = 1, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char: 0 > -1`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char x = -1; unsigned char r = (0 > x); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `0 > -1 = 1, got ${readRam(vm, addrR)}`);
    });

    await test(`signed char: (-3) * (-4) = 12`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { signed char a = -3; signed char b = -4; unsigned char r = a * b; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 12, `-3*-4=12, got ${readRam(vm, addrR)}`);
    });

    await test(`while with function call condition (global counter)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char n = 0; unsigned char get_next() { n++; return n; } void main() { unsigned char count = 0; while (get_next() < 5) { count++; } }');
        const addrCount = getVarAddr(debugInfo, 'main', 'count');
        assert(readRam(vm, addrCount) === 4, `count=4, got ${readRam(vm, addrCount)}`);
    });

    await test(`compound assign: x += a * b`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 10; unsigned char a = 3; unsigned char b = 5; void main() { x += a * b; }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 25, `10+15=25, got ${readRam(vm, addrX)}`);
    });

    await test(`compound assign: x -= a + b`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 20; unsigned char a = 3; unsigned char b = 5; void main() { x -= a + b; }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 12, `20-8=12, got ${readRam(vm, addrX)}`);
    });

    await test(`for loop with negative step: i -= 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char sum = 0; for (signed char i = 5; i >= 0; i -= 1) { sum += i; } }');
        const addrSum = getVarAddr(debugInfo, 'main', 'sum');
        assert(readRam(vm, addrSum) === 15, `5+4+3+2+1+0=15, got ${readRam(vm, addrSum)}`);
    });

    await test(`multiple assignments: a = b = c + 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char c = 5; unsigned char a; unsigned char b; void main() { a = b = c + 1; }');
        const addrA = getVarAddr(debugInfo, 'global', 'a');
        const addrB = getVarAddr(debugInfo, 'global', 'b');
        assert(readRam(vm, addrA) === 6, `a=6, got ${readRam(vm, addrA)}`);
        assert(readRam(vm, addrB) === 6, `b=6, got ${readRam(vm, addrB)}`);
    });

    await test(`array: arr[i] + arr[j]`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5]; arr[0] = 10; arr[1] = 20; arr[2] = 30; arr[3] = 40; arr[4] = 50; unsigned char i = 1; unsigned char j = 3; unsigned char r = arr[i] + arr[j]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 60, `20+40=60, got ${readRam(vm, addrR)}`);
    });

    await test(`compound assign: arr[i] += arr[j]`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[5]; arr[0] = 10; arr[1] = 20; arr[2] = 30; arr[3] = 40; arr[4] = 50; unsigned char i = 1; unsigned char j = 3; arr[i] += arr[j]; unsigned char r = arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 60, `20+40=60, got ${readRam(vm, addrR)}`);
    });

    await test(`switch with expression case value`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 3; unsigned char r; void main() { switch(x) { case 1: r = 10; break; case 2 + 1: r = 30; break; default: r = 50; } }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 30, `case 2+1: r=30, got ${readRam(vm, addrR)}`);
    });

    await test(`pointer: *(p + i) = *(q + j)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char src[3]; src[0] = 10; src[1] = 20; src[2] = 30; unsigned char dst[3]; dst[0] = 0; dst[1] = 0; dst[2] = 0; unsigned char *p = &dst[0]; unsigned char *q = &src[0]; unsigned char i = 1; *(p + i) = *(q + i); unsigned char r = dst[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 20, `dst[1]=20, got ${readRam(vm, addrR)}`);
    });

    await test(`multiple static variables in function (Bug 88)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char get_sum() { static unsigned char a = 10; static unsigned char b = 20; a++; b++; return a + b; } void main() { unsigned char r1 = get_sum(); unsigned char r2 = get_sum(); }');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        assert(readRam(vm, addrR1) === 32, `1st: 11+21=32, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 34, `2nd: 12+22=34, got ${readRam(vm, addrR2)}`);
    });

    await test(`preprocessor #if defined() with defined macro (Bug 90)`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define FEATURE 1\n#if defined(FEATURE)\nunsigned char r = 10;\n#else\nunsigned char r = 20;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 10, `defined: r=10, got ${readRam(vm, addrR)}`);
    });

    await test(`preprocessor #if defined() with undefined macro (Bug 90)`, async () => {
        const { debugInfo, vm } = await compileAndRun('#if defined(UNDEFINED_MACRO)\nunsigned char r = 10;\n#else\nunsigned char r = 20;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 20, `undefined: r=20, got ${readRam(vm, addrR)}`);
    });

    await test(`preprocessor #if defined without parens (Bug 90)`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define X\n#if defined X\nunsigned char r = 10;\n#else\nunsigned char r = 20;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 10, `defined X: r=10, got ${readRam(vm, addrR)}`);
    });

    await test(`swap via pointer parameter`, async () => {
        const { debugInfo, vm } = await compileAndRun('void swap(unsigned char *a, unsigned char *b) { unsigned char t = *a; *a = *b; *b = t; } void main() { unsigned char x = 3; unsigned char y = 7; swap(&x, &y); unsigned char r1 = x; unsigned char r2 = y; }');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        assert(readRam(vm, addrR1) === 7, `x=7, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 3, `y=3, got ${readRam(vm, addrR2)}`);
    });

    await test(`function returning pointer`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char *get_ptr(unsigned char *p) { return p; } void main() { unsigned char x = 42; unsigned char *p = get_ptr(&x); unsigned char r = *p; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 42, `*get_ptr(&x)=42, got ${readRam(vm, addrR)}`);
    });

    await test(`function with multiple return paths`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char classify(unsigned char x) { if (x > 10) return 2; if (x > 5) return 1; return 0; } void main() { unsigned char r1 = classify(3); unsigned char r2 = classify(7); unsigned char r3 = classify(15); }');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        const addrR3 = getVarAddr(debugInfo, 'main', 'r3');
        assert(readRam(vm, addrR1) === 0, `classify(3)=0, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 1, `classify(7)=1, got ${readRam(vm, addrR2)}`);
        assert(readRam(vm, addrR3) === 2, `classify(15)=2, got ${readRam(vm, addrR3)}`);
    });

    await test(`compound assign: x *= 2 + 3`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 4; void main() { x *= 2 + 3; }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 20, `4*(2+3)=20, got ${readRam(vm, addrX)}`);
    });

    await test(`compound assign: x <<= 1 + 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char x = 3; void main() { x <<= 1 + 1; }');
        const addrX = getVarAddr(debugInfo, 'global', 'x');
        assert(readRam(vm, addrX) === 12, `3<<(1+1)=12, got ${readRam(vm, addrX)}`);
    });

    await test(`set bit: x |= (1 << n)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0; unsigned char n = 3; x |= (1 << n); unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 8, `1<<3=8, got ${readRam(vm, addrR)}`);
    });

    await test(`clear bit: x &= ~(1 << n)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0xFF; unsigned char n = 3; x &= ~(1 << n); unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0xF7, `0xFF & ~8 = 0xF7, got 0x${readRam(vm, addrR).toString(16)}`);
    });

    await test(`toggle bit: x ^= (1 << n)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0; unsigned char n = 3; x ^= (1 << n); unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 8, `0^8=8, got ${readRam(vm, addrR)}`);
    });

    await test(`check bit: (x >> n) & 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0x0A; unsigned char n = 1; unsigned char r = (x >> n) & 1; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `(0x0A>>1)&1=1, got ${readRam(vm, addrR)}`);
    });

    await test(`iterate array with pointer`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[4]; arr[0] = 10; arr[1] = 20; arr[2] = 30; arr[3] = 40; unsigned char *p = &arr[0]; unsigned char sum = 0; for (unsigned char i = 0; i < 4; i++) { sum += *p; p = p + 1; } unsigned char r = sum; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 100, `10+20+30+40=100, got ${readRam(vm, addrR)}`);
    });

    await test(`global variable modified by multiple functions`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char g = 0; void inc() { g++; } void add(unsigned char n) { g += n; } void main() { inc(); inc(); add(5); unsigned char r = g; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 7, `1+1+5=7, got ${readRam(vm, addrR)}`);
    });

    await test(`deeply nested if-else`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char classify(unsigned char x) { if (x < 10) { if (x < 5) { if (x < 2) return 0; else return 1; } else return 2; } else { if (x < 20) return 3; else return 4; } } void main() { unsigned char r0 = classify(1); unsigned char r1 = classify(3); unsigned char r2 = classify(7); unsigned char r3 = classify(15); unsigned char r4 = classify(25); }');
        const addrR0 = getVarAddr(debugInfo, 'main', 'r0');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        const addrR3 = getVarAddr(debugInfo, 'main', 'r3');
        const addrR4 = getVarAddr(debugInfo, 'main', 'r4');
        assert(readRam(vm, addrR0) === 0, `classify(1)=0, got ${readRam(vm, addrR0)}`);
        assert(readRam(vm, addrR1) === 1, `classify(3)=1, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 2, `classify(7)=2, got ${readRam(vm, addrR2)}`);
        assert(readRam(vm, addrR3) === 3, `classify(15)=3, got ${readRam(vm, addrR3)}`);
        assert(readRam(vm, addrR4) === 4, `classify(25)=4, got ${readRam(vm, addrR4)}`);
    });

    await test(`preprocessor nested macro`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define A 5\n#define B A\nunsigned char r = B;\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 5, `B=A=5, got ${readRam(vm, addrR)}`);
    });

    await test(`preprocessor macro with parens`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define SQUARE(x) ((x)*(x))\nunsigned char r; void main() { r = SQUARE(3); }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 9, `SQUARE(3)=9, got ${readRam(vm, addrR)}`);
    });

    await test(`preprocessor #if with arithmetic`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define X 10\n#if X * 2 > 15\nunsigned char r = 1;\n#else\nunsigned char r = 0;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 1, `10*2>15: r=1, got ${readRam(vm, addrR)}`);
    });

    await test(`pass array element address to function`, async () => {
        const { debugInfo, vm } = await compileAndRun('void set_val(unsigned char *p, unsigned char v) { *p = v; } void main() { unsigned char arr[3]; arr[0] = 0; arr[1] = 0; arr[2] = 0; set_val(&arr[1], 42); unsigned char r = arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 42, `arr[1]=42, got ${readRam(vm, addrR)}`);
    });

    await test(`array as function parameter (pointer decay)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char sum(unsigned char *arr, unsigned char n) { unsigned char s = 0; for (unsigned char i = 0; i < n; i++) { s += *(arr + i); } return s; } void main() { unsigned char a[4]; a[0] = 1; a[1] = 2; a[2] = 3; a[3] = 4; unsigned char r = sum(a, 4); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 10, `1+2+3+4=10, got ${readRam(vm, addrR)}`);
    });

    await test(`double negation: !!5 = 1`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 5; unsigned char r = !!x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 1, `!!5=1, got ${readRam(vm, addrR)}`);
    });

    await test(`double negation: !!0 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0; unsigned char r = !!x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0, `!!0=0, got ${readRam(vm, addrR)}`);
    });

    await test(`2D-like array access (flat array)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char m[6]; m[0] = 1; m[1] = 2; m[2] = 3; m[3] = 4; m[4] = 5; m[5] = 6; unsigned char row = 1; unsigned char col = 2; unsigned char r = m[row * 3 + col]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 6, `m[1*3+2]=m[5]=6, got ${readRam(vm, addrR)}`);
    });

    await test(`cast: (unsigned char)(signed char)(-1) = 255`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char r = (unsigned char)(signed char)(-1); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 255, `(unsigned char)(-1)=255, got ${readRam(vm, addrR)}`);
    });

    await test(`error: return with value in void function`, async () => {
        try {
            await compileAndRun('void foo() { return 5; } void main() { }');
            assert(false, 'should have thrown error for return value in void function');
        } catch (e) {
            assert(e.message.includes('void') || e.message.includes('return'), `expected void/return error, got: ${e.message}`);
        }
    });

    await test(`error: struct type not supported (Bug 91)`, async () => {
        try {
            await compileAndRun('struct Point { unsigned char x; unsigned char y; }; void main() { struct Point p; p.x = 10; }');
            assert(false, 'should have thrown error for struct');
        } catch (e) {
            assert(e.message.includes('not supported'), `expected not supported error, got: ${e.message}`);
        }
    });

    await test(`error: float type not supported (Bug 92)`, async () => {
        try {
            await compileAndRun('void main() { float x = 3.14; }');
            assert(false, 'should have thrown error for float');
        } catch (e) {
            assert(e.message.includes('not supported') || e.message.includes('Floating'), `expected not supported error, got: ${e.message}`);
        }
    });

    await test(`error: double type not supported (Bug 92)`, async () => {
        try {
            await compileAndRun('void main() { double x = 3.14; }');
            assert(false, 'should have thrown error for double');
        } catch (e) {
            assert(e.message.includes('not supported') || e.message.includes('Floating'), `expected not supported error, got: ${e.message}`);
        }
    });

    await test(`error: union type not supported (Bug 91)`, async () => {
        try {
            await compileAndRun('union Data { unsigned char a; unsigned char b; }; void main() { union Data d; }');
            assert(false, 'should have thrown error for union');
        } catch (e) {
            assert(e.message.includes('not supported'), `expected not supported error, got: ${e.message}`);
        }
    });

    await test(`error: enum type not supported (Bug 91)`, async () => {
        try {
            await compileAndRun('enum Color { RED, GREEN, BLUE }; void main() { enum Color c; }');
            assert(false, 'should have thrown error for enum');
        } catch (e) {
            assert(e.message.includes('not supported'), `expected not supported error, got: ${e.message}`);
        }
    });

    await test(`do-while loop`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char i = 0; unsigned char sum = 0; do { sum += i; i++; } while (i < 5); unsigned char r = sum; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 10, `0+1+2+3+4=10, got ${readRam(vm, addrR)}`);
    });

    await test(`switch fall-through`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 2; unsigned char r; switch (x) { case 1: r = 10; break; case 2: case 3: r = 20; break; default: r = 30; } }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 20, `case 2 fall-through: r=20, got ${readRam(vm, addrR)}`);
    });

    await test(`chained assignment: a = b = 5`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char a; unsigned char b; a = b = 5; unsigned char r1 = a; unsigned char r2 = b; }');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        assert(readRam(vm, addrR1) === 5, `a=5, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 5, `b=5, got ${readRam(vm, addrR2)}`);
    });

    await test(`static variable used as counter across calls`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char next_id() { static unsigned char id = 0; return id++; } void main() { unsigned char r0 = next_id(); unsigned char r1 = next_id(); unsigned char r2 = next_id(); }');
        const addrR0 = getVarAddr(debugInfo, 'main', 'r0');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        assert(readRam(vm, addrR0) === 0, `1st: 0, got ${readRam(vm, addrR0)}`);
        assert(readRam(vm, addrR1) === 1, `2nd: 1, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 2, `3rd: 2, got ${readRam(vm, addrR2)}`);
    });

    await test(`static counter with parameter`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char accumulate(unsigned char val) { static unsigned char total = 0; total += val; return total; } void main() { unsigned char r1 = accumulate(10); unsigned char r2 = accumulate(20); unsigned char r3 = accumulate(5); }');
        const addrR1 = getVarAddr(debugInfo, 'main', 'r1');
        const addrR2 = getVarAddr(debugInfo, 'main', 'r2');
        const addrR3 = getVarAddr(debugInfo, 'main', 'r3');
        assert(readRam(vm, addrR1) === 10, `1st: 10, got ${readRam(vm, addrR1)}`);
        assert(readRam(vm, addrR2) === 30, `2nd: 30, got ${readRam(vm, addrR2)}`);
        assert(readRam(vm, addrR3) === 35, `3rd: 35, got ${readRam(vm, addrR3)}`);
    });

    await test(`function call result used in another call`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char double_val(unsigned char x) { return x * 2; } void main() { unsigned char r = double_val(double_val(3)); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 12, `double(double(3))=12, got ${readRam(vm, addrR)}`);
    });

    await test(`reverse array in place`, async () => {
        const { debugInfo, vm } = await compileAndRun('void reverse(unsigned char *arr, unsigned char n) { unsigned char i = 0; unsigned char j = n - 1; while (i < j) { unsigned char t = *(arr + i); *(arr + i) = *(arr + j); *(arr + j) = t; i++; j--; } } void main() { unsigned char arr[4]; arr[0] = 1; arr[1] = 2; arr[2] = 3; arr[3] = 4; reverse(arr, 4); unsigned char r = arr[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 4, `arr[0]=4 after reverse, got ${readRam(vm, addrR)}`);
    });

    await test(`find max in array`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char find_max(unsigned char *arr, unsigned char n) { unsigned char max = *arr; for (unsigned char i = 1; i < n; i++) { if (*(arr + i) > max) max = *(arr + i); } return max; } void main() { unsigned char arr[5]; arr[0] = 3; arr[1] = 7; arr[2] = 1; arr[3] = 9; arr[4] = 5; unsigned char r = find_max(arr, 5); }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 9, `max=9, got ${readRam(vm, addrR)}`);
    });

    await test(`unsigned char: 255 + 1 = 0`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 255; x = x + 1; unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 0, `255+1=0, got ${readRam(vm, addrR)}`);
    });

    await test(`unsigned char: 0 - 1 = 255`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 0; x = x - 1; unsigned char r = x; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 255, `0-1=255, got ${readRam(vm, addrR)}`);
    });

    await test(`nested #if`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define A 1\n#define B 1\n#if A\n#if B\nunsigned char r = 10;\n#else\nunsigned char r = 20;\n#endif\n#else\nunsigned char r = 30;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 10, `nested #if: r=10, got ${readRam(vm, addrR)}`);
    });

    await test(`#if with logical operators`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define A 1\n#define B 0\n#if A && !B\nunsigned char r = 1;\n#else\nunsigned char r = 0;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 1, `A&&!B: r=1, got ${readRam(vm, addrR)}`);
    });

    await test(`while(true) with break`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char i = 0; while (1) { i++; if (i >= 5) break; } unsigned char r = i; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 5, `i=5, got ${readRam(vm, addrR)}`);
    });

    await test(`for loop counting down`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char sum = 0; for (unsigned char i = 5; i > 0; i--) { sum += i; } unsigned char r = sum; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 15, `5+4+3+2+1=15, got ${readRam(vm, addrR)}`);
    });

    await test(`#elif chain with same variable name (Bug 93)`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define X 3\n#if X == 1\nunsigned char r = 1;\n#elif X == 2\nunsigned char r = 2;\n#elif X == 3\nunsigned char r = 3;\n#elif X == 4\nunsigned char r = 4;\n#else\nunsigned char r = 99;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 3, `X==3: r=3, got ${readRam(vm, addrR)}`);
    });

    await test(`#elif chain hits #else (Bug 93)`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define X 99\n#if X == 1\nunsigned char r = 1;\n#elif X == 2\nunsigned char r = 2;\n#elif X == 3\nunsigned char r = 3;\n#else\nunsigned char r = 99;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 99, `X==99: r=99, got ${readRam(vm, addrR)}`);
    });

    await test(`#elif chain first branch matches (Bug 93)`, async () => {
        const { debugInfo, vm } = await compileAndRun('#define X 1\n#if X == 1\nunsigned char r = 1;\n#elif X == 2\nunsigned char r = 2;\n#elif X == 3\nunsigned char r = 3;\n#else\nunsigned char r = 99;\n#endif\nvoid main() { }');
        const addrR = getVarAddr(debugInfo, 'global', 'r');
        assert(readRam(vm, addrR) === 1, `X==1: r=1, got ${readRam(vm, addrR)}`);
    });

    await test(`error: 2D array not supported (Bug 94)`, async () => {
        try {
            await compileAndRun('void main() { unsigned char m[2][3]; m[0][0] = 1; unsigned char r = m[0][0]; }');
            assert(false, 'should have thrown error for 2D array');
        } catch (e) {
            assert(e.message.includes('Multi-dimensional') || e.message.includes('not supported'), `expected not supported error, got: ${e.message}`);
        }
    });

    await test(`pointer subscript p[0] (Bug 95)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char x = 42; unsigned char *p = &x; unsigned char r = p[0]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 42, `p[0]=42, got ${readRam(vm, addrR)}`);
    });

    await test(`pointer subscript p[i] with constant index (Bug 95)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[4]; arr[0] = 10; arr[1] = 20; arr[2] = 30; arr[3] = 40; unsigned char *p = arr; unsigned char r = p[2]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `p[2]=30, got ${readRam(vm, addrR)}`);
    });

    await test(`pointer subscript p[i] with variable index (Bug 95)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[4]; arr[0] = 10; arr[1] = 20; arr[2] = 30; arr[3] = 40; unsigned char *p = arr; unsigned char i = 2; unsigned char r = p[i]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 30, `p[2]=30, got ${readRam(vm, addrR)}`);
    });

    await test(`pointer subscript write p[i] = value (Bug 95)`, async () => {
        const { debugInfo, vm } = await compileAndRun('void main() { unsigned char arr[3]; arr[0] = 0; arr[1] = 0; arr[2] = 0; unsigned char *p = arr; p[1] = 99; unsigned char r = arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 99, `arr[1]=99, got ${readRam(vm, addrR)}`);
    });

    await test(`global pointer to global variable (Bug 96)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char g = 10; unsigned char *gp = &g; void main() { *gp = 42; unsigned char r = g; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 42, `*gp=42: g=42, got ${readRam(vm, addrR)}`);
    });

    await test(`global pointer to global array (Bug 96)`, async () => {
        const { debugInfo, vm } = await compileAndRun('unsigned char arr[3]; unsigned char *gp = arr; void main() { gp[1] = 77; unsigned char r = arr[1]; }');
        const addrR = getVarAddr(debugInfo, 'main', 'r');
        assert(readRam(vm, addrR) === 77, `gp[1]=77: arr[1]=77, got ${readRam(vm, addrR)}`);
    });

    await test(`error: global 2D array not supported (Bug 94)`, async () => {
        try {
            await compileAndRun('unsigned char m[2][3]; void main() { m[0][0] = 1; }');
            assert(false, 'should have thrown error for global 2D array');
        } catch (e) {
            assert(e.message.includes('Multi-dimensional') || e.message.includes('not supported'), `expected not supported error, got: ${e.message}`);
        }
    });

    await test(`ISR with __interrupt syntax compiles correctly`, async () => {
        const source = `
unsigned char count;
void isr() __interrupt {
    count = count + 1;
}
void main() {
    count = 0;
}
`;
        const { rom, asm } = await compile(source);
        assert(rom, 'should compile');
        assert(asm.includes('__INTERRUPT:'), 'should have __INTERRUPT label');
        assert(asm.includes('LD ISR_ACC,A'), 'should save context');
        assert(asm.includes('LD ISR_PCLATH,A'), 'should save PCLATH');
        assert(asm.includes('V_COUNT'), 'should access count in ISR');
    });

    await test(`void interrupt() is a normal function (no __interrupt)`, async () => {
        const source = `
void interrupt() {
}
void main() {}
`;
        const { rom, asm } = await compile(source);
        assert(rom, 'should compile as normal function');
        assert(!asm.includes('LD ISR_ACC,A'), 'should NOT save ISR context');
        assert(!asm.includes('__INTERRUPT:'), 'should NOT have __INTERRUPT label');
    });

    await test(`ISR asm label is __INTERRUPT`, async () => {
        const source = `
void my_isr() __interrupt {
}
void main() {}
`;
        const { rom, asm } = await compile(source);
        assert(rom, 'should compile');
        assert(asm.includes('__INTERRUPT:'), 'should have __INTERRUPT label');
    });

    console.log('\n=== Test Summary ===');
    console.log(`  Passed: ${passCount}`);
    console.log(`  Failed: ${failCount}`);
    console.log(`  Total:  ${passCount + failCount}`);
    process.exit(failCount > 0 ? 1 : 0);
}

runTests();
