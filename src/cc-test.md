# cc.ts Bug 记录与修复清单

基于 SC8P053 用户手册 V1.0.5 指令集精确定义审查

---

## P0 - 严重 Bug（运行结果错误）

### Bug 1: 左移使用 RLA（循环左移）而非算术左移

**位置**: emitMultiply (乘以2优化), emitShiftLeft (<<运算)

**手册定义**: RLA 是"不带 C 循环左移"，即 bit7 循环到 bit0
**正确行为**: 算术左移应丢弃 bit7，bit0 补 0

**影响**: `x * 2` 和 `x << 1` 结果错误
- 例: 0x80 << 1 应为 0x00，但 RLA 0x80 = 0x01（循环）

**修复**: 使用 ADD 自身代替左移（ACC + ACC = ACC * 2），或使用 CLRB STATUS,0 + RLCA

**VM验证**: ✅ 0x03<<1=0x06, 0x80<<1=0x00, 0x03<<2=0x0C, 0xFF<<1=0xFE

### Bug 2: 右移使用 RRA（循环右移）而非逻辑右移

**位置**: emitDivide (除以2优化), emitShiftRight (>>运算)

**手册定义**: RRA 是"不带 C 循环右移"，即 bit0 循环到 bit7
**正确行为**: 逻辑右移应丢弃 bit0，bit7 补 0

**影响**: `x / 2` 和 `x >> 1` 结果错误
- 例: 0x81 >> 1 应为 0x40，但 RRA 0x81 = 0xC0（循环）

**修复**: 先 CLRB STATUS,0 清 C，再使用 RRCA（带 C 右移，C 移入 bit7）

**VM验证**: ✅ 0x06>>1=0x03, 0x81>>1=0x40, 0x0C>>2=0x03

### Bug 3: -= 复合赋值中 SUBA 操作数顺序导致结果反转

**位置**: emitAssignment, case '-='

**手册定义**: SUBA [R] = [R] - ACC → ACC
**代码逻辑**: 先 emitLoadAccumulator(left) 使 ACC=left，再 emitOpSym('SUBA', rsym) 得 ACC=rsym-left=right-left

**影响**: `a -= b` 变成 `a = b - a`

**修复**: 改用 HSUBA rsym（ACC - rsym = left - right）

**VM验证**: ✅ 10-=3=7, 10-=b(3)=7

### Bug 4: 比较运算中 SUBA 操作数顺序审查

**位置**: emitComparisonGeneric

**分析**:
- lsym && rsym: ACC=right, SUBA lsym → ACC=lsym-right=left-right ✓
- else if (rsym): ACC=left→temp, ACC=right, SUBA temp → ACC=temp-right=left-right ✓
- else if (lsym): ACC=right, SUBA lsym → ACC=lsym-right=left-right ✓
- else: ACC=left→temp, ACC=right, SUBA temp → ACC=temp-right=left-right ✓

经仔细审查，比较运算的 SUBA 使用是正确的。

**VM验证**: ✅ 5<10=1, 10<5=0, 5==5=1, 5!=10=1, 3<=3=1, 3>3=0, 3>=3=1, 5>3=1

### Bug 5: 除法/取模运算中 SUBA 操作数顺序审查

**位置**: emitDivide, emitModulo

**分析**: emitOpTemp('SUBA', t0) 执行 t0 - ACC。在除法中：
- ACC = divisor(t1), SUBA t0 → ACC = t0 - t1 = dividend - divisor ✓

逻辑正确，但效率低（减法执行了两次，一次测试一次实际执行）。

**VM验证**: ✅ 10/3=3, 10%3=1

---

## P1 - 高优先级 Bug

### Bug 6: uint16_t / unsigned int 映射为 u8

**位置**: resolveType

**问题**: `unsigned int` 和 `uint16_t` 被映射为 8 位 u8，16 位类型完全丢失
**影响**: 16 位值被截断，违反 C 标准 sizeof(int) >= 2
**修复**: 添加 u16 类型支持（需较大改动），或至少给出编译错误提示

**验证**: ✅ 编译 uint16_t 时抛出错误

### Bug 7: 中断不保存 PCLATH

**位置**: emitFunction (ISR 部分)

**手册要求**: 第24页明确说明"对 PCL 操作时，必须先对 PCLATH 进行赋值"
**Hi-Tech C 经验**: 中断框架必须保存 PCLATH，否则中断返回后主程序的跳转表会出错
**修复**: 在 ISR 中保存/恢复 PCLATH，使用 _ISR_PCLATH EQU 0x73（共享区）

**验证**: ✅ ISR 中包含 LD A,PCLATH / LD _ISR_PCLATH,A / LD A,_ISR_PCLATH / LD PCLATH,A

### Bug 8: 全局变量初始化不支持

**位置**: processGlobalDeclaration

**问题**: `unsigned char x = 5;` 只分配 RAM，不生成初始化代码
**Hi-Tech C 经验**: 在 main 函数入口前生成初始化代码段
**修复**: 收集全局变量初始值，在 main 入口处生成 LDIA/LD 序列

**VM验证**: ✅ x=42→RAM=42, x=255→RAM=255

### Bug 9: ISR 帧分配硬编码偏移 +3

**位置**: allocateCompiledStack

**问题**: `RAM_SHARED_START + 3` 硬编码跳过 3 个 ISR 保存字节
**修复**: 定义常量 ISR_SAVE_SIZE = 4（含 PCLATH），使用常量计算偏移

**验证**: ✅ _ISR_ACC=0x70, _ISR_STATUS=0x71, _ISR_FSR=0x72, _ISR_PCLATH=0x73

---

## P1.5 - 新发现的高优先级 Bug（VM 测试发现）

### Bug 17: 局部变量初始化被完全忽略

**位置**: emitCompoundStatement

**问题**: `emitCompoundStatement` 中 `if (child.type === 'declaration') continue;` 直接跳过所有声明语句，导致局部变量初始化代码不生成
**影响**: `void main() { unsigned char a = 10; }` 中 a 不会被初始化为 10
**修复**: 对声明语句调用 `emitDeclarationInit` 处理初始化

**VM验证**: ✅ local a=10,b=3,c=a+b → c=13; local a=10,a+=5 → a=15

### Bug 18: 数组下标访问失败（subscript_expression 子节点无 field name）

**位置**: resolveArraySymbol, emitArrayStore, emitArrayLoad

**问题**: tree-sitter-c 的 `subscript_expression` 节点的子节点没有命名 field（`childForFieldName('array')` 和 `childForFieldName('index')` 都返回 null），导致数组读写完全失效
**影响**: `arr[2] = 42;` 和 `x = arr[2];` 都不生成任何代码
**修复**: 使用位置遍历子节点作为 fallback：identifier 为数组名，非括号非标识符节点为索引

**VM验证**: ✅ arr[2]=42→RAM=42; x=arr[2]→x=42; local arr[1]=99→arr[1]=99

### Bug 19: sizeof(arr) 对数组类型返回 1 而非数组大小

**位置**: emitLoadAccumulator, sizeof_expression 分支

**问题**: `sizeof(arr)` 的参数是 `parenthesized_expression`，需要 unwrap 后才能获取到 `identifier` 来查找符号
**影响**: `sizeof(arr)` 对数组 arr[5] 返回 1 而非 5
**修复**: 对 sizeof 参数调用 `unwrapParentheses` 后再 `resolveSymbol`

**验证**: ✅ sizeof(arr[5]) 生成 LDIA 0x05

### Bug 20: PCLATH EQU 定义缺失

**位置**: emitHeader

**问题**: ISR 中使用 PCLATH 符号但头部未定义 PCLATH EQU，汇编器无法识别
**修复**: 添加 `PCLATH EQU 0x0A` 到 emitHeader

**验证**: ✅ 汇编输出包含 PCLATH EQU 0x0A

### Bug 21: && 和 || 运算符作为表达式值时逻辑完全错误

**位置**: emitLogicalBinary

**问题**: `emitLogicalBinary` 只评估了左操作数，没有评估右操作数；且跳转逻辑反了（&& 为假时跳到 setOne）
**影响**: `1 && 1` 返回 0，`0 && 0` 返回 1，`0 || 1` 返回 0
**修复**: 重写 emitLogicalBinary，正确评估左右操作数：
- `&&`: 两个操作数都为真时返回1，任一为假返回0
- `||`: 任一操作数为真时返回1，两个都为假返回0

**VM验证**: ✅ 1&&1=1, 1&&0=0, 0||1=1, 0||0=0

### Bug 22: do-while 语句未实现

**位置**: emitStatement

**问题**: `do_statement` 类型在 switch 中没有对应处理，do-while 循环被完全忽略
**修复**: 添加 `emitDoWhileStatement` 方法，先执行循环体再检查条件

**VM验证**: ✅ do { i++; sum+=i; } while(i<3) → sum=6

### Bug 23: <<=, >>=, *=, /=, %= 复合赋值运算符未实现

**位置**: emitAssignment

**问题**: 只处理了 +=, -=, &=, |=, ^=，其他复合赋值运算符被忽略
**修复**: 添加 `emitShiftAssign`（处理 <<=, >>=）和 `emitArithAssign`（处理 *=, /=, %=）

**VM验证**: ✅ 4<<=1=8, 16>>=1=8, 5*=3=15, 10/=3=3, 10%=3=1

### Bug 24: 后缀 ++/-- 在表达式中不返回旧值

**位置**: emitUpdateExpression

**问题**: `emitUpdateExpression` 不区分前缀/后缀，总是返回新值（等同于前缀语义）
- `b = a++` 应返回旧值（b=5, a=6），但实际 b=6, a=6
**修复**: 通过检查 tree-sitter 子节点顺序判断前缀/后缀：
- 前缀（++a）：child(0) 是运算符，返回新值
- 后缀（a++）：child(0) 是 identifier，先保存旧值到 ACC，再自增变量，最后恢复旧值到 ACC

