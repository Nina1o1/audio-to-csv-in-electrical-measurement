# M1 语音识别测试

运行 `npm test -- tests/unit/m1-speech-recognition`。

- `speech-recognition.test.ts`：真实M1状态机，Mock浏览器语音/音频/WebSocket边界；启动取消、
  超时、订阅隔离、命令、最终结果、错误去重、正文自然完成、命令续接与超过60秒的计划轮换。
- `audio.test.ts`：真实PCM转换，以及Mock浏览器音频图的权限、迟到授权、worklet与资源清理。
- `protocol.test.ts`：JSON校验、序号/动态修正/乱序/去重、命令边界与安全代理路径。
- `proxy.test.ts`：代理鉴权、HMAC、Cookie、限流调用、音频校验、转发和收尾；Mock平台运行时。

全部自动化测试不使用真实麦克风、网络或付费API。真实浏览器、讯飞与云端部署验收另行执行。
