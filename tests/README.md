# 测试目录

`npm test` 使用 Vitest 执行 `tests/**/*.test.ts`；当前为 Node 测试环境，不需要浏览器 DOM 模拟依赖。

- `unit/shared/create-empty-draft.test.ts` 验证空状态和对象隔离。
- `unit/shared/contracts.typecheck.ts` 由 vue-tsc 编译，不运行。正向用例及 @ts-expect-error 反向用例检查单位、空值和接口约束；若错误用例不再报错，类型检查会失败。
- `npm run type-check` 检查源码、测试及配置；Vitest 转译执行不能替代此检查。

业务模块测试、组件测试和 App 集成测试在对应阶段补充。当前没有将空测试或 Mock 结果当作真实模块验证。