**VM验证**: ✅ b=a++→b=5,a=6; b=++a→b=6,a=6; b=a--→b=5,a=4; b=--a→b=4,a=4

### Bug 25: update_expression 和 conditional_expression 在 emitLoadAccumulator 中未处理

**位置**: emitLoadAccumulator

**问题**: `b = a++` 中 `a++` 作为 right 值传给 emitLoadAccumulator，但该函数不识别 update_expression 类型，导致不生成任何代码
**修复**: 在 emitLoadAccumulator 中添加 update_expression 和 conditional_expression 的处理分支

**VM验证**: ✅ 同 Bug 24

### Bug 26: 三元运算符 (?:) 未实现

**位置**: emitLoadAccumulator

**问题**: conditional_expression 类型未处理，`c = (a ? b : d)` 不生成任何代码
**修复**: 添加 `emitConditionalExpression` 方法，使用条件跳转实现

**VM验证**: ✅ 1?10:20=10, 0?10:20=20

### Bug 27: 除法/取模循环中重复减法运算

**位置**: emitDivide, emitModulo

**问题**: 循环中先做一次减法检查标志位，然后又做一次相同的减法来获取结果，浪费指令
**修复**: 删除重复的减法指令，第一次减法的结果已经存在 ACC 中，直接存回临时变量即可

**VM验证**: ✅ 10/3=3, 10%3=1, 15/5=3, 15%5=0

### Bug 28: 动态数组索引存储 arr[i]=val 计算地址时覆盖了索引值

**位置**: emitArrayStore

**问题**: 当数组索引是非常量时，代码先加载 value 到 temp，再加载 index 到 ACC，然后 `LDIA baseAddr` 覆盖了 ACC 中的 index，接着 `ADDA temp` 加的是 value 而不是 index，导致 FSR 指向错误地址
**修复**: 增加 temp2 保存 index 值，计算地址时使用 `ADDA temp2`（index）而非 `ADDA temp`（value）

**VM验证**: ✅ arr[i]=val (i=2, val=42) → arr[2]=42; c=arr[i] (i=3, arr[3]=77) → c=77

### Bug 29: switch 语句完全未实现

**位置**: emitStatement

**问题**: switch 语句在 emitStatement 中没有对应的 case 处理，整个 switch 被静默忽略，不生成任何代码
**修复**: 添加 emitSwitchStatement 方法，实现：
1. 加载 switch 条件值到 ACC 并保存到临时变量
2. 对每个 case 值，用 HSUBIA 比较并条件跳转到对应标签
3. 无匹配时跳转到 default 或 switch 结束
4. 每个 case 的语句顺序执行，支持 fall-through
5. break 跳转到 switch 结束标签

**VM验证**: ✅ case 1→10, case 2→20, default→30, fall-through→20

### Bug 30: 嵌套函数调用时参数被内层调用覆盖

**位置**: emitCallExpression

**问题**: 参数传递是边计算边写入被调用函数的参数变量。当参数表达式中包含对同一函数的嵌套调用时，内层调用会覆盖外层已设置的参数值。例如 `add(3, add(4,5))`：先设置 x=3，然后计算 `add(4,5)` 时内层设置 x=4，覆盖了外层的 x=3，导致外层实际计算 4+9=13 而非 3+9=12
**修复**: 改为两阶段传参：先计算所有参数值并保存到临时变量，再统一从临时变量复制到被调用函数的参数变量

**VM验证**: ✅ add(3, add(4,5))=12

### Bug 31: emitUnaryExpression 中 ++/-- 死代码

**位置**: emitUnaryExpression

**问题**: `emitUnaryExpression` 中有 `++`/`--` 的处理代码，但 tree-sitter 对 `a++`/`++a` 生成的是 `update_expression` 节点而非 `unary_expression`，所以这段代码永远不会被执行。更重要的是，这段死代码不区分前缀/后缀，如果被执行会产生错误结果
**修复**: 删除 `emitUnaryExpression` 中的 `++`/`--` 分支

### Bug 32: 逗号表达式未实现

**位置**: emitLoadAccumulator

**问题**: 逗号表达式 `(a=5, b=10, a+b)` 在 `emitLoadAccumulator` 中没有对应的处理，整个逗号表达式被忽略，只返回了某个子表达式的值
**修复**: 添加 `emitCommaExpression` 方法，先求值左表达式（丢弃结果），再求值右表达式（作为整个逗号表达式的值返回）

**VM验证**: ✅ (a=5, b=10, a+b)=15

### Bug 33: 变量遮蔽未报错

**位置**: collectLocalDeclarations

**问题**: 函数内嵌套作用域中同名变量（如 `unsigned char a = 5; { unsigned char a = 10; }`）会静默覆盖符号表中的条目，导致两个变量共享同一内存地址，外层变量丢失
**修复**: 在 `collectLocalDeclarations` 中添加重定义检查，遇到同名变量时抛出错误

### Bug 34: 全局变量非常量初始化静默忽略

**位置**: processGlobalDeclaration

**问题**: 全局变量初始化只支持常量表达式（通过 `getConstantValue`），当初始化值不是常量（如 `unsigned char b = a + 1`）时，初始化代码被静默忽略，变量保持未初始化状态
**修复**: 当全局变量初始化值不是常量时抛出错误，要求用户使用常量表达式

### Bug 35: 赋值表达式作为值使用未处理

**位置**: emitLoadAccumulator

**问题**: `c = (a = 5)` 这样的赋值表达式作为值使用时，`emitLoadAccumulator` 中没有 `assignment_expression` 的处理分支，导致内层赋值被忽略，外层变量得到未定义值
**修复**: 添加 `emitAssignmentAsValue` 方法，先执行赋值操作，然后将赋的值留在 ACC 中

**VM验证**: ✅ c=(a=5) => a=5,c=5; c=(a+=5) => a=8,c=8

---

## P2 - 中等优先级

### Bug 10: sizeof 总是返回 1

**位置**: emitLoadAccumulator, sizeof_expression 分支

**问题**: 不区分数组和标量类型，sizeof(array) 也返回 1
**修复**: 查找符号的 arraySize 属性（已修复，见 Bug 19）

### Bug 11: 函数调用后 currentAsmBank = 0 假设

**位置**: emitCallExpression

**问题**: 假设被调用函数返回时在 Bank0，但若函数有 early return 且未恢复 Bank 则可能错误
**修复**: 调用后 invalidateBankState() 而非假设 Bank0

**验证**: ✅ CALL 后不假设 Bank0

### Bug 12: LD A,[R] 影响 Z 标志位

**手册定义**: LD A,[R] 影响 Z 标志位
**问题**: emitLdSymToA 后如果依赖之前的标志位会出错
**注意**: 当前代码中未发现因此导致的实际 Bug，但需注意

### Bug 13: 一元负号 (-x) 实现为 x+1 而非 ~x+1

**位置**: emitUnaryExpression, case '-'

**问题**: `HSUBIA 0x00` 是 ACC-0=ACC（无操作），再加 1 等于 x+1
**正确做法**: 补码 = 取反加1，即 `XORIA 0xFF; ADDIA 0x01`
**修复**: 将 HSUBIA 0x00 改为 XORIA 0xFF

**VM验证**: ✅ -(1)=0xFF, -(0)=0x00

### Bug 14: emitShiftLeft 多位移位结果未存回临时变量

**位置**: emitShiftLeft

**问题**: ADDA t0 结果在 ACC 中，但循环中每次从 t0 读取原值，导致 x<<n 永远等于 x*2
**修复**: 每次 ADDA 后添加 emitLdAToTemp(t0) 将结果存回

**VM验证**: ✅ 3<<2=0x0C, 1<<3=0x08

### Bug 15: emitShiftRight 多位移位结果未存回临时变量

**位置**: emitShiftRight

**问题**: RRCA t0 结果在 ACC 中，但循环中每次从 t0 读取原值，导致 x>>n 永远等于 x>>1
**修复**: 每次 RRCA 后添加 emitLdAToTemp(t0) 将结果存回

**VM验证**: ✅ 12>>2=3

### Bug 16: emitDivide /2 优化中 LD A,t0 覆盖了 RRCA 的结果

**位置**: emitDivide, rightConst === 2 分支

**问题**: RRCA t0 结果在 ACC 中，但随后 LD A,t0 又从 t0 读取原值覆盖了结果
**修复**: 删除多余的 emitLdTempToA(t0)

---

## 修复记录

