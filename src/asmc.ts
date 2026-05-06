/**
 * @license sc8p053vm
 * Copyright (c) 2026 391321232@qq.com
 * Licensed under BSL-1.1 (see LICENSE). Changes to MIT after 2099-12-31.
 */

export interface DebugInfo {
    lineNoMap: Map<number, number>;
}

// Instruction opcodes mapping
// Format reference: SC8P053 User Manual Chapter 13
// All opcodes use direct bitwise encoding (no generic op() function)
const OPCODES: { [key: string]: number } = {
    NOP: 0x0000,  // 0000000000000000
    RET: 0x0008,  // 0000000000001000
    RETI: 0x0009,  // 0000000000001001
    STOP: 0x0063,  // 0000000001100011
    CLRWDT: 0x0064,  // 0000000001100100
    LD_F_A: 0x0080,  // 000000001 ffff ffff  f=7-bit RAM address
    CLRA: 0x0100,  // 0000000100000000
    CLR: 0x0180,  // 000000011 ffff ffff  f=7-bit RAM address
    SUBA: 0x0200,  // 000000100 ffff ffff  f=7-bit RAM address
    SUBR: 0x0280,  // 000000101 ffff ffff  f=7-bit RAM address
    DECA: 0x0300,  // 000000110 ffff ffff  f=7-bit RAM address
    DECR: 0x0380,  // 000000111 ffff ffff  f=7-bit RAM address
    ORA: 0x0400,  // 000001000 ffff ffff  f=7-bit RAM address
    ORR: 0x0480,  // 000001001 ffff ffff  f=7-bit RAM address
    ANDA: 0x0500,  // 000001010 ffff ffff  f=7-bit RAM address
    ANDR: 0x0580,  // 000001011 ffff ffff  f=7-bit RAM address
    XORA: 0x0600,  // 000001100 ffff ffff  f=7-bit RAM address
    XORR: 0x0680,  // 000001101 ffff ffff  f=7-bit RAM address
    ADDA: 0x0700,  // 000001110 ffff ffff  f=7-bit RAM address
    ADDR: 0x0780,  // 000001111 ffff ffff  f=7-bit RAM address
    LD_A_F: 0x0800,  // 000010000 ffff ffff  f=7-bit RAM address
    TESTZ: 0x0880,  // 000010001 ffff ffff  f=7-bit RAM address
    COMA: 0x0900,  // 000010010 ffff ffff  f=7-bit RAM address
    COMR: 0x0980,  // 000010011 ffff ffff  f=7-bit RAM address
    INCA: 0x0A00,  // 000010100 ffff ffff  f=7-bit RAM address
    INCR: 0x0A80,  // 000010101 ffff ffff  f=7-bit RAM address
    SZDECA: 0x0B00,  // 000010110 ffff ffff  f=7-bit RAM address
    SZDECR: 0x0B80,  // 000010111 ffff ffff  f=7-bit RAM address
    RRCA: 0x0C00,  // 000011000 ffff ffff  f=7-bit RAM address
    RRCR: 0x0C80,  // 000011001 ffff ffff  f=7-bit RAM address
    RLCA: 0x0D00,  // 000011010 ffff ffff  f=7-bit RAM address
    RLCR: 0x0D80,  // 000011011 ffff ffff  f=7-bit RAM address
    SWAPA: 0x0E00,  // 000011100 ffff ffff  f=7-bit RAM address
    SWAPR: 0x0E80,  // 000011101 ffff ffff  f=7-bit RAM address
    SZINCA: 0x0F00,  // 000011110 ffff ffff  f=7-bit RAM address
    SZINCR: 0x0F80,  // 000011111 ffff ffff  f=7-bit RAM address
    CLRB: 0x1000,  // 000100 bb bfff ffff  b=3-bit position, f=7-bit RAM address
    SETB: 0x1400,  // 000101 bb bfff ffff  b=3-bit position, f=7-bit RAM address
    SZB: 0x1800,  // 000110 bb bfff ffff  b=3-bit position, f=7-bit RAM address
    SNZB: 0x1C00,  // 000111 bb bfff ffff  b=3-bit position, f=7-bit RAM address
    CALL: 0x2000,  // 001000 aa aaaa aaaa  a=10-bit ROM address
    JP: 0x2800,  // 001010 aa aaaa aaaa  a=10-bit ROM address
    LDIA: 0x3000,  // 00110000 iiii iiii  i=8-bit immediate
    SUBCA: 0x3100,  // 001100010 ffff ffff  f=7-bit RAM address
    SUBCR: 0x3180,  // 001100011 ffff ffff  f=7-bit RAM address
    HSUBCA: 0x3200,  // 001100100 ffff ffff  f=7-bit RAM address
    HSUBCR: 0x3280,  // 001100101 ffff ffff  f=7-bit RAM address
    HSUBA: 0x3300,  // 001100110 ffff ffff  f=7-bit RAM address
    HSUBR: 0x3380,  // 001100111 ffff ffff  f=7-bit RAM address
    RET_I: 0x3400,  // 00110100 iiii iiii  i=8-bit immediate
    RLA: 0x3500,  // 001101010 ffff ffff  f=7-bit RAM address
    RLR: 0x3580,  // 001101011 ffff ffff  f=7-bit RAM address
    RRA: 0x3600,  // 001101100 ffff ffff  f=7-bit RAM address
    RRR: 0x3680,  // 001101101 ffff ffff  f=7-bit RAM address
    ADDCA: 0x3700,  // 001101110 ffff ffff  f=7-bit RAM address
    ADDCR: 0x3780,  // 001101111 ffff ffff  f=7-bit RAM address
    ORIA: 0x3800,  // 00111000 iiii iiii  i=8-bit immediate
    ANDIA: 0x3900,  // 00111001 iiii iiii  i=8-bit immediate
    XORIA: 0x3A00,  // 00111010 iiii iiii  i=8-bit immediate
    SZA: 0x3B00,  // 001110110 ffff ffff  f=7-bit RAM address
    SZR: 0x3B80,  // 001110111 ffff ffff  f=7-bit RAM address
    SUBIA: 0x3C00,  // 00111100 iiii iiii  i=8-bit immediate
    HSUBIA: 0x3D00,  // 00111101 iiii iiii  i=8-bit immediate
    ADDIA: 0x3E00,  // 00111110 iiii iiii  i=8-bit immediate
    SET: 0x3F80  // 001111111 ffff ffff  f=7-bit RAM address
};

