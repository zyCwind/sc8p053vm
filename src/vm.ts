/**
 * @license sc8p053vm
 * Copyright (c) 2026 391321232@qq.com
 * Licensed under BSL-1.1 (see LICENSE). Changes to MIT after 2099-12-31.
 */

/**
 * Reset source enumeration
 */
enum ResetSource {
    POR = 0, // Power-on Reset
    WDT = 1, // Watchdog Timer Reset
    LVR = 2, // Low Voltage Reset
    STOP = 3, // STOP Instruction Wakeup
}

export class VM {
    // 内存配置
    private static readonly RAM_SIZE = 0x100; // 256字节地址空间(含SFR和80字节通用RAM)
    private static readonly STACK_SIZE = 8; // 8级堆栈

    // 内部振荡器频率定义
    private static readonly FHSI = 16_000_000; // 16MHz High-Speed Internal Oscillator
    private static readonly FLSE = 32_768; // 32.768kHz Low-Speed External Oscillator

    // 特殊功能寄存器地址定义(Bank0)
    private static readonly SFR_INDF = 0x00;
    private static readonly SFR_OPTION_REG = 0x01;
    private static readonly SFR_PCL = 0x02;
    private static readonly SFR_STATUS = 0x03;
    private static readonly SFR_FSR = 0x04;
    private static readonly SFR_TRISB = 0x05;
    private static readonly SFR_PORTB = 0x06;
    private static readonly SFR_WPDB = 0x07; // PORTB下拉电阻寄存器
    private static readonly SFR_WPUB = 0x08;
    private static readonly SFR_IOCB = 0x09;
    private static readonly SFR_PCLATH = 0x0a;
    private static readonly SFR_INTCON = 0x0b;
    private static readonly SFR_ODCONB = 0x0c;
    private static readonly SFR_PIR1 = 0x0d;
    private static readonly SFR_PIE1 = 0x0e;
    private static readonly SFR_CMPCON0 = 0x0f;
    private static readonly SFR_CMPCON1 = 0x10;
    private static readonly SFR_PR2 = 0x11;
    private static readonly SFR_TMR2 = 0x12;
    private static readonly SFR_T2CON = 0x13;
    private static readonly SFR_OSCCON = 0x14;
    private static readonly SFR_PWMCON0 = 0x15;
    private static readonly SFR_PWMCON1 = 0x16;
    private static readonly SFR_PWMTL = 0x17;
    private static readonly SFR_PWMTH = 0x18;
    private static readonly SFR_PWMD0L = 0x19;
    private static readonly SFR_PWMD1L = 0x1a;
    private static readonly SFR_PWMD4L = 0x1b;
    private static readonly SFR_PWMT4L = 0x1c;
    private static readonly SFR_PWMCON2 = 0x1d;
    private static readonly SFR_PWMD01H = 0x1e;
    private static readonly SFR_PWM01DT = 0x1f;

    // PWMCON1寄存器位定义
    private static readonly PWMCON1_PWM2DTEN = 0x20; // PWM2/PWM3 dead-time enable
    private static readonly PWMCON1_PWM0DTEN = 0x10; // PWM0/PWM1 dead-time enable

    // 特殊功能寄存器地址定义(Bank1)
    private static readonly SFR_TMR0 = 0x81;
    private static readonly SFR_TRISA = 0x85;
    private static readonly SFR_PORTA = 0x86;
    private static readonly SFR_WPDA = 0x87;
    private static readonly SFR_WPUA = 0x88;
    private static readonly SFR_IOCA = 0x89;
    private static readonly SFR_ODCONA = 0x8c;
    private static readonly SFR_PWMD2L = 0x9b;
    private static readonly SFR_PWMD3L = 0x9c;
    private static readonly SFR_PWM23DT = 0x9d;
    private static readonly SFR_PWMD23H = 0x9e;

    // STATUS寄存器位定义
    private static readonly STATUS_RP1 = 0x40;
    private static readonly STATUS_RP0 = 0x20;
    private static readonly STATUS_TO = 0x10;
    private static readonly STATUS_PD = 0x08;
    private static readonly STATUS_Z = 0x04;
    private static readonly STATUS_DC = 0x02;
    private static readonly STATUS_C = 0x01;
    // Note: Manual Section 2.5 shows STATUS register has only 8 bits (IRP,RP1,RP0,TO,PD,Z,DC,C)
    // OV flag is internal CPU state used by arithmetic instructions but NOT stored in STATUS register

    // OPTION_REG寄存器位定义
    private static readonly OPTION_INTEDG = 0x40;
    private static readonly OPTION_T0CS = 0x20;
    private static readonly OPTION_PSA = 0x08;

    // INTCON寄存器位定义
    private static readonly INTCON_GIE = 0x80;
    private static readonly INTCON_PEIE = 0x40;
    private static readonly INTCON_T0IE = 0x20;
    private static readonly INTCON_INTE = 0x10;
    private static readonly INTCON_RBIE = 0x08;
    private static readonly INTCON_T0IF = 0x04;
    private static readonly INTCON_INTF = 0x02;
    private static readonly INTCON_RBIF = 0x01;

    // PIE1寄存器位定义
    private static readonly PIE1_CMPIE = 0x20;
    private static readonly PIE1_PWMIE = 0x10;
    private static readonly PIE1_RAIE = 0x08;
    private static readonly PIE1_TMR2IE = 0x02;

    // PIR1寄存器位定义
    private static readonly PIR1_CMPIF = 0x20;
    private static readonly PIR1_PWMIF = 0x10;
    private static readonly PIR1_RAIF = 0x08;
    private static readonly PIR1_TMR2IF = 0x02;

    // T2CON寄存器位定义
    private static readonly T2CON_CLK_SEL = 0x80;
    private static readonly T2CON_TMR2ON = 0x04;

    // 虚拟机状态
    private rom: Uint16Array; // 程序内存(1K×16位)
    private ram: Uint8Array; // 数据内存(256字节)
    private stack: Uint16Array; // 8级堆栈(10位地址)
    private sp = 0; // 堆栈指针(0-7)
    private pc = 0; // 程序计数器(10位)
    private acc = 0; // 累加器(8位)
    private wdtElapsedTimeNs = 0; // Elapsed time for WDT in nanoseconds
    private timer0Prescaler = 0; // TIMER0预分频器
    private timer0WriteDisableCycles = 0; // TMR0写入后禁止递增的周期数（手册8.2.1）
    private timer2Prescaler = 0; // TIMER2预分频器 (1:1, 1:4, 1:16)
    private timer2Postscaler = 0; // TIMER2后分频器
    private pwmPeriodCounter = 0; // PWM周期计数器（10位）
    private pwmDutyCache: {
        // PWM占空比缓存（高2位先写入缓存）
        pwm0: number;
        pwm1: number;
        pwm2: number;
        pwm3: number;
        pwm4: number;
    } = { pwm0: 0, pwm1: 0, pwm2: 0, pwm3: 0, pwm4: 0 };
    private pwmDutyActual: {
        // PWM实际占空比（10位）
        pwm0: number;
        pwm1: number;
        pwm2: number;
        pwm3: number;
        pwm4: number;
    } = { pwm0: 0, pwm1: 0, pwm2: 0, pwm3: 0, pwm4: 0 };
    private pwmOutputs: boolean[] = [false, false, false, false, false]; // PWM0-4输出状态
    private pwmDeadTimeCounters: {
        // PWM dead-time counters for complementary outputs
        pwm01: number; // Dead-time counter for PWM0/PWM1 pair
        pwm23: number; // Dead-time counter for PWM2/PWM3 pair
    } = { pwm01: 0, pwm23: 0 };
    private pwmLastState: {
        // Track last state for edge detection in dead-time mode
        pwm01: boolean; // Last state of PWM0 (master channel)
        pwm23: boolean; // Last state of PWM2 (master channel)
    } = { pwm01: false, pwm23: false };
    private compLastOutput = false; // 比较器上次输出（用于边沿检测）
    private portALastValue = 0; // PORTA上次读取值（用于电平变化中断 mismatch 检测）
    private portBLastValue = 0; // PORTB上次读取值（用于电平变化中断 mismatch 检测）
    private intLastState = false; // RB0/INT引脚上次状态（用于边沿检测）
    private compAnalogInputs: {
        // Comparator analog input values (normalized 0.0-1.0)
        cmpPlus: number; // CMP+ pin (RB1)
        cmp0Minus: number; // CMP0- pin (RB2)
        cmp1Minus: number; // CMP1- pin (RB4)
        cmp2Minus: number; // CMP2- pin (RB5)
        cmp3Minus: number; // CMP3- pin (RB1)
    } = { cmpPlus: 0, cmp0Minus: 0, cmp1Minus: 0, cmp2Minus: 0, cmp3Minus: 0 };

    // External pin states - simulates physical I/O behavior per SC8P053 manual
    // Two-bit model per pin: driven state (externallyDriven) + voltage level (externalPinState)
    private externalPinStateA = 0; // Voltage levels for PORTA pins 0-5
    private externalPinStateB = 0; // Voltage levels for PORTB pins 0-7
    private externallyDrivenA = 0; // Mask of explicitly driven PORTA pins
    private externallyDrivenB = 0; // Mask of explicitly driven PORTB pins

    // Clock system state
    private lseEnabled = false; // LSE oscillator enabled (32.768kHz crystal present)
    private lseStabilized = false; // LSE stabilization status
    private lseStabilizationCycles = 0; // Cycles elapsed for LSE stabilization
    private t0ckiFrequency = 0; // T0CKI external clock frequency in Hz (0 = not configured)

    // Comparator digital filter delay
    private compFilterDelayNs = 0; // Remaining delay in nanoseconds for comparator output
    private compPendingOutput = false; // Pending comparator output value

    private cycles = 0; // 已执行指令周期数
    private sleeping = false; // 休眠状态
    private config: {
        // 配置字(OTP选项)
        wdt: boolean;
        lvrSel: number; // 0x00=1.8V, 0x01=2.0V, 0x02=2.5V, 0x03=3.0V
        fcpuDiv: number; // 2或4
    };
    private vdd = 5.0; // 供电电压（用于LVR检测）

    // 外设回调：一次性返回所有I/O端口状态
    public ioCallback?: (ports: { A: number; B: number }) => void;

    constructor(
        romData: Uint16Array,
        config = {
            wdt: false,
            lvrSel: 0x03, // 3.0V
            fcpuDiv: 4, // 默认4分频
        },
    ) {
        // 初始化程序内存
        this.rom = romData;

        // 初始化数据内存
        this.ram = new Uint8Array(VM.RAM_SIZE);

        // 初始化堆栈
        this.stack = new Uint16Array(VM.STACK_SIZE);
        this.sp = 0;

        // 初始化配置
        this.config = { ...config };

        // 复位虚拟机
        this.reset();

        // 初始LVR检查
        this.checkLVR();
    }

