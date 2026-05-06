# sc8p053vm

[![npm version](https://img.shields.io/npm/v/sc8p053vm.svg)](https://www.npmjs.com/package/sc8p053vm)

SC8P053微控制器虚拟机模拟器，用于模拟SC8P053单片机的指令执行和硬件行为。

## 前言

如果这个项目对你有帮助，欢迎请作者喝杯咖啡：[爱发电](https://ifdian.net/a/zycwind)。

QQ交流群：1077899021

## 主要功能

- 完整的SC8P053指令集模拟
- 精确的外设模拟（定时器、PWM、比较器等）
- I/O端口状态监控
- 中断系统模拟
- 看门狗定时器模拟
- 低功耗模式支持

## 安装

```bash
npm install sc8p053vm
```

## 使用方法

```typescript
import { VM } from 'sc8p053vm';

// 创建ROM数据
const romData = new Uint16Array([
  // 你的汇编代码对应的机器码
]);

// 创建虚拟机实例
const vm = new VM(romData, {
  wdt: false,      // 是否启用看门狗
  lvrSel: 0x03,    // LVR电压选择 (0x00=1.8V, 0x01=2.0V, 0x02=2.5V, 0x03=3.0V)
  fcpuDiv: 4       // CPU时钟分频 (2或4)
});

// 运行虚拟机
vm.run(10000); // 运行最多10000个周期

// 获取虚拟机状态
const state = vm.getState();
console.log('PC:', state.pc);
console.log('ACC:', state.acc);

// 设置I/O引脚输入
vm.setPinInput('A', 0, true);  // 设置PORTA第0引脚为高电平
vm.setPinInput('B', 1, false); // 设置PORTB第1引脚为低电平

// 设置比较器模拟输入
vm.setComparatorInput('CMP_PLUS', 0.5); // 设置比较器正端输入为0.5*VDD
```

## API参考

### VM类构造函数

```typescript
constructor(romData: Uint16Array, config?: {
  wdt?: boolean;
  lvrSel?: number;
  fcpuDiv?: number;
})
```

### 主要方法

- `run(maxCycles?: number, stepCallback?: () => void): void` - 运行虚拟机
- `getState(): object` - 获取虚拟机状态
- `setPinInput(port: 'A' | 'B', pin: number, value: boolean): void` - 设置I/O引脚输入
- `setComparatorInput(pin: string, normalizedValue: number): void` - 设置比较器模拟输入
- `setLSEEnabled(enable: boolean): void` - 启用/禁用外部低速晶振
- `setT0CKIFrequency(frequencyHz: number): void` - 设置T0CKI外部时钟频率
- `setVDD(voltage: number): void` - 设置供电电压

## License

BSL-1.1，2099-12-31 后变更为 MIT。详见 [LICENSE](LICENSE)。
