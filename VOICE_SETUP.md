# 实时语音面试

管理端和候选人面试间都提供「实时语音对话」入口。开始面试后点击「开始语音」，
允许麦克风权限，即可直接回答。服务在停顿后自动提交识别结果；也可使用「发送识别文本」。
AI 播报时开口可以打断，页面另有「打断播报」按钮。

语音识别结果沿用项目现有 WebSocket 问答链路；题目、追问、评分与报告仍由原面试引擎处理。
火山服务的独立 LLM 已关闭，通过 `ExternalTextToSpeech` 播放当前面试题目。
开启实时语音时暂停原有题目音频播放器，避免重复播放。

## 本地配置

在项目根目录 `.env` 配置，下列凭据均只供服务端使用：

```dotenv
AIMS_VOICE_ENABLED=true
VOLC_RTC_APP_ID=你的AI音视频互动应用AppId
VOLC_RTC_APP_KEY=对应AppKey
VOLC_RTC_ACCESS_KEY_ID=具有RTC权限的AccessKeyId
VOLC_RTC_SECRET_ACCESS_KEY=对应SecretAccessKey
VOLC_RTC_BOT_PREFIX=aims_bot
VOLC_RTC_ASR_RESOURCE_ID=volc.bigasr.sauc.duration
VOLC_RTC_TTS_RESOURCE_ID=seed-tts-2.0
VOLC_RTC_SPEAKER=zh_male_m191_uranus_bigtts
```

AppId/AppKey 来自「AI 音视频互动方案 → 应用管理」。AK/SK 需要能够调用
`StartVoiceChat`、`UpdateVoiceChat`、`StopVoiceChat`。应用还需具备所选 ASR/TTS 的使用权限及额度。
模型 Coding Key 与 RTC 签名凭据分别配置。

`VOLC_RTC_BOT_PREFIX` 会加上随机后缀，确保同一应用中的多个面试智能体 ID 唯一。
RoomId、TaskId、候选人 UserId 和 RTC Token 均由后端生成，房间与 Token 的标识保持一致。
浏览器仅接收限于本房间、最长一小时的 Token；服务端 AppKey 与 AK/SK 不下发给浏览器。

修改 `.env` 后重启后端。新建面试时，原有「TTS 语音播报」选项可保持关闭；
实时语音对话使用独立配置。

## 连接生命周期

- 智能体实际入房后，页面才显示「已连接」。启动失败会释放麦克风并尝试停止云端任务。
- 暂停/结束面试、WebSocket 断开、离开页面或手动断开时，客户端停止采集、退出 RTC 房间并请求停止任务。
- 客户端每 15 秒续约。心跳中断 60 秒后，服务端最多再等 15 秒便会尝试停止任务；失败时继续重试。
- 同一面试只能开启一个语音连接。候选人只能操作其 Token 绑定的面试，管理端观察者不能代为开启麦克风。

浏览器使用 `localhost` 或 HTTPS，并允许麦克风及声音播放。麦克风实时媒体由官方 RTC Web SDK 传输。
线上部署还需按 RTC SDK 要求放通网络访问；无需为本实现额外提供公网 LLM 回调地址。

## 验证

前端字幕协议测试：

```sh
cd frontend
node --experimental-strip-types --test tests/rtcProtocol.test.mjs
```

后端测试为 `RtcProtocolTest` 和 `RealtimeVoiceServiceTest`：包含官方 Token/签名测试向量、
任务续约与清理、重复播报去重，以及候选人和观察者权限检查。

本机已通过 10 项后端测试、5 项前端字幕测试、相关文件 ESLint 和前端生产构建。
另用隔离 Chrome 与合成中文音频完成真实服务联调：智能体入房、题目播报请求、手动打断、
ASR 自动提交并保存答案、生成后续问题，以及 `StopVoiceChat` 停止任务。
客户端 ASR 返回累积修订的整句文本，按序号覆盖旧字幕，避免重复拼接。

参考：[RTC 接入说明](https://docs.volcengine.com/docs/real_time_communication/IntegratedAIaudiovideointeractivesolution?lang=zh)、
[实时字幕协议](https://docs.volcengine.com/docs/real-time-communication/real-time-subtitles-conversation-records?lang=zh)、
[UpdateVoiceChat](https://docs.volcengine.com/docs/real_time_communication/UpdateVoiceChat-1?lang=zh)、
[官方 Token 参考实现](https://github.com/volcengine/rtc-aigc-embedded-demo/blob/master/server/src/AccessToken.py)。