    /**
     * Get system clock frequency (FSYS) based on OSCCON.IRCF
     * @returns FSYS in Hz
     */
    private getFSYS(): number {
        const osccon = this.ram[VM.SFR_OSCCON];
        const ircf = (osccon >> 4) & 0x07;

        // IRCF dividers per manual Section 3.4
        const ircfDividers = [32768, 64, 32, 16, 8, 4, 2, 1];
        return VM.FHSI / ircfDividers[ircf];
    }

    /**
     * Get current instruction clock frequency (FCPU) based on OSCCON.IRCF and CONFIG.FCPU_DIV
     * @returns FCPU in Hz
     */
    private getFCPU(): number {
        return this.getFSYS() / this.config.fcpuDiv;
    }

    /**
     * 检查低压复位(LVR)
     */
    private checkLVR(): void {
        const lvrThresholds = [1.8, 2.0, 2.5, 3.0];
        const threshold = lvrThresholds[this.config.lvrSel] || 3.0;

        if (this.vdd < threshold) {
            // LVR触发，执行复位
            this.reset(ResetSource.LVR);
        }
    }

    /**
     * 读取ROM数据（考虑代码保护）
     */
    /**
     * 执行单条指令
     * @returns 执行的指令周期数(1或2)
     */
    private step(): number {
        if (this.sleeping) {
            // 休眠模式下只运行WDT和TIMER2(如果使用外部时钟)
            this.runSleepPeripherals();
            return 1;
        }

        // 取指令(16位) - 直接从ROM读取
        const opcode = this.rom[this.pc];
        let cycles = 1;
        let nextPc = (this.pc + 1) & 0x03ff; // PC是10位

        // 解码并执行指令
        const nextPcObj = { value: nextPc };
        cycles = this.executeInstruction(opcode, nextPcObj);
        nextPc = nextPcObj.value;

        // 更新PC
        this.pc = nextPc;

        // 更新系统时钟和外设
        this.updatePeripherals(cycles);

        // 检查中断
        this.checkInterrupts();

        // 检查LVR
        this.checkLVR();

        this.cycles += cycles;
        return cycles;
    }

    /**
     * 读取内存数据
     * @param address 内存地址(0x00-0xFF)
     * @returns 内存值
     */
    private readRam(address: number): number {
        address &= 0xff;

        // 处理间接寻址(INDF寄存器)
        if (address === VM.SFR_INDF) {
            const fsr = this.ram[VM.SFR_FSR] & 0xff;
            if (fsr === 0x00) return 0x00; // 间接读取0地址返回0
            return this.readRam(fsr);
        }

        // 处理Bank选择
        const status = this.ram[VM.SFR_STATUS];
        const bank = (status & (VM.STATUS_RP1 | VM.STATUS_RP0)) >> 5;

        // 只有Bank0和Bank1有效
        if (bank >= 2) {
            return 0x00;
        }

        // 计算实际地址
        let realAddr = address;

        if (
            (address & 0x7f) == 0x00 ||
            (address & 0x7f) == 0x02 ||
            (address & 0x7f) == 0x03 ||
            (address & 0x7f) == 0x04 ||
            (address & 0x7f) == 0x0a ||
            (address & 0x7f) == 0x0b ||
            (address & 0x70) == 0x70
        ) {
            realAddr = address & 0x7f; // Bank1镜像地址 -> Bank0物理地址
        } else if (bank === 1 && address < 0x80) {
            realAddr = address | 0x80;
        }

        let value = this.ram[realAddr] & 0xff;

        // Apply pull-up/pull-down auto-disable when pin is configured as output
        // Manual Section 6.2.3, 6.2.4, 6.3.3, 6.3.4
        if (realAddr === VM.SFR_WPUA) {
            // PORTA pull-up: disabled when pin is output (TRISA=0)
            const trisa = this.ram[VM.SFR_TRISA];
            value &= trisa; // Mask out bits where TRISA=0 (output)
        } else if (realAddr === VM.SFR_WPDA) {
            // PORTA pull-down: disabled when pin is output (TRISA=0)
            const trisa = this.ram[VM.SFR_TRISA];
            value &= trisa; // Mask out bits where TRISA=0 (output)
        } else if (realAddr === VM.SFR_WPUB) {
            // PORTB pull-up: disabled when pin is output (TRISB=0) or analog input (AN_EN=1), EXCEPT RB3
            const trisb = this.ram[VM.SFR_TRISB];
            const cmpcon1 = this.ram[VM.SFR_CMPCON1];
            const anEn = (cmpcon1 >> 6) & 0x01;

            // Keep RB3 (bit 3) pull-up enabled regardless of TRISB
            const rb3Pullup = value & 0x08;

            // Mask other bits where TRISB=0 (output)
            let maskedValue = value & trisb;

            // If AN_EN=1, also disable pull-up on comparator pins (RB1, RB2, RB4, RB5)
            if (anEn) {
                const cmpns = this.ram[VM.SFR_CMPCON0] & 0x07;
                const cmpps = (this.ram[VM.SFR_CMPCON0] >> 6) & 0x01;

                // Create mask for analog pins
                let analogMask = 0xff; // Start with all bits enabled

                // Disable pull-up on RB1 if used as CMP+ (CMPPS=1) or CMP3- (CMPNS=011)
                if (cmpps === 1 || cmpns === 0b011) {
                    analogMask &= ~0x02; // Clear bit 1 (RB1)
                }

                // Disable pull-up on selected negative input pin
                switch (cmpns) {
                    case 0:
                        analogMask &= ~0x04;
                        break; // RB2 (CMP0-)
                    case 1:
                        analogMask &= ~0x10;
                        break; // RB4 (CMP1-)
                    case 2:
                        analogMask &= ~0x20;
                        break; // RB5 (CMP2-)
                    // case 3 is RB1, already handled above
                }

                maskedValue &= analogMask;
            }

            value = maskedValue | rb3Pullup;
        } else if (realAddr === VM.SFR_WPDB) {
            // PORTB pull-down: disabled when pin is output (TRISB=0), RB3 has no pull-down
            const trisb = this.ram[VM.SFR_TRISB];
            value &= trisb; // Mask out bits where TRISB=0 (output)
        }

        // 根据手册6.2.5和6.3.5节，读取PORTA/PORTB会锁存当前值用于mismatch检测
        // 读取操作结束不匹配状态，允许清除中断标志
        if (realAddr === VM.SFR_PORTA) {
            // Manual Section 6.2.1: Reading PORTA returns pin state
            let portValue = 0;
            for (let i = 0; i < 6; i++) {
                // 首先检查是否是PWM输出引脚（优先级最高）
                const pwmChannel = this.getPwmChannel('A', i);
                if (pwmChannel !== null) {
                    // 该引脚由PWM控制，返回PWM的实际电平
                    if (this.pwmOutputs[pwmChannel]) {
                        portValue |= 1 << i;
                    }
                } else {
                    // 非PWM引脚，使用统一的计算方法
                    if (this.getPinState('A', i, value)) {
                        portValue |= 1 << i;
                    }
                }
            }
            value = portValue;
            this.portALastValue = value; // 用于电平变化中断检测（手册6.2.5）
        } else if (realAddr === VM.SFR_PORTB) {
            // Manual Section 6.3.1: Reading PORTB returns pin state
            let portValue = 0;
            for (let i = 0; i < 8; i++) {
                // 首先检查是否是PWM输出引脚（优先级最高）
                const pwmChannel = this.getPwmChannel('B', i);
                if (pwmChannel !== null) {
                    // 该引脚由PWM控制，返回PWM的实际电平
                    if (this.pwmOutputs[pwmChannel]) {
                        portValue |= 1 << i;
                    }
                } else {
                    // 非PWM引脚，使用统一的计算方法
                    if (this.getPinState('B', i, value)) {
                        portValue |= 1 << i;
                    }
                }
            }
            value = portValue;
            this.portBLastValue = value; // 用于电平变化中断检测（手册6.3.5）

            // Manual Section 6.2.1, 6.3.1: Analog input pins always read as 0
            // Manual Section 6.3.3, 6.3.4: Pull-up/pull-down auto-disabled on analog input pins
            const cmpcon1 = this.ram[VM.SFR_CMPCON1];
            const anEn = (cmpcon1 >> 6) & 0x01;

            if (anEn) {
                const cmpcon0 = this.ram[VM.SFR_CMPCON0];
                const cmpns = cmpcon0 & 0x07;
                const cmpps = (cmpcon0 >> 6) & 0x01;

                // Create mask to zero out analog pins and disable pull-up/pull-down
                let analogMask = 0xff;

                // Zero RB1 if used as CMP+ (CMPPS=1) or CMP3- (CMPNS=011)
                if (cmpps === 1 || cmpns === 0b011) {
                    analogMask &= ~0x02; // Clear bit 1 (RB1)
                }

                // Zero selected negative input pin
                switch (cmpns) {
                    case 0:
                        analogMask &= ~0x04;
                        break; // RB2 (CMP0-)
                    case 1:
                        analogMask &= ~0x10;
                        break; // RB4 (CMP1-)
                    case 2:
                        analogMask &= ~0x20;
                        break; // RB5 (CMP2-)
                    // case 3 is RB1, already handled above
                }

                value &= analogMask;
            }
        }

        return value;
    }

    /**
     * 写入内存数据
     * @param address 内存地址(0x00-0xFF)
     * @param value 要写入的值
     */
    private writeRam(address: number, value: number): void {
        address &= 0xff;
        value &= 0xff;

        // 处理间接寻址(INDF寄存器)
        if (address === VM.SFR_INDF) {
            const fsr = this.ram[VM.SFR_FSR] & 0xff;
            if (fsr === 0x00) return; // 间接写入0地址是空操作
            this.writeRam(fsr, value);
            return;
        }

        // 处理Bank选择
        const status = this.ram[VM.SFR_STATUS];
        const bank = (status & (VM.STATUS_RP1 | VM.STATUS_RP0)) >> 5;

        // 只有Bank0和Bank1有效
        if (bank >= 2) {
            return;
        }

        // 计算实际物理地址
        let realAddr = address;

        if (
            (address & 0x7f) == 0x00 ||
            (address & 0x7f) == 0x02 ||
            (address & 0x7f) == 0x03 ||
            (address & 0x7f) == 0x04 ||
            (address & 0x7f) == 0x0a ||
            (address & 0x7f) == 0x0b ||
            (address & 0x70) == 0x70
        ) {
            realAddr = address & 0x7f; // Bank1镜像地址 -> Bank0物理地址
        } else if (bank === 1 && address < 0x80) {
            realAddr = address | 0x80;
        }

        // 处理PCL写入(会更新PC)
        if (realAddr === VM.SFR_PCL) {
            const pclath = this.ram[VM.SFR_PCLATH] & 0x03;
            this.pc = ((pclath << 8) | value) & 0x03ff;
        }

        // 特殊寄存器写入处理（PWM、TMR等特殊逻辑）
        this.handleSfrWrite(realAddr, value);

        // 写入RAM
        this.ram[realAddr] = value;

        // 注意：不需要手动同步镜像寄存器，因为地址映射已正确处理
        // 镜像寄存器（INDF/PCL/STATUS/FSR/PCLATH/INTCON）始终访问Bank0的物理地址

        // 根据手册6.2.5和6.3.5节，写入PORTA/PORTB也会结束不匹配状态
        if (realAddr === VM.SFR_PORTA) {
            this.portALastValue = value;
        } else if (realAddr === VM.SFR_PORTB) {
            this.portBLastValue = value;
        }
    }

