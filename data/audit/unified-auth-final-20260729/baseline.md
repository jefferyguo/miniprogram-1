# 统一登录修复审计基线

- 日期：2026-07-29
- 工作区：存在大量未提交修改，本轮禁止覆盖无关文件。
- `git diff --check`：基线通过。
- 已跟踪变更文件：60 个。
- 未跟踪路径：包含登录组件、登录行为模块、训练数据与既有审计材料。
- 包体保护：`project.config.json` 已忽略 `data/audit`。

## 登录关键文件 SHA-256（修复前）

- `app.js`: `305789a8177701aa01c7db219ee8a23421a628f1b6047b0f478b8194dda1b96e`
- `utils/auth.js`: `e3acb4baf27508075df83ad062ee432a46ff42161947015ae56b30f21d4821da`
- `utils/profile-auth.js`: `b92fb697b7945fb4491d7befa709cc4427f9284d53ae44990cd9505fb9cabb07`
- `utils/phone-auth.js`: `1e4c9f0b85972636b51b6e7434ee514eb3ea9fdfadbfe9cc2d2821a31b83f82e`
- `utils/login-gate-behavior.js`: `5101a98569ebae5d37324f4a28ad58034ff9f137594ae3c218f20434d3b8accc`
- `components/login-gate/login-gate.js`: `ea50573ff54f0a1412f6cfdfc0236770c0b8f133d9a1c563a167e3fbb65937f0`
- `pages/mine/mine.js`: `a7f82edaeec15e51d3e6a27ff90cc1bf6462c631a8eada444e96db3bda394d71`
- `cloudfunctions/login/index.js`: `34c9178e0adcabb4b4d231bbad3ffa3ba0f5cd28f1b96251aaa185c3e7b786c5`

所有标识仅为文件哈希；本报告未记录环境 ID、openid、手机号、用户 `_id` 或密钥。
