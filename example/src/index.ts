/**
 * @license sc8p053vm
 * Copyright (c) 2026 391321232@qq.com
 * Licensed under BSL-1.1 (see LICENSE). Changes to MIT after 2099-12-31.
 */
import { assemble, DebugInfo, VM } from 'sc8p053vm';

class IDE {
    private rom: Uint16Array | null = null;
    private debugInfo: DebugInfo | null = null;
    private vm: VM | null = null;

    private breakpoints: Set<number> = new Set();
    private breakpointsEnabled: boolean = true;
    private currentLine: number | null = null;
    private isRunning: boolean = false;
    private isStepping: boolean = false;
    private animationFrameId: number | null = null;

    private ioState: Map<string, boolean | null> = new Map();

    constructor() {
        this.setupEventListeners();
        const input = document.getElementById('code-input') as HTMLTextAreaElement;
        if (input) {
            (async () => {
                try {
                    const response = await fetch('public/main.asm');
                    const text = await response.text();
                    input.value = text;
                } finally {
                    input.dispatchEvent(new Event('input'));
                    input.focus();
                }
            })();
        }
    }

    private assembleCode() {
        try {
            const input = document.getElementById('code-input') as HTMLTextAreaElement;
            const text = input.value;

            const result = assemble(text);
            this.rom = result.rom;
            this.debugInfo = result.debugInfo;
            this.updateCodeInput();

            this.vm = new VM(this.rom);

            this.ioState.clear();
            for (let i = 0; i < 6; i++) {
                this.ioState.set(`A${i}`, null);
            }
            for (let i = 0; i < 8; i++) {
                this.ioState.set(`B${i}`, null);
            }

            this.vm.ioCallback = (ports) => {
                for (let i = 0; i < 6; i++) {
                    this.ioState.set(`A${i}`, (ports.A & (1 << i)) !== 0);
                }
                for (let i = 0; i < 8; i++) {
                    this.ioState.set(`B${i}`, (ports.B & (1 << i)) !== 0);
                }
                this.updateStatePanel();
            };

            this.updateCurrentLine();

        } catch (error) {
            console.error('Failed to load or assemble ASM:', error);
        }
    }

    private updateCodeInput(): void {
        const input = document.getElementById('code-input') as HTMLTextAreaElement;
        const display = document.getElementById('code-display');
        const sidebar = document.getElementById('code-sidebar');
        if (!input || !display || !sidebar) return;

        display.innerHTML = '';
        sidebar.innerHTML = '';

        sidebar.style.height = `${input.clientHeight}px`;

        const breakableLines = new Set(this.debugInfo?.lineNoMap.values() || []);

        // 处理文本，确保最后一行也能正确显示（完全照搬 test.html）
        const text = input.value;
        const lines = text.endsWith('\n')
            ? text.split('\n').slice(0, -1).concat([''])
            : text.split('\n');

        lines.forEach((lineText, index) => {
            const lineNumber = index + 1;
            const isBreakable = breakableLines.has(lineNumber);
            {
                const lineElement = document.createElement('div');
                // lineElement.className = 'code-line';

                // 代码内容
                const codeElement = document.createElement('div');
                codeElement.className = 'code-content';
                codeElement.innerHTML = this.highlightComment(lineText || ' ');

                lineElement.appendChild(codeElement);

                display.appendChild(lineElement);
            }
            {
                const lineElement = document.createElement('div');
                lineElement.className = 'code-line';
                // 断点区域
                const breakpointArea = document.createElement('div');
                breakpointArea.className = 'breakpoint-area';

                if (isBreakable) {
                    const breakpointDot = document.createElement('div');
                    breakpointDot.className = `breakpoint-dot ${this.breakpoints.has(lineNumber) ? 'active' : 'empty'}`;
                    breakpointDot.addEventListener('click', () => this.toggleBreakpoint(lineNumber));
                    breakpointArea.appendChild(breakpointDot);
                }

                lineElement.appendChild(breakpointArea);

                // 行号
                const lineNumElement = document.createElement('div');
                lineNumElement.className = 'line-number';
                lineNumElement.textContent = String(lineNumber).padStart(3, ' ');

                lineElement.appendChild(lineNumElement);
                sidebar.appendChild(lineElement);
            }
        });

        input.dispatchEvent(new Event('scroll'));
    }