- [x] Bug 1: 左移改用 ADD 自身（emitMultiply, emitShiftLeft）
- [x] Bug 2: 右移改用 CLRB STATUS,0 + RRCA（emitDivide, emitShiftRight）
- [x] Bug 3: -= 改用 HSUBA（emitAssignment）
- [x] Bug 6: uint16_t/unsigned int 添加编译错误提示（resolveType）
- [x] Bug 7: ISR 保存/恢复 PCLATH（emitFunction, emitReturnStatement）
- [x] Bug 8: 全局变量初始化支持（processGlobalDeclaration + emitGlobalInits）
- [x] Bug 9: ISR 帧偏移使用 ISR_SAVE_SIZE 常量（allocateCompiledStack）
- [x] Bug 10: sizeof 支持数组（emitLoadAccumulator）
- [x] Bug 11: 函数调用后 invalidateBankState（emitCallExpression）
- [x] Bug 13: 一元负号改用 XORIA 0xFF + ADDIA 0x01（emitUnaryExpression）
- [x] Bug 14: emitShiftLeft 多位移位存回临时变量
- [x] Bug 15: emitShiftRight 多位移位存回临时变量
- [x] Bug 16: emitDivide /2 删除多余的 LD A,t0
- [x] Bug 17: 局部变量初始化（emitCompoundStatement 调用 emitDeclarationInit）
- [x] Bug 18: 数组下标访问（resolveArraySymbol/emitArrayStore/emitArrayLoad 使用位置遍历 fallback）
- [x] Bug 19: sizeof 数组类型（unwrapParentheses 处理 sizeof 参数）
- [x] Bug 20: PCLATH EQU 定义（emitHeader 添加 PCLATH EQU 0x0A）
- [x] Bug 21: && 和 || 运算符逻辑完全错误（emitLogicalBinary 重写，正确评估左右操作数）
- [x] Bug 22: do-while 语句未实现（添加 emitDoWhileStatement）
- [x] Bug 23: <<=, >>=, *=, /=, %= 复合赋值未实现（添加 emitShiftAssign, emitArithAssign）
- [x] Bug 24: 后缀 ++/-- 不返回旧值（emitUpdateExpression 区分前缀/后缀）
- [x] Bug 25: update_expression/conditional_expression 在 emitLoadAccumulator 中未处理
- [x] Bug 26: 三元运算符 (?:) 未实现（添加 emitConditionalExpression）
- [x] Bug 27: 除法/取模循环中重复减法运算（优化删除冗余指令）
- [x] Bug 28: 动态数组索引存储 arr[i]=val 地址计算错误（增加 temp2 保存 index）
- [x] Bug 29: switch 语句完全未实现（添加 emitSwitchStatement）
- [x] Bug 30: 嵌套函数调用参数被内层覆盖（两阶段传参：先存临时变量再传参）
- [x] Bug 31: emitUnaryExpression 中 ++/-- 死代码（删除，由 emitUpdateExpression 处理）
- [x] Bug 32: 逗号表达式未实现（添加 emitCommaExpression）
- [x] Bug 33: 变量遮蔽未报错（添加重定义检查）
- [x] Bug 34: 全局变量非常量初始化静默忽略（添加报错）
- [x] Bug 35: 赋值表达式作为值使用未处理（添加 emitAssignmentAsValue）
- [x] Bug 36: 全局数组初始化列表未实现（添加 emitGlobalArrayInit）
- [x] Bug 37: emitReturnStatement无法获取update/conditional/comma/assignment表达式
- [x] Bug 38: 临时变量未释放导致RAM浪费（移除freeTemp，保留函数生命周期方案）
- [x] Bug 39: 函数调用参数不足时未报错（添加参数数量检查）
- [x] Bug 40: 递归函数调用未检测（添加递归检测，抛出错误）
- [x] Bug 41: 多变量声明语句只处理第一个变量（重构processGlobalDeclaration/collectLocalDeclarations/emitDeclarationInit）
- [x] Bug 42: 全局变量初始化不支持常量表达式（增强getConstantValue支持常量折叠）
- [x] Bug 43: 负数常量parseNumber未截断为8位（添加& 0xFF）
- [x] Bug 44: 变量移位次数只移1次（实现运行时循环移位）
- [x] Bug 45: void函数允许返回值（添加返回值类型检查）
- [x] Bug 46: char_literal未在emitLoadAccumulator中处理（添加字符字面量加载）
- [x] Bug 47: 嵌套逻辑运算缺少加载操作数（误报，实际代码正确，测试环境不同步导致）
- [x] Bug 48: 动态数组索引使用 & 0x7F 掩码导致 bank 1 地址错误（改为 & 0xFF）
- [x] Bug 49: 函数部分路径缺少RET指令（hasEarlyReturn逻辑错误，始终在函数末尾添加RET）
- [x] Bug 50: 除以0导致死循环（常量除以0编译报错，运行时除以0跳过循环返回0）
- [x] Bug 51: 全局数组初始化缺少第一个元素的LDIA指令（修复emitGlobalArrayInit中初始化列表处理）
- [x] Bug 52: emitOutput中PCLATH EQU未加入headerLines且有死代码（添加PCLATH到headerLines，移除死代码）
- [x] Bug 53: 局部数组初始化未处理（添加emitDeclarationInit中initializer_list支持）
- [x] Bug 54: 全局数组初始化不支持char_literal（增强getConstantValue支持字符字面量）
- [x] Bug 55: ISR函数允许返回值（添加ISR函数返回值检查）
- [x] Bug 56: 数组大小声明不支持常量表达式（parseDeclarator使用getConstantValue）
- [x] Bug 57: switch语句中continue_statement被忽略（添加continue_statement到可执行语句类型检查）
- [x] Bug 58: signed char比较运算使用无符号减法标志（添加inferExprType和emitSignedComparison）
- [x] Bug 59: SZB/SNZB对临时变量使用数字索引而非符号名（添加emitTestBitTemp辅助方法）
- [x] Bug 60: SZB/SNZB逻辑反转——正数/负数路径标签互换（SZB改SNZB）
- [x] Bug 61: signed除法/2优化错误——算术右移≠有符号除以2（移除/2优化）
- [x] Bug 62: emitArrayCompoundAssign中signed数组>>=,/=,%=使用unsigned算法（添加isSigned检查）
- [x] Bug 63: emitArrayCompoundAssign动态移位循环无条件跳转导致无限循环（改为条件跳转）
- [x] Bug 64: inferExprType缺少update/assignment/conditional表达式类型推断（添加三种类型推断）

### Bug 36: 全局数组初始化列表未实现

**位置**: emitGlobalInit

**问题**: 全局数组声明如 `unsigned char arr[5] = {1,2,3,4,5}` 未生成初始化代码
**修复**: 添加 emitGlobalArrayInit 方法，遍历初始化列表逐个写入数组元素

**VM验证**: ✅ arr[5]={1,2,3,4,5}, arr[0]=1, arr[2]=3, arr[4]=5

### Bug 37: emitReturnStatement无法获取update/conditional/comma/assignment表达式

**位置**: emitReturnStatement

**问题**: tree-sitter-C的return_statement节点没有value字段，原代码使用findChildByType查找有限类型，导致return a++、return (a=5)、return x?1:0等表达式无法被正确处理
**修复**: 重构value查找逻辑，遍历子节点跳过return关键字和分号，直接获取值表达式

**VM验证**: ✅ return a++返回旧值; ✅ return (a=5)返回5; ✅ return ternary表达式正确

### Bug 38: 临时变量未释放导致RAM浪费

**位置**: allocTemp/freeTemp

**问题**: 尝试实现freeTemp释放临时变量，但EQU定义在函数头部一次性生成，freeTemp后引用的临时变量EQU定义缺失导致汇编错误
**修复**: 移除freeTemp机制，临时变量在函数生命周期内保留。对于简单编译器这是可接受的折中方案，RAM使用量略高但保证正确性

**VM验证**: ✅ 所有测试通过，临时变量EQU定义正确生成

### Bug 39: 函数调用参数不足时未报错

**位置**: emitCallExpression

**问题**: 调用函数时传入参数少于函数定义的参数数量，编译器不报错，导致未初始化的参数被使用
**修复**: 在emitCallExpression中添加参数数量检查，参数不足时抛出错误

**验证**: ✅ `add(3)` 调用 `add(unsigned char x, unsigned char y)` 报错 "Function 'add' expects 2 argument(s), but 1 provided"

### Bug 40: 递归函数调用未检测

**位置**: compile

**问题**: 编译器使用静态RAM分配，递归调用会导致局部变量被覆盖，但编译器未检测递归
**修复**: 添加checkRecursion方法，使用DFS检测函数调用图中的环，发现递归时抛出错误

**验证**: ✅ 直接递归 `fib(n-1)` 报错 "Recursive function call detected: fib -> fib"; ✅ 间接递归 `a->b->a` 也被检测

### Bug 41: 多变量声明语句只处理第一个变量

**位置**: processGlobalDeclaration, collectLocalDeclarations, emitDeclarationInit

**问题**: `unsigned char a, b, c;` 或 `unsigned char a=1, b=2, c=3;` 只声明了第一个变量，后续变量被忽略
**修复**: 重构三个方法以遍历所有声明器节点，处理多个变量声明

**VM验证**: ✅ 全局多声明 `unsigned char a, b, c;` 正确分配地址 ✅ 带初始化的多声明 `unsigned char a=10, b=20, c=30;` 正确初始化 ✅ 局部多声明 `unsigned char a=5, b=10;` 正确分配栈空间并初始化

### Bug 42: 全局变量初始化不支持常量表达式

**位置**: getConstantValue

**问题**: `unsigned char a = 0xFF - 1;` 报错 "initializer must be a constant expression"，因为getConstantValue只处理number_literal和char_literal
**修复**: 增强getConstantValue支持一元表达式（-、~、!）和二元表达式（+、-、*、/、%、&、|、^、<<、>>、==、!=、<、>、<=、>=、&&、||）的常量折叠

**VM验证**: ✅ `0xFF - 1 = 254` ✅ `(3 + 4) * 2 = 14` ✅ `~0x0F = 0xF0` ✅ `-1 = 0xFF` ✅ `5 > 3 = 1` ✅ `1 && 0 = 0`

### Bug 43: 负数常量parseNumber未截断为8位

**位置**: parseNumber

**问题**: tree-sitter-C将`-1`解析为number_literal（文本"-1"），parseNumber返回-1，导致生成无效汇编如`HSUBIA 0x-1`
**修复**: parseNumber返回值添加 `& 0xFF`，将负数转为8位无符号表示（-1 → 0xFF）

**VM验证**: ✅ `a - (-1) = a + 1 = 6` ✅ `a + (-1) = a - 1 = 4` ✅ `unsigned char a = -1` → a = 0xFF

### Bug 44: 变量移位次数只移1次

**位置**: emitShiftLeft, emitShiftRight, emitShiftAssign

**问题**: 当移位次数是变量（如 `a << b`）时，`shifts = rightConst !== null ? rightConst : 1`，只移位1次而不是b次
**修复**: 当右操作数不是常量时，使用运行时循环实现变量移位次数：先检查计数器是否为0，不为0则循环移位并递减计数器

**VM验证**: ✅ `3 << 2 = 12` ✅ `0x0C >> 2 = 3` ✅ `3 <<= 2 = 12` ✅ `16 >>= 2 = 4` ✅ `3 << 0 = 3`

所有修复已通过 TypeScript 编译检查和 VM 语义验证测试。

---

## 测试覆盖