    /**
     * 执行单条指令
     * @param opcode 16位指令码
     * @param nextPc 下一条指令地址(引用传递)
     * @returns 指令周期数
     */
    private executeInstruction(opcode: number, nextPc: { value: number }): number {
        const f = opcode & 0x7f;
        const imm = opcode & 0xff;
        const bit = (opcode >> 7) & 0x07;
        const addr10 = opcode & 0x03ff;
        let result: number;
        let status = this.readRam(VM.SFR_STATUS);

        switch (opcode) {
            case 0x0000:
                return 1;
            case 0x0008:
                if (this.sp > 0) {
                    this.sp--;
                    nextPc.value = this.stack[this.sp] & 0x03ff;
                }
                return 2;
            case 0x0009:
                if (this.sp > 0) {
                    this.sp--;
                    nextPc.value = this.stack[this.sp] & 0x03ff;
                }
                {
                    let intcon = this.readRam(VM.SFR_INTCON);
                    intcon |= VM.INTCON_GIE;
                    this.writeRam(VM.SFR_INTCON, intcon);
                }
                return 2;
            case 0x0063:
                this.sleeping = true;
                status &= ~VM.STATUS_PD;
                status |= VM.STATUS_TO;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0064:
                this.wdtElapsedTimeNs = 0;
                status |= VM.STATUS_TO | VM.STATUS_PD;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0100:
                this.acc = 0;
                status |= VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
        }

        switch (opcode & 0xff00) {
            case 0x3000:
                this.acc = imm;
                return 1;
            case 0x3400:
                if (this.sp > 0) {
                    this.sp--;
                    nextPc.value = this.stack[this.sp] & 0x03ff;
                }
                this.acc = imm;
                return 2;
            case 0x3800:
                result = this.acc | imm;
                this.acc = result;
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x3900:
                result = this.acc & imm;
                this.acc = result;
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x3a00:
                result = this.acc ^ imm;
                this.acc = result;
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x3c00: {
                const r = this.subWithFlags(imm, this.acc, 0, status);
                status = r.status;
                this.acc = r.result & 0xff;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x3d00: {
                const r = this.subWithFlags(this.acc, imm, 0, status);
                status = r.status;
                this.acc = r.result & 0xff;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x3e00: {
                const r = this.addWithFlags(this.acc, imm, 0, status);
                status = r.status;
                this.acc = r.result & 0xff;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
        }

        switch (opcode & 0xfc00) {
            case 0x1000: {
                let value = this.readRam(f);
                value &= ~(1 << bit);
                this.writeRam(f, value);
                return 1;
            }
            case 0x1400: {
                let value = this.readRam(f);
                value |= 1 << bit;
                this.writeRam(f, value);
                return 1;
            }
            case 0x1800: {
                const value = this.readRam(f);
                if ((value & (1 << bit)) === 0) {
                    nextPc.value = (nextPc.value + 1) & 0x03ff;
                    return 2;
                }
                return 1;
            }
            case 0x1c00: {
                const value = this.readRam(f);
                if ((value & (1 << bit)) !== 0) {
                    nextPc.value = (nextPc.value + 1) & 0x03ff;
                    return 2;
                }
                return 1;
            }
            case 0x2000:
                if (this.sp < VM.STACK_SIZE) {
                    this.stack[this.sp] = nextPc.value & 0x03ff;
                    this.sp++;
                } else {
                    for (let i = 0; i < VM.STACK_SIZE - 1; i++) this.stack[i] = this.stack[i + 1];
                    this.stack[VM.STACK_SIZE - 1] = nextPc.value & 0x03ff;
                }
                nextPc.value = addr10;
                return 2;
            case 0x2800:
                nextPc.value = addr10;
                return 2;
        }

        switch (opcode & 0xff80) {
            case 0x0080:
                this.writeRam(f, this.acc);
                return 1;
            case 0x0180:
                this.writeRam(f, 0);
                status |= VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0200: {
                const r = this.subWithFlags(this.readRam(f), this.acc, 0, status);
                status = r.status;
                this.acc = r.result & 0xff;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x0280: {
                const r = this.subWithFlags(this.readRam(f), this.acc, 0, status);
                status = r.status;
                this.writeRam(f, r.result & 0xff);
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x0300:
                result = (this.readRam(f) - 1) & 0xff;
                this.acc = result;
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0380:
                result = (this.readRam(f) - 1) & 0xff;
                this.writeRam(f, result);
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0400:
                result = this.readRam(f) | this.acc;
                this.acc = result;
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0480:
                result = this.readRam(f) | this.acc;
                this.writeRam(f, result);
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0500:
                result = this.readRam(f) & this.acc;
                this.acc = result;
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0580:
                result = this.readRam(f) & this.acc;
                this.writeRam(f, result);
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0600:
                result = this.readRam(f) ^ this.acc;
                this.acc = result;
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0680:
                result = this.readRam(f) ^ this.acc;
                this.writeRam(f, result);
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0700: {
                const r = this.addWithFlags(this.acc, this.readRam(f), 0, status);
                status = r.status;
                this.acc = r.result & 0xff;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x0780: {
                const r = this.addWithFlags(this.acc, this.readRam(f), 0, status);
                status = r.status;
                this.writeRam(f, r.result & 0xff);
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x0800:
                this.acc = this.readRam(f);
                if (this.acc === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0880: {
                const value = this.readRam(f);
                this.writeRam(f, value);
                if (value === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x0900:
                result = ~this.readRam(f) & 0xff;
                this.acc = result;
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0980:
                result = ~this.readRam(f) & 0xff;
                this.writeRam(f, result);
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0a00:
                result = (this.readRam(f) + 1) & 0xff;
                this.acc = result;
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0a80:
                result = (this.readRam(f) + 1) & 0xff;
                this.writeRam(f, result);
                if (result === 0) status |= VM.STATUS_Z;
                else status &= ~VM.STATUS_Z;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            case 0x0b00:
                result = (this.readRam(f) - 1) & 0xff;
                this.acc = result;
                if (result === 0) {
                    nextPc.value = (nextPc.value + 1) & 0x03ff;
                    return 2;
                }
                return 1;
            case 0x0b80:
                result = (this.readRam(f) - 1) & 0xff;
                this.writeRam(f, result);
                if (result === 0) {
                    nextPc.value = (nextPc.value + 1) & 0x03ff;
                    return 2;
                }
                return 1;
            case 0x0c00: {
                const c = (status & VM.STATUS_C) !== 0 ? 1 : 0;
                const val = this.readRam(f);
                result = ((val >> 1) | (c << 7)) & 0xff;
                this.acc = result;
                if ((val & 0x01) !== 0) status |= VM.STATUS_C;
                else status &= ~VM.STATUS_C;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x0c80: {
                const c = (status & VM.STATUS_C) !== 0 ? 1 : 0;
                const val = this.readRam(f);
                result = ((val >> 1) | (c << 7)) & 0xff;
                this.writeRam(f, result);
                if ((val & 0x01) !== 0) status |= VM.STATUS_C;
                else status &= ~VM.STATUS_C;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x0d00: {
                const c = (status & VM.STATUS_C) !== 0 ? 1 : 0;
                const val = this.readRam(f);
                result = ((val << 1) | c) & 0xff;
                this.acc = result;
                if ((val & 0x80) !== 0) status |= VM.STATUS_C;
                else status &= ~VM.STATUS_C;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x0d80: {
                const c = (status & VM.STATUS_C) !== 0 ? 1 : 0;
                const val = this.readRam(f);
                result = ((val << 1) | c) & 0xff;
                this.writeRam(f, result);
                if ((val & 0x80) !== 0) status |= VM.STATUS_C;
                else status &= ~VM.STATUS_C;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x0e00: {
                const val = this.readRam(f);
                this.acc = ((val >> 4) | (val << 4)) & 0xff;
                return 1;
            }
            case 0x0e80: {
                const val = this.readRam(f);
                result = ((val >> 4) | (val << 4)) & 0xff;
                this.writeRam(f, result);
                return 1;
            }
            case 0x0f00:
                result = (this.readRam(f) + 1) & 0xff;
                this.acc = result;
                if (result === 0) {
                    nextPc.value = (nextPc.value + 1) & 0x03ff;
                    return 2;
                }
                return 1;
            case 0x0f80:
                result = (this.readRam(f) + 1) & 0xff;
                this.writeRam(f, result);
                if (result === 0) {
                    nextPc.value = (nextPc.value + 1) & 0x03ff;
                    return 2;
                }
                return 1;
            case 0x3100: {
                const borrowIn = (status & VM.STATUS_C) !== 0 ? 0 : 1;
                const r = this.subWithFlags(this.readRam(f), this.acc, borrowIn, status);
                status = r.status;
                this.acc = r.result & 0xff;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x3180: {
                const borrowIn = (status & VM.STATUS_C) !== 0 ? 0 : 1;
                const r = this.subWithFlags(this.readRam(f), this.acc, borrowIn, status);
                status = r.status;
                this.writeRam(f, r.result & 0xff);
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x3200: {
                const borrowIn = (status & VM.STATUS_C) !== 0 ? 0 : 1;
                const r = this.subWithFlags(this.acc, this.readRam(f), borrowIn, status);
                status = r.status;
                this.acc = r.result & 0xff;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x3280: {
                const borrowIn = (status & VM.STATUS_C) !== 0 ? 0 : 1;
                const r = this.subWithFlags(this.acc, this.readRam(f), borrowIn, status);
                status = r.status;
                this.writeRam(f, r.result & 0xff);
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x3300: {
                const r = this.subWithFlags(this.acc, this.readRam(f), 0, status);
                status = r.status;
                this.acc = r.result & 0xff;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x3380: {
                const r = this.subWithFlags(this.acc, this.readRam(f), 0, status);
                status = r.status;
                this.writeRam(f, r.result & 0xff);
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x3500: {
                const val = this.readRam(f);
                result = ((val << 1) | (val >> 7)) & 0xff;
                this.acc = result;
                return 1;
            }
            case 0x3580: {
                const val = this.readRam(f);
                result = ((val << 1) | (val >> 7)) & 0xff;
                this.writeRam(f, result);
                return 1;
            }
            case 0x3600: {
                const val = this.readRam(f);
                result = ((val >> 1) | (val << 7)) & 0xff;
                this.acc = result;
                return 1;
            }
            case 0x3680: {
                const val = this.readRam(f);
                result = ((val >> 1) | (val << 7)) & 0xff;
                this.writeRam(f, result);
                return 1;
            }
            case 0x3700: {
                const carryIn = (status & VM.STATUS_C) !== 0 ? 1 : 0;
                const r = this.addWithFlags(this.acc, this.readRam(f), carryIn, status);
                status = r.status;
                this.acc = r.result & 0xff;
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x3780: {
                const carryIn = (status & VM.STATUS_C) !== 0 ? 1 : 0;
                const r = this.addWithFlags(this.acc, this.readRam(f), carryIn, status);
                status = r.status;
                this.writeRam(f, r.result & 0xff);
                this.writeRam(VM.SFR_STATUS, status);
                return 1;
            }
            case 0x3b00: {
                const val = this.readRam(f);
                this.acc = val;
                if (val === 0) {
                    nextPc.value = (nextPc.value + 1) & 0x03ff;
                    return 2;
                }
                return 1;
            }
            case 0x3b80: {
                const val = this.readRam(f);
                if (val === 0) {
                    nextPc.value = (nextPc.value + 1) & 0x03ff;
                    return 2;
                }
                return 1;
            }
            case 0x3f80:
                this.writeRam(f, 0xff);
                return 1;
        }

        return 1;
    }

    /**
     * 加法运算并更新标志位
     */
    private addWithFlags(
        a: number,
        b: number,
        carryIn: number,
        status: number,
    ): { result: number; status: number } {
        const sum = a + b + carryIn;

        if (sum > 0xff) status |= VM.STATUS_C;
        else status &= ~VM.STATUS_C;

        if ((a & 0x0f) + (b & 0x0f) + carryIn > 0x0f) status |= VM.STATUS_DC;
        else status &= ~VM.STATUS_DC;

        if ((sum & 0xff) === 0) status |= VM.STATUS_Z;
        else status &= ~VM.STATUS_Z;

        return { result: sum, status };
    }

    private subWithFlags(
        a: number,
        b: number,
        borrowIn: number,
        status: number,
    ): { result: number; status: number } {
        const diff = a - b - borrowIn;

        if (diff >= 0) status |= VM.STATUS_C;
        else status &= ~VM.STATUS_C;

        if ((a & 0x0f) >= (b & 0x0f) + borrowIn) status |= VM.STATUS_DC;
        else status &= ~VM.STATUS_DC;

        if ((diff & 0xff) === 0) status |= VM.STATUS_Z;
        else status &= ~VM.STATUS_Z;

        return { result: diff, status };
    }

    /**
     * 处理特殊功能寄存器写入
     */
    private handleSfrWrite(address: number, value: number): void {
        // 写入TMR0时清零预分频器，并禁止递增2个周期（手册8.2.1）
        if (address === VM.SFR_TMR0) {
            const option = this.ram[VM.SFR_OPTION_REG];
            if ((option & VM.OPTION_PSA) === 0) {
                this.timer0Prescaler = 0;
            }
            // Disable TMR0 increment for next 2 instruction cycles
            this.timer0WriteDisableCycles = 2;
        }

        // 写入OPTION_REG时更新预分频器分配
        else if (address === VM.SFR_OPTION_REG) {
            // 预分频器切换时清零
            this.timer0Prescaler = 0;
        }

        // 写入TMR2时的保护：TMR2ON=0时不能写TMR2（根据手册第9章说明）
        else if (address === VM.SFR_TMR2) {
            const t2con = this.ram[VM.SFR_T2CON];
            if ((t2con & VM.T2CON_TMR2ON) === 0) {
                return; // Ignore write when TIMER2 is disabled
            }
        }

        // 写入OPTION_REG时更新预分频器分配
        else if (address === VM.SFR_OPTION_REG) {
            // 预分频器切换时清零
            this.timer0Prescaler = 0;
        }

        // 写入T2CON时处理TIMER2使能
        else if (address === VM.SFR_T2CON) {
            if ((value & VM.T2CON_TMR2ON) === 0) {
                this.timer2Prescaler = 0;
                this.timer2Postscaler = 0;
            }
        }

        // 写入OSCCON时更新IRCF分频比（手册3.4）
        // Note: IRCF affects system clock frequency but VM operates in cycle domain
        // Frequency info can be calculated from IRCF value if needed for timing simulation

        // 写入PWM占空比高位寄存器时，将值存入缓存
        else if (address === VM.SFR_PWMD01H) {
            // PWM0和PWM1高2位缓存
            this.pwmDutyCache.pwm0 = (value >> 0) & 0x03;
            this.pwmDutyCache.pwm1 = (value >> 4) & 0x03;
        } else if (address === VM.SFR_PWMD23H) {
            // PWM2和PWM3高2位缓存
            this.pwmDutyCache.pwm2 = (value >> 0) & 0x03;
            this.pwmDutyCache.pwm3 = (value >> 4) & 0x03;
        } else if (address === VM.SFR_PWMTH) {
            // PWM4高2位缓存和周期高2位
            this.pwmDutyCache.pwm4 = (value >> 4) & 0x03;
        }
        // 写入PWM占空比低位寄存器时，将缓存的高2位锁存到实际值
        else if (address === VM.SFR_PWMD0L) {
            this.pwmDutyActual.pwm0 = (this.pwmDutyCache.pwm0 << 8) | value;
        } else if (address === VM.SFR_PWMD1L) {
            this.pwmDutyActual.pwm1 = (this.pwmDutyCache.pwm1 << 8) | value;
        } else if (address === VM.SFR_PWMD2L) {
            this.pwmDutyActual.pwm2 = (this.pwmDutyCache.pwm2 << 8) | value;
        } else if (address === VM.SFR_PWMD3L) {
            this.pwmDutyActual.pwm3 = (this.pwmDutyCache.pwm3 << 8) | value;
        } else if (address === VM.SFR_PWMD4L) {
            this.pwmDutyActual.pwm4 = (this.pwmDutyCache.pwm4 << 8) | value;
        }
        // 比较器控制寄存器写入
        else if (address === VM.SFR_CMPCON0 || address === VM.SFR_CMPCON1) {
            // 重新计算比较器输出
            this.updateComparator();
        }
    }

    /**
     * 更新外设状态
     */
    private updatePeripherals(cycles: number): void {
        // Update LSE stabilization timer
        if (this.lseEnabled && !this.lseStabilized) {
            this.lseStabilizationCycles += cycles;
            // LSE stabilization time: ~500ms typical at 5V (manual Section 12.6)
            // Calculate required cycles for 500ms based on FCPU
            const fcpu = this.getFCPU();
            const stabilizationCyclesNeeded = Math.floor(0.5 * fcpu); // 500ms
            if (this.lseStabilizationCycles >= stabilizationCyclesNeeded) {
                this.lseStabilized = true;
            }
        }

        // Update comparator digital filter delay
        if (this.compFilterDelayNs > 0) {
            const fcpu = this.getFCPU();
            const elapsedNs = (cycles / fcpu) * 1_000_000_000;
            this.compFilterDelayNs -= elapsedNs;
            if (this.compFilterDelayNs <= 0) {
                // Delay complete, apply pending comparator output
                this.compFilterDelayNs = 0;
                this.applyComparatorOutput(this.compPendingOutput);
            }
        }

        // 更新WDT（根据手册867-872行）
        // CONFIG.WDT=1: WDT始终使能，与SWDTEN无关
        // CONFIG.WDT=0: 通过SWDTEN控制WDT
        if (this.config.wdt || this.ram[VM.SFR_OSCCON] & 0x02) {
            this.updateWDT(cycles);
        }

        // 更新TIMER0
        this.updateTimer0(cycles);

        // 更新TIMER2
        this.updateTimer2(cycles);

        // 更新PWM模块
        this.updatePWM(cycles);

        // 更新I/O端口
        this.updateIO();
    }

    /**
     * 更新看门狗定时器
     * Note: WDT uses independent RC oscillator, not system clock (manual Section 2.8)
     * Base period is ~16ms, timeout = 16ms × prescaler ratio
     */
    private updateWDT(cycles: number): void {
        const option = this.ram[VM.SFR_OPTION_REG];
        const psa = (option & VM.OPTION_PSA) !== 0;

        // Calculate elapsed time based on instruction cycles
        // Even though WDT has its own oscillator, we simulate it proportionally to instruction execution
        const fcpu = this.getFCPU();
        const elapsedNs = (cycles / fcpu) * 1_000_000_000; // Convert to nanoseconds

        this.wdtElapsedTimeNs += elapsedNs;

        if (psa) {
            // 预分频器分配给WDT
            const ps = option & 0x07;
            const divider = [1, 2, 4, 8, 16, 32, 64, 128][ps];

            // WDT base period is 16ms (manual Section 2.8.1)
            const basePeriodNs = 16_000_000; // 16ms in nanoseconds
            const timeoutNs = basePeriodNs * divider;

            if (this.wdtElapsedTimeNs >= timeoutNs) {
                this.wdtElapsedTimeNs -= timeoutNs;
                // WDT overflow - trigger reset
                this.wdtReset();
            }
        } else {
            // 预分频器分配给TIMER0，WDT使用1:1分频
            const basePeriodNs = 16_000_000; // 16ms

            if (this.wdtElapsedTimeNs >= basePeriodNs) {
                this.wdtElapsedTimeNs -= basePeriodNs;
                // WDT overflow - trigger reset
                this.wdtReset();
            }
        }
    }

    /**
     * 更新TIMER0
     */
    private updateTimer0(cycles: number): void {
        const option = this.ram[VM.SFR_OPTION_REG];
        const t0cs = (option & VM.OPTION_T0CS) !== 0;

        if (!t0cs) {
            // 使用内部指令时钟
            const psa = (option & VM.OPTION_PSA) !== 0;

            // Decrement write-disable counter (手册8.2.1: 2 cycle disable after write)
            if (this.timer0WriteDisableCycles > 0) {
                this.timer0WriteDisableCycles -= cycles;
                if (this.timer0WriteDisableCycles < 0) {
                    this.timer0WriteDisableCycles = 0;
                }
                return; // Don't increment TMR0 during disable period
            }

            if (!psa) {
                // 预分频器分配给TIMER0
                const ps = option & 0x07;
                const divider = [2, 4, 8, 16, 32, 64, 128, 256][ps];

                this.timer0Prescaler += cycles;
                if (this.timer0Prescaler >= divider) {
                    this.timer0Prescaler -= divider;
                    this.incrementTimer0();
                }
            } else {
                // 预分频器分配给WDT，TIMER0使用1:1分频
                for (let i = 0; i < cycles; i++) {
                    this.incrementTimer0();
                }
            }
        } else {
            // External clock mode (T0CKI) - simulate based on configured frequency
            if (this.t0ckiFrequency === 0) {
                return; // No external clock configured
            }

            // Calculate how many T0CKI edges occurred during these instruction cycles
            const fcpu = this.getFCPU();
            const instructionTimeS = cycles / fcpu; // seconds
            const t0ckiEdges = Math.floor(instructionTimeS * this.t0ckiFrequency);

            if (t0ckiEdges > 0) {
                // Increment TIMER0 for each edge
                for (let i = 0; i < t0ckiEdges; i++) {
                    this.incrementTimer0();
                }
            }
        }
    }

    /**
     * TIMER0加1
     */
    private incrementTimer0(): void {
        const tmr0 = this.ram[VM.SFR_TMR0];
        const newTmr0 = (tmr0 + 1) & 0xff;
        this.ram[VM.SFR_TMR0] = newTmr0;
        if (newTmr0 === 0) {
            // TIMER0溢出，设置中断标志
            let intcon = this.ram[VM.SFR_INTCON];
            intcon |= VM.INTCON_T0IF;
            this.ram[VM.SFR_INTCON] = intcon;
        }
    }

    /**
     * 更新TIMER2 (根据手册第9章)
     * TIMER2有预分频器(1:1, 1:4, 1:16)和后分频器(1:1-1:16)
     */
    private updateTimer2(cycles: number): void {
        const t2con = this.ram[VM.SFR_T2CON];
        const tmr2on = (t2con & VM.T2CON_TMR2ON) !== 0;

        if (!tmr2on) return;

        const clkSel = (t2con & VM.T2CON_CLK_SEL) !== 0;

        // TIMER2时钟源：FSYS/4 或 FLSE/4（外部32.768kHz）
        let effectiveCycles = cycles;
        if (clkSel) {
            // Using LSE clock (32.768kHz / 4 = 8.192kHz)
            if (!this.lseEnabled) {
                return; // LSE not enabled
            }

            // Check LSE stabilization (manual Section 12.6)
            if (!this.lseStabilized) {
                return; // LSE not yet stabilized, TIMER2 cannot operate
            }

            // Calculate how many LSE ticks occurred during these instruction cycles
            const fcpu = this.getFCPU();
            const flseDiv4 = VM.FLSE / 4; // 8.192kHz
            const instructionTimeS = cycles / fcpu; // seconds
            const lseTicks = Math.floor(instructionTimeS * flseDiv4);

            if (lseTicks === 0) {
                return; // Not enough time has passed for an LSE tick
            }

            effectiveCycles = lseTicks;
        } else {
            // Using FSYS/4 clock (manual Section 9.2)
            // FSYS/4 frequency
            const fsysDiv4 = this.getFSYS() / 4;
            const fcpu = this.getFCPU();

            // Calculate TIMER2 ticks based on FSYS/4 vs FCPU ratio
            // Each instruction cycle = (FSYS/4) / FCPU TIMER2 ticks
            const timer2TicksPerInstructionCycle = fsysDiv4 / fcpu;
            effectiveCycles = Math.floor(cycles * timer2TicksPerInstructionCycle);
        }

        // 获取预分频比
        const t2ckps = t2con & 0x03;
        let prescalerRatio = 1;
        if (t2ckps === 1) prescalerRatio = 4;
        else if (t2ckps >= 2) prescalerRatio = 16;

        // 更新预分频器
        this.timer2Prescaler += effectiveCycles;
        if (this.timer2Prescaler < prescalerRatio) {
            return; // 预分频器未达到计数值
        }
        this.timer2Prescaler -= prescalerRatio;

        // TMR2递增
        const pr2 = this.ram[VM.SFR_PR2];
        const tmr2 = this.ram[VM.SFR_TMR2];
        const newTmr2 = (tmr2 + 1) & 0xff;
        this.ram[VM.SFR_TMR2] = newTmr2;

        if (newTmr2 === pr2) {
            // TMR2与PR2匹配
            this.ram[VM.SFR_TMR2] = 0;

            // 更新后分频器 (TOUTPS[3:0])
            const toutps = (t2con >> 3) & 0x0f;
            const postDivider = toutps + 1; // 1:1 to 1:16

            this.timer2Postscaler++;
            if (this.timer2Postscaler >= postDivider) {
                this.timer2Postscaler = 0;

                // 设置TIMER2中断标志
                let pir1 = this.ram[VM.SFR_PIR1];
                pir1 |= VM.PIR1_TMR2IF;
                this.ram[VM.SFR_PIR1] = pir1;
            }
        }
    }

    /**
     * 更新PWM模块 (根据手册第10章)
     */
    private updatePWM(cycles: number): void {
        const pwmcon0 = this.ram[VM.SFR_PWMCON0];
        const pwmcon1 = this.ram[VM.SFR_PWMCON1];

        // 检查是否有任何PWM使能
        const anyPwmEnabled = (pwmcon0 & 0x1f) !== 0;
        if (!anyPwmEnabled) return;

        // 检查死区使能
        const pwm0DTEn = (pwmcon1 & VM.PWMCON1_PWM0DTEN) !== 0;
        const pwm2DTEn = (pwmcon1 & VM.PWMCON1_PWM2DTEN) !== 0;

        // 获取死区时钟分频
        const dtDiv = pwmcon1 & 0x03;
        const dtDivRatio = [1, 2, 4, 8][dtDiv];

        // 读取死区时间值
        const pwm01DT = this.ram[VM.SFR_PWM01DT] & 0x3f; // 6-bit value
        const pwm23DT = this.ram[VM.SFR_PWM23DT] & 0x3f; // 6-bit value

        // 更新PWM周期计数器（按分频比递增）
        for (let i = 0; i < cycles; i++) {
            // 读取PWM周期值 (PWMT[9:0])
            const pwmtl = this.ram[VM.SFR_PWMTL];
            const pwmth = this.ram[VM.SFR_PWMTH];
            const pwmt = ((pwmth & 0x03) << 8) | pwmtl; // PWMT[9:0] for PWM0-3

            // PWM4独立周期
            const pwmt4l = this.ram[VM.SFR_PWMT4L];
            const pwm4t = (((pwmth >> 2) & 0x03) << 8) | pwmt4l;

            // Check if counter equals PWMT (period match)
            // Per manual Section 10.4: "When PWM period counter equals PWMT, in the next increment cycle:"

            // Increment counter first
            this.pwmPeriodCounter++;

            // Period end events occur when counter matches PWMT (on next cycle after match)
            // Reset counter when it reaches PWMT+1 (i.e., after matching PWMT)
            const period0123 = pwmt + 1;
            const period4 = pwm4t + 1;

            if (this.pwmPeriodCounter >= period0123) {
                this.pwmPeriodCounter = 0;

                // Set PWM interrupt flag (PWM4 has no interrupt per manual Section 10.4)
                let pir1 = this.ram[VM.SFR_PIR1];
                pir1 |= VM.PIR1_PWMIF;
                this.ram[VM.SFR_PIR1] = pir1;
            }

            // 处理每个PWM通道
            for (let ch = 0; ch < 5; ch++) {
                const enabled = (pwmcon0 >> ch) & 0x01;
                if (!enabled) {
                    this.pwmOutputs[ch] = false;
                    continue;
                }

                const period = ch === 4 ? period4 : period0123;
                const duty = this.pwmDutyActual[`pwm${ch}` as keyof typeof this.pwmDutyActual];

                // PWM输出逻辑：计数器 <= duty时输出高电平（根据手册公式：脉冲宽度 = (PWMDx[9:0]+1)*THSI*(CLKDIV分频值)）
                const currentCount = this.pwmPeriodCounter % period;
                let pwmHigh = duty > 0 && currentCount <= duty; // Changed from < to <= per manual formula

                // 应用极性反转
                const pwmcon2 = this.ram[VM.SFR_PWMCON2];
                if ((pwmcon2 >> ch) & 0x01) {
                    pwmHigh = !pwmHigh;
                }

                this.pwmOutputs[ch] = pwmHigh;
            }

            // 应用死区控制 (Dead-time insertion)
            // PWM0/PWM1 互补输出对
            if (pwm0DTEn) {
                this.applyDeadTime(0, 1, pwm01DT, dtDivRatio);
            }

            // PWM2/PWM3 互补输出对
            if (pwm2DTEn) {
                this.applyDeadTime(2, 3, pwm23DT, dtDivRatio);
            }
        }
    }

    /**
     * 应用死区延时到互补PWM输出对
     * 根据手册10.7节：当使能互补输出模式后，自动使能死区延时功能
     * 死区时间计算公式：td = (PWMxxDT[5:0] + 1) * THSI * (DT_DIV分频值)
     *
     * @param ch1 第一个通道 (e.g., PWM0 or PWM2) - 主通道
     * @param ch2 第二个通道 (e.g., PWM1 or PWM3) - 互补通道
     * @param deadTimeValue 死区时间值 (6-bit)
     * @param dtDivRatio 死区时钟分频比
     */
    private applyDeadTime(
        ch1: number,
        ch2: number,
        deadTimeValue: number,
        dtDivRatio: number,
    ): void {
        const deadTimeCycles = (deadTimeValue + 1) * dtDivRatio;
        const pairIndex = ch1 === 0 ? 'pwm01' : 'pwm23';

        // 获取主通道的原始PWM信号状态
        const rawCh1 = this.pwmOutputs[ch1];

        // 死区计数器递减
        if (this.pwmDeadTimeCounters[pairIndex] > 0) {
            this.pwmDeadTimeCounters[pairIndex]--;
        }

        // 检测主通道边沿变化
        const prevCh1 = this.pwmLastState[pairIndex];
        const risingEdge = !prevCh1 && rawCh1; // 上升沿
        const fallingEdge = prevCh1 && !rawCh1; // 下降沿

        // 保存当前状态供下次比较
        this.pwmLastState[pairIndex] = rawCh1;

        // 根据手册图10-1的死区行为：
        // 1. 当主通道从低变高时：立即拉高主通道，但延迟拉低互补通道（插入死区）
        // 2. 当主通道从高变低时：立即拉低主通道，但延迟拉高互补通道（插入死区）

        if (risingEdge) {
            // 主通道上升沿：主通道立即变高，互补通道保持低电平直到死区结束
            this.pwmOutputs[ch1] = true; // 主通道立即变高
            this.pwmOutputs[ch2] = false; // 互补通道保持低
            this.pwmDeadTimeCounters[pairIndex] = deadTimeCycles; // 启动死区计时
        } else if (fallingEdge) {
            // 主通道下降沿：主通道立即变低，互补通道保持低电平直到死区结束
            this.pwmOutputs[ch1] = false; // 主通道立即变低
            this.pwmOutputs[ch2] = false; // 互补通道保持低
            this.pwmDeadTimeCounters[pairIndex] = deadTimeCycles; // 启动死区计时
        } else if (this.pwmDeadTimeCounters[pairIndex] > 0) {
            // 在死区期间，互补通道保持低电平
            this.pwmOutputs[ch2] = false;
            // 主通道保持其当前状态
        } else {
            // 不在死区期间，互补通道是主通道的反相
            this.pwmOutputs[ch2] = !rawCh1;
        }
    }

    /**
     * 获取指定引脚对应的PWM通道
     * @param port 端口('A'或'B')
     * @param pin 引脚号
     * @returns PWM通道号(0-4)，如果不是PWM引脚或未使能则返回null
     */
    private getPwmChannel(port: 'A' | 'B', pin: number): number | null {
        const pwmcon0 = this.ram[VM.SFR_PWMCON0];
        const pwmcon1 = this.ram[VM.SFR_PWMCON1];

        // 检查是否有任何PWM使能
        if ((pwmcon0 & 0x1f) === 0) return null;

        const ioSel = (pwmcon1 >> 6) & 0x01;
        let pwmChannel: number | null = null;

        // 根据PWM_IOSEL和引脚映射确定PWM通道
        if (port === 'A') {
            if (ioSel === 0) {
                // RA2->PWM2, RA3->PWM3
                if (pin === 2) pwmChannel = 2;
                else if (pin === 3) pwmChannel = 3;
            } else {
                // RA5->PWM0
                if (pin === 5) pwmChannel = 0;
            }
        } else {
            if (ioSel === 0) {
                // RB0->PWM0, RB1->PWM1, RB2->PWM4
                if (pin === 0) pwmChannel = 0;
                else if (pin === 1) pwmChannel = 1;
                else if (pin === 2) pwmChannel = 4;
            } else {
                // RB4->PWM4, RB5->PWM3, RB6->PWM2, RB7->PWM1
                if (pin === 4) pwmChannel = 4;
                else if (pin === 5) pwmChannel = 3;
                else if (pin === 6) pwmChannel = 2;
                else if (pin === 7) pwmChannel = 1;
            }
        }

        if (pwmChannel === null) return null;

        // 检查该PWM通道是否使能
        if (!((pwmcon0 >> pwmChannel) & 0x01)) return null;

        return pwmChannel;
    }

    /**
     * 计算单个引脚的实际电平状态（不含PWM检查）
     * 根据手册第6章：综合考虑TRIS、ODCON、上下拉、外部驱动等因素
     *
     * @param port 端口('A'或'B')
     * @param pin 引脚号
     * @param latchValue RAM中PORT寄存器的锁存器值
     * @returns 引脚实际电平(0或1)
     */
    private getPinState(port: 'A' | 'B', pin: number, latchValue: number): number {
        if (port === 'A') {
            if (pin < 0 || pin > 5) return 0;

            const trisa = this.ram[VM.SFR_TRISA] & 0x3f;
            const wpua = this.ram[VM.SFR_WPUA] & 0x3f;
            const wpda = this.ram[VM.SFR_WPDA] & 0x3f;
            const odcona = this.ram[VM.SFR_ODCONA] & 0x3f;

            const isInput = (trisa & (1 << pin)) !== 0;
            const latchHigh = (latchValue & (1 << pin)) !== 0;
            const isOpenDrain = (odcona & (1 << pin)) !== 0;
            const hasPullUp = (wpua & (1 << pin)) !== 0;
            const hasPullDown = (wpda & (1 << pin)) !== 0;
            const externalHigh = (this.externalPinStateA & (1 << pin)) !== 0;
            const isExternallyDriven = (this.externallyDrivenA & (1 << pin)) !== 0;

            if (isInput) {
                // 输入模式：考虑上下拉和外部驱动
                if (!hasPullUp && !hasPullDown) {
                    // 无上下拉：仅当外部显式驱动为高时才为高
                    return isExternallyDriven && externalHigh ? 1 : 0;
                } else if (hasPullUp && !hasPullDown) {
                    // 有上拉：默认高，外部可拉低
                    if (isExternallyDriven) {
                        return externalHigh ? 1 : 0;
                    } else {
                        return 1; // 浮空时上拉生效
                    }
                } else if (hasPullDown && !hasPullUp) {
                    // 有下拉：默认低，外部可拉高
                    if (isExternallyDriven) {
                        return externalHigh ? 1 : 0;
                    } else {
                        return 0; // 浮空时下拉生效
                    }
                } else {
                    // 同时使能上下拉：冲突状态，跟随外部
                    return externalHigh ? 1 : 0;
                }
            } else {
                // 输出模式（手册6.2.3, 6.2.4：上下拉自动切断）
                if (isOpenDrain) {
                    // 开漏输出（手册6.2.2）
                    if (latchHigh) {
                        // 开漏高 = 高阻态，内部上下拉已切断，跟随外部
                        return externalHigh ? 1 : 0;
                    } else {
                        // 开漏低 = 主动拉低
                        return 0;
                    }
                } else {
                    // 推挽输出：直接输出锁存值
                    return latchHigh ? 1 : 0;
                }
            }
        } else {
            // PORTB
            if (pin < 0 || pin > 7) return 0;

            const trisb = this.ram[VM.SFR_TRISB];
            const wpub = this.ram[VM.SFR_WPUB];
            const wpdb = this.ram[VM.SFR_WPDB];
            const odconb = this.ram[VM.SFR_ODCONB];

            const isInput = (trisb & (1 << pin)) !== 0;
            const latchHigh = (latchValue & (1 << pin)) !== 0;
            // RB3固定开漏（手册6.3.2）
            const isOpenDrain = pin === 3 || (odconb & (1 << pin)) !== 0;
            // RB3无上拉禁用特性，其他引脚输出时上拉禁用（手册6.3.3注）
            const hasPullUp = (wpub & (1 << pin)) !== 0;
            // RB3无下拉（手册6.3.4注）
            const hasPullDown = pin !== 3 && (wpdb & (1 << pin)) !== 0;
            const externalHigh = (this.externalPinStateB & (1 << pin)) !== 0;
            const isExternallyDriven = (this.externallyDrivenB & (1 << pin)) !== 0;

            if (isInput) {
                // 输入模式：与PORTA相同逻辑
                if (!hasPullUp && !hasPullDown) {
                    return isExternallyDriven && externalHigh ? 1 : 0;
                } else if (hasPullUp && !hasPullDown) {
                    if (isExternallyDriven) {
                        return externalHigh ? 1 : 0;
                    } else {
                        return 1;
                    }
                } else if (hasPullDown && !hasPullUp) {
                    if (isExternallyDriven) {
                        return externalHigh ? 1 : 0;
                    } else {
                        return 0;
                    }
                } else {
                    return externalHigh ? 1 : 0;
                }
            } else {
                // 输出模式
                if (isOpenDrain) {
                    if (latchHigh) {
                        // 开漏高 = 高阻态
                        if (pin === 3 && hasPullUp) {
                            // RB3特殊：输出模式下上拉仍有效（手册6.3.3注）
                            return externalHigh ? 1 : 1; // RB3有上拉时总是高（除非外部强拉低）
                        } else {
                            // 其他引脚：上拉已禁用，跟随外部
                            return externalHigh ? 1 : 0;
                        }
                    } else {
                        // 开漏低 = 主动拉低
                        return 0;
                    }
                } else {
                    // 推挽输出（RB3不可能到这里）
                    return latchHigh ? 1 : 0;
                }
            }
        }
    }

    /**
     * 更新比较器 (根据手册第11章)
     */
    private updateComparator(): void {
        const cmpcon0 = this.ram[VM.SFR_CMPCON0];
        const cmpcon1 = this.ram[VM.SFR_CMPCON1];

        const cmpEn = (cmpcon0 >> 7) & 0x01;
        if (!cmpEn) {
            return;
        }

        // 检查AN_EN位：模拟口使能
        const anEn = (cmpcon1 >> 6) & 0x01;

        // 获取正端输入
        const cmpps = (cmpcon0 >> 6) & 0x01;
        let posVoltage = 0;

        if (cmpps === 1) {
            // CMP+端口 (RB1)
            // 如果AN_EN=1，使用注入的模拟值；否则读数字值
            if (anEn) {
                posVoltage = this.compAnalogInputs.cmpPlus; // Use injected analog value
            } else {
                const portb = this.ram[VM.SFR_PORTB];
                posVoltage = (portb >> 1) & 0x01 ? 1.0 : 0.0; // Digital read: 0 or 1
            }
        } else {
            // 内部电阻分压VR
            posVoltage = this.calculateResistorDivider(cmpcon1);
        }

        // 获取负端输入
        const cmpns = cmpcon0 & 0x07;
        let negVoltage = 0;

        switch (cmpns) {
            case 0: // CMP0- (RB2)
                if (anEn) {
                    negVoltage = this.compAnalogInputs.cmp0Minus; // Use injected analog value
                } else {
                    const portb0 = this.ram[VM.SFR_PORTB];
                    negVoltage = (portb0 >> 2) & 0x01 ? 1.0 : 0.0; // Digital read
                }
                break;
            case 1: // CMP1- (RB4)
                if (anEn) {
                    negVoltage = this.compAnalogInputs.cmp1Minus; // Use injected analog value
                } else {
                    const portb1 = this.ram[VM.SFR_PORTB];
                    negVoltage = (portb1 >> 4) & 0x01 ? 1.0 : 0.0; // Digital read
                }
                break;
            case 2: // CMP2- (RB5)
                if (anEn) {
                    negVoltage = this.compAnalogInputs.cmp2Minus; // Use injected analog value
                } else {
                    const portb2 = this.ram[VM.SFR_PORTB];
                    negVoltage = (portb2 >> 5) & 0x01 ? 1.0 : 0.0; // Digital read
                }
                break;
            case 3: // CMP3- (RB1)
                if (anEn) {
                    negVoltage = this.compAnalogInputs.cmp3Minus; // Use injected analog value
                } else {
                    const portb3 = this.ram[VM.SFR_PORTB];
                    negVoltage = (portb3 >> 1) & 0x01 ? 1.0 : 0.0; // Digital read
                }
                break;
            case 4: // 内部电阻分压VR
                negVoltage = this.calculateResistorDivider(cmpcon1);
                break;
            default:
                negVoltage = 1.2 / this.vdd; // Default to BG
                break;
        }

        // 比较结果（带数字滤波延迟）
        const newOutput = posVoltage > negVoltage;

        // Manual Section 11.2: Digital filter delay 4-6μs (use 5μs typical)
        // Start delay timer instead of immediate update
        this.compPendingOutput = newOutput;
        this.compFilterDelayNs = 5000; // 5μs in nanoseconds

        // Note: CMPOUT bit and interrupt will be updated after delay by applyComparatorOutput()
    }

    /**
     * Apply comparator output after digital filter delay
     * @param output Comparator output value
     */
    private applyComparatorOutput(output: boolean): void {
        // Update CMPOUT bit
        let cmpcon0New = this.ram[VM.SFR_CMPCON0];
        if (output) {
            cmpcon0New |= 0x02; // Bit1 CMPOUT
        } else {
            cmpcon0New &= ~0x02;
        }
        this.ram[VM.SFR_CMPCON0] = cmpcon0New;

        // Check edge-triggered interrupt
        const cmpcon1 = this.ram[VM.SFR_CMPCON1];
        const cmpim = (cmpcon1 >> 7) & 0x01; // 1=falling edge, 0=rising edge
        let interruptTriggered = false;

        if (cmpim === 0 && !this.compLastOutput && output) {
            // Rising edge trigger
            interruptTriggered = true;
        } else if (cmpim === 1 && this.compLastOutput && !output) {
            // Falling edge trigger
            interruptTriggered = true;
        }

        this.compLastOutput = output;

        if (interruptTriggered) {
            let pir1 = this.ram[VM.SFR_PIR1];
            pir1 |= VM.PIR1_CMPIF;
            this.ram[VM.SFR_PIR1] = pir1;
        }

        // If CMPOEN enabled, output to RB0/CMPO pin
        const cmpoen = cmpcon0New & 0x01;
        const cmpnv = (cmpcon0New >> 2) & 0x01; // Output invert

        if (cmpoen) {
            const outputValue = cmpnv ? !output : output;

            // 内联 setPinOutput 逻辑：检查 TRIS 和 ODCON
            const trisb = this.ram[VM.SFR_TRISB];
            if (!((trisb >> 0) & 0x01)) {
                // RB0 配置为输出模式
                let portb = this.ram[VM.SFR_PORTB];
                if (outputValue) {
                    // RB0 不是 RB3，需要检查 ODCON
                    const odconb = this.ram[VM.SFR_ODCONB];
                    if (!((odconb >> 0) & 0x01)) {
                        // 推挽模式，设置高电平
                        portb |= 0x01;
                    }
                    // 如果是开漏模式，高电平时不修改 RAM（高阻态）
                } else {
                    // 低电平，主动拉低
                    portb &= ~0x01;
                }
                this.ram[VM.SFR_PORTB] = portb;
            }
        }
    }

    /**
     * 计算内部电阻分压值
     */
    private calculateResistorDivider(cmpcon1: number): number {
        const rbiasH = (cmpcon1 >> 5) & 0x01;
        const rbiasL = (cmpcon1 >> 4) & 0x01;
        const lvds = cmpcon1 & 0x0f;

        // 归一化电压值（相对于VDD）
        let vr = 0;

        if (rbiasH === 0 && rbiasL === 0) {
            vr = 0.25 + (lvds + 1) / 32;
        } else if (rbiasH === 0 && rbiasL === 1) {
            vr = (lvds + 1) / 24;
        } else if (rbiasH === 1 && rbiasL === 0) {
            vr = 0.2 + (lvds + 1) / 40;
        } else {
            vr = (lvds + 1) / 32;
        }

        return vr;
    }

    /**
     * 更新I/O端口（通知外部系统引脚状态变化）
     * 注意：此方法在每条指令执行后调用，一次性返回所有端口状态
     */
    private updateIO(): void {
        if (!this.ioCallback) return;

        // 计算PORTA所有引脚的状态
        let portAValue = 0;
        for (let i = 0; i < 6; i++) {
            const pwmChannel = this.getPwmChannel('A', i);
            let actualValue: boolean;

            if (pwmChannel !== null) {
                // PWM控制的引脚，返回PWM电平
                actualValue = this.pwmOutputs[pwmChannel];
            } else {
                // 非PWM引脚，使用统一计算方法
                actualValue = this.getPinState('A', i, this.ram[VM.SFR_PORTA]) !== 0;
            }

            if (actualValue) {
                portAValue |= 1 << i;
            }
        }

        // 计算PORTB所有引脚的状态
        let portBValue = 0;
        for (let i = 0; i < 8; i++) {
            const pwmChannel = this.getPwmChannel('B', i);
            let actualValue: boolean;

            if (pwmChannel !== null) {
                // PWM控制的引脚，返回PWM电平
                actualValue = this.pwmOutputs[pwmChannel];
            } else {
                // 非PWM引脚，使用统一计算方法
                actualValue = this.getPinState('B', i, this.ram[VM.SFR_PORTB]) !== 0;
            }

            if (actualValue) {
                portBValue |= 1 << i;
            }
        }

        // 一次性通知所有端口状态
        this.ioCallback({ A: portAValue, B: portBValue });
    }

    /**
     * 运行休眠模式下的外设
     */
    private runSleepPeripherals(): void {
        // 休眠模式下WDT继续运行（根据手册867-872行）
        // CONFIG.WDT=1: WDT始终使能，与SWDTEN无关
        // CONFIG.WDT=0: 通过SWDTEN控制WDT
        if (this.config.wdt || this.ram[VM.SFR_OSCCON] & 0x02) {
            this.updateWDT(1);
        }

        // TIMER2如果使用外部32.768kHz时钟则继续运行
        const t2con = this.ram[VM.SFR_T2CON];
        const tmr2on = (t2con & VM.T2CON_TMR2ON) !== 0;
        const clkSel = (t2con & VM.T2CON_CLK_SEL) !== 0;

        if (tmr2on && clkSel) {
            // 使用外部时钟，这里简化处理
        }

        // 检查唤醒条件
        this.checkWakeup();
    }

    /**
     * 检查唤醒条件
     */
    private checkWakeup(): void {
        const intcon = this.ram[VM.SFR_INTCON];
        const pir1 = this.ram[VM.SFR_PIR1];

        // 检查WDT唤醒（根据手册867-872行）
        if (this.config.wdt || this.ram[VM.SFR_OSCCON] & 0x02) {
            // WDT溢出会自动唤醒
        }

        // 检查电平变化中断
        if (intcon & VM.INTCON_RBIE && intcon & VM.INTCON_RBIF) {
            this.wakeup();
        }

        if (pir1 & VM.PIR1_RAIF && this.ram[VM.SFR_PIE1] & VM.PIE1_RAIE) {
            this.wakeup();
        }

        // 检查比较器中断
        if (pir1 & VM.PIR1_CMPIF && this.ram[VM.SFR_PIE1] & VM.PIE1_CMPIE) {
            this.wakeup();
        }
    }

    /**
     * 从休眠模式唤醒
     */
    private wakeup(): void {
        this.sleeping = false;

        // 更新STATUS寄存器
        let status = this.ram[VM.SFR_STATUS];
        status |= VM.STATUS_PD;
        this.ram[VM.SFR_STATUS] = status;

        // 清零WDT
        this.wdtElapsedTimeNs = 0;
    }

    /**
     * WDT复位
     */
    private wdtReset(): void {
        if (this.sleeping) {
            // 休眠模式下WDT溢出唤醒
            this.wakeup();
            // Set TO=0, PD=0 for WDT wakeup from sleep
            let status = this.ram[VM.SFR_STATUS];
            status &= ~(VM.STATUS_TO | VM.STATUS_PD);
            this.ram[VM.SFR_STATUS] = status;
        } else {
            // 正常模式下WDT溢出复位
            this.reset(ResetSource.WDT);
        }
    }

    /**
     * 检查中断
     */
    private checkInterrupts(): void {
        const intcon = this.ram[VM.SFR_INTCON];
        const gie = (intcon & VM.INTCON_GIE) !== 0;

        if (!gie) return;

        const peie = (intcon & VM.INTCON_PEIE) !== 0;
        const pie1 = this.ram[VM.SFR_PIE1];
        const pir1 = this.ram[VM.SFR_PIR1];

        // 检查TIMER0中断
        if (intcon & VM.INTCON_T0IE && intcon & VM.INTCON_T0IF) {
            this.triggerInterrupt();
            return;
        }

        // 检查外部中断
        if (intcon & VM.INTCON_INTE && intcon & VM.INTCON_INTF) {
            this.triggerInterrupt();
            return;
        }

        // 检查PORTB电平变化中断
        if (intcon & VM.INTCON_RBIE && intcon & VM.INTCON_RBIF) {
            this.triggerInterrupt();
            return;
        }

        if (peie) {
            // 检查比较器中断
            if (pie1 & VM.PIE1_CMPIE && pir1 & VM.PIR1_CMPIF) {
                this.triggerInterrupt();
                return;
            }

            // 检查PWM中断
            if (pie1 & VM.PIE1_PWMIE && pir1 & VM.PIR1_PWMIF) {
                this.triggerInterrupt();
                return;
            }

            // 检查PORTA电平变化中断
            if (pie1 & VM.PIE1_RAIE && pir1 & VM.PIR1_RAIF) {
                this.triggerInterrupt();
                return;
            }

            // 检查TIMER2中断
            if (pie1 & VM.PIE1_TMR2IE && pir1 & VM.PIR1_TMR2IF) {
                this.triggerInterrupt();
                return;
            }
        }
    }

    /**
     * 触发中断
     */
    private triggerInterrupt(): void {
        // 禁止全局中断
        let intcon = this.ram[VM.SFR_INTCON];
        intcon &= ~VM.INTCON_GIE;
        this.ram[VM.SFR_INTCON] = intcon;

        // 保存当前PC到堆栈
        if (this.sp < VM.STACK_SIZE) {
            this.stack[this.sp] = this.pc & 0x03ff;
            this.sp++;
        } else {
            // 堆栈溢出，覆盖最早的条目
            for (let i = 0; i < VM.STACK_SIZE - 1; i++) {
                this.stack[i] = this.stack[i + 1];
            }
            this.stack[VM.STACK_SIZE - 1] = this.pc & 0x03ff;
        }

        // 跳转到中断向量
        this.pc = 0x0004;
    }

    /**
     * 设置供电电压（用于LVR测试）
     */
    setVDD(voltage: number): void {
        this.vdd = voltage;
        this.checkLVR();
    }

    /**
     * 设置I/O引脚输入值（模拟外部物理连接）
     * @param port 端口('A'或'B')
     * @param pin 引脚号
     * @param value 输入电平值（true=高电平，false=低电平）
     */
    setPinInput(port: 'A' | 'B', pin: number, value: boolean): void {
        if (port === 'A') {
            if (pin < 0 || pin > 5) return;

            // Update external pin state (simulates physical connection to the pin)
            if (value) {
                this.externalPinStateA |= 1 << pin;
            } else {
                this.externalPinStateA &= ~(1 << pin);
            }

            // Mark this pin as explicitly driven by external source
            this.externallyDrivenA |= 1 << pin;

            // Check电平变化中断 - 根据手册6.2.5节
            // The interrupt detects mismatch between current pin value and last read PORTA value
            const ioca = this.ram[VM.SFR_IOCA];
            if ((ioca & (1 << pin)) !== 0) {
                // 使用统一的计算方法获取当前引脚值（优先检查PWM）
                let currentPinValue: number;
                const pwmChannel = this.getPwmChannel('A', pin);
                if (pwmChannel !== null) {
                    // PWM控制的引脚，返回PWM电平
                    currentPinValue = this.pwmOutputs[pwmChannel] ? 1 : 0;
                } else {
                    // 非PWM引脚，使用统一计算
                    currentPinValue = this.getPinState('A', pin, this.ram[VM.SFR_PORTA]);
                }

                const lastPinValue = (this.portALastValue >> pin) & 0x01;

                // If current value differs from last read value, generate mismatch interrupt
                if (lastPinValue !== currentPinValue) {
                    let pir1 = this.ram[VM.SFR_PIR1];
                    pir1 |= VM.PIR1_RAIF;
                    this.ram[VM.SFR_PIR1] = pir1;
                }
            }
        } else {
            if (pin < 0 || pin > 7) return;

            // Update external pin state (simulates physical connection to the pin)
            if (value) {
                this.externalPinStateB |= 1 << pin;
            } else {
                this.externalPinStateB &= ~(1 << pin);
            }

            // Mark this pin as explicitly driven by external source
            this.externallyDrivenB |= 1 << pin;

            // 检查RB0/INT外部中断 - 根据手册7.2.1节和2.6节OPTION_REG INTEDG位
            if (pin === 0) {
                const option = this.ram[VM.SFR_OPTION_REG];
                const intedg = (option & VM.OPTION_INTEDG) !== 0;
                const risingEdge = !this.intLastState && value;
                const fallingEdge = this.intLastState && !value;

                // 根据INTEDG配置检测对应边沿触发中断
                if ((intedg && risingEdge) || (!intedg && fallingEdge)) {
                    let intcon = this.ram[VM.SFR_INTCON];
                    intcon |= VM.INTCON_INTF;
                    this.ram[VM.SFR_INTCON] = intcon;
                }
                this.intLastState = value;
            }

            // 检查PORTB电平变化中断 - 根据手册6.3.5节
            // The interrupt detects mismatch between current pin value and last read PORTB value
            const iocb = this.ram[VM.SFR_IOCB];
            if ((iocb & (1 << pin)) !== 0) {
                // 使用统一的计算方法获取当前引脚值（优先检查PWM）
                let currentPinValue: number;
                const pwmChannel = this.getPwmChannel('B', pin);
                if (pwmChannel !== null) {
                    // PWM控制的引脚，返回PWM电平
                    currentPinValue = this.pwmOutputs[pwmChannel] ? 1 : 0;
                } else {
                    // 非PWM引脚，使用统一计算
                    currentPinValue = this.getPinState('B', pin, this.ram[VM.SFR_PORTB]);
                }

                const lastPinValue = (this.portBLastValue >> pin) & 0x01;

                // If current value differs from last read value, generate mismatch interrupt
                if (lastPinValue !== currentPinValue) {
                    let intcon = this.ram[VM.SFR_INTCON];
                    intcon |= VM.INTCON_RBIF;
                    this.ram[VM.SFR_INTCON] = intcon;
                }
            }
        }
    }

    /**
     * 设置比较器模拟输入值
     * @param pin 比较器输入引脚名称
     * @param normalizedValue 归一化电压值 (0.0 = GND, 1.0 = VDD)
     */
    setComparatorInput(
        pin: 'CMP_PLUS' | 'CMP0_MINUS' | 'CMP1_MINUS' | 'CMP2_MINUS' | 'CMP3_MINUS',
        normalizedValue: number,
    ): void {
        // 限制范围在 0.0-1.0
        const clampedValue = Math.max(0.0, Math.min(1.0, normalizedValue));

        switch (pin) {
            case 'CMP_PLUS':
                this.compAnalogInputs.cmpPlus = clampedValue;
                break;
            case 'CMP0_MINUS':
                this.compAnalogInputs.cmp0Minus = clampedValue;
                break;
            case 'CMP1_MINUS':
                this.compAnalogInputs.cmp1Minus = clampedValue;
                break;
            case 'CMP2_MINUS':
                this.compAnalogInputs.cmp2Minus = clampedValue;
                break;
            case 'CMP3_MINUS':
                this.compAnalogInputs.cmp3Minus = clampedValue;
                break;
        }

        // 立即更新比较器输出
        this.updateComparator();
    }

    /**
     * Reset the VM
     * @param source Reset source for TO/PD bit setting
     */
    reset(source: ResetSource = ResetSource.POR): void {
        // 清零通用RAM(0x20-0x6F, 0x70-0x7F快速存储区)
        for (let i = 0x20; i <= 0x7f; i++) {
            this.ram[i] = 0x00;
            this.ram[i + 0x80] = 0x00; // Bank1对应位置
        }

        // 初始化特殊功能寄存器默认值(根据手册V1.0.5)
        this.ram[VM.SFR_OPTION_REG] = 0b01111011; // Bit7未用,INTEDG=1,T0CS=1,T0SE=1,PSA=1,PS[2:0]=011
        this.ram[VM.SFR_PCL] = 0x00;

        // Set TO/PD bits based on reset source (Manual Section 2.5)
        let statusInit = 0b00011000; // Base: IRP=0,RP1=0,RP0=0
        switch (source) {
            case ResetSource.POR:
            case ResetSource.LVR:
                statusInit |= VM.STATUS_TO | VM.STATUS_PD; // TO=1, PD=1
                break;
            case ResetSource.WDT:
                if (this.sleeping) {
                    // WDT timeout in sleep mode: TO=0, PD=0
                    statusInit &= ~(VM.STATUS_TO | VM.STATUS_PD);
                } else {
                    // WDT timeout in normal mode: TO=0, PD=1
                    statusInit &= ~VM.STATUS_TO;
                    statusInit |= VM.STATUS_PD;
                }
                break;
            case ResetSource.STOP:
                // STOP instruction: TO=1, PD=0
                statusInit |= VM.STATUS_TO;
                statusInit &= ~VM.STATUS_PD;
                break;
        }
        this.ram[VM.SFR_STATUS] = statusInit;
        this.ram[VM.SFR_TRISB] = 0xff;
        this.ram[VM.SFR_WPDB] = 0b00000000; // WPDB3未用
        this.ram[VM.SFR_WPUB] = 0x00;
        this.ram[VM.SFR_IOCB] = 0x00;
        this.ram[VM.SFR_PCLATH] = 0x00;
        this.ram[VM.SFR_INTCON] = 0x00;
        this.ram[VM.SFR_ODCONB] = 0x00;
        this.ram[VM.SFR_PIR1] = 0x00;
        this.ram[VM.SFR_PIE1] = 0x00;
        this.ram[VM.SFR_CMPCON0] = 0x00;
        this.ram[VM.SFR_CMPCON1] = 0x00;
        this.ram[VM.SFR_PR2] = 0xff;
        this.ram[VM.SFR_TMR2] = 0x00;
        this.ram[VM.SFR_T2CON] = 0x00;
        this.ram[VM.SFR_OSCCON] = 0b10100010; // IRCF=101(4分频), SWDTEN=1 (手册复位值)
        this.ram[VM.SFR_PWMCON0] = 0x00;
        this.ram[VM.SFR_PWMCON1] = 0x00;
        this.ram[VM.SFR_PWMTL] = 0x00;
        this.ram[VM.SFR_PWMTH] = 0x00;
        this.ram[VM.SFR_PWMD0L] = 0x00;
        this.ram[VM.SFR_PWMD1L] = 0x00;
        this.ram[VM.SFR_PWMD4L] = 0x00;
        this.ram[VM.SFR_PWMT4L] = 0x00;
        this.ram[VM.SFR_PWMCON2] = 0x00;
        this.ram[VM.SFR_PWMD01H] = 0x00;
        this.ram[VM.SFR_PWM01DT] = 0x00;

        // Bank1 SFR默认值
        this.ram[VM.SFR_TMR0] = 0x00;
        this.ram[VM.SFR_TRISA] = 0b00111111;
        this.ram[VM.SFR_WPDA] = 0x00;
        this.ram[VM.SFR_WPUA] = 0x00;
        this.ram[VM.SFR_IOCA] = 0x00;
        this.ram[VM.SFR_ODCONA] = 0x00;
        this.ram[VM.SFR_PWMD2L] = 0x00;
        this.ram[VM.SFR_PWMD3L] = 0x00;
        this.ram[VM.SFR_PWM23DT] = 0x00;
        this.ram[VM.SFR_PWMD23H] = 0x00;

        // 初始化CPU寄存器
        this.pc = 0x0000; // 复位向量
        this.acc = 0x00;
        this.sp = 0;
        this.stack.fill(0x0000);

        // 初始化定时器和看门狗
        this.wdtElapsedTimeNs = 0;
        this.timer0Prescaler = 0;
        this.timer0WriteDisableCycles = 0;
        this.timer2Prescaler = 0;
        this.timer2Postscaler = 0;
        this.pwmPeriodCounter = 0;
        this.pwmDutyCache = { pwm0: 0, pwm1: 0, pwm2: 0, pwm3: 0, pwm4: 0 };

        // Reset LSE stabilization state
        this.lseStabilized = false;
        this.lseStabilizationCycles = 0;

        // Reset comparator filter delay
        this.compFilterDelayNs = 0;
        this.compPendingOutput = false;

        // Initialize clock system
        this.lseEnabled = false;
        this.t0ckiFrequency = 0;

        this.compLastOutput = false;
        this.portALastValue = 0;
        this.portBLastValue = 0;
        this.intLastState = false;
        this.externalPinStateA = 0;
        this.externalPinStateB = 0;
        this.externallyDrivenA = 0;
        this.externallyDrivenB = 0;
        this.compAnalogInputs = {
            cmpPlus: 0,
            cmp0Minus: 0,
            cmp1Minus: 0,
            cmp2Minus: 0,
            cmp3Minus: 0,
        };

        // 初始化运行状态
        this.cycles = 0;
        this.sleeping = false;
    }

    /**
     * 运行虚拟机直到停止
     * @param maxCycles 最大执行周期数(防止死循环)
     * @param stepCallback 可选的回调函数，每执行一条指令后调用，用于调试监控
     */
    run(maxCycles = 1000000, stepCallback?: () => void): void {
        let cycles = 0;

        while (cycles < maxCycles) {
            const stepCycles = this.step();
            if (stepCycles === 0) break;
            cycles += stepCycles;

            // Call callback after each step if provided
            if (stepCallback) {
                stepCallback();
            }
        }
    }

    /**
     * Enable or disable LSE (32.768kHz external crystal oscillator)
     * @param enable true if 32.768kHz crystal is connected, false otherwise
     */
    setLSEEnabled(enable: boolean): void {
        this.lseEnabled = enable;
        if (enable) {
            // Reset stabilization state when enabling LSE
            this.lseStabilized = false;
            this.lseStabilizationCycles = 0;
        }
    }

    /**
     * Set T0CKI external clock frequency
     * @param frequencyHz External clock frequency in Hz (0 to disable)
     */
    setT0CKIFrequency(frequencyHz: number): void {
        this.t0ckiFrequency = frequencyHz;
    }

    /**
     * 获取CPU核心状态（用于调试）
     * 返回CPU寄存器、堆栈、内存的直接引用
     * 注意：可以直接修改 ram 和 stack 进行调试
     */
    getState() {
        return {
            // Core CPU registers
            pc: this.pc,
            acc: this.acc,

            // Stack - direct reference (can be modified for debugging)
            sp: this.sp,
            stack: this.stack,

            // RAM - direct reference (can be modified for debugging)
            ram: this.ram,

            // Internal timer counters (not directly readable from RAM)
            timer0Prescaler: this.timer0Prescaler,
            timer0WriteDisableCycles: this.timer0WriteDisableCycles,
            timer2Prescaler: this.timer2Prescaler,
            timer2Postscaler: this.timer2Postscaler,

            // WDT internal counter
            wdtElapsedTimeNs: this.wdtElapsedTimeNs,

            // PWM internal counter
            pwmPeriodCounter: this.pwmPeriodCounter,

            // System execution state
            cycles: this.cycles,
            sleeping: this.sleeping,
        };
    }
}
