/**
 * @license sc8p053vm
 * Copyright (c) 2026 391321232@qq.com
 * Licensed under BSL-1.1 (see LICENSE). Changes to MIT after 2099-12-31.
 */

import Parser from 'web-tree-sitter';
import { assemble } from './asmc';

const language = Parser.init().then(() => {
    if (typeof process == "object" && typeof process.versions == "object" && typeof process.versions.node == "string") {
        return Parser.Language.load(__dirname + '/../node_modules/tree-sitter-c/tree-sitter-c.wasm');
    } else {
        return Parser.Language.load('tree-sitter-c.wasm');
    }
});

const RAM_GP_START = 0x20;
const RAM_GP_END = 0x6F;
const RAM_SHARED_START = 0x70;
const RAM_SHARED_END = 0x7F;
const RAM_BANK1_START = 0xA0;
const RAM_BANK1_END = 0xEF;
const ISR_SAVE_SIZE = 4;

type Type = 'void' | 'u8' | 'i8' | 'bool';

export interface Sym {
    name: string;
    asmName: string;
    type: Type;
    ramAddr: number;
    bank: number;
    isArray: boolean;
    arraySize: number;
    isParam: boolean;
    paramIndex: number;
    frameOffset: number;
    isStatic: boolean;
}

export interface FnRange {
    start: number;
    end: number;
}

export interface DebugInfo {
    lineNoMap: Map<number, number>;
    fnRanges: Map<string, FnRange[]>;
    varMap: Map<string, Sym[]>;
}

function toAsmName(name: string): string {
    return 'V_' + name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function trimStart(s: string): string {
    return s.replace(/^[\s]+/, '');
}

interface Fn {
    name: string;
    asmName: string;
    returnType: Type;
    params: { name: string; asmName: string; type: Type }[];
    localSymbols: Map<string, Sym>;
    labelCounter: number;
    breakLabel?: string;
    continueLabel?: string;
    isISR?: boolean;
    tempCount: number;
    savedTempCount: number;
    calls: Set<string>;
    hasEarlyReturn: boolean;
    frameSize: number;
    frameBase: number;
}

type TokenType =
    | 'identifier'
    | 'number'
    | 'string'
    | 'char'
    | 'punctuation'
    | 'whitespace'
    | 'newline'
    | 'other';

interface Token {
    type: TokenType;
    value: string;
    lineNo: number;
    noExpand?: Set<string>;
}

interface ObjectMacro {
    kind: 'object';
    name: string;
    body: Token[];
}

interface FunctionMacro {
    kind: 'function';
    name: string;
    params: string[];
    isVariadic: boolean;
    body: Token[];
}

type Macro = ObjectMacro | FunctionMacro;

interface CondFrame {
    active: boolean;
    elseSeen: boolean;
    parentActive: boolean;
    branchTaken: boolean;
}

class Preprocessor {
    private macros: Map<string, Macro> = new Map();
    private condStack: CondFrame[] = [];

    preprocess(source: string): string {
        this.macros.clear();
        this.condStack = [];
        const stripped = this.stripComments(source);
        const { text: merged, lineMap, rawLineCount } = this.joinContinuationLines(stripped);
        const mergedLines = merged.split('\n');
        const outputLines: string[] = new Array(rawLineCount).fill('');
        for (let i = 0; i < mergedLines.length; i++) {
            const line = mergedLines[i];
            const trimmed = trimStart(line);
            const targetLine = lineMap[i];
            if (trimmed.startsWith('#')) {
                const result = this.processDirective(trimmed, i + 1);
                if (result !== null) {
                    outputLines[targetLine] = result;
                }
            } else {
                if (this.isActive()) {
                    const expanded = this.expandLine(line, i + 1);
                    outputLines[targetLine] = expanded;
                }
            }
        }
        if (this.condStack.length > 0) {
            throw new Error(`Unterminated #if directive at end of file`);
        }
        return outputLines.join('\n');
    }

    private joinContinuationLines(source: string): { text: string; lineMap: number[]; rawLineCount: number } {
        const rawLines = source.split('\n');
        const result: string[] = [];
        const lineMap: number[] = [];
        for (let i = 0; i < rawLines.length; i++) {
            let line = rawLines[i];
            const startLine = i;
            while (line.endsWith('\\') && i + 1 < rawLines.length) {
                line = line.slice(0, -1) + rawLines[++i];
            }
            result.push(line);
            lineMap.push(startLine);
        }
        return { text: result.join('\n'), lineMap, rawLineCount: rawLines.length };
    }

    private stripComments(source: string): string {
        let result = '';
        let i = 0;
        const len = source.length;
        while (i < len) {
            if (source[i] === '"' || source[i] === "'") {
                const quote = source[i];
                result += source[i++];
                while (i < len && source[i] !== quote) {
                    if (source[i] === '\\' && i + 1 < len) {
                        result += source[i++];
                    }
                    result += source[i++];
                }
                if (i < len) result += source[i++];
            } else if (source[i] === '/' && i + 1 < len && source[i + 1] === '/') {
                while (i < len && source[i] !== '\n') i++;
            } else if (source[i] === '/' && i + 1 < len && source[i + 1] === '*') {
                i += 2;
                let foundEnd = false;
                while (i < len) {
                    if (source[i] === '*' && i + 1 < len && source[i + 1] === '/') {
                        i += 2;
                        foundEnd = true;
                        break;
                    }
                    if (source[i] === '\n') {
                        result += '\n';
                    }
                    i++;
                }
                if (!foundEnd) {
                    result += ' ';
                } else {
                    result += ' ';
                }
            } else {
                result += source[i++];
            }
        }
        return result;
    }

    private isActive(): boolean {
        if (this.condStack.length === 0) return true;
        return this.condStack[this.condStack.length - 1].active;
    }

    private processDirective(line: string, lineNo: number): string | null {
        const text = trimStart(line.substring(1));
        if (text.startsWith('define')) {
            if (this.isActive()) this.processDefine(trimStart(text.substring(6)), lineNo);
            return null;
        }
        if (text.startsWith('undef')) {
            if (this.isActive()) this.processUndef(trimStart(text.substring(5)));
            return null;
        }
        if (text.startsWith('ifdef')) {
            this.processIfdef(trimStart(text.substring(5)), false);
            return null;
        }
        if (text.startsWith('ifndef')) {
            this.processIfdef(trimStart(text.substring(6)), true);
            return null;
        }
        if (text.startsWith('if')) {
            this.processIf(trimStart(text.substring(2)), lineNo);
            return null;
        }
        if (text.startsWith('elif')) {
            this.processElif(trimStart(text.substring(4)), lineNo);
            return null;
        }
        if (text.startsWith('else')) {
            this.processElse();
            return null;
        }
        if (text.startsWith('endif')) {
            this.processEndif();
            return null;
        }
        return null;
    }

    private processDefine(text: string, lineNo: number): void {
        const tokens = this.tokenize(text, lineNo);
        if (tokens.length === 0) return;
        const first = tokens[0];
        if (first.type !== 'identifier') return;
        const name = first.value;

        if (this.macros.has(name)) {
            this.macros.delete(name);
        }

        const rest = tokens.slice(1);
        const leadingWs = rest.findIndex(t => t.type !== 'whitespace');

        if (leadingWs === -1) {
            this.macros.set(name, { kind: 'object', name, body: [] });
            return;
        }

        if (leadingWs === 0 && rest[0].type === 'punctuation' && rest[0].value === '(') {
            this.parseFunctionMacro(name, rest, 0, lineNo);
        } else {
            const body = rest.slice(leadingWs);
            this.macros.set(name, { kind: 'object', name, body });
        }
    }

    private parseFunctionMacro(name: string, tokens: Token[], openParenIdx: number, lineNo: number): void {
        const params: string[] = [];
        let isVariadic = false;
        let i = openParenIdx + 1;

        while (i < tokens.length) {
            if (tokens[i].type === 'punctuation' && tokens[i].value === ')') {
                i++;
                break;
            }
            if (tokens[i].type === 'punctuation' && tokens[i].value === '...') {
                isVariadic = true;
                i++;
                if (i < tokens.length && tokens[i].type === 'punctuation' && tokens[i].value === ')') {
                    i++;
                    break;
                }
                continue;
            }
            if (tokens[i].type === 'identifier') {
                params.push(tokens[i].value);
                i++;
                if (i < tokens.length && tokens[i].type === 'punctuation' && tokens[i].value === ',') {
                    i++;
                }
                continue;
            }
            if (tokens[i].type === 'whitespace' || tokens[i].type === 'punctuation' && tokens[i].value === ',') {
                i++;
                continue;
            }
            i++;
        }

        const body = tokens.slice(i);
        const trimmedBody = this.trimLeadingWhitespace(body);
        this.macros.set(name, { kind: 'function', name, params, isVariadic, body: trimmedBody });
    }

    private processUndef(text: string): void {
        const name = text.trim().split(/\s/)[0];
        if (name) this.macros.delete(name);
    }

    private processIfdef(text: string, negate: boolean): void {
        const name = text.trim().split(/\s/)[0];
        const defined = this.macros.has(name);
        const condition = negate ? !defined : defined;
        this.condStack.push({
            active: condition,
            elseSeen: false,
            parentActive: this.isActive(),
            branchTaken: condition
        });
    }

    private processIf(text: string, lineNo: number): void {
        const result = this.evaluateCondition(text, lineNo);
        this.condStack.push({
            active: result,
            elseSeen: false,
            parentActive: this.condStack.length === 0 ? true : this.condStack[this.condStack.length - 1].active,
            branchTaken: result
        });
    }

    private processElif(text: string, lineNo: number): void {
        if (this.condStack.length === 0) {
            throw new Error(`#elif without #if at line ${lineNo}`);
        }
        const frame = this.condStack[this.condStack.length - 1];
        if (frame.elseSeen) {
            throw new Error(`#elif after #else at line ${lineNo}`);
        }
        if (!frame.parentActive) return;
        if (frame.branchTaken) {
            frame.active = false;
        } else {
            const result = this.evaluateCondition(text, lineNo);
            frame.active = result;
            if (result) frame.branchTaken = true;
        }
    }

    private processElse(): void {
        if (this.condStack.length === 0) {
            throw new Error(`#else without #if`);
        }
        const frame = this.condStack[this.condStack.length - 1];
        if (frame.elseSeen) {
            throw new Error(`duplicate #else`);
        }
        frame.elseSeen = true;
        if (!frame.parentActive) return;
        frame.active = !frame.branchTaken;
    }

    private processEndif(): void {
        if (this.condStack.length === 0) {
            throw new Error(`#endif without #if`);
        }
        this.condStack.pop();
    }

    private evaluateCondition(text: string, lineNo: number): boolean {
        const resolved = this.resolveDefined(text);
        const expanded = this.expandLine(resolved, lineNo);
        return this.evalConstExpr(expanded);
    }

    private resolveDefined(text: string): string {
        return text.replace(/\bdefined\s*\(\s*(\w+)\s*\)/g, (_, name) => {
            return this.macros.has(name) ? '1' : '0';
        }).replace(/\bdefined\s+(\w+)/g, (_, name) => {
            return this.macros.has(name) ? '1' : '0';
        });
    }

    private evalConstExpr(text: string): boolean {
        const expr = text.trim();
        if (expr === '') return false;
        try {
            const jsExpr = expr
                .replace(/&&/g, '&&')
                .replace(/\|\|/g, '||')
                .replace(/!/g, '!')
                .replace(/&/g, '&')
                .replace(/\|/g, '|');
            const result = new Function(`return (${jsExpr})`)();
            return !!result;
        } catch {
            return expr !== '0' && expr.trim() !== '';
        }
    }

    private expandLine(line: string, lineNo: number): string {
        const tokens = this.tokenize(line, lineNo);
        const expanded = this.expandTokens(tokens, new Set());
        return expanded.map(t => t.value).join('');
    }

    private expandTokens(tokens: Token[], expanding: Set<string>): Token[] {
        const result: Token[] = [];
        let i = 0;
        while (i < tokens.length) {
            const token = tokens[i];
            const noExpand = token.noExpand || new Set<string>();
            if (token.type === 'identifier' && !noExpand.has(token.value) && !expanding.has(token.value)) {
                const macro = this.macros.get(token.value);
                if (macro) {
                    const newExpanding = new Set(expanding);
                    newExpanding.add(token.value);
                    if (macro.kind === 'object') {
                        const expanded = this.expandTokens(macro.body, newExpanding);
                        const painted = expanded.map(t => {
                            if (t.type === 'identifier' && t.value === token.value) {
                                const t2 = { ...t };
                                t2.noExpand = new Set(t.noExpand || []);
                                t2.noExpand.add(token.value);
                                return t2;
                            }
                            return t;
                        });
                        const remaining = tokens.slice(i + 1);
                        const rescanned = this.expandTokens([...painted, ...remaining], expanding);
                        result.push(...rescanned);
                        return result;
                    }
                    if (macro.kind === 'function') {
                        const { args, nextIdx } = this.collectArgs(tokens, i + 1, macro);
                        if (args !== null) {
                            const substituted = this.substituteFunctionMacro(macro, args, expanding, token.value);
                            const reExpanded = this.expandTokens(substituted, newExpanding);
                            const painted = reExpanded.map(t => {
                                if (t.type === 'identifier' && t.value === token.value) {
                                    const t2 = { ...t };
                                    t2.noExpand = new Set(t.noExpand || []);
                                    t2.noExpand.add(token.value);
                                    return t2;
                                }
                                return t;
                            });
                            const remaining = tokens.slice(nextIdx);
                            const rescanned = this.expandTokens([...painted, ...remaining], expanding);
                            result.push(...rescanned);
                            return result;
                        }
                    }
                }
            }
            result.push(token);
            i++;
        }
        return result;
    }

    private collectArgs(tokens: Token[], startIdx: number, macro: FunctionMacro): { args: Token[][] | null; nextIdx: number } {
        let i = startIdx;
        while (i < tokens.length && tokens[i].type === 'whitespace') i++;
        if (i >= tokens.length || tokens[i].value !== '(') {
            return { args: null, nextIdx: startIdx };
        }
        i++;

        const args: Token[][] = [];
        let current: Token[] = [];
        let depth = 0;

        while (i < tokens.length) {
            const t = tokens[i];
            if (t.value === '(') {
                depth++;
                current.push(t);
            } else if (t.value === ')') {
                if (depth === 0) {
                    if (current.length > 0 || args.length > 0 || macro.params.length > 0) {
                        args.push(this.trimTokenEdges(current));
                    }
                    return { args, nextIdx: i + 1 };
                }
                depth--;
                current.push(t);
            } else if (t.value === ',' && depth === 0) {
                args.push(this.trimTokenEdges(current));
                current = [];
            } else {
                current.push(t);
            }
            i++;
        }

        return { args: null, nextIdx: startIdx };
    }

    private substituteFunctionMacro(macro: FunctionMacro, args: Token[][], expanding: Set<string>, macroName: string): Token[] {
        const expandedArgs = args.map(arg => this.expandTokens(arg, new Set()));
        const result: Token[] = [];
        const body = this.trimPasteWhitespace(macro.body);
        for (let i = 0; i < body.length; i++) {
            const token = body[i];

            const isNextPaste = (i + 1 < body.length && body[i + 1].type === 'punctuation' && body[i + 1].value === '##')
                || (i + 2 < body.length && body[i + 1].type === 'whitespace' && body[i + 2].type === 'punctuation' && body[i + 2].value === '##');
            const isPrevPaste = result.length > 0 && result[result.length - 1].type === 'punctuation' && result[result.length - 1].value === '##';

            if (token.type === 'punctuation' && token.value === '##') {
                let j = i + 1;
                while (j < body.length && body[j].type === 'whitespace') j++;
                if (j < body.length && body[j].type === 'identifier') {
                    const paramIdx = macro.params.indexOf(body[j].value);
                    if (paramIdx >= 0 && paramIdx < args.length) {
                        const left = result.length > 0 ? result.pop()! : { type: 'other' as TokenType, value: '', lineNo: 0 };
                        const rightTokens = args[paramIdx];
                        const rightValue = rightTokens.map(t => t.value).join('');
                        const pasted = left.value + rightValue;
                        result.push({ type: this.classifyPasted(pasted), value: pasted, lineNo: left.lineNo });
                        i = j;
                        continue;
                    }
                }
                const left = result.length > 0 ? result.pop()! : { type: 'other' as TokenType, value: '', lineNo: 0 };
                let j2 = i + 1;
                while (j2 < body.length && body[j2].type === 'whitespace') j2++;
                if (j2 < body.length) {
                    const pasted = left.value + body[j2].value;
                    result.push({ type: this.classifyPasted(pasted), value: pasted, lineNo: left.lineNo });
                    i = j2;
                    continue;
                }
                result.push(left);
                continue;
            }

            if (token.type === 'punctuation' && token.value === '#' && i + 1 < body.length) {
                const next = body[i + 1];
                if (next.type === 'punctuation' && next.value === '#') {
                    i = this.handleTokenPasting(body, i + 2, result);
                    continue;
                }
                if (next.type === 'identifier') {
                    const paramIdx = macro.params.indexOf(next.value);
                    if (paramIdx >= 0 && paramIdx < args.length) {
                        result.push(this.stringify(args[paramIdx]));
                        i++;
                        continue;
                    }
                }
            }

            if (token.type === 'identifier') {
                const paramIdx = macro.params.indexOf(token.value);
                if (paramIdx >= 0 && paramIdx < args.length) {
                    if (isPrevPaste || isNextPaste) {
                        result.push(...args[paramIdx]);
                    } else {
                        result.push(...expandedArgs[paramIdx]);
                    }
                    continue;
                }
            }

            result.push(token);
        }
        return this.handleAllTokenPasting(result);
    }

    private handleTokenPasting(body: Token[], startIdx: number, result: Token[]): number {
        const left = result.length > 0 ? result.pop()! : { type: 'other' as TokenType, value: '', lineNo: 0 };
        let right: Token;
        let i = startIdx;
        while (i < body.length && body[i].type === 'whitespace') i++;
        if (i < body.length) {
            right = body[i];
            i++;
        } else {
            result.push(left);
            return i;
        }
        const pasted = left.value + right.value;
        result.push({ type: this.classifyPasted(pasted), value: pasted, lineNo: left.lineNo });
        return i;
    }

    private handleAllTokenPasting(tokens: Token[]): Token[] {
        const result: Token[] = [];
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === 'punctuation' && tokens[i].value === '##') {
                const left = result.length > 0 ? result.pop()! : { type: 'other' as TokenType, value: '', lineNo: 0 };
                let j = i + 1;
                while (j < tokens.length && tokens[j].type === 'whitespace') j++;
                if (j < tokens.length) {
                    const right = tokens[j];
                    const pasted = left.value + right.value;
                    result.push({ type: this.classifyPasted(pasted), value: pasted, lineNo: left.lineNo });
                    i = j;
                } else {
                    result.push(left);
                }
            } else {
                result.push(tokens[i]);
            }
        }
        return result;
    }

    private stringify(tokens: Token[]): Token {
        const s = tokens.map(t => t.value).join('').trim();
        const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return { type: 'string', value: `"${escaped}"`, lineNo: tokens.length > 0 ? tokens[0].lineNo : 0 };
    }

    private trimPasteWhitespace(tokens: Token[]): Token[] {
        const result: Token[] = [];
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === 'punctuation' && tokens[i].value === '##') {
                while (result.length > 0 && result[result.length - 1].type === 'whitespace') {
                    result.pop();
                }
                result.push(tokens[i]);
                let j = i + 1;
                while (j < tokens.length && tokens[j].type === 'whitespace') j++;
                i = j - 1;
            } else {
                result.push(tokens[i]);
            }
        }
        return result;
    }

    private classifyPasted(value: string): TokenType {
        if (/^[a-zA-Z_]\w*$/.test(value)) return 'identifier';
        if (/^[0-9]/.test(value)) return 'number';
        return 'other';
    }

    private trimLeadingWhitespace(tokens: Token[]): Token[] {
        let i = 0;
        while (i < tokens.length && tokens[i].type === 'whitespace') i++;
        return tokens.slice(i);
    }

    private trimTokenEdges(tokens: Token[]): Token[] {
        let start = 0;
        while (start < tokens.length && tokens[start].type === 'whitespace') start++;
        let end = tokens.length;
        while (end > start && tokens[end - 1].type === 'whitespace') end--;
        return tokens.slice(start, end);
    }

    private tokenize(text: string, lineNo: number): Token[] {
        const tokens: Token[] = [];
        let i = 0;
        while (i < text.length) {
            const ch = text[i];

            if (ch === ' ' || ch === '\t') {
                let j = i;
                while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
                tokens.push({ type: 'whitespace', value: text.slice(i, j), lineNo });
                i = j;
                continue;
            }

            if (ch === '/' && i + 1 < text.length && text[i + 1] === '/') {
                tokens.push({ type: 'other', value: text.slice(i), lineNo });
                break;
            }

            if (ch === '"') {
                const { value, endIdx } = this.scanString(text, i, lineNo);
                tokens.push({ type: 'string', value, lineNo });
                i = endIdx;
                continue;
            }

            if (ch === "'") {
                const { value, endIdx } = this.scanChar(text, i, lineNo);
                tokens.push({ type: 'char', value, lineNo });
                i = endIdx;
                continue;
            }

            if (/[a-zA-Z_]/.test(ch)) {
                let j = i;
                while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) j++;
                tokens.push({ type: 'identifier', value: text.slice(i, j), lineNo });
                i = j;
                continue;
            }

            if (/[0-9]/.test(ch)) {
                let j = i;
                while (j < text.length && /[a-zA-Z0-9_.xXa-fA-F]/.test(text[j])) j++;
                tokens.push({ type: 'number', value: text.slice(i, j), lineNo });
                i = j;
                continue;
            }

            if (ch === '.' && i + 2 < text.length && text[i + 1] === '.' && text[i + 2] === '.') {
                tokens.push({ type: 'punctuation', value: '...', lineNo });
                i += 3;
                continue;
            }

            if (ch === '#' && i + 1 < text.length && text[i + 1] === '#') {
                tokens.push({ type: 'punctuation', value: '##', lineNo });
                i += 2;
                continue;
            }

            if ('+-*/%<>=!&|^~?:;,()[]{}.#'.includes(ch)) {
                let j = i + 1;
                if (j < text.length) {
                    const two = text.slice(i, j + 1);
                    if (['++', '--', '+=', '-=', '*=', '/=', '%=', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '&=', '|=', '^=', '<<=', '>>=', '->'].includes(two)) {
                        tokens.push({ type: 'punctuation', value: two, lineNo });
                        i = j + 1;
                        continue;
                    }
                }
                tokens.push({ type: 'punctuation', value: ch, lineNo });
                i++;
                continue;
            }

            tokens.push({ type: 'other', value: ch, lineNo });
            i++;
        }
        return tokens;
    }

    private scanString(text: string, start: number, lineNo: number): { value: string; endIdx: number } {
        let i = start + 1;
        while (i < text.length) {
            if (text[i] === '\\') { i += 2; continue; }
            if (text[i] === '"') { i++; break; }
            i++;
        }
        return { value: text.slice(start, i), endIdx: i };
    }

    private scanChar(text: string, start: number, lineNo: number): { value: string; endIdx: number } {
        let i = start + 1;
        while (i < text.length) {
            if (text[i] === '\\') { i += 2; continue; }
            if (text[i] === "'") { i++; break; }
            i++;
        }
        return { value: text.slice(start, i), endIdx: i };
    }
}

