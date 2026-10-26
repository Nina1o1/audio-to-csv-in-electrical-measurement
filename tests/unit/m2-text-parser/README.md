# M2 文本解析测试

先写测试，再实现对应阶段；通过 Stage A 后进入 Stage B。

- `text-parser.test.ts`：五个核心样例、字段别名、连接形式、标识符、结果词、
  中文数词及省略形式、乱序、最后有效值、受限纠正、非法输入、稀疏结果和调用隔离。
- `units.test.ts`：完整单位词表及换算、无单位默认标准单位、零与小数、
  混合单位、未知/错配单位、大小写、前缀误匹配、溢出保护和纠正组合。

微欧和千欧按现有契约测试为不支持单位，不把候选验收示例作为扩充词表的依据。
测量字段必须是 number，不含 value/unit 子对象；小数换算使用近似比较。

相关测试：`npm test -- tests/unit/m2-text-parser`。
完整回归：`npm run type-check`、`npm test`、`npm run build`。