### 汇编模式测试 (test_cc.js)
- 移位运算指令正确性（ADDA/RRCA vs RLA/RRA）
- 减法/复合赋值指令正确性（HSUBA/HSUBIA）
- 一元负号指令正确性（XORIA 0xFF）
- ISR 保存/恢复 PCLATH
- 全局变量初始化
- ISR 帧偏移
- sizeof 数组支持
- 函数调用 bank 失效
- uint16_t 编译错误
- 比较运算操作数顺序

### VM 语义验证测试 (test_semantic.js)
- 左移正确性（0x03<<1=0x06, 0x80<<1=0x00, 0x03<<2=0x0C, 0x01<<3=0x08, 0xFF<<1=0xFE）
- 右移正确性（0x06>>1=0x03, 0x81>>1=0x40, 0x0C>>2=0x03）
- 乘以2正确性（5*2=10, 128*2=0）
- 除以2正确性（10/2=5, 11/2=5）
- 减法正确性（10-3=7, 10-=3=7, 10-=b=7, 3-10=0xF9）
- 一元负号正确性（-(1)=0xFF, -(0)=0）
- 全局变量初始化（x=42→42, x=255→255）
- 加法正确性（10+20=30, 10+=20=30）
- 位运算正确性（&=, |=, ^=）
- 比较运算正确性（<, >, <=, >=, ==, !=）
- 自增/自减（5++=6, 5--=4）
- 除法/取模（10/3=3, 10%3=1）
- 局部变量初始化（a=10,b=3,c=a+b=13）
- if/else 正确性（if(1)/if(0)）
- while/for 循环正确性（sum 1+2+3=6）
- 函数调用正确性（add(3,4)=7）
- 数组读写正确性（arr[2]=42, x=arr[2]）
- 嵌套 if 正确性
- 局部数组正确性
- 逻辑运算符正确性（&&, ||, !）
- do-while循环正确性
- 移位/算术复合赋值（<<=, >>=, *=, /=, %=）
- 前缀/后缀自增自减（a++ vs ++a, a-- vs --a）
- 三元运算符（?:）
- 动态数组索引（arr[i] = val, c = arr[i]）
- break/continue语句
- 变量比较（a < b, a > b）
- switch语句（case匹配、default、fall-through）
- 嵌套函数调用（add(3, add(4,5))）
- 逗号表达式（c = (a=5, b=10, a+b)）
- 赋值表达式作为值（c = (a = 5), c = (a += 5)）
- 全局数组初始化（arr[5]={1,2,3,4,5}）
- return表达式类型（return a++, return (a=5), return x?1:0）
- 短路求值（a && setB() 不调用 setB 当 a=0）
- 嵌套赋值（a = b = c = 5）
- 复合表达式（(a+1)*b, ++a + ++b, a++ + b）
- 函数参数表达式（add(3+4, 5+6)）
- for循环变量声明（for(unsigned char i=0; ...)）
- 参数不足报错
- 递归检测
- 多变量声明
- 常量折叠（全局初始化常量表达式、负数常量、位运算常量）
- 负数常量运算（a - (-1), a + (-1)）
- 变量移位次数（a << b, a >>= b）
- void函数返回值检查
- 字符字面量（'A', '0'）

### Bug 45: void函数允许返回值

**位置**: emitReturnStatement

**问题**: `void foo() { return 5; }` 不报错，void函数不应返回值
**修复**: 在emitReturnStatement中添加检查，当函数返回类型为void且有返回值时抛出错误

**VM验证**: ✅ `void foo() { return 5; }` 抛出错误 ✅ `void foo() { return; }` 正常工作

### Bug 46: char_literal未在emitLoadAccumulator中处理

**位置**: emitLoadAccumulator

**问题**: `c = 'A'` 生成了 `LD V_C,A` 但没有先加载字符值到ACC，因为char_literal只在getConstantValue中处理，未在emitLoadAccumulator中处理
**修复**: 在emitLoadAccumulator中添加char_literal处理，生成 `LDIA 0x41` 指令

**VM验证**: ✅ `c = 'A'` → c = 65 ✅ `c = '0'` → c = 48

### Bug 47: 嵌套逻辑运算缺少加载操作数（误报）

**位置**: emitCondition / emitLogicalOp

**问题**: 最初怀疑 `a && b && c` 生成的汇编代码中缺少 `LD A,V_C` 指令
**实际原因**: webpack 打包的 `dist/bundle.js` 和 tsc 编译的 `dist/cc.js` 不同步，测试使用的是旧的 `dist/cc.js`，导致看到的问题实际是旧代码的问题
**验证**: 使用 tsc 重新编译后，所有嵌套逻辑运算测试均通过

**VM验证**: ✅ `a && b && c` 所有组合正确 ✅ `a || b || c` 所有组合正确 ✅ 混合嵌套 `(a || b) && c` 正确

### Bug 48: 动态数组索引使用 & 0x7F 掩码导致 bank 1 地址错误

**位置**: emitArrayStore, emitArrayLoad

**问题**: 当数组分配在 bank 1（RAM 地址 0xA0-0xEF）时，动态索引计算 FSR 地址使用了 `arraySym.ramAddr & 0x7F`，这会丢失 bank 1 的地址信息
- 例: 数组 `arr` 在 0xA0，`0xA0 & 0x7F = 0x20`，FSR 被设置为 0x20 + index，实际应该为 0xA0 + index
- SC8P053 的 FSR 是 8 位寄存器，bit7 用于间接寻址时选择 bank（IRP=0 时），所以 FSR 可以直接使用 0xA0-0xFF 地址范围

**修复**: 将 `& 0x7F` 改为 `& 0xFF`，保留完整的 8 位地址
- emitArrayStore: `LDIA 0x${(arraySym.ramAddr & 0xFF)...}`
- emitArrayLoad: `LDIA 0x${(arraySym.ramAddr & 0xFF)...}`

**VM验证**: ✅ bank1 arr[i] store and load ✅ bank1 arr[i] with i=0 ✅ bank1 arr[i] with i=4 ✅ bank1 arr[i] modify then read ✅ bank1 arr[i] with loop

### Bug 49: 函数部分路径缺少RET指令

**位置**: emitFunction (函数末尾RET生成逻辑)

**问题**: `hasEarlyReturn` 标志在函数中有任何 `return` 语句时被设为 true，导致函数末尾的 `RET` 指令被跳过。但如果 return 语句只在条件分支中（如 `if (x > 10) return 1;`），当条件不满足时执行会"掉入"下一个函数
- 例: `unsigned char foo(unsigned char x) { if (x > 10) return 1; }` — 当 x <= 10 时，没有 RET 指令，执行会掉入 main

**修复**: 始终在函数末尾添加 `RET` 指令，无论是否有早期 return。末尾的 RET 即使不可达也不会造成问题（只是死代码），但缺少 RET 会导致严重的运行时错误

**VM验证**: ✅ partial return: x > 10 returns 1, else falls through ✅ partial return: x > 10 returns 1 ✅ partial return: early return in if-else

### Bug 50: 除以0导致死循环

**位置**: emitDivide, emitModulo

**问题**: 除法/取模运算没有检查除数为0的情况
- 常量除以0（如 `10 / 0`）：编译器生成的循环代码中，`SUBA` 永远不会产生借位，导致无限循环
- 运行时除以0（如 `a / b` 当 b=0）：同样会导致无限循环

**修复**:
1. 常量除以0：编译时抛出 `Division by zero` 错误
2. 运行时除以0：在除法/取模循环前添加除数零检查，如果除数为0则跳过循环
3. 除以1优化：当常量除数为1时，直接返回被除数，无需生成循环代码

**VM验证**: ✅ constant divide by 0 ✅ constant modulo by 0 ✅ runtime divide by variable 0 returns 0 ✅ runtime modulo by variable 0 returns original ✅ divide by 1 optimization ✅ divide by 2 still works ✅ divide by 3 still works ✅ modulo still works

### Bug 51: 全局数组初始化缺少第一个元素的LDIA指令

**位置**: emitGlobalArrayInit

**问题**: 全局数组初始化时，第一个元素的 LDIA 指令缺失，导致第一个元素未被正确初始化

**修复**: 修正初始化列表的遍历逻辑，确保所有元素都生成 LDIA + LD 指令对

**VM验证**: ✅ global array init sum

### Bug 52: emitOutput中PCLATH EQU未加入headerLines且有死代码

**位置**: emitOutput

**问题**: PCLATH EQU 定义未加入 headerLines，导致输出顺序不正确；存在无法到达的死代码

**修复**: 将 PCLATH EQU 添加到 headerLines，移除死代码

**VM验证**: ✅ all existing tests pass

### Bug 53: 局部数组初始化未处理

**位置**: emitDeclarationInit

**问题**: 局部数组声明如 `unsigned char arr[3] = {1, 2, 3}` 未生成初始化代码

**修复**: 在 emitDeclarationInit 中添加 initializer_list 处理，遍历初始化列表逐个写入数组元素

**VM验证**: ✅ local array init ✅ local array init with expressions

### Bug 54: 全局数组初始化不支持char_literal

**位置**: getConstantValue

**问题**: `unsigned char arr[3] = {'A', 'B', 'C'}` 中字符字面量未被 getConstantValue 识别

**修复**: 增强 getConstantValue 支持 char_literal 类型节点

**VM验证**: ✅ global array char init

### Bug 55: ISR函数允许返回值

**位置**: emitReturnStatement

**问题**: ISR（中断服务）函数声明为非 void 类型时，return 语句带返回值不会报错。ISR 函数不应返回值，应使用 RETI 而非 RET

**修复**: 在 emitReturnStatement 中添加 ISR 函数返回值检查，如果 ISR 函数尝试返回值则抛出错误

**VM验证**: ✅ ISR void compiles ✅ ISR with return value correctly errors

### Bug 56: 数组大小声明不支持常量表达式

**位置**: parseDeclarator

