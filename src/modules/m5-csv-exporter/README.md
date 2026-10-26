# M5 CSV 导出

接收 App 指定的正式记录，整批校验后生成 CSV 并发起下载；不选择、查询或持久化记录。

使用 `createCsvExporter()` 创建无状态模块，公开方法遵循 `src/contracts/m5-csv-exporter.ts`。

- `generateCsv(records)`：完整校验非空记录数组及唯一 ID，返回固定八列、CRLF、不带 BOM 的 CSV，不触发下载。CSV 不导出 ID；三个测量单元格附加一个空格及 mΩ、MΩ、V，原始测量字段仍为 number。
- `export(records, options?)`：完整校验后发起下载，默认文件名为 `inspection-records.csv`，默认添加 UTF-8 BOM。返回文件名及记录数，仅表示已发起下载。
- 非法记录整批失败；非法文件名不自动修复。文本先执行公式防护再进行 CSV 转义，原记录保持不变。
- `browser-download.ts` 隔离 DOM、Blob 和 URL 生命周期；成功点击后的下一任务释放资源，失败立即清理已创建资源。

不依赖 Vue，不查询 M4，不访问 localStorage，不管理 UI 或选中状态，不生成记录身份或时间戳。测试使用浏览器边界替身，不增加第三方依赖。
