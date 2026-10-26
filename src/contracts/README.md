# 公开契约

五份 TypeScript 文件对应 M1–M5，来源为 documentation/docs/public-interface.md。原方法签名和类型不变；基础类型统一从 shared/data-models 导入，不重复定义、不引入 Vue。

这些文件只有契约声明，不是业务模块实现。后续实现通过 implements 或等价的类型约束遵守接口。