**问题**: `unsigned char arr[2+3]` 中，`parseInt(sizeNode.text, 10)` 只能解析纯数字，遇到 `2+3` 这样的常量表达式时只解析到 `2`，导致数组大小错误
**影响**: `arr[2+3]` 实际只分配 2 个元素的空间，访问 arr[4] 会越界
**修复**: 使用 `getConstantValue` 解析数组大小，支持常量表达式折叠

**VM验证**: ✅ arr[2+3] 分配5个元素, arr[0]=10, arr[4]=50

### Bug 57: switch 语句中 continue_statement 被忽略

**位置**: emitSwitchStatement

**问题**: switch case 内的 `continue` 语句未被识别为可执行语句类型，导致 continue 不生成任何代码
**影响**: for 循环内 switch 中的 `continue` 不跳转到循环更新表达式，而是 fall-through 到下一个 case
**修复**: 在 switch case 的语句类型检查中添加 `continue_statement`

**VM验证**: ✅ switch+continue: for(i=0;i<5;i++){switch(i){case 2:continue;default:s+=i;}} → s=0+1+3+4=8

### Bug 58: signed char 比较运算使用无符号减法标志

**位置**: emitComparisonGeneric, emitComparisonFlags

**问题**: `<`, `>`, `<=`, `>=` 比较运算始终使用无符号减法的 Carry 标志判断大小关系，不区分 signed/unsigned 类型
**影响**: `signed char x = -5; if (x < 0)` 判断为假（因为 0xFB - 0x00 无符号不借位，Carry=1）
**根因**: SC8P053 的 HSUBIA/SUBA 减法只设置无符号 Carry 标志，负数（0x80-0xFF）在无符号比较中大于 0
**修复**: 
1. 添加 `inferExprType` 方法推断表达式类型（i8/u8）
2. 添加 `emitSignedComparison` 方法，使用 XOR 0x80 技巧将有符号比较转换为无符号比较
3. 在 `emitComparisonGeneric` 中检测操作数类型，若任一为 i8 则调用有符号比较路径

**原理**: XOR 0x80 翻转最高位，将负数映射到 0x00-0x7F、正数映射到 0x80-0xFF，使有符号序对应无符号序
- 例: -5 (0xFB) XOR 0x80 = 0x7B (123), 0 (0x00) XOR 0x80 = 0x80 (128), 123 < 128 ✓

**VM验证**: ✅ -5<0=1, -5<3=1, -3>-5=1, -128<127=1, 127>-128=1, signed for循环i=-3到3求和=0

### Bug 59: SZB/SNZB 对临时变量使用数字索引而非符号名

**位置**: emitShiftRight, emitShiftAssign, emitSignedDivide, emitSignedModulo

**问题**: `allocTemp()` 返回数字索引（如 0），`emitLdAToTemp` 等辅助方法内部会调用 `tempName(idx)` 转换为 `V_MAIN_T0` 等符号名。但内联的 `SNZB ${t0},7` 直接使用数字 0，生成 `SNZB 0,7` 而非 `SNZB V_MAIN_T0,7`，导致测试的是 RAM 地址 0（INDF）而非临时变量
**影响**: 所有涉及临时变量 bit 测试的代码（signed 右移、signed 除法/取模的符号判断）都测试了错误的地址
**修复**: 添加 `emitTestBitTemp` 辅助方法，内部调用 `tempName(idx)` 和 `ensureBank`，替换所有内联的 SZB/SNZB temp 变量用法

**VM验证**: ✅ -8>>1=252, -8>>2=254, -1>>1=255, -10/3=253, -10%3=255, -128/2=192, -1/2=0, -1%2=255

### Bug 60: SZB/SNZB 逻辑反转——正数路径和负数路径标签互换

**位置**: emitShiftRight, emitShiftAssign, emitSignedDivide, emitSignedModulo

**问题**: `SZB f,7` 在 bit7=0（正数）时跳过下一条指令。代码意图是正数时跳过取反/跳到正数路径，但使用 SZB 时 bit7=0（正数）会跳过紧随的 JP，导致正数进入负数路径。应使用 `SNZB f,7`（bit7=1 时跳过），使负数时跳过 JP 进入负数路径
**影响**: signed 右移对正数执行算术右移（SETB STATUS,0），对负数执行逻辑右移（CLRB STATUS,0）；signed 除法/取模对正数取反、对负数不取反
**修复**: 所有判断符号位的 SZB 改为 SNZB

**VM验证**: ✅ 10>>1=5, -8>>1=252, 10/3=3, -10/3=253

### Bug 61: signed 除法 /2 优化错误——算术右移 ≠ 有符号除以2

**位置**: emitSignedDivide

**问题**: `rightConst === 2` 时使用算术右移作为有符号除以2的优化。但算术右移和有符号除以2对负数行为不同：`-1 >> 1 = -1`（算术右移保留符号位），但 `-1 / 2 = 0`（向零截断）
**影响**: `-1 / 2` 返回 -1（0xFF）而非 0
**修复**: 移除 `rightConst === 2` 的算术右移优化，统一使用通用有符号除法路径

**VM验证**: ✅ -1/2=0, -128/2=192, 10/2=5

### Bug 62: emitArrayCompoundAssign 中 signed 数组元素的 >>=, /=, %= 使用 unsigned 算法

**位置**: emitArrayCompoundAssign

**问题**: `emitArrayCompoundAssign` 中 `>>=` 对 signed 数组元素使用逻辑右移（CLRB STATUS,0），`/=` 和 `%=` 对 signed 数组元素使用无符号除法/取模算法，未检查 `arraySym.type === 'i8'`
**影响**: `signed char arr[2]; arr[0] = -8; arr[0] >>= 1;` 得到 124（逻辑右移）而非 252（算术右移）；`arr[0] = -10; arr[0] /= 3;` 得到 82（无符号除法）而非 253（有符号除法）
**修复**: 添加 `isSigned = arraySym.type === 'i8'` 标志，对 `>>=` 添加 signed 算术右移逻辑（与 `emitShiftAssign` 一致），对 `/=` 和 `%=` 使用 `emitSignedDivide`/`emitSignedModulo`

**VM验证**: ✅ -8>>1=252, -32>>2=224, -10/3=253, -10%3=255, 10>>1=5, 10/3=3

### Bug 63: emitArrayCompoundAssign 中动态移位循环使用无条件跳转导致无限循环

**位置**: emitArrayCompoundAssign, `<<=`/`>>=` 的变量移位量路径

**问题**: 循环体末尾使用 `JP loopLabel`（无条件跳转回循环体），而非条件跳转。当移位计数器减到 0 时，循环不会退出，继续执行移位直到计数器下溢（0→255→254→...），导致结果被过度移位变成 0
**影响**: `arr[i] >>= 1`（i 为变量）结果为 0 而非正确的右移值；`arr[i] <<= 1` 同理
**修复**: 将 `JP loopLabel` 改为 `SNZB STATUS,2` + `JP loopLabel`（当计数器不为0时才跳回循环体），与 `emitShiftAssign` 中的正确实现一致

**VM验证**: ✅ arr[i]>>=1 (i=0, arr[0]=-8) → 252; unsigned arr[i]>>=1 → 4

### Bug 64: inferExprType 缺少 update_expression, assignment_expression, conditional_expression 的类型推断

**位置**: inferExprType

**问题**: `inferExprType` 方法只处理了 identifier, number_literal, unary_expression, binary_expression, subscript_expression, call_expression, cast_expression，缺少 `update_expression`（++x, x--）、`assignment_expression`（x = y）和 `conditional_expression`（x ? y : z）的类型推断
**影响**: 当这些表达式作为除法/取模/右移的左操作数时，`inferExprType` 返回默认的 `'u8'`，导致 signed 表达式被当作 unsigned 处理
**修复**: 添加三种表达式类型的推断：update_expression 和 assignment_expression 返回操作数的类型，conditional_expression 返回 consequence 分支的类型

**VM验证**: ✅ 已有测试全部通过（258/258 + 40/40）

---

## P1 - 指针操作 Bug（新发现）

### Bug 65: pointer_declarator 解析错误导致指针变量名包含 * 号

**位置**: parseDeclarator

**问题**: `unsigned char *ptr` 被 tree-sitter 解析为 `pointer_declarator` 节点，但 `parseDeclarator` 没有处理此类型，直接使用 `node.text.trim()` 返回 `*ptr` 作为变量名，导致符号表中变量名为 `*ptr` 而非 `ptr`
**影响**: 
- 生成的汇编标签为 `V_MAIN__PTR`（含前导下划线对应 * 号）
- `resolveSymbol` 无法用 `ptr` 找到符号
- 指针初始化赋值 `*ptr = &x` 时 `emitLdAToSym` 找不到符号，不生成存储指令

**修复**: 在 `parseDeclarator` 中添加 `pointer_declarator` 类型处理，提取 `identifier` 子节点作为变量名

**VM验证**: ✅ ptr 变量名正确为 `V_MAIN_PTR`，初始化赋值正常

### Bug 66: &（取地址）运算符未实现

**位置**: emitLoadAccumulator, pointer_expression 分支

**问题**: tree-sitter 将 `&x` 解析为 `pointer_expression` 节点（而非 `unary_expression`），但 `emitLoadAccumulator` 中的 `pointer_expression` 处理只检查了地址宏（`extractAddr`），没有处理 `&` 运算符
**影响**: `unsigned char *ptr = &x;` 和 `ptr = &x;` 不生成取地址代码，ptr 得到未定义值

**修复**: 在 `emitLoadAccumulator` 的 `pointer_expression` 分支中，当 `extractAddr` 返回 null 时，检查操作符：
- `&`: 用 `resolveSymbol` 查找变量，生成 `LDIA 0xNN`（变量地址）
- `*`: 递归 `emitLoadAccumulator` 加载指针值到 ACC，然后 `LD FSR,A; LD A,INDF` 间接读取

**VM验证**: ✅ ptr = &x → ptr 存储了 x 的 RAM 地址