class SC8P053Assembler {
    private lines: Array<{ text: string; sourceLine: number; orgAddress?: number }> = [];
    private labels: Map<string, number> = new Map();
    private instructions: Array<{ line: number; sourceLine: number; opcode: string; args: string[] }> = [];
    private currentAddress: number = 0;

    // Debug info: instruction index -> source line number
    private debugInfo = {
        lineNoMap: new Map()
    };

    /**
     * Assemble ASM source code to ROM with debug information
     * @param source Assembly source code
     * @returns Object containing ROM and debug information
     */
    assemble(source: string): { rom: Uint16Array; debugInfo: DebugInfo } {
        this.reset();

        // Parse source code
        this.parseSource(source);

        // First pass: collect labels
        this.firstPass();

        // Second pass: generate machine code with debug info
        const rom = this.secondPass();

        return { rom: new Uint16Array(rom), debugInfo: this.debugInfo };
    }

    /**
     * Reset assembler state
     */
    private reset(): void {
        this.lines = [];
        this.labels.clear();
        this.instructions = [];
        this.currentAddress = 0;
        this.debugInfo = {
            lineNoMap: new Map()
        };
    }

    /**
     * Parse source code into lines, removing comments and whitespace
     */
    private parseSource(source: string): void {
        const rawLines = source.split('\n');

        for (let i = 0; i < rawLines.length; i++) {
            let line = rawLines[i];
            const sourceLineNum = i + 1; // 1-based line number

            // Remove comments (everything after ;)
            const commentIndex = line.indexOf(';');
            if (commentIndex !== -1) {
                line = line.substring(0, commentIndex);
            }

            // Trim whitespace
            line = line.trim();

            // Skip empty lines
            if (line.length === 0) {
                continue;
            }

            // Handle EQU directives (constant definitions)
            // Format: NAME EQU value
            const equMatch = line.match(/^(\w+)\s+EQU\s+(.+)$/i);
            if (equMatch) {
                const constName = equMatch[1].toUpperCase();
                const constValue = this.evaluateExpression(equMatch[2].trim());
                // Store as a label so it can be used later
                this.labels.set(constName, constValue);
                continue; // Don't add to instruction list
            }

            // Handle ORG directive (origin address)
            // Format: ORG address
            const orgMatch = line.match(/^ORG\s+(.+)$/i);
            if (orgMatch) {
                const orgAddress = this.evaluateExpression(orgMatch[1].trim());
                if (orgAddress < this.currentAddress) {
                    throw new Error(`ORG address 0x${orgAddress.toString(16)} is less than current address 0x${this.currentAddress.toString(16)}`);
                }
                // Store ORG info in lines array for firstPass to process
                this.lines.push({ text: line, sourceLine: sourceLineNum, orgAddress });
                this.currentAddress = orgAddress;
                continue;
            }

            this.lines.push({ text: line, sourceLine: sourceLineNum });
        }
    }

