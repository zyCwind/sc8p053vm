import { describe, it, expect } from '@jest/globals';
import { compile, DebugInfo } from '../cc';
import { VM } from '../vm';

// 辅助函数定义
interface CompileAndRunResult {
    vm: VM;
    debugInfo: DebugInfo;
}

async function compileAndRun(
    source: string,
    maxCycles = 200000,
): Promise<CompileAndRunResult | null> {
    const { debugInfo, rom } = await compile(source);
    if (!rom) return null;

    const vm = new VM(rom, { wdt: false, lvrSel: 0x03, fcpuDiv: 4 });
    vm.run(maxCycles);

    return { vm, debugInfo };
}

function readRam(vm: VM, addr: number): number {
    return vm.getState().ram[addr];
}

function getVarAddr(debugInfo: DebugInfo, scope: string, varName: string): number {
    let name = varName;
    let idx = 0;

    const match = varName.match(/([^\[]+)\[(\d+)\]/);
    if (match) {
        name = match[1];
        idx = parseInt(match[2], 10);
    }

    const varMap = debugInfo.varMap.get(scope);
    if (!varMap) {
        throw new Error(`Variable scope '${scope}' not found`);
    }

    const variable = varMap.find((v) => v.name === name);
    if (!variable) {
        throw new Error(`Variable '${name}' not found in scope '${scope}'`);
    }

    return variable.ramAddr + idx;
}

// 测试用例开始
describe('Compiler: Bitwise Operations', () => {
    describe('Left Shift (<<)', () => {
        it('should shift left by 1: 0x03 << 1 = 0x06', async () => {
            const result = await compileAndRun(
                'unsigned char x = 3; unsigned char y; void main() { y = x << 1; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(0x06);
        });

        it('should shift left by 1 without circular: 0x80 << 1 = 0x00', async () => {
            const result = await compileAndRun(
                'unsigned char x = 128; unsigned char y; void main() { y = x << 1; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(0x00);
        });

        it('should shift left by 2: 0x03 << 2 = 0x0C', async () => {
            const result = await compileAndRun(
                'unsigned char x = 3; unsigned char y; void main() { y = x << 2; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(0x0c);
        });

        it('should shift left by 3: 0x01 << 3 = 0x08', async () => {
            const result = await compileAndRun(
                'unsigned char x = 1; unsigned char y; void main() { y = x << 3; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(0x08);
        });
    });

    describe('Right Shift (>>)', () => {
        it('should shift right by 1: 0x06 >> 1 = 0x03', async () => {
            const result = await compileAndRun(
                'unsigned char x = 6; unsigned char y; void main() { y = x >> 1; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(0x03);
        });

        it('should shift right by 1 without circular: 0x81 >> 1 = 0x40', async () => {
            const result = await compileAndRun(
                'unsigned char x = 129; unsigned char y; void main() { y = x >> 1; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(0x40);
        });

        it('should shift right by 2: 0x0C >> 2 = 0x03', async () => {
            const result = await compileAndRun(
                'unsigned char x = 12; unsigned char y; void main() { y = x >> 2; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(0x03);
        });
    });

    describe('Bitwise AND (&)', () => {
        it('should perform bitwise AND: 0xFF & 0x0F = 0x0F', async () => {
            const result = await compileAndRun(
                'unsigned char a = 255; unsigned char b = 15; unsigned char c; void main() { c = a & b; }',
            );

            expect(result).not.toBeNull();
            const addrC = getVarAddr(result!.debugInfo, 'global', 'c');
            expect(readRam(result!.vm, addrC)).toBe(0x0f);
        });
    });

    describe('Bitwise OR (|)', () => {
        it('should perform bitwise OR: 0xF0 | 0x0F = 0xFF', async () => {
            const result = await compileAndRun(
                'unsigned char a = 240; unsigned char b = 15; unsigned char c; void main() { c = a | b; }',
            );

            expect(result).not.toBeNull();
            const addrC = getVarAddr(result!.debugInfo, 'global', 'c');
            expect(readRam(result!.vm, addrC)).toBe(0xff);
        });
    });

    describe('Bitwise XOR (^)', () => {
        it('should perform bitwise XOR: 0xFF ^ 0x0F = 0xF0', async () => {
            const result = await compileAndRun(
                'unsigned char a = 255; unsigned char b = 15; unsigned char c; void main() { c = a ^ b; }',
            );

            expect(result).not.toBeNull();
            const addrC = getVarAddr(result!.debugInfo, 'global', 'c');
            expect(readRam(result!.vm, addrC)).toBe(0xf0);
        });
    });
});

describe('Compiler: Arithmetic Operations', () => {
    describe('Multiplication (*)', () => {
        it('should multiply: 5 * 2 = 10', async () => {
            const result = await compileAndRun(
                'unsigned char x = 5; unsigned char y; void main() { y = x * 2; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(10);
        });

        it('should handle overflow: 128 * 2 = 0', async () => {
            const result = await compileAndRun(
                'unsigned char x = 128; unsigned char y; void main() { y = x * 2; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(0);
        });
    });

    describe('Division (/)', () => {
        it('should divide: 10 / 2 = 5', async () => {
            const result = await compileAndRun(
                'unsigned char x = 10; unsigned char y; void main() { y = x / 2; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(5);
        });

        it('should perform integer division: 11 / 2 = 5', async () => {
            const result = await compileAndRun(
                'unsigned char x = 11; unsigned char y; void main() { y = x / 2; }',
            );

            expect(result).not.toBeNull();
            const addrY = getVarAddr(result!.debugInfo, 'global', 'y');
            expect(readRam(result!.vm, addrY)).toBe(5);
        });
    });

    describe('Addition (+)', () => {
        it('should add: 10 + 20 = 30', async () => {
            const result = await compileAndRun(
                'unsigned char a = 10; unsigned char b = 20; unsigned char c; void main() { c = a + b; }',
            );

            expect(result).not.toBeNull();
            const addrC = getVarAddr(result!.debugInfo, 'global', 'c');
            expect(readRam(result!.vm, addrC)).toBe(30);
        });

        it('should compound add: 10 += 20 = 30', async () => {
            const result = await compileAndRun(
                'unsigned char a = 10; unsigned char b = 20; void main() { a += b; }',
            );

            expect(result).not.toBeNull();
            const addrA = getVarAddr(result!.debugInfo, 'global', 'a');
            expect(readRam(result!.vm, addrA)).toBe(30);
        });
    });

    describe('Subtraction (-)', () => {
        it('should subtract: 10 - 3 = 7', async () => {
            const result = await compileAndRun(
                'unsigned char a = 10; unsigned char b = 3; unsigned char c; void main() { c = a - b; }',
            );

            expect(result).not.toBeNull();
            const addrC = getVarAddr(result!.debugInfo, 'global', 'c');
            expect(readRam(result!.vm, addrC)).toBe(7);
        });

        it('should compound subtract: 10 -= 3 = 7', async () => {
            const result = await compileAndRun(
                'unsigned char a = 10; unsigned char b = 3; void main() { a -= b; }',
            );

            expect(result).not.toBeNull();
            const addrA = getVarAddr(result!.debugInfo, 'global', 'a');
            expect(readRam(result!.vm, addrA)).toBe(7);
        });
    });

    describe('Negation (-)', () => {
        it('should negate: -(1) = 0xFF (two complement)', async () => {
            const result = await compileAndRun(
                'signed char a; signed char b = 1; void main() { a = -b; }',
            );

            expect(result).not.toBeNull();
            const addrA = getVarAddr(result!.debugInfo, 'global', 'a');
            expect(readRam(result!.vm, addrA)).toBe(0xff);
        });

        it('should negate zero: -(0) = 0', async () => {
            const result = await compileAndRun(
                'signed char a; signed char b = 0; void main() { a = -b; }',
            );

            expect(result).not.toBeNull();
            const addrA = getVarAddr(result!.debugInfo, 'global', 'a');
            expect(readRam(result!.vm, addrA)).toBe(0);
        });
    });
});

describe('Compiler: Variable Initialization', () => {
    it('should initialize unsigned char to 42', async () => {
        const result = await compileAndRun('unsigned char x = 42; void main() { }');

        expect(result).not.toBeNull();
        const addrX = getVarAddr(result!.debugInfo, 'global', 'x');
        expect(readRam(result!.vm, addrX)).toBe(42);
    });

    it('should initialize unsigned char to 255', async () => {
        const result = await compileAndRun('unsigned char x = 255; void main() { }');

        expect(result).not.toBeNull();
        const addrX = getVarAddr(result!.debugInfo, 'global', 'x');
        expect(readRam(result!.vm, addrX)).toBe(255);
    });
});

describe('Compiler: Comparison Operations', () => {
    it('should compare: 5 < 10 is true (1)', async () => {
        const result = await compileAndRun(
            'unsigned char a = 5; unsigned char b = 10; unsigned char c; void main() { c = (a < b); }',
        );

        expect(result).not.toBeNull();
        const addrC = getVarAddr(result!.debugInfo, 'global', 'c');
        expect(readRam(result!.vm, addrC)).toBe(1);
    });
});

describe('Compiler: Control Flow', () => {
    describe('Switch Statement', () => {
        it('should match case 2', async () => {
            const result = await compileAndRun(
                'unsigned char x = 2; unsigned char c; void main() { switch(x) { case 1: c = 10; break; case 2: c = 20; break; default: c = 30; } }',
            );

            expect(result).not.toBeNull();
            const addrC = getVarAddr(result!.debugInfo, 'global', 'c');
            expect(readRam(result!.vm, addrC)).toBe(20);
        });

        it('should match case 1', async () => {
            const result = await compileAndRun(
                'unsigned char x = 1; unsigned char c; void main() { switch(x) { case 1: c = 10; break; case 2: c = 20; break; default: c = 30; } }',
            );

            expect(result).not.toBeNull();
            const addrC = getVarAddr(result!.debugInfo, 'global', 'c');
            expect(readRam(result!.vm, addrC)).toBe(10);
        });
    });
});