class SC8P053Compiler {
    private globalSymbols: Map<string, Sym> = new Map();
    private globalInits: { asmName: string; value: number; isArray: boolean; ramAddr: number; arrayValues?: number[] }[] = [];
    private fns: Map<string, Fn> = new Map();
    private nextRamAddr: number = RAM_GP_START;
    private currentBank: number = 0;
    private currentAsmBank: number = 0;
    private asmLines: string[] = [];
    private currentFn: Fn | null = null;
    private tempCounter: number = 0;
    private dryRun: boolean = false;
    private currentSourceLine: number = 0;

    private tempName(idx: number): string {
        if (!this.currentFn) return `_T${idx}`;
        return `${this.currentFn.asmName}_T${idx}`;
    }

    private allocTemp(): number {
        if (!this.currentFn) return this.tempCounter++;
        const idx = this.currentFn.tempCount++;
        this.tempCounter = Math.max(this.tempCounter, idx + 1);
        return idx;
    }

    async compile(source: string): Promise<{ rom: Uint16Array; asm: string; debugInfo: DebugInfo }> {
        const preprocessor = new Preprocessor();
        const preprocessed = preprocessor.preprocess(source);
        const c = await language;
        const parser = new Parser();
        parser.setLanguage(c);
        const tree = parser.parse(preprocessed);

        this.asmLines = [];
        this.globalSymbols.clear();
        this.globalInits = [];
        this.fns.clear();
        this.nextRamAddr = RAM_GP_START;
        this.currentBank = 0;
        this.tempCounter = 0;
        this.currentSourceLine = 0;

        this.collectDeclarations(tree.rootNode);
        this.buildCallGraph(tree.rootNode);
        this.checkRecursion();
        const afterGlobalsAddr = this.nextRamAddr;
        const afterGlobalsBank = this.currentBank;
        this.dryRun = true;
        this.generateCode(tree.rootNode);
        this.dryRun = false;
        for (const [, finfo] of this.fns) {
            finfo.savedTempCount = finfo.tempCount;
            finfo.frameSize += finfo.tempCount;
        }
        for (const [, finfo] of this.fns) {
            finfo.frameBase = -1;
        }
        this.nextRamAddr = afterGlobalsAddr;
        this.currentBank = afterGlobalsBank;
        this.allocateCompiledStack();
        this.generateCode(tree.rootNode);
        this.resolveTempAddresses();
        this.emitOutput();

        const asmLineToSourceLine = new Map<number, number>();
        const fnStartMarkerLines = new Map<string, number>();
        const fnEndMarkerLines = new Map<string, number>();
        let lastSourceLine = 0;
        for (let i = 0; i < this.asmLines.length; i++) {
            const line = this.asmLines[i];
            const srcMatch = line.match(/^;@LINE (\d+)$/);
            if (srcMatch) {
                lastSourceLine = parseInt(srcMatch[1]);
                this.asmLines[i] = '';
                continue;
            }
            const fnStartMatch = line.match(/^;@FN_START (.+)$/);
            if (fnStartMatch) {
                fnStartMarkerLines.set(fnStartMatch[1], i);
                this.asmLines[i] = '';
                continue;
            }
            const fnEndMatch = line.match(/^;@FN_END (.+)$/);
            if (fnEndMatch) {
                fnEndMarkerLines.set(fnEndMatch[1], i);
                this.asmLines[i] = '';
                continue;
            }
            if (lastSourceLine > 0) {
                asmLineToSourceLine.set(i, lastSourceLine);
            }
        }

        const asmSource = this.asmLines.join('\n') + '\n';
        const { rom, debugInfo: asmDebugInfo } = assemble(asmSource);

        const asmLineToPc = new Map<number, number>();
        for (const [pc, asmLine] of asmDebugInfo.lineNoMap) {
            asmLineToPc.set(asmLine - 1, pc);
        }

        const lineNoMap = new Map<number, number>();
        for (const [pc, asmLine] of asmDebugInfo.lineNoMap) {
            const cLine = asmLineToSourceLine.get(asmLine - 1);
            if (cLine !== undefined) {
                lineNoMap.set(pc, cLine);
            }
        }

        const findNextPcAfter = (markerLine: number): number | null => {
            for (let i = markerLine + 1; i < this.asmLines.length; i++) {
                const pc = asmLineToPc.get(i);
                if (pc !== undefined) return pc;
            }
            return null;
        };

        const fnRanges = new Map<string, FnRange[]>();
        for (const [fname, startMarker] of fnStartMarkerLines) {
            const startPc = findNextPcAfter(startMarker);
            if (startPc === null) continue;

            const endMarker = fnEndMarkerLines.get(fname);
            let endPc: number;
            if (endMarker !== undefined) {
                const nextPc = findNextPcAfter(endMarker);
                if (nextPc !== null) {
                    endPc = nextPc;
                } else {
                    const lastPc = [...asmLineToPc.values()].reduce((a, b) => Math.max(a, b), 0);
                    endPc = lastPc + 1;
                }
            } else {
                endPc = startPc + 1;
            }

            fnRanges.set(fname, [{ start: startPc, end: endPc }]);
        }

        const varMap = new Map<string, Sym[]>();
        for (const [, sym] of this.globalSymbols) {
            if (!varMap.has('global')) varMap.set('global', []);
            varMap.get('global')!.push(sym);
        }
        for (const [fname, finfo] of this.fns) {
            if (!varMap.has(fname)) varMap.set(fname, []);
            for (const [, sym] of finfo.localSymbols) {
                varMap.get(fname)!.push(sym);
            }
        }

        const debugInfo: DebugInfo = {
            lineNoMap,
            fnRanges,
            varMap
        };

        return { rom, asm: asmSource, debugInfo };
    }

    private buildCallGraph(rootNode: Parser.SyntaxNode) {
        for (let i = 0; i < rootNode.childCount; i++) {
            const child = rootNode.child(i);
            if (!child || child.type !== 'function_definition') continue;
            const declaratorNode = child.childForFieldName('declarator');
            if (!declaratorNode) continue;
            const funcDeclarator = this.findNodeByType(declaratorNode, 'function_declarator');
            if (!funcDeclarator) continue;
            const nameNode = funcDeclarator.childForFieldName('declarator');
            const funcName = nameNode ? nameNode.text.trim() : '';
            const funcInfo = this.fns.get(funcName);
            if (!funcInfo) continue;
            const bodyNode = child.childForFieldName('body');
            if (bodyNode) this.scanForCalls(bodyNode, funcInfo);
        }
    }