    /**
     * First pass: identify labels and calculate addresses
     */
    private firstPass(): void {
        this.currentAddress = 0;

        for (const lineObj of this.lines) {
            const line = lineObj.text;
            const sourceLine = lineObj.sourceLine;

            // Check if line is a label definition (ends with :)
            if (line.endsWith(':')) {
                const labelName = line.slice(0, -1).trim();
                if (labelName.length > 0) {
                    this.labels.set(labelName, this.currentAddress);
                }
                continue;
            }

            // Check if line is an ORG directive
            if (lineObj.orgAddress !== undefined) {
                this.currentAddress = lineObj.orgAddress;
                continue;
            }

            // Parse instruction - handle commas in arguments
            // Split by whitespace first
            const parts = line.split(/\s+/);
            const opcode = parts[0].toUpperCase();

            // Handle DB directive (Define Byte)
            if (opcode === 'DB') {
                const argsStr = parts.slice(1).join(' ').trim();
                const values = argsStr.split(',').map((v: string) => v.trim());
                for (const val of values) {
                    this.instructions.push({
                        line: this.currentAddress,
                        sourceLine: sourceLine,
                        opcode: 'DB',
                        args: [val]
                    });
                    this.currentAddress++;
                }
                continue;
            }

            // Handle DW directive (Define Word)
            if (opcode === 'DW') {
                const argsStr = parts.slice(1).join(' ').trim();
                const values = argsStr.split(',').map((v: string) => v.trim());
                for (const val of values) {
                    this.instructions.push({
                        line: this.currentAddress,
                        sourceLine: sourceLine,
                        opcode: 'DW',
                        args: [val]
                    });
                    this.currentAddress++;
                }
                continue;
            }

            // Skip END directive
            if (opcode === 'END') {
                continue;
            }

            // Join remaining parts and then split by comma
            const argsStr = parts.slice(1).join(' ').trim();
            const args = argsStr.split(',').map((arg: string) => arg.trim()).filter((arg: string) => arg.length > 0);

            this.instructions.push({
                line: this.currentAddress,
                sourceLine: sourceLine,
                opcode,
                args
            });

            this.currentAddress++;
        }
    }

    /**
     * Second pass: generate machine code
     */
    private secondPass(): number[] {
        let maxAddress = 0;
        for (const instr of this.instructions) {
            if (instr.line > maxAddress) {
                maxAddress = instr.line;
            }
        }

        const rom: number[] = new Array(maxAddress + 1).fill(0xFFFF);

        for (const instr of this.instructions) {
            const encoded = this.encodeInstruction(instr.opcode, instr.args);
            rom[instr.line] = encoded;

            this.debugInfo.lineNoMap.set(instr.line, instr.sourceLine);
        }

        return rom;
    }