### Bug 67: *（解引用）运算符在表达式中未实现

**位置**: emitLoadAccumulator, pointer_expression 分支

**问题**: tree-sitter 将 `*ptr` 解析为 `pointer_expression` 节点，但 `emitLoadAccumulator` 没有处理 `*` 解引用操作
**影响**: `unsigned char y = *ptr;` 不生成间接读取代码，y 得到未定义值

**修复**: 同 Bug 66，在 `pointer_expression` 分支中添加 `*` 操作符处理，使用 FSR/INDF 间接寻址

**VM验证**: ✅ y = *ptr → y 正确读取 ptr 指向地址的值

### Bug 68: *ptr = val（解引用赋值）未实现

**位置**: emitAssignment, pointer_expression 分支

**问题**: `*ptr = 99` 的左值是 `pointer_expression` 类型，但 `emitAssignment` 中的 `pointer_expression` 处理只检查了地址宏（`extractAddr`），没有处理变量指针的解引用赋值
**影响**: `*ptr = 99;` 不生成间接写入代码，目标变量值不变

**修复**: 在 `emitAssignment` 的 `pointer_expression` 分支中，当 `extractAddr` 返回 null 时，检查操作符为 `*`，生成：
1. `emitLoadAccumulator(argNode)` → 加载指针值到 ACC
2. `LD FSR,A` → 设置间接地址
3. `emitLoadAccumulator(right)` → 加载要写入的值
4. `LD INDF,A` → 间接写入

**VM验证**: ✅ *ptr = 99 → ptr 指向的变量被正确修改为 99

### Bug 69: resolveSymbol 不识别 pointer_declarator 节点

**位置**: resolveSymbol

**问题**: `resolveSymbol` 使用 `node.text.trim()` 获取变量名，但 `pointer_declarator` 节点的文本是 `*ptr`，导致查找符号表时用 `*ptr` 而非 `ptr`，找不到对应符号
**影响**: 在 `emitDeclarationInit` 中，`resolveSymbol(declNode)` 对指针声明返回 null，导致初始化赋值时 `emitLdAToSym` 不执行

**修复**: 在 `resolveSymbol` 中添加 `pointer_declarator` 类型处理，提取 `identifier` 子节点作为变量名

**VM验证**: ✅ 指针变量初始化 `unsigned char *ptr = &x` 正确生成 `LDIA addr; LD V_MAIN_PTR,A`

### Bug 70: 间接寻址受 Bank 选择位影响导致 SFR 访问失败

**位置**: `emitLoadAccumulator`，`*` 运算符处理分支

**问题**: 当使用间接寻址（FSR + INDF）访问指针指向的地址时，没有强制切换到 Bank0。SC8P053 的间接寻址受 STATUS 寄存器的 RP0/RP1 位影响，当 RP0=1（Bank1）且 FSR 指向 SFR 地址（0x00-0x1F）时，实际访问的是 Bank1 的对应地址（如 0x86）而非 SFR（0x06）。

**影响**: `unsigned char *ptr = (u8 *)0x06; unsigned char x = *ptr;` 读取的是地址 0x86 的值而非 PORTB（0x06）的值

**修复**: 在所有使用间接寻址的地方（`*ptr`、`*ptr++`、`*++ptr`、`*ptr--`、`*--ptr`），在执行 `LD FSR,A` 前添加 `CLRB STATUS,5` 指令，确保 Bank0 被选中。

**原理**: SFR 地址（0x00-0x1F）只在 Bank0 中存在，通用 RAM（0x20-0x7F）在两个 Bank 中是相同的，因此强制切换到 Bank0 可以确保正确访问所有地址。

**VM验证**: ✅ `unsigned char *ptr = (u8 *)0x06; *ptr` 正确读取 PORTB 的值

### Bug 71: cast_expression 处理混淆了地址加载和内容读取

**位置**: `emitLoadAccumulator`，`pointer_expression` 和 `cast_expression` 分支

**问题**: 当初始化指针变量时（如 `unsigned char *ptr = (u8 *)0x06`），错误地生成了 `LD A,0x06`（读取地址 0x06 的内容），而应该生成 `LDIA 0x06`（加载地址值本身）。

**区分**:
- `*(u8 *)0xXX`（常量地址解引用）：需要读取该地址的内容，使用 `LD A,0xXX`
- `(u8 *)0xXX`（类型转换表达式作为指针值）：需要加载地址值本身，使用 `LDIA 0xXX`

**修复**: 
1. 在 `pointer_expression` 分支中处理常量地址解引用：使用 `LD A,0xXX` 读取内容
2. 在 `cast_expression` 分支中处理指针初始化：使用 `LDIA 0xXX` 加载地址值

**VM验证**: ✅ `unsigned char *ptr = (u8 *)0x06` 正确存储地址 0x06 到 ptr

---

### 修复记录（指针相关）

- [x] Bug 65: parseDeclarator 添加 pointer_declarator 处理
- [x] Bug 66: emitLoadAccumulator 添加 & 运算符处理
- [x] Bug 67: emitLoadAccumulator 添加 * 运算符处理（FSR/INDF 间接寻址）
- [x] Bug 68: emitAssignment 添加 *ptr=val 解引用赋值处理
- [x] Bug 69: resolveSymbol 添加 pointer_declarator 处理
- [x] Bug 70: 间接寻址前强制切换到 Bank0（SFR 地址访问）
- [x] Bug 71: 区分 cast_expression 和 pointer_expression 的处理

**测试覆盖**: 9 个指针测试用例（cc-test.js），316/316 全部通过

---

### Bug 72: &arr[variable] 生成无效汇编指令

**位置**: emitLoadAccumulator 中 & 运算符处理

**问题**: `&arr[i]`（i 为变量）时，先 LDIA 加载基地址到 A，再 emitLoadAccumulator 加载索引覆盖了 A，最后 `ADDA` 缺少操作数

**根因**: 操作数顺序错误——先加载了基地址到 A，但随后 emitLoadAccumulator(indexNode) 覆盖了 A 中的基地址值；且 `ADDA` 指令缺少操作数

**修复**: 先加载索引到临时变量，再 LDIA 基地址，最后 ADDA 临时变量

**VM验证**: ✅ `unsigned char i = 2; unsigned char *p = &arr[i]; *p` 正确读取 arr[2]

### Bug 73: *ptr += val 复合赋值被静默忽略

**位置**: emitAssignment 中 compound assignment 分支

**问题**: `*ptr += val` 等复合赋值操作完全没有处理——当 innerLeft 是 pointer_expression 或 unary_expression(*ptr) 时，代码直接 fallthrough 到 resolveSymbol，返回 null，操作被静默忽略

**根因**: emitAssignment 的复合赋值分支只处理了 subscript_expression 和普通变量，缺少 pointer_expression 和 unary_expression(*ptr) 的处理

**修复**: 添加 emitPointerCompoundAssign 和 emitPointerCompoundAssignUnary 方法，支持 +=, -=, &=, |=, ^=, <<=, >>=, *=, /=, %=

**VM验证**: ✅ `*p += 10` (5→15), `*p -= 7` (20→13), `*p |= 0x10` (0x05→0x15), `*p &= 0x0F` (0xFF→0x0F), `*p ^= 0x0F` (0xFF→0xF0)

### Bug 74-77: 多处 LD FSR,A 前缺少 CLRB STATUS,5

**位置**: emitAssignment, emitUpdateExpression, emitUnaryExpression, emitArrayStore, emitArrayCompoundAssign, emitArrayLoad

**问题**: FSR/INDF 间接寻址要求 Bank0，但多处代码直接 `LD FSR,A` 前未切换 Bank，导致 Bank1 时访问错误地址

**根因**: 补丁式修复——只在 emitLoadAccumulator 的 *ptr 读取路径添加了 `CLRB STATUS,5`，其他所有使用 FSR/INDF 的路径都遗漏了

**修复**: 添加 emitIndirectRead/emitIndirectWrite/emitIndirectSetFSR 辅助方法，统一包含 Bank 切换逻辑，替换所有手动 FSR/INDF 操作

**VM验证**: ✅ 所有 332 个测试通过，包括 22 个指针测试

### Bug 78: emitAssignmentAsValue 中 *ptr=val 作为值未处理

**位置**: emitAssignmentAsValue

**问题**: `y = (*ptr = 42)` 中，*ptr = 42 作为表达式值时，emitAssignmentAsValue 只处理了 subscript_expression 和普通变量，pointer_expression/unary_expression(*ptr) 被当作普通变量处理，resolveSymbol 返回 null，赋值被忽略

**修复**: 在 emitAssignmentAsValue 的 = 和 compound 分支中添加 pointer_expression 和 unary_expression(*ptr) 的处理

**VM验证**: ✅ `unsigned char y = (*p = 42)` 正确设置 x=42 且 y=42

---

### Bug 79: (*p)++ / ++(*p) / ++*p 解引用递增递减完全失效

**位置**: emitUpdateExpression 中 isPrefix 判断和 parenthesized_expression 处理

**问题**: 
1. `isPrefix` 使用 `node.child(0)!.type !== 'identifier'` 判断，但 `(*p)++` 的 child(0) 是 `parenthesized_expression`，导致后缀被误判为前缀
2. `(*p)++` 的 argument 是 `parenthesized_expression(pointer_expression)`，之前代码没有 unwrap 括号，导致 `pointer_expression` 分支不匹配
3. `++*p` 的 argument 是 `pointer_expression`（无括号），`isPrefix=true`，但代码走的是指针递增分支（`*p++`），而不是值递增分支

**根因**: 
- `isPrefix` 应基于 operator 和 argument 的位置关系判断，而非 child(0) 的类型
- `(*p)++`（值递增）和 `*p++`（指针递增）的区分：当 `isParenWrapped || isPrefix` 时为值递增，否则为指针递增

