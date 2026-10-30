# 语音输入检验结果，结构化并以csv格式导出

## 项目介绍

语音输入检验结果，页面实时把语音转成结构化的检验记录，写入本地存储，并支持csv文件导出。

例如：

对麦克风说：

```text
工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏通过，合格。
```

可导出csv文件：

```text
工单,料号,接触电阻,绝缘电阻,耐电压,检验结果
a2301,c-045,12 mΩ,500 MΩ,1500 V
```

## 技术栈

- 前端页面：[Vue](https://cn.vuejs.org/)
- 构建：[TypeScript](https://www.typescriptlang.org), [Vite](https://vitejs.cn/vite3-cn/)
- 语音命令识别：[Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- 语音正文识别：[科大讯飞IAT WebSocket API](https://www.xfyun.cn/doc/asr/voicedictation/API.html)
- 数据管理: [localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- 服务端代理：[Node.js](https://nodejs.org/en)，内置 [SQLite](https://sqlite.org/index.html)

## 模块化设计

- **M1** 监听命令如“开始输入”、“保存“、”删除“，监听语音并转写文本
- **M2** 单次文本解析，并且提取数值，识别单位，结构化数据
- **M3** 当前草稿局部更新，数据完整性校验
- **M4** 储存，查询，和更新正式记录
- **M5** 编写csv文件并导出
- **App** 页面设计，调用M1-M5模块，路由命令

## 数据归属

- **M1** 产生文本（TranscriptSegment），单次消息，不予保存
- **M2** 产生单次结构化数据（ParseResult），单次消息，不予保存
- **M3** 编辑当前草稿数据（DraftFields），产出待保存的正式数据（InspectionRecord），内存维护，不持久化，刷新后丢失
- **M4** 访问正式数据（InspectionRecord[]），持久化储存

## 项目结构

```text
src/
├── App.vue                 页面组合与事件绑定
├── app/                    M1–M5 协调、历史写入锁与错误展示
├── components/             语音、草稿、历史、确认预览等组件
├── contracts/              各模块公开接口
├── shared/                 共享数据模型
├── modules/
│   ├── m1-speech-recognition/  语音处理与转写
│   ├── m2-text-parser/        文本解析与结构化文本
│   ├── m3-draft-manager/      唯一草稿，校验，与确认状态
│   ├── m4-record-manager/     正式记录与本地持久化
│   └── m5-csv-exporter/       CSV 编码与浏览器下载
└── mock/                   UI 测试设施，不连接生产 App
infrastructure/m1-speech-proxy/ 独立语音代理与部署配置
tests/                        测试单元、集成与人工验收工具
```

## 语音识别实现

1. 点击“开始监听”，进入麦克风开始监听
2. Web Speech API 监听“开始输入”的指令，激活科大讯飞API
3. 科大讯飞API就绪后，向麦克风说出检验结果，实时展示转写文本
4. App将转写文本交给 M2 结构化，再将结构化结果交给M3 合并草稿

## 结构化实现

1. 扫描语音转写的文本
2. 识别关键字段建立文本事件“工单”，“料号”，“接触电阻“，”绝缘电阻“，”耐电压“，”检测结果“
3. 每个字段后只允许连接词“是”，“为”，“改成”，“改为”，冒号，及空白。再依据下一字段和标点确认边界。文字字段只接受ASCII字母，数字，连字符，下划线。测量数值要求数字合法，接受阿拉伯非负整数、小数，中文数词避免数字范围；且单位合法，不计项目未录入的单位。无单位按标准单位解释
4. 文字纠正：同一字段出现多次时，后出现的合法候选覆盖前值；后续无效值不会抹掉前值
5. 检验结果格式为`PASS / FAIL`。支持文字字段“结果合格/不合格”，“检测结果合格/不合格”，以及独立的“合格/不合格”

例如文本输入：

```text
工单A2301，料号C-045，接触电阻12毫欧，绝缘电阻500兆欧，耐电压1500伏通过，合格。”
```

得到：

```json
{
  "workOrder": "A2301", // 工单
  "partNumber": "C-045", // 料号
  "contactResistance": 12, //接触电阻（标准单位毫欧）
  "insulationResistance": 500, // 绝缘电阻（标准单位兆欧）
  "withstandVoltage": 1500, // 耐电压 （标准单位伏）
  "result": "PASS" //合格
}
```

后续再说“接触电阻改为三毫欧”，只返回 `{ "contactResistance": 3 }`。M3草稿编辑模块会将该字段覆盖已有的草稿数据，手动编辑也写入统一草稿

M3在请求保存时，检查6个必填字段是否存在以及数值是否合法，确认后生成ID和时间戳，交给M4进行持久化管理

M4持久化成功后，再清空草稿记录。若持久化失败则保留草稿

支持的单位换算示例：
| 字段 | 存储标准单位 | 单位换算 |
| --- | --- | --- |
| 接触电阻 `contactResistance` | mΩ | 毫欧 / mΩ 原值；欧 / Ω × 1000 |
| 绝缘电阻 `insulationResistance` | MΩ | 兆欧 / MΩ 原值；欧 / Ω × 0.000001；中文「千欧」× 0.001 |
| 耐电压 `withstandVoltage` | V | 伏 / V 原值；千伏 / kV × 1000 |

## 浏览器适配

以Chrome为主要使用目标，需用户主动开启浏览器麦克风。

## 断网降级处理

停止在线语音识别，保留已确认文本和已有草稿，继续手动录入。网络恢复后由用户主动重启语音
