/**
 * @license sc8p053vm
 * Copyright (c) 2026 391321232@qq.com
 * Licensed under BSL-1.1 (see LICENSE). Changes to MIT after 2099-12-31.
 */

import Parser from 'web-tree-sitter';
import { assemble } from './asmc';

const language = Parser.init().then(() => {
    if (
        typeof process == 'object' &&
        typeof process.versions == 'object' &&
        typeof process.versions.node == 'string'
    ) {
        return Parser.Language.load(
            __dirname + '/../node_modules/tree-sitter-c/tree-sitter-c.wasm',
        );
    } else {
        return Parser.Language.load('tree-sitter-c.wasm');
    }
});

const RAM_GP_START = 0x20;
const RAM_GP_END = 0x6f;
const RAM_SHARED_START = 0x70;
const RAM_SHARED_END = 0x7f;
const RAM_BANK1_START = 0xa0;
const RAM_BANK1_END = 0xef;
const ISR_SAVE_SIZE = 4;

type Type = 'void' | 'u8' | 'i8' | 'bool';

interface TypeInfo {
    type: Type;
    isArray: boolean;
    arraySize: number;
    dimensions?: number[];
    isPointer: boolean;
}

export interface Sym {
    name: string;
    asmName: string;
    typeInfo: TypeInfo;
    ramAddr: number;
    bank: number;
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
    params: { name: string; asmName: string; type: Type; isPointer: boolean }[];
    localSymbols: Map<string, Sym>;
    labelCounter: number;
    breakLabel?: string;
    continueLabel?: string;
    isISR?: boolean;
    tempCount: number;
    savedTempCount: number;
    calls: Set<string>;
    allPathsReturn: boolean;
    frameSize: number;
    frameBase: number;
    returnIsPointer: boolean;
    labels: Map<string, string>;
    gotoTargets: Set<string>;
    definedLabels: Set<string>;
    localTypedefs: Map<string, TypeInfo>;
}

interface  Block {
    id: number;
    successors:  Block[];
    terminator: 'none' | 'return' | 'break' | 'continue' | 'branch' | 'infinite';
}

interface FnCFG {
    entry:  Block;
    exit:  Block;
    blocks:  Block[];
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

interface FnMacro {
    kind: 'function';
    name: string;
    params: string[];
    isVariadic: boolean;
    body: Token[];
}

type Macro = ObjectMacro | FnMacro;

interface CondFrame {
    active: boolean;
    elseSeen: boolean;
    parentActive: boolean;
    branchTaken: boolean;
}

interface LineMap {
    segments: Map<number, { srcLine: number; col: number; srcCol: number; len: number }[]>;
}

class Preprocessor {
    private macros: Map<string, Macro> = new Map();
    private condStack: CondFrame[] = [];