    private scanForCalls(node: Parser.SyntaxNode, funcInfo: Fn) {
        if (node.type === 'call_expression') {
            const funcNode = node.childForFieldName('function');
            if (funcNode) funcInfo.calls.add(funcNode.text.trim());
        }
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) this.scanForCalls(child, funcInfo);
        }
    }

    private checkRecursion() {
        const visited = new Set<string>();
        const stack = new Set<string>();
        const findCycle = (name: string): string[] | null => {
            if (stack.has(name)) return [name];
            if (visited.has(name)) return null;
            visited.add(name);
            stack.add(name);
            const finfo = this.fns.get(name);
            if (finfo) {
                for (const callee of finfo.calls) {
                    const cycle = findCycle(callee);
                    if (cycle) {
                        cycle.unshift(name);
                        return cycle;
                    }
                }
            }
            stack.delete(name);
            return null;
        };
        for (const [fname] of this.fns) {
            const cycle = findCycle(fname);
            if (cycle) {
                const cycleStart = cycle.indexOf(cycle[cycle.length - 1]);
                const path = cycle.slice(cycleStart).join(' -> ');
                throw new Error(`Recursive function call detected: ${path}. Recursion is not supported on this target (static RAM allocation).`);
            }
        }
    }

    private allocateCompiledStack() {
        const isrReachable = new Set<string>();
        for (const [fname, finfo] of this.fns) {
            if (finfo.isISR) {
                for (const r of this.getReachable(fname)) isrReachable.add(r);
            }
        }

        const isrFrames: Fn[] = [];
        const mainFrames: Fn[] = [];
        for (const [fname, finfo] of this.fns) {
            if (finfo.frameSize === 0 && !finfo.isISR) continue;
            if (finfo.isISR || isrReachable.has(fname)) {
                isrFrames.push(finfo);
            } else {
                mainFrames.push(finfo);
            }
        }

        let sharedOffset = RAM_SHARED_START + ISR_SAVE_SIZE;
        for (const finfo of isrFrames) {
            finfo.frameBase = sharedOffset;
            sharedOffset += finfo.frameSize;
            if (sharedOffset > RAM_SHARED_END + 1) {
                throw new Error(`ISR frame overflow in shared memory: ${finfo.name} needs ${finfo.frameSize} bytes`);
            }
        }

        const overlapGroups: Set<string>[] = [];
        for (const finfo of mainFrames) {
            const reachable = this.getReachable(finfo.name);
            let placed = false;
            for (const group of overlapGroups) {
                let conflicts = false;
                for (const existing of group) {
                    const existingReachable = this.getReachable(existing);
                    if (reachable.has(existing) || existingReachable.has(finfo.name)) {
                        conflicts = true;
                        break;
                    }
                }
                if (!conflicts) {
                    group.add(finfo.name);
                    placed = true;
                    break;
                }
            }
            if (!placed) overlapGroups.push(new Set([finfo.name]));
        }

        let offset = this.nextRamAddr;
        let bank = this.currentBank;
        for (const group of overlapGroups) {
            let maxFrameSize = 0;
            for (const fname of group) {
                const finfo = this.fns.get(fname)!;
                if (finfo.frameSize > maxFrameSize) maxFrameSize = finfo.frameSize;
            }
            if (bank === 0 && offset + maxFrameSize - 1 > RAM_GP_END) {
                bank = 1;
                offset = RAM_BANK1_START;
            }
            if (bank === 1 && offset + maxFrameSize - 1 > RAM_BANK1_END) {
                throw new Error('Out of RAM for compiled stack overlay group');
            }
            for (const fname of group) {
                this.fns.get(fname)!.frameBase = offset;
            }
            offset += maxFrameSize;
        }
        this.nextRamAddr = offset;
        this.currentBank = bank;

        for (const [, finfo] of this.fns) {
            for (const [, sym] of finfo.localSymbols) {
                if (sym.isStatic) continue;
                sym.ramAddr = finfo.frameBase + sym.frameOffset;
                sym.bank = this.getBankForAddr(sym.ramAddr);
            }
        }
    }

    private resolveTempAddresses() {
        for (const [, finfo] of this.fns) {
            if (finfo.tempCount === 0) continue;
            const tempBase = finfo.frameBase + finfo.frameSize - finfo.tempCount;
            for (let i = 0; i < finfo.tempCount; i++) {
                const asmName = `${finfo.asmName}_T${i}`;
                const addr = tempBase + i;
                const lineIdx = this.asmLines.findIndex(l => l === `${asmName} EQU ADDR_${asmName}`);
                if (lineIdx >= 0) {
                    this.asmLines[lineIdx] = `${asmName} EQU 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                }
            }
        }
    }

    private getReachable(fname: string): Set<string> {
        const visited = new Set<string>();
        const stack = [fname];
        while (stack.length > 0) {
            const current = stack.pop()!;
            if (visited.has(current)) continue;
            visited.add(current);
            const finfo = this.fns.get(current);
            if (finfo) {
                for (const callee of finfo.calls) {
                    if (!visited.has(callee)) stack.push(callee);
                }
            }
        }
        return visited;
    }

    private emitOutput() {
        const headerLines: string[] = [];
        const equLines: string[] = [];
        const codeLines: string[] = [];

        for (const line of this.asmLines) {
            if (line.startsWith('STATUS EQU') || line.startsWith('FSR EQU') || line.startsWith('INDF EQU') ||
                line.startsWith('PCLATH EQU') || line.startsWith('ISR_')) {
                headerLines.push(line);
            } else if (line.includes(' EQU ')) {
                equLines.push(line);
            } else {
                codeLines.push(line);
            }
        }

        this.asmLines = [...headerLines, ...equLines, ...codeLines];
    }

    private emitHeader() {
        this.asmLines.push('STATUS EQU 0x03');
        this.asmLines.push('FSR EQU 0x04');
        this.asmLines.push('PCLATH EQU 0x0A');
        this.asmLines.push('INDF EQU 0x00');
        this.asmLines.push('ISR_ACC EQU 0x70');
        this.asmLines.push('ISR_STATUS EQU 0x71');
        this.asmLines.push('ISR_FSR EQU 0x72');
        this.asmLines.push('ISR_PCLATH EQU 0x73');
        // this.asmLines.push('');
    }

    private hasISRFn(): boolean {
        for (const [, func] of this.fns) {
            if (func.isISR) return true;
        }
        return false;
    }

    private emitRamDefinitions() {
        for (const [, sym] of this.globalSymbols) {
            if (sym.isArray) {
                for (let i = 0; i < sym.arraySize; i++) {
                    this.asmLines.push(`${sym.asmName}_${i} EQU 0x${(sym.ramAddr + i).toString(16).toUpperCase().padStart(2, '0')}`);
                }
            } else {
                this.asmLines.push(`${sym.asmName} EQU 0x${sym.ramAddr.toString(16).toUpperCase().padStart(2, '0')}`);
            }
        }
        for (const [, funcInfo] of this.fns) {
            for (const [, sym] of funcInfo.localSymbols) {
                if (!sym.isArray) {
                    this.asmLines.push(`${sym.asmName} EQU 0x${sym.ramAddr.toString(16).toUpperCase().padStart(2, '0')}`);
                } else {
                    for (let i = 0; i < sym.arraySize; i++) {
                        this.asmLines.push(`${sym.asmName}_${i} EQU 0x${(sym.ramAddr + i).toString(16).toUpperCase().padStart(2, '0')}`);
                    }
                }
            }
            for (let i = 0; i < funcInfo.tempCount; i++) {
                const asmName = `${funcInfo.asmName}_T${i}`;
                this.asmLines.push(`${asmName} EQU ADDR_${asmName}`);
            }
        }
        // this.asmLines.push('');
    }

    private allocRam(size: number): number {
        const addr = this.nextRamAddr;
        if (this.currentBank === 0 && addr + size - 1 > RAM_GP_END) {
            this.currentBank = 1;
            this.nextRamAddr = 0xA0;
            return this.allocRam(size);
        }
        if (this.currentBank === 1 && addr + size - 1 > 0xEF) {
            throw new Error(`Out of RAM: need ${size} bytes from 0x${addr.toString(16)}, no more banks available`);
        }
        this.nextRamAddr += size;
        return addr;
    }

    private getBankForAddr(addr: number): number {
        if (addr >= 0x80 && addr <= 0xEF) return 1;  // Bank1 SFR
        if (addr >= 0x70 && addr <= 0xFF) return -1; // 0x70-0x7F通用RAM + 0xF0-0xFF快速存储区
        return 0;
    }

    private emitBankSwitch(bank: number) {
        if (bank === this.currentAsmBank) return;
        if (bank === 1) this.asmLines.push('SETB STATUS,5');
        else if (bank === 0) this.asmLines.push('CLRB STATUS,5');
        this.currentAsmBank = bank;
    }

    private invalidateBankState() {
        this.currentAsmBank = -2;
    }

    private emitLabel(label: string) {
        this.asmLines.push(`${label}:`);
        this.invalidateBankState();
    }

    private ensureBank(addr: number) {
        const bank = this.getBankForAddr(addr);
        if (bank === -1) return;
        this.emitBankSwitch(bank);
    }

    private ensureBank0() {
        this.emitBankSwitch(0);
    }

    private emitLdAToSym(sym: Sym) {
        this.ensureBank(sym.ramAddr);
        this.asmLines.push(`LD ${sym.asmName},A`);
    }

    private emitLdSymToA(sym: Sym) {
        this.ensureBank(sym.ramAddr);
        this.asmLines.push(`LD A,${sym.asmName}`);
    }

    private emitOpSym(op: string, sym: Sym) {
        this.ensureBank(sym.ramAddr);
        const line = `${op} ${sym.asmName}`;
        this.asmLines.push(line);
    }

    private emitLdArrayElemToA(sym: Sym, index: number) {
        if (!sym.isArray) {
            this.emitLdSymToA(sym);
            if (index === 0) {
                this.emitIndirectRead();
            } else {
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                this.asmLines.push(`ADDIA 0x${(index & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                this.emitIndirectRead();
            }
            return;
        }
        this.ensureBank(sym.ramAddr);
        this.asmLines.push(`LD A,${sym.asmName}_${index}`);
    }

    private emitLdAToArrayElem(sym: Sym, index: number) {
        if (!sym.isArray) {
            const t = this.allocTemp();
            this.emitLdAToTemp(t);
            this.emitLdSymToA(sym);
            if (index !== 0) {
                this.asmLines.push(`ADDIA 0x${(index & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
            }
            this.emitIndirectSetFSR();
            this.emitLdTempToA(t);
            this.asmLines.push('LD INDF,A');
            return;
        }
        this.ensureBank(sym.ramAddr);
        this.asmLines.push(`LD ${sym.asmName}_${index},A`);
    }

    private getTempAddr(idx: number): number {
        if (!this.currentFn) return 0x20 + idx;
        const localSize = this.currentFn.frameSize - this.currentFn.savedTempCount;
        return this.currentFn.frameBase + localSize + idx;
    }

    private emitLdAToTemp(idx: number) {
        this.ensureBank(this.getTempAddr(idx));
        this.asmLines.push(`LD ${this.tempName(idx)},A`);
    }

    private emitLdTempToA(idx: number) {
        this.ensureBank(this.getTempAddr(idx));
        this.asmLines.push(`LD A,${this.tempName(idx)}`);
    }

    private emitOpTemp(op: string, idx: number) {
        this.ensureBank(this.getTempAddr(idx));
        const line = `${op} ${this.tempName(idx)}`;
        this.asmLines.push(line);
    }

    private emitTestBitTemp(instr: 'SZB' | 'SNZB', idx: number, bit: number) {
        this.ensureBank(this.getTempAddr(idx));
        this.asmLines.push(`${instr} ${this.tempName(idx)},${bit}`);
    }

    private emitIndirectRead() {
        this.asmLines.push('CLRB STATUS,5');
        this.currentAsmBank = 0;
        this.asmLines.push('LD FSR,A');
        this.asmLines.push('LD A,INDF');
    }

    private emitIndirectSetFSR() {
        this.asmLines.push('CLRB STATUS,5');
        this.currentAsmBank = 0;
        this.asmLines.push('LD FSR,A');
    }

    private collectDeclarations(node: Parser.SyntaxNode) {
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child) continue;
            if (child.type === 'declaration') this.processGlobalDeclaration(child);
            else if (child.type === 'function_definition') this.processFnSignature(child);
        }
    }

    private processGlobalDeclaration(node: Parser.SyntaxNode) {
        const typeNode = node.childForFieldName('type');
        if (!typeNode) return;

        const ctype = this.resolveType(typeNode);
        const declarators: Parser.SyntaxNode[] = [];
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && child.isNamed && child.type !== 'sized_type_specifier' && child.type !== 'primitive_type') {
                declarators.push(child);
            }
        }

        for (const declaratorNode of declarators) {
            const { name, isArray, arraySize } = this.parseDeclarator(declaratorNode);
            const size = isArray ? arraySize : 1;

            if (this.globalSymbols.has(name)) {
                throw new Error(`Global variable '${name}' is already defined`);
            }

            const addr = this.allocRam(size);
            const asmName = toAsmName(name);

            this.globalSymbols.set(name, {
                name, asmName, type: ctype, ramAddr: addr, bank: this.getBankForAddr(addr),
                isArray, arraySize, isParam: false, paramIndex: 0, frameOffset: -1, isStatic: false
            });

            const initDecl = this.findNodeByType(declaratorNode, 'init_declarator');
            const actualDeclarator = initDecl || declaratorNode;
            const valueNode = actualDeclarator.childForFieldName ? actualDeclarator.childForFieldName('value') : null;
            if (valueNode) {
                if (isArray && valueNode.type === 'initializer_list') {
                    const values: number[] = [];
                    for (let i = 0; i < valueNode.childCount; i++) {
                        const child = valueNode.child(i);
                        if (!child || child.type === ',' || child.type === '{' || child.type === '}') continue;
                        const constVal = this.getConstantValue(child);
                        if (constVal !== null) {
                            values.push(constVal & 0xFF);
                        }
                    }
                    this.globalInits.push({ asmName, value: 0, isArray: true, ramAddr: addr, arrayValues: values });
                } else {
                    const constVal = this.getConstantValue(valueNode);
                    if (constVal !== null) {
                        this.globalInits.push({ asmName, value: constVal & 0xFF, isArray: false, ramAddr: addr });
                    } else {
                        const addrVal = this.getGlobalAddressValue(valueNode);
                        if (addrVal !== null) {
                            this.globalInits.push({ asmName, value: addrVal & 0xFF, isArray: false, ramAddr: addr });
                        } else {
                            throw new Error(`Global variable '${name}' initializer must be a constant expression (got: ${valueNode.text.trim()})`);
                        }
                    }
                }
            }
        }
    }

    private processFnSignature(node: Parser.SyntaxNode) {
        const typeNode = node.childForFieldName('type');
        const declaratorNode = node.childForFieldName('declarator');
        const bodyNode = node.childForFieldName('body');
        if (!typeNode || !declaratorNode) return;

        const returnType = this.resolveType(typeNode);
        const funcDeclarator = this.findNodeByType(declaratorNode, 'function_declarator');
        if (!funcDeclarator) return;

        const nameNode = funcDeclarator.childForFieldName('declarator');
        const funcName = nameNode ? nameNode.text.trim() : '';

        let isISR = false;
        for (let i = 0; i < funcDeclarator.childCount; i++) {
            const child = funcDeclarator.child(i);
            if (child && child.type === 'identifier' && child.text === '__interrupt') {
                isISR = true;
                break;
            }
        }

        const asmFuncName = isISR ? '__INTERRUPT' : toAsmName(funcName);

        const params = this.extractParams(funcDeclarator, funcName);

        const funcInfo: Fn = {
            name: funcName,
            asmName: asmFuncName,
            returnType,
            params,
            localSymbols: new Map(),
            labelCounter: 0,
            isISR,
            tempCount: 0,
            savedTempCount: 0,
            calls: new Set(),
            hasEarlyReturn: false,
            frameSize: 0,
            frameBase: -1
        };

        let frameOffset = 0;

        let paramIdx = 0;
        for (const p of params) {
            funcInfo.localSymbols.set(p.name, {
                name: p.name, asmName: p.asmName, type: p.type,
                ramAddr: -1, bank: -1,
                isArray: false, arraySize: 0,
                isParam: true, paramIndex: paramIdx++,
                frameOffset: frameOffset++, isStatic: false
            });
        }

        if (bodyNode) frameOffset = this.collectLocalDeclarations(bodyNode, funcInfo, frameOffset);

        funcInfo.frameSize = frameOffset;
        if (this.fns.has(funcName)) {
            throw new Error(`Function '${funcName}' is already defined`);
        }
        this.fns.set(funcName, funcInfo);
    }

    private collectLocalDeclarations(node: Parser.SyntaxNode, funcInfo: Fn, frameOffset: number): number {
        if (node.type === 'declaration') {
            const typeNode = node.childForFieldName('type');
            if (!typeNode) return frameOffset;

            let isStatic = false;
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child && child.type === 'storage_class_specifier' && child.text.trim() === 'static') {
                    isStatic = true;
                    break;
                }
            }

            const ctype = this.resolveType(typeNode);
            const declarators: Parser.SyntaxNode[] = [];
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child && child.isNamed && child.type !== 'sized_type_specifier' && child.type !== 'primitive_type' && child.type !== 'storage_class_specifier') {
                    declarators.push(child);
                }
            }

            let offset = frameOffset;
            for (const declaratorNode of declarators) {
                const { name, isArray, arraySize } = this.parseDeclarator(declaratorNode);
                const size = isArray ? arraySize : 1;
                const asmName = toAsmName(funcInfo.name + '_' + name);

                if (funcInfo.localSymbols.has(name)) {
                    throw new Error(`Variable '${name}' redeclared in function '${funcInfo.name}' (shadowing not supported)`);
                }

                if (isStatic) {
                    const addr = this.allocRam(size);
                    funcInfo.localSymbols.set(name, {
                        name, asmName, type: ctype,
                        ramAddr: addr, bank: this.getBankForAddr(addr),
                        isArray, arraySize,
                        isParam: false, paramIndex: 0,
                        frameOffset: -1, isStatic: true
                    });
                    const initDecl = this.findNodeByType(declaratorNode, 'init_declarator');
                    if (initDecl) {
                        const valueNode = initDecl.childForFieldName('value');
                        if (valueNode) {
                            const constVal = this.getConstantValue(valueNode);
                            if (constVal !== null) {
                                this.globalInits.push({ asmName, value: constVal & 0xFF, isArray: false, ramAddr: addr });
                            }
                        }
                    } else {
                        this.globalInits.push({ asmName, value: 0, isArray: false, ramAddr: addr });
                    }
                } else {
                    funcInfo.localSymbols.set(name, {
                        name, asmName, type: ctype,
                        ramAddr: -1, bank: -1,
                        isArray, arraySize,
                        isParam: false, paramIndex: 0,
                        frameOffset: offset, isStatic: false
                    });
                    offset += size;
                }
            }
            return offset;
        }

        let offset = frameOffset;
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) offset = this.collectLocalDeclarations(child, funcInfo, offset);
        }
        return offset;
    }

    private extractParams(funcDeclarator: Parser.SyntaxNode, funcName: string): { name: string; asmName: string; type: Type }[] {
        const params: { name: string; asmName: string; type: Type }[] = [];
        const paramListNode = funcDeclarator.childForFieldName('parameters');
        if (!paramListNode) return params;

        for (let i = 0; i < paramListNode.childCount; i++) {
            const child = paramListNode.child(i);
            if (!child || child.type !== 'parameter_declaration') continue;
            const pType = child.childForFieldName('type');
            const pDeclarator = child.childForFieldName('declarator');
            if (!pType || !pDeclarator) continue;
            const { name: pName } = this.parseDeclarator(pDeclarator);
            params.push({ name: pName, asmName: toAsmName(funcName + '_' + pName), type: this.resolveType(pType) });
        }
        return params;
    }

    private resolveType(node: Parser.SyntaxNode): Type {
        const text = node.text.trim();
        if (text === 'void') return 'void';
        if (text === 'bool') return 'bool';
        if (text === 'int' ||
            text === 'short' ||
            text === 'char' ||
            text === 'signed int' ||
            text === 'signed short' ||
            text === 'signed char') return 'i8';
        if (text.startsWith('float') || text.startsWith('double')) {
            throw new Error(`Floating-point type '${text}' is not supported on this target`);
        }
        if (text.startsWith('struct') || text.startsWith('union') || text.startsWith('enum')) {
            throw new Error(`Type '${text.split(/\s/)[0]}' is not supported on this target`);
        }
        return 'u8';
    }

    private parseDeclarator(node: Parser.SyntaxNode): { name: string; isArray: boolean; arraySize: number } {
        if (node.type === 'init_declarator') {
            const inner = node.childForFieldName('declarator');
            if (inner) return this.parseDeclarator(inner);
            return { name: '', isArray: false, arraySize: 0 };
        }
        if (node.type === 'pointer_declarator') {
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child && child.type === 'identifier') {
                    return { name: child.text.trim(), isArray: false, arraySize: 0 };
                }
                if (child && child.type === 'array_declarator') {
                    return this.parseDeclarator(child);
                }
            }
            return { name: node.text.trim(), isArray: false, arraySize: 0 };
        }
        const arrayDecl = this.findNodeByType(node, 'array_declarator');
        if (arrayDecl) {
            const nameNode = arrayDecl.childForFieldName('declarator');
            if (nameNode && nameNode.type === 'array_declarator') {
                throw new Error(`Multi-dimensional arrays are not supported on this target`);
            }
            const sizeNode = arrayDecl.childForFieldName('size');
            let size = 1;
            if (sizeNode) {
                const constVal = this.getConstantValue(sizeNode);
                size = constVal !== null ? constVal : parseInt(sizeNode.text, 10);
                if (isNaN(size) || size <= 0) size = 1;
            }
            return {
                name: nameNode ? nameNode.text.trim() : '',
                isArray: true,
                arraySize: size
            };
        }
        return { name: node.text.trim(), isArray: false, arraySize: 0 };
    }

    private findNodeByType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        if (node.type === type) return node;
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
                const found = this.findNodeByType(child, type);
                if (found) return found;
            }
        }
        return null;
    }

    private generateCode(node: Parser.SyntaxNode) {
        if (this.dryRun) {
            const savedLines = this.asmLines;
            const noopArray: any = { push: () => { }, findIndex: () => -1, length: 0 };
            this.asmLines = noopArray as any;
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child && child.type === 'function_definition') this.emitFn(child);
            }
            this.asmLines = savedLines;
            return;
        }

        const savedLines = this.asmLines;
        this.asmLines = [];

        const hasISR = this.hasISRFn();
        this.asmLines.push('JP V_MAIN');
        if (hasISR) {
            this.asmLines.push('ORG 0x04');
            this.asmLines.push('JP __INTERRUPT');
        }
        // this.asmLines.push('');

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && child.type === 'function_definition') this.emitFn(child);
        }

        const codeLines = this.asmLines;
        this.asmLines = savedLines;

        this.emitHeader();
        this.emitRamDefinitions();
        this.asmLines.push(...codeLines);
    }

    private emitGlobalInits() {
        for (const init of this.globalInits) {
            this.ensureBank(init.ramAddr);
            if (init.isArray && init.arrayValues) {
                for (let i = 0; i < init.arrayValues.length; i++) {
                    this.asmLines.push(`LDIA 0x${init.arrayValues[i].toString(16).toUpperCase().padStart(2, '0')}`);
                    this.asmLines.push(`LD ${init.asmName}_${i},A`);
                }
            } else {
                this.asmLines.push(`LDIA 0x${init.value.toString(16).toUpperCase().padStart(2, '0')}`);
                this.asmLines.push(`LD ${init.asmName},A`);
            }
        }
    }

    private emitFn(node: Parser.SyntaxNode) {
        const declaratorNode = node.childForFieldName('declarator');
        if (!declaratorNode) return;
        const funcDeclarator = this.findNodeByType(declaratorNode, 'function_declarator');
        if (!funcDeclarator) return;
        const nameNode = funcDeclarator.childForFieldName('declarator');
        const funcName = nameNode ? nameNode.text.trim() : '';

        const funcInfo = this.fns.get(funcName);
        if (!funcInfo) throw new Error(`Function ${funcName} not found`);

        this.currentFn = funcInfo;
        this.tempCounter = 0;
        funcInfo.tempCount = 0;
        funcInfo.hasEarlyReturn = false;
        this.currentAsmBank = 0;

        if (!this.dryRun) {
            this.currentSourceLine = node.startPosition.row + 1;
            this.asmLines.push(`;@LINE ${this.currentSourceLine}`);
            this.asmLines.push(`;@FN_START ${funcName}`);
        }
        this.asmLines.push(`${funcInfo.asmName}:`);

        if (funcInfo.isISR) {
            this.asmLines.push('LD ISR_ACC,A');
            this.asmLines.push('SWAPA STATUS');
            this.asmLines.push('LD ISR_STATUS,A');
            this.asmLines.push('LD A,FSR');
            this.asmLines.push('LD ISR_FSR,A');
            this.asmLines.push('LD A,PCLATH');
            this.asmLines.push('LD ISR_PCLATH,A');
        }

        this.asmLines.push('CLRB STATUS,5');
        this.currentAsmBank = 0;

        if (funcName === 'main' && this.globalInits.length > 0) {
            this.emitGlobalInits();
        }

        const bodyNode = node.childForFieldName('body');
        if (bodyNode) this.emitCompoundStatement(bodyNode, funcInfo);

        if (funcName === 'main') {
            this.asmLines.push('STOP');
        } else if (funcInfo.isISR) {
            this.asmLines.push('LD A,ISR_PCLATH');
            this.asmLines.push('LD PCLATH,A');
            this.asmLines.push('LD A,ISR_FSR');
            this.asmLines.push('LD FSR,A');
            this.asmLines.push('SWAPA ISR_STATUS');
            this.asmLines.push('LD STATUS,A');
            this.asmLines.push('SWAPR ISR_ACC');
            this.asmLines.push('SWAPA ISR_ACC');
            this.asmLines.push('RETI');
        } else {
            if (!funcInfo.hasEarlyReturn && funcInfo.returnType !== 'void') {
            }
            this.ensureBank0();
            this.asmLines.push('RET');
        }
        if (!this.dryRun) {
            this.asmLines.push(`;@FN_END ${funcName}`);
        }

        this.currentFn = null;
    }

    private emitCompoundStatement(node: Parser.SyntaxNode, funcInfo: Fn) {
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child) continue;
            if (child.type === '{' || child.type === '}') continue;
            this.emitStatement(child, funcInfo);
        }
    }

    private emitStatement(node: Parser.SyntaxNode, funcInfo: Fn) {
        if (!this.dryRun) {
            this.currentSourceLine = node.startPosition.row + 1;
            this.asmLines.push(`;@LINE ${this.currentSourceLine}`);
        }
        switch (node.type) {
            case 'expression_statement': this.emitExpressionStatement(node, funcInfo); break;
            case 'if_statement': this.emitIfStatement(node, funcInfo); break;
            case 'while_statement': this.emitWhileStatement(node, funcInfo); break;
            case 'for_statement': this.emitForStatement(node, funcInfo); break;
            case 'do_statement': this.emitDoWhileStatement(node, funcInfo); break;
            case 'return_statement': this.emitReturnStatement(node, funcInfo); break;
            case 'compound_statement': this.emitCompoundStatement(node, funcInfo); break;
            case 'break_statement': this.emitBreakStatement(funcInfo); break;
            case 'continue_statement': this.emitContinueStatement(funcInfo); break;
            case 'declaration': this.emitDeclarationInit(node, funcInfo); break;
            case 'switch_statement': this.emitSwitchStatement(node, funcInfo); break;
        }
    }

    private emitExpressionStatement(node: Parser.SyntaxNode, funcInfo: Fn) {
        const expr = node.child(0);
        if (expr) {
            this.emitExpression(expr, funcInfo);
        }
    }

    private emitIfStatement(node: Parser.SyntaxNode, funcInfo: Fn) {
        const condition = node.childForFieldName('condition');
        const consequence = node.childForFieldName('consequence');
        const alternative = node.childForFieldName('alternative');

        const elseLabel = this.newLabel(funcInfo);
        const endLabel = this.newLabel(funcInfo);

        if (condition) this.emitCondition(condition, funcInfo, elseLabel, false);
        if (consequence) this.emitStatement(consequence, funcInfo);

        if (alternative) {
            this.asmLines.push(`JP ${endLabel}`);
            this.emitLabel(elseLabel);
            if (alternative.type === 'else_clause') {
                const elseBody = this.extractElseBody(alternative);
                if (elseBody) this.emitStatement(elseBody, funcInfo);
            } else {
                this.emitStatement(alternative, funcInfo);
            }
            this.emitLabel(endLabel);
        } else {
            this.emitLabel(elseLabel);
        }
    }

    private extractElseBody(elseClause: Parser.SyntaxNode): Parser.SyntaxNode | null {
        for (let i = 0; i < elseClause.childCount; i++) {
            const child = elseClause.child(i);
            if (child && child.type !== 'else') return child;
        }
        return null;
    }

    private emitWhileStatement(node: Parser.SyntaxNode, funcInfo: Fn) {
        const condition = node.childForFieldName('condition');
        const body = node.childForFieldName('body');

        const loopLabel = this.newLabel(funcInfo);
        const endLabel = this.newLabel(funcInfo);

        const prevBreak = funcInfo.breakLabel;
        const prevContinue = funcInfo.continueLabel;
        funcInfo.breakLabel = endLabel;
        funcInfo.continueLabel = loopLabel;

        this.emitLabel(loopLabel);
        if (condition) this.emitCondition(condition, funcInfo, endLabel, false);
        if (body) this.emitStatement(body, funcInfo);
        this.asmLines.push(`JP ${loopLabel}`);
        this.emitLabel(endLabel);

        funcInfo.breakLabel = prevBreak;
        funcInfo.continueLabel = prevContinue;
    }

    private emitDoWhileStatement(node: Parser.SyntaxNode, funcInfo: Fn) {
        const body = node.childForFieldName('body');
        const condition = node.childForFieldName('condition');

        const loopLabel = this.newLabel(funcInfo);
        const condLabel = this.newLabel(funcInfo);
        const endLabel = this.newLabel(funcInfo);

        const prevBreak = funcInfo.breakLabel;
        const prevContinue = funcInfo.continueLabel;
        funcInfo.breakLabel = endLabel;
        funcInfo.continueLabel = condLabel;

        this.emitLabel(loopLabel);
        if (body) this.emitStatement(body, funcInfo);
        this.emitLabel(condLabel);
        if (condition) this.emitCondition(condition, funcInfo, loopLabel, true);
        this.emitLabel(endLabel);

        funcInfo.breakLabel = prevBreak;
        funcInfo.continueLabel = prevContinue;
    }

    private emitSwitchStatement(node: Parser.SyntaxNode, funcInfo: Fn) {
        const condition = node.childForFieldName('condition');
        const body = node.childForFieldName('body');
        if (!condition || !body) return;

        const endLabel = this.newLabel(funcInfo);
        const prevBreak = funcInfo.breakLabel;
        funcInfo.breakLabel = endLabel;

        const caseStatements: Parser.SyntaxNode[] = [];
        for (let i = 0; i < body.childCount; i++) {
            const child = body.child(i);
            if (child && child.type === 'case_statement') {
                caseStatements.push(child);
            }
        }

        const caseLabels: string[] = [];
        let defaultLabel: string | null = null;

        for (let i = 0; i < caseStatements.length; i++) {
            const label = this.newLabel(funcInfo);
            caseLabels.push(label);
            const caseNode = caseStatements[i];
            const firstChild = caseNode.child(0);
            if (firstChild && firstChild.type === 'default') {
                defaultLabel = label;
            }
        }

        this.emitLoadAccumulator(condition, funcInfo);
        const t = this.allocTemp();
        this.emitLdAToTemp(t);

        for (let i = 0; i < caseStatements.length; i++) {
            const caseNode = caseStatements[i];
            for (let j = 0; j < caseNode.childCount; j++) {
                const child = caseNode.child(j);
                if (!child) continue;
                if (child.type === 'case') {
                    const valueNode = caseNode.child(j + 1);
                    if (!valueNode) continue;
                    const constVal = this.getConstantValue(valueNode);
                    if (constVal === null) continue;
                    this.emitLdTempToA(t);
                    this.asmLines.push(`HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    this.asmLines.push('SZB STATUS,2');
                    this.asmLines.push(`JP ${caseLabels[i]}`);
                }
            }
        }

        if (defaultLabel) {
            this.asmLines.push(`JP ${defaultLabel}`);
        } else {
            this.asmLines.push(`JP ${endLabel}`);
        }

        for (let i = 0; i < caseStatements.length; i++) {
            const caseNode = caseStatements[i];
            this.emitLabel(caseLabels[i]);
            for (let j = 0; j < caseNode.childCount; j++) {
                const child = caseNode.child(j);
                if (child && child.type !== 'case' && child.type !== 'default' && child.type !== ':' && child.type !== 'number_literal' && child.type !== 'char_literal' && child.type !== 'identifier') {
                    if (child.type === 'expression_statement' || child.type === 'break_statement' || child.type === 'continue_statement' || child.type === 'declaration' || child.type === 'compound_statement' || child.type === 'if_statement' || child.type === 'while_statement' || child.type === 'for_statement' || child.type === 'do_statement' || child.type === 'return_statement' || child.type === 'switch_statement') {
                        this.emitStatement(child, funcInfo);
                    }
                }
            }
        }

        this.emitLabel(endLabel);
        funcInfo.breakLabel = prevBreak;
    }

    private emitForStatement(node: Parser.SyntaxNode, funcInfo: Fn) {
        const initializer = node.childForFieldName('initializer');
        const condition = node.childForFieldName('condition');
        const update = node.childForFieldName('update');
        const body = node.childForFieldName('body');

        const loopLabel = this.newLabel(funcInfo);
        const updateLabel = this.newLabel(funcInfo);
        const endLabel = this.newLabel(funcInfo);

        const prevBreak = funcInfo.breakLabel;
        const prevContinue = funcInfo.continueLabel;
        funcInfo.breakLabel = endLabel;
        funcInfo.continueLabel = updateLabel;

        if (initializer) {
            if (initializer.type === 'declaration') {
                this.emitDeclarationInit(initializer, funcInfo);
            } else {
                this.emitExpression(initializer, funcInfo);
            }
        }

        this.emitLabel(loopLabel);
        if (condition) this.emitCondition(condition, funcInfo, endLabel, false);
        if (body) this.emitStatement(body, funcInfo);
        this.emitLabel(updateLabel);
        if (update) this.emitExpression(update, funcInfo);
        this.asmLines.push(`JP ${loopLabel}`);
        this.emitLabel(endLabel);

        funcInfo.breakLabel = prevBreak;
        funcInfo.continueLabel = prevContinue;
    }

    private emitDeclarationInit(node: Parser.SyntaxNode, funcInfo: Fn) {
        let isStaticDecl = false;
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && child.type === 'storage_class_specifier' && child.text.trim() === 'static') {
                isStaticDecl = true;
                break;
            }
        }

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child || !child.isNamed) continue;
            if (child.type === 'sized_type_specifier' || child.type === 'primitive_type' || child.type === 'storage_class_specifier') continue;

            const initDecl = this.findNodeByType(child, 'init_declarator');
            const actualNode = initDecl || child;
            const valueNode = actualNode.childForFieldName ? actualNode.childForFieldName('value') : null;

            const declNode = initDecl ? initDecl.childForFieldName('declarator') : child;
            let sym: Sym | null = null;
            if (declNode) {
                if (declNode.type === 'array_declarator') {
                    const idNode = declNode.childForFieldName('declarator');
                    if (idNode) sym = this.resolveSymbol(idNode, funcInfo);
                } else if (declNode.type === 'pointer_declarator') {
                    for (let i = 0; i < declNode.childCount; i++) {
                        const child = declNode.child(i);
                        if (child && child.type === 'identifier') {
                            sym = this.resolveSymbol(child, funcInfo);
                            break;
                        }
                        if (child && child.type === 'array_declarator') {
                            const idNode = child.childForFieldName('declarator');
                            if (idNode) sym = this.resolveSymbol(idNode, funcInfo);
                            break;
                        }
                    }
                } else {
                    sym = this.resolveSymbol(declNode, funcInfo);
                }
            }

            if (isStaticDecl && sym && sym.isStatic) continue;

            if (valueNode) {
                if (sym && sym.isArray && valueNode.type === 'initializer_list') {
                    let elemIdx = 0;
                    for (let j = 0; j < valueNode.childCount; j++) {
                        const initChild = valueNode.child(j);
                        if (!initChild || initChild.type === ',' || initChild.type === '{' || initChild.type === '}') continue;
                        const constVal = this.getConstantValue(initChild);
                        if (constVal !== null) {
                            this.asmLines.push(`LDIA 0x${(constVal & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                        } else {
                            this.emitLoadAccumulator(initChild, funcInfo);
                        }
                        this.emitLdAToArrayElem(sym, elemIdx);
                        elemIdx++;
                    }
                } else {
                    this.emitLoadAccumulator(valueNode, funcInfo);
                    if (sym) this.emitLdAToSym(sym);
                }
            }
        }
    }

    private emitReturnStatement(node: Parser.SyntaxNode, funcInfo: Fn) {
        let value: Parser.SyntaxNode | null = node.childForFieldName('value');
        if (!value) {
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child && child.type !== 'return' && child.type !== ';') {
                    value = child;
                    break;
                }
            }
        }
        if (value && funcInfo.returnType === 'void') {
            throw new Error(`Function '${funcInfo.name}' is void and should not return a value`);
        }
        if (value && funcInfo.isISR) {
            throw new Error(`ISR function '${funcInfo.name}' should not return a value`);
        }
        if (value) this.emitLoadAccumulator(value, funcInfo);
        if (funcInfo.name === 'main') {
            this.asmLines.push('STOP');
        } else if (funcInfo.isISR) {
            this.asmLines.push('LD A,ISR_PCLATH');
            this.asmLines.push('LD PCLATH,A');
            this.asmLines.push('LD A,ISR_FSR');
            this.asmLines.push('LD FSR,A');
            this.asmLines.push('SWAPA ISR_STATUS');
            this.asmLines.push('LD STATUS,A');
            this.asmLines.push('SWAPR ISR_ACC');
            this.asmLines.push('SWAPA ISR_ACC');
            this.asmLines.push('RETI');
        } else {
            this.ensureBank0();
            this.asmLines.push('RET');
            funcInfo.hasEarlyReturn = true;
        }
    }

    private emitBreakStatement(funcInfo: Fn) {
        if (funcInfo.breakLabel) this.asmLines.push(`JP ${funcInfo.breakLabel}`);
    }

    private emitContinueStatement(funcInfo: Fn) {
        if (funcInfo.continueLabel) this.asmLines.push(`JP ${funcInfo.continueLabel}`);
    }

    private emitCondition(node: Parser.SyntaxNode, funcInfo: Fn, targetLabel: string, jumpOnTrue: boolean) {
        const inner = this.unwrapParentheses(node);

        if (inner.type === 'binary_expression') {
            const operator = this.getChildByField(inner, 'operator');
            if (operator && ['==', '!=', '<', '>', '<=', '>='].includes(operator.text)) {
                this.emitComparison(inner, funcInfo, targetLabel, jumpOnTrue);
                return;
            }
            if (operator && (operator.text === '&&' || operator.text === '||')) {
                this.emitLogicalOp(inner, funcInfo, targetLabel, jumpOnTrue);
                return;
            }
        }

        if (inner.type === 'unary_expression') {
            const opNode = this.getChildByField(inner, 'operator');
            if (opNode && opNode.text === '!') {
                const operand = inner.childForFieldName('argument');
                if (operand) {
                    this.emitCondition(operand, funcInfo, targetLabel, !jumpOnTrue);
                    return;
                }
            }
        }

        this.emitLoadAccumulator(inner, funcInfo);
        if (jumpOnTrue) {
            this.asmLines.push('HSUBIA 0x00');
            this.asmLines.push('SNZB STATUS,2');
            this.asmLines.push(`JP ${targetLabel}`);
        } else {
            this.asmLines.push('HSUBIA 0x00');
            this.asmLines.push('SZB STATUS,2');
            this.asmLines.push(`JP ${targetLabel}`);
        }
    }

    private inferExprType(node: Parser.SyntaxNode, funcInfo: Fn): Type {
        const inner = this.unwrapParentheses(node);
        if (inner.type === 'identifier') {
            const sym = this.resolveSymbol(inner, funcInfo);
            if (sym) return sym.type;
        }
        if (inner.type === 'number_literal') {
            const val = this.parseNumber(inner.text);
            if (val < 0) return 'i8';
            return 'u8';
        }
        if (inner.type === 'unary_expression') {
            const opNode = this.getChildByField(inner, 'operator');
            if (opNode && opNode.text === '-') return 'i8';
            const arg = inner.childForFieldName('argument');
            if (arg) return this.inferExprType(arg, funcInfo);
        }
        if (inner.type === 'binary_expression') {
            const left = inner.childForFieldName('left');
            const right = inner.childForFieldName('right');
            if (left && right) {
                const lt = this.inferExprType(left, funcInfo);
                const rt = this.inferExprType(right, funcInfo);
                if (lt === 'i8' || rt === 'i8') return 'i8';
            }
        }
        if (inner.type === 'subscript_expression') {
            const sym = this.resolveArraySymbol(inner, funcInfo);
            if (sym) return sym.type;
        }
        if (inner.type === 'call_expression') {
            const funcNode = inner.childForFieldName('function');
            if (funcNode) {
                const name = funcNode.text.trim();
                if (this.fns.has(name)) return this.fns.get(name)!.returnType;
            }
        }
        if (inner.type === 'cast_expression') {
            const typeNode = this.findNodeByType(inner, 'primitive_type');
            if (typeNode) return this.resolveType(typeNode);
        }
        if (inner.type === 'update_expression') {
            const arg = inner.childForFieldName('argument');
            if (arg) return this.inferExprType(arg, funcInfo);
        }
        if (inner.type === 'assignment_expression') {
            const left = inner.childForFieldName('left');
            if (left) return this.inferExprType(left, funcInfo);
        }
        if (inner.type === 'conditional_expression') {
            const consequent = inner.childForFieldName('consequence');
            if (consequent) return this.inferExprType(consequent, funcInfo);
        }
        return 'u8';
    }

    private emitComparison(node: Parser.SyntaxNode, funcInfo: Fn, targetLabel: string, jumpOnTrue: boolean) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const operator = this.getChildByField(node, 'operator');
        if (!left || !right || !operator) return;
        this.emitComparisonGeneric(left, right, operator.text, funcInfo, targetLabel, jumpOnTrue);
    }

    private emitComparisonGeneric(left: Parser.SyntaxNode, right: Parser.SyntaxNode, op: string, funcInfo: Fn, targetLabel: string, jumpOnTrue: boolean) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);
        const isSigned = this.inferExprType(left, funcInfo) === 'i8' || this.inferExprType(right, funcInfo) === 'i8';

        if (isSigned && ['<', '>', '<=', '>='].includes(op)) {
            this.emitSignedComparison(left, right, op, funcInfo, targetLabel, jumpOnTrue);
            return;
        }

        if (rightConst !== null) {
            this.emitLoadAccumulator(left, funcInfo);
            this.asmLines.push(`HSUBIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`);
        } else if (leftConst !== null) {
            const reversedOp: Record<string, string> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=', '==': '==', '!=': '!=' };
            this.emitLoadAccumulator(right, funcInfo);
            this.asmLines.push(`HSUBIA 0x${leftConst.toString(16).toUpperCase().padStart(2, '0')}`);
            this.emitComparisonFlags(reversedOp[op], funcInfo, targetLabel, jumpOnTrue);
            return;
        } else {
            const lsym = this.resolveSymbol(left, funcInfo);
            const rsym = this.resolveSymbol(right, funcInfo);
            if (lsym && rsym) {
                this.emitLdSymToA(rsym);
                this.emitOpSym('SUBA', lsym);
            } else if (rsym) {
                this.emitLoadAccumulator(left, funcInfo);
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                this.emitLdSymToA(rsym);
                this.emitOpTemp('SUBA', t);
            } else if (lsym) {
                this.emitLoadAccumulator(right, funcInfo);
                this.emitOpSym('SUBA', lsym);
            } else {
                this.emitLoadAccumulator(left, funcInfo);
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                this.emitLoadAccumulator(right, funcInfo);
                this.emitOpTemp('SUBA', t);
            }
        }

        this.emitComparisonFlags(op, funcInfo, targetLabel, jumpOnTrue);
    }

    private emitSignedComparison(left: Parser.SyntaxNode, right: Parser.SyntaxNode, op: string, funcInfo: Fn, targetLabel: string, jumpOnTrue: boolean) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);

        if (rightConst !== null) {
            this.emitLoadAccumulator(left, funcInfo);
            this.asmLines.push('XORIA 0x80');
            this.asmLines.push(`HSUBIA 0x${((rightConst ^ 0x80) & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
        } else if (leftConst !== null) {
            const reversedOp: Record<string, string> = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };
            this.emitLoadAccumulator(right, funcInfo);
            this.asmLines.push('XORIA 0x80');
            this.asmLines.push(`HSUBIA 0x${((leftConst ^ 0x80) & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
            this.emitComparisonFlags(reversedOp[op], funcInfo, targetLabel, jumpOnTrue);
            return;
        } else {
            this.emitLoadAccumulator(right, funcInfo);
            this.asmLines.push('XORIA 0x80');
            const t = this.allocTemp();
            this.emitLdAToTemp(t);
            this.emitLoadAccumulator(left, funcInfo);
            this.asmLines.push('XORIA 0x80');
            this.emitOpTemp('HSUBA', t);
        }

        this.emitComparisonFlags(op, funcInfo, targetLabel, jumpOnTrue);
    }

    private emitComparisonFlags(op: string, funcInfo: Fn, targetLabel: string, jumpOnTrue: boolean) {
        if (op === '<') {
            if (jumpOnTrue) { this.asmLines.push('SNZB STATUS,0'); this.asmLines.push(`JP ${targetLabel}`); }
            else { this.asmLines.push('SZB STATUS,0'); this.asmLines.push(`JP ${targetLabel}`); }
        } else if (op === '>') {
            if (jumpOnTrue) {
                const cont = this.newLabel(funcInfo);
                this.asmLines.push('SNZB STATUS,0');
                this.asmLines.push(`JP ${cont}`);
                this.asmLines.push('SZB STATUS,2');
                this.asmLines.push(`JP ${cont}`);
                this.asmLines.push(`JP ${targetLabel}`);
                this.emitLabel(cont);
            } else {
                this.asmLines.push('SNZB STATUS,0');
                this.asmLines.push(`JP ${targetLabel}`);
                this.asmLines.push('SZB STATUS,2');
                this.asmLines.push(`JP ${targetLabel}`);
            }
        } else if (op === '<=') {
            if (jumpOnTrue) {
                this.asmLines.push('SNZB STATUS,0');
                this.asmLines.push(`JP ${targetLabel}`);
                this.asmLines.push('SZB STATUS,2');
                this.asmLines.push(`JP ${targetLabel}`);
            } else {
                const cont = this.newLabel(funcInfo);
                this.asmLines.push('SNZB STATUS,0');
                this.asmLines.push(`JP ${cont}`);
                this.asmLines.push('SZB STATUS,2');
                this.asmLines.push(`JP ${cont}`);
                this.asmLines.push(`JP ${targetLabel}`);
                this.emitLabel(cont);
            }
        } else if (op === '>=') {
            if (jumpOnTrue) { this.asmLines.push('SZB STATUS,0'); this.asmLines.push(`JP ${targetLabel}`); }
            else { this.asmLines.push('SNZB STATUS,0'); this.asmLines.push(`JP ${targetLabel}`); }
        } else if (op === '==') {
            if (jumpOnTrue) { this.asmLines.push('SZB STATUS,2'); this.asmLines.push(`JP ${targetLabel}`); }
            else { this.asmLines.push('SNZB STATUS,2'); this.asmLines.push(`JP ${targetLabel}`); }
        } else if (op === '!=') {
            if (jumpOnTrue) { this.asmLines.push('SNZB STATUS,2'); this.asmLines.push(`JP ${targetLabel}`); }
            else { this.asmLines.push('SZB STATUS,2'); this.asmLines.push(`JP ${targetLabel}`); }
        }
    }

    private emitLogicalOp(node: Parser.SyntaxNode, funcInfo: Fn, targetLabel: string, jumpOnTrue: boolean) {
        const operator = this.getChildByField(node, 'operator');
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!operator || !left || !right) return;

        if (operator.text === '&&') {
            if (jumpOnTrue) {
                const fail = this.newLabel(funcInfo);
                this.emitCondition(left, funcInfo, fail, false);
                this.emitCondition(right, funcInfo, targetLabel, true);
                this.emitLabel(fail);
            } else {
                this.emitCondition(left, funcInfo, targetLabel, false);
                this.emitCondition(right, funcInfo, targetLabel, false);
            }
        } else {
            if (jumpOnTrue) {
                this.emitCondition(left, funcInfo, targetLabel, true);
                this.emitCondition(right, funcInfo, targetLabel, true);
            } else {
                const pass = this.newLabel(funcInfo);
                this.emitCondition(left, funcInfo, pass, true);
                this.emitCondition(right, funcInfo, targetLabel, false);
                this.emitLabel(pass);
            }
        }
    }

    private emitExpression(node: Parser.SyntaxNode, funcInfo: Fn): void {
        const inner = this.unwrapParentheses(node);

        switch (inner.type) {
            case 'assignment_expression': this.emitAssignment(inner, funcInfo); break;
            case 'call_expression': this.emitCallExpression(inner, funcInfo); break;
            case 'update_expression': this.emitUpdateExpression(inner, funcInfo); break;
            default: this.emitLoadAccumulator(inner, funcInfo); break;
        }
    }

    private emitAssignment(node: Parser.SyntaxNode, funcInfo: Fn) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const operator = this.getChildByField(node, 'operator');
        if (!left || !right || !operator) return;

        const op = operator.text;
        const innerLeft = this.unwrapParentheses(left);

        if (op === '=') {
            if (innerLeft.type === 'subscript_expression') {
                this.emitArrayStore(innerLeft, right, funcInfo);
            } else if (innerLeft.type === 'pointer_expression') {
                const addr = this.extractAddr(innerLeft);
                if (addr !== null) {
                    this.emitLoadAccumulator(right, funcInfo);
                    const equAddr = addr & 0x7F;
                    this.ensureBank(addr);
                    this.asmLines.push(`LD 0x${equAddr.toString(16).toUpperCase().padStart(2, '0')},A`);
                } else {
                    const opNode = innerLeft.child(0);
                    const argNode = innerLeft.child(1);
                    if (opNode && opNode.text === '*' && argNode) {
                        this.emitLoadAccumulator(right, funcInfo);
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(argNode, funcInfo);
                        this.emitIndirectSetFSR();
                        this.emitLdTempToA(t);
                        this.asmLines.push('LD INDF,A');
                    }
                }
            } else if (innerLeft.type === 'unary_expression') {
                const opNode = this.getChildByField(innerLeft, 'operator');
                const argNode = innerLeft.childForFieldName('argument');
                if (opNode && opNode.text === '*' && argNode) {
                    this.emitLoadAccumulator(right, funcInfo);
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.emitLoadAccumulator(argNode, funcInfo);
                    this.emitIndirectSetFSR();
                    this.emitLdTempToA(t);
                    this.asmLines.push('LD INDF,A');
                } else {
                    this.emitLoadAccumulator(right, funcInfo);
                    const sym = this.resolveSymbol(left, funcInfo);
                    if (sym) this.emitLdAToSym(sym);
                }
            } else {
                this.emitLoadAccumulator(right, funcInfo);
                const sym = this.resolveSymbol(left, funcInfo);
                if (sym) this.emitLdAToSym(sym);
            }
            return;
        }

        if (innerLeft.type === 'subscript_expression') {
            this.emitArrayCompoundAssign(innerLeft, right, funcInfo, op);
            return;
        }

        if (innerLeft.type === 'pointer_expression') {
            this.emitPointerCompoundAssign(innerLeft, right, funcInfo, op);
            return;
        }

        if (innerLeft.type === 'unary_expression') {
            const uOp = this.getChildByField(innerLeft, 'operator');
            const uArg = innerLeft.childForFieldName('argument');
            if (uOp && uOp.text === '*' && uArg) {
                this.emitPointerCompoundAssignUnary(uArg, right, funcInfo, op);
                return;
            }
        }

        const sym = this.resolveSymbol(left, funcInfo);
        if (!sym) return;

        if (['+=', '-=', '&=', '|=', '^='].includes(op)) {
            this.emitLoadAccumulator(left, funcInfo);
            const constVal = this.getConstantValue(right);
            switch (op) {
                case '+=':
                    if (constVal !== null) this.asmLines.push(`ADDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ADDA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ADDA', t); } }
                    break;
                case '-=':
                    if (constVal !== null) this.asmLines.push(`HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else {
                        const rsym = this.resolveSymbol(right, funcInfo);
                        if (rsym) { this.emitOpSym('HSUBA', rsym); }
                        else {
                            this.emitLoadAccumulator(right, funcInfo);
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(left, funcInfo);
                            this.emitOpTemp('HSUBA', t);
                        }
                    }
                    break;
                case '&=':
                    if (constVal !== null) this.asmLines.push(`ANDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ANDA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ANDA', t); } }
                    break;
                case '|=':
                    if (constVal !== null) this.asmLines.push(`ORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ORA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ORA', t); } }
                    break;
                case '^=':
                    if (constVal !== null) this.asmLines.push(`XORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('XORA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('XORA', t); } }
                    break;
            }
            this.emitLdAToSym(sym);
        } else if (op === '<<=' || op === '>>=') {
            this.emitShiftAssign(sym, left, right, funcInfo, op === '>>=');
        } else if (op === '*=' || op === '/=' || op === '%=') {
            this.emitArithAssign(sym, left, right, funcInfo, op);
        }
    }

    private emitArrayStore(arrayNode: Parser.SyntaxNode, valueNode: Parser.SyntaxNode, funcInfo: Fn) {
        const arraySym = this.resolveArraySymbol(arrayNode, funcInfo);
        let indexNode: Parser.SyntaxNode | null = arrayNode.childForFieldName('index');
        if (!indexNode) {
            for (let i = 0; i < arrayNode.childCount; i++) {
                const c = arrayNode.child(i);
                if (c && c.type !== 'identifier' && c.type !== '[' && c.type !== ']') {
                    indexNode = c;
                    break;
                }
            }
        }
        if (!arraySym || !indexNode) return;

        const constIndex = this.getConstantValue(indexNode);
        if (constIndex !== null) {
            this.emitLoadAccumulator(valueNode, funcInfo);
            this.emitLdAToArrayElem(arraySym, constIndex);
            return;
        }

        const t = this.allocTemp();
        this.emitLoadAccumulator(valueNode, funcInfo);
        this.emitLdAToTemp(t);
        this.emitLoadAccumulator(indexNode, funcInfo);
        const t2 = this.allocTemp();
        this.emitLdAToTemp(t2);
        if (arraySym.isArray) {
            this.asmLines.push(`LDIA 0x${(arraySym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
            this.emitOpTemp('ADDA', t2);
        } else {
            this.emitLdSymToA(arraySym);
            this.emitOpTemp('ADDA', t2);
        }
        this.asmLines.push('CLRB STATUS,5');
        this.currentAsmBank = 0;
        this.asmLines.push('LD FSR,A');
        this.emitLdTempToA(t);
        this.asmLines.push('LD INDF,A');
    }

    private emitPointerCompoundAssign(left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn, op: string) {
        const opNode = left.child(0);
        const argNode = left.child(1);
        if (!opNode || !argNode || opNode.text !== '*') return;

        if (['+=', '-=', '&=', '|=', '^='].includes(op)) {
            this.emitLoadAccumulator(left, funcInfo);
            const constVal = this.getConstantValue(right);
            switch (op) {
                case '+=':
                    if (constVal !== null) this.asmLines.push(`ADDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ADDA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ADDA', t); } }
                    break;
                case '-=':
                    if (constVal !== null) this.asmLines.push(`HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('HSUBA', rsym); else { this.emitLoadAccumulator(right, funcInfo); const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(left, funcInfo); this.emitOpTemp('HSUBA', t); } }
                    break;
                case '&=':
                    if (constVal !== null) this.asmLines.push(`ANDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ANDA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ANDA', t); } }
                    break;
                case '|=':
                    if (constVal !== null) this.asmLines.push(`ORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ORA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ORA', t); } }
                    break;
                case '^=':
                    if (constVal !== null) this.asmLines.push(`XORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('XORA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('XORA', t); } }
                    break;
            }
            const t = this.allocTemp();
            this.emitLdAToTemp(t);
            this.emitLoadAccumulator(argNode, funcInfo);
            this.emitIndirectSetFSR();
            this.emitLdTempToA(t);
            this.asmLines.push('LD INDF,A');
        } else if (op === '<<=' || op === '>>=') {
            const t0 = this.allocTemp();
            this.emitLoadAccumulator(left, funcInfo);
            this.emitLdAToTemp(t0);
            const shiftRight = op === '>>=';
            const shiftConst = this.getConstantValue(right);
            if (shiftConst !== null && shiftConst > 0) {
                for (let i = 0; i < shiftConst; i++) {
                    if (shiftRight) {
                        this.asmLines.push('CLRB STATUS,0');
                        this.emitOpTemp('RRCA', t0);
                    } else {
                        this.emitLdTempToA(t0);
                        this.emitOpTemp('ADDA', t0);
                    }
                    this.emitLdAToTemp(t0);
                }
            } else if (shiftConst === null) {
                const t1 = this.allocTemp();
                this.emitLoadAccumulator(right, funcInfo);
                this.emitLdAToTemp(t1);
                const loopLabel = this.newLabel(funcInfo);
                const doneLabel = this.newLabel(funcInfo);
                this.emitLdTempToA(t1);
                this.asmLines.push('HSUBIA 0x00');
                this.asmLines.push('SZB STATUS,2');
                this.asmLines.push(`JP ${doneLabel}`);
                this.emitLabel(loopLabel);
                if (shiftRight) {
                    this.asmLines.push('CLRB STATUS,0');
                    this.emitOpTemp('RRCA', t0);
                } else {
                    this.emitLdTempToA(t0);
                    this.emitOpTemp('ADDA', t0);
                }
                this.emitLdAToTemp(t0);
                this.emitLdTempToA(t1);
                this.asmLines.push('HSUBIA 0x01');
                this.emitLdAToTemp(t1);
                this.emitLdTempToA(t1);
                this.asmLines.push('HSUBIA 0x00');
                this.asmLines.push('SNZB STATUS,2');
                this.asmLines.push(`JP ${loopLabel}`);
                this.emitLabel(doneLabel);
            }
            this.emitLoadAccumulator(argNode, funcInfo);
            this.emitIndirectSetFSR();
            this.emitLdTempToA(t0);
            this.asmLines.push('LD INDF,A');
        } else if (op === '*=' || op === '/=' || op === '%=') {
            this.emitLoadAccumulator(left, funcInfo);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            if (op === '*=') {
                this.emitMultiply(left, right, funcInfo);
            } else if (op === '/=') {
                this.emitDivide(left, right, funcInfo);
            } else {
                this.emitModulo(left, right, funcInfo);
            }
            const tResult = this.allocTemp();
            this.emitLdAToTemp(tResult);
            this.emitLoadAccumulator(argNode, funcInfo);
            this.emitIndirectSetFSR();
            this.emitLdTempToA(tResult);
            this.asmLines.push('LD INDF,A');
        }
    }

    private emitPointerCompoundAssignUnary(argNode: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn, op: string) {
        if (['+=', '-=', '&=', '|=', '^='].includes(op)) {
            this.emitLoadAccumulator(argNode, funcInfo);
            this.emitIndirectSetFSR();
            this.asmLines.push('LD A,INDF');
            const constVal = this.getConstantValue(right);
            switch (op) {
                case '+=':
                    if (constVal !== null) this.asmLines.push(`ADDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ADDA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ADDA', t); } }
                    break;
                case '-=':
                    if (constVal !== null) this.asmLines.push(`HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('HSUBA', rsym); else { this.emitLoadAccumulator(right, funcInfo); const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(argNode, funcInfo); this.emitIndirectSetFSR(); this.asmLines.push('LD A,INDF'); this.emitOpTemp('HSUBA', t); } }
                    break;
                case '&=':
                    if (constVal !== null) this.asmLines.push(`ANDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ANDA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ANDA', t); } }
                    break;
                case '|=':
                    if (constVal !== null) this.asmLines.push(`ORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ORA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ORA', t); } }
                    break;
                case '^=':
                    if (constVal !== null) this.asmLines.push(`XORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('XORA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('XORA', t); } }
                    break;
            }
            this.asmLines.push('LD INDF,A');
        }
    }

    private emitArrayCompoundAssign(left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn, op: string) {
        const arraySym = this.resolveArraySymbol(left, funcInfo);
        let indexNode: Parser.SyntaxNode | null = left.childForFieldName('index');
        if (!indexNode) {
            for (let i = 0; i < left.childCount; i++) {
                const c = left.child(i);
                if (c && c.type !== 'identifier' && c.type !== '[' && c.type !== ']') {
                    indexNode = c;
                    break;
                }
            }
        }
        if (!arraySym || !indexNode) return;

        const constIndex = this.getConstantValue(indexNode);
        const constVal = this.getConstantValue(right);
        const isSigned = arraySym.type === 'i8';

        if (['+=', '-=', '&=', '|=', '^='].includes(op)) {
            if (constIndex !== null) {
                this.emitLdArrayElemToA(arraySym, constIndex);
            } else {
                this.emitArrayLoad(left, funcInfo);
            }
            switch (op) {
                case '+=':
                    if (constVal !== null) this.asmLines.push(`ADDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ADDA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ADDA', t); } }
                    break;
                case '-=':
                    if (constVal !== null) this.asmLines.push(`HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('HSUBA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('SUBA', t); } }
                    break;
                case '&=':
                    if (constVal !== null) this.asmLines.push(`ANDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ANDA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ANDA', t); } }
                    break;
                case '|=':
                    if (constVal !== null) this.asmLines.push(`ORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('ORA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('ORA', t); } }
                    break;
                case '^=':
                    if (constVal !== null) this.asmLines.push(`XORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else { const rsym = this.resolveSymbol(right, funcInfo); if (rsym) this.emitOpSym('XORA', rsym); else { const t = this.allocTemp(); this.emitLdAToTemp(t); this.emitLoadAccumulator(right, funcInfo); this.emitOpTemp('XORA', t); } }
                    break;
            }
            if (constIndex !== null) {
                this.emitLdAToArrayElem(arraySym, constIndex);
            } else {
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                this.emitLoadAccumulator(indexNode, funcInfo);
                const t2 = this.allocTemp();
                this.emitLdAToTemp(t2);
                this.asmLines.push(`LDIA 0x${(arraySym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                this.emitOpTemp('ADDA', t2);
                this.asmLines.push('CLRB STATUS,5');
                this.currentAsmBank = 0;
                this.asmLines.push('LD FSR,A');
                this.emitLdTempToA(t);
                this.asmLines.push('LD INDF,A');
            }
        } else if (op === '<<=' || op === '>>=') {
            if (constIndex !== null) {
                this.emitLdArrayElemToA(arraySym, constIndex);
                const shiftRight = op === '>>=';
                const shiftConst = this.getConstantValue(right);
                if (shiftConst !== null) {
                    const t0 = this.allocTemp();
                    this.emitLdAToTemp(t0);
                    if (shiftRight && isSigned && shiftConst > 0) {
                        const negLabel = this.newLabel(funcInfo);
                        const posLabel = this.newLabel(funcInfo);
                        const endLabel = this.newLabel(funcInfo);
                        this.emitTestBitTemp('SNZB', t0, 7);
                        this.asmLines.push(`JP ${posLabel}`);
                        this.emitLabel(negLabel);
                        for (let s = 0; s < shiftConst; s++) {
                            this.asmLines.push('SETB STATUS,0');
                            this.emitOpTemp('RRCA', t0);
                            this.emitLdAToTemp(t0);
                        }
                        this.asmLines.push(`JP ${endLabel}`);
                        this.emitLabel(posLabel);
                        for (let s = 0; s < shiftConst; s++) {
                            this.asmLines.push('CLRB STATUS,0');
                            this.emitOpTemp('RRCA', t0);
                            this.emitLdAToTemp(t0);
                        }
                        this.emitLabel(endLabel);
                    } else if (shiftRight) {
                        for (let s = 0; s < shiftConst; s++) {
                            this.asmLines.push('CLRB STATUS,0');
                            this.emitOpTemp('RRCA', t0);
                            this.emitLdAToTemp(t0);
                        }
                    } else {
                        for (let s = 0; s < shiftConst; s++) {
                            this.emitLdTempToA(t0);
                            this.emitOpTemp('ADDA', t0);
                            this.emitLdAToTemp(t0);
                        }
                    }
                    this.emitLdTempToA(t0);
                } else {
                    const t0 = this.allocTemp();
                    this.emitLdAToTemp(t0);
                    this.emitLoadAccumulator(right, funcInfo);
                    const t1 = this.allocTemp();
                    this.emitLdAToTemp(t1);
                    const loopLabel = this.newLabel(funcInfo);
                    const doneLabel = this.newLabel(funcInfo);
                    this.emitLdTempToA(t1);
                    this.asmLines.push('HSUBIA 0x00');
                    this.asmLines.push('SZB STATUS,2');
                    this.asmLines.push(`JP ${doneLabel}`);
                    this.emitLabel(loopLabel);
                    if (shiftRight) {
                        if (isSigned) {
                            this.emitTestBitTemp('SZB', t0, 7);
                            this.asmLines.push('SETB STATUS,0');
                            this.emitTestBitTemp('SNZB', t0, 7);
                            this.asmLines.push('CLRB STATUS,0');
                        } else {
                            this.asmLines.push('CLRB STATUS,0');
                        }
                        this.emitOpTemp('RRCA', t0);
                        this.emitLdAToTemp(t0);
                    } else {
                        this.emitLdTempToA(t0);
                        this.emitOpTemp('ADDA', t0);
                        this.emitLdAToTemp(t0);
                    }
                    this.emitLdTempToA(t1);
                    this.asmLines.push('HSUBIA 0x01');
                    this.emitLdAToTemp(t1);
                    this.emitLdTempToA(t1);
                    this.asmLines.push('HSUBIA 0x00');
                    this.asmLines.push('SNZB STATUS,2');
                    this.asmLines.push(`JP ${loopLabel}`);
                    this.emitLabel(doneLabel);
                    this.emitLdTempToA(t0);
                }
                this.emitLdAToArrayElem(arraySym, constIndex);
            } else {
                this.emitArrayLoad(left, funcInfo);
                const t0 = this.allocTemp();
                this.emitLdAToTemp(t0);
                this.emitLoadAccumulator(right, funcInfo);
                const t1 = this.allocTemp();
                this.emitLdAToTemp(t1);
                const shiftRight = op === '>>=';
                const loopLabel = this.newLabel(funcInfo);
                const doneLabel = this.newLabel(funcInfo);
                this.emitLdTempToA(t1);
                this.asmLines.push('HSUBIA 0x00');
                this.asmLines.push('SZB STATUS,2');
                this.asmLines.push(`JP ${doneLabel}`);
                this.emitLabel(loopLabel);
                if (shiftRight) {
                    if (isSigned) {
                        this.emitTestBitTemp('SZB', t0, 7);
                        this.asmLines.push('SETB STATUS,0');
                        this.emitTestBitTemp('SNZB', t0, 7);
                        this.asmLines.push('CLRB STATUS,0');
                    } else {
                        this.asmLines.push('CLRB STATUS,0');
                    }
                    this.emitOpTemp('RRCA', t0);
                    this.emitLdAToTemp(t0);
                } else {
                    this.emitLdTempToA(t0);
                    this.emitOpTemp('ADDA', t0);
                    this.emitLdAToTemp(t0);
                }
                this.emitLdTempToA(t1);
                this.asmLines.push('HSUBIA 0x01');
                this.emitLdAToTemp(t1);
                this.emitLdTempToA(t1);
                this.asmLines.push('HSUBIA 0x00');
                this.asmLines.push('SNZB STATUS,2');
                this.asmLines.push(`JP ${loopLabel}`);
                this.emitLabel(doneLabel);
                this.emitLdTempToA(t0);
                const t3 = this.allocTemp();
                this.emitLdAToTemp(t3);
                this.emitLoadAccumulator(indexNode, funcInfo);
                const t4 = this.allocTemp();
                this.emitLdAToTemp(t4);
                this.asmLines.push(`LDIA 0x${(arraySym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                this.emitOpTemp('ADDA', t4);
                this.asmLines.push('CLRB STATUS,5');
                this.currentAsmBank = 0;
                this.asmLines.push('LD FSR,A');
                this.emitLdTempToA(t3);
                this.asmLines.push('LD INDF,A');
            }
        } else if (op === '*=' || op === '/=' || op === '%=') {
            if (isSigned && (op === '/=' || op === '%=')) {
                if (op === '/=') this.emitSignedDivide(left, right, funcInfo);
                else this.emitSignedModulo(left, right, funcInfo);
            } else {
                if (constIndex !== null) {
                    this.emitLdArrayElemToA(arraySym, constIndex);
                } else {
                    this.emitArrayLoad(left, funcInfo);
                }
                const t0 = this.allocTemp();
                this.emitLdAToTemp(t0);
                this.emitLoadAccumulator(right, funcInfo);
                const t1 = this.allocTemp();
                this.emitLdAToTemp(t1);

                if (op === '*=') {
                    this.asmLines.push('CLRA');
                    const t2 = this.allocTemp();
                    this.emitLdAToTemp(t2);
                    const loop = this.newLabel(funcInfo);
                    const done = this.newLabel(funcInfo);
                    this.emitLabel(loop);
                    this.emitLdTempToA(t0);
                    this.asmLines.push('HSUBIA 0x00');
                    this.asmLines.push('SZB STATUS,2');
                    this.asmLines.push(`JP ${done}`);
                    this.emitLdTempToA(t2);
                    this.emitOpTemp('ADDA', t1);
                    this.emitLdAToTemp(t2);
                    this.emitLdTempToA(t0);
                    this.asmLines.push('HSUBIA 0x01');
                    this.emitLdAToTemp(t0);
                    this.asmLines.push(`JP ${loop}`);
                    this.emitLabel(done);
                    this.emitLdTempToA(t2);
                } else if (op === '/=') {
                    this.asmLines.push('CLRA');
                    const t2 = this.allocTemp();
                    this.emitLdAToTemp(t2);
                    const skipLabel = this.newLabel(funcInfo);
                    const loop = this.newLabel(funcInfo);
                    const done = this.newLabel(funcInfo);
                    this.emitLdTempToA(t1);
                    this.asmLines.push('HSUBIA 0x00');
                    this.asmLines.push('SZB STATUS,2');
                    this.asmLines.push(`JP ${skipLabel}`);
                    this.emitLabel(loop);
                    this.emitLdTempToA(t1);
                    this.emitOpTemp('SUBA', t0);
                    this.asmLines.push('SNZB STATUS,0');
                    this.asmLines.push(`JP ${done}`);
                    this.emitLdAToTemp(t0);
                    this.emitLdTempToA(t2);
                    this.asmLines.push('ADDIA 0x01');
                    this.emitLdAToTemp(t2);
                    this.asmLines.push(`JP ${loop}`);
                    this.emitLabel(done);
                    this.emitLabel(skipLabel);
                    this.emitLdTempToA(t2);
                } else {
                    const skipLabel = this.newLabel(funcInfo);
                    const loop = this.newLabel(funcInfo);
                    const done = this.newLabel(funcInfo);
                    this.emitLdTempToA(t1);
                    this.asmLines.push('HSUBIA 0x00');
                    this.asmLines.push('SZB STATUS,2');
                    this.asmLines.push(`JP ${skipLabel}`);
                    this.emitLabel(loop);
                    this.emitLdTempToA(t1);
                    this.emitOpTemp('SUBA', t0);
                    this.asmLines.push('SNZB STATUS,0');
                    this.asmLines.push(`JP ${done}`);
                    this.emitLdAToTemp(t0);
                    this.asmLines.push(`JP ${loop}`);
                    this.emitLabel(done);
                    this.emitLabel(skipLabel);
                    this.emitLdTempToA(t0);
                }

                if (constIndex !== null) {
                    this.emitLdAToArrayElem(arraySym, constIndex);
                } else {
                    const t3 = this.allocTemp();
                    this.emitLdAToTemp(t3);
                    this.emitLoadAccumulator(indexNode, funcInfo);
                    const t4 = this.allocTemp();
                    this.emitLdAToTemp(t4);
                    this.asmLines.push(`LDIA 0x${(arraySym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                    this.emitOpTemp('ADDA', t4);
                    this.asmLines.push('CLRB STATUS,5');
                    this.currentAsmBank = 0;
                    this.asmLines.push('LD FSR,A');
                    this.emitLdTempToA(t3);
                    this.asmLines.push('LD INDF,A');
                }
            }
            if (isSigned && (op === '/=' || op === '%=')) {
                if (constIndex !== null) {
                    this.emitLdAToArrayElem(arraySym, constIndex);
                } else {
                    const t3 = this.allocTemp();
                    this.emitLdAToTemp(t3);
                    this.emitLoadAccumulator(indexNode, funcInfo);
                    const t4 = this.allocTemp();
                    this.emitLdAToTemp(t4);
                    this.asmLines.push(`LDIA 0x${(arraySym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                    this.emitOpTemp('ADDA', t4);
                    this.asmLines.push('CLRB STATUS,5');
                    this.currentAsmBank = 0;
                    this.asmLines.push('LD FSR,A');
                    this.emitLdTempToA(t3);
                    this.asmLines.push('LD INDF,A');
                }
            }
        }
    }

    private emitCallExpression(node: Parser.SyntaxNode, funcInfo: Fn, usedAsValue: boolean = false) {
        const funcNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');
        if (!funcNode) return;

        const funcName = funcNode.text.trim();
        const targetFunc = this.fns.get(funcName);

        if (!targetFunc) {
            throw new Error(`Function '${funcName}' is not defined`);
        }

        if (targetFunc.returnType === 'void' && usedAsValue) {
            throw new Error(`Function '${funcName}' returns void and cannot be used as a value`);
        }

        if (argsNode && targetFunc) {
            const args: Parser.SyntaxNode[] = [];
            for (let i = 0; i < argsNode.childCount; i++) {
                const child = argsNode.child(i);
                if (child && child.type !== ',' && child.type !== '(' && child.type !== ')') args.push(child);
            }
            if (args.length < targetFunc.params.length) {
                throw new Error(`Function '${funcName}' expects ${targetFunc.params.length} argument(s), but ${args.length} provided`);
            }
            if (args.length > targetFunc.params.length) {
                throw new Error(`Function '${funcName}' expects ${targetFunc.params.length} argument(s), but ${args.length} provided`);
            }
            const temps: number[] = [];
            for (let i = 0; i < args.length && i < targetFunc.params.length; i++) {
                this.emitLoadAccumulator(args[i], funcInfo);
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                temps.push(t);
            }
            for (let i = 0; i < temps.length && i < targetFunc.params.length; i++) {
                const paramSym = targetFunc.localSymbols.get(targetFunc.params[i].name);
                if (paramSym) {
                    this.emitLdTempToA(temps[i]);
                    this.emitLdAToSym(paramSym);
                }
            }
        }

        if (targetFunc) funcInfo.calls.add(funcName);

        this.asmLines.push(`CALL ${toAsmName(funcName)}`);
        this.invalidateBankState();
    }

    private emitUpdateExpression(node: Parser.SyntaxNode, funcInfo: Fn) {
        const operator = this.getChildByField(node, 'operator');
        let argument = node.childForFieldName('argument');
        if (!operator || !argument) return;

        const isPrefix = operator.startPosition.column < argument.startPosition.column;

        const unwrappedArg = this.unwrapParentheses(argument);

        if (unwrappedArg.type === 'pointer_expression') {
            const opNode = unwrappedArg.child(0);
            const argNode = unwrappedArg.child(1);
            if (opNode && opNode.text === '*' && argNode) {
                const ptrSym = this.resolveSymbol(argNode, funcInfo);
                if (!ptrSym) return;

                const isParenWrapped = argument.type === 'parenthesized_expression';
                const isDerefValue = isParenWrapped || isPrefix;

                if (isDerefValue) {
                    if (operator.text === '++') {
                        if (isPrefix) {
                            this.emitLdSymToA(ptrSym);
                            this.emitIndirectSetFSR();
                            this.asmLines.push('LD A,INDF');
                            this.asmLines.push('ADDIA 0x01');
                            this.asmLines.push('LD INDF,A');
                        } else {
                            this.emitLdSymToA(ptrSym);
                            this.emitIndirectSetFSR();
                            this.asmLines.push('LD A,INDF');
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.asmLines.push('ADDIA 0x01');
                            this.asmLines.push('LD INDF,A');
                            this.emitLdTempToA(t);
                        }
                    } else if (operator.text === '--') {
                        if (isPrefix) {
                            this.emitLdSymToA(ptrSym);
                            this.emitIndirectSetFSR();
                            this.asmLines.push('LD A,INDF');
                            this.asmLines.push('HSUBIA 0x01');
                            this.asmLines.push('LD INDF,A');
                        } else {
                            this.emitLdSymToA(ptrSym);
                            this.emitIndirectSetFSR();
                            this.asmLines.push('LD A,INDF');
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.asmLines.push('HSUBIA 0x01');
                            this.asmLines.push('LD INDF,A');
                            this.emitLdTempToA(t);
                        }
                    }
                    return;
                }

                if (operator.text === '++') {
                    this.emitLdSymToA(ptrSym);
                    this.emitIndirectRead();
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.emitLdSymToA(ptrSym);
                    this.asmLines.push('ADDIA 0x01');
                    this.emitLdAToSym(ptrSym);
                    this.emitLdTempToA(t);
                } else if (operator.text === '--') {
                    this.emitLdSymToA(ptrSym);
                    this.emitIndirectRead();
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.emitLdSymToA(ptrSym);
                    this.asmLines.push('HSUBIA 0x01');
                    this.emitLdAToSym(ptrSym);
                    this.emitLdTempToA(t);
                }
                return;
            }
        }

        if (argument.type === 'subscript_expression') {
            const arraySym = this.resolveArraySymbol(argument, funcInfo);
            let indexNode: Parser.SyntaxNode | null = argument.childForFieldName('index');
            if (!indexNode) {
                for (let i = 0; i < argument.childCount; i++) {
                    const c = argument.child(i);
                    if (c && c.type !== 'identifier' && c.type !== '[' && c.type !== ']') {
                        indexNode = c;
                        break;
                    }
                }
            }
            if (!arraySym || !indexNode) return;

            const constIndex = this.getConstantValue(indexNode);

            if (operator.text === '++') {
                if (constIndex !== null) {
                    if (isPrefix) {
                        this.emitLdArrayElemToA(arraySym, constIndex);
                        this.asmLines.push('ADDIA 0x01');
                        this.emitLdAToArrayElem(arraySym, constIndex);
                    } else {
                        this.emitLdArrayElemToA(arraySym, constIndex);
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.asmLines.push('ADDIA 0x01');
                        this.emitLdAToArrayElem(arraySym, constIndex);
                        this.emitLdTempToA(t);
                    }
                } else {
                    this.emitArrayLoad(argument, funcInfo);
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.asmLines.push('ADDIA 0x01');
                    const t2 = this.allocTemp();
                    this.emitLdAToTemp(t2);
                    this.emitLoadAccumulator(indexNode, funcInfo);
                    const t3 = this.allocTemp();
                    this.emitLdAToTemp(t3);
                    this.asmLines.push(`LDIA 0x${(arraySym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                    this.emitOpTemp('ADDA', t3);
                    this.asmLines.push('CLRB STATUS,5');
                    this.currentAsmBank = 0;
                    this.asmLines.push('LD FSR,A');
                    this.emitLdTempToA(t2);
                    this.asmLines.push('LD INDF,A');
                    if (!isPrefix) {
                        this.emitLdTempToA(t);
                    }
                }
            } else if (operator.text === '--') {
                if (constIndex !== null) {
                    if (isPrefix) {
                        this.emitLdArrayElemToA(arraySym, constIndex);
                        this.asmLines.push('HSUBIA 0x01');
                        this.emitLdAToArrayElem(arraySym, constIndex);
                    } else {
                        this.emitLdArrayElemToA(arraySym, constIndex);
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.asmLines.push('HSUBIA 0x01');
                        this.emitLdAToArrayElem(arraySym, constIndex);
                        this.emitLdTempToA(t);
                    }
                } else {
                    this.emitArrayLoad(argument, funcInfo);
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.asmLines.push('HSUBIA 0x01');
                    const t2 = this.allocTemp();
                    this.emitLdAToTemp(t2);
                    this.emitLoadAccumulator(indexNode, funcInfo);
                    const t3 = this.allocTemp();
                    this.emitLdAToTemp(t3);
                    this.asmLines.push(`LDIA 0x${(arraySym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                    this.emitOpTemp('ADDA', t3);
                    this.asmLines.push('CLRB STATUS,5');
                    this.currentAsmBank = 0;
                    this.asmLines.push('LD FSR,A');
                    this.emitLdTempToA(t2);
                    this.asmLines.push('LD INDF,A');
                    if (!isPrefix) {
                        this.emitLdTempToA(t);
                    }
                }
            }
            return;
        }

        const sym = this.resolveSymbol(argument, funcInfo);
        if (!sym) return;

        if (operator.text === '++') {
            if (isPrefix) {
                // 前递增：先递增，再返回新值
                this.emitLdSymToA(sym);
                this.asmLines.push('ADDIA 0x01');
                this.emitLdAToSym(sym);
            } else {
                // 后递增：先返回原值，再递增
                this.emitLdSymToA(sym);
                const t = this.allocTemp();
                this.emitLdAToTemp(t);        // 保存原值
                this.asmLines.push('ADDIA 0x01');
                this.emitLdAToSym(sym);       // 存回递增后的值
                this.emitLdTempToA(t);        // 返回原值
            }
        } else if (operator.text === '--') {
            if (isPrefix) {
                // 前递减：先递减，再返回新值
                this.emitLdSymToA(sym);
                this.asmLines.push('HSUBIA 0x01');
                this.emitLdAToSym(sym);
            } else {
                // 后递减：先返回原值，再递减
                this.emitLdSymToA(sym);
                const t = this.allocTemp();
                this.emitLdAToTemp(t);        // 保存原值
                this.asmLines.push('HSUBIA 0x01');
                this.emitLdAToSym(sym);       // 存回递减后的值
                this.emitLdTempToA(t);        // 返回原值
            }
        }
    }

    private emitConditionalExpression(node: Parser.SyntaxNode, funcInfo: Fn) {
        const condition = node.childForFieldName('condition');
        const consequence = node.childForFieldName('consequence');
        const alternative = node.childForFieldName('alternative');
        if (!condition || !consequence || !alternative) return;

        const elseLabel = this.newLabel(funcInfo);
        const endLabel = this.newLabel(funcInfo);

        this.emitCondition(condition, funcInfo, elseLabel, false);
        this.emitLoadAccumulator(consequence, funcInfo);
        this.asmLines.push(`JP ${endLabel}`);
        this.emitLabel(elseLabel);
        this.emitLoadAccumulator(alternative, funcInfo);
        this.emitLabel(endLabel);
    }

    private emitAssignmentAsValue(node: Parser.SyntaxNode, funcInfo: Fn) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const operator = this.getChildByField(node, 'operator');
        if (!left || !right || !operator) return;

        const op = operator.text;
        const innerLeft = this.unwrapParentheses(left);
        if (op === '=') {
            if (innerLeft.type === 'subscript_expression') {
                this.emitArrayStore(innerLeft, right, funcInfo);
                this.emitArrayLoad(innerLeft, funcInfo);
            } else if (innerLeft.type === 'pointer_expression') {
                const opNode = innerLeft.child(0);
                const argNode = innerLeft.child(1);
                if (opNode && opNode.text === '*' && argNode) {
                    this.emitLoadAccumulator(right, funcInfo);
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.emitLoadAccumulator(argNode, funcInfo);
                    this.emitIndirectSetFSR();
                    this.emitLdTempToA(t);
                    this.asmLines.push('LD INDF,A');
                }
            } else if (innerLeft.type === 'unary_expression') {
                const uOp = this.getChildByField(innerLeft, 'operator');
                const uArg = innerLeft.childForFieldName('argument');
                if (uOp && uOp.text === '*' && uArg) {
                    this.emitLoadAccumulator(right, funcInfo);
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.emitLoadAccumulator(uArg, funcInfo);
                    this.emitIndirectSetFSR();
                    this.emitLdTempToA(t);
                    this.asmLines.push('LD INDF,A');
                }
            } else {
                this.emitLoadAccumulator(right, funcInfo);
                const sym = this.resolveSymbol(left, funcInfo);
                if (sym) this.emitLdAToSym(sym);
            }
        } else {
            if (innerLeft.type === 'subscript_expression') {
                this.emitArrayCompoundAssign(innerLeft, right, funcInfo, op);
                this.emitArrayLoad(innerLeft, funcInfo);
            } else if (innerLeft.type === 'pointer_expression' || innerLeft.type === 'unary_expression') {
                this.emitAssignment(node, funcInfo);
                this.emitLoadAccumulator(innerLeft, funcInfo);
            } else {
                this.emitAssignment(node, funcInfo);
                const sym = this.resolveSymbol(left, funcInfo);
                if (sym) this.emitLdSymToA(sym);
            }
        }
    }

    private emitCommaExpression(node: Parser.SyntaxNode, funcInfo: Fn) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!left || !right) return;

        this.emitExpression(left, funcInfo);
        this.emitLoadAccumulator(right, funcInfo);
    }

    private emitLoadAccumulator(node: Parser.SyntaxNode, funcInfo: Fn) {
        const inner = this.unwrapParentheses(node);

        if (inner.type === 'number_literal') {
            const val = this.parseNumber(inner.text);
            this.asmLines.push(`LDIA 0x${(val & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
            return;
        }

        if (inner.type === 'char_literal') {
            const text = inner.text;
            const val = text.length >= 3 ? text.charCodeAt(1) : 0;
            this.asmLines.push(`LDIA 0x${(val & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
            return;
        }

        if (inner.type === 'identifier') {
            const sym = this.resolveSymbol(inner, funcInfo);
            if (sym) {
                if (sym.isArray) {
                    this.asmLines.push(`LDIA 0x${(sym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                } else {
                    this.emitLdSymToA(sym);
                }
            } else {
                const name = inner.text.trim();
                if (!this.fns.has(name)) {
                    throw new Error(`Variable '${name}' is not defined`);
                }
            }
            return;
        }

        if (inner.type === 'subscript_expression') {
            this.emitArrayLoad(inner, funcInfo);
            return;
        }

        if (inner.type === 'binary_expression') {
            this.emitBinaryExpression(inner, funcInfo);
            return;
        }

        if (inner.type === 'unary_expression') {
            this.emitUnaryExpression(inner, funcInfo);
            return;
        }

        if (inner.type === 'call_expression') {
            this.emitCallExpression(inner, funcInfo, true);
            return;
        }

        if (inner.type === 'cast_expression') {
            const value = inner.childForFieldName('value');
            if (value) this.emitLoadAccumulator(value, funcInfo);
            return;
        }

        if (inner.type === 'sizeof_expression') {
            let sizeofArg = inner.child(1);
            if (sizeofArg) {
                sizeofArg = this.unwrapParentheses(sizeofArg);
                const sym = this.resolveSymbol(sizeofArg, funcInfo);
                if (sym && sym.isArray) {
                    this.asmLines.push(`LDIA 0x${sym.arraySize.toString(16).toUpperCase().padStart(2, '0')}`);
                    return;
                }
            }
            this.asmLines.push('LDIA 0x01');
            return;
        }

        if (inner.type === 'true') {
            this.asmLines.push('LDIA 0x01');
            return;
        }

        if (inner.type === 'false') {
            this.asmLines.push('LDIA 0x00');
            return;
        }

        if (inner.type === 'update_expression') {
            this.emitUpdateExpression(inner, funcInfo);
            return;
        }

        if (inner.type === 'conditional_expression') {
            this.emitConditionalExpression(inner, funcInfo);
            return;
        }

        if (inner.type === 'comma_expression') {
            this.emitCommaExpression(inner, funcInfo);
            return;
        }

        if (inner.type === 'assignment_expression') {
            this.emitAssignmentAsValue(inner, funcInfo);
            return;
        }

        if (inner.type === 'pointer_expression') {
            const addr = this.extractAddr(inner);
            if (addr !== null) {
                // 常量地址解引用：*(u8 *)0xXX，读取该地址的内容
                const equAddr = addr & 0x7F;
                this.ensureBank(addr);
                this.asmLines.push(`LD A,0x${equAddr.toString(16).toUpperCase().padStart(2, '0')}`);
                return;
            }
            const opNode = inner.child(0);
            const argNode = inner.child(1);
            if (opNode && argNode) {
                if (opNode.text === '&') {
                    // 处理 &x, &arr[0] 等取地址操作
                    if (argNode.type === 'identifier') {
                        const sym = this.resolveSymbol(argNode, funcInfo);
                        if (sym) {
                            this.asmLines.push(`LDIA 0x${(sym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                        }
                        return;
                    } else if (argNode.type === 'subscript_expression') {
                        // 处理 &arr[index]
                        const arraySym = this.resolveArraySymbol(argNode, funcInfo);
                        if (!arraySym) return;

                        const indexNode = argNode.childForFieldName('index');
                        if (!indexNode) return;

                        const constIndex = this.getConstantValue(indexNode);
                        if (constIndex !== null) {
                            // &arr[constant]
                            const addr = (arraySym.ramAddr + constIndex) & 0xFF;
                            this.asmLines.push(`LDIA 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`);
                        } else {
                            // &arr[variable]
                            this.emitLoadAccumulator(indexNode, funcInfo);
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.asmLines.push(`LDIA 0x${(arraySym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
                            this.emitOpTemp('ADDA', t);
                        }
                        return;
                    }
                    return;
                }
                if (opNode.text === '*') {
                    // 处理 *ptr++、*++ptr、*ptr--、*--ptr
                    if (argNode.type === 'update_expression') {
                        const updateOp = this.getChildByField(argNode, 'operator');
                        const updateArg = argNode.childForFieldName('argument');
                        if (updateOp && updateArg) {
                            const ptrSym = this.resolveSymbol(updateArg, funcInfo);
                            if (!ptrSym) {
                                this.emitLoadAccumulator(argNode, funcInfo);
                                this.emitIndirectRead();
                                return;
                            }

                            if (updateOp.text === '++') {
                                const isPrefix = updateOp.startPosition.column < updateArg.startPosition.column;
                                if (isPrefix) {
                                    this.emitLdSymToA(ptrSym);
                                    this.asmLines.push('ADDIA 0x01');
                                    this.emitLdAToSym(ptrSym);
                                    this.emitIndirectRead();
                                } else {
                                    this.emitLdSymToA(ptrSym);
                                    this.emitIndirectRead();
                                    const t = this.allocTemp();
                                    this.emitLdAToTemp(t);
                                    this.emitLdSymToA(ptrSym);
                                    this.asmLines.push('ADDIA 0x01');
                                    this.emitLdAToSym(ptrSym);
                                    this.emitLdTempToA(t);
                                }
                                return;
                            } else if (updateOp.text === '--') {
                                const isPrefix = updateOp.startPosition.column < updateArg.startPosition.column;
                                if (isPrefix) {
                                    this.emitLdSymToA(ptrSym);
                                    this.asmLines.push('HSUBIA 0x01');
                                    this.emitLdAToSym(ptrSym);
                                    this.emitIndirectRead();
                                } else {
                                    this.emitLdSymToA(ptrSym);
                                    this.emitIndirectRead();
                                    const t = this.allocTemp();
                                    this.emitLdAToTemp(t);
                                    this.emitLdSymToA(ptrSym);
                                    this.asmLines.push('HSUBIA 0x01');
                                    this.emitLdAToSym(ptrSym);
                                    this.emitLdTempToA(t);
                                }
                                return;
                            }
                        }
                    }
                    // 普通的 *ptr 解引用
                    this.emitLoadAccumulator(argNode, funcInfo);

                    // 检查是否是常量地址（如 (u8 *)0x06）
                    const addr = this.extractAddr(argNode);
                    if (addr !== null && addr >= 0x00 && addr <= 0x1F) {
                        // SFR地址：使用直接寻址
                        const equAddr = addr & 0x7F;
                        this.ensureBank(addr);
                        this.asmLines.push(`LD A,0x${equAddr.toString(16).toUpperCase().padStart(2, '0')}`);
                    } else {
                        this.emitIndirectRead();
                    }
                    return;
                }
            }
        }

        // 处理类型转换表达式：(u8 *)0xXX，加载地址值本身
        if (inner.type === 'cast_expression') {
            const valueNode = inner.childForFieldName('value');
            if (valueNode && valueNode.type === 'number_literal') {
                const addr = this.parseNumber(valueNode.text) & 0xFF;
                this.asmLines.push(`LDIA 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`);
                return;
            }
        }
    }

    private emitBinaryExpression(node: Parser.SyntaxNode, funcInfo: Fn) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const operator = this.getChildByField(node, 'operator');
        if (!left || !right || !operator) return;

        const op = operator.text;
        const rightConst = this.getConstantValue(right);

        switch (op) {
            case '+':
                this.emitLoadAccumulator(left, funcInfo);
                if (rightConst !== null) {
                    this.asmLines.push(`ADDIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`);
                } else {
                    const rsym = this.resolveSymbol(right, funcInfo);
                    if (rsym) {
                        this.emitOpSym('ADDA', rsym);
                    } else {
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(right, funcInfo);
                        this.emitOpTemp('ADDA', t);
                    }
                }
                break;
            case '-':
                if (rightConst !== null) {
                    this.emitLoadAccumulator(left, funcInfo);
                    this.asmLines.push(`HSUBIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`);
                } else {
                    const lsym = this.resolveSymbol(left, funcInfo);
                    const rsym = this.resolveSymbol(right, funcInfo);
                    if (lsym && rsym) {
                        this.emitLdSymToA(rsym);
                        this.emitOpSym('SUBA', lsym);
                    } else if (rsym) {
                        this.emitLoadAccumulator(left, funcInfo);
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLdSymToA(rsym);
                        this.emitOpTemp('SUBA', t);
                    } else if (lsym) {
                        this.emitLoadAccumulator(right, funcInfo);
                        this.emitOpSym('SUBA', lsym);
                    } else {
                        this.emitLoadAccumulator(left, funcInfo);
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(right, funcInfo);
                        this.emitOpTemp('SUBA', t);
                    }
                }
                break;
            case '&':
                this.emitLoadAccumulator(left, funcInfo);
                if (rightConst !== null) {
                    this.asmLines.push(`ANDIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`);
                } else {
                    const rsym = this.resolveSymbol(right, funcInfo);
                    if (rsym) {
                        this.emitOpSym('ANDA', rsym);
                    } else {
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(right, funcInfo);
                        this.emitOpTemp('ANDA', t);
                    }
                }
                break;
            case '|':
                this.emitLoadAccumulator(left, funcInfo);
                if (rightConst !== null) {
                    this.asmLines.push(`ORIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`);
                } else {
                    const rsym = this.resolveSymbol(right, funcInfo);
                    if (rsym) {
                        this.emitOpSym('ORA', rsym);
                    } else {
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(right, funcInfo);
                        this.emitOpTemp('ORA', t);
                    }
                }
                break;
            case '^':
                this.emitLoadAccumulator(left, funcInfo);
                if (rightConst !== null) {
                    this.asmLines.push(`XORIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`);
                } else {
                    const rsym = this.resolveSymbol(right, funcInfo);
                    if (rsym) {
                        this.emitOpSym('XORA', rsym);
                    } else {
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(right, funcInfo);
                        this.emitOpTemp('XORA', t);
                    }
                }
                break;
            case '*': this.emitMultiply(left, right, funcInfo); break;
            case '/': {
                const isSigned = this.inferExprType(left, funcInfo) === 'i8' || this.inferExprType(right, funcInfo) === 'i8';
                if (isSigned) this.emitSignedDivide(left, right, funcInfo);
                else this.emitDivide(left, right, funcInfo);
                break;
            }
            case '%': {
                const isSigned = this.inferExprType(left, funcInfo) === 'i8' || this.inferExprType(right, funcInfo) === 'i8';
                if (isSigned) this.emitSignedModulo(left, right, funcInfo);
                else this.emitModulo(left, right, funcInfo);
                break;
            }
            case '<<': this.emitShiftLeft(left, right, funcInfo); break;
            case '>>': {
                const isSigned = this.inferExprType(left, funcInfo) === 'i8';
                this.emitShiftRight(left, right, funcInfo, isSigned);
                break;
            }
            case '&&':
            case '||':
                this.emitLogicalBinary(node, funcInfo);
                break;
            case '==': case '!=': case '<': case '>': case '<=': case '>=':
                this.emitComparisonResult(node, funcInfo);
                break;
        }
    }

    private emitLogicalBinary(node: Parser.SyntaxNode, funcInfo: Fn) {
        const operator = this.getChildByField(node, 'operator');
        if (!operator) return;

        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!left || !right) return;

        const setOne = this.newLabel(funcInfo);
        const setZero = this.newLabel(funcInfo);
        const done = this.newLabel(funcInfo);

        if (operator.text === '&&') {
            this.emitCondition(left, funcInfo, setZero, false);
            this.emitCondition(right, funcInfo, setZero, false);
            this.asmLines.push('LDIA 0x01');
            this.asmLines.push(`JP ${done}`);
            this.emitLabel(setZero);
            this.asmLines.push('LDIA 0x00');
            this.asmLines.push(`JP ${done}`);
        } else {
            this.emitCondition(left, funcInfo, setOne, true);
            this.emitCondition(right, funcInfo, setOne, true);
            this.asmLines.push('LDIA 0x00');
            this.asmLines.push(`JP ${done}`);
            this.emitLabel(setOne);
            this.asmLines.push('LDIA 0x01');
        }
        this.emitLabel(done);
    }

    private emitComparisonResult(node: Parser.SyntaxNode, funcInfo: Fn) {
        const setOne = this.newLabel(funcInfo);
        const done = this.newLabel(funcInfo);
        this.emitComparison(node, funcInfo, setOne, true);
        this.asmLines.push('LDIA 0x00');
        this.asmLines.push(`JP ${done}`);
        this.emitLabel(setOne);
        this.asmLines.push('LDIA 0x01');
        this.emitLabel(done);
    }

    private emitUnaryExpression(node: Parser.SyntaxNode, funcInfo: Fn) {
        const operator = this.getChildByField(node, 'operator');
        const argument = node.childForFieldName('argument');
        if (!operator || !argument) return;

        const op = operator.text;

        if (op === '-') {
            this.emitLoadAccumulator(argument, funcInfo);
            this.asmLines.push('XORIA 0xFF');
            this.asmLines.push('ADDIA 0x01');
            return;
        }

        if (op === '~') {
            this.emitLoadAccumulator(argument, funcInfo);
            this.asmLines.push('XORIA 0xFF');
            return;
        }

        if (op === '!') {
            this.emitLoadAccumulator(argument, funcInfo);
            this.asmLines.push('HSUBIA 0x00');
            const setOne = this.newLabel(funcInfo);
            const done = this.newLabel(funcInfo);
            this.asmLines.push('SZB STATUS,2');
            this.asmLines.push(`JP ${setOne}`);
            this.asmLines.push('LDIA 0x00');
            this.asmLines.push(`JP ${done}`);
            this.emitLabel(setOne);
            this.asmLines.push('LDIA 0x01');
            this.emitLabel(done);
            return;
        }

        if (op === '&') {
            const sym = this.resolveSymbol(argument, funcInfo);
            if (sym) {
                this.asmLines.push(`LDIA 0x${(sym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
            }
            return;
        }

        if (op === '*') {
            this.emitLoadAccumulator(argument, funcInfo);
            this.emitIndirectRead();
            return;
        }

        this.emitLoadAccumulator(argument, funcInfo);
    }

    private emitArrayLoad(node: Parser.SyntaxNode, funcInfo: Fn) {
        const arraySym = this.resolveArraySymbol(node, funcInfo);
        let indexNode: Parser.SyntaxNode | null = node.childForFieldName('index');
        if (!indexNode) {
            for (let i = 0; i < node.childCount; i++) {
                const c = node.child(i);
                if (c && c.type !== 'identifier' && c.type !== '[' && c.type !== ']') {
                    indexNode = c;
                    break;
                }
            }
        }
        if (!arraySym || !indexNode) return;

        const constIndex = this.getConstantValue(indexNode);
        if (constIndex !== null) {
            this.emitLdArrayElemToA(arraySym, constIndex);
            return;
        }

        const t = this.allocTemp();
        this.emitLoadAccumulator(indexNode, funcInfo);
        this.emitLdAToTemp(t);
        if (arraySym.isArray) {
            this.asmLines.push(`LDIA 0x${(arraySym.ramAddr & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`);
            this.emitOpTemp('ADDA', t);
        } else {
            this.emitLdSymToA(arraySym);
            this.emitOpTemp('ADDA', t);
        }
        this.emitIndirectRead();
    }

    private emitMultiply(left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);

        if (rightConst === 0 || leftConst === 0) {
            this.asmLines.push('LDIA 0x00');
            return;
        }

        if (rightConst === 1) {
            this.emitLoadAccumulator(left, funcInfo);
            return;
        }
        if (leftConst === 1) {
            this.emitLoadAccumulator(right, funcInfo);
            return;
        }

        if (rightConst === 2 || leftConst === 2) {
            const src = rightConst === 2 ? left : right;
            this.emitLoadAccumulator(src, funcInfo);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            this.emitLdTempToA(t0);
            this.emitOpTemp('ADDA', t0);
            return;
        }

        this.emitLoadAccumulator(left, funcInfo);
        const t0 = this.allocTemp();
        this.emitLdAToTemp(t0);
        this.emitLoadAccumulator(right, funcInfo);
        const t1 = this.allocTemp();
        this.emitLdAToTemp(t1);
        this.asmLines.push('CLRA');
        const t2 = this.allocTemp();
        this.emitLdAToTemp(t2);

        const loop = this.newLabel(funcInfo);
        const done = this.newLabel(funcInfo);
        this.emitLabel(loop);
        this.emitLdTempToA(t0);
        this.asmLines.push('HSUBIA 0x00');
        this.asmLines.push('SZB STATUS,2');
        this.asmLines.push(`JP ${done}`);
        this.emitLdTempToA(t2);
        this.emitOpTemp('ADDA', t1);
        this.emitLdAToTemp(t2);
        this.emitLdTempToA(t0);
        this.asmLines.push('HSUBIA 0x01');
        this.emitLdAToTemp(t0);
        this.asmLines.push(`JP ${loop}`);
        this.emitLabel(done);
        this.emitLdTempToA(t2);
    }

    private emitDivide(left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);
        if (rightConst !== null && rightConst === 0) {
            throw new Error('Division by zero');
        }
        if (leftConst === 0) {
            this.asmLines.push('LDIA 0x00');
            return;
        }
        if (rightConst === 2) {
            this.emitLoadAccumulator(left, funcInfo);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            this.asmLines.push('CLRB STATUS,0');
            this.emitOpTemp('RRCA', t0);
            return;
        }
        if (rightConst !== null && rightConst === 1) {
            this.emitLoadAccumulator(left, funcInfo);
            return;
        }

        this.emitLoadAccumulator(left, funcInfo);
        const t0 = this.allocTemp();
        this.emitLdAToTemp(t0);
        this.emitLoadAccumulator(right, funcInfo);
        const t1 = this.allocTemp();
        this.emitLdAToTemp(t1);
        this.asmLines.push('CLRA');
        const t2 = this.allocTemp();
        this.emitLdAToTemp(t2);

        const skipLabel = this.newLabel(funcInfo);
        const zeroLabel = this.newLabel(funcInfo);
        const endLabel = this.newLabel(funcInfo);
        const loop = this.newLabel(funcInfo);
        const done = this.newLabel(funcInfo);
        this.emitLdTempToA(t1);
        this.asmLines.push('HSUBIA 0x00');
        this.asmLines.push('SZB STATUS,2');
        this.asmLines.push(`JP ${skipLabel}`);
        this.emitLdTempToA(t0);
        this.asmLines.push('HSUBIA 0x00');
        this.asmLines.push('SZB STATUS,2');
        this.asmLines.push(`JP ${zeroLabel}`);
        this.emitLabel(loop);
        this.emitLdTempToA(t1);
        this.emitOpTemp('SUBA', t0);
        this.asmLines.push('SNZB STATUS,0');
        this.asmLines.push(`JP ${done}`);
        this.emitLdAToTemp(t0);
        this.emitLdTempToA(t2);
        this.asmLines.push('ADDIA 0x01');
        this.emitLdAToTemp(t2);
        this.asmLines.push(`JP ${loop}`);
        this.emitLabel(done);
        this.emitLdTempToA(t2);
        this.asmLines.push(`JP ${endLabel}`);
        this.emitLabel(skipLabel);
        this.emitLdTempToA(t2);
        this.asmLines.push(`JP ${endLabel}`);
        this.emitLabel(zeroLabel);
        this.asmLines.push('LDIA 0x00');
        this.emitLabel(endLabel);
    }

    private emitModulo(left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);
        if (rightConst !== null && rightConst === 0) {
            throw new Error('Division by zero (modulo)');
        }
        if (rightConst === 1) {
            this.asmLines.push('LDIA 0x00');
            return;
        }
        if (leftConst === 0) {
            this.asmLines.push('LDIA 0x00');
            return;
        }

        this.emitLoadAccumulator(left, funcInfo);
        const t0 = this.allocTemp();
        this.emitLdAToTemp(t0);
        this.emitLoadAccumulator(right, funcInfo);
        const t1 = this.allocTemp();
        this.emitLdAToTemp(t1);

        const skipLabel = this.newLabel(funcInfo);
        const loop = this.newLabel(funcInfo);
        const done = this.newLabel(funcInfo);
        this.emitLdTempToA(t1);
        this.asmLines.push('HSUBIA 0x00');
        this.asmLines.push('SZB STATUS,2');
        this.asmLines.push(`JP ${skipLabel}`);
        this.emitLabel(loop);
        this.emitLdTempToA(t1);
        this.emitOpTemp('SUBA', t0);
        this.asmLines.push('SNZB STATUS,0');
        this.asmLines.push(`JP ${done}`);
        this.emitLdAToTemp(t0);
        this.asmLines.push(`JP ${loop}`);
        this.emitLabel(done);
        this.emitLabel(skipLabel);
        this.emitLdTempToA(t0);
    }

    private emitSignedDivide(left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);
        if (rightConst !== null && rightConst === 0) {
            throw new Error('Division by zero');
        }
        if (leftConst === 0) {
            this.asmLines.push('LDIA 0x00');
            return;
        }
        if (rightConst !== null && rightConst === 1) {
            this.emitLoadAccumulator(left, funcInfo);
            return;
        }

        const signResult = this.allocTemp();
        this.asmLines.push('LDIA 0x00');
        this.emitLdAToTemp(signResult);

        this.emitLoadAccumulator(left, funcInfo);
        const tLeft = this.allocTemp();
        this.emitLdAToTemp(tLeft);

        const leftDoneLabel = this.newLabel(funcInfo);
        this.emitTestBitTemp('SNZB', tLeft, 7);
        this.asmLines.push(`JP ${leftDoneLabel}`);
        this.emitLdTempToA(tLeft);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLdAToTemp(tLeft);
        this.asmLines.push('LDIA 0xFF');
        this.emitLdAToTemp(signResult);
        this.emitLabel(leftDoneLabel);

        this.emitLoadAccumulator(right, funcInfo);
        const tRight = this.allocTemp();
        this.emitLdAToTemp(tRight);

        const rightDoneLabel = this.newLabel(funcInfo);
        this.emitTestBitTemp('SNZB', tRight, 7);
        this.asmLines.push(`JP ${rightDoneLabel}`);
        this.emitLdTempToA(tRight);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLdAToTemp(tRight);
        this.emitLdTempToA(signResult);
        this.asmLines.push('XORIA 0xFF');
        this.emitLdAToTemp(signResult);
        this.emitLabel(rightDoneLabel);

        this.asmLines.push('CLRA');
        const t2 = this.allocTemp();
        this.emitLdAToTemp(t2);

        const skipLabel = this.newLabel(funcInfo);
        const zeroLabel = this.newLabel(funcInfo);
        const endLabel = this.newLabel(funcInfo);
        const loop = this.newLabel(funcInfo);
        const done = this.newLabel(funcInfo);
        this.emitLdTempToA(tRight);
        this.asmLines.push('HSUBIA 0x00');
        this.asmLines.push('SZB STATUS,2');
        this.asmLines.push(`JP ${skipLabel}`);
        this.emitLdTempToA(tLeft);
        this.asmLines.push('HSUBIA 0x00');
        this.asmLines.push('SZB STATUS,2');
        this.asmLines.push(`JP ${zeroLabel}`);
        this.emitLabel(loop);
        this.emitLdTempToA(tRight);
        this.emitOpTemp('SUBA', tLeft);
        this.asmLines.push('SNZB STATUS,0');
        this.asmLines.push(`JP ${done}`);
        this.emitLdAToTemp(tLeft);
        this.emitLdTempToA(t2);
        this.asmLines.push('ADDIA 0x01');
        this.emitLdAToTemp(t2);
        this.asmLines.push(`JP ${loop}`);
        this.emitLabel(done);
        this.emitLdTempToA(t2);
        this.asmLines.push(`JP ${endLabel}`);
        this.emitLabel(skipLabel);
        this.emitLdTempToA(t2);
        this.asmLines.push(`JP ${endLabel}`);
        this.emitLabel(zeroLabel);
        this.asmLines.push('LDIA 0x00');
        this.emitLabel(endLabel);

        const negResultLabel = this.newLabel(funcInfo);
        const finalLabel = this.newLabel(funcInfo);
        this.emitTestBitTemp('SZB', signResult, 7);
        this.asmLines.push(`JP ${negResultLabel}`);
        this.asmLines.push(`JP ${finalLabel}`);
        this.emitLabel(negResultLabel);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLabel(finalLabel);
    }

    private emitSignedModulo(left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);
        if (rightConst !== null && rightConst === 0) {
            throw new Error('Division by zero (modulo)');
        }
        if (rightConst === 1) {
            this.asmLines.push('LDIA 0x00');
            return;
        }
        if (leftConst === 0) {
            this.asmLines.push('LDIA 0x00');
            return;
        }

        const leftWasNeg = this.allocTemp();
        this.asmLines.push('LDIA 0x00');
        this.emitLdAToTemp(leftWasNeg);

        this.emitLoadAccumulator(left, funcInfo);
        const tLeft = this.allocTemp();
        this.emitLdAToTemp(tLeft);

        const leftDoneLabel = this.newLabel(funcInfo);
        this.emitTestBitTemp('SNZB', tLeft, 7);
        this.asmLines.push(`JP ${leftDoneLabel}`);
        this.emitLdTempToA(tLeft);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLdAToTemp(tLeft);
        this.asmLines.push('LDIA 0xFF');
        this.emitLdAToTemp(leftWasNeg);
        this.emitLabel(leftDoneLabel);

        this.emitLoadAccumulator(right, funcInfo);
        const tRight = this.allocTemp();
        this.emitLdAToTemp(tRight);

        const rightDoneLabel = this.newLabel(funcInfo);
        this.emitTestBitTemp('SNZB', tRight, 7);
        this.asmLines.push(`JP ${rightDoneLabel}`);
        this.emitLdTempToA(tRight);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLdAToTemp(tRight);
        this.emitLabel(rightDoneLabel);

        const skipLabel = this.newLabel(funcInfo);
        const loop = this.newLabel(funcInfo);
        const done = this.newLabel(funcInfo);
        this.emitLdTempToA(tRight);
        this.asmLines.push('HSUBIA 0x00');
        this.asmLines.push('SZB STATUS,2');
        this.asmLines.push(`JP ${skipLabel}`);
        this.emitLabel(loop);
        this.emitLdTempToA(tRight);
        this.emitOpTemp('SUBA', tLeft);
        this.asmLines.push('SNZB STATUS,0');
        this.asmLines.push(`JP ${done}`);
        this.emitLdAToTemp(tLeft);
        this.asmLines.push(`JP ${loop}`);
        this.emitLabel(done);
        this.emitLabel(skipLabel);
        this.emitLdTempToA(tLeft);

        const negResultLabel = this.newLabel(funcInfo);
        const finalLabel = this.newLabel(funcInfo);
        this.emitTestBitTemp('SZB', leftWasNeg, 7);
        this.asmLines.push(`JP ${negResultLabel}`);
        this.asmLines.push(`JP ${finalLabel}`);
        this.emitLabel(negResultLabel);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLabel(finalLabel);
    }

    private emitShiftLeft(left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn) {
        const rightConst = this.getConstantValue(right);
        if (rightConst !== null) {
            this.emitLoadAccumulator(left, funcInfo);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            for (let i = 0; i < rightConst; i++) {
                this.emitLdTempToA(t0);
                this.emitOpTemp('ADDA', t0);
                this.emitLdAToTemp(t0);
            }
        } else {
            this.emitLoadAccumulator(left, funcInfo);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            this.emitLoadAccumulator(right, funcInfo);
            const t1 = this.allocTemp();
            this.emitLdAToTemp(t1);
            const loopLabel = this.newLabel(funcInfo);
            const doneLabel = this.newLabel(funcInfo);
            this.emitLdTempToA(t1);
            this.asmLines.push('HSUBIA 0x00');
            this.asmLines.push('SZB STATUS,2');
            this.asmLines.push(`JP ${doneLabel}`);
            this.emitLabel(loopLabel);
            this.emitLdTempToA(t0);
            this.emitOpTemp('ADDA', t0);
            this.emitLdAToTemp(t0);
            this.emitLdTempToA(t1);
            this.asmLines.push('HSUBIA 0x01');
            this.emitLdAToTemp(t1);
            this.emitLdTempToA(t1);
            this.asmLines.push('HSUBIA 0x00');
            this.asmLines.push('SNZB STATUS,2');
            this.asmLines.push(`JP ${loopLabel}`);
            this.emitLabel(doneLabel);
            this.emitLdTempToA(t0);
        }
    }

    private emitShiftRight(left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn, isSigned: boolean = false) {
        const rightConst = this.getConstantValue(right);
        if (rightConst !== null) {
            this.emitLoadAccumulator(left, funcInfo);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            if (isSigned && rightConst > 0) {
                const negLabel = this.newLabel(funcInfo);
                const posLabel = this.newLabel(funcInfo);
                const endLabel = this.newLabel(funcInfo);
                this.emitTestBitTemp('SNZB', t0, 7);
                this.asmLines.push(`JP ${posLabel}`);
                this.emitLabel(negLabel);
                for (let i = 0; i < rightConst; i++) {
                    this.asmLines.push('SETB STATUS,0');
                    this.emitOpTemp('RRCA', t0);
                    this.emitLdAToTemp(t0);
                }
                this.asmLines.push(`JP ${endLabel}`);
                this.emitLabel(posLabel);
                for (let i = 0; i < rightConst; i++) {
                    this.asmLines.push('CLRB STATUS,0');
                    this.emitOpTemp('RRCA', t0);
                    this.emitLdAToTemp(t0);
                }
                this.emitLabel(endLabel);
            } else {
                for (let i = 0; i < rightConst; i++) {
                    this.asmLines.push('CLRB STATUS,0');
                    this.emitOpTemp('RRCA', t0);
                    this.emitLdAToTemp(t0);
                }
            }
        } else {
            this.emitLoadAccumulator(left, funcInfo);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            this.emitLoadAccumulator(right, funcInfo);
            const t1 = this.allocTemp();
            this.emitLdAToTemp(t1);
            const loopLabel = this.newLabel(funcInfo);
            const doneLabel = this.newLabel(funcInfo);
            this.emitLdTempToA(t1);
            this.asmLines.push('HSUBIA 0x00');
            this.asmLines.push('SZB STATUS,2');
            this.asmLines.push(`JP ${doneLabel}`);
            this.emitLabel(loopLabel);
            if (isSigned) {
                this.emitTestBitTemp('SZB', t0, 7);
                this.asmLines.push('SETB STATUS,0');
                this.emitTestBitTemp('SNZB', t0, 7);
                this.asmLines.push('CLRB STATUS,0');
            } else {
                this.asmLines.push('CLRB STATUS,0');
            }
            this.emitOpTemp('RRCA', t0);
            this.emitLdAToTemp(t0);
            this.emitLdTempToA(t1);
            this.asmLines.push('HSUBIA 0x01');
            this.emitLdAToTemp(t1);
            this.emitLdTempToA(t1);
            this.asmLines.push('HSUBIA 0x00');
            this.asmLines.push('SNZB STATUS,2');
            this.asmLines.push(`JP ${loopLabel}`);
            this.emitLabel(doneLabel);
            this.emitLdTempToA(t0);
        }
    }

    private emitShiftAssign(sym: Sym, left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn, isRight: boolean) {
        const isSigned = isRight && sym.type === 'i8';
        const rightConst = this.getConstantValue(right);
        if (rightConst !== null) {
            this.emitLdSymToA(sym);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            if (isRight && isSigned && rightConst > 0) {
                const negLabel = this.newLabel(funcInfo);
                const posLabel = this.newLabel(funcInfo);
                const endLabel = this.newLabel(funcInfo);
                this.emitTestBitTemp('SNZB', t0, 7);
                this.asmLines.push(`JP ${posLabel}`);
                this.emitLabel(negLabel);
                for (let i = 0; i < rightConst; i++) {
                    this.asmLines.push('SETB STATUS,0');
                    this.emitOpTemp('RRCA', t0);
                    this.emitLdAToTemp(t0);
                }
                this.asmLines.push(`JP ${endLabel}`);
                this.emitLabel(posLabel);
                for (let i = 0; i < rightConst; i++) {
                    this.asmLines.push('CLRB STATUS,0');
                    this.emitOpTemp('RRCA', t0);
                    this.emitLdAToTemp(t0);
                }
                this.emitLabel(endLabel);
            } else {
                for (let i = 0; i < rightConst; i++) {
                    if (isRight) {
                        this.asmLines.push('CLRB STATUS,0');
                        this.emitOpTemp('RRCA', t0);
                    } else {
                        this.emitLdTempToA(t0);
                        this.emitOpTemp('ADDA', t0);
                    }
                    this.emitLdAToTemp(t0);
                }
            }
            this.emitLdTempToA(t0);
            this.emitLdAToSym(sym);
        } else {
            this.emitLdSymToA(sym);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            this.emitLoadAccumulator(right, funcInfo);
            const t1 = this.allocTemp();
            this.emitLdAToTemp(t1);
            const loopLabel = this.newLabel(funcInfo);
            const doneLabel = this.newLabel(funcInfo);
            this.emitLdTempToA(t1);
            this.asmLines.push('HSUBIA 0x00');
            this.asmLines.push('SZB STATUS,2');
            this.asmLines.push(`JP ${doneLabel}`);
            this.emitLabel(loopLabel);
            if (isRight) {
                if (isSigned) {
                    this.emitTestBitTemp('SZB', t0, 7);
                    this.asmLines.push('SETB STATUS,0');
                    this.emitTestBitTemp('SNZB', t0, 7);
                    this.asmLines.push('CLRB STATUS,0');
                } else {
                    this.asmLines.push('CLRB STATUS,0');
                }
                this.emitOpTemp('RRCA', t0);
            } else {
                this.emitLdTempToA(t0);
                this.emitOpTemp('ADDA', t0);
            }
            this.emitLdAToTemp(t0);
            this.emitLdTempToA(t1);
            this.asmLines.push('HSUBIA 0x01');
            this.emitLdAToTemp(t1);
            this.emitLdTempToA(t1);
            this.asmLines.push('HSUBIA 0x00');
            this.asmLines.push('SNZB STATUS,2');
            this.asmLines.push(`JP ${loopLabel}`);
            this.emitLabel(doneLabel);
            this.emitLdTempToA(t0);
            this.emitLdAToSym(sym);
        }
    }

    private emitArithAssign(sym: Sym, left: Parser.SyntaxNode, right: Parser.SyntaxNode, funcInfo: Fn, op: string) {
        const isSigned = sym.type === 'i8';
        if (op === '*=') {
            this.emitMultiply(left, right, funcInfo);
        } else if (op === '/=') {
            if (isSigned) this.emitSignedDivide(left, right, funcInfo);
            else this.emitDivide(left, right, funcInfo);
        } else if (op === '%=') {
            if (isSigned) this.emitSignedModulo(left, right, funcInfo);
            else this.emitModulo(left, right, funcInfo);
        }
        this.emitLdAToSym(sym);
    }

    private extractAddr(node: Parser.SyntaxNode): number | null {
        const inner = this.unwrapParentheses(node);
        if (inner.type !== 'pointer_expression') return null;
        let castNode: Parser.SyntaxNode | null = null;
        for (let i = 0; i < inner.childCount; i++) {
            const child = inner.child(i);
            if (child && child.type === 'cast_expression') {
                castNode = child;
                break;
            }
        }
        if (!castNode) return null;
        const valueNode = castNode.childForFieldName('value');
        if (!valueNode || valueNode.type !== 'number_literal') return null;
        return this.parseNumber(valueNode.text) & 0xFF;
    }

    private resolveSymbol(node: Parser.SyntaxNode, funcInfo: Fn): Sym | null {
        const inner = this.unwrapParentheses(node);
        let name = inner.text.trim();
        if (inner.type === 'pointer_declarator') {
            for (let i = 0; i < inner.childCount; i++) {
                const child = inner.child(i);
                if (child && child.type === 'identifier') {
                    name = child.text.trim();
                    break;
                }
            }
        }
        if (funcInfo.localSymbols.has(name)) return funcInfo.localSymbols.get(name)!;
        if (this.globalSymbols.has(name)) return this.globalSymbols.get(name)!;
        return null;
    }

    private resolveArraySymbol(node: Parser.SyntaxNode, funcInfo: Fn): Sym | null {
        let arrayNode = node.childForFieldName('array');
        if (!arrayNode) {
            for (let i = 0; i < node.childCount; i++) {
                const c = node.child(i);
                if (c && c.type === 'identifier') { arrayNode = c; break; }
            }
        }
        if (!arrayNode) return null;
        return this.resolveSymbol(arrayNode, funcInfo);
    }

    private getGlobalAddressValue(node: Parser.SyntaxNode): number | null {
        const inner = this.unwrapParentheses(node);
        if (inner.type === 'pointer_expression') {
            const opNode = inner.child(0);
            const argNode = inner.child(1);
            if (opNode && opNode.text === '&' && argNode) {
                const name = argNode.text.trim();
                const sym = this.globalSymbols.get(name);
                if (sym) return sym.ramAddr;
            }
        }
        if (inner.type === 'identifier') {
            const name = inner.text.trim();
            const sym = this.globalSymbols.get(name);
            if (sym && sym.isArray) return sym.ramAddr;
        }
        if (inner.type === 'cast_expression') {
            const argNode = inner.childForFieldName('value');
            if (argNode) return this.getGlobalAddressValue(argNode);
        }
        return null;
    }

    private getConstantValue(node: Parser.SyntaxNode): number | null {
        const inner = this.unwrapParentheses(node);
        if (inner.type === 'number_literal') return this.parseNumber(inner.text);
        if (inner.type === 'char_literal') {
            const text = inner.text;
            if (text.length >= 3) return text.charCodeAt(1);
            return 0;
        }
        if (inner.type === 'unary_expression') {
            const opNode = this.getChildByField(inner, 'operator');
            const argument = inner.childForFieldName('argument');
            if (!opNode || !argument) return null;
            const val = this.getConstantValue(argument);
            if (val === null) return null;
            if (opNode.text === '-') return (-val) & 0xFF;
            if (opNode.text === '~') return (~val) & 0xFF;
            if (opNode.text === '!') return val === 0 ? 1 : 0;
            return null;
        }
        if (inner.type === 'binary_expression') {
            const left = inner.childForFieldName('left');
            const right = inner.childForFieldName('right');
            const opNode = this.getChildByField(inner, 'operator');
            if (!left || !right || !opNode) return null;
            const lv = this.getConstantValue(left);
            const rv = this.getConstantValue(right);
            if (lv === null || rv === null) return null;
            const op = opNode.text;
            switch (op) {
                case '+': return (lv + rv) & 0xFF;
                case '-': return (lv - rv) & 0xFF;
                case '*': return (lv * rv) & 0xFF;
                case '/': return rv !== 0 ? Math.floor(lv / rv) & 0xFF : null;
                case '%': return rv !== 0 ? (lv % rv) & 0xFF : null;
                case '&': return (lv & rv) & 0xFF;
                case '|': return (lv | rv) & 0xFF;
                case '^': return (lv ^ rv) & 0xFF;
                case '<<': return (lv << rv) & 0xFF;
                case '>>': return (lv >> rv) & 0xFF;
                case '==': return lv === rv ? 1 : 0;
                case '!=': return lv !== rv ? 1 : 0;
                case '<': return lv < rv ? 1 : 0;
                case '>': return lv > rv ? 1 : 0;
                case '<=': return lv <= rv ? 1 : 0;
                case '>=': return lv >= rv ? 1 : 0;
                case '&&': return (lv && rv) ? 1 : 0;
                case '||': return (lv || rv) ? 1 : 0;
                default: return null;
            }
        }
        return null;
    }

    private parseNumber(text: string): number {
        text = text.trim();
        let val: number;
        if (text.startsWith('0x') || text.startsWith('0X')) val = parseInt(text, 16);
        else if (text.startsWith('0b') || text.startsWith('0B')) val = parseInt(text.slice(2), 2);
        else val = parseInt(text, 10);
        return val & 0xFF;
    }

    private unwrapParentheses(node: Parser.SyntaxNode): Parser.SyntaxNode {
        if (node.type === 'parenthesized_expression') {
            const inner = node.child(1);
            if (inner) return this.unwrapParentheses(inner);
        }
        return node;
    }

    private getChildByField(node: Parser.SyntaxNode, field: string): Parser.SyntaxNode | null {
        return node.childForFieldName(field);
    }

    private newLabel(funcInfo: Fn): string {
        return `L${funcInfo.asmName}_${funcInfo.labelCounter++}`;
    }
}

export async function compile(source: string): Promise<{ rom: Uint16Array; asm: string; debugInfo: DebugInfo }> {
    return new SC8P053Compiler().compile(source);
}
