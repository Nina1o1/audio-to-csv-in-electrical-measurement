# 麦克风异常验收

## 自动化 Mock 范围

Vitest 无真实麦克风、浏览器权限弹窗或收费服务调用。

- 首次拒绝：原生命令引擎 not-allowed；Promise 拒绝与 onError 一次，保持 IDLE，无自动续接。
- 此前禁止：Permissions API denied；不调用引擎 start；显式重试重新查询，授权后可录入并停止。
- 设备缺失：getUserMedia NotFoundError 或无可用音轨；提示检查连接。
- 访问限制：NotReadableError、SecurityError、AbortError、OverconstrainedError；释放 AudioContext/音轨，分别提供操作提示。
- 环境限制：非安全上下文、缺少 API、网站 Permissions Policy 禁止；不请求采集。
- 查询兼容性：Permissions API 缺失、同步抛错、异步拒绝时回退原生识别。
- 查询期间取消或超时：迟到授权不能重新启动；失败不残留定时器。
- UI：麦克风状态区下方显示原因、操作与重试监听；正常状态隐藏提示。
- 现有集成测试继续覆盖开始输入/结束输入命令、按钮、自然完成、停止、断网与草稿数据流。

运行：`npm test`、`npm run type-check`、`npm run build`。

## 必须人工在真实浏览器验证（尚未执行）

使用实际支持中文 Web Speech API 的浏览器，HTTPS 部署或 localhost；记录浏览器、系统、错误和结果。

1. 重置本站麦克风权限为询问，点击开始监听，在原生弹窗拒绝。检查提示包含“麦克风权限未开启，请在浏览器的网站设置中允许使用麦克风，然后重试。”，状态为 IDLE。
2. 保留禁止权限，再点击重试。检查立即显示提示，无自动重复弹窗、无无限请求。
3. 在浏览器网站设置中手动允许麦克风，回到页面点击重试；检查正常监听。说“开始输入”，等待录入就绪再说质检正文，说“结束输入”；再分别验证两个输入按钮和停止监听。
4. 拔掉或禁用所有麦克风后启动监听/录入；检查设备提示、IDLE 与浏览器采集指示灯熄灭。重新连接后重试成功。
5. 在系统隐私设置禁止浏览器麦克风，或用独占应用占用设备；检查提示引导系统权限/占用检查。各系统可能共用 NotAllowedError，不能据此断言用户点击拒绝。
6. 非 localhost 的 HTTP 页面检查 HTTPS 提示；localhost 正常不被误拒绝。检查无 Web Speech/AudioWorklet 的浏览器给出兼容性提示。
7. 用禁止 microphone 的 Permissions-Policy / iframe 策略验证管理员操作提示（策略查询 API 不支持时浏览器可能仅返回 NotAllowedError）。
8. 断开浏览器语音服务网络、拒绝当前语音服务、以及断开讯飞代理连接，分别检查浏览器服务与讯飞连接提示；不可误报为设备不存在或用户拒绝。
9. 权限弹窗/录音准备期间取消、关闭页面或等待超时，再允许权限；检查迟到资源立即释放，无采集指示灯、残留连接或重复错误。

## 浏览器语义依据

- [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
- [Web Speech API 错误定义](https://webaudio.github.io/web-speech-api/)

Web Speech audio-capture 不提供 NotFoundError/NotReadableError 的细分信息；界面同时引导设备连接、系统权限和占用检查。
网页不打开浏览器设置，也不能修改浏览器权限。