    private updateCurrentLine(lineNumber?: number | null): void {
        const sidebar = document.getElementById('code-sidebar');
        const input = document.getElementById('code-input') as HTMLTextAreaElement;
        if (!sidebar || !input) return;

        const lines = sidebar.querySelectorAll('.code-line');

        // 移除旧的高亮
        if (this.currentLine !== null && this.currentLine >= 1 && this.currentLine <= lines.length) {
            lines[this.currentLine - 1].classList.remove('current-line');
        }

        let targetLineNumber = lineNumber;
        if (targetLineNumber === undefined && this.debugInfo) {
            targetLineNumber = this.debugInfo.lineNoMap.get(0);
        }

        // 添加新的高亮并滚动
        if (targetLineNumber !== undefined && targetLineNumber !== null && targetLineNumber >= 1 && targetLineNumber <= lines.length) {
            const targetLine = lines[targetLineNumber - 1] as HTMLElement;
            targetLine.classList.add('current-line');

            // 计算目标行的位置
            const lineTop = targetLine.offsetTop;

            // 滚动 textarea，display 会通过 scroll 事件自动同步
            if (input.scrollTop === lineTop) {
                input.dispatchEvent(new Event('scroll'));
            }
            input.scrollTop = lineTop;
        }

        this.currentLine = targetLineNumber ?? null;
    }

    private highlightComment(text: string): string {
        const parts = text.split(';');
        if (parts.length === 1) {
            return text;
        }

        const codePart = parts[0];
        const commentPart = parts.slice(1).join(';');

        return `<span>${codePart}</span><span class="comment">;${commentPart}</span>`;
    }

    private toggleBreakpoint(lineNumber: number): void {
        if (!this.breakpointsEnabled) return;

        if (this.breakpoints.has(lineNumber)) {
            this.breakpoints.delete(lineNumber);
        } else {
            this.breakpoints.add(lineNumber);
        }

        const sidebar = document.getElementById('code-sidebar');
        if (!sidebar) return;

        const lines = sidebar.querySelectorAll('.code-line');
        if (lines[lineNumber - 1]) {
            const breakpointDot = lines[lineNumber - 1].querySelector('.breakpoint-dot');
            if (breakpointDot) {
                breakpointDot.className = `breakpoint-dot ${this.breakpoints.has(lineNumber) ? 'active' : 'empty'}`;
            }
        }
    }

