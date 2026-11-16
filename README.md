# opencode

本机 opencode 的项目与会话管理界面。左侧是项目列表，点项目名在下方展开它最近的会话，右侧是项目概览或完整会话记录，可以直接在页面里继续会话，整体为中度灰色主题。

![桌面首页](效果图/桌面首页.png)

## 快速开始

1. 本机已安装并运行 opencode，服务信息在 `~/.local/state/opencode/service.json`。
2. 本机已安装 Python 3 与 Node.js。
3. 项目根目录执行 `./just_run.sh`，依赖安装、前端构建、端口探测与打开页面都由脚本完成。

## 简介

opencode 自身把项目、会话、消息都存在本机服务里。这个界面把这些数据取出来做统一管理，不需要记住目录，也不用翻终端。所有数据都来自本机正在运行的 opencode 服务，页面只做展示与会话级操作。

## 功能

1. 默认按会话排序：打开即进入全部会话列表，按最近更新时间排列，不按项目分组。
2. 侧栏只列项目并按各自最新会话的时间倒序排列；点项目名在下方展开它的会话，默认显示前 5 个，其余折叠为更多按钮，可同时展开多个项目。
3. 项目视图只保留项目路径、项目操作与会话列表，不显示统计卡片与活动图；侧栏只显示有会话且目录仍存在的项目，侧栏底色比内容区深一档，边界清楚。
4. 项目视图的会话列表支持分页与排序，可按更新时间或创建时间排序。
5. 搜索：按会话标题、项目名称、项目路径、模型名过滤，命中的项目在侧栏自动展开；⌘K 聚焦搜索框。
6. 会话详情：默认加载最近 80 条消息，顶部按钮可按需继续加载更早内容；用户消息用气泡展示，助手消息支持 Markdown。
7. 思考过程：默认折叠，点开查看模型推理文本与耗时。
8. 工具调用：折叠卡片显示工具名、命令摘要、执行状态，展开可看完整参数与输出。
9. 会话操作：重命名与删除，删除前二次确认；会话头部与侧栏展开的会话行都有打开项目文件夹按钮。
10. 继续会话：底部输入框直接向该会话发送消息，页面通过事件流实时刷新；运行中可请求中断。
11. 执行中继续输入：消息按 steer 插话，在下一个步骤边界立刻进入当前上下文，气泡标注已插话，输入框不会被锁住；其他渠道排队的消息仍显示排队中，可点取消。
12. 新建会话：侧栏项目区、项目右键菜单与会话列表工具栏都有入口，在当前项目或最近使用的项目下创建并直接打开，⌘N 也可以新建。
13. 模型与 agent：点击会话标题下的模型名即可切换模型或 agent，只影响后续回合；模型列表显示输入输出价格，免费模型有标记。
14. 权限与表单：工具请求授权或需要填写表单时，输入框上方出现处理卡片，可直接允许、拒绝或提交；后台会话有待处理请求时侧栏显示待处理标记。
15. 附件：输入框支持选择、拖拽文件或直接粘贴截图，发送前显示缩略图；历史消息点附件名可按需取回原图查看，不占用首屏流量。
16. 上下文操作：会话元信息里有压缩上下文；最后一条助手消息底部有重新生成与撤销上一轮，撤销前二次确认。
17. 后台提醒：会话在后台跑完后，侧栏展开的会话行显示已完成或失败标记，打开后自动清除。
18. 项目操作：右键项目弹出菜单，可新建会话、在访达打开目录、在终端打开目录、复制启动命令、重命名项目；项目页顶部也有同样入口。
19. 实时同步：订阅 opencode 事件流，执行中的输出按增量刷新，断线自动重连。
20. 顺手细节：点左上角 opencode 回到首页；会话与项目可深链，刷新与浏览器前进后退不丢位置；每个会话单独保存输入草稿；消息可一键复制；滚出底部时出现回到最新按钮；执行中显示真实已用时间。
21. 响应式布局：窄屏下侧栏收起为抽屉，会话页与列表页都可单手操作。

![会话详情](效果图/会话详情.png)

## 数据来源

1. 启动时读取 `~/.local/state/opencode/service.json`，拿到本机 opencode 服务的地址、端口与密码。
2. 使用 HTTP Basic 认证访问 opencode v2 API，账号固定为 opencode。
3. 只调用公开接口：项目列表、会话列表、会话详情、消息分页、会话队列、运行中会话、活跃统计、事件流、会话新建更新与删除。
4. 项目目录是否仍然存在由后端读取本机路径判断，不写入任何数据。
5. 不直接读写 `~/.local/share/opencode/opencode.db`，也不改动项目的配置文件。

## 技术栈

1. 前端：React 19、Vite 7、react-markdown，样式全部手写，没有引入 UI 组件库，主题为灰色阶。
2. 后端：FastAPI、uvicorn、httpx，负责代理 opencode API 与事件流，并托管构建后的静态页面。
3. 数据库：不需要，页面读取的就是 opencode 自己的数据。
4. 图标：SVG 与 192、512、180 三种 PNG，位于 `web/public`。

## 目录结构