**修复**: 
1. `isPrefix` 改为 `operator.startPosition.column < argument.startPosition.column`
2. 添加 `isParenWrapped` 检测和 `isDerefValue = isParenWrapped || isPrefix` 判断
3. `isDerefValue=true` 时递增/递减指针指向的值（通过 FSR/INDF），`isDerefValue=false` 时递增/递减指针本身

**VM验证**: ✅ `(*p)++` x=6, `(*p)--` x=4, `++(*p)` v=6, `(*p)++` as value v=5, `++*p` x=6, `--*p` x=4

---

### Bug 80: *a = *b 时 FSR 被右值解引用覆盖

**位置**: emitAssignment 和 emitAssignmentAsValue 中 `*ptr = expr` 的处理

**问题**: `*a = *b` 的代码生成顺序是：
1. `emitLoadAccumulator(argNode)` → 加载 a 的地址到 A
2. `emitIndirectSetFSR()` → LD FSR,A（FSR 指向 a）
3. `emitLoadAccumulator(right)` → 加载 *b 的值（会再次设置 FSR 指向 b！）
4. `LD INDF,A` → 写到 FSR 指向的地址（b 而非 a！）

当右值也是指针解引用时，步骤 3 会覆盖步骤 2 设置的 FSR，导致写入目标错误

**修复**: 先加载右值到临时变量，再设置 FSR，最后从临时变量写入 INDF：
1. `emitLoadAccumulator(right)` → 加载右值
2. `emitLdAToTemp(t)` → 保存到临时变量
3. `emitLoadAccumulator(argNode)` → 加载指针地址
4. `emitIndirectSetFSR()` → 设置 FSR
5. `emitLdTempToA(t)` → 恢复右值
6. `LD INDF,A` → 写入正确地址

**VM验证**: ✅ swap(&x, &y) 正确交换 x=7, y=3

---

### Bug 81: *p <<= variable / *p >>= variable 移位循环少执行一次
**位置**: emitPointerCompoundAssign 中 `<<=`/`>>=` 变量版本的循环结构
**问题**: 指针版本的移位循环使用"递减-检查-移位"结构，当 t1=2 时：
1. t1=2→1，Z=0，继续，移位1次
2. t1=1→0，Z=1，退出（不移位）
结果只移位1次而非2次，`3 << 2` 得到 6 而非 12

**根因**: 循环结构错误——先递减再检查导致最后一次移位被跳过。普通变量版本使用"检查-移位-递减-检查"结构是正确的

**修复**: 将指针版本的循环改为与普通变量版本相同的结构：先检查 t1 是否为 0（`HSUBIA 0x00; SZB STATUS,2; JP done`），然后移位，然后递减（`HSUBIA 0x01; LD t1,A`），然后检查是否继续（`HSUBIA 0x00; SNZB STATUS,2; JP loop`）

### Bug 82: 函数调用参数数量不匹配不报错
**位置**: emitCallExpression
**问题**: 函数调用时传入的参数数量与函数定义不匹配（过多或过少）时，编译器不报错，导致运行时未定义行为
- 传入过多参数：静默忽略多余参数
- 传入过少参数：访问未初始化的参数内存

**根因**: emitCallExpression 只检查 args.length < targetFunc.params.length（参数过少），缺少 args.length > targetFunc.params.length（参数过多）的检查

**修复**: 添加 args.length > targetFunc.params.length 检查，抛出错误 `Function 'xxx' expects N argument(s), but M provided`

**测试覆盖**: error: function called with too many args (Bug 82), error: function called with too few args (Bug 82)

### Bug 83: static 局部变量每次函数调用都重新初始化
**位置**: collectLocalDeclarations, emitDeclarationInit
**问题**: 函数内的 static 局部变量在每次函数调用时都被重新初始化，而非只在程序启动时初始化一次。例如 `static unsigned char n = 0;` 每次调用都重置为 0

**根因**: 
1. collectLocalDeclarations 未识别 `storage_class_specifier` 类型的 static 节点，将其当作变量名处理
2. static 变量被分配在函数栈帧中（frameOffset），而非全局 RAM
3. emitDeclarationInit 每次进入函数都执行初始化代码

**修复**: 
1. 在 collectLocalDeclarations 中检测 `storage_class_specifier` 节点，设置 isStatic 标志
2. static 变量使用 allocRam 分配全局 RAM 地址，frameOffset 设为 -1
3. static 变量的初始值添加到 globalInits，只初始化一次
4. emitDeclarationInit 跳过 static 变量的运行时初始化
5. Sym 接口添加 isStatic 字段

**测试覆盖**: static variable persists across calls (Bug 83), static variable with non-zero init (Bug 83)

### Bug 84: void 函数作为值使用不报错
**位置**: emitCallExpression
**问题**: 将 void 返回类型的函数调用结果赋值给变量时，编译器不报错，导致变量值未定义

**根因**: emitCallExpression 不检查函数返回类型是否为 void。当 void 函数被用在赋值表达式右侧时，ACC 中的值是未定义的

**修复**: 
1. emitCallExpression 添加 usedAsValue 参数
2. 当 usedAsValue=true 且目标函数 returnType='void' 时抛出错误
3. emitLoadAccumulator 中调用 emitCallExpression 时传入 usedAsValue=true

**测试覆盖**: error: void function used as value (Bug 84)

### Bug 85: 重复函数定义不报错
**位置**: processFunction (this.fns.set)
**问题**: 同名函数被定义两次时，编译器不报错，后定义的函数覆盖前定义的函数

**根因**: processFunction 在设置 this.fns 之前不检查函数名是否已存在

**修复**: 在 this.fns.set(funcName, funcInfo) 之前添加 this.fns.has(funcName) 检查，若已存在则抛出 `Function 'xxx' is already defined`

**测试覆盖**: error: duplicate function definition (Bug 85)

### Bug 86: 重复全局变量定义不报错
**位置**: processGlobalDeclaration
**问题**: 同名全局变量被定义两次时，编译器不报错，可能导致 RAM 地址冲突

**根因**: processGlobalDeclaration 在设置 this.globalSymbols 之前不检查变量名是否已存在

**修复**: 在 this.globalSymbols.set 之前添加 this.globalSymbols.has(name) 检查，若已存在则抛出 `Global variable 'xxx' is already defined`

**测试覆盖**: error: duplicate global variable (Bug 86)

### Bug 87: 使用未声明的变量/函数给出不友好的错误信息
**位置**: emitLoadAccumulator (identifier), emitCallExpression
**问题**: 使用未声明的变量时，报错 "Cannot resolve operand" 而非 "Variable 'xxx' is not defined"；调用未声明的函数时，编译器静默通过（如果函数不存在于 this.fns 中）

**根因**: 
1. resolveSymbol 返回 null 时，emitLoadAccumulator 不检查是否是函数名就直接跳过
2. emitCallExpression 不检查 targetFunc 是否为 null

**修复**: 
1. emitCallExpression 中检查 targetFunc 是否为 null，若为 null 则抛出 `Function 'xxx' is not defined`
2. emitLoadAccumulator 中处理 identifier 时，若 resolveSymbol 返回 null 且不是函数名，抛出 `Variable 'xxx' is not defined`

**测试覆盖**: error: undeclared variable (Bug 87), error: undeclared function (Bug 87)

### 修复记录（指针相关 - 第二轮）

- [x] Bug 72: &arr[variable] 修正操作数顺序和 ADDA 缺少操作数
- [x] Bug 73: 添加 emitPointerCompoundAssign/emitPointerCompoundAssignUnary 处理 *ptr += val
- [x] Bug 74-77: 添加 emitIndirectRead/emitIndirectSetFSR 辅助方法，统一 Bank 切换
- [x] Bug 78: emitAssignmentAsValue 添加 pointer_expression/unary_expression(*ptr) 处理
- [x] Bug 79: 修复 isPrefix 判断逻辑，区分 (*p)++ 值递增和 *p++ 指针递增
- [x] Bug 80: 修复 *a=*b 时 FSR 被右值解引用覆盖，先存右值到临时变量再设 FSR
- [x] Bug 81: 修复 *p<<=var / *p>>=var 移位循环结构，与普通变量版本一致

### 修复记录（语义错误检测 - 第三轮）

- [x] Bug 82: 函数调用参数数量不匹配报错
- [x] Bug 83: static 局部变量正确初始化和持久化
- [x] Bug 84: void 函数作为值使用报错
- [x] Bug 85: 重复函数定义报错
- [x] Bug 86: 重复全局变量定义报错
- [x] Bug 87: 未声明变量/函数给出友好错误信息

### Bug 88: 多个 static 变量分配到相同地址
**位置**: allocateCompiledStack
**问题**: 同一函数内的多个 static 变量被分配到相同的 RAM 地址，导致数据覆盖
- 例: `static unsigned char a = 10; static unsigned char b = 20;` 都分配到同一地址

**根因**: 
1. `allocateCompiledStack` 中遍历 `localSymbols` 时，对所有变量（包括 static）执行 `sym.ramAddr = finfo.frameBase + sym.frameOffset`
2. static 变量的 `frameOffset` 为 -1，导致 `frameBase + (-1)` 覆盖了 `allocRam` 分配的正确地址
3. 多个 static 变量的 frameOffset 都是 -1，所以都被覆盖为同一地址

**修复**: 
1. 在 `allocateCompiledStack` 的循环中跳过 `isStatic` 变量
2. static 变量的 `ramAddr` 已在 `collectLocalDeclarations` 中通过 `allocRam` 正确分配

**测试覆盖**: multiple static variables in function (Bug 88)

### Bug 89: 指针到指针 (unsigned char **) 不支持
**位置**: collectLocalDeclarations, emitDeclarationInit
**问题**: `unsigned char **pp = &p;` 声明编译失败，报错 "Variable 'pp' is not defined"

**根因**: 编译器不支持双指针（指针到指针）声明，解析器无法正确处理 `unsigned char **` 类型

**状态**: 已知限制 - 8 位微控制器上双指针不常用，标记为已知限制