    private updateStatePanel(): void {
        if (this.vm) {
            const state = this.vm.getState();

            const pcEl = document.getElementById('state-pc');
            const accEl = document.getElementById('state-acc');
            const spEl = document.getElementById('state-sp');
            const statusEl = document.getElementById('status-container');
            const stackEl = document.getElementById('stack-container');
            const ramEl = document.getElementById('ram-container');

            if (pcEl) pcEl.textContent = `0x${state.pc.toString(16).toUpperCase().padStart(4, '0')}`;
            if (accEl) accEl.textContent = `0x${state.acc.toString(16).toUpperCase().padStart(2, '0')}`;
            if (spEl) spEl.textContent = String(state.stackPtr);

            if (statusEl) {
                const status = state.ram[3];
                const flags = [
                    { name: 'RP1', mask: 0x40 },
                    { name: 'RP0', mask: 0x20 },
                    { name: 'TO', mask: 0x10 },
                    { name: 'PD', mask: 0x08 },
                    { name: 'Z', mask: 0x04 },
                    { name: 'DC', mask: 0x02 },
                    { name: 'C', mask: 0x01 },
                ];

                const items = statusEl.querySelectorAll('.status-item');
                flags.forEach((flag, index) => {
                    if (items[index]) {
                        items[index].className = `status-item ${(status & flag.mask) ? 'active' : ''}`;
                    }
                });
            }

            if (stackEl) {
                const items = stackEl.querySelectorAll('.stack-item');
                for (let i = 0; i < state.stack.length && i < items.length; i++) {
                    const val = state.stack[i];
                    items[i].className = `stack-item${i === state.stackPtr ? ' stack-pointer' : ''}`;
                    items[i].textContent = `${i}: 0x${val.toString(16).toUpperCase().padStart(4, '0')}`;
                }
            }

            if (ramEl) {
                const cells = ramEl.querySelectorAll('.ram-cell');
                cells.forEach((cell, index) => {
                    const val = state.ram[index];
                    cell.textContent = val.toString(16).toUpperCase().padStart(2, '0');
                });
            }

            const portaContainer = document.getElementById('io-porta');
            if (portaContainer) {
                const pins = portaContainer.querySelectorAll('.io-pin');
                pins.forEach((pin, i) => {
                    const ioStateVal = this.ioState.get(`A${i}`);
                    pin.className = `io-pin ${ioStateVal === null ? 'floating' : (ioStateVal ? 'high' : 'low')}`;
                });
            }

            const portbContainer = document.getElementById('io-portb');
            if (portbContainer) {
                const pins = portbContainer.querySelectorAll('.io-pin');
                pins.forEach((pin, i) => {
                    const ioStateVal = this.ioState.get(`B${i}`);
                    pin.className = `io-pin ${ioStateVal === null ? 'floating' : (ioStateVal ? 'high' : 'low')}`;
                });
            }

            const cyclesEl = document.getElementById('cpu-cycles');
            if (cyclesEl) {
                cyclesEl.textContent = String(state.cycles).padStart(1, ' ');
            }
        }
    }

    private run(): void {
        if (this.vm) {
            this.isRunning = true;
            this.isStepping = false;
            this.executeCycle();

            return;
        } else {
            this.assembleCode();
        }
        if (this.vm) {
            this.isRunning = true;
            this.isStepping = false;

            this.updateStopButton();

            this.executeCycle();
        }
    }

    private step(): void {
        let shouldUpdateStopButton = this.vm === null || this.isRunning;
        if (this.vm) {
            //
        } else {
            this.assembleCode();
        }
        if (this.vm) {
            this.isRunning = false;
            this.isStepping = true;
            if (shouldUpdateStopButton) {
                this.updateStopButton();
            }

            this.executeCycle();
        }
    }