    preprocess(source: string): { text: string; lineMap: LineMap } {
        this.macros.clear();
        this.condStack = [];
        const stripped = this.stripComments(source);
        const rawLines = stripped.split('\n');
        const out: string[] = new Array(rawLines.length).fill('');
        const segs: LineMap['segments'] = new Map();
        let mi = 0;
        for (let ri = 0; ri < rawLines.length; ) {
            let line = rawLines[ri];
            const startRi = ri;
            const parts: { srcLine: number; col: number; srcCol: number; len: number }[] = [];
            let mCol = 0;
            if (line.endsWith('\\') && ri + 1 < rawLines.length) {
                const head = line.slice(0, -1);
                parts.push({ srcLine: startRi, col: 0, srcCol: 0, len: head.length });
                mCol = head.length;
                while (line.endsWith('\\') && ri + 1 < rawLines.length) {
                    const next = rawLines[++ri];
                    line = line.slice(0, -1) + next;
                    parts.push({ srcLine: ri, col: mCol, srcCol: 0, len: next.length });
                    mCol += next.length;
                }
                segs.set(mi, parts);
            }
            const trimmed = trimStart(line);
            if (trimmed.startsWith('#')) {
                const result = this.processDirective(trimmed, startRi + 1);
                if (result !== null) {
                    out[startRi] = result;
                }
            } else if (this.isActive()) {
                out[startRi] = this.expandLine(line, startRi + 1);
            }
            mi++;
            ri++;
        }
        if (this.condStack.length > 0) {
            throw new Error(`Unterminated #if directive at end of file`);
        }
        return { text: out.join('\n'), lineMap: { segments: segs } };
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
        if (text.startsWith('error')) {
            if (this.isActive()) {
                const msg = trimStart(text.substring(5)).trim();
                throw new Error(`#error${msg ? ' ' + msg : ''}`);
            }
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
        const leadingWs = rest.findIndex((t) => t.type !== 'whitespace');

        if (leadingWs === -1) {
            this.macros.set(name, { kind: 'object', name, body: [] });
            return;
        }

        if (leadingWs === 0 && rest[0].type === 'punctuation' && rest[0].value === '(') {
            this.parseFnMacro(name, rest, 0);
        } else {
            const body = rest.slice(leadingWs);
            this.macros.set(name, { kind: 'object', name, body });
        }
    }

    private parseFnMacro(name: string, tokens: Token[], openParenIdx: number): void {
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
                if (
                    i < tokens.length &&
                    tokens[i].type === 'punctuation' &&
                    tokens[i].value === ')'
                ) {
                    i++;
                    break;
                }
                continue;
            }
            if (tokens[i].type === 'identifier') {
                params.push(tokens[i].value);
                i++;
                if (
                    i < tokens.length &&
                    tokens[i].type === 'punctuation' &&
                    tokens[i].value === ','
                ) {
                    i++;
                }
                continue;
            }
            if (
                tokens[i].type === 'whitespace' ||
                (tokens[i].type === 'punctuation' && tokens[i].value === ',')
            ) {
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
        const parentActive = this.isActive();
        if (!parentActive) {
            this.condStack.push({
                active: false,
                elseSeen: false,
                parentActive: false,
                branchTaken: false,
            });
            return;
        }
        const name = text.trim().split(/\s/)[0];
        const defined = this.macros.has(name);
        const condition = negate ? !defined : defined;
        this.condStack.push({
            active: condition,
            elseSeen: false,
            parentActive: true,
            branchTaken: condition,
        });
    }

    private processIf(text: string, lineNo: number): void {
        const parentActive = this.isActive();
        if (!parentActive) {
            this.condStack.push({
                active: false,
                elseSeen: false,
                parentActive: false,
                branchTaken: false,
            });
            return;
        }
        const result = this.evaluateCondition(text, lineNo);
        this.condStack.push({
            active: result,
            elseSeen: false,
            parentActive: true,
            branchTaken: result,
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
        return text
            .replace(/\bdefined\s*\(\s*(\w+)\s*\)/g, (_, name) => {
                return this.macros.has(name) ? '1' : '0';
            })
            .replace(/\bdefined\s+(\w+)/g, (_, name) => {
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
        return expanded.map((t) => t.value).join('');
    }

    private expandTokens(tokens: Token[], expanding: Set<string>): Token[] {
        const result: Token[] = [];
        let i = 0;
        while (i < tokens.length) {
            const token = tokens[i];
            const noExpand = token.noExpand || new Set<string>();
            if (
                token.type === 'identifier' &&
                !noExpand.has(token.value) &&
                !expanding.has(token.value)
            ) {
                const macro = this.macros.get(token.value);
                if (macro) {
                    const newExpanding = new Set(expanding);
                    newExpanding.add(token.value);
                    if (macro.kind === 'object') {
                        const expanded = this.expandTokens(macro.body, newExpanding);
                        const painted = expanded.map((t) => {
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
                            const substituted = this.substituteFnMacro(macro, args);
                            const reExpanded = this.expandTokens(substituted, newExpanding);
                            const painted = reExpanded.map((t) => {
                                if (t.type === 'identifier' && t.value === token.value) {
                                    const t2 = { ...t };
                                    t2.noExpand = new Set(t.noExpand || []);
                                    t2.noExpand.add(token.value);
                                    return t2;
                                }
                                return t;
                            });
                            const remaining = tokens.slice(nextIdx);
                            const rescanned = this.expandTokens(
                                [...painted, ...remaining],
                                expanding,
                            );
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

    private collectArgs(
        tokens: Token[],
        startIdx: number,
        macro: FnMacro,
    ): { args: Token[][] | null; nextIdx: number } {
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

    private substituteFnMacro(macro: FnMacro, args: Token[][]): Token[] {
        const expandedArgs = args.map((arg) => this.expandTokens(arg, new Set()));
        const result: Token[] = [];
        const body = this.trimPasteWhitespace(macro.body);
        for (let i = 0; i < body.length; i++) {
            const token = body[i];

            const isNextPaste =
                (i + 1 < body.length &&
                    body[i + 1].type === 'punctuation' &&
                    body[i + 1].value === '##') ||
                (i + 2 < body.length &&
                    body[i + 1].type === 'whitespace' &&
                    body[i + 2].type === 'punctuation' &&
                    body[i + 2].value === '##');
            const isPrevPaste =
                result.length > 0 &&
                result[result.length - 1].type === 'punctuation' &&
                result[result.length - 1].value === '##';

            if (token.type === 'punctuation' && token.value === '##') {
                let j = i + 1;
                while (j < body.length && body[j].type === 'whitespace') j++;
                if (j < body.length && body[j].type === 'identifier') {
                    const paramIdx = macro.params.indexOf(body[j].value);
                    if (paramIdx >= 0 && paramIdx < args.length) {
                        const left =
                            result.length > 0
                                ? result.pop()!
                                : { type: 'other' as TokenType, value: '', lineNo: 0 };
                        const rightTokens = args[paramIdx];
                        const rightValue = rightTokens.map((t) => t.value).join('');
                        const pasted = left.value + rightValue;
                        result.push({
                            type: this.classifyPasted(pasted),
                            value: pasted,
                            lineNo: left.lineNo,
                        });
                        i = j;
                        continue;
                    }
                }
                const left =
                    result.length > 0
                        ? result.pop()!
                        : { type: 'other' as TokenType, value: '', lineNo: 0 };
                let j2 = i + 1;
                while (j2 < body.length && body[j2].type === 'whitespace') j2++;
                if (j2 < body.length) {
                    const pasted = left.value + body[j2].value;
                    result.push({
                        type: this.classifyPasted(pasted),
                        value: pasted,
                        lineNo: left.lineNo,
                    });
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
        const left =
            result.length > 0
                ? result.pop()!
                : { type: 'other' as TokenType, value: '', lineNo: 0 };
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
                const left =
                    result.length > 0
                        ? result.pop()!
                        : { type: 'other' as TokenType, value: '', lineNo: 0 };
                let j = i + 1;
                while (j < tokens.length && tokens[j].type === 'whitespace') j++;
                if (j < tokens.length) {
                    const right = tokens[j];
                    const pasted = left.value + right.value;
                    result.push({
                        type: this.classifyPasted(pasted),
                        value: pasted,
                        lineNo: left.lineNo,
                    });
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
        const s = tokens
            .map((t) => t.value)
            .join('')
            .trim();
        const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return {
            type: 'string',
            value: `"${escaped}"`,
            lineNo: tokens.length > 0 ? tokens[0].lineNo : 0,
        };
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
                const { value, endIdx } = this.scanString(text, i);
                tokens.push({ type: 'string', value, lineNo });
                i = endIdx;
                continue;
            }

            if (ch === "'") {
                const { value, endIdx } = this.scanChar(text, i);
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
                const j = i + 1;
                if (j < text.length) {
                    const two = text.slice(i, j + 1);
                    if (
                        [
                            '++',
                            '--',
                            '+=',
                            '-=',
                            '*=',
                            '/=',
                            '%=',
                            '<<',
                            '>>',
                            '<=',
                            '>=',
                            '==',
                            '!=',
                            '&&',
                            '||',
                            '&=',
                            '|=',
                            '^=',
                            '<<=',
                            '>>=',
                            '->',
                        ].includes(two)
                    ) {
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

    private scanString(text: string, start: number): { value: string; endIdx: number } {
        let i = start + 1;
        while (i < text.length) {
            if (text[i] === '\\') {
                i += 2;
                continue;
            }
            if (text[i] === '"') {
                i++;
                break;
            }
            i++;
        }
        return { value: text.slice(start, i), endIdx: i };
    }

    private scanChar(text: string, start: number): { value: string; endIdx: number } {
        let i = start + 1;
        while (i < text.length) {
            if (text[i] === '\\') {
                i += 2;
                continue;
            }
            if (text[i] === "'") {
                i++;
                break;
            }
            i++;
        }
        return { value: text.slice(start, i), endIdx: i };
    }
}

class SC8P053Compiler {
    private globalSymbols: Map<string, Sym> = new Map();
    private globalTypedefs: Map<string, TypeInfo> = new Map();
    private globalInits: {
        asmName: string;
        value: number;
        isArray: boolean;
        ramAddr: number;
        arrayValues?: number[];
    }[] = [];
    private fns: Map<string, Fn> = new Map();
    private nextRamAddr: number = RAM_GP_START;
    private currentBank = 0;
    private currentAsmBank = 0;
    private asmLines: string[] = [];
    private currentFn: Fn | null = null;
    private tempCounter = 0;
    private dryRun = false;
    private currentSourceLine = 0;
    private lineMap: LineMap = { segments: new Map() };

    private mapPos(row: number, col: number): { line: number; col: number } {
        const segs = this.lineMap.segments.get(row);
        if (!segs) {
            return { line: row + 1, col: col + 1 };
        }
        for (let i = segs.length - 1; i >= 0; i--) {
            const s = segs[i];
            if (col >= s.col) {
                return { line: s.srcLine + 1, col: s.srcCol + (col - s.col) + 1 };
            }
        }
        return { line: row + 1, col: col + 1 };
    }

    private posStr(node: Parser.SyntaxNode): string {
        const { line, col } = this.mapPos(node.startPosition.row, node.startPosition.column);
        return `line ${line}, column ${col}`;
    }

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

    async compile(
        source: string,
    ): Promise<{ rom: Uint16Array; asm: string; debugInfo: DebugInfo }> {
        const preprocessor = new Preprocessor();
        const { text: preprocessed, lineMap } = preprocessor.preprocess(source);
        this.lineMap = lineMap;
        const c = await language;
        const parser = new Parser();
        parser.setLanguage(c);
        const tree = parser.parse(preprocessed);

        this.asmLines = [];
        this.globalSymbols.clear();
        this.globalTypedefs.clear();
        this.globalInits = [];
        this.fns.clear();
        this.nextRamAddr = RAM_GP_START;
        this.currentBank = 0;
        this.tempCounter = 0;
        this.currentSourceLine = 0;

        this.analyzeAll(tree.rootNode);
        this.checkRecursion();
        this.checkAllTypes(tree.rootNode);
        const afterGlobalsAddr = this.nextRamAddr;
        const afterGlobalsBank = this.currentBank;
        this.generateCode(tree.rootNode, afterGlobalsAddr, afterGlobalsBank);

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
            varMap,
        };

        return { rom, asm: asmSource, debugInfo };
    }

    private analyzeFnBody(
        funcName: string,
        node: Parser.SyntaxNode,
        fn: Fn,
        loopDepth: number,
        switchDepth: number,
    ) {
        if (node.type === 'ERROR') {
            throw new Error(`Syntax error at ${this.posStr(node)}`);
        }
        if (node.isMissing) {
            throw new Error(`Syntax error: unexpected end of input`);
        }
        if (
            node.type === 'while_statement' ||
            node.type === 'do_statement' ||
            node.type === 'for_statement'
        ) {
            loopDepth++;
        }
        if (node.type === 'switch_statement') {
            switchDepth++;
        }
        if (node.type === 'break_statement') {
            if (loopDepth === 0 && switchDepth === 0) {
                throw new Error(
                    `'break' statement not within loop or switch at ${this.posStr(node)}`,
                );
            }
        }
        if (node.type === 'continue_statement') {
            if (loopDepth === 0) {
                throw new Error(`'continue' statement not within loop at ${this.posStr(node)}`);
            }
        }
        if (node.type === 'call_expression') {
            const funcNode = node.childForFieldName('function');
            if (funcNode) fn.calls.add(funcNode.text.trim());
        }
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) this.analyzeFnBody(funcName, child, fn, loopDepth, switchDepth);
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
                throw new Error(
                    `Recursive function call detected: ${path}. Recursion is not supported on this target (static RAM allocation).`,
                );
            }
        }
    }

    private analyzeAll(rootNode: Parser.SyntaxNode) {
        if (rootNode.type === 'ERROR') {
            throw new Error(`Syntax error at ${this.posStr(rootNode)}`);
        }
        if (rootNode.isMissing) {
            throw new Error(`Syntax error: unexpected end of input`);
        }
        for (let i = 0; i < rootNode.childCount; i++) {
            const child = rootNode.child(i);
            if (!child) continue;
            if (child.type === 'ERROR') {
                throw new Error(`Syntax error at ${this.posStr(child)}`);
            }
            if (child.isMissing) {
                throw new Error(`Syntax error: unexpected end of input`);
            }
            if (child.type === 'declaration') {
                this.processGlobalDeclaration(child);
            } else if (child.type === 'function_definition') {
                this.processFnSignature(child);
            } else if (child.type === 'type_definition') {
                this.processTypedef(child);
            } else if (child.type === 'struct_specifier') {
                throw new Error(`'struct' is not supported at ${this.posStr(child)}`);
            } else if (child.type === 'enum_specifier') {
                throw new Error(`'enum' is not supported at ${this.posStr(child)}`);
            } else if (child.type === 'union_specifier') {
                throw new Error(`'union' is not supported at ${this.posStr(child)}`);
            } else {
                throw new Error(
                    `Unexpected top-level construct '${child.type}' at ${this.posStr(child)}. ` +
                        `A translation unit can only contain function definitions, declarations, and preprocessor directives.`,
                );
            }
        }
        for (let i = 0; i < rootNode.childCount; i++) {
            const child = rootNode.child(i);
            if (!child || child.type !== 'function_definition') continue;
            const declaratorNode = child.childForFieldName('declarator');
            if (!declaratorNode) continue;
            const funcDeclarator = this.findNodeByType(declaratorNode, 'function_declarator');
            if (!funcDeclarator) continue;
            const nameNode = funcDeclarator.childForFieldName('declarator');
            const funcName = nameNode ? nameNode.text.trim() : '';
            const fn = this.fns.get(funcName);
            if (!fn) continue;
            const bodyNode = child.childForFieldName('body');
            if (!bodyNode) continue;
            this.analyzeFnBody(funcName, bodyNode, fn, 0, 0);
            const cfg = this.buildCFG(bodyNode);
            fn.allPathsReturn = this.cfgAllPathsReturn(cfg);
            if (
                !fn.allPathsReturn &&
                fn.returnType !== 'void' &&
                funcName !== 'main' &&
                !fn.isISR
            ) {
                throw new Error(
                    `Non-void function '${funcName}' must return a value on all code paths at ${this.posStr(child)}`,
                );
            }
        }
    }

    private newBlock(blocks:  Block[]):  Block {
        const block:  Block = { id: blocks.length, successors: [], terminator: 'none' };
        blocks.push(block);
        return block;
    }

    private buildCFG(bodyNode: Parser.SyntaxNode): FnCFG {
        const blocks:  Block[] = [];
        const entry = this.newBlock(blocks);
        const exit = this.newBlock(blocks);
        const result = this.buildCFGCompound(bodyNode, entry, exit, blocks);
        if (result.fallThrough && result.currentBlock) {
            result.currentBlock.successors.push(exit);
        }
        return { entry, exit, blocks };
    }

    private buildCFGCompound(
        node: Parser.SyntaxNode,
        entry:  Block,
        exit:  Block,
        blocks:  Block[],
        loopHeader?:  Block,
    ): { currentBlock:  Block | null; fallThrough: boolean } {
        const stmts: Parser.SyntaxNode[] = [];
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child || child.type === '{' || child.type === '}') continue;
            stmts.push(child);
        }
        let currentBlock:  Block | null = entry;
        let fallThrough = true;
        for (const stmt of stmts) {
            if (!fallThrough || !currentBlock) break;
            const result = this.buildCFGStmt(stmt, currentBlock, exit, blocks, loopHeader);
            currentBlock = result.currentBlock;
            fallThrough = result.fallThrough;
        }
        return { currentBlock, fallThrough };
    }

    private buildCFGStmt(
        stmt: Parser.SyntaxNode,
        currentBlock:  Block,
        exit:  Block,
        blocks:  Block[],
        loopHeader?:  Block,
    ): { currentBlock:  Block | null; fallThrough: boolean } {
        if (stmt.type === 'return_statement') {
            currentBlock.terminator = 'return';
            return { currentBlock, fallThrough: false };
        }

        if (stmt.type === 'break_statement') {
            currentBlock.terminator = 'break';
            currentBlock.successors.push(exit);
            return { currentBlock, fallThrough: false };
        }

        if (stmt.type === 'continue_statement') {
            currentBlock.terminator = 'continue';
            if (loopHeader) {
                currentBlock.successors.push(loopHeader);
            }
            return { currentBlock, fallThrough: false };
        }

        if (stmt.type === 'compound_statement') {
            return this.buildCFGCompound(stmt, currentBlock, exit, blocks, loopHeader);
        }

        if (stmt.type === 'if_statement') {
            return this.buildCFGIf(stmt, currentBlock, exit, blocks, loopHeader);
        }

        if (stmt.type === 'while_statement') {
            return this.buildCFGWhile(stmt, currentBlock, blocks);
        }

        if (stmt.type === 'for_statement') {
            return this.buildCFGFor(stmt, currentBlock, blocks);
        }

        if (stmt.type === 'do_statement') {
            return this.buildCFGDoWhile(stmt, currentBlock, blocks);
        }

        if (stmt.type === 'switch_statement') {
            return this.buildCFGSwitch(stmt, currentBlock, blocks);
        }

        if (stmt.type === 'goto_statement') {
            currentBlock.terminator = 'branch';
            return { currentBlock, fallThrough: false };
        }

        if (stmt.type === 'labeled_statement') {
            for (let i = 1; i < stmt.childCount; i++) {
                const child = stmt.child(i);
                if (child && child.type !== ':') {
                    const result = this.buildCFGStmt(child, currentBlock, exit, blocks, loopHeader);
                    currentBlock = result.currentBlock!;
                    if (!result.fallThrough) return { currentBlock, fallThrough: false };
                }
            }
            return { currentBlock, fallThrough: true };
        }

        return { currentBlock, fallThrough: true };
    }

    private buildCFGIf(
        stmt: Parser.SyntaxNode,
        currentBlock:  Block,
        exit:  Block,
        blocks:  Block[],
        loopHeader?:  Block,
    ): { currentBlock:  Block | null; fallThrough: boolean } {
        const consequence = stmt.childForFieldName('consequence');
        const alternative = stmt.childForFieldName('alternative');

        const thenBlock = this.newBlock(blocks);
        const mergeBlock = this.newBlock(blocks);

        currentBlock.successors.push(thenBlock);

        let thenFallsThrough = false;
        let elseFallsThrough = false;

        if (alternative) {
            const elseBlock = this.newBlock(blocks);
            currentBlock.successors.push(elseBlock);
            if (consequence) {
                const thenResult = this.buildCFGStmt(
                    consequence,
                    thenBlock,
                    exit,
                    blocks,
                    loopHeader,
                );
                thenFallsThrough = thenResult.fallThrough;
                if (thenResult.fallThrough && thenResult.currentBlock) {
                    thenResult.currentBlock.successors.push(mergeBlock);
                }
            } else {
                thenBlock.successors.push(mergeBlock);
                thenFallsThrough = true;
            }
            const elseBody =
                alternative.type === 'else_clause'
                    ? this.extractElseBody(alternative)
                    : alternative;
            if (elseBody) {
                const elseResult = this.buildCFGStmt(elseBody, elseBlock, exit, blocks, loopHeader);
                elseFallsThrough = elseResult.fallThrough;
                if (elseResult.fallThrough && elseResult.currentBlock) {
                    elseResult.currentBlock.successors.push(mergeBlock);
                }
            } else {
                elseBlock.successors.push(mergeBlock);
                elseFallsThrough = true;
            }
        } else {
            currentBlock.successors.push(mergeBlock);
            elseFallsThrough = true;
            if (consequence) {
                const thenResult = this.buildCFGStmt(
                    consequence,
                    thenBlock,
                    exit,
                    blocks,
                    loopHeader,
                );
                thenFallsThrough = thenResult.fallThrough;
                if (thenResult.fallThrough && thenResult.currentBlock) {
                    thenResult.currentBlock.successors.push(mergeBlock);
                }
            } else {
                thenBlock.successors.push(mergeBlock);
                thenFallsThrough = true;
            }
        }

        if (!thenFallsThrough && !elseFallsThrough) {
            return { currentBlock: null, fallThrough: false };
        }
        return { currentBlock: mergeBlock, fallThrough: true };
    }

    private buildCFGWhile(
        stmt: Parser.SyntaxNode,
        currentBlock:  Block,
        blocks:  Block[],
    ): { currentBlock:  Block | null; fallThrough: boolean } {
        const body = stmt.childForFieldName('body');
        const condition = stmt.childForFieldName('condition');

        if (this.isInfiniteLoopCondition(condition)) {
            const loopBlock = this.newBlock(blocks);
            const loopExit = this.newBlock(blocks);
            currentBlock.successors.push(loopBlock);
            if (body) {
                const bodyResult = this.buildCFGStmt(body, loopBlock, loopExit, blocks, loopBlock);
                if (bodyResult.fallThrough && bodyResult.currentBlock) {
                    bodyResult.currentBlock.successors.push(loopBlock);
                }
            } else {
                loopBlock.successors.push(loopBlock);
            }
            const canBreak = this.cfgCanBreakToExit(loopBlock, loopExit, new Set());
            if (canBreak) {
                return { currentBlock: loopExit, fallThrough: true };
            }
            if (loopBlock.terminator === 'none') loopBlock.terminator = 'infinite';
            return { currentBlock: null, fallThrough: false };
        }

        const loopBlock = this.newBlock(blocks);
        const loopExit = this.newBlock(blocks);
        currentBlock.successors.push(loopBlock);
        loopBlock.successors.push(loopExit);
        if (body) {
            const bodyResult = this.buildCFGStmt(body, loopBlock, loopExit, blocks, loopBlock);
            if (bodyResult.fallThrough && bodyResult.currentBlock) {
                bodyResult.currentBlock.successors.push(loopBlock);
            }
        }
        return { currentBlock: loopExit, fallThrough: true };
    }

    private buildCFGFor(
        stmt: Parser.SyntaxNode,
        currentBlock:  Block,
        blocks:  Block[],
    ): { currentBlock:  Block | null; fallThrough: boolean } {
        const body = stmt.childForFieldName('body');
        const condition = stmt.childForFieldName('condition');

        if (!condition) {
            const loopBlock = this.newBlock(blocks);
            const loopExit = this.newBlock(blocks);
            currentBlock.successors.push(loopBlock);
            if (body) {
                const bodyResult = this.buildCFGStmt(body, loopBlock, loopExit, blocks, loopBlock);
                if (bodyResult.fallThrough && bodyResult.currentBlock) {
                    bodyResult.currentBlock.successors.push(loopBlock);
                }
            } else {
                loopBlock.successors.push(loopBlock);
            }
            const canBreak = this.cfgCanBreakToExit(loopBlock, loopExit, new Set());
            if (canBreak) {
                return { currentBlock: loopExit, fallThrough: true };
            }
            if (loopBlock.terminator === 'none') loopBlock.terminator = 'infinite';
            return { currentBlock: null, fallThrough: false };
        }

        const loopBlock = this.newBlock(blocks);
        const loopExit = this.newBlock(blocks);
        currentBlock.successors.push(loopBlock);
        loopBlock.successors.push(loopExit);
        if (body) {
            const bodyResult = this.buildCFGStmt(body, loopBlock, loopExit, blocks, loopBlock);
            if (bodyResult.fallThrough && bodyResult.currentBlock) {
                bodyResult.currentBlock.successors.push(loopBlock);
            }
        }
        return { currentBlock: loopExit, fallThrough: true };
    }

    private buildCFGDoWhile(
        stmt: Parser.SyntaxNode,
        currentBlock:  Block,
        blocks:  Block[],
    ): { currentBlock:  Block | null; fallThrough: boolean } {
        const body = stmt.childForFieldName('body');
        const condition = stmt.childForFieldName('condition');

        if (this.isInfiniteLoopCondition(condition)) {
            const loopBlock = this.newBlock(blocks);
            const loopExit = this.newBlock(blocks);
            currentBlock.successors.push(loopBlock);
            if (body) {
                const bodyResult = this.buildCFGStmt(body, loopBlock, loopExit, blocks, loopBlock);
                if (bodyResult.fallThrough && bodyResult.currentBlock) {
                    bodyResult.currentBlock.successors.push(loopBlock);
                }
            }
            const canBreak = this.cfgCanBreakToExit(loopBlock, loopExit, new Set());
            if (canBreak) {
                return { currentBlock: loopExit, fallThrough: true };
            }
            if (loopBlock.terminator === 'none') loopBlock.terminator = 'infinite';
            return { currentBlock: null, fallThrough: false };
        }

        const loopBlock = this.newBlock(blocks);
        const loopExit = this.newBlock(blocks);
        currentBlock.successors.push(loopBlock);
        if (body) {
            const bodyResult = this.buildCFGStmt(body, loopBlock, loopExit, blocks, loopBlock);
            if (bodyResult.fallThrough && bodyResult.currentBlock) {
                bodyResult.currentBlock.successors.push(loopBlock);
                bodyResult.currentBlock.successors.push(loopExit);
            }
        }
        return { currentBlock: loopExit, fallThrough: true };
    }

    private buildCFGSwitch(
        stmt: Parser.SyntaxNode,
        currentBlock:  Block,
        blocks:  Block[],
        loopHeader?:  Block,
    ): { currentBlock:  Block | null; fallThrough: boolean } {
        const body = stmt.childForFieldName('body');
        if (!body) return { currentBlock, fallThrough: true };

        const switchExit = this.newBlock(blocks);
        const caseStatements: Parser.SyntaxNode[] = [];
        for (let i = 0; i < body.childCount; i++) {
            const child = body.child(i);
            if (child && child.type === 'case_statement') caseStatements.push(child);
        }

        let hasDefault = false;
        const caseBlocks:  Block[] = [];
        for (const caseNode of caseStatements) {
            const caseBlock = this.newBlock(blocks);
            caseBlocks.push(caseBlock);
            currentBlock.successors.push(caseBlock);
            const firstChild = caseNode.child(0);
            if (firstChild && firstChild.type === 'default') hasDefault = true;
        }

        if (!hasDefault) {
            currentBlock.successors.push(switchExit);
        }

        for (let i = 0; i < caseStatements.length; i++) {
            const caseNode = caseStatements[i];
            const caseBlock = caseBlocks[i];
            const caseStmts: Parser.SyntaxNode[] = [];
            for (let j = 0; j < caseNode.childCount; j++) {
                const child = caseNode.child(j);
                if (!child) continue;
                if (child.type === 'case' || child.type === 'default' || child.type === ':')
                    continue;
                if (
                    child.type === 'integer_literal' ||
                    child.type === 'number_literal' ||
                    child.type === 'identifier'
                )
                    continue;
                caseStmts.push(child);
            }
            if (caseStmts.length === 0) {
                if (i + 1 < caseBlocks.length) {
                    caseBlock.successors.push(caseBlocks[i + 1]);
                } else {
                    caseBlock.successors.push(switchExit);
                }
                continue;
            }
            let cur:  Block | null = caseBlock;
            let ft = true;
            for (const s of caseStmts) {
                if (!ft || !cur) break;
                const r = this.buildCFGStmt(s, cur, switchExit, blocks, loopHeader);
                cur = r.currentBlock;
                ft = r.fallThrough;
            }
            if (ft && cur) {
                cur.successors.push(switchExit);
            }
        }

        return { currentBlock: switchExit, fallThrough: true };
    }

    private cfgCanBreakToExit(block:  Block, exit:  Block, visited: Set<number>): boolean {
        if (visited.has(block.id)) return false;
        visited.add(block.id);
        for (const succ of block.successors) {
            if (succ === exit) return true;
            if (this.cfgCanBreakToExit(succ, exit, visited)) return true;
        }
        return false;
    }

    private cfgAllPathsReturn(cfg: FnCFG): boolean {
        const blockStatus = new Map<number, 'returns' | 'not_returns' | 'unknown'>();

        for (const block of cfg.blocks) {
            blockStatus.set(block.id, 'unknown');
        }

        blockStatus.set(cfg.exit.id, 'not_returns');

        for (const block of cfg.blocks) {
            if (block.terminator === 'return') {
                blockStatus.set(block.id, 'returns');
            }
        }

        let changed = true;
        while (changed) {
            changed = false;
            for (const block of cfg.blocks) {
                const status = blockStatus.get(block.id);
                if (status !== 'unknown') continue;

                if (block.successors.length === 0) {
                    blockStatus.set(block.id, 'not_returns');
                    changed = true;
                    continue;
                }

                const allReturn = block.successors.every(
                    (s) => blockStatus.get(s.id) === 'returns',
                );
                if (allReturn) {
                    blockStatus.set(block.id, 'returns');
                    changed = true;
                    continue;
                }

                const anyNotReturn = block.successors.some(
                    (s) => blockStatus.get(s.id) === 'not_returns',
                );
                if (anyNotReturn) {
                    blockStatus.set(block.id, 'not_returns');
                    changed = true;
                    continue;
                }
            }
        }

        const loopBlocks = new Set<number>();
        for (const block of cfg.blocks) {
            if (blockStatus.get(block.id) === 'unknown') {
                loopBlocks.add(block.id);
            }
        }

        const loopExitsReturn = (blockId: number, visited: Set<number>): boolean => {
            if (visited.has(blockId)) return true;
            visited.add(blockId);
            const block = cfg.blocks.find((b) => b.id === blockId);
            if (!block) return true;
            const st = blockStatus.get(blockId);
            if (st === 'returns') return true;
            if (st === 'not_returns') return false;
            for (const succ of block.successors) {
                if (loopBlocks.has(succ.id)) continue;
                if (!loopExitsReturn(succ.id, visited)) return false;
            }
            return true;
        };

        for (const blockId of loopBlocks) {
            const block = cfg.blocks.find((b) => b.id === blockId)!;
            const hasNonLoopSucc = block.successors.some((s) => !loopBlocks.has(s.id));
            if (hasNonLoopSucc) {
                const allExitsReturn = block.successors
                    .filter((s) => !loopBlocks.has(s.id))
                    .every((s) => loopExitsReturn(s.id, new Set()));
                if (allExitsReturn) {
                    blockStatus.set(blockId, 'returns');
                } else {
                    blockStatus.set(blockId, 'not_returns');
                }
            } else {
                const canReachReturn = (bid: number, v: Set<number>): boolean => {
                    if (v.has(bid)) return false;
                    v.add(bid);
                    const b = cfg.blocks.find((bb) => bb.id === bid);
                    if (!b) return false;
                    if (b.terminator === 'return') return true;
                    for (const s of b.successors) {
                        if (canReachReturn(s.id, v)) return true;
                    }
                    return false;
                };
                if (canReachReturn(blockId, new Set())) {
                    blockStatus.set(blockId, 'returns');
                } else {
                    blockStatus.set(blockId, 'not_returns');
                }
            }
        }

        let changed2 = true;
        while (changed2) {
            changed2 = false;
            for (const block of cfg.blocks) {
                const status = blockStatus.get(block.id);
                if (status !== 'unknown') continue;

                const allReturn = block.successors.every(
                    (s) => blockStatus.get(s.id) === 'returns',
                );
                if (allReturn) {
                    blockStatus.set(block.id, 'returns');
                    changed2 = true;
                    continue;
                }

                const anyNotReturn = block.successors.some(
                    (s) => blockStatus.get(s.id) === 'not_returns',
                );
                if (anyNotReturn) {
                    blockStatus.set(block.id, 'not_returns');
                    changed2 = true;
                    continue;
                }
            }
        }

        for (const block of cfg.blocks) {
            if (blockStatus.get(block.id) === 'unknown') {
                blockStatus.set(block.id, 'not_returns');
            }
        }

        return blockStatus.get(cfg.entry.id) === 'returns';
    }

    private isInfiniteLoopCondition(condition: Parser.SyntaxNode | null): boolean {
        if (!condition) return false;
        const text = condition.text.trim();
        return text === '1' || text === 'true' || text === '(1)' || text === '(true)';
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
                throw new Error(
                    `ISR frame overflow in shared memory: ${finfo.name} needs ${finfo.frameSize} bytes`,
                );
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
                const lineIdx = this.asmLines.findIndex(
                    (l) => l === `${asmName} EQU ADDR_${asmName}`,
                );
                if (lineIdx >= 0) {
                    this.asmLines[lineIdx] =
                        `${asmName} EQU 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
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
            if (
                line.startsWith('STATUS EQU') ||
                line.startsWith('FSR EQU') ||
                line.startsWith('INDF EQU') ||
                line.startsWith('PCLATH EQU') ||
                line.startsWith('ISR_')
            ) {
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
            if (sym.typeInfo.isArray) {
                for (let i = 0; i < sym.typeInfo.arraySize; i++) {
                    this.asmLines.push(
                        `${sym.asmName}_${i} EQU 0x${(sym.ramAddr + i).toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                }
            } else {
                this.asmLines.push(
                    `${sym.asmName} EQU 0x${sym.ramAddr.toString(16).toUpperCase().padStart(2, '0')}`,
                );
            }
        }
        for (const [, fn] of this.fns) {
            for (const [, sym] of fn.localSymbols) {
                if (!sym.typeInfo.isArray) {
                    this.asmLines.push(
                        `${sym.asmName} EQU 0x${sym.ramAddr.toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                } else {
                    for (let i = 0; i < sym.typeInfo.arraySize; i++) {
                        this.asmLines.push(
                            `${sym.asmName}_${i} EQU 0x${(sym.ramAddr + i).toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    }
                }
            }
            for (let i = 0; i < fn.tempCount; i++) {
                const asmName = `${fn.asmName}_T${i}`;
                this.asmLines.push(`${asmName} EQU ADDR_${asmName}`);
            }
        }
        // this.asmLines.push('');
    }

    private allocRam(size: number): number {
        const addr = this.nextRamAddr;
        if (this.currentBank === 0 && addr + size - 1 > RAM_GP_END) {
            this.currentBank = 1;
            this.nextRamAddr = 0xa0;
            return this.allocRam(size);
        }
        if (this.currentBank === 1 && addr + size - 1 > 0xef) {
            throw new Error(
                `Out of RAM: need ${size} bytes from 0x${addr.toString(16)}, no more banks available`,
            );
        }
        this.nextRamAddr += size;
        return addr;
    }

    private getBankForAddr(addr: number): number {
        if (addr >= 0x80 && addr <= 0xef) return 1; // Bank1 SFR
        if (addr >= 0x70 && addr <= 0xff) return -1; // 0x70-0x7F通用RAM + 0xF0-0xFF快速存储区
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
        if (!sym.typeInfo.isArray) {
            this.emitLdSymToA(sym);
            if (index === 0) {
                this.emitIndirectRead();
            } else {
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                this.asmLines.push(
                    `ADDIA 0x${(index & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                );
                this.emitIndirectRead();
            }
            return;
        }
        this.ensureBank(sym.ramAddr);
        this.asmLines.push(`LD A,${sym.asmName}_${index}`);
    }

    private emitLdAToArrayElem(sym: Sym, index: number) {
        if (!sym.typeInfo.isArray) {
            const t = this.allocTemp();
            this.emitLdAToTemp(t);
            this.emitLdSymToA(sym);
            if (index !== 0) {
                this.asmLines.push(
                    `ADDIA 0x${(index & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                );
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

    private processGlobalDeclaration(node: Parser.SyntaxNode) {
        const typeNode = node.childForFieldName('type');
        if (!typeNode) return;

        const type = this.resolveType(typeNode);
        const declarators: Parser.SyntaxNode[] = [];
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (
                child &&
                child.isNamed &&
                child.type !== 'sized_type_specifier' &&
                child.type !== 'primitive_type' &&
                child.type !== 'type_identifier'
            ) {
                declarators.push(child);
            }
        }

        for (const declaratorNode of declarators) {
            const { name } = this.parseDeclarator(declaratorNode);
            const ti = this.resolveTypeInfo(typeNode, declaratorNode);
            const size = ti.isArray ? ti.arraySize : 1;

            if (this.globalSymbols.has(name)) {
                throw new Error(`Global variable '${name}' is already defined at ${this.posStr(declaratorNode)}`);
            }

            const addr = this.allocRam(size);
            const asmName = toAsmName(name);

            this.globalSymbols.set(name, {
                name,
                asmName,
                typeInfo: ti,
                ramAddr: addr,
                bank: this.getBankForAddr(addr),
                isParam: false,
                paramIndex: 0,
                frameOffset: -1,
                isStatic: false,
            });

            const initDecl = this.findNodeByType(declaratorNode, 'init_declarator');
            const actualDeclarator = initDecl || declaratorNode;
            const valueNode = actualDeclarator.childForFieldName
                ? actualDeclarator.childForFieldName('value')
                : null;
            if (valueNode) {
                if (ti.isArray && valueNode.type === 'initializer_list') {
                    const values: number[] = [];
                    const flattenGlobalInitList = (listNode: Parser.SyntaxNode) => {
                        for (let i = 0; i < listNode.childCount; i++) {
                            const child = listNode.child(i);
                            if (
                                !child ||
                                child.type === ',' ||
                                child.type === '{' ||
                                child.type === '}'
                            )
                                continue;
                            if (child.type === 'initializer_list') {
                                flattenGlobalInitList(child);
                            } else {
                                const constVal = this.getConstantValue(child);
                                if (constVal !== null) {
                                    values.push(constVal & 0xff);
                                }
                            }
                        }
                    };
                    flattenGlobalInitList(valueNode);
                    this.globalInits.push({
                        asmName,
                        value: 0,
                        isArray: true,
                        ramAddr: addr,
                        arrayValues: values,
                    });
                } else {
                    const constVal = this.getConstantValue(valueNode);
                    if (constVal !== null) {
                        this.globalInits.push({
                            asmName,
                            value: constVal & 0xff,
                            isArray: false,
                            ramAddr: addr,
                        });
                    } else {
                        const addrVal = this.getGlobalAddressValue(valueNode);
                        if (addrVal !== null) {
                            this.globalInits.push({
                                asmName,
                                value: addrVal & 0xff,
                                isArray: false,
                                ramAddr: addr,
                            });
                        } else {
                            throw new Error(
                                `Global variable '${name}' initializer must be a constant expression (got: ${valueNode.text.trim()})`,
                            );
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

        const returnIsPointer = this.isPointerDeclarator(declaratorNode) ||
            (typeNode.type === 'type_identifier' && (() => {
                const td = this.lookupTypedef(typeNode.text.trim());
                return td !== null && td.isPointer;
            })());

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

        const fn: Fn = {
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
            allPathsReturn: false,
            frameSize: 0,
            frameBase: -1,
            returnIsPointer,
            labels: new Map(),
            gotoTargets: new Set(),
            definedLabels: new Set(),
            localTypedefs: new Map(),
        };

        let frameOffset = 0;

        let paramIdx = 0;
        for (const p of params) {
            fn.localSymbols.set(p.name, {
                name: p.name,
                asmName: p.asmName,
                typeInfo: {
                    type: p.type,
                    isArray: false,
                    arraySize: 0,
                    dimensions: [],
                    isPointer: p.isPointer,
                },
                ramAddr: -1,
                bank: -1,
                isParam: true,
                paramIndex: paramIdx++,
                frameOffset: frameOffset++,
                isStatic: false,
            });
        }

        if (bodyNode) frameOffset = this.collectLocalDeclarations(bodyNode, fn, frameOffset);

        fn.frameSize = frameOffset;
        if (this.fns.has(funcName)) {
            throw new Error(`Function '${funcName}' is already defined at ${this.posStr(node)}`);
        }
        this.fns.set(funcName, fn);
    }

    private collectLocalDeclarations(node: Parser.SyntaxNode, fn: Fn, frameOffset: number): number {
        if (node.type === 'declaration') {
            const typeNode = node.childForFieldName('type');
            if (!typeNode) return frameOffset;

            let isStatic = false;
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (
                    child &&
                    child.type === 'storage_class_specifier' &&
                    child.text.trim() === 'static'
                ) {
                    isStatic = true;
                    break;
                }
            }

            const type = this.resolveType(typeNode);
            const declarators: Parser.SyntaxNode[] = [];
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (
                    child &&
                    child.isNamed &&
                    child.type !== 'sized_type_specifier' &&
                    child.type !== 'primitive_type' &&
                    child.type !== 'storage_class_specifier' &&
                    child.type !== 'type_identifier'
                ) {
                    declarators.push(child);
                }
            }

            let offset = frameOffset;
            for (const declaratorNode of declarators) {
                const { name } = this.parseDeclarator(declaratorNode);
                const ti = this.resolveTypeInfo(typeNode, declaratorNode);
                const size = ti.isArray ? ti.arraySize : 1;
                const asmName = toAsmName(fn.name + '_' + name);

                if (fn.localSymbols.has(name)) {
                    throw new Error(
                        `Variable '${name}' redeclared in function '${fn.name}' (shadowing not supported)`,
                    );
                }

                if (isStatic) {
                    const addr = this.allocRam(size);
                    fn.localSymbols.set(name, {
                        name,
                        asmName,
                        typeInfo: ti,
                        ramAddr: addr,
                        bank: this.getBankForAddr(addr),
                        isParam: false,
                        paramIndex: 0,
                        frameOffset: -1,
                        isStatic: true,
                    });
                    const initDecl = this.findNodeByType(declaratorNode, 'init_declarator');
                    if (initDecl) {
                        const valueNode = initDecl.childForFieldName('value');
                        if (valueNode) {
                            const constVal = this.getConstantValue(valueNode);
                            if (constVal !== null) {
                                this.globalInits.push({
                                    asmName,
                                    value: constVal & 0xff,
                                    isArray: false,
                                    ramAddr: addr,
                                });
                            }
                        }
                    } else {
                        this.globalInits.push({ asmName, value: 0, isArray: false, ramAddr: addr });
                    }
                } else {
                    fn.localSymbols.set(name, {
                        name,
                        asmName,
                        typeInfo: ti,
                        ramAddr: -1,
                        bank: -1,
                        isParam: false,
                        paramIndex: 0,
                        frameOffset: offset,
                        isStatic: false,
                    });
                    offset += size;
                }
            }
            return offset;
        }

        if (node.type === 'type_definition') {
            this.processTypedef(node);
            return frameOffset;
        }

        let offset = frameOffset;
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) offset = this.collectLocalDeclarations(child, fn, offset);
        }
        return offset;
    }

    private extractParams(
        funcDeclarator: Parser.SyntaxNode,
        funcName: string,
    ): { name: string; asmName: string; type: Type; isPointer: boolean }[] {
        const params: { name: string; asmName: string; type: Type; isPointer: boolean }[] = [];
        const paramListNode = funcDeclarator.childForFieldName('parameters');
        if (!paramListNode) return params;

        for (let i = 0; i < paramListNode.childCount; i++) {
            const child = paramListNode.child(i);
            if (!child || child.type !== 'parameter_declaration') continue;
            const pType = child.childForFieldName('type');
            const pDeclarator = child.childForFieldName('declarator');
            if (!pType || !pDeclarator) continue;
            const { name: pName, isPointer: pIsPointer } = this.parseDeclarator(pDeclarator);
            const td = pType.type === 'type_identifier' ? this.lookupTypedef(pType.text.trim()) : null;
            params.push({
                name: pName,
                asmName: toAsmName(funcName + '_' + pName),
                type: this.resolveType(pType),
                isPointer: (td && td.isPointer) || pIsPointer,
            });
        }
        return params;
    }

    private resolveType(node: Parser.SyntaxNode): Type {
        const text = node.text.trim();
        if (text === 'void') return 'void';
        if (text === 'bool') return 'bool';
        if (text === 'char' || text === 'signed char') return 'i8';
        if (text === 'unsigned char') return 'u8';

        if (
            text === 'int' ||
            text === 'short' ||
            text === 'signed int' ||
            text === 'signed short' ||
            text === 'unsigned int' ||
            text === 'unsigned short' ||
            text === 'long' ||
            text === 'unsigned' ||
            text === 'signed'
        ) {
            throw new Error(
                `Type '${text}' is not supported at ${this.posStr(node)} (only 8-bit types: char, signed char, unsigned char)`,
            );
        }

        if (text.startsWith('float') || text.startsWith('double')) {
            throw new Error(`Floating-point type '${text}' is not supported at ${this.posStr(node)}`);
        }
        if (text.startsWith('struct') || text.startsWith('union') || text.startsWith('enum')) {
            throw new Error(`Type '${text.split(/\s/)[0]}' is not supported at ${this.posStr(node)}`);
        }
        if (node.type === 'type_identifier') {
            const td = this.lookupTypedef(text);
            if (td) return td.type;
            throw new Error(`Unknown type '${text}' at ${this.posStr(node)}`);
        }
        throw new Error(`Type '${text}' is not supported at ${this.posStr(node)}`);
    }

    private lookupTypedef(name: string): TypeInfo | null {
        if (this.currentFn) {
            const local = this.currentFn.localTypedefs.get(name);
            if (local) return local;
        }
        return this.globalTypedefs.get(name) || null;
    }

    private resolveTypeInfo(typeNode: Parser.SyntaxNode, declaratorNode: Parser.SyntaxNode): TypeInfo {
        const text = typeNode.text.trim();
        const td = this.lookupTypedef(text);
        const baseType = this.resolveType(typeNode);
        const { isArray, arraySize, dimensions, isPointer: declIsPointer } = this.parseDeclarator(declaratorNode);

        if (td) {
            const mergedIsPointer = td.isPointer || declIsPointer;
            const mergedIsArray = td.isArray || isArray;
            const mergedArraySize = td.isArray ? td.arraySize : arraySize;
            const mergedDimensions = td.dimensions && td.dimensions.length > 0 ? td.dimensions : dimensions;
            return {
                type: baseType,
                isArray: mergedIsArray,
                arraySize: mergedArraySize,
                dimensions: mergedDimensions,
                isPointer: mergedIsPointer,
            };
        }

        return {
            type: baseType,
            isArray,
            arraySize,
            dimensions,
            isPointer: declIsPointer,
        };
    }

    private processTypedef(node: Parser.SyntaxNode) {
        const typeNode = node.childForFieldName('type');
        const declaratorNode = node.childForFieldName('declarator');
        if (!typeNode || !declaratorNode) return;

        const baseType = this.resolveType(typeNode);

        let isPointer = false;
        let isArray = false;
        let arraySize = 0;
        let dimensions: number[] = [];
        let name = '';

        let decl: Parser.SyntaxNode | null = declaratorNode;
        while (decl) {
            if (decl.type === 'pointer_declarator') {
                isPointer = true;
                decl = decl.childForFieldName('declarator');
                continue;
            }
            if (decl.type === 'array_declarator') {
                isArray = true;
                const sizeNode = decl.childForFieldName('size');
                const sz = sizeNode ? this.getConstantValue(sizeNode) : null;
                if (sz !== null) {
                    dimensions.unshift(sz);
                }
                decl = decl.childForFieldName('declarator');
                continue;
            }
            if (decl.type === 'type_identifier') {
                name = decl.text.trim();
                break;
            }
            if (decl.type === 'identifier') {
                name = decl.text.trim();
                break;
            }
            break;
        }

        if (!name) return;

        if (isArray && dimensions.length > 0) {
            arraySize = dimensions.reduce((a, b) => a * b, 1);
        }

        const ti: TypeInfo = {
            type: baseType,
            isArray,
            arraySize,
            dimensions: dimensions.length > 0 ? dimensions : undefined,
            isPointer,
        };

        if (this.currentFn) {
            if (this.currentFn.localTypedefs.has(name)) {
                throw new Error(`Typedef '${name}' redefined at ${this.posStr(node)}`);
            }
            this.currentFn.localTypedefs.set(name, ti);
        } else {
            if (this.globalTypedefs.has(name)) {
                throw new Error(`Typedef '${name}' redefined at ${this.posStr(node)}`);
            }
            this.globalTypedefs.set(name, ti);
        }
    }

    private parseDeclarator(node: Parser.SyntaxNode): {
        name: string;
        isArray: boolean;
        arraySize: number;
        dimensions: number[];
        isPointer: boolean;
    } {
        if (node.type === 'init_declarator') {
            const inner = node.childForFieldName('declarator');
            if (inner) return this.parseDeclarator(inner);
            return { name: '', isArray: false, arraySize: 0, dimensions: [], isPointer: false };
        }
        if (node.type === 'pointer_declarator') {
            for (let i = 0; i < node.childCount; i++) {
                const child = node.child(i);
                if (child && child.type === 'identifier') {
                    return {
                        name: child.text.trim(),
                        isArray: false,
                        arraySize: 0,
                        dimensions: [],
                        isPointer: true,
                    };
                }
                if (child && child.type === 'array_declarator') {
                    const r = this.parseDeclarator(child);
                    return { ...r, isPointer: true };
                }
                if (child && child.type === 'pointer_declarator') {
                    return this.parseDeclarator(child);
                }
            }
            return { name: node.text.trim(), isArray: false, arraySize: 0, dimensions: [], isPointer: true };
        }
        const arrayDecl = this.findNodeByType(node, 'array_declarator');
        if (arrayDecl) {
            const dimensions: number[] = [];
            let currentDecl: Parser.SyntaxNode | null = arrayDecl;
            while (currentDecl && currentDecl.type === 'array_declarator') {
                const sizeNode = currentDecl.childForFieldName('size');
                let dimSize = 1;
                if (sizeNode) {
                    const constVal = this.getConstantValue(sizeNode);
                    dimSize = constVal !== null ? constVal : parseInt(sizeNode.text, 10);
                    if (isNaN(dimSize) || dimSize <= 0) dimSize = 1;
                }
                dimensions.unshift(dimSize);
                currentDecl = currentDecl.childForFieldName('declarator');
            }
            const name = currentDecl ? currentDecl.text.trim() : '';
            const totalSize = dimensions.reduce((a, b) => a * b, 1);
            return {
                name,
                isArray: true,
                arraySize: totalSize,
                dimensions,
                isPointer: false,
            };
        }
        return { name: node.text.trim(), isArray: false, arraySize: 0, dimensions: [], isPointer: false };
    }

    private isPointerDeclarator(declaratorNode: Parser.SyntaxNode): boolean {
        let node: Parser.SyntaxNode | null = declaratorNode;
        while (node) {
            if (node.type === 'pointer_declarator') return true;
            if (node.type === 'function_declarator') return false;
            const inner = node.childForFieldName('declarator');
            if (!inner) break;
            node = inner;
        }
        return false;
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

    private generateCode(
        node: Parser.SyntaxNode,
        afterGlobalsAddr: number,
        afterGlobalsBank: number,
    ) {
        const noopArray: any = { push: () => {}, findIndex: () => -1, length: 0 };

        this.dryRun = true;
        const savedLines = this.asmLines;
        this.asmLines = noopArray as any;
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && child.type === 'function_definition') this.emitFn(child);
        }
        this.asmLines = savedLines;
        this.dryRun = false;

        for (const [, finfo] of this.fns) {
            finfo.savedTempCount = finfo.tempCount;
            finfo.frameSize += finfo.tempCount;
        }
        for (const [, finfo] of this.fns) {
            finfo.frameBase = -1;
            finfo.gotoTargets = new Set();
            finfo.definedLabels = new Set();
            finfo.localTypedefs = new Map();
        }
        this.nextRamAddr = afterGlobalsAddr;
        this.currentBank = afterGlobalsBank;
        this.allocateCompiledStack();

        this.asmLines = [];

        this.emitHeader();
        this.emitRamDefinitions();

        const hasISR = this.hasISRFn();
        this.asmLines.push('JP V_MAIN');
        if (hasISR) {
            this.asmLines.push('ORG 0x04');
            this.asmLines.push('JP __INTERRUPT');
        }

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && child.type === 'function_definition') this.emitFn(child);
        }

        for (const [fnName, fn] of this.fns) {
            for (const target of fn.gotoTargets) {
                if (!fn.definedLabels.has(target)) {
                    throw new Error(`Undefined label '${target}' in function '${fnName}'`);
                }
            }
        }

        this.resolveTempAddresses();
        this.emitOutput();
    }

    private emitGlobalInits() {
        for (const init of this.globalInits) {
            this.ensureBank(init.ramAddr);
            if (init.isArray && init.arrayValues) {
                for (let i = 0; i < init.arrayValues.length; i++) {
                    this.asmLines.push(
                        `LDIA 0x${init.arrayValues[i].toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                    this.asmLines.push(`LD ${init.asmName}_${i},A`);
                }
            } else {
                this.asmLines.push(
                    `LDIA 0x${init.value.toString(16).toUpperCase().padStart(2, '0')}`,
                );
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

        const fn = this.fns.get(funcName);
        if (!fn) throw new Error(`Function ${funcName} not found`);

        this.currentFn = fn;
        this.tempCounter = 0;
        fn.tempCount = 0;
        this.currentAsmBank = 0;

        if (!this.dryRun) {
            this.currentSourceLine = this.mapPos(node.startPosition.row, node.startPosition.column).line;
            this.asmLines.push(`;@LINE ${this.currentSourceLine}`);
            this.asmLines.push(`;@FN_START ${funcName}`);
        }
        this.asmLines.push(`${fn.asmName}:`);

        if (fn.isISR) {
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
        if (bodyNode) this.emitCompoundStatement(bodyNode, fn);

        if (funcName === 'main') {
            this.asmLines.push('STOP');
        } else if (fn.isISR) {
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
        }
        if (!this.dryRun) {
            this.asmLines.push(`;@FN_END ${funcName}`);
        }

        this.currentFn = null;
    }

    private emitCompoundStatement(node: Parser.SyntaxNode, fn: Fn) {
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child) continue;
            if (child.type === '{' || child.type === '}') continue;
            this.emitStatement(child, fn);
        }
    }

    private emitStatement(node: Parser.SyntaxNode, fn: Fn) {
        if (!this.dryRun) {
            this.currentSourceLine = this.mapPos(node.startPosition.row, node.startPosition.column).line;
            this.asmLines.push(`;@LINE ${this.currentSourceLine}`);
        }
        switch (node.type) {
            case 'expression_statement':
                this.emitExpressionStatement(node, fn);
                break;
            case 'if_statement':
                this.emitIfStatement(node, fn);
                break;
            case 'while_statement':
                this.emitWhileStatement(node, fn);
                break;
            case 'for_statement':
                this.emitForStatement(node, fn);
                break;
            case 'do_statement':
                this.emitDoWhileStatement(node, fn);
                break;
            case 'return_statement':
                this.emitReturnStatement(node, fn);
                break;
            case 'compound_statement':
                this.emitCompoundStatement(node, fn);
                break;
            case 'break_statement':
                this.emitBreakStatement(fn);
                break;
            case 'continue_statement':
                this.emitContinueStatement(fn);
                break;
            case 'declaration':
                this.emitDeclarationInit(node, fn);
                break;
            case 'switch_statement':
                this.emitSwitchStatement(node, fn);
                break;
            case 'goto_statement':
                this.emitGotoStatement(node, fn);
                break;
            case 'labeled_statement':
                this.emitLabeledStatement(node, fn);
                break;
            case 'type_definition':
                break;
            default:
                throw new Error(`Unsupported statement type '${node.type}' at ${this.posStr(node)}`);
        }
    }

    private emitExpressionStatement(node: Parser.SyntaxNode, fn: Fn) {
        const expr = node.child(0);
        if (expr) {
            this.emitExpression(expr, fn);
        }
    }

    private emitIfStatement(node: Parser.SyntaxNode, fn: Fn) {
        const condition = node.childForFieldName('condition');
        const consequence = node.childForFieldName('consequence');
        const alternative = node.childForFieldName('alternative');

        const elseLabel = this.newLabel(fn);
        const endLabel = this.newLabel(fn);

        if (condition) this.emitCondition(condition, fn, elseLabel, false);
        if (consequence) this.emitStatement(consequence, fn);

        if (alternative) {
            this.asmLines.push(`JP ${endLabel}`);
            this.emitLabel(elseLabel);
            if (alternative.type === 'else_clause') {
                const elseBody = this.extractElseBody(alternative);
                if (elseBody) this.emitStatement(elseBody, fn);
            } else {
                this.emitStatement(alternative, fn);
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

    private emitWhileStatement(node: Parser.SyntaxNode, fn: Fn) {
        const condition = node.childForFieldName('condition');
        const body = node.childForFieldName('body');

        const loopLabel = this.newLabel(fn);
        const endLabel = this.newLabel(fn);

        const prevBreak = fn.breakLabel;
        const prevContinue = fn.continueLabel;
        fn.breakLabel = endLabel;
        fn.continueLabel = loopLabel;

        this.emitLabel(loopLabel);
        if (condition) this.emitCondition(condition, fn, endLabel, false);
        if (body) this.emitStatement(body, fn);
        this.asmLines.push(`JP ${loopLabel}`);
        this.emitLabel(endLabel);

        fn.breakLabel = prevBreak;
        fn.continueLabel = prevContinue;
    }

    private emitDoWhileStatement(node: Parser.SyntaxNode, fn: Fn) {
        const body = node.childForFieldName('body');
        const condition = node.childForFieldName('condition');

        const loopLabel = this.newLabel(fn);
        const condLabel = this.newLabel(fn);
        const endLabel = this.newLabel(fn);

        const prevBreak = fn.breakLabel;
        const prevContinue = fn.continueLabel;
        fn.breakLabel = endLabel;
        fn.continueLabel = condLabel;

        this.emitLabel(loopLabel);
        if (body) this.emitStatement(body, fn);
        this.emitLabel(condLabel);
        if (condition) this.emitCondition(condition, fn, loopLabel, true);
        this.emitLabel(endLabel);

        fn.breakLabel = prevBreak;
        fn.continueLabel = prevContinue;
    }

    private emitSwitchStatement(node: Parser.SyntaxNode, fn: Fn) {
        const condition = node.childForFieldName('condition');
        const body = node.childForFieldName('body');
        if (!condition || !body) return;

        const endLabel = this.newLabel(fn);
        const prevBreak = fn.breakLabel;
        fn.breakLabel = endLabel;

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
            const label = this.newLabel(fn);
            caseLabels.push(label);
            const caseNode = caseStatements[i];
            const firstChild = caseNode.child(0);
            if (firstChild && firstChild.type === 'default') {
                defaultLabel = label;
            }
        }

        this.emitLoadAccumulator(condition, fn);
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
                    this.asmLines.push(
                        `HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                    );
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
                if (
                    child &&
                    child.type !== 'case' &&
                    child.type !== 'default' &&
                    child.type !== ':' &&
                    child.type !== 'number_literal' &&
                    child.type !== 'char_literal' &&
                    child.type !== 'identifier'
                ) {
                    if (
                        child.type === 'expression_statement' ||
                        child.type === 'break_statement' ||
                        child.type === 'continue_statement' ||
                        child.type === 'declaration' ||
                        child.type === 'compound_statement' ||
                        child.type === 'if_statement' ||
                        child.type === 'while_statement' ||
                        child.type === 'for_statement' ||
                        child.type === 'do_statement' ||
                        child.type === 'return_statement' ||
                        child.type === 'switch_statement' ||
                        child.type === 'goto_statement' ||
                        child.type === 'labeled_statement'
                    ) {
                        this.emitStatement(child, fn);
                    }
                }
            }
        }

        this.emitLabel(endLabel);
        fn.breakLabel = prevBreak;
    }

    private emitForStatement(node: Parser.SyntaxNode, fn: Fn) {
        const initializer = node.childForFieldName('initializer');
        const condition = node.childForFieldName('condition');
        const update = node.childForFieldName('update');
        const body = node.childForFieldName('body');

        const loopLabel = this.newLabel(fn);
        const updateLabel = this.newLabel(fn);
        const endLabel = this.newLabel(fn);

        const prevBreak = fn.breakLabel;
        const prevContinue = fn.continueLabel;
        fn.breakLabel = endLabel;
        fn.continueLabel = updateLabel;

        if (initializer) {
            if (initializer.type === 'declaration') {
                this.emitDeclarationInit(initializer, fn);
            } else {
                this.emitExpression(initializer, fn);
            }
        }

        this.emitLabel(loopLabel);
        if (condition) this.emitCondition(condition, fn, endLabel, false);
        if (body) this.emitStatement(body, fn);
        this.emitLabel(updateLabel);
        if (update) this.emitExpression(update, fn);
        this.asmLines.push(`JP ${loopLabel}`);
        this.emitLabel(endLabel);

        fn.breakLabel = prevBreak;
        fn.continueLabel = prevContinue;
    }

    private emitDeclarationInit(node: Parser.SyntaxNode, fn: Fn) {
        let isStaticDecl = false;
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (
                child &&
                child.type === 'storage_class_specifier' &&
                child.text.trim() === 'static'
            ) {
                isStaticDecl = true;
                break;
            }
        }

        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child || !child.isNamed) continue;
            if (
                child.type === 'sized_type_specifier' ||
                child.type === 'primitive_type' ||
                child.type === 'storage_class_specifier' ||
                child.type === 'type_identifier'
            )
                continue;

            const initDecl = this.findNodeByType(child, 'init_declarator');
            const actualNode = initDecl || child;
            const valueNode = actualNode.childForFieldName
                ? actualNode.childForFieldName('value')
                : null;

            const declNode = initDecl ? initDecl.childForFieldName('declarator') : child;
            let sym: Sym | null = null;
            if (declNode) {
                if (declNode.type === 'array_declarator') {
                    let idNode: Parser.SyntaxNode | null = declNode.childForFieldName('declarator');
                    while (idNode && idNode.type === 'array_declarator') {
                        idNode = idNode.childForFieldName('declarator');
                    }
                    if (idNode) sym = this.resolveSymbol(idNode, fn);
                } else if (declNode.type === 'pointer_declarator') {
                    for (let i = 0; i < declNode.childCount; i++) {
                        const child = declNode.child(i);
                        if (child && child.type === 'identifier') {
                            sym = this.resolveSymbol(child, fn);
                            break;
                        }
                        if (child && child.type === 'array_declarator') {
                            const idNode = child.childForFieldName('declarator');
                            if (idNode) sym = this.resolveSymbol(idNode, fn);
                            break;
                        }
                    }
                } else {
                    sym = this.resolveSymbol(declNode, fn);
                }
            }

            if (isStaticDecl && sym && sym.isStatic) continue;

            if (valueNode) {
                if (sym && sym.typeInfo.isArray && valueNode.type === 'initializer_list') {
                    const flatValues: Parser.SyntaxNode[] = [];
                    const flattenInitList = (listNode: Parser.SyntaxNode) => {
                        for (let j = 0; j < listNode.childCount; j++) {
                            const initChild = listNode.child(j);
                            if (
                                !initChild ||
                                initChild.type === ',' ||
                                initChild.type === '{' ||
                                initChild.type === '}'
                            )
                                continue;
                            if (initChild.type === 'initializer_list') {
                                flattenInitList(initChild);
                            } else {
                                flatValues.push(initChild);
                            }
                        }
                    };
                    flattenInitList(valueNode);
                    let elemIdx = 0;
                    for (const initChild of flatValues) {
                        const constVal = this.getConstantValue(initChild);
                        if (constVal !== null) {
                            this.asmLines.push(
                                `LDIA 0x${(constVal & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                            );
                        } else {
                            this.emitLoadAccumulator(initChild, fn);
                        }
                        this.emitLdAToArrayElem(sym, elemIdx);
                        elemIdx++;
                    }
                } else {
                    this.emitLoadAccumulator(valueNode, fn);
                    if (sym) this.emitLdAToSym(sym);
                }
            }
        }
    }

    private emitReturnStatement(node: Parser.SyntaxNode, fn: Fn) {
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
        if (value && fn.returnType === 'void') {
            throw new Error(`Function '${fn.name}' is void and should not return a value at ${this.posStr(node)}`);
        }
        if (value && fn.isISR) {
            throw new Error(`ISR function '${fn.name}' should not return a value at ${this.posStr(node)}`);
        }
        if (!value && fn.returnType !== 'void' && fn.name !== 'main' && !fn.isISR) {
            throw new Error(`Non-void function '${fn.name}' must return a value at ${this.posStr(node)}`);
        }
        if (value) this.emitLoadAccumulator(value, fn);
        if (fn.name === 'main') {
            this.asmLines.push('STOP');
        } else if (fn.isISR) {
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
        }
    }

    private emitBreakStatement(fn: Fn) {
        if (fn.breakLabel) this.asmLines.push(`JP ${fn.breakLabel}`);
    }

    private emitContinueStatement(fn: Fn) {
        if (fn.continueLabel) this.asmLines.push(`JP ${fn.continueLabel}`);
    }

    private resolveLabel(fn: Fn, labelName: string): string {
        if (!fn.labels.has(labelName)) {
            fn.labels.set(labelName, this.newLabel(fn));
        }
        return fn.labels.get(labelName)!;
    }

    private emitGotoStatement(node: Parser.SyntaxNode, fn: Fn) {
        let labelName = '';
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && (child.type === 'identifier' || child.type === 'statement_identifier')) {
                labelName = child.text.trim();
                break;
            }
        }
        if (!labelName) return;
        fn.gotoTargets.add(labelName);
        const asmLabel = this.resolveLabel(fn, labelName);
        this.asmLines.push(`JP ${asmLabel}`);
    }

    private emitLabeledStatement(node: Parser.SyntaxNode, fn: Fn) {
        const labelNode = node.child(0);
        if (labelNode) {
            const labelName = labelNode.text.trim();
            if (fn.definedLabels.has(labelName)) {
                throw new Error(`Duplicate label '${labelName}' at ${this.posStr(labelNode)}`);
            }
            fn.definedLabels.add(labelName);
            const asmLabel = this.resolveLabel(fn, labelName);
            this.emitLabel(asmLabel);
        }
        for (let i = 1; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && child.type !== ':') {
                this.emitStatement(child, fn);
            }
        }
    }

    private emitCondition(
        node: Parser.SyntaxNode,
        fn: Fn,
        targetLabel: string,
        jumpOnTrue: boolean,
    ) {
        const inner = this.unwrapParentheses(node);

        if (inner.type === 'binary_expression') {
            const operator = this.getChildByField(inner, 'operator');
            if (operator && ['==', '!=', '<', '>', '<=', '>='].includes(operator.text)) {
                this.emitComparison(inner, fn, targetLabel, jumpOnTrue);
                return;
            }
            if (operator && (operator.text === '&&' || operator.text === '||')) {
                this.emitLogicalOp(inner, fn, targetLabel, jumpOnTrue);
                return;
            }
        }

        if (inner.type === 'unary_expression') {
            const opNode = this.getChildByField(inner, 'operator');
            if (opNode && opNode.text === '!') {
                const operand = inner.childForFieldName('argument');
                if (operand) {
                    this.emitCondition(operand, fn, targetLabel, !jumpOnTrue);
                    return;
                }
            }
        }

        this.emitLoadAccumulator(inner, fn);
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

    private inferExprType(node: Parser.SyntaxNode, fn: Fn): Type {
        const inner = this.unwrapParentheses(node);
        if (inner.type === 'identifier') {
            const sym = this.resolveSymbol(inner, fn);
            if (sym) return sym.typeInfo.type;
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
            if (arg) return this.inferExprType(arg, fn);
        }
        if (inner.type === 'binary_expression') {
            const left = inner.childForFieldName('left');
            const right = inner.childForFieldName('right');
            if (left && right) {
                const lt = this.inferExprType(left, fn);
                const rt = this.inferExprType(right, fn);
                if (lt === 'i8' || rt === 'i8') return 'i8';
            }
        }
        if (inner.type === 'subscript_expression') {
            const sym = this.resolveArraySymbol(inner, fn);
            if (sym) return sym.typeInfo.type;
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
            if (arg) return this.inferExprType(arg, fn);
        }
        if (inner.type === 'assignment_expression') {
            const left = inner.childForFieldName('left');
            if (left) return this.inferExprType(left, fn);
        }
        if (inner.type === 'conditional_expression') {
            const consequent = inner.childForFieldName('consequence');
            if (consequent) return this.inferExprType(consequent, fn);
        }
        return 'u8';
    }

    private emitComparison(
        node: Parser.SyntaxNode,
        fn: Fn,
        targetLabel: string,
        jumpOnTrue: boolean,
    ) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const operator = this.getChildByField(node, 'operator');
        if (!left || !right || !operator) return;

        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);
        const isSigned =
            this.inferExprType(left, fn) === 'i8' || this.inferExprType(right, fn) === 'i8';

        if (isSigned && ['<', '>', '<=', '>='].includes(operator.text)) {
            this.emitSignedComparison(left, right, operator.text, fn, targetLabel, jumpOnTrue);
            return;
        }

        if (rightConst !== null) {
            this.emitLoadAccumulator(left, fn);
            this.asmLines.push(
                `HSUBIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`,
            );
        } else if (leftConst !== null) {
            const reversedOp: Record<string, string> = {
                '<': '>',
                '>': '<',
                '<=': '>=',
                '>=': '<=',
                '==': '==',
                '!=': '!=',
            };
            this.emitLoadAccumulator(right, fn);
            this.asmLines.push(`HSUBIA 0x${leftConst.toString(16).toUpperCase().padStart(2, '0')}`);
            this.emitComparisonFlags(reversedOp[operator.text], fn, targetLabel, jumpOnTrue);
            return;
        } else {
            const lsym = this.resolveSymbol(left, fn);
            const rsym = this.resolveSymbol(right, fn);
            if (lsym && rsym) {
                this.emitLdSymToA(rsym);
                this.emitOpSym('SUBA', lsym);
            } else if (rsym) {
                this.emitLoadAccumulator(left, fn);
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                this.emitLdSymToA(rsym);
                this.emitOpTemp('SUBA', t);
            } else if (lsym) {
                this.emitLoadAccumulator(right, fn);
                this.emitOpSym('SUBA', lsym);
            } else {
                this.emitLoadAccumulator(left, fn);
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                this.emitLoadAccumulator(right, fn);
                this.emitOpTemp('SUBA', t);
            }
        }

        this.emitComparisonFlags(operator.text, fn, targetLabel, jumpOnTrue);
    }

    private emitSignedComparison(
        left: Parser.SyntaxNode,
        right: Parser.SyntaxNode,
        op: string,
        fn: Fn,
        targetLabel: string,
        jumpOnTrue: boolean,
    ) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);

        if (rightConst !== null) {
            this.emitLoadAccumulator(left, fn);
            this.asmLines.push('XORIA 0x80');
            this.asmLines.push(
                `HSUBIA 0x${((rightConst ^ 0x80) & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
            );
        } else if (leftConst !== null) {
            const reversedOp: Record<string, string> = {
                '<': '>',
                '>': '<',
                '<=': '>=',
                '>=': '<=',
            };
            this.emitLoadAccumulator(right, fn);
            this.asmLines.push('XORIA 0x80');
            this.asmLines.push(
                `HSUBIA 0x${((leftConst ^ 0x80) & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
            );
            this.emitComparisonFlags(reversedOp[op], fn, targetLabel, jumpOnTrue);
            return;
        } else {
            this.emitLoadAccumulator(right, fn);
            this.asmLines.push('XORIA 0x80');
            const t = this.allocTemp();
            this.emitLdAToTemp(t);
            this.emitLoadAccumulator(left, fn);
            this.asmLines.push('XORIA 0x80');
            this.emitOpTemp('HSUBA', t);
        }

        this.emitComparisonFlags(op, fn, targetLabel, jumpOnTrue);
    }

    private emitComparisonFlags(op: string, fn: Fn, targetLabel: string, jumpOnTrue: boolean) {
        if (op === '<') {
            if (jumpOnTrue) {
                this.asmLines.push('SNZB STATUS,0');
                this.asmLines.push(`JP ${targetLabel}`);
            } else {
                this.asmLines.push('SZB STATUS,0');
                this.asmLines.push(`JP ${targetLabel}`);
            }
        } else if (op === '>') {
            if (jumpOnTrue) {
                const cont = this.newLabel(fn);
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
                const cont = this.newLabel(fn);
                this.asmLines.push('SNZB STATUS,0');
                this.asmLines.push(`JP ${cont}`);
                this.asmLines.push('SZB STATUS,2');
                this.asmLines.push(`JP ${cont}`);
                this.asmLines.push(`JP ${targetLabel}`);
                this.emitLabel(cont);
            }
        } else if (op === '>=') {
            if (jumpOnTrue) {
                this.asmLines.push('SZB STATUS,0');
                this.asmLines.push(`JP ${targetLabel}`);
            } else {
                this.asmLines.push('SNZB STATUS,0');
                this.asmLines.push(`JP ${targetLabel}`);
            }
        } else if (op === '==') {
            if (jumpOnTrue) {
                this.asmLines.push('SZB STATUS,2');
                this.asmLines.push(`JP ${targetLabel}`);
            } else {
                this.asmLines.push('SNZB STATUS,2');
                this.asmLines.push(`JP ${targetLabel}`);
            }
        } else if (op === '!=') {
            if (jumpOnTrue) {
                this.asmLines.push('SNZB STATUS,2');
                this.asmLines.push(`JP ${targetLabel}`);
            } else {
                this.asmLines.push('SZB STATUS,2');
                this.asmLines.push(`JP ${targetLabel}`);
            }
        }
    }

    private emitLogicalOp(
        node: Parser.SyntaxNode,
        fn: Fn,
        targetLabel: string,
        jumpOnTrue: boolean,
    ) {
        const operator = this.getChildByField(node, 'operator');
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!operator || !left || !right) return;

        if (operator.text === '&&') {
            if (jumpOnTrue) {
                const fail = this.newLabel(fn);
                this.emitCondition(left, fn, fail, false);
                this.emitCondition(right, fn, targetLabel, true);
                this.emitLabel(fail);
            } else {
                this.emitCondition(left, fn, targetLabel, false);
                this.emitCondition(right, fn, targetLabel, false);
            }
        } else {
            if (jumpOnTrue) {
                this.emitCondition(left, fn, targetLabel, true);
                this.emitCondition(right, fn, targetLabel, true);
            } else {
                const pass = this.newLabel(fn);
                this.emitCondition(left, fn, pass, true);
                this.emitCondition(right, fn, targetLabel, false);
                this.emitLabel(pass);
            }
        }
    }

    private emitExpression(node: Parser.SyntaxNode, fn: Fn): void {
        const inner = this.unwrapParentheses(node);

        switch (inner.type) {
            case 'assignment_expression':
                this.emitAssignment(inner, fn);
                break;
            case 'call_expression':
                this.emitCallExpression(inner, fn);
                break;
            case 'update_expression':
                this.emitUpdateExpression(inner, fn);
                break;
            default:
                this.emitLoadAccumulator(inner, fn);
                break;
        }
    }

    private isValidLvalue(node: Parser.SyntaxNode, fn: Fn): boolean {
        const inner = this.unwrapParentheses(node);
        if (inner.type === 'identifier') {
            return this.resolveSymbol(node, fn) !== null;
        }
        if (inner.type === 'subscript_expression') return true;
        if (inner.type === 'pointer_expression') return true;
        if (inner.type === 'unary_expression') {
            const opNode = this.getChildByField(inner, 'operator');
            if (opNode && opNode.text === '*') return true;
        }
        return false;
    }

    private typeInfoToString(typeInfo: TypeInfo): string {
        let type = typeInfo.type;
        if (typeInfo.isArray) {
            const dims = typeInfo.dimensions || [typeInfo.arraySize];
            type += dims.map(d => `[${d}]`).join('');
        }
        else if (typeInfo.isPointer) type += ' *';
        return type;
    }

    private typeInfoOf(node: Parser.SyntaxNode, fn: Fn): TypeInfo {
        const inner = this.unwrapParentheses(node);

        if (inner.type === 'number_literal')
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        if (inner.type === 'char_literal')
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        if (inner.type === 'string_literal')
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: true };

        if (inner.type === 'pointer_declarator') {
            const sym = this.resolveSymbol(inner, fn);
            if (sym) return sym.typeInfo;
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: true };
        }

        if (inner.type === 'identifier') {
            const sym = this.resolveSymbol(inner, fn);
            if (!sym) return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
            return sym.typeInfo;
        }

        if (inner.type === 'pointer_expression') {
            const opNode = inner.child(0);
            if (opNode && opNode.text === '&') {
                // 取地址操作：返回指向操作数类型的指针
                const argNode = inner.child(1);
                if (argNode) {
                    const argType = this.typeInfoOf(argNode, fn);
                    return { type: argType.type, isArray: false, arraySize: 0, isPointer: true };
                }
                return { type: 'u8', isArray: false, arraySize: 0, isPointer: true };
            }
            if (opNode && opNode.text === '*') {
                const argNode = inner.child(1);
                if (argNode) {
                    const argType = this.typeInfoOf(argNode, fn);
                    if (!argType.isPointer) {
                        throw new Error(
                            `Cannot dereference non-pointer type '${this.typeInfoToString(argType)}' at ${this.posStr(argNode)}`,
                        );
                    }
                    return { type: argType.type, isArray: false, arraySize: 0, isPointer: false };
                }
                return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
            }
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'subscript_expression') {
            let checkedArray = false;
            let arrayNode = inner.childForFieldName('array');
            if (!arrayNode) arrayNode = inner.childForFieldName('argument');
            if (arrayNode) {
                const arrType = this.typeInfoOf(arrayNode, fn);
                if (!arrType.isArray && !arrType.isPointer) {
                    throw new Error(
                        `Cannot subscript type '${this.typeInfoToString(arrType)}' - not an array or pointer at ${this.posStr(arrayNode)}`,
                    );
                }
                if (arrType.isArray && arrType.dimensions && arrType.dimensions.length > 1) {
                    const remainingDims = arrType.dimensions.slice(1);
                    const remainingSize = remainingDims.reduce((a, b) => a * b, 1);
                    return { type: arrType.type, isArray: true, arraySize: remainingSize, dimensions: remainingDims, isPointer: false };
                }
                checkedArray = true;
            }
            if (!checkedArray) {
                for (let i = 0; i < inner.childCount; i++) {
                    const c = inner.child(i);
                    if (c && c.type !== '[' && c.type !== ']') {
                        const arrType = this.typeInfoOf(c, fn);
                        if (!arrType.isArray && !arrType.isPointer) {
                            throw new Error(
                                `Cannot subscript type '${this.typeInfoToString(arrType)}' - not an array or pointer at ${this.posStr(c)}`,
                            );
                        }
                        if (arrType.isArray && arrType.dimensions && arrType.dimensions.length > 1) {
                            const remainingDims = arrType.dimensions.slice(1);
                            const remainingSize = remainingDims.reduce((a, b) => a * b, 1);
                            return { type: arrType.type, isArray: true, arraySize: remainingSize, dimensions: remainingDims, isPointer: false };
                        }
                        break;
                    }
                }
            }
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'binary_expression') {
            const opNode = this.getChildByField(inner, 'operator');
            const op = opNode ? opNode.text : '';
            const left = inner.childForFieldName('left');
            const right = inner.childForFieldName('right');
            if (!left || !right)
                return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
            const leftType = this.typeInfoOf(left, fn);
            const rightType = this.typeInfoOf(right, fn);

            if (['+', '-', '*', '/', '%'].includes(op)) {
                if (leftType.isPointer || rightType.isPointer) {
                    if (op !== '+' && op !== '-') {
                        throw new Error(`Cannot use '${op}' with pointer operand at ${this.posStr(inner)}`);
                    }
                    if (leftType.isPointer && rightType.isPointer) {
                        if (op === '+') throw new Error(`Cannot add two pointers at ${this.posStr(inner)}`);
                        if (op === '-')
                            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
                    }
                    const ptrType = leftType.isPointer ? leftType : rightType;
                    return { type: ptrType.type, isArray: false, arraySize: 0, isPointer: true };
                }
                return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
            }
            if (['&', '|', '^', '<<', '>>'].includes(op)) {
                if (leftType.isPointer || rightType.isPointer) {
                    throw new Error(`Cannot use '${op}' with pointer operand at ${this.posStr(inner)}`);
                }
                return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
            }
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'unary_expression') {
            const opNode = this.getChildByField(inner, 'operator');
            const argNode = inner.childForFieldName('argument');
            const op = opNode ? opNode.text : '';
            if (argNode) {
                const argType = this.typeInfoOf(argNode, fn);
                if (op === '-' || op === '~') {
                    if (argType.isPointer) {
                        throw new Error(`Cannot use '${op}' on pointer type at ${this.posStr(inner)}`);
                    }
                }
                if (op === '&') {
                    // 取地址：返回指向操作数类型的指针
                    return { type: argType.type, isArray: false, arraySize: 0, isPointer: true };
                }
                if (op === '*') {
                    if (!argType.isPointer) {
                        throw new Error(
                            `Cannot dereference non-pointer type '${this.typeInfoToString(argType)}' at ${this.posStr(inner)}`,
                        );
                    }
                    return { type: argType.type, isArray: false, arraySize: 0, isPointer: false };
                }
            }
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'call_expression') {
            const fnNode = inner.childForFieldName('function');
            if (fnNode) {
                const fnName = fnNode.text.trim();
                const fnInfo = this.fns.get(fnName);
                if (fnInfo) {
                    if (fnInfo.returnIsPointer)
                        return { type: 'u8', isArray: false, arraySize: 0, isPointer: true };
                    if (fnInfo.returnType === 'void')
                        return { type: 'void', isArray: false, arraySize: 0, isPointer: false };
                    return {
                        type: fnInfo.returnType,
                        isArray: false,
                        arraySize: 0,
                        isPointer: false,
                    };
                }
            }
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'cast_expression') {
            const typeNode = inner.childForFieldName('type');
            if (typeNode && typeNode.text.includes('*'))
                return { type: 'u8', isArray: false, arraySize: 0, isPointer: true };
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'update_expression') {
            const updateArg = inner.childForFieldName('argument');
            if (updateArg) return this.typeInfoOf(updateArg, fn);
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'sizeof_expression')
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };

        if (inner.type === 'conditional_expression') {
            const consequent = inner.childForFieldName('consequence');
            if (consequent) return this.typeInfoOf(consequent, fn);
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'comma_expression') {
            const children = inner.children;
            for (let i = children.length - 1; i >= 0; i--) {
                const c = children[i];
                if (c && c.type !== ',' && c.type !== 'comma_expression')
                    return this.typeInfoOf(c, fn);
            }
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'assignment_expression') {
            const right = inner.childForFieldName('right');
            if (right) return this.typeInfoOf(right, fn);
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'parenthesized_expression') {
            for (let i = 0; i < inner.childCount; i++) {
                const c = inner.child(i);
                if (c && c.type !== '(' && c.type !== ')') return this.typeInfoOf(c, fn);
            }
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
    }

    private typeInfoOfLvalue(node: Parser.SyntaxNode, fn: Fn): TypeInfo {
        const inner = this.unwrapParentheses(node);

        if (inner.type === 'pointer_declarator') {
            const sym = this.resolveSymbol(inner, fn);
            if (sym) return sym.typeInfo;
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: true };
        }

        if (inner.type === 'identifier') {
            const sym = this.resolveSymbol(inner, fn);
            if (sym) return sym.typeInfo;
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'subscript_expression') {
            let checkedArray = false;
            let arrayNode = inner.childForFieldName('array');
            if (!arrayNode) arrayNode = inner.childForFieldName('argument');
            if (arrayNode) {
                const arrType = this.typeInfoOf(arrayNode, fn);
                if (!arrType.isArray && !arrType.isPointer) {
                    throw new Error(
                        `Cannot subscript type '${this.typeInfoToString(arrType)}' - not an array or pointer at ${this.posStr(arrayNode)}`,
                    );
                }
                if (arrType.isArray && (arrType.dimensions || []).length > 1) {
                    return { type: arrType.type, isArray: false, arraySize: 0, isPointer: true };
                }
                checkedArray = true;
            }
            if (!checkedArray) {
                for (let i = 0; i < inner.childCount; i++) {
                    const c = inner.child(i);
                    if (c && c.type !== '[' && c.type !== ']') {
                        const arrType = this.typeInfoOf(c, fn);
                        if (!arrType.isArray && !arrType.isPointer) {
                            throw new Error(
                                `Cannot subscript type '${this.typeInfoToString(arrType)}' - not an array or pointer at ${this.posStr(c)}`,
                            );
                        }
                        if (arrType.isArray && (arrType.dimensions || []).length > 1) {
                            return { type: arrType.type, isArray: false, arraySize: 0, isPointer: true };
                        }
                        break;
                    }
                }
            }
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
        }

        if (inner.type === 'pointer_expression') {
            const opNode = inner.child(0);
            if (opNode && opNode.text === '*') {
                const argNode = inner.child(1);
                if (argNode) {
                    const argType = this.typeInfoOf(argNode, fn);
                    if (!argType.isPointer) {
                        throw new Error(
                            `Cannot dereference non-pointer type '${this.typeInfoToString(argType)}' at ${this.posStr(argNode)}`,
                        );
                    }
                }
                return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
            }
            return { type: 'u8', isArray: false, arraySize: 0, isPointer: true };
        }

        if (inner.type === 'unary_expression') {
            const opNode = this.getChildByField(inner, 'operator');
            if (opNode && opNode.text === '*') {
                const argNode = inner.childForFieldName('argument');
                if (argNode) {
                    const argType = this.typeInfoOf(argNode, fn);
                    if (!argType.isPointer) {
                        throw new Error(
                            `Cannot dereference non-pointer type '${this.typeInfoToString(argType)}' at ${this.posStr(argNode)}`,
                        );
                    }
                }
                return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
            }
        }

        return { type: 'u8', isArray: false, arraySize: 0, isPointer: false };
    }

    private checkAssignmentCompat(leftType: TypeInfo, rightType: TypeInfo, op: string, node: Parser.SyntaxNode) {
        if (leftType.isArray) {
            throw new Error(`Cannot assign to array type '${this.typeInfoToString(leftType)}' at ${this.posStr(node)}`);
        }
        if (op !== '=' && leftType.isPointer) {
            if (op !== '+=' && op !== '-=') {
                throw new Error(`Cannot use '${op}' on pointer at ${this.posStr(node)} - only += and -= are allowed`);
            }
            if (rightType.isPointer || rightType.isArray) {
                throw new Error(
                    `Cannot ${op === '+=' ? 'add' : 'subtract'} pointer to/from pointer at ${this.posStr(node)}`,
                );
            }
        }
        if (op === '=') {
            if (
                leftType.isPointer &&
                !rightType.isPointer &&
                !rightType.isArray &&
                rightType.type !== 'u8'
            ) {
                throw new Error(
                    `Cannot assign '${this.typeInfoToString(rightType)}' to pointer type '${this.typeInfoToString(leftType)}' at ${this.posStr(node)}`,
                );
            }
            if (!leftType.isPointer && leftType.type !== 'void' && rightType.isPointer) {
                throw new Error(
                    `Cannot assign pointer to non-pointer type '${this.typeInfoToString(leftType)}' at ${this.posStr(node)}`,
                );
            }
            if (!leftType.isPointer && rightType.isArray) {
                throw new Error(
                    `Cannot assign array to non-pointer type '${this.typeInfoToString(leftType)}' at ${this.posStr(node)}`,
                );
            }
        }
    }

    private checkAllTypes(rootNode: Parser.SyntaxNode) {
        for (let i = 0; i < rootNode.childCount; i++) {
            const child = rootNode.child(i);
            if (!child || child.type !== 'function_definition') continue;
            const declaratorNode = child.childForFieldName('declarator');
            if (!declaratorNode) continue;
            const funcDeclarator = this.findNodeByType(declaratorNode, 'function_declarator');
            if (!funcDeclarator) continue;
            const nameNode = funcDeclarator.childForFieldName('declarator');
            const funcName = nameNode ? nameNode.text.trim() : '';
            const fn = this.fns.get(funcName);
            if (!fn) continue;
            const body = child.childForFieldName('body');
            if (!body) continue;
            this.checkTypesInNode(body, fn);
        }
    }

    private checkTypesInNode(node: Parser.SyntaxNode, fn: Fn) {
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (!child) continue;
            this.checkTypesInStatement(child, fn);
        }
    }

    private checkTypesInStatement(stmt: Parser.SyntaxNode, fn: Fn) {
        const inner = this.unwrapParentheses(stmt);

        if (inner.type === 'compound_statement') {
            this.checkTypesInNode(inner, fn);
            return;
        }

        if (inner.type === 'expression_statement') {
            const expr = inner.child(0);
            if (expr) this.checkTypesInExpression(expr, fn);
            return;
        }

        if (inner.type === 'declaration') {
            for (let i = 0; i < inner.childCount; i++) {
                const child = inner.child(i);
                if (child && child.type === 'init_declarator') {
                    const declarator = child.childForFieldName('declarator');
                    const value = child.childForFieldName('value');
                    if (declarator && value) {
                        const leftType = this.typeInfoOfLvalue(declarator, fn);
                        const rightType = this.typeInfoOf(value, fn);
                        this.checkAssignmentCompat(leftType, rightType, '=', declarator);
                    }
                }
            }
            return;
        }

        if (inner.type === 'if_statement') {
            const condition = inner.childForFieldName('condition');
            const consequence = inner.childForFieldName('consequence');
            const alternative = inner.childForFieldName('alternative');
            if (condition) this.checkTypesInExpression(condition, fn);
            if (consequence) this.checkTypesInStatement(consequence, fn);
            if (alternative) {
                if (alternative.type === 'else_clause') {
                    for (let i = 0; i < alternative.childCount; i++) {
                        const c = alternative.child(i);
                        if (c && c.type !== 'else') this.checkTypesInStatement(c, fn);
                    }
                } else {
                    this.checkTypesInStatement(alternative, fn);
                }
            }
            return;
        }

        if (inner.type === 'while_statement' || inner.type === 'do_statement') {
            const condition = inner.childForFieldName('condition');
            const body = inner.childForFieldName('body');
            if (condition) this.checkTypesInExpression(condition, fn);
            if (body) this.checkTypesInStatement(body, fn);
            return;
        }

        if (inner.type === 'for_statement') {
            for (let i = 0; i < inner.childCount; i++) {
                const child = inner.child(i);
                if (child && child.type === 'parenthesized_expression') {
                    for (let j = 0; j < child.childCount; j++) {
                        const init = child.child(j);
                        if (init) this.checkTypesInExpression(init, fn);
                    }
                }
                if (child && child.type === 'compound_statement') {
                    this.checkTypesInStatement(child, fn);
                }
            }
            return;
        }

        if (inner.type === 'switch_statement') {
            const condition = inner.childForFieldName('condition');
            const body = inner.childForFieldName('body');
            if (condition) this.checkTypesInExpression(condition, fn);
            if (body) this.checkTypesInNode(body, fn);
            return;
        }

        if (inner.type === 'return_statement') {
            for (let i = 0; i < inner.childCount; i++) {
                const child = inner.child(i);
                if (child && child.type !== ';' && child.type !== 'return') {
                    this.checkTypesInExpression(child, fn);
                    const retType = this.typeInfoOf(child, fn);
                    if (fn.returnType === 'void' && retType.type !== 'void') {
                        throw new Error(`void function cannot return a value at ${this.posStr(child)}`);
                    }
                    if (fn.returnType !== 'void' && !fn.returnIsPointer && retType.isPointer) {
                        throw new Error(`Cannot return pointer from non-pointer function at ${this.posStr(child)}`);
                    }
                    if (fn.returnType !== 'void' && !fn.returnIsPointer && retType.isArray) {
                        throw new Error(`Cannot return array from function at ${this.posStr(child)}`);
                    }
                    if (
                        fn.returnIsPointer &&
                        !retType.isPointer &&
                        !retType.isArray &&
                        retType.type !== 'u8'
                    ) {
                        throw new Error(
                            `Cannot return '${this.typeInfoToString(retType)}' from pointer function at ${this.posStr(child)}`,
                        );
                    }
                }
            }
            return;
        }

        for (let i = 0; i < inner.childCount; i++) {
            const child = inner.child(i);
            if (child) this.checkTypesInStatement(child, fn);
        }
    }

    private checkTypesInExpression(expr: Parser.SyntaxNode, fn: Fn) {
        const inner = this.unwrapParentheses(expr);

        if (inner.type === 'assignment_expression') {
            const left = inner.childForFieldName('left');
            const right = inner.childForFieldName('right');
            const opNode = this.getChildByField(inner, 'operator');
            const op = opNode ? opNode.text : '=';
            if (left && right) {
                const leftType = this.typeInfoOfLvalue(left, fn);
                const rightType = this.typeInfoOf(right, fn);
                this.checkAssignmentCompat(leftType, rightType, op, left);
                this.checkTypesInExpression(left, fn);
                this.checkTypesInExpression(right, fn);
            }
            return;
        }

        if (inner.type === 'binary_expression') {
            const left = inner.childForFieldName('left');
            const right = inner.childForFieldName('right');
            if (left) this.checkTypesInExpression(left, fn);
            if (right) this.checkTypesInExpression(right, fn);
            this.typeInfoOf(inner, fn);
            return;
        }

        if (inner.type === 'unary_expression') {
            const arg = inner.childForFieldName('argument');
            if (arg) this.checkTypesInExpression(arg, fn);
            this.typeInfoOf(inner, fn);
            return;
        }

        if (inner.type === 'pointer_expression') {
            const argNode = inner.child(1);
            if (argNode) this.checkTypesInExpression(argNode, fn);
            this.typeInfoOf(inner, fn);
            return;
        }

        if (inner.type === 'update_expression') {
            const arg = inner.childForFieldName('argument');
            if (arg) this.checkTypesInExpression(arg, fn);
            this.typeInfoOf(inner, fn);
            return;
        }

        if (inner.type === 'call_expression') {
            const argsNode = inner.childForFieldName('arguments');
            if (argsNode) {
                for (let i = 0; i < argsNode.childCount; i++) {
                    const arg = argsNode.child(i);
                    if (arg && arg.type !== ',' && arg.type !== '(' && arg.type !== ')') {
                        this.checkTypesInExpression(arg, fn);
                    }
                }
            }
            return;
        }

        if (inner.type === 'conditional_expression') {
            const condition = inner.childForFieldName('condition');
            const consequence = inner.childForFieldName('consequence');
            const alternative = inner.childForFieldName('alternative');
            if (condition) this.checkTypesInExpression(condition, fn);
            if (consequence) this.checkTypesInExpression(consequence, fn);
            if (alternative) this.checkTypesInExpression(alternative, fn);
            return;
        }

        if (inner.type === 'comma_expression') {
            for (let i = 0; i < inner.childCount; i++) {
                const child = inner.child(i);
                if (child && child.type !== ',') this.checkTypesInExpression(child, fn);
            }
            return;
        }

        if (inner.type === 'cast_expression') {
            const value = inner.childForFieldName('value');
            if (value) this.checkTypesInExpression(value, fn);
            return;
        }

        if (inner.type === 'subscript_expression') {
            this.typeInfoOf(inner, fn);
            const arrayNode = inner.childForFieldName('array');
            const indexNode = inner.childForFieldName('index');
            if (arrayNode) this.checkTypesInExpression(arrayNode, fn);
            if (indexNode) this.checkTypesInExpression(indexNode, fn);
            return;
        }

        if (inner.type === 'parenthesized_expression') {
            for (let i = 0; i < inner.childCount; i++) {
                const child = inner.child(i);
                if (child && child.type !== '(' && child.type !== ')') {
                    this.checkTypesInExpression(child, fn);
                }
            }
            return;
        }

        for (let i = 0; i < inner.childCount; i++) {
            const child = inner.child(i);
            if (child) this.checkTypesInExpression(child, fn);
        }
    }

    private emitAssignment(node: Parser.SyntaxNode, fn: Fn) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const operator = this.getChildByField(node, 'operator');
        if (!left || !right || !operator) return;

        const op = operator.text;
        const innerLeft = this.unwrapParentheses(left);

        if (op === '=') {
            if (innerLeft.type === 'subscript_expression') {
                this.emitArrayStore(innerLeft, right, fn);
            } else if (innerLeft.type === 'pointer_expression') {
                const addr = this.extractAddr(innerLeft);
                if (addr !== null) {
                    this.emitLoadAccumulator(right, fn);
                    const equAddr = addr & 0x7f;
                    this.ensureBank(addr);
                    this.asmLines.push(
                        `LD 0x${equAddr.toString(16).toUpperCase().padStart(2, '0')},A`,
                    );
                } else {
                    const opNode = innerLeft.child(0);
                    const argNode = innerLeft.child(1);
                    if (opNode && opNode.text === '*' && argNode) {
                        this.emitLoadAccumulator(right, fn);
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(argNode, fn);
                        this.emitIndirectSetFSR();
                        this.emitLdTempToA(t);
                        this.asmLines.push('LD INDF,A');
                    }
                }
            } else if (innerLeft.type === 'unary_expression') {
                const opNode = this.getChildByField(innerLeft, 'operator');
                const argNode = innerLeft.childForFieldName('argument');
                if (opNode && opNode.text === '*' && argNode) {
                    this.emitLoadAccumulator(right, fn);
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.emitLoadAccumulator(argNode, fn);
                    this.emitIndirectSetFSR();
                    this.emitLdTempToA(t);
                    this.asmLines.push('LD INDF,A');
                } else {
                    this.emitLoadAccumulator(right, fn);
                    const sym = this.resolveSymbol(left, fn);
                    if (sym) this.emitLdAToSym(sym);
                }
            } else {
                this.emitLoadAccumulator(right, fn);
                const sym = this.resolveSymbol(left, fn);
                if (sym) this.emitLdAToSym(sym);
                else throw new Error(`Cannot assign to '${left.text.trim()}' at ${this.posStr(left)} - not an lvalue`);
            }
            return;
        }

        if (innerLeft.type === 'subscript_expression') {
            this.emitArrayCompoundAssign(innerLeft, right, fn, op);
            return;
        }

        if (innerLeft.type === 'pointer_expression') {
            this.emitPointerCompoundAssign(innerLeft, right, fn, op);
            return;
        }

        if (innerLeft.type === 'unary_expression') {
            const uOp = this.getChildByField(innerLeft, 'operator');
            const uArg = innerLeft.childForFieldName('argument');
            if (uOp && uOp.text === '*' && uArg) {
                this.emitPointerCompoundAssignUnary(uArg, right, fn, op);
                return;
            }
        }

        const sym = this.resolveSymbol(left, fn);
        if (!sym) throw new Error(`Cannot assign to '${left.text.trim()}' at ${this.posStr(left)} - not an lvalue`);

        if (['+=', '-=', '&=', '|=', '^='].includes(op)) {
            this.emitLoadAccumulator(left, fn);
            const constVal = this.getConstantValue(right);
            switch (op) {
                case '+=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ADDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ADDA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ADDA', t);
                        }
                    }
                    break;
                case '-=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) {
                            this.emitOpSym('HSUBA', rsym);
                        } else {
                            this.emitLoadAccumulator(right, fn);
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(left, fn);
                            this.emitOpTemp('HSUBA', t);
                        }
                    }
                    break;
                case '&=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ANDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ANDA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ANDA', t);
                        }
                    }
                    break;
                case '|=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ORA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ORA', t);
                        }
                    }
                    break;
                case '^=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `XORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('XORA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('XORA', t);
                        }
                    }
                    break;
            }
            this.emitLdAToSym(sym);
        } else if (op === '<<=' || op === '>>=') {
            this.emitShiftAssign(sym, right, fn, op === '>>=');
        } else if (op === '*=' || op === '/=' || op === '%=') {
            this.emitArithAssign(sym, left, right, fn, op);
        }
    }

    private emitArrayStore(arrayNode: Parser.SyntaxNode, valueNode: Parser.SyntaxNode, fn: Fn) {
        const { baseSym, indexNodes } = this.resolveMultiDimSubscript(arrayNode, fn);
        if (!baseSym || indexNodes.length === 0) return;

        const dims = baseSym.typeInfo.dimensions || (baseSym.typeInfo.isArray ? [baseSym.typeInfo.arraySize] : []);

        if (indexNodes.length > 1 && dims.length >= indexNodes.length) {
            this.emitMultiDimOffsetStore(baseSym, dims, indexNodes, valueNode, fn);
            return;
        }

        const indexNode = indexNodes[0];
        const constIndex = this.getConstantValue(indexNode);
        if (constIndex !== null) {
            this.emitLoadAccumulator(valueNode, fn);
            this.emitLdAToArrayElem(baseSym, constIndex);
            return;
        }

        const t = this.allocTemp();
        this.emitLoadAccumulator(valueNode, fn);
        this.emitLdAToTemp(t);
        this.emitLoadAccumulator(indexNode, fn);
        const t2 = this.allocTemp();
        this.emitLdAToTemp(t2);
        if (baseSym.typeInfo.isArray) {
            this.asmLines.push(
                `LDIA 0x${(baseSym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
            );
            this.emitOpTemp('ADDA', t2);
        } else {
            this.emitLdSymToA(baseSym);
            this.emitOpTemp('ADDA', t2);
        }
        this.asmLines.push('CLRB STATUS,5');
        this.currentAsmBank = 0;
        this.asmLines.push('LD FSR,A');
        this.emitLdTempToA(t);
        this.asmLines.push('LD INDF,A');
    }

    private emitPointerCompoundAssign(
        left: Parser.SyntaxNode,
        right: Parser.SyntaxNode,
        fn: Fn,
        op: string,
    ) {
        const opNode = left.child(0);
        const argNode = left.child(1);
        if (!opNode || !argNode || opNode.text !== '*') return;

        if (['+=', '-=', '&=', '|=', '^='].includes(op)) {
            this.emitLoadAccumulator(left, fn);
            const constVal = this.getConstantValue(right);
            switch (op) {
                case '+=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ADDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ADDA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ADDA', t);
                        }
                    }
                    break;
                case '-=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('HSUBA', rsym);
                        else {
                            this.emitLoadAccumulator(right, fn);
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(left, fn);
                            this.emitOpTemp('HSUBA', t);
                        }
                    }
                    break;
                case '&=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ANDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ANDA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ANDA', t);
                        }
                    }
                    break;
                case '|=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ORA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ORA', t);
                        }
                    }
                    break;
                case '^=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `XORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('XORA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('XORA', t);
                        }
                    }
                    break;
            }
            const t = this.allocTemp();
            this.emitLdAToTemp(t);
            this.emitLoadAccumulator(argNode, fn);
            this.emitIndirectSetFSR();
            this.emitLdTempToA(t);
            this.asmLines.push('LD INDF,A');
        } else if (op === '<<=' || op === '>>=') {
            const t0 = this.allocTemp();
            this.emitLoadAccumulator(left, fn);
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
                this.emitLoadAccumulator(right, fn);
                this.emitLdAToTemp(t1);
                const loopLabel = this.newLabel(fn);
                const doneLabel = this.newLabel(fn);
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
            this.emitLoadAccumulator(argNode, fn);
            this.emitIndirectSetFSR();
            this.emitLdTempToA(t0);
            this.asmLines.push('LD INDF,A');
        } else if (op === '*=' || op === '/=' || op === '%=') {
            this.emitLoadAccumulator(left, fn);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            if (op === '*=') {
                this.emitMultiply(left, right, fn);
            } else if (op === '/=') {
                this.emitDivide(left, right, fn);
            } else {
                this.emitModulo(left, right, fn);
            }
            const tResult = this.allocTemp();
            this.emitLdAToTemp(tResult);
            this.emitLoadAccumulator(argNode, fn);
            this.emitIndirectSetFSR();
            this.emitLdTempToA(tResult);
            this.asmLines.push('LD INDF,A');
        }
    }

    private emitPointerCompoundAssignUnary(
        argNode: Parser.SyntaxNode,
        right: Parser.SyntaxNode,
        fn: Fn,
        op: string,
    ) {
        if (['+=', '-=', '&=', '|=', '^='].includes(op)) {
            this.emitLoadAccumulator(argNode, fn);
            this.emitIndirectSetFSR();
            this.asmLines.push('LD A,INDF');
            const constVal = this.getConstantValue(right);
            switch (op) {
                case '+=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ADDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ADDA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ADDA', t);
                        }
                    }
                    break;
                case '-=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('HSUBA', rsym);
                        else {
                            this.emitLoadAccumulator(right, fn);
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(argNode, fn);
                            this.emitIndirectSetFSR();
                            this.asmLines.push('LD A,INDF');
                            this.emitOpTemp('HSUBA', t);
                        }
                    }
                    break;
                case '&=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ANDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ANDA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ANDA', t);
                        }
                    }
                    break;
                case '|=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ORA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ORA', t);
                        }
                    }
                    break;
                case '^=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `XORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('XORA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('XORA', t);
                        }
                    }
                    break;
            }
            this.asmLines.push('LD INDF,A');
        }
    }

    private emitArrayCompoundAssign(
        left: Parser.SyntaxNode,
        right: Parser.SyntaxNode,
        fn: Fn,
        op: string,
    ) {
        const { baseSym, indexNodes } = this.resolveMultiDimSubscript(left, fn);
        if (!baseSym || indexNodes.length === 0) return;

        const dims = baseSym.typeInfo.dimensions || (baseSym.typeInfo.isArray ? [baseSym.typeInfo.arraySize] : []);
        const isMultiDim = indexNodes.length > 1 && dims.length >= indexNodes.length;

        if (isMultiDim) {
            this.emitMultiDimCompoundAssign(baseSym, dims, indexNodes, right, fn, op);
            return;
        }

        const arraySym = baseSym;
        let indexNode: Parser.SyntaxNode | null = indexNodes[0];
        if (!indexNode) return;

        const constIndex = this.getConstantValue(indexNode);
        const constVal = this.getConstantValue(right);
        const isSigned = arraySym.typeInfo.type === 'i8';

        if (['+=', '-=', '&=', '|=', '^='].includes(op)) {
            if (constIndex !== null) {
                this.emitLdArrayElemToA(arraySym, constIndex);
            } else {
                this.emitArrayLoad(left, fn);
            }
            switch (op) {
                case '+=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ADDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ADDA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ADDA', t);
                        }
                    }
                    break;
                case '-=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('HSUBA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('SUBA', t);
                        }
                    }
                    break;
                case '&=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ANDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ANDA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ANDA', t);
                        }
                    }
                    break;
                case '|=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `ORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ORA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ORA', t);
                        }
                    }
                    break;
                case '^=':
                    if (constVal !== null)
                        this.asmLines.push(
                            `XORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('XORA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('XORA', t);
                        }
                    }
                    break;
            }
            if (constIndex !== null) {
                this.emitLdAToArrayElem(arraySym, constIndex);
            } else {
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                this.emitLoadAccumulator(indexNode, fn);
                const t2 = this.allocTemp();
                this.emitLdAToTemp(t2);
                this.asmLines.push(
                    `LDIA 0x${(arraySym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                );
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
                        const negLabel = this.newLabel(fn);
                        const posLabel = this.newLabel(fn);
                        const endLabel = this.newLabel(fn);
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
                    this.emitLoadAccumulator(right, fn);
                    const t1 = this.allocTemp();
                    this.emitLdAToTemp(t1);
                    const loopLabel = this.newLabel(fn);
                    const doneLabel = this.newLabel(fn);
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
                this.emitArrayLoad(left, fn);
                const t0 = this.allocTemp();
                this.emitLdAToTemp(t0);
                this.emitLoadAccumulator(right, fn);
                const t1 = this.allocTemp();
                this.emitLdAToTemp(t1);
                const shiftRight = op === '>>=';
                const loopLabel = this.newLabel(fn);
                const doneLabel = this.newLabel(fn);
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
                this.emitLoadAccumulator(indexNode, fn);
                const t4 = this.allocTemp();
                this.emitLdAToTemp(t4);
                this.asmLines.push(
                    `LDIA 0x${(arraySym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                );
                this.emitOpTemp('ADDA', t4);
                this.asmLines.push('CLRB STATUS,5');
                this.currentAsmBank = 0;
                this.asmLines.push('LD FSR,A');
                this.emitLdTempToA(t3);
                this.asmLines.push('LD INDF,A');
            }
        } else if (op === '*=' || op === '/=' || op === '%=') {
            if (isSigned && (op === '/=' || op === '%=')) {
                if (op === '/=') this.emitSignedDivide(left, right, fn);
                else this.emitSignedModulo(left, right, fn);
            } else {
                if (constIndex !== null) {
                    this.emitLdArrayElemToA(arraySym, constIndex);
                } else {
                    this.emitArrayLoad(left, fn);
                }
                const t0 = this.allocTemp();
                this.emitLdAToTemp(t0);
                this.emitLoadAccumulator(right, fn);
                const t1 = this.allocTemp();
                this.emitLdAToTemp(t1);

                if (op === '*=') {
                    this.asmLines.push('CLRA');
                    const t2 = this.allocTemp();
                    this.emitLdAToTemp(t2);
                    const loop = this.newLabel(fn);
                    const done = this.newLabel(fn);
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
                    const skipLabel = this.newLabel(fn);
                    const loop = this.newLabel(fn);
                    const done = this.newLabel(fn);
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
                    const skipLabel = this.newLabel(fn);
                    const loop = this.newLabel(fn);
                    const done = this.newLabel(fn);
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
                    this.emitLoadAccumulator(indexNode, fn);
                    const t4 = this.allocTemp();
                    this.emitLdAToTemp(t4);
                    this.asmLines.push(
                        `LDIA 0x${(arraySym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                    );
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
                    this.emitLoadAccumulator(indexNode, fn);
                    const t4 = this.allocTemp();
                    this.emitLdAToTemp(t4);
                    this.asmLines.push(
                        `LDIA 0x${(arraySym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                    );
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

    private emitMultiDimCompoundAssign(
        baseSym: Sym,
        dims: number[],
        indexNodes: Parser.SyntaxNode[],
        right: Parser.SyntaxNode,
        fn: Fn,
        op: string,
    ) {
        const constIndices: (number | null)[] = indexNodes.map(n => this.getConstantValue(n));
        const allConstIndices = constIndices.every(v => v !== null);
        let flatConstIndex: number | null = null;
        if (allConstIndices) {
            flatConstIndex = this.computeFlatOffsetConst(dims.slice(0, indexNodes.length), constIndices as number[]);
        }

        const constVal = this.getConstantValue(right);
        const isSigned = baseSym.typeInfo.type === 'i8';

        if (['+=', '-=', '&=', '|=', '^='].includes(op)) {
            if (flatConstIndex !== null) {
                this.emitLdArrayElemToA(baseSym, flatConstIndex);
            } else {
                this.emitMultiDimOffsetLoad(baseSym, dims, indexNodes, fn);
            }
            switch (op) {
                case '+=':
                    if (constVal !== null)
                        this.asmLines.push(`ADDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ADDA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ADDA', t);
                        }
                    }
                    break;
                case '-=':
                    if (constVal !== null)
                        this.asmLines.push(`HSUBIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('HSUBA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('SUBA', t);
                        }
                    }
                    break;
                case '&=':
                    if (constVal !== null)
                        this.asmLines.push(`ANDIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ANDA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ANDA', t);
                        }
                    }
                    break;
                case '|=':
                    if (constVal !== null)
                        this.asmLines.push(`ORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('ORA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('ORA', t);
                        }
                    }
                    break;
                case '^=':
                    if (constVal !== null)
                        this.asmLines.push(`XORIA 0x${constVal.toString(16).toUpperCase().padStart(2, '0')}`);
                    else {
                        const rsym = this.resolveSymbol(right, fn);
                        if (rsym) this.emitOpSym('XORA', rsym);
                        else {
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.emitLoadAccumulator(right, fn);
                            this.emitOpTemp('XORA', t);
                        }
                    }
                    break;
            }
            if (flatConstIndex !== null) {
                this.emitLdAToArrayElem(baseSym, flatConstIndex);
            } else {
                this.emitMultiDimOffsetStoreA(baseSym, dims, indexNodes, fn);
            }
        } else if (op === '<<=' || op === '>>=') {
            if (flatConstIndex !== null) {
                this.emitLdArrayElemToA(baseSym, flatConstIndex);
            } else {
                this.emitMultiDimOffsetLoad(baseSym, dims, indexNodes, fn);
            }
            const shiftRight = op === '>>=';
            const shiftConst = this.getConstantValue(right);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            if (shiftConst !== null) {
                if (shiftRight && isSigned && shiftConst > 0) {
                    const negLabel = this.newLabel(fn);
                    const posLabel = this.newLabel(fn);
                    const endLabel = this.newLabel(fn);
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
                this.emitLoadAccumulator(right, fn);
                const t1 = this.allocTemp();
                this.emitLdAToTemp(t1);
                const loopLabel = this.newLabel(fn);
                const doneLabel = this.newLabel(fn);
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
            if (flatConstIndex !== null) {
                this.emitLdAToArrayElem(baseSym, flatConstIndex);
            } else {
                this.emitMultiDimOffsetStoreA(baseSym, dims, indexNodes, fn);
            }
        } else if (op === '*=' || op === '/=' || op === '%=') {
            if (isSigned && (op === '/=' || op === '%=')) {
                throw new Error(`Signed division/modulo compound assignment on multidimensional array not supported`);
            }
            if (flatConstIndex !== null) {
                this.emitLdArrayElemToA(baseSym, flatConstIndex);
            } else {
                this.emitMultiDimOffsetLoad(baseSym, dims, indexNodes, fn);
            }
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            this.emitLoadAccumulator(right, fn);
            const t1 = this.allocTemp();
            this.emitLdAToTemp(t1);

            if (op === '*=') {
                this.asmLines.push('CLRA');
                const t2 = this.allocTemp();
                this.emitLdAToTemp(t2);
                const loop = this.newLabel(fn);
                const done = this.newLabel(fn);
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
                const skipLabel = this.newLabel(fn);
                const loop = this.newLabel(fn);
                const done = this.newLabel(fn);
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
                const skipLabel = this.newLabel(fn);
                const loop = this.newLabel(fn);
                const done = this.newLabel(fn);
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

            if (flatConstIndex !== null) {
                this.emitLdAToArrayElem(baseSym, flatConstIndex);
            } else {
                this.emitMultiDimOffsetStoreA(baseSym, dims, indexNodes, fn);
            }
        }
    }

    private emitCallExpression(node: Parser.SyntaxNode, fn: Fn, usedAsValue = false) {
        const funcNode = node.childForFieldName('function');
        const argsNode = node.childForFieldName('arguments');
        if (!funcNode) return;

        const funcName = funcNode.text.trim();
        const targetFunc = this.fns.get(funcName);

        if (!targetFunc) {
            throw new Error(`Function '${funcName}' is not defined at ${this.posStr(funcNode)}`);
        }

        if (targetFunc.returnType === 'void' && usedAsValue) {
            throw new Error(`Function '${funcName}' returns void and cannot be used as a value at ${this.posStr(node)}`);
        }

        if (argsNode && targetFunc) {
            const args: Parser.SyntaxNode[] = [];
            for (let i = 0; i < argsNode.childCount; i++) {
                const child = argsNode.child(i);
                if (child && child.type !== ',' && child.type !== '(' && child.type !== ')')
                    args.push(child);
            }
            if (args.length < targetFunc.params.length) {
                throw new Error(
                    `Function '${funcName}' expects ${targetFunc.params.length} argument(s), but ${args.length} provided`,
                );
            }
            if (args.length > targetFunc.params.length) {
                throw new Error(
                    `Function '${funcName}' expects ${targetFunc.params.length} argument(s), but ${args.length} provided`,
                );
            }
            const temps: number[] = [];
            for (let i = 0; i < args.length && i < targetFunc.params.length; i++) {
                this.emitLoadAccumulator(args[i], fn);
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

        if (targetFunc) fn.calls.add(funcName);

        this.asmLines.push(`CALL ${toAsmName(funcName)}`);
        this.invalidateBankState();
    }

    private emitUpdateExpression(node: Parser.SyntaxNode, fn: Fn) {
        const operator = this.getChildByField(node, 'operator');
        const argument = node.childForFieldName('argument');
        if (!operator || !argument) return;

        const isPrefix = operator.startPosition.column < argument.startPosition.column;

        const unwrappedArg = this.unwrapParentheses(argument);

        if (unwrappedArg.type === 'pointer_expression') {
            const opNode = unwrappedArg.child(0);
            const argNode = unwrappedArg.child(1);
            if (opNode && opNode.text === '*' && argNode) {
                const ptrSym = this.resolveSymbol(argNode, fn);
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
            const { baseSym, indexNodes } = this.resolveMultiDimSubscript(argument, fn);
            if (!baseSym || indexNodes.length === 0) return;

            const dims = baseSym.typeInfo.dimensions || (baseSym.typeInfo.isArray ? [baseSym.typeInfo.arraySize] : []);
            const isMultiDim = indexNodes.length > 1 && dims.length >= indexNodes.length;

            if (isMultiDim) {
                const constIndices: (number | null)[] = indexNodes.map(n => this.getConstantValue(n));
                const allConstIndices = constIndices.every(v => v !== null);
                let flatConstIndex: number | null = null;
                if (allConstIndices) {
                    flatConstIndex = this.computeFlatOffsetConst(dims.slice(0, indexNodes.length), constIndices as number[]);
                }

                if (operator.text === '++') {
                    if (flatConstIndex !== null) {
                        if (isPrefix) {
                            this.emitLdArrayElemToA(baseSym, flatConstIndex);
                            this.asmLines.push('ADDIA 0x01');
                            this.emitLdAToArrayElem(baseSym, flatConstIndex);
                        } else {
                            this.emitLdArrayElemToA(baseSym, flatConstIndex);
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.asmLines.push('ADDIA 0x01');
                            this.emitLdAToArrayElem(baseSym, flatConstIndex);
                            this.emitLdTempToA(t);
                        }
                    } else {
                        this.emitMultiDimOffsetLoad(baseSym, dims, indexNodes, fn);
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.asmLines.push('ADDIA 0x01');
                        this.emitMultiDimOffsetStoreA(baseSym, dims, indexNodes, fn);
                        if (!isPrefix) {
                            this.emitLdTempToA(t);
                        }
                    }
                } else if (operator.text === '--') {
                    if (flatConstIndex !== null) {
                        if (isPrefix) {
                            this.emitLdArrayElemToA(baseSym, flatConstIndex);
                            this.asmLines.push('HSUBIA 0x01');
                            this.emitLdAToArrayElem(baseSym, flatConstIndex);
                        } else {
                            this.emitLdArrayElemToA(baseSym, flatConstIndex);
                            const t = this.allocTemp();
                            this.emitLdAToTemp(t);
                            this.asmLines.push('HSUBIA 0x01');
                            this.emitLdAToArrayElem(baseSym, flatConstIndex);
                            this.emitLdTempToA(t);
                        }
                    } else {
                        this.emitMultiDimOffsetLoad(baseSym, dims, indexNodes, fn);
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.asmLines.push('HSUBIA 0x01');
                        this.emitMultiDimOffsetStoreA(baseSym, dims, indexNodes, fn);
                        if (!isPrefix) {
                            this.emitLdTempToA(t);
                        }
                    }
                }
                return;
            }

            const arraySym = baseSym;
            let indexNode: Parser.SyntaxNode | null = indexNodes[0];
            if (!indexNode) return;

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
                    this.emitArrayLoad(argument, fn);
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.asmLines.push('ADDIA 0x01');
                    const t2 = this.allocTemp();
                    this.emitLdAToTemp(t2);
                    this.emitLoadAccumulator(indexNode, fn);
                    const t3 = this.allocTemp();
                    this.emitLdAToTemp(t3);
                    this.asmLines.push(
                        `LDIA 0x${(arraySym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                    );
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
                    this.emitArrayLoad(argument, fn);
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.asmLines.push('HSUBIA 0x01');
                    const t2 = this.allocTemp();
                    this.emitLdAToTemp(t2);
                    this.emitLoadAccumulator(indexNode, fn);
                    const t3 = this.allocTemp();
                    this.emitLdAToTemp(t3);
                    this.asmLines.push(
                        `LDIA 0x${(arraySym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                    );
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

        const sym = this.resolveSymbol(argument, fn);
        if (!sym) {
            if (!this.isValidLvalue(argument, fn)) {
                throw new Error(
                    `Cannot increment/decrement '${argument.text.trim()}' at ${this.posStr(argument)} - not an lvalue`,
                );
            }
            return;
        }

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
                this.emitLdAToTemp(t); // 保存原值
                this.asmLines.push('ADDIA 0x01');
                this.emitLdAToSym(sym); // 存回递增后的值
                this.emitLdTempToA(t); // 返回原值
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
                this.emitLdAToTemp(t); // 保存原值
                this.asmLines.push('HSUBIA 0x01');
                this.emitLdAToSym(sym); // 存回递减后的值
                this.emitLdTempToA(t); // 返回原值
            }
        }
    }

    private emitConditionalExpression(node: Parser.SyntaxNode, fn: Fn) {
        const condition = node.childForFieldName('condition');
        const consequence = node.childForFieldName('consequence');
        const alternative = node.childForFieldName('alternative');
        if (!condition || !consequence || !alternative) return;

        const elseLabel = this.newLabel(fn);
        const endLabel = this.newLabel(fn);

        this.emitCondition(condition, fn, elseLabel, false);
        this.emitLoadAccumulator(consequence, fn);
        this.asmLines.push(`JP ${endLabel}`);
        this.emitLabel(elseLabel);
        this.emitLoadAccumulator(alternative, fn);
        this.emitLabel(endLabel);
    }

    private emitAssignmentAsValue(node: Parser.SyntaxNode, fn: Fn) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const operator = this.getChildByField(node, 'operator');
        if (!left || !right || !operator) return;

        const op = operator.text;
        const innerLeft = this.unwrapParentheses(left);
        if (op === '=') {
            if (innerLeft.type === 'subscript_expression') {
                this.emitArrayStore(innerLeft, right, fn);
                this.emitArrayLoad(innerLeft, fn);
            } else if (innerLeft.type === 'pointer_expression') {
                const opNode = innerLeft.child(0);
                const argNode = innerLeft.child(1);
                if (opNode && opNode.text === '*' && argNode) {
                    this.emitLoadAccumulator(right, fn);
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.emitLoadAccumulator(argNode, fn);
                    this.emitIndirectSetFSR();
                    this.emitLdTempToA(t);
                    this.asmLines.push('LD INDF,A');
                }
            } else if (innerLeft.type === 'unary_expression') {
                const uOp = this.getChildByField(innerLeft, 'operator');
                const uArg = innerLeft.childForFieldName('argument');
                if (uOp && uOp.text === '*' && uArg) {
                    this.emitLoadAccumulator(right, fn);
                    const t = this.allocTemp();
                    this.emitLdAToTemp(t);
                    this.emitLoadAccumulator(uArg, fn);
                    this.emitIndirectSetFSR();
                    this.emitLdTempToA(t);
                    this.asmLines.push('LD INDF,A');
                }
            } else {
                this.emitLoadAccumulator(right, fn);
                const sym = this.resolveSymbol(left, fn);
                if (sym) this.emitLdAToSym(sym);
            }
        } else {
            if (innerLeft.type === 'subscript_expression') {
                this.emitArrayCompoundAssign(innerLeft, right, fn, op);
                this.emitArrayLoad(innerLeft, fn);
            } else if (
                innerLeft.type === 'pointer_expression' ||
                innerLeft.type === 'unary_expression'
            ) {
                this.emitAssignment(node, fn);
                this.emitLoadAccumulator(innerLeft, fn);
            } else {
                this.emitAssignment(node, fn);
                const sym = this.resolveSymbol(left, fn);
                if (sym) this.emitLdSymToA(sym);
            }
        }
    }

    private emitCommaExpression(node: Parser.SyntaxNode, fn: Fn) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!left || !right) return;

        this.emitExpression(left, fn);
        this.emitLoadAccumulator(right, fn);
    }

    private emitLoadAccumulator(node: Parser.SyntaxNode, fn: Fn) {
        const inner = this.unwrapParentheses(node);

        if (inner.type === 'number_literal') {
            const val = this.parseNumber(inner.text);
            this.asmLines.push(
                `LDIA 0x${(val & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
            );
            return;
        }

        if (inner.type === 'char_literal') {
            const text = inner.text;
            const val = text.length >= 3 ? text.charCodeAt(1) : 0;
            this.asmLines.push(
                `LDIA 0x${(val & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
            );
            return;
        }

        if (inner.type === 'identifier') {
            const sym = this.resolveSymbol(inner, fn);
            if (sym) {
                if (sym.typeInfo.isArray) {
                    this.asmLines.push(
                        `LDIA 0x${(sym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                } else {
                    this.emitLdSymToA(sym);
                }
            } else {
                const name = inner.text.trim();
                if (!this.fns.has(name)) {
                    throw new Error(`Variable '${name}' is not defined at ${this.posStr(inner)}`);
                }
            }
            return;
        }

        if (inner.type === 'subscript_expression') {
            this.emitArrayLoad(inner, fn);
            return;
        }

        if (inner.type === 'binary_expression') {
            this.emitBinaryExpression(inner, fn);
            return;
        }

        if (inner.type === 'unary_expression') {
            this.emitUnaryExpression(inner, fn);
            return;
        }

        if (inner.type === 'call_expression') {
            this.emitCallExpression(inner, fn, true);
            return;
        }

        if (inner.type === 'cast_expression') {
            const value = inner.childForFieldName('value');
            if (value) this.emitLoadAccumulator(value, fn);
            return;
        }

        if (inner.type === 'sizeof_expression') {
            let sizeofArg = inner.child(1);
            if (sizeofArg) {
                sizeofArg = this.unwrapParentheses(sizeofArg);
                const sym = this.resolveSymbol(sizeofArg, fn);
                if (sym && sym.typeInfo.isArray) {
                    this.asmLines.push(
                        `LDIA 0x${sym.typeInfo.arraySize.toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                    return;
                }
                if (sizeofArg.type === 'subscript_expression') {
                    const argType = this.typeInfoOf(sizeofArg, fn);
                    if (argType.isArray) {
                        this.asmLines.push(
                            `LDIA 0x${argType.arraySize.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
                        return;
                    }
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
            this.emitUpdateExpression(inner, fn);
            return;
        }

        if (inner.type === 'conditional_expression') {
            this.emitConditionalExpression(inner, fn);
            return;
        }

        if (inner.type === 'comma_expression') {
            this.emitCommaExpression(inner, fn);
            return;
        }

        if (inner.type === 'assignment_expression') {
            this.emitAssignmentAsValue(inner, fn);
            return;
        }

        if (inner.type === 'pointer_expression') {
            const addr = this.extractAddr(inner);
            if (addr !== null) {
                // 常量地址解引用：*(u8 *)0xXX，读取该地址的内容
                const equAddr = addr & 0x7f;
                this.ensureBank(addr);
                this.asmLines.push(`LD A,0x${equAddr.toString(16).toUpperCase().padStart(2, '0')}`);
                return;
            }
            const opNode = inner.child(0);
            const argNode = inner.child(1);
            if (opNode && argNode) {
                if (opNode.text === '&') {
                    if (argNode.type === 'identifier') {
                        const sym = this.resolveSymbol(argNode, fn);
                        if (sym) {
                            this.asmLines.push(
                                `LDIA 0x${(sym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                            );
                        } else {
                            throw new Error(
                                `Cannot take address of '${argNode.text.trim()}' - not a variable`,
                            );
                        }
                        return;
                    } else if (argNode.type === 'subscript_expression') {
                        const { baseSym, indexNodes } = this.resolveMultiDimSubscript(argNode, fn);
                        if (!baseSym)
                            throw new Error(
                                `Cannot take address of '${argNode.text.trim()}' - not an array element`,
                            );

                        const dims = baseSym.typeInfo.dimensions || (baseSym.typeInfo.isArray ? [baseSym.typeInfo.arraySize] : []);
                        const constIndices: (number | null)[] = indexNodes.map(n => this.getConstantValue(n));

                        if (dims.length >= indexNodes.length && constIndices.every(v => v !== null)) {
                            const flatOffset = this.computeFlatOffsetConst(dims.slice(0, indexNodes.length), constIndices as number[]);
                            const addr = (baseSym.ramAddr + flatOffset) & 0xff;
                            this.asmLines.push(
                                `LDIA 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`,
                            );
                        } else if (dims.length >= indexNodes.length) {
                            let constOffset = 0;
                            const varTemps: number[] = [];
                            for (let d = 0; d < indexNodes.length; d++) {
                                const remainingStride = d < dims.length - 1 ? dims.slice(d + 1).reduce((a, b) => a * b, 1) : 1;
                                if (constIndices[d] !== null) {
                                    constOffset += constIndices[d]! * remainingStride;
                                } else {
                                    this.emitLoadAccumulator(indexNodes[d], fn);
                                    const t = this.allocTemp();
                                    this.emitLdAToTemp(t);
                                    varTemps.push(t);
                                    if (remainingStride > 1) {
                                        this.emitLdTempToA(t);
                                        this.asmLines.push(
                                            `LDIA 0x${(remainingStride & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                                        );
                                        const tMul = this.allocTemp();
                                        this.emitLdAToTemp(tMul);
                                        this.emitLdTempToA(t);
                                        const tResult = this.allocTemp();
                                        this.emitLdAToTemp(tResult);
                                        this.asmLines.push('CLRA');
                                        const tAcc = this.allocTemp();
                                        this.emitLdAToTemp(tAcc);
                                        const loop = this.newLabel(fn);
                                        const done = this.newLabel(fn);
                                        this.emitLabel(loop);
                                        this.emitLdTempToA(tResult);
                                        this.asmLines.push('HSUBIA 0x00');
                                        this.asmLines.push('SZB STATUS,2');
                                        this.asmLines.push(`JP ${done}`);
                                        this.emitLdTempToA(tAcc);
                                        this.emitOpTemp('ADDA', tMul);
                                        this.emitLdAToTemp(tAcc);
                                        this.emitLdTempToA(tResult);
                                        this.asmLines.push('HSUBIA 0x01');
                                        this.emitLdAToTemp(tResult);
                                        this.asmLines.push(`JP ${loop}`);
                                        this.emitLabel(done);
                                        this.emitLdTempToA(tAcc);
                                        this.emitLdAToTemp(t);
                                        varTemps[varTemps.length - 1] = t;
                                    }
                                }
                            }
                            this.asmLines.push(
                                `LDIA 0x${((baseSym.ramAddr + constOffset) & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                            );
                            for (const t of varTemps) {
                                this.emitOpTemp('ADDA', t);
                            }
                        } else {
                            const arraySym = this.resolveArraySymbol(argNode, fn);
                            if (!arraySym)
                                throw new Error(
                                    `Cannot take address of '${argNode.text.trim()}' - not an array element`,
                                );
                            const indexNode = argNode.childForFieldName('index');
                            if (!indexNode) return;
                            const constIndex = this.getConstantValue(indexNode);
                            if (constIndex !== null) {
                                const addr = (arraySym.ramAddr + constIndex) & 0xff;
                                this.asmLines.push(
                                    `LDIA 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`,
                                );
                            } else {
                                this.emitLoadAccumulator(indexNode, fn);
                                const t = this.allocTemp();
                                this.emitLdAToTemp(t);
                                this.asmLines.push(
                                    `LDIA 0x${(arraySym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                                );
                                this.emitOpTemp('ADDA', t);
                            }
                        }
                        return;
                    }
                    throw new Error(
                        `Cannot take address of '${argNode.text.trim()}' at ${this.posStr(argNode)} - not an lvalue`,
                    );
                }
                if (opNode.text === '*') {
                    if (argNode.type === 'update_expression') {
                        const updateOp = this.getChildByField(argNode, 'operator');
                        const updateArg = argNode.childForFieldName('argument');
                        if (updateOp && updateArg) {
                            const ptrSym = this.resolveSymbol(updateArg, fn);
                            if (!ptrSym) {
                                this.emitLoadAccumulator(argNode, fn);
                                this.emitIndirectRead();
                                return;
                            }

                            if (updateOp.text === '++') {
                                const isPrefix =
                                    updateOp.startPosition.column < updateArg.startPosition.column;
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
                                const isPrefix =
                                    updateOp.startPosition.column < updateArg.startPosition.column;
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
                    this.emitLoadAccumulator(argNode, fn);

                    // 检查是否是常量地址（如 (u8 *)0x06）
                    const addr = this.extractAddr(argNode);
                    if (addr !== null && addr >= 0x00 && addr <= 0x1f) {
                        // SFR地址：使用直接寻址
                        const equAddr = addr & 0x7f;
                        this.ensureBank(addr);
                        this.asmLines.push(
                            `LD A,0x${equAddr.toString(16).toUpperCase().padStart(2, '0')}`,
                        );
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
                const addr = this.parseNumber(valueNode.text) & 0xff;
                this.asmLines.push(`LDIA 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`);
                return;
            }
        }
    }

    private emitBinaryExpression(node: Parser.SyntaxNode, fn: Fn) {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        const operator = this.getChildByField(node, 'operator');
        if (!left || !right || !operator) return;

        const op = operator.text;
        const rightConst = this.getConstantValue(right);

        switch (op) {
            case '+':
                this.emitLoadAccumulator(left, fn);
                if (rightConst !== null) {
                    this.asmLines.push(
                        `ADDIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                } else {
                    const rsym = this.resolveSymbol(right, fn);
                    if (rsym) {
                        this.emitOpSym('ADDA', rsym);
                    } else {
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(right, fn);
                        this.emitOpTemp('ADDA', t);
                    }
                }
                break;
            case '-':
                if (rightConst !== null) {
                    this.emitLoadAccumulator(left, fn);
                    this.asmLines.push(
                        `HSUBIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                } else {
                    const lsym = this.resolveSymbol(left, fn);
                    const rsym = this.resolveSymbol(right, fn);
                    if (lsym && rsym) {
                        this.emitLdSymToA(rsym);
                        this.emitOpSym('SUBA', lsym);
                    } else if (rsym) {
                        this.emitLoadAccumulator(left, fn);
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLdSymToA(rsym);
                        this.emitOpTemp('SUBA', t);
                    } else if (lsym) {
                        this.emitLoadAccumulator(right, fn);
                        this.emitOpSym('SUBA', lsym);
                    } else {
                        this.emitLoadAccumulator(left, fn);
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(right, fn);
                        this.emitOpTemp('SUBA', t);
                    }
                }
                break;
            case '&':
                this.emitLoadAccumulator(left, fn);
                if (rightConst !== null) {
                    this.asmLines.push(
                        `ANDIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                } else {
                    const rsym = this.resolveSymbol(right, fn);
                    if (rsym) {
                        this.emitOpSym('ANDA', rsym);
                    } else {
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(right, fn);
                        this.emitOpTemp('ANDA', t);
                    }
                }
                break;
            case '|':
                this.emitLoadAccumulator(left, fn);
                if (rightConst !== null) {
                    this.asmLines.push(
                        `ORIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                } else {
                    const rsym = this.resolveSymbol(right, fn);
                    if (rsym) {
                        this.emitOpSym('ORA', rsym);
                    } else {
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(right, fn);
                        this.emitOpTemp('ORA', t);
                    }
                }
                break;
            case '^':
                this.emitLoadAccumulator(left, fn);
                if (rightConst !== null) {
                    this.asmLines.push(
                        `XORIA 0x${rightConst.toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                } else {
                    const rsym = this.resolveSymbol(right, fn);
                    if (rsym) {
                        this.emitOpSym('XORA', rsym);
                    } else {
                        const t = this.allocTemp();
                        this.emitLdAToTemp(t);
                        this.emitLoadAccumulator(right, fn);
                        this.emitOpTemp('XORA', t);
                    }
                }
                break;
            case '*':
                this.emitMultiply(left, right, fn);
                break;
            case '/': {
                const isSigned =
                    this.inferExprType(left, fn) === 'i8' || this.inferExprType(right, fn) === 'i8';
                if (isSigned) this.emitSignedDivide(left, right, fn);
                else this.emitDivide(left, right, fn);
                break;
            }
            case '%': {
                const isSigned =
                    this.inferExprType(left, fn) === 'i8' || this.inferExprType(right, fn) === 'i8';
                if (isSigned) this.emitSignedModulo(left, right, fn);
                else this.emitModulo(left, right, fn);
                break;
            }
            case '<<':
                this.emitShiftLeft(left, right, fn);
                break;
            case '>>': {
                const isSigned = this.inferExprType(left, fn) === 'i8';
                this.emitShiftRight(left, right, fn, isSigned);
                break;
            }
            case '&&':
            case '||':
                this.emitLogicalBinary(node, fn);
                break;
            case '==':
            case '!=':
            case '<':
            case '>':
            case '<=':
            case '>=':
                this.emitComparisonResult(node, fn);
                break;
        }
    }

    private emitLogicalBinary(node: Parser.SyntaxNode, fn: Fn) {
        const operator = this.getChildByField(node, 'operator');
        if (!operator) return;

        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!left || !right) return;

        const setOne = this.newLabel(fn);
        const setZero = this.newLabel(fn);
        const done = this.newLabel(fn);

        if (operator.text === '&&') {
            this.emitCondition(left, fn, setZero, false);
            this.emitCondition(right, fn, setZero, false);
            this.asmLines.push('LDIA 0x01');
            this.asmLines.push(`JP ${done}`);
            this.emitLabel(setZero);
            this.asmLines.push('LDIA 0x00');
            this.asmLines.push(`JP ${done}`);
        } else {
            this.emitCondition(left, fn, setOne, true);
            this.emitCondition(right, fn, setOne, true);
            this.asmLines.push('LDIA 0x00');
            this.asmLines.push(`JP ${done}`);
            this.emitLabel(setOne);
            this.asmLines.push('LDIA 0x01');
        }
        this.emitLabel(done);
    }

    private emitComparisonResult(node: Parser.SyntaxNode, fn: Fn) {
        const setOne = this.newLabel(fn);
        const done = this.newLabel(fn);
        this.emitComparison(node, fn, setOne, true);
        this.asmLines.push('LDIA 0x00');
        this.asmLines.push(`JP ${done}`);
        this.emitLabel(setOne);
        this.asmLines.push('LDIA 0x01');
        this.emitLabel(done);
    }

    private emitUnaryExpression(node: Parser.SyntaxNode, fn: Fn) {
        const operator = this.getChildByField(node, 'operator');
        const argument = node.childForFieldName('argument');
        if (!operator || !argument) return;

        const op = operator.text;

        if (op === '-') {
            this.emitLoadAccumulator(argument, fn);
            this.asmLines.push('XORIA 0xFF');
            this.asmLines.push('ADDIA 0x01');
            return;
        }

        if (op === '~') {
            this.emitLoadAccumulator(argument, fn);
            this.asmLines.push('XORIA 0xFF');
            return;
        }

        if (op === '!') {
            this.emitLoadAccumulator(argument, fn);
            this.asmLines.push('HSUBIA 0x00');
            const setOne = this.newLabel(fn);
            const done = this.newLabel(fn);
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
            const sym = this.resolveSymbol(argument, fn);
            if (sym) {
                this.asmLines.push(
                    `LDIA 0x${(sym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                );
            }
            return;
        }

        if (op === '*') {
            this.emitLoadAccumulator(argument, fn);
            this.emitIndirectRead();
            return;
        }

        this.emitLoadAccumulator(argument, fn);
    }

    private resolveMultiDimSubscript(
        node: Parser.SyntaxNode,
        fn: Fn,
    ): { baseSym: Sym | null; indexNodes: Parser.SyntaxNode[] } {
        let arrayNode = node.childForFieldName('array');
        if (!arrayNode) arrayNode = node.childForFieldName('argument');
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
        if (!indexNode) return { baseSym: null, indexNodes: [] };

        if (arrayNode && arrayNode.type === 'subscript_expression') {
            const inner = this.resolveMultiDimSubscript(arrayNode, fn);
            return { baseSym: inner.baseSym, indexNodes: [...inner.indexNodes, indexNode] };
        }

        let baseSym: Sym | null = null;
        if (arrayNode) {
            baseSym = this.resolveSymbol(arrayNode, fn);
        } else {
            for (let i = 0; i < node.childCount; i++) {
                const c = node.child(i);
                if (c && c.type === 'identifier') {
                    baseSym = this.resolveSymbol(c, fn);
                    break;
                }
            }
        }
        return { baseSym, indexNodes: [indexNode] };
    }

    private computeFlatOffsetConst(dimensions: number[], constIndices: number[]): number {
        let offset = 0;
        let stride = 1;
        for (let d = dimensions.length - 1; d > 0; d--) {
            stride *= dimensions[d];
        }
        for (let d = 0; d < constIndices.length; d++) {
            const remainingStride = d < dimensions.length - 1 ? dimensions.slice(d + 1).reduce((a, b) => a * b, 1) : 1;
            offset += constIndices[d] * remainingStride;
        }
        return offset;
    }

    private emitMultiDimOffsetLoad(
        baseSym: Sym,
        dimensions: number[],
        indexNodes: Parser.SyntaxNode[],
        fn: Fn,
    ) {
        const ndim = dimensions.length;
        const constIndices: (number | null)[] = indexNodes.map(n => this.getConstantValue(n));

        const allConst = constIndices.every(v => v !== null);
        if (allConst) {
            const flatOffset = this.computeFlatOffsetConst(dimensions, constIndices as number[]);
            this.emitLdArrayElemToA(baseSym, flatOffset);
            return;
        }

        let offset = 0;
        let firstVarDim = -1;
        for (let d = 0; d < ndim; d++) {
            if (constIndices[d] !== null) {
                const remainingStride = d < ndim - 1 ? dimensions.slice(d + 1).reduce((a, b) => a * b, 1) : 1;
                offset += constIndices[d]! * remainingStride;
            } else {
                firstVarDim = d;
            }
        }

        const temps: number[] = [];
        for (let d = 0; d < ndim; d++) {
            if (constIndices[d] !== null) continue;
            const remainingStride = d < ndim - 1 ? dimensions.slice(d + 1).reduce((a, b) => a * b, 1) : 1;
            this.emitLoadAccumulator(indexNodes[d], fn);
            const t = this.allocTemp();
            this.emitLdAToTemp(t);
            temps.push(t);
            if (remainingStride > 1) {
                this.emitLdTempToA(t);
                this.asmLines.push(
                    `LDIA 0x${(remainingStride & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                );
                const tMul = this.allocTemp();
                this.emitLdAToTemp(tMul);
                this.emitLdTempToA(t);
                const tResult = this.allocTemp();
                this.emitLdAToTemp(tResult);
                this.asmLines.push('CLRA');
                const tAcc = this.allocTemp();
                this.emitLdAToTemp(tAcc);
                const loop = this.newLabel(fn);
                const done = this.newLabel(fn);
                this.emitLabel(loop);
                this.emitLdTempToA(tResult);
                this.asmLines.push('HSUBIA 0x00');
                this.asmLines.push('SZB STATUS,2');
                this.asmLines.push(`JP ${done}`);
                this.emitLdTempToA(tAcc);
                this.emitOpTemp('ADDA', tMul);
                this.emitLdAToTemp(tAcc);
                this.emitLdTempToA(tResult);
                this.asmLines.push('HSUBIA 0x01');
                this.emitLdAToTemp(tResult);
                this.asmLines.push(`JP ${loop}`);
                this.emitLabel(done);
                this.emitLdTempToA(tAcc);
                this.emitLdAToTemp(t);
                temps[temps.length - 1] = t;
            }
        }

        this.asmLines.push(
            `LDIA 0x${((baseSym.ramAddr + offset) & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
        );
        for (const t of temps) {
            this.emitOpTemp('ADDA', t);
        }
        this.emitIndirectRead();
    }

    private emitMultiDimOffsetStore(
        baseSym: Sym,
        dimensions: number[],
        indexNodes: Parser.SyntaxNode[],
        valueNode: Parser.SyntaxNode,
        fn: Fn,
    ) {
        const ndim = dimensions.length;
        const constIndices: (number | null)[] = indexNodes.map(n => this.getConstantValue(n));

        const allConst = constIndices.every(v => v !== null);
        if (allConst) {
            const flatOffset = this.computeFlatOffsetConst(dimensions, constIndices as number[]);
            this.emitLoadAccumulator(valueNode, fn);
            this.emitLdAToArrayElem(baseSym, flatOffset);
            return;
        }

        let offset = 0;
        const temps: number[] = [];
        for (let d = 0; d < ndim; d++) {
            if (constIndices[d] !== null) {
                const remainingStride = d < ndim - 1 ? dimensions.slice(d + 1).reduce((a, b) => a * b, 1) : 1;
                offset += constIndices[d]! * remainingStride;
            } else {
                const remainingStride = d < ndim - 1 ? dimensions.slice(d + 1).reduce((a, b) => a * b, 1) : 1;
                this.emitLoadAccumulator(indexNodes[d], fn);
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                temps.push(t);
                if (remainingStride > 1) {
                    this.emitLdTempToA(t);
                    this.asmLines.push(
                        `LDIA 0x${(remainingStride & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                    const tMul = this.allocTemp();
                    this.emitLdAToTemp(tMul);
                    this.emitLdTempToA(t);
                    const tResult = this.allocTemp();
                    this.emitLdAToTemp(tResult);
                    this.asmLines.push('CLRA');
                    const tAcc = this.allocTemp();
                    this.emitLdAToTemp(tAcc);
                    const loop = this.newLabel(fn);
                    const done = this.newLabel(fn);
                    this.emitLabel(loop);
                    this.emitLdTempToA(tResult);
                    this.asmLines.push('HSUBIA 0x00');
                    this.asmLines.push('SZB STATUS,2');
                    this.asmLines.push(`JP ${done}`);
                    this.emitLdTempToA(tAcc);
                    this.emitOpTemp('ADDA', tMul);
                    this.emitLdAToTemp(tAcc);
                    this.emitLdTempToA(tResult);
                    this.asmLines.push('HSUBIA 0x01');
                    this.emitLdAToTemp(tResult);
                    this.asmLines.push(`JP ${loop}`);
                    this.emitLabel(done);
                    this.emitLdTempToA(tAcc);
                    this.emitLdAToTemp(t);
                    temps[temps.length - 1] = t;
                }
            }
        }

        const tVal = this.allocTemp();
        this.emitLoadAccumulator(valueNode, fn);
        this.emitLdAToTemp(tVal);

        this.asmLines.push(
            `LDIA 0x${((baseSym.ramAddr + offset) & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
        );
        for (const t of temps) {
            this.emitOpTemp('ADDA', t);
        }
        this.emitIndirectSetFSR();
        this.emitLdTempToA(tVal);
        this.asmLines.push('LD INDF,A');
    }

    private emitMultiDimOffsetStoreA(
        baseSym: Sym,
        dimensions: number[],
        indexNodes: Parser.SyntaxNode[],
        fn: Fn,
    ) {
        const ndim = dimensions.length;
        const constIndices: (number | null)[] = indexNodes.map(n => this.getConstantValue(n));

        const allConst = constIndices.every(v => v !== null);
        if (allConst) {
            const flatOffset = this.computeFlatOffsetConst(dimensions, constIndices as number[]);
            this.emitLdAToArrayElem(baseSym, flatOffset);
            return;
        }

        const tVal = this.allocTemp();
        this.emitLdAToTemp(tVal);

        let offset = 0;
        const temps: number[] = [];
        for (let d = 0; d < ndim; d++) {
            if (constIndices[d] !== null) {
                const remainingStride = d < ndim - 1 ? dimensions.slice(d + 1).reduce((a, b) => a * b, 1) : 1;
                offset += constIndices[d]! * remainingStride;
            } else {
                const remainingStride = d < ndim - 1 ? dimensions.slice(d + 1).reduce((a, b) => a * b, 1) : 1;
                this.emitLoadAccumulator(indexNodes[d], fn);
                const t = this.allocTemp();
                this.emitLdAToTemp(t);
                temps.push(t);
                if (remainingStride > 1) {
                    this.emitLdTempToA(t);
                    this.asmLines.push(
                        `LDIA 0x${(remainingStride & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
                    );
                    const tMul = this.allocTemp();
                    this.emitLdAToTemp(tMul);
                    this.emitLdTempToA(t);
                    const tResult = this.allocTemp();
                    this.emitLdAToTemp(tResult);
                    this.asmLines.push('CLRA');
                    const tAcc = this.allocTemp();
                    this.emitLdAToTemp(tAcc);
                    const loop = this.newLabel(fn);
                    const done = this.newLabel(fn);
                    this.emitLabel(loop);
                    this.emitLdTempToA(tResult);
                    this.asmLines.push('HSUBIA 0x00');
                    this.asmLines.push('SZB STATUS,2');
                    this.asmLines.push(`JP ${done}`);
                    this.emitLdTempToA(tAcc);
                    this.emitOpTemp('ADDA', tMul);
                    this.emitLdAToTemp(tAcc);
                    this.emitLdTempToA(tResult);
                    this.asmLines.push('HSUBIA 0x01');
                    this.emitLdAToTemp(tResult);
                    this.asmLines.push(`JP ${loop}`);
                    this.emitLabel(done);
                    this.emitLdTempToA(tAcc);
                    this.emitLdAToTemp(t);
                    temps[temps.length - 1] = t;
                }
            }
        }

        this.asmLines.push(
            `LDIA 0x${((baseSym.ramAddr + offset) & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
        );
        for (const t of temps) {
            this.emitOpTemp('ADDA', t);
        }
        this.emitIndirectSetFSR();
        this.emitLdTempToA(tVal);
        this.asmLines.push('LD INDF,A');
    }

    private emitArrayLoad(node: Parser.SyntaxNode, fn: Fn) {
        const { baseSym, indexNodes } = this.resolveMultiDimSubscript(node, fn);
        if (!baseSym || indexNodes.length === 0) return;

        const dims = baseSym.typeInfo.dimensions || (baseSym.typeInfo.isArray ? [baseSym.typeInfo.arraySize] : []);

        if (indexNodes.length > 1 && dims.length >= indexNodes.length) {
            this.emitMultiDimOffsetLoad(baseSym, dims, indexNodes, fn);
            return;
        }

        const indexNode = indexNodes[0];
        const constIndex = this.getConstantValue(indexNode);
        if (constIndex !== null) {
            this.emitLdArrayElemToA(baseSym, constIndex);
            return;
        }

        const t = this.allocTemp();
        this.emitLoadAccumulator(indexNode, fn);
        this.emitLdAToTemp(t);
        if (baseSym.typeInfo.isArray) {
            this.asmLines.push(
                `LDIA 0x${(baseSym.ramAddr & 0xff).toString(16).toUpperCase().padStart(2, '0')}`,
            );
            this.emitOpTemp('ADDA', t);
        } else {
            this.emitLdSymToA(baseSym);
            this.emitOpTemp('ADDA', t);
        }
        this.emitIndirectRead();
    }

    private emitMultiply(left: Parser.SyntaxNode, right: Parser.SyntaxNode, fn: Fn) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);

        if (rightConst === 0 || leftConst === 0) {
            this.asmLines.push('LDIA 0x00');
            return;
        }

        if (rightConst === 1) {
            this.emitLoadAccumulator(left, fn);
            return;
        }
        if (leftConst === 1) {
            this.emitLoadAccumulator(right, fn);
            return;
        }

        if (rightConst === 2 || leftConst === 2) {
            const src = rightConst === 2 ? left : right;
            this.emitLoadAccumulator(src, fn);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            this.emitLdTempToA(t0);
            this.emitOpTemp('ADDA', t0);
            return;
        }

        this.emitLoadAccumulator(left, fn);
        const t0 = this.allocTemp();
        this.emitLdAToTemp(t0);
        this.emitLoadAccumulator(right, fn);
        const t1 = this.allocTemp();
        this.emitLdAToTemp(t1);
        this.asmLines.push('CLRA');
        const t2 = this.allocTemp();
        this.emitLdAToTemp(t2);

        const loop = this.newLabel(fn);
        const done = this.newLabel(fn);
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

    private emitDivide(left: Parser.SyntaxNode, right: Parser.SyntaxNode, fn: Fn) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);
        if (rightConst !== null && rightConst === 0) {
            throw new Error(`Division by zero at ${this.posStr(right)}`);
        }
        if (leftConst === 0) {
            this.asmLines.push('LDIA 0x00');
            return;
        }
        if (rightConst === 2) {
            this.emitLoadAccumulator(left, fn);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            this.asmLines.push('CLRB STATUS,0');
            this.emitOpTemp('RRCA', t0);
            return;
        }
        if (rightConst !== null && rightConst === 1) {
            this.emitLoadAccumulator(left, fn);
            return;
        }

        this.emitLoadAccumulator(left, fn);
        const t0 = this.allocTemp();
        this.emitLdAToTemp(t0);
        this.emitLoadAccumulator(right, fn);
        const t1 = this.allocTemp();
        this.emitLdAToTemp(t1);
        this.asmLines.push('CLRA');
        const t2 = this.allocTemp();
        this.emitLdAToTemp(t2);

        const skipLabel = this.newLabel(fn);
        const zeroLabel = this.newLabel(fn);
        const endLabel = this.newLabel(fn);
        const loop = this.newLabel(fn);
        const done = this.newLabel(fn);
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

    private emitModulo(left: Parser.SyntaxNode, right: Parser.SyntaxNode, fn: Fn) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);
        if (rightConst !== null && rightConst === 0) {
            throw new Error(`Division by zero (modulo) at ${this.posStr(right)}`);
        }
        if (rightConst === 1) {
            this.asmLines.push('LDIA 0x00');
            return;
        }
        if (leftConst === 0) {
            this.asmLines.push('LDIA 0x00');
            return;
        }

        this.emitLoadAccumulator(left, fn);
        const t0 = this.allocTemp();
        this.emitLdAToTemp(t0);
        this.emitLoadAccumulator(right, fn);
        const t1 = this.allocTemp();
        this.emitLdAToTemp(t1);

        const skipLabel = this.newLabel(fn);
        const loop = this.newLabel(fn);
        const done = this.newLabel(fn);
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

    private emitSignedDivide(left: Parser.SyntaxNode, right: Parser.SyntaxNode, fn: Fn) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);
        if (rightConst !== null && rightConst === 0) {
            throw new Error(`Division by zero at ${this.posStr(right)}`);
        }
        if (leftConst === 0) {
            this.asmLines.push('LDIA 0x00');
            return;
        }
        if (rightConst !== null && rightConst === 1) {
            this.emitLoadAccumulator(left, fn);
            return;
        }

        const signResult = this.allocTemp();
        this.asmLines.push('LDIA 0x00');
        this.emitLdAToTemp(signResult);

        this.emitLoadAccumulator(left, fn);
        const tLeft = this.allocTemp();
        this.emitLdAToTemp(tLeft);

        const leftDoneLabel = this.newLabel(fn);
        this.emitTestBitTemp('SNZB', tLeft, 7);
        this.asmLines.push(`JP ${leftDoneLabel}`);
        this.emitLdTempToA(tLeft);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLdAToTemp(tLeft);
        this.asmLines.push('LDIA 0xFF');
        this.emitLdAToTemp(signResult);
        this.emitLabel(leftDoneLabel);

        this.emitLoadAccumulator(right, fn);
        const tRight = this.allocTemp();
        this.emitLdAToTemp(tRight);

        const rightDoneLabel = this.newLabel(fn);
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

        const skipLabel = this.newLabel(fn);
        const zeroLabel = this.newLabel(fn);
        const endLabel = this.newLabel(fn);
        const loop = this.newLabel(fn);
        const done = this.newLabel(fn);
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

        const negResultLabel = this.newLabel(fn);
        const finalLabel = this.newLabel(fn);
        this.emitTestBitTemp('SZB', signResult, 7);
        this.asmLines.push(`JP ${negResultLabel}`);
        this.asmLines.push(`JP ${finalLabel}`);
        this.emitLabel(negResultLabel);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLabel(finalLabel);
    }

    private emitSignedModulo(left: Parser.SyntaxNode, right: Parser.SyntaxNode, fn: Fn) {
        const rightConst = this.getConstantValue(right);
        const leftConst = this.getConstantValue(left);
        if (rightConst !== null && rightConst === 0) {
            throw new Error(`Division by zero (modulo) at ${this.posStr(right)}`);
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

        this.emitLoadAccumulator(left, fn);
        const tLeft = this.allocTemp();
        this.emitLdAToTemp(tLeft);

        const leftDoneLabel = this.newLabel(fn);
        this.emitTestBitTemp('SNZB', tLeft, 7);
        this.asmLines.push(`JP ${leftDoneLabel}`);
        this.emitLdTempToA(tLeft);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLdAToTemp(tLeft);
        this.asmLines.push('LDIA 0xFF');
        this.emitLdAToTemp(leftWasNeg);
        this.emitLabel(leftDoneLabel);

        this.emitLoadAccumulator(right, fn);
        const tRight = this.allocTemp();
        this.emitLdAToTemp(tRight);

        const rightDoneLabel = this.newLabel(fn);
        this.emitTestBitTemp('SNZB', tRight, 7);
        this.asmLines.push(`JP ${rightDoneLabel}`);
        this.emitLdTempToA(tRight);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLdAToTemp(tRight);
        this.emitLabel(rightDoneLabel);

        const skipLabel = this.newLabel(fn);
        const loop = this.newLabel(fn);
        const done = this.newLabel(fn);
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

        const negResultLabel = this.newLabel(fn);
        const finalLabel = this.newLabel(fn);
        this.emitTestBitTemp('SZB', leftWasNeg, 7);
        this.asmLines.push(`JP ${negResultLabel}`);
        this.asmLines.push(`JP ${finalLabel}`);
        this.emitLabel(negResultLabel);
        this.asmLines.push('XORIA 0xFF');
        this.asmLines.push('ADDIA 0x01');
        this.emitLabel(finalLabel);
    }

    private emitShiftLeft(left: Parser.SyntaxNode, right: Parser.SyntaxNode, fn: Fn) {
        const rightConst = this.getConstantValue(right);
        if (rightConst !== null) {
            this.emitLoadAccumulator(left, fn);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            for (let i = 0; i < rightConst; i++) {
                this.emitLdTempToA(t0);
                this.emitOpTemp('ADDA', t0);
                this.emitLdAToTemp(t0);
            }
        } else {
            this.emitLoadAccumulator(left, fn);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            this.emitLoadAccumulator(right, fn);
            const t1 = this.allocTemp();
            this.emitLdAToTemp(t1);
            const loopLabel = this.newLabel(fn);
            const doneLabel = this.newLabel(fn);
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

    private emitShiftRight(
        left: Parser.SyntaxNode,
        right: Parser.SyntaxNode,
        fn: Fn,
        isSigned = false,
    ) {
        const rightConst = this.getConstantValue(right);
        if (rightConst !== null) {
            this.emitLoadAccumulator(left, fn);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            if (isSigned && rightConst > 0) {
                const negLabel = this.newLabel(fn);
                const posLabel = this.newLabel(fn);
                const endLabel = this.newLabel(fn);
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
            this.emitLoadAccumulator(left, fn);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            this.emitLoadAccumulator(right, fn);
            const t1 = this.allocTemp();
            this.emitLdAToTemp(t1);
            const loopLabel = this.newLabel(fn);
            const doneLabel = this.newLabel(fn);
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

    private emitShiftAssign(sym: Sym, right: Parser.SyntaxNode, fn: Fn, isRight: boolean) {
        const isSigned = isRight && sym.typeInfo.type === 'i8';
        const rightConst = this.getConstantValue(right);
        if (rightConst !== null) {
            this.emitLdSymToA(sym);
            const t0 = this.allocTemp();
            this.emitLdAToTemp(t0);
            if (isRight && isSigned && rightConst > 0) {
                const negLabel = this.newLabel(fn);
                const posLabel = this.newLabel(fn);
                const endLabel = this.newLabel(fn);
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
            this.emitLoadAccumulator(right, fn);
            const t1 = this.allocTemp();
            this.emitLdAToTemp(t1);
            const loopLabel = this.newLabel(fn);
            const doneLabel = this.newLabel(fn);
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

    private emitArithAssign(
        sym: Sym,
        left: Parser.SyntaxNode,
        right: Parser.SyntaxNode,
        fn: Fn,
        op: string,
    ) {
        const isSigned = sym.typeInfo.type === 'i8';
        if (op === '*=') {
            this.emitMultiply(left, right, fn);
        } else if (op === '/=') {
            if (isSigned) this.emitSignedDivide(left, right, fn);
            else this.emitDivide(left, right, fn);
        } else if (op === '%=') {
            if (isSigned) this.emitSignedModulo(left, right, fn);
            else this.emitModulo(left, right, fn);
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
        return this.parseNumber(valueNode.text) & 0xff;
    }

    private resolveSymbol(node: Parser.SyntaxNode, fn: Fn): Sym | null {
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
        if (fn.localSymbols.has(name)) return fn.localSymbols.get(name)!;
        if (this.globalSymbols.has(name)) return this.globalSymbols.get(name)!;
        return null;
    }

    private resolveArraySymbol(node: Parser.SyntaxNode, fn: Fn): Sym | null {
        let arrayNode = node.childForFieldName('array');
        if (!arrayNode) {
            for (let i = 0; i < node.childCount; i++) {
                const c = node.child(i);
                if (c && c.type === 'identifier') {
                    arrayNode = c;
                    break;
                }
            }
        }
        if (!arrayNode) return null;
        return this.resolveSymbol(arrayNode, fn);
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
            if (sym && sym.typeInfo.isArray) return sym.ramAddr;
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
            if (opNode.text === '-') return -val & 0xff;
            if (opNode.text === '~') return ~val & 0xff;
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
                case '+':
                    return (lv + rv) & 0xff;
                case '-':
                    return (lv - rv) & 0xff;
                case '*':
                    return (lv * rv) & 0xff;
                case '/':
                    return rv !== 0 ? Math.floor(lv / rv) & 0xff : null;
                case '%':
                    return rv !== 0 ? (lv % rv) & 0xff : null;
                case '&':
                    return lv & rv & 0xff;
                case '|':
                    return (lv | rv) & 0xff;
                case '^':
                    return (lv ^ rv) & 0xff;
                case '<<':
                    return (lv << rv) & 0xff;
                case '>>':
                    return (lv >> rv) & 0xff;
                case '==':
                    return lv === rv ? 1 : 0;
                case '!=':
                    return lv !== rv ? 1 : 0;
                case '<':
                    return lv < rv ? 1 : 0;
                case '>':
                    return lv > rv ? 1 : 0;
                case '<=':
                    return lv <= rv ? 1 : 0;
                case '>=':
                    return lv >= rv ? 1 : 0;
                case '&&':
                    return lv && rv ? 1 : 0;
                case '||':
                    return lv || rv ? 1 : 0;
                default:
                    return null;
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
        return val & 0xff;
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

    private newLabel(fn: Fn): string {
        return `L${fn.asmName}_${fn.labelCounter++}`;
    }
}

export async function compile(
    source: string,
): Promise<{ rom: Uint16Array; asm: string; debugInfo: DebugInfo }> {
    return new SC8P053Compiler().compile(source);
}
