/**
 * @license sc8p053vm
 * Copyright (c) 2026 391321232@qq.com
 * Licensed under BSL-1.1 (see LICENSE). Changes to MIT after 2099-12-31.
 */

#define TMR0        (*(unsigned char *)0x81)
#define OPTION_REG  (*(unsigned char *)0x01)
#define TRISB       (*(unsigned char *)0x05)
#define PORTB       (*(unsigned char *)0x06)
#define WPUB        (*(unsigned char *)0x08)
#define TRISA       (*(unsigned char *)0x85)
#define PORTA       (*(unsigned char *)0x86)
#define WPUA        (*(unsigned char *)0x88)
#define INTCON      (*(unsigned char *)0x0B)
#define OSCCON      (*(unsigned char *)0x14)

unsigned char toggle_flag;

void init_hw() {
    // 配置系统时钟：16MHz / 4 = 4MHz
    OSCCON = 0x70;
    // 配置 PORTA 所有引脚为推挽输出
    TRISA = 0x00;     // 所有 PORTA 引脚设为输出
    PORTA = 0x00;     // 初始输出低电平
    WPUA = 0x00;      // 禁止上拉电阻
    // 配置 PORTB 所有引脚为推挽输出
    TRISB = 0x00;     // 所有 PORTB 引脚设为输出
    PORTB = 0x00;     // 初始输出低电平
    WPUB = 0x00;      // 禁止上拉电阻
    // 配置 TIMER0
    // 预分频器分配给 TIMER0，分频比 1:8
    // T0CS=0 (内部时钟), T0SE=0, PSA=0 (分配给TMR0), PS2:PS0=010 (1:8)
    OPTION_REG = 0x82;
    // 设置 TMR0 初始值，定时 200μs
    // (256 - 231) * 8μs = 25 * 8μs = 200μs
    TMR0 = 0xE7;
    // 使能 TIMER0 中断
    INTCON = 0xA0;    // GIE=1, PEIE=0, T0IE=1, 其他=0
    // 初始化翻转标志
    toggle_flag = 0;
}

void isr() __interrupt {
    // 清除 TMR0 中断标志
    INTCON = INTCON & 0xFB;  // 清除 T0IF
    // 重新加载 TMR0 初值
    TMR0 = 0xE7;
    // 每 200μs 翻转一次 IO
    PORTA = ~PORTA;
    PORTB = ~PORTB;
}

void main() {
    init_hw();
    while (1) {
        // 主循环空转，由中断处理 IO 翻转
    }
}