    private pause(): void {
        this.isRunning = false;
        this.isStepping = false;
        this.updateStopButton();

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    private reset(): void {
        let shouldUpdateCurrentLine = this.vm !== null;
        if (this.vm) {
            //
        } else {
            this.assembleCode();
        }
        if (this.vm) {
            this.vm.reset();

            if (shouldUpdateCurrentLine) {
                this.updateCurrentLine();
            }
            this.updateStopButton();
        }
    }

    private stop(): void {
        this.pause();
        this.vm = null;

        this.updateCurrentLine(null);
        this.updateStopButton();
    }

    private updateStopButton(): void {
        const input = document.getElementById('code-input') as HTMLTextAreaElement;
        if (input) {
            input.disabled = this.vm !== null;
        }
        const btn = document.getElementById('btn-stop');
        if (btn) {
            btn.className = `debug-btn btn-stop ${this.vm ? 'on' : ''}`;
        }
        {
            const btn = document.getElementById('btn-pause');
            if (btn) {
                btn.style.display = this.isRunning ? '' : 'none';
            }
        }
    }

    private toggleIOPin(port: 'A' | 'B', pin: number): void {
        if (this.vm) {
            const key = `${port}${pin}`;
            const currentState = this.ioState.get(key);

            let newValue: boolean;
            if (currentState === null || currentState === false) {
                newValue = true;
            } else {
                newValue = false;
            }

            this.vm.setPinInput(port, pin, newValue);
            this.ioState.set(key, newValue);
            this.updateStatePanel();
        }
    }

    private toggleBreakpointsEnabled(): void {
        this.breakpointsEnabled = !this.breakpointsEnabled;
        const btn = document.getElementById('btn-breakpoint');
        if (btn) {
            btn.className = `debug-btn btn-breakpoint ${this.breakpointsEnabled ? '' : 'off'}`;
        }
    }

    private executeCycle(): void {
        if (this.vm && this.debugInfo) {
            const callback = () => {
                const state = this.vm!.getState();

                const sourceLine = this.debugInfo!.lineNoMap.get(state.pc);
                if (this.isStepping) {
                    if (sourceLine !== this.currentLine) {
                        this.isRunning = false;
                        this.isStepping = false;
                    }
                }
                if (sourceLine !== undefined) {
                    this.updateCurrentLine(sourceLine);

                    if (this.breakpointsEnabled && this.breakpoints.has(sourceLine)) {
                        this.isRunning = false;
                        this.isStepping = false;
                    }
                }

                this.updateStatePanel();

                if (this.isRunning) {
                    this.animationFrameId = requestAnimationFrame(() => this.executeCycle());
                }
            };

            this.vm.run(1, callback);
        }
    }

    private setupEventListeners(): void {
        document.getElementById('btn-run')?.addEventListener('click', () => this.run());
        document.getElementById('btn-step')?.addEventListener('click', () => this.step());
        document.getElementById('btn-pause')?.addEventListener('click', () => this.pause());
        document.getElementById('btn-reset')?.addEventListener('click', () => this.reset());
        document.getElementById('btn-stop')?.addEventListener('click', () => this.stop());
        document.getElementById('btn-breakpoint')?.addEventListener('click', () => this.toggleBreakpointsEnabled());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'F5' && e.shiftKey && e.ctrlKey) {
                e.preventDefault();
                this.reset();
            } else if (e.key === 'F5' && e.shiftKey && !e.ctrlKey) {
                e.preventDefault();
                this.stop();
            } else if (e.key === 'F5' && !e.shiftKey && !e.ctrlKey) {
                e.preventDefault();
                this.run();
            } else if (e.key === 'F6') {
                e.preventDefault();
                this.pause();
            } else if (e.key === 'F9') {
                e.preventDefault();
                if (this.breakpointsEnabled && this.debugInfo) {
                    const input = document.getElementById('code-input') as HTMLTextAreaElement;
                    let targetLine: number;
                    if (input && !input.disabled) {
                        targetLine = input.value.substring(0, input.selectionStart).split('\n').length;
                    } else {
                        if (this.currentLine !== null) {
                            targetLine = this.currentLine;
                            this.toggleBreakpoint(targetLine);
                        }
                        return;
                    }
                    this.toggleBreakpoint(targetLine);
                }
            } else if (e.key === 'F10') {
                e.preventDefault();
                this.step();
            }
        });

        // 编辑器事件绑定（完全照搬 test.html）
        const input = document.getElementById('code-input') as HTMLTextAreaElement;
        const display = document.getElementById('code-display');
        const sidebar = document.getElementById('code-sidebar');
        const editor = document.getElementById('code-editor');

        if (input && display && sidebar) {
            // 同步内容（当用户输入时）
            input.addEventListener('input', () => {
                this.debugInfo = null;
                this.breakpoints.clear();

                this.updateCodeInput();
            });

            // 同步滚动
            input.addEventListener('scroll', () => {
                display.scrollTop = input.scrollTop;
                display.scrollLeft = input.scrollLeft;
                sidebar.scrollTop = input.scrollTop;
            });
        }

        // 点击空白处聚焦
        if (input && editor) {
            editor.addEventListener('click', () => input.focus());
        }

        const portaContainer = document.getElementById('io-porta');
        if (portaContainer) {
            const pins = portaContainer.querySelectorAll('.io-pin');
            pins.forEach((pin, i) => {
                this.ioState.set(`A${i}`, null);
                pin.addEventListener('click', () => this.toggleIOPin('A', i));
            });
        }

        const portbContainer = document.getElementById('io-portb');
        if (portbContainer) {
            const pins = portbContainer.querySelectorAll('.io-pin');
            pins.forEach((pin, i) => {
                this.ioState.set(`B${i}`, null);
                pin.addEventListener('click', () => this.toggleIOPin('B', i));
            });
        }
    }
}

new IDE();
