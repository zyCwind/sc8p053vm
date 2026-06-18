/**
 * @license sc8p053vm
 * Copyright (c) 2026 391321232@qq.com
 * Licensed under BSL-1.1 (see LICENSE). Changes to MIT after 2099-12-31.
 */

import hljs from 'highlight.js/lib/core';
import c from 'highlight.js/lib/languages/c';
import React, { createRef } from 'react';
import ReactDOM from 'react-dom/client';
import { compile, DebugInfo, VM } from 'sc8p053vm';

import 'highlight.js/styles/github-dark.css';
import './styles.css';

hljs.registerLanguage('c', c);

class App extends React.Component<
    {},
    {
        breakpoints: Set<number>;
        code: string;
        currentLine?: number;
        debugInfo: DebugInfo | null;
        error: string | null;
        isBreakpointsEnabled: boolean;
        isRunning: boolean;
        ports: {
            A: number;
            B: number;
        };
        vm: VM | null;
    }
> {
    private animationFrameId: number | null = null;
    private currentLine = createRef<HTMLDivElement>();
    private display = createRef<HTMLDivElement>();
    private input = createRef<HTMLTextAreaElement>();
    private isStepping = false;
    private sidebar = createRef<HTMLDivElement>();

    private onKeydown = (e: KeyboardEvent) => {
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
            if (this.state.currentLine !== undefined) {
                this.toggleBreakpoint(this.state.currentLine);
            }
        } else if (e.key === 'F10') {
            e.preventDefault();
            this.step();
        }
    };

    private onResize = (e: UIEvent) => {
        if (this.input.current && this.sidebar.current) {
            this.sidebar.current.style.height = `${this.input.current.clientHeight}px`;
        }
    };

    constructor(props: {}) {
        super(props);
        this.state = {
            breakpoints: new Set<number>(),
            code: '',
            currentLine: undefined,
            debugInfo: null,
            error: null,
            isBreakpointsEnabled: true,
            isRunning: false,
            ports: { A: 0, B: 0 },
            vm: null,
        };
    }

    private async compileCode() {
        try {
            const { debugInfo, rom } = await compile(this.state.code);
            const vm = new VM(rom);
            vm.ioCallback = (ports) => {
                this.setState({ ports });
            };
            const { start } = debugInfo.fnRanges.get('main')?.[0] || {};
            this.setState({
                currentLine: start !== undefined ? debugInfo.lineNoMap.get(start) : undefined,
                debugInfo,
                error: null,
                vm,
            });
        } catch (e) {
            this.setState({
                error: e instanceof Error ? e.message : 'Unknown compilation error',
            });
            throw e;
        }
    }

    private async run() {
        try {
            if (!this.state.vm) {
                await this.compileCode();
            }
            this.isStepping = false;
            this.executeCycle();
        } catch (e) {
            //
        }
    }

    private pause() {
        this.setState({ isRunning: false });
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    private async step() {
        try {
            if (!this.state.vm) {
                await this.compileCode();
            }
            this.isStepping = true;
            this.executeCycle();
        } catch (e) {
            //
        }
    }

    private async reset() {
        try {
            if (!this.state.vm) {
                await this.compileCode();
            } else {
                if (this.state.debugInfo) {
                    const { start } = this.state.debugInfo.fnRanges.get('main')?.[0] || {};
                    this.setState({
                        currentLine:
                            start !== undefined
                                ? this.state.debugInfo.lineNoMap.get(start)
                                : undefined,
                    });
                }
            }
            this.state.vm?.reset();
        } catch (e) {
            //
        }
    }

    private stop() {
        this.pause();
        this.setState({ currentLine: undefined, debugInfo: null, vm: null });
    }

    private toggleBreakpoint(targetLine: number) {
        if (this.state.isBreakpointsEnabled && this.state.debugInfo) {
            if (this.state.breakpoints.has(targetLine)) {
                this.state.breakpoints.delete(targetLine);
            } else {
                this.state.breakpoints.add(targetLine);
            }
            this.setState({ breakpoints: this.state.breakpoints });
        }
    }

    private toggleBreakpointsEnabled() {
        this.setState({ isBreakpointsEnabled: !this.state.isBreakpointsEnabled });
    }

    private togglePinInput(port: 'A' | 'B', pin: number) {
        this.setState(
            { ports: { ...this.state.ports, [port]: this.state.ports[port] ^ (1 << pin) } },
            () => {
                this.state.vm?.setPinInput(port, pin, Boolean(this.state.ports[port] & (1 << pin)));
            },
        );
    }

    private executeCycle() {
        this.state.vm?.run(1, () => {
            if (this.state.vm) {
                const { pc } = this.state.vm.getState();
                const currentLine = this.state.debugInfo?.lineNoMap.get(pc);
                if (currentLine !== undefined && currentLine !== this.state.currentLine) {
                    this.setState({ currentLine });
                    if (this.isStepping) {
                        this.setState({ isRunning: false });
                        return;
                    }
                    if (
                        this.state.isBreakpointsEnabled &&
                        this.state.breakpoints.has(currentLine)
                    ) {
                        this.setState({ isRunning: false });
                        return;
                    }
                }
                if (!this.state.isRunning) {
                    this.setState({ isRunning: true });
                }
                this.animationFrameId = requestAnimationFrame(() => this.executeCycle());
            }
        });
    }

    componentDidMount() {
        document.addEventListener('keydown', this.onKeydown);
        window.addEventListener('resize', this.onResize);
        fetch('public/main.c')
            .then((response) => response.text())
            .then((text) => {
                this.setState({ code: text });
            });
    }

    componentDidUpdate(
        prevProps: Readonly<{}>,
        prevState: Readonly<{
            breakpoints: Set<number>;
            code: string;
            currentLine?: number;
            debugInfo: DebugInfo | null;
            error: string | null;
            isBreakpointsEnabled: boolean;
            isRunning: boolean;
            ports: { A: number; B: number };
            vm: VM | null;
        }>,
        snapshot?: any,
    ): void {
        if (prevState.currentLine !== this.state.currentLine) {
            if (this.input.current && this.currentLine.current) {
                if (this.input.current.scrollTop === this.currentLine.current.offsetTop) {
                    this.input.current.dispatchEvent(new Event('scroll'));
                } else {
                    this.input.current.scrollTop = this.currentLine.current.offsetTop;
                }
            }
        }
        if (prevState.code !== this.state.code) {
            if (this.input.current && this.sidebar.current) {
                this.sidebar.current.style.height = `${this.input.current.clientHeight}px`;
            }
        }
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.onKeydown);
        window.removeEventListener('resize', this.onResize);
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    render() {
        const breakableLines = new Set(this.state.debugInfo?.lineNoMap.values() ?? []);
        const { pc, acc, sp, stack, ram, cycles } = this.state.vm?.getState() ?? {
            pc: 0,
            acc: 0,
            sp: 0,
            stack: new Uint16Array(8),
            ram: new Uint8Array(256),
            cycles: 0,
        };
        let currentFn;
        if (this.state.debugInfo) {
            for (const [name, ranges] of this.state.debugInfo.fnRanges) {
                for (const { start, end } of ranges) {
                    if (pc >= start && pc < end) {
                        currentFn = name;
                        break;
                    }
                }
                if (currentFn) break;
            }
        }
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div className="debug-bar header" id="debug-bar">
                    <div style={{ position: 'relative' }}>
                        <button
                            className="debug-btn btn-run"
                            id="btn-run"
                            onClick={() => this.run()}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
                                <path d="M187.2 100.9C174.8 94.1 159.8 94.4 147.6 101.6C135.4 108.8 128 121.9 128 136L128 504C128 518.1 135.5 531.2 147.6 538.4C159.7 545.6 174.8 545.9 187.2 539.1L523.2 355.1C536 348.1 544 334.6 544 320C544 305.4 536 291.9 523.2 284.9L187.2 100.9z" />
                            </svg>
                        </button>
                        <button
                            className="debug-btn btn-pause"
                            id="btn-pause"
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                display: this.state.isRunning ? 'block' : 'none',
                            }}
                            onClick={() => this.pause()}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
                                <path d="M176 96C149.5 96 128 117.5 128 144L128 496C128 522.5 149.5 544 176 544L240 544C266.5 544 288 522.5 288 496L288 144C288 117.5 266.5 96 240 96L176 96zM400 96C373.5 96 352 117.5 352 144L352 496C352 522.5 373.5 544 400 544L464 544C490.5 544 512 522.5 512 496L512 144C512 117.5 490.5 96 464 96L400 96z" />
                            </svg>
                        </button>
                    </div>
                    <button
                        className="debug-btn btn-step"
                        id="btn-step"
                        onClick={() => this.step()}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
                            <path d="M598.6 342.6C611.1 330.1 611.1 309.8 598.6 297.3L470.6 169.3C458.1 156.8 437.8 156.8 425.3 169.3C412.8 181.8 412.8 202.1 425.3 214.6L498.7 288L64 288C46.3 288 32 302.3 32 320C32 337.7 46.3 352 64 352L498.7 352L425.3 425.4C412.8 437.9 412.8 458.2 425.3 470.7C437.8 483.2 458.1 483.2 470.6 470.7L598.6 342.7z" />
                        </svg>
                    </button>
                    <button
                        className="debug-btn btn-reset"
                        id="btn-reset"
                        onClick={() => this.reset()}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
                            <path d="M320 128C263.2 128 212.1 152.7 176.9 192L224 192C241.7 192 256 206.3 256 224C256 241.7 241.7 256 224 256L96 256C78.3 256 64 241.7 64 224L64 96C64 78.3 78.3 64 96 64C113.7 64 128 78.3 128 96L128 150.7C174.9 97.6 243.5 64 320 64C461.4 64 576 178.6 576 320C576 461.4 461.4 576 320 576C233 576 156.1 532.6 109.9 466.3C99.8 451.8 103.3 431.9 117.8 421.7C132.3 411.5 152.2 415.1 162.4 429.6C197.2 479.4 254.8 511.9 320 511.9C426 511.9 512 425.9 512 319.9C512 213.9 426 128 320 128z" />
                        </svg>
                    </button>
                    <button
                        className={`debug-btn btn-stop ${this.state.vm !== null ? 'on' : ''}`}
                        id="btn-stop"
                        onClick={() => this.stop()}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
                            <path d="M160 96L480 96C515.3 96 544 124.7 544 160L544 480C544 515.3 515.3 544 480 544L160 544C124.7 544 96 515.3 96 480L96 160C96 124.7 124.7 96 160 96z" />
                        </svg>
                    </button>
                    <button
                        className={`debug-btn btn-breakpoint ${this.state.isBreakpointsEnabled ? '' : 'off'}`}
                        id="btn-breakpoint"
                        onClick={() => this.toggleBreakpointsEnabled()}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
                            <path d="M320 576C178.6 576 64 461.4 64 320C64 178.6 178.6 64 320 64C461.4 64 576 178.6 576 320C576 461.4 461.4 576 320 576zM320 112C205.1 112 112 205.1 112 320C112 434.9 205.1 528 320 528C434.9 528 528 434.9 528 320C528 205.1 434.9 112 320 112zM320 416C267 416 224 373 224 320C224 267 267 224 320 224C373 224 416 267 416 320C416 373 373 416 320 416z" />
                        </svg>
                    </button>
                </div>

                <div className="main-content">
                    <div className="code-editor">
                        <div className="sidebar-layer" id="code-sidebar" ref={this.sidebar}>
                            {this.state.code.split('\n').map((line, index) => (
                                <div key={index}>
                                    <div
                                        className={`code-line ${this.state.currentLine === index + 1 ? 'current-line' : ''}`}
                                        {...(this.state.currentLine === index + 1 && {
                                            ref: this.currentLine,
                                        })}
                                    >
                                        <div className="breakpoint-area">
                                            {breakableLines.has(index + 1) && (
                                                <div
                                                    className={`breakpoint-dot ${this.state.breakpoints.has(index + 1) ? 'active' : 'inactive'}`}
                                                    onClick={() => this.toggleBreakpoint(index + 1)}
                                                ></div>
                                            )}
                                        </div>
                                        <div className="line-number">
                                            {String(index + 1).padStart(3, ' ')}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div
                            id="code-editor"
                            style={{ position: 'relative', margin: '0 0 0 74px', height: '100%' }}
                            onClick={() => this.input.current?.focus()}
                        >
                            <div
                                className="display-layer"
                                id="code-display"
                                {...{ inert: '' }}
                                ref={this.display}
                            >
                                {this.state.code.split('\n').map((line, index) => (
                                    <div key={index}>
                                        <div
                                            className="code-content"
                                            dangerouslySetInnerHTML={{
                                                __html: `<span>${hljs.highlight(line, { language: 'c' }).value}</span>`,
                                            }}
                                        ></div>
                                    </div>
                                ))}
                            </div>
                            <textarea
                                className="input-layer"
                                id="code-input"
                                disabled={this.state.vm !== null}
                                spellCheck={false}
                                onInput={() =>
                                    this.setState({ code: this.input.current?.value || '' })
                                }
                                value={this.state.code}
                                ref={this.input}
                                onScroll={() => {
                                    if (this.input.current) {
                                        if (this.display.current) {
                                            this.display.current.scrollTop =
                                                this.input.current.scrollTop;
                                            this.display.current.scrollLeft =
                                                this.input.current.scrollLeft;
                                        }
                                        if (this.sidebar.current) {
                                            this.sidebar.current.scrollTop =
                                                this.input.current.scrollTop;
                                        }
                                    }
                                }}
                            ></textarea>
                        </div>
                    </div>

                    <div className="state-panel" id="state-panel">
                        <div className="sub-panel">
                            <div className="sub-title">REGISTER</div>
                            <div className="state-grid">
                                <div className="state-item">
                                    <span className="state-label">PC:</span>
                                    <span
                                        className="state-value"
                                        id="state-pc"
                                    >{`0x${pc.toString(16).toUpperCase().padStart(4, '0')}`}</span>
                                </div>
                                <div className="state-item">
                                    <span className="state-label">ACC:</span>
                                    <span
                                        className="state-value"
                                        id="state-acc"
                                    >{`0x${acc.toString(16).toUpperCase().padStart(2, '0')}`}</span>
                                </div>
                                <div className="state-item">
                                    <span className="state-label">SP:</span>
                                    <span
                                        className="state-value"
                                        id="state-sp"
                                    >{`0x${sp.toString(16).toUpperCase().padStart(2, '0')}`}</span>
                                </div>
                            </div>
                        </div>
                        <div className="sub-panel">
                            <div className="sub-title">STATUS</div>
                            <div className="status-container" id="status-container">
                                <div className={`status-item ${ram[3] & 0x40 ? 'active' : ''}`}>
                                    RP1
                                </div>
                                <div className={`status-item ${ram[3] & 0x20 ? 'active' : ''}`}>
                                    RP0
                                </div>
                                <div className={`status-item ${ram[3] & 0x10 ? 'active' : ''}`}>
                                    TO
                                </div>
                                <div className={`status-item ${ram[3] & 0x08 ? 'active' : ''}`}>
                                    PD
                                </div>
                                <div className={`status-item ${ram[3] & 0x04 ? 'active' : ''}`}>
                                    Z
                                </div>
                                <div className={`status-item ${ram[3] & 0x02 ? 'active' : ''}`}>
                                    DC
                                </div>
                                <div className={`status-item ${ram[3] & 0x01 ? 'active' : ''}`}>
                                    C
                                </div>
                            </div>
                        </div>

                        <div className="sub-panel">
                            <div className="sub-title">STACK</div>
                            <div className="stack-container" id="stack-container">
                                {[...stack].map((val, index) => {
                                    let fnName;
                                    if (this.state.debugInfo) {
                                        for (const [name, ranges] of this.state.debugInfo
                                            .fnRanges) {
                                            for (const r of ranges) {
                                                if (val >= r.start && val < r.end) {
                                                    fnName = name;
                                                    break;
                                                }
                                            }
                                            if (fnName) break;
                                        }
                                    }
                                    return (
                                        <div
                                            key={index}
                                            className={`stack-item ${index === sp ? 'stack-pointer' : ''}`}
                                        >
                                            <span
                                                style={{ marginRight: '8px' }}
                                            >{`${index}:`}</span>
                                            <span>{`0x${val.toString(16).toUpperCase().padStart(4, '0')}${fnName ? `<${fnName}>` : ''}`}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="sub-panel">
                            <div className="sub-title">LOCAL</div>
                            <div
                                id="local-container"
                                style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}
                            >
                                {(currentFn &&
                                    this.state.debugInfo?.varMap
                                        .get(currentFn)
                                        ?.map((sym, index) => (
                                            <div key={index} className="state-item">
                                                {sym.typeInfo.isArray ? (
                                                    <>
                                                        <span className="state-label">
                                                            {`${sym.name}<${sym.typeInfo.arraySize}>`}
                                                            :
                                                        </span>
                                                        <span className="state-value">{`0x${sym.ramAddr.toString(16).toUpperCase().padStart(2, '0')}`}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="state-label">
                                                            {sym.name}:
                                                        </span>
                                                        <span className="state-value">{`0x${ram[sym.ramAddr].toString(16).toUpperCase().padStart(2, '0')}`}</span>
                                                    </>
                                                )}
                                            </div>
                                        ))) || <div className="state-item">&nbsp;</div>}
                            </div>
                        </div>

                        <div className="sub-panel">
                            <div className="sub-title">GLOBAL</div>
                            <div
                                id="global-container"
                                style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}
                            >
                                {this.state.debugInfo?.varMap.get('global')?.map((sym, index) => (
                                    <div key={index} className="state-item">
                                        {sym.typeInfo.isArray ? (
                                            <>
                                                <span className="state-label">
                                                    {`${sym.name}<${sym.typeInfo.arraySize}>`}:
                                                </span>
                                                <span className="state-value">{`0x${sym.ramAddr.toString(16).toUpperCase().padStart(2, '0')}`}</span>
                                            </>
                                        ) : (
                                            <>
                                                <span className="state-label">
                                                    {`${sym.name}`}:
                                                </span>
                                                <span className="state-value">{`0x${ram[sym.ramAddr].toString(16).toUpperCase().padStart(2, '0')}`}</span>
                                            </>
                                        )}
                                    </div>
                                )) ?? <div className="state-item">&nbsp;</div>}
                            </div>
                        </div>

                        <div className="sub-panel">
                            <div className="sub-title">MEMORY</div>
                            <div className="ram-container" id="ram-container">
                                {'0'
                                    .repeat(Math.ceil(ram.length / 8))
                                    .split('')
                                    .map((_, i) => (
                                        <div key={i} className="ram-row">
                                            <div className="ram-address">{`0x${i.toString(16).toUpperCase().padStart(2, '0')}`}</div>
                                            <div className="ram-grid">
                                                {[...ram.slice(i * 8, (i + 1) * 8)].map(
                                                    (val, j) => (
                                                        <div
                                                            key={j}
                                                            className="ram-cell"
                                                            title={`0x${(i * 8 + j).toString(16).toUpperCase().padStart(2, '0')}`}
                                                        >{`${val.toString(16).toUpperCase().padStart(2, '0')}`}</div>
                                                    ),
                                                )}
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>

                        <div className="sub-panel">
                            <div className="sub-title">PORT A</div>
                            <div className="io-pins" id="io-porta">
                                <div
                                    className={`io-pin ${this.state.ports.A & 0x01 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('A', 0)}
                                >
                                    A0
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.A & 0x02 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('A', 1)}
                                >
                                    A1
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.A & 0x04 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('A', 2)}
                                >
                                    A2
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.A & 0x08 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('A', 3)}
                                >
                                    A3
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.A & 0x10 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('A', 4)}
                                >
                                    A4
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.A & 0x20 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('A', 5)}
                                >
                                    A5
                                </div>
                            </div>
                        </div>

                        <div className="sub-panel">
                            <div className="sub-title">PORT B</div>
                            <div className="io-pins" id="io-portb">
                                <div
                                    className={`io-pin ${this.state.ports.B & 0x01 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('B', 0)}
                                >
                                    B0
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.B & 0x02 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('B', 1)}
                                >
                                    B1
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.B & 0x04 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('B', 2)}
                                >
                                    B2
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.B & 0x08 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('B', 3)}
                                >
                                    B3
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.B & 0x10 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('B', 4)}
                                >
                                    B4
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.B & 0x20 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('B', 5)}
                                >
                                    B5
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.B & 0x40 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('B', 6)}
                                >
                                    B6
                                </div>
                                <div
                                    className={`io-pin ${this.state.ports.B & 0x80 ? 'high' : 'low'}`}
                                    onClick={() => this.togglePinInput('B', 7)}
                                >
                                    B7
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="debug-bar footer" id="status-bar">
                    {this.state.error && (
                        <div style={{ flex: 1, color: '#ecf0f1', fontSize: '13px' }}>
                            <span style={{ color: '#e74c3c', marginRight: '8px' }}>Error:</span>
                            <span>{this.state.error}</span>
                        </div>
                    )}
                    <div style={{ marginLeft: 'auto', color: '#ecf0f1', fontSize: '13px' }}>
                        <span style={{ marginRight: '8px' }}>CPU:</span>
                        <span id="cpu-cycles" style={{ color: '#ecf0f1' }}>{`${cycles}`}</span>
                    </div>
                </div>
            </div>
        );
    }
}

export default App;

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);