    /**
     * Encode a single instruction
     */
    private encodeInstruction(opcode: string, args: string[]): number {
        // Handle DB directive (Define Byte) - store as 16-bit value with high byte = 0
        if (opcode === 'DB') {
            const byteValue = this.evaluateExpression(args[0]);
            if (byteValue < 0 || byteValue > 0xFF) {
                throw new Error(`DB value out of range (0-255): ${args[0]} = 0x${byteValue.toString(16)}`);
            }
            return byteValue; // Store byte in low 8 bits
        }

        // Handle DW directive (Define Word) - store full 16-bit value
        if (opcode === 'DW') {
            const wordValue = this.evaluateExpression(args[0]);
            if (wordValue < 0 || wordValue > 0xFFFF) {
                throw new Error(`DW value out of range (0-65535): ${args[0]} = 0x${wordValue.toString(16)}`);
            }
            return wordValue; // Store full 16-bit value
        }

        // LD instruction - special handling (not in OPCODES directly)
        if (opcode === 'LD') {
            if (args.length === 2) {
                const arg1 = args[0].toUpperCase();
                const arg2 = args[1].toUpperCase();
                if (arg1 === 'A') {
                    const addr = this.resolveOperand(args[1]);
                    if (addr < 0 || addr > 0xFF) {
                        throw new Error(`Address out of range (0-255) for LD: ${addr}`);
                    }
                    return OPCODES['LD_A_F'] | (addr & 0x7F);
                } else if (arg2 === 'A') {
                    const addr = this.resolveOperand(args[0]);
                    if (addr < 0 || addr > 0xFF) {
                        throw new Error(`Address out of range (0-255) for LD: ${addr}`);
                    }
                    return OPCODES['LD_F_A'] | (addr & 0x7F);
                } else {
                    throw new Error(`Invalid LD instruction format: LD ${args[0]},${args[1]}. Expected LD A,f or LD f,A`);
                }
            }
            throw new Error(`Invalid LD instruction: expected 2 arguments`);
        }

        // Get base opcode
        const baseOpcode = OPCODES[opcode];
        if (baseOpcode === undefined) {
            throw new Error(`Unknown instruction: ${opcode}`);
        }

        // No arguments - return base opcode as-is
        if (args.length === 0) {
            return baseOpcode;
        }

        // RET i - Return with immediate value (8-bit immediate in bits 7-0)
        if (opcode === 'RET' && args.length === 1) {
            const imm = this.resolveImmediate(args[0]);
            if (imm < 0 || imm > 0xFF) {
                throw new Error(`RET immediate value out of range (0-255): ${imm}`);
            }
            return OPCODES['RET_I'] | (imm & 0xFF);
        }

        // One argument instructions
        if (args.length === 1) {
            const operand = this.resolveOperand(args[0]);

            // Branch instructions: JP/CALL use 10-bit address (bits 9-0)
            if (opcode === 'JP' || opcode === 'CALL') {
                if (operand < 0 || operand > 0x03FF) {
                    throw new Error(`${opcode} address out of range (0-1023): ${operand}`);
                }
                return baseOpcode | (operand & 0x03FF);
            }

            // Immediate instructions: all use 8-bit immediate (bits 7-0)
            if (opcode === 'LDIA' || opcode === 'ANDIA' || opcode === 'ORIA' || opcode === 'XORIA' ||
                opcode === 'ADDIA' || opcode === 'SUBIA' || opcode === 'HSUBIA') {
                if (operand < 0 || operand > 0xFF) {
                    throw new Error(`${opcode} immediate value out of range (0-255): ${operand}`);
                }
                return baseOpcode | (operand & 0xFF);
            }

            // Data transfer and logic/arithmetic/shift/skip: 7-bit address (bits 6-0)
            // LD_A_F, LD_F_A, TESTZ, CLR_F, SET_F, ANDA_F, etc.
            // Bank1 addresses (0x80-0xFF) are masked to 7-bit (low 7 bits)
            if (operand < 0 || operand > 0xFF) {
                throw new Error(`Address out of range (0-255) for ${opcode}: ${operand}`);
            }
            return baseOpcode | (operand & 0x7F);
        }

        // Two arguments: bit manipulation instructions (CLRB, SETB, SZB, SNZB)
        if (args.length === 2) {
            // Bit manipulation instructions (CLRB, SETB, SZB, SNZB)
            // Format: bits 9-7 = bit position (3 bits), bits 6-0 = address (7 bits)
            const addr = this.resolveOperand(args[0]);
            const bit = this.resolveImmediate(args[1]);

            if (addr < 0 || addr > 0xFF) {
                throw new Error(`Address out of range (0-255) for ${opcode}: ${addr}`);
            }
            if (bit < 0 || bit > 7) {
                throw new Error(`Bit position out of range (0-7) for ${opcode}: ${bit}`);
            }

            return baseOpcode | (addr & 0x7F) | ((bit & 0x07) << 7);
        }

        throw new Error(`Invalid number of arguments for ${opcode}: ${args.length}`);
    }