### Bug 90: #if defined() 预处理器不工作
**位置**: evaluateCondition
**问题**: `#if defined(FEATURE)` 在 FEATURE 已定义时返回 false，总是选择 #else 分支

**根因**: 
1. `evaluateCondition` 先调用 `expandLine` 展开宏，再调用 `resolveDefined` 处理 `defined()` 运算符
2. 宏展开后 `FEATURE` 被替换为 `1`，导致 `defined(FEATURE)` 变成 `defined(1)`
3. `defined(1)` 找不到名为 `1` 的宏，返回 0

**修复**: 
1. 调换 `resolveDefined` 和 `expandLine` 的调用顺序
2. 先处理 `defined()` 运算符，再展开剩余宏

**测试覆盖**: preprocessor #if defined() with defined macro (Bug 90), preprocessor #if defined() with undefined macro (Bug 90), preprocessor #if defined without parens (Bug 90)

### 修复记录（深度测试 Round 2 - 第四轮）

- [x] Bug 88: 多个 static 变量地址分配冲突
- [x] Bug 89: 指针到指针不支持（已知限制）
- [x] Bug 90: #if defined() 预处理器修复

### Bug 91: struct/union/enum 类型不被支持但编译器静默通过
**位置**: resolveType
**问题**: `struct Point { unsigned char x; unsigned char y; };` 等复合类型声明编译通过但产生错误代码
- struct 字段访问产生错误结果（如 `p.x + p.y` 返回 40 而非 30）
- union 和 enum 同样静默通过

**根因**: 
1. `resolveType` 方法对所有不认识的类型都默认返回 `'u8'`
2. 没有对 struct/union/enum 类型进行检查和报错
3. 编译器不支持这些复合类型，但也不报错

**修复**: 
1. 在 `resolveType` 中添加 struct/union/enum 类型检查
2. 遇到这些类型时抛出 "not supported on this target" 错误

**测试覆盖**: error: struct type not supported (Bug 91), error: union type not supported (Bug 91), error: enum type not supported (Bug 91)

### Bug 92: float/double 类型不被支持但编译器静默截断
**位置**: resolveType
**问题**: `float x = 3.14;` 编译通过但浮点数被静默截断为整数
- `float x = 10.5;` 变成 `x = 10`
- 浮点运算被当作整数运算处理

**根因**: 
1. `resolveType` 对 float/double 类型返回 `'u8'`
2. 浮点数字面值被 `parseNumber` 截断为整数
3. 没有对浮点类型进行检查和报错

**修复**: 
1. 在 `resolveType` 中添加 float/double 类型检查
2. 遇到浮点类型时抛出 "Floating-point type not supported" 错误

**测试覆盖**: error: float type not supported (Bug 92), error: double type not supported (Bug 92)

### 修复记录（深度测试 Round 3 - 第五轮）

- [x] Bug 91: struct/union/enum 类型不支持报错
- [x] Bug 92: float/double 类型不支持报错

### Bug 93: #elif 长链中后续分支被错误激活
**位置**: Preprocessor.processElif / processElse
**问题**: 当 `#if`/`#elif` 链中有 4 个以上 `#elif` 分支时，已匹配分支之后的 `#elif` 条件仍被评估，可能导致多个分支同时被编译
- 例: `#if X==1 ... #elif X==2 ... #elif X==3 ... #elif X==4 ... #else ...` 当 X=3 时，`#elif X==4` 之后的分支被错误激活
- 导致同一变量在不同分支中重复定义报错："Global variable 'r' is already defined"

**根因**: 
1. `processElif` 使用 `frame.active` 来判断前一个分支是否匹配
2. 当 `frame.active` 为 true 时，设置 `frame.active = false`，但没有记住"已经有分支匹配过"
3. 下一个 `#elif` 到来时，`frame.active` 为 false，会评估条件——如果条件为 true，`frame.active` 又变成 true
4. `processElse` 使用 `!frame.active` 来决定是否激活，也会被错误激活

**修复**: 
1. 在 `CondFrame` 接口中添加 `branchTaken: boolean` 字段
2. `processIf`/`processIfdef` 初始化时设置 `branchTaken = condition`
3. `processElif` 中用 `branchTaken` 代替 `active` 判断：如果已有分支匹配，直接设 `active = false`；否则评估条件，匹配时设置 `branchTaken = true`
4. `processElse` 中用 `!branchTaken` 代替 `!active` 决定是否激活

**测试覆盖**: #elif chain with same variable name (Bug 93), #elif chain hits #else (Bug 93), #elif chain first branch matches (Bug 93)

### 修复记录（深度测试 Round 4 - 第六轮）

- [x] Bug 93: #elif 长链后续分支被错误激活
- [x] Bug 94: 2D 数组不被支持但编译器静默通过

### Bug 94: 多维数组不被支持但编译器静默通过并产生错误结果
**位置**: parseDeclarator
**问题**: `unsigned char m[2][3]` 声明编译通过但只分配了 3 字节（取最后一个维度），访问 `m[0][0]` 产生错误值
- 例: `m[0][0] = 42; unsigned char r = m[0][0];` 结果 r=0 而非 42

**根因**: 
1. `parseDeclarator` 使用 `findNodeByType(node, 'array_declarator')` 查找数组声明
2. tree-sitter 将 `m[2][3]` 解析为嵌套的 `array_declarator`（外层 `m[2][3]`，内层 `m[2]`）
3. `findNodeByType` 找到外层 `array_declarator`，其 `declarator` 是内层 `array_declarator`
4. `nameNode.text` 返回 `m[2]`（而非 `m`），`size` 只取了外层的 `3`
5. 编译器没有检测到嵌套的 `array_declarator`，静默按 1D 数组处理

**修复**: 
1. 在 `parseDeclarator` 中检测 `nameNode.type === 'array_declarator'`
2. 如果检测到嵌套 `array_declarator`，抛出 "Multi-dimensional arrays are not supported" 错误

**测试覆盖**: error: 2D array not supported (Bug 94), error: global 2D array not supported (Bug 94)

### Bug 95: 指针下标语法 p[i] 不支持，报错 "Cannot resolve operand"
**位置**: emitLdArrayElemToA / emitLdAToArrayElem / emitArrayLoad / emitArrayStore
**问题**: 使用 `p[i]` 访问指针变量时报错 "Cannot resolve operand: V_MAIN_P_0"
- 例: `unsigned char *p = arr; unsigned char r = p[1];` 编译失败
- 编译器将 `p` 当作数组处理，尝试生成 `LD A,V_MAIN_P_1`，但指针变量没有 `V_MAIN_P_1` 标签

**根因**: 
1. `resolveArraySymbol` 对 `subscript_expression` 返回符号（无论数组还是指针）
2. `emitLdArrayElemToA` 直接生成 `LD A,${sym.asmName}_${index}`，仅适用于数组
3. `emitLdAToArrayElem` 直接生成 `LD ${sym.asmName}_${index},A`，仅适用于数组
4. `emitArrayLoad` 和 `emitArrayStore` 中非常量索引时使用 `arraySym.ramAddr` 作为基地址，对指针应使用指针的值

**修复**: 
1. `emitLdArrayElemToA`：当 `!sym.isArray` 时，加载指针值到 A，加偏移，通过 FSR/INDF 间接读取
2. `emitLdAToArrayElem`：当 `!sym.isArray` 时，保存值到临时变量，加载指针值到 A，加偏移，设置 FSR，从临时变量加载值，写入 INDF
3. `emitArrayLoad`：非常量索引时，对指针使用 `emitLdSymToA(arraySym)` 获取指针值作为基地址
4. `emitArrayStore`：非常量索引时，对指针使用 `emitLdSymToA(arraySym)` 获取指针值作为基地址

**测试覆盖**: pointer subscript p[0] (Bug 95), pointer subscript p[i] with constant index (Bug 95), pointer subscript p[i] with variable index (Bug 95), pointer subscript write p[i] = value (Bug 95)

### Bug 96: 全局指针不能用 &global_var 或数组名初始化
**位置**: processGlobalDeclaration
**问题**: `unsigned char *gp = &g;` 或 `unsigned char *gp = arr;` 报错 "Global variable 'gp' initializer must be a constant expression"
- 例: `unsigned char g = 10; unsigned char *gp = &g;` 编译失败
- 全局指针无法用另一个全局变量的地址或全局数组名初始化

**根因**: 
1. `processGlobalDeclaration` 中，全局变量初始化只接受 `getConstantValue` 能解析的常量表达式
2. `&g` 是取地址表达式（pointer_expression），`arr` 是数组名（identifier），都不是常量表达式
3. 编译器没有尝试将这些地址表达式解析为全局变量的 RAM 地址

**修复**: 
1. 添加 `getGlobalAddressValue` 方法，解析 `&global_var` 和全局数组名
2. 在 `processGlobalDeclaration` 中，当 `getConstantValue` 返回 null 时，尝试 `getGlobalAddressValue`
3. `getGlobalAddressValue` 支持 `pointer_expression`（`&` 操作符）、`identifier`（数组名）、`cast_expression`（类型转换）

**测试覆盖**: global pointer to global variable (Bug 96), global pointer to global array (Bug 96)

### Bug 97: 中断函数语法从 `void interrupt()` 改为 SDCC 风格 `void isr() __interrupt`

**问题**: 旧语法 `void interrupt()` 使用 C 语言关键字作为函数名，不符合常见单片机编译器惯例。SDCC 使用尾缀 `__interrupt` 标识 ISR 函数，tree-sitter 能正确解析。

**修复**:
1. `processFnSignature` 中内联检测 `function_declarator` 是否有 `__interrupt` 标识符子节点
2. ISR 的 `asmName` 固定为 `__INTERRUPT`，函数名可以是任意合法标识符
3. 旧语法 `void interrupt()` 视为普通函数，不再抛异常

**测试覆盖**: ISR with __interrupt syntax compiles correctly, void interrupt() is a normal function, ISR asm label is __INTERRUPT

**测试覆盖**: 491 个测试用例（cc-test.js），491/491 全部通过
