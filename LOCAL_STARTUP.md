# 本机启动说明

在项目根目录运行 `bash scripts/start-local.sh`；需要重新编译时加 `--build`。
脚本会优先使用本机 IntelliJ 附带的 Java 21、Maven 和 Homebrew Node 22。

- 前端：http://localhost:5173
- 后端健康检查：http://localhost:8080/actuator/health
- API 文档：http://localhost:8080/swagger-ui.html
- 初始账号：`admin` / `admin123`
- MinIO 控制台：http://localhost:19001
- Grafana：http://localhost:13000

本机配置保存在 `.env` 和 `docker/.env`，已排除版本管理。
MinIO 使用 19000/19001，Grafana 使用 13000，以避开本机其他项目。
Docker 覆盖文件复用已有 Redis、MinIO 镜像；MinIO 初始化工具来自同一镜像。
Kafka、Prometheus 和 Grafana 的端口明确绑定到 127.0.0.1；已验证本机访问正常。

聊天模型使用火山方舟 Coding 接口和 `deepseek-v4-flash`，三个聊天档位均已切换。
向量模型使用独立 Qwen 兼容接口的 `qwen3.7-text-embedding`（实测 2048 维），
对应配置项为 `DASHSCOPE_BASE_URL`、`DASHSCOPE_API_KEY`、`AIMS_EMBEDDING_MODEL`。
同一服务中的 `qwen3.7-text-embedding-flash` 实测仅输出 1024 维，不能直接用于本项目。
后提供的方舟 Key 返回 `InvalidSubscription`，当前保留首次提供且实测可用的 Key。
已加入麦克风实时语音接入，使用方法与配置见 [VOICE_SETUP.md](VOICE_SETUP.md)。
原有 HTTP TTS 朗读仍保留独立开关。

修改 `.env` 后需要重启后端进程。运行日志保存在 `logs/`。