    /**
     * Resolve operand (can be label, number, expression, or register name)
     */
    private resolveOperand(operand: string): number {
        // Remove brackets if present (e.g., [f] -> f)
        let cleanOperand = operand.replace(/[\[\]]/g, '').trim();

        // Handle expressions in parentheses like (CLKDIV_16 | PWM0EN)
        if (cleanOperand.startsWith('(') && cleanOperand.endsWith(')')) {
            return this.evaluateExpression(cleanOperand.slice(1, -1));
        }

        // Check if it's a hexadecimal number (0x prefix or suffix h/H)
        if (cleanOperand.startsWith('0x') || cleanOperand.startsWith('0X')) {
            return parseInt(cleanOperand, 16);
        }
        // Only treat as hex with 'h' suffix if it looks like a hex number
        if (cleanOperand.toLowerCase().endsWith('h') && /^[0-9A-Fa-f]+h$/i.test(cleanOperand)) {
            return parseInt(cleanOperand.slice(0, -1), 16);
        }

        // Check if it's a binary number (0b prefix)
        if (cleanOperand.startsWith('0b') || cleanOperand.startsWith('0B')) {
            return parseInt(cleanOperand.slice(2), 2);
        }

        // Check if it's a decimal number
        if (/^\d+$/.test(cleanOperand)) {
            return parseInt(cleanOperand, 10);
        }

        // Check if it's a label (try uppercase first)
        const upperName = cleanOperand.toUpperCase();
        if (this.labels.has(upperName)) {
            const value = this.labels.get(upperName)!;
            return value;
        }

        throw new Error(`Cannot resolve operand: ${operand}`);
    }

    /**
     * Resolve immediate value
     */
    private resolveImmediate(operand: string): number {
        return this.resolveOperand(operand);
    }

    /**
     * Evaluate simple arithmetic/bitwise expressions
     * Supports: +, -, |, &, ^, *, /
     */
    private evaluateExpression(expr: string): number {
        // Remove whitespace
        expr = expr.replace(/\s+/g, '');

        // Split by operators while keeping them
        const tokens = expr.split(/([+\-|&^*/])/).filter(t => t.length > 0);

        if (tokens.length === 1) {
            // Single value
            return this.resolveOperand(tokens[0]);
        }

        // Evaluate left to right (simple evaluation, no precedence)
        let result = this.resolveOperand(tokens[0]);

        for (let i = 1; i < tokens.length; i += 2) {
            const operator = tokens[i];
            const operand = this.resolveOperand(tokens[i + 1]);

            switch (operator) {
                case '+': result = (result + operand) & 0xFF; break;
                case '-': result = (result - operand) & 0xFF; break;
                case '|': result = result | operand; break;
                case '&': result = result & operand; break;
                case '^': result = result ^ operand; break;
                case '*': result = (result * operand) & 0xFF; break;
                case '/': result = Math.floor(result / operand); break;
                default:
                    throw new Error(`Unsupported operator: ${operator}`);
            }
        }

        return result & 0xFFFF; // Ensure 16-bit result
    }

}

/**
 * Parse Intel HEX file and convert to ROM (Uint16Array)
 * @param hexContent Intel HEX formatted string
 * @returns ROM as Uint16Array
 */