```
opencode_manager/
├── server.py              后端与静态托管
├── requirements.txt       后端依赖
├── just_run.sh            一键启动脚本
├── web/                   前端源码
│   ├── index.html
│   ├── vite.config.js
│   ├── public/            站点图标
│   └── src/
├── dist/                  构建产物，由 just_run.sh 生成
├── tests/test_api.py      接口冒烟测试
├── docs/                  接口与数据说明
├── 效果图/                 页面截图
├── README.md
└── 开发记录.md
```

## 安装

1. 确认本机 opencode 正在运行，终端执行 `opencode` 或 `opencode serve` 都可以。
2. 确认 `~/.local/state/opencode/service.json` 存在，里面包含 url 与 password。
3. 安装后端依赖：`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`。
4. 安装前端依赖：`cd web && npm install`。
5. 构建前端：`cd web && npm run build`。

以上步骤在一键脚本里都会自动完成。

## 运行

```
./just_run.sh
```

1. 脚本会检查虚拟环境与依赖，缺失时自动安装。
2. 前端源码比构建产物新时自动重新构建。
3. 端口 8860 已被本项目的实例占用时，直接打开页面并退出；被其他程序占用时才打印占用者并退出，不会擅自结束别人的进程。
4. 服务就绪后有上限地探测一次，探测成功立刻用默认浏览器打开页面，探测子进程随即退出。
5. 服务在前台运行，日志直接输出到终端，Ctrl+C 即可退出。
6. 终端标题会设置为 `opencode_manager:8860`，方便在多个终端窗口里找到它。

常用命令：

```
./just_run.sh           启动，若已在运行则直接打开页面
./just_run.sh --status  查看运行状态与进程号
./just_run.sh --stop    停止本项目实例，任意终端都可以执行
```

打开 `http://127.0.0.1:8860/`。

开发模式：

1. 后端：`.venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8860 --reload`
2. 前端：`cd web && npm run dev`，地址 `http://127.0.0.1:8861/`，Vite 会把 `/api` 代理到 8860。

## 配置

1. 端口写在 `just_run.sh` 的 `PORT` 变量，前端开发端口写在 `web/vite.config.js`。
2. 项目没有自己的密钥，认证信息全部来自 opencode 的 service.json。
3. 浏览器本地只保存每个会话的输入草稿与位置地址，不保存会话内容。

## 接口

后端对前端暴露的接口都在 `server.py`：

1. `GET /api/health` 服务状态与版本。
2. `GET /api/projects` 项目列表。
3. `PATCH /api/projects/{id}` 重命名项目。
4. `GET /api/sessions` 会话列表，支持 limit、project、search、cursor。
5. `GET /api/sessions/active` 正在运行的会话。
6. `GET /api/sessions/{id}` 会话详情。
7. `GET /api/sessions/{id}/messages` 消息分页。
8. `GET /api/sessions/{id}/messages/{messageID}` 单条消息详情，用于按需取回附件原图。
9. `POST /api/sessions` 新建会话。
10. `PATCH /api/sessions/{id}` 重命名会话。
11. `DELETE /api/sessions/{id}` 删除会话。
12. `POST /api/sessions/{id}/prompt` 发送消息，可带 files 附件。
13. `POST /api/sessions/{id}/interrupt` 中断执行。
14. `GET/DELETE /api/sessions/{id}/inbox/{inboxID}` 查看或取消排队消息。
15. `GET /api/models` 与 `GET /api/agents` 可选模型与 agent 列表。
16. `POST /api/sessions/{id}/model` 与 `POST /api/sessions/{id}/agent` 切换模型与 agent。
17. `GET /api/sessions/{id}/permissions` 待授权请求，`POST .../permissions/{requestID}/reply` 回复。
18. `GET /api/sessions/{id}/forms` 待填表单，`POST .../forms/{formID}/reply` 提交，`DELETE .../forms/{formID}` 忽略。
19. `POST /api/sessions/{id}/compact` 压缩上下文。
20. `POST /api/sessions/{id}/revert` 与 `POST .../revert/commit` 撤销上一轮。
21. `GET /api/stats` 活跃统计。
22. `GET /api/events` 事件流代理。
23. `POST /api/reveal` 打开目录或在终端打开。

更细的字段与返回结构见 `docs/接口与数据.md`。

## 测试

先启动服务，再执行：

```
.venv/bin/python tests/test_api.py
```

覆盖服务健康、项目、会话、模型与 agent 列表、会话新建删除、模型与 agent 切换、压缩、授权与表单接口、回退接口、消息分页、统计、404、前端页面与事件流首帧，共 28 项。

## 已知边界

1. 需要本机 opencode 服务在线，服务未启动时页面会显示无法连接与重试入口。
2. 会话列表一次性拉取最近 1000 条，再在前端分页，超过这个量级需要改成服务端分页。
3. 发送消息会真正触发 opencode 执行，可能产生模型费用，请确认会话与模型后再发送。
4. 删除会话不可恢复，操作前请在确认框里核对标题。
5. 页面没有登录态，仅监听 127.0.0.1，不要直接暴露到公网。