export function parseIntelHex(hexContent: string): Uint16Array {
    const lines = hexContent.split('\n').filter(line => line.trim().length > 0);
    const dataBytes: number[] = [];

    for (const line of lines) {
        // Skip lines that don't start with ':'
        if (!line.startsWith(':')) continue;

        // Parse the HEX record
        // Format: :LLAAAATTDD...CC
        const byteCount = parseInt(line.substr(1, 2), 16);
        const recordType = parseInt(line.substr(7, 2), 16);

        // Only process data records (type 00)
        if (recordType === 0x00) {
            for (let i = 0; i < byteCount; i++) {
                const byteStr = line.substr(9 + i * 2, 2);
                dataBytes.push(parseInt(byteStr, 16));
            }
        }

        // End of file record (type 01)
        if (recordType === 0x01) {
            break;
        }
    }

    // Convert bytes to 16-bit words (little-endian)
    const romSize = Math.floor(dataBytes.length / 2);
    const rom = new Uint16Array(romSize);

    for (let i = 0; i < romSize; i++) {
        const lowByte = dataBytes[i * 2];
        const highByte = dataBytes[i * 2 + 1];
        rom[i] = lowByte | (highByte << 8);
    }

    return rom;
}

/**
 * Convert ROM data to Intel HEX format
 * @param rom ROM data as Uint16Array
 * @param startAddress Starting address (default 0)
 * @returns Intel HEX formatted string
 */
function romToIntelHex(rom: Uint16Array, startAddress: number = 0): string {
    const lines: string[] = [];
    const bytesPerLine = 16; // 16 bytes per line (8 words)

    // Convert Uint16Array to byte array (little-endian)
    const byteArray: number[] = [];
    for (let i = 0; i < rom.length; i++) {
        const word = rom[i];
        byteArray.push(word & 0xFF);        // Low byte
        byteArray.push((word >> 8) & 0xFF); // High byte
    }

    let address = startAddress;
    let offset = 0;

    while (offset < byteArray.length) {
        const remaining = byteArray.length - offset;
        const count = Math.min(bytesPerLine, remaining);

        // Build data record
        // Format: :LLAAAATTDD...CC
        // LL = byte count, AAAA = address, TT = record type (00 = data), DD = data, CC = checksum
        const recordType = 0x00; // Data record

        let line = ':';
        let checksum = 0;

        // Byte count
        checksum += count;
        line += count.toString(16).padStart(2, '0').toUpperCase();

        // Address (16-bit)
        const addrLow = address & 0xFF;
        const addrHigh = (address >> 8) & 0xFF;
        checksum += addrLow + addrHigh;
        line += addrHigh.toString(16).padStart(2, '0').toUpperCase();
        line += addrLow.toString(16).padStart(2, '0').toUpperCase();

        // Record type
        checksum += recordType;
        line += recordType.toString(16).padStart(2, '0').toUpperCase();

        // Data bytes
        for (let i = 0; i < count; i++) {
            const byte = byteArray[offset + i];
            checksum += byte;
            line += byte.toString(16).padStart(2, '0').toUpperCase();
        }

        // Checksum (two's complement of sum)
        checksum = (~checksum + 1) & 0xFF;
        line += checksum.toString(16).padStart(2, '0').toUpperCase();

        lines.push(line);

        offset += count;
        address += count;
    }

    // Add end-of-file record
    lines.push(':00000001FF');

    return lines.join('\n') + '\n';
}

/**
 * Convenience function to assemble ASM source
 * @param source Assembly source code
 * @returns ROM as Uint16Array
 */
export function assemble(source: string): {
    rom: Uint16Array;
    debugInfo: DebugInfo;
} {
    return new SC8P053Assembler().assemble(source);
}

/**
 * Assemble ASM source and convert to Intel HEX format
 * @param source Assembly source code
 * @param startAddress Starting address for HEX file (default 0)
 * @returns Intel HEX formatted string
 */
export function assembleToHex(source: string, startAddress: number = 0): string {
    const { rom } = assemble(source);
    return romToIntelHex(rom, startAddress);
}
