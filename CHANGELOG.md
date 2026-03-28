## [1.15.4](https://github.com/yoda-digital/iris-gateway/compare/v1.15.3...v1.15.4) (2026-03-28)

### Refactoring

* **lifecycle:** extract bootstrap modules — approaching 500-line limit ([#233](https://github.com/yoda-digital/iris-gateway/issues/233)) ([#240](https://github.com/yoda-digital/iris-gateway/issues/240)) ([89e5ecf](https://github.com/yoda-digital/iris-gateway/commit/89e5ecfc964a08b2b40a7fa83a0e77697aab05e5))

## [1.15.3](https://github.com/yoda-digital/iris-gateway/compare/v1.15.2...v1.15.3) (2026-03-28)

### Bug Fixes

* [#235](https://github.com/yoda-digital/iris-gateway/issues/235) — pre-emptive decomposition of policy.ts, skills-handlers.ts, proactive/engine.ts ([#259](https://github.com/yoda-digital/iris-gateway/issues/259)) ([ab3a977](https://github.com/yoda-digital/iris-gateway/commit/ab3a977577ad5559273f2e45861590b4037a2d72))

## [1.15.2](https://github.com/yoda-digital/iris-gateway/compare/v1.15.1...v1.15.2) (2026-03-28)

### Bug Fixes

* [#260](https://github.com/yoda-digital/iris-gateway/issues/260) — add SessionChecker and MemoryChecker branch coverage ([#261](https://github.com/yoda-digital/iris-gateway/issues/261)) ([4186084](https://github.com/yoda-digital/iris-gateway/commit/4186084267cde2112b1a278f912fb902ebf4d65c))

## [1.15.1](https://github.com/yoda-digital/iris-gateway/compare/v1.15.0...v1.15.1) (2026-03-27)

### Bug Fixes

* [#236](https://github.com/yoda-digital/iris-gateway/issues/236) — clarify isConnected semantics and add isPolling alias for TelegramAdapter ([#248](https://github.com/yoda-digital/iris-gateway/issues/248)) ([463a97d](https://github.com/yoda-digital/iris-gateway/commit/463a97d063bdc731e7f63af44e77898f74929272))

## [1.15.0](https://github.com/yoda-digital/iris-gateway/compare/v1.14.1...v1.15.0) (2026-03-27)

### Features

* add GitHub Discussion category form templates ([7d89c82](https://github.com/yoda-digital/iris-gateway/commit/7d89c82958ee168577949df79b024c0cc569d0ce))

## [1.14.1](https://github.com/yoda-digital/iris-gateway/compare/v1.14.0...v1.14.1) (2026-03-27)

### Bug Fixes

* [#234](https://github.com/yoda-digital/iris-gateway/issues/234) — split message-router.ts (380→268 lines) into TurnGrouper + router-metrics ([#237](https://github.com/yoda-digital/iris-gateway/issues/237)) ([37316b0](https://github.com/yoda-digital/iris-gateway/commit/37316b003881eadaf16dc567435666b01ebc8c38))

## [1.14.0](https://github.com/yoda-digital/iris-gateway/compare/v1.13.18...v1.14.0) (2026-03-26)

### Features

* **telegram:** detect concurrent instances and fail fast on 409 conflict ([#231](https://github.com/yoda-digital/iris-gateway/issues/231)) ([#232](https://github.com/yoda-digital/iris-gateway/issues/232)) ([bc9f318](https://github.com/yoda-digital/iris-gateway/commit/bc9f318eca72e806f906564e1f26a5cb940e1982))

## [1.13.18](https://github.com/yoda-digital/iris-gateway/compare/v1.13.17...v1.13.18) (2026-03-25)

### Bug Fixes

* remove trailing comma in opencode.json (JSON syntax error) ([#230](https://github.com/yoda-digital/iris-gateway/issues/230)) ([dad1711](https://github.com/yoda-digital/iris-gateway/commit/dad1711c1b0f052575243e8029ca3a98ec390281))

## [1.13.17](https://github.com/yoda-digital/iris-gateway/compare/v1.13.16...v1.13.17) (2026-03-24)

### Refactoring

* **intelligence:** move InboundMessage to src/types/message.ts — fix dep direction violation ([#222](https://github.com/yoda-digital/iris-gateway/issues/222)) ([#229](https://github.com/yoda-digital/iris-gateway/issues/229)) ([9294456](https://github.com/yoda-digital/iris-gateway/commit/92944562b453198f8d3f0d7389b79ab84c7a5f97))

## [1.13.16](https://github.com/yoda-digital/iris-gateway/compare/v1.13.15...v1.13.16) (2026-03-22)

### Bug Fixes

* [#218](https://github.com/yoda-digital/iris-gateway/issues/218) — add coverage for Discord adapter init and message handling ([305d57c](https://github.com/yoda-digital/iris-gateway/commit/305d57c8ae4de231ee6d0467ebb04175d03e594a))

## [1.13.15](https://github.com/yoda-digital/iris-gateway/compare/v1.13.14...v1.13.15) (2026-03-22)

### Bug Fixes

* **ci:** repair needs-changes-loop trigger — workflow_dispatch instead of label event ([#219](https://github.com/yoda-digital/iris-gateway/issues/219)) ([b54614f](https://github.com/yoda-digital/iris-gateway/commit/b54614f9c37d81bf3181bce6d25ca218b462a359))

## [1.13.14](https://github.com/yoda-digital/iris-gateway/compare/v1.13.13...v1.13.14) (2026-03-22)

### Bug Fixes

* [#199](https://github.com/yoda-digital/iris-gateway/issues/199) — add coverage for fetchWithTimeout null-return path in token validators ([#201](https://github.com/yoda-digital/iris-gateway/issues/201)) ([685021b](https://github.com/yoda-digital/iris-gateway/commit/685021b69e45b86eaa4b28ac849577d5c7c9ee79))
* [#209](https://github.com/yoda-digital/iris-gateway/issues/209) — add execute() lifecycle tests for cron/service.ts (66%→99% coverage) ([#210](https://github.com/yoda-digital/iris-gateway/issues/210)) ([169d953](https://github.com/yoda-digital/iris-gateway/commit/169d953cc9460cf470ae2f1f7043b95de69f6a94))

## [1.13.13](https://github.com/yoda-digital/iris-gateway/compare/v1.13.12...v1.13.13) (2026-03-22)

### Bug Fixes

* [#200](https://github.com/yoda-digital/iris-gateway/issues/200) — split lifecycle.ts into readiness + startup-summary modules ([#202](https://github.com/yoda-digital/iris-gateway/issues/202)) ([e8645a5](https://github.com/yoda-digital/iris-gateway/commit/e8645a5fbcf35f6e2ef1a4c4617777acd7a296f7))

## [1.13.12](https://github.com/yoda-digital/iris-gateway/compare/v1.13.11...v1.13.12) (2026-03-22)

### Bug Fixes

* [#213](https://github.com/yoda-digital/iris-gateway/issues/213) — add tests for gateway/adapters.ts channel registration paths ([#214](https://github.com/yoda-digital/iris-gateway/issues/214)) ([40d52cd](https://github.com/yoda-digital/iris-gateway/commit/40d52cdce3bd296778d046b167326e2b52335a49))

## [1.13.11](https://github.com/yoda-digital/iris-gateway/compare/v1.13.10...v1.13.11) (2026-03-21)

### Bug Fixes

* [#203](https://github.com/yoda-digital/iris-gateway/issues/203) — add coverage for fetchMediaFromUrl timeout and post-download size guard ([#206](https://github.com/yoda-digital/iris-gateway/issues/206)) ([c981c5f](https://github.com/yoda-digital/iris-gateway/commit/c981c5f5f67e7e4deeeb1174ea5337dc1f17058a))

## [1.13.10](https://github.com/yoda-digital/iris-gateway/compare/v1.13.9...v1.13.10) (2026-03-20)

### Bug Fixes

* **media,cli:** add fetch timeouts to fetchTelegramFile() and init token validators ([a003dde](https://github.com/yoda-digital/iris-gateway/commit/a003dde276f4ee337af4a55b55695e6757d4c532)), closes [#193](https://github.com/yoda-digital/iris-gateway/issues/193)

## [1.13.9](https://github.com/yoda-digital/iris-gateway/compare/v1.13.8...v1.13.9) (2026-03-20)

### Bug Fixes

* **model-sync:** add 5s AbortController timeout to OpenRouter capability fetch ([#192](https://github.com/yoda-digital/iris-gateway/issues/192)) ([a106192](https://github.com/yoda-digital/iris-gateway/commit/a10619215433105252fd1686a6820e7dae5ce753))

## [1.13.8](https://github.com/yoda-digital/iris-gateway/compare/v1.13.7...v1.13.8) (2026-03-20)

### Bug Fixes

* [#186](https://github.com/yoda-digital/iris-gateway/issues/186) — update coverage floor from 70% to 75% in docs ([#191](https://github.com/yoda-digital/iris-gateway/issues/191)) ([c4d732e](https://github.com/yoda-digital/iris-gateway/commit/c4d732e36b59ed342139790f8c9db2af3027b1b7))

## [1.13.7](https://github.com/yoda-digital/iris-gateway/compare/v1.13.6...v1.13.7) (2026-03-20)

### Bug Fixes

* **lifecycle:** replace ping readiness check with checkHealth() polling ([#179](https://github.com/yoda-digital/iris-gateway/issues/179)) ([abe1eb0](https://github.com/yoda-digital/iris-gateway/commit/abe1eb04c51cecbde083fdad44714423097653db)), closes [yoda-digital/iris-gateway#176](https://github.com/yoda-digital/iris-gateway/issues/176)

### Refactoring

* **gateway:** extract model-sync logic to src/config/model-sync.ts ([#180](https://github.com/yoda-digital/iris-gateway/issues/180)) ([50db842](https://github.com/yoda-digital/iris-gateway/commit/50db842969f5f2c84ce0f513bb2853dc1996691b)), closes [yoda-digital/iris-gateway#173](https://github.com/yoda-digital/iris-gateway/issues/173)

## [1.13.6](https://github.com/yoda-digital/iris-gateway/compare/v1.13.5...v1.13.6) (2026-03-20)

### Bug Fixes

* [#170](https://github.com/yoda-digital/iris-gateway/issues/170) — expand canvas/server.ts and inference/store.ts test coverage ([#172](https://github.com/yoda-digital/iris-gateway/issues/172)) ([8882124](https://github.com/yoda-digital/iris-gateway/commit/88821242677cf632ade1c1c0d7b55f104a0b22ed))

## [1.13.5](https://github.com/yoda-digital/iris-gateway/compare/v1.13.4...v1.13.5) (2026-03-20)

### Bug Fixes

* [#167](https://github.com/yoda-digital/iris-gateway/issues/167) — add unit tests for src/config/schema.ts (≥20 tests, full coverage) ([#168](https://github.com/yoda-digital/iris-gateway/issues/168)) ([80613c0](https://github.com/yoda-digital/iris-gateway/commit/80613c057985744cf444b3395c1e832ec10e4357))

## [1.13.4](https://github.com/yoda-digital/iris-gateway/compare/v1.13.3...v1.13.4) (2026-03-20)

### Bug Fixes

* **config:** add models field to Zod schema — was stripped at parse time ([5a828d1](https://github.com/yoda-digital/iris-gateway/commit/5a828d1a22b54f0fad4b2ec85a9b7fee9f4ff1d7))
* **config:** auto-register unknown models in opencode.json provider map ([f1bbbf7](https://github.com/yoda-digital/iris-gateway/commit/f1bbbf74595f8948e56ed25b636f09b20ef54b46))
* **config:** query OpenRouter API for real model capabilities at registration ([865a404](https://github.com/yoda-digital/iris-gateway/commit/865a404cbe8fdbb89cabd2a2f8f49a5500b12707))
* **config:** show active model clearly in console at startup ([e01743c](https://github.com/yoda-digital/iris-gateway/commit/e01743c52c12af31b43e74a7200108b14907f796))
* **config:** sync iris.config.json models to opencode.json at startup ([04f1970](https://github.com/yoda-digital/iris-gateway/commit/04f19704947646618e33330757a87c1dc46e2f63))
* **config:** sync primary model to .opencode/agent/ frontmatter ([7cd6052](https://github.com/yoda-digital/iris-gateway/commit/7cd6052e37e49099792112e1cb45f1e5b010f976))
* **config:** update models to use openrouter/hunter-alpha across agents and opencode.json ([9cb2eca](https://github.com/yoda-digital/iris-gateway/commit/9cb2eca5f41084d86c6bba0a3b7ea283a4cb2c8f))
* **config:** use safe minimal defaults when registering unknown models ([924c227](https://github.com/yoda-digital/iris-gateway/commit/924c22789d5a38bfd003c7cd9d35ba0500e1b153))
* **lifecycle:** swap pino v9 logger call order (obj, msg) to fix TS2769 overload errors ([dd0c6c9](https://github.com/yoda-digital/iris-gateway/commit/dd0c6c9ee4a3d07afceaca30fba8d457b80c50c4)), closes [#171](https://github.com/yoda-digital/iris-gateway/issues/171)

## [1.13.3](https://github.com/yoda-digital/iris-gateway/compare/v1.13.2...v1.13.3) (2026-03-17)

### Bug Fixes

* **npm:** rename scope from [@yoda-digital](https://github.com/yoda-digital) to [@yoda](https://github.com/yoda).digital ([afe9fd8](https://github.com/yoda-digital/iris-gateway/commit/afe9fd882c7c14ed8c2ecc2206eea91afcc31772))

## [1.13.2](https://github.com/yoda-digital/iris-gateway/compare/v1.13.1...v1.13.2) (2026-03-17)

### Bug Fixes

* **release:** retrigger publish with automation npm token ([38d595a](https://github.com/yoda-digital/iris-gateway/commit/38d595a72492a61fd71e6a5b77c83f47e86ecaf2))

## [1.13.1](https://github.com/yoda-digital/iris-gateway/compare/v1.13.0...v1.13.1) (2026-03-17)

### Bug Fixes

* **docs:** trigger npm publish after token rotation ([445ac8e](https://github.com/yoda-digital/iris-gateway/commit/445ac8e414ff48534cfbf8fd90d2bcdb1878cd7c))

## [1.13.0](https://github.com/yoda-digital/iris-gateway/compare/v1.12.14...v1.13.0) (2026-03-17)

### Features

* **npm:** publish @yoda-digital/iris-gateway to npm registry ([59a8b6b](https://github.com/yoda-digital/iris-gateway/commit/59a8b6b342bea8b4b32ed01f589dd0b6f348ba34))

## [1.12.14](https://github.com/yoda-digital/iris-gateway/compare/v1.12.13...v1.12.14) (2026-03-17)

### Bug Fixes

* exclude review request comments from verdict parsing ([e0086cd](https://github.com/yoda-digital/iris-gateway/commit/e0086cd1849193b88963edae49d3cff74f96ebd0))

## [1.12.13](https://github.com/yoda-digital/iris-gateway/compare/v1.12.12...v1.12.13) (2026-03-17)

### Bug Fixes

* [#157](https://github.com/yoda-digital/iris-gateway/issues/157) — restrict Claude Code CI permissions, add CODEOWNERS ([4832572](https://github.com/yoda-digital/iris-gateway/commit/4832572a324fddc1bf2129abf7f7143abc74a574)), closes [#159](https://github.com/yoda-digital/iris-gateway/issues/159) [#161](https://github.com/yoda-digital/iris-gateway/issues/161)

## [1.12.12](https://github.com/yoda-digital/iris-gateway/compare/v1.12.11...v1.12.12) (2026-03-17)

### Bug Fixes

* [#160](https://github.com/yoda-digital/iris-gateway/issues/160) — add unit tests for src/canvas/ module ([c6521d1](https://github.com/yoda-digital/iris-gateway/commit/c6521d1d3bcd8a7a50fe059fb7970b0069907329))

## [1.12.11](https://github.com/yoda-digital/iris-gateway/compare/v1.12.10...v1.12.11) (2026-03-17)

### Bug Fixes

* [#158](https://github.com/yoda-digital/iris-gateway/issues/158) — remove debug show_full_output flag from claude.yml ([#161](https://github.com/yoda-digital/iris-gateway/issues/161)) ([d78471c](https://github.com/yoda-digital/iris-gateway/commit/d78471c0caa694c9a5cf0811f29cbfd80bb6c304))

## [1.12.10](https://github.com/yoda-digital/iris-gateway/compare/v1.12.9...v1.12.10) (2026-03-14)

### Bug Fixes

* **ci:** copy repo .claude/settings.json to runner home before Claude runs ([7ef0e18](https://github.com/yoda-digital/iris-gateway/commit/7ef0e180c9e15dc4fa355330c966042db5a1d5e0))

## [1.12.9](https://github.com/yoda-digital/iris-gateway/compare/v1.12.8...v1.12.9) (2026-03-14)

### Bug Fixes

* **ci:** add allowedTools + bypassPermissions to needs-changes-loop trigger ([dce21c4](https://github.com/yoda-digital/iris-gateway/commit/dce21c4033f6d741c8e52a8e2a1c24da52f57105))

## [1.12.8](https://github.com/yoda-digital/iris-gateway/compare/v1.12.7...v1.12.8) (2026-03-14)

### Bug Fixes

* **ci:** replace deprecated direct_prompt with prompt in claude.yml ([a82dcae](https://github.com/yoda-digital/iris-gateway/commit/a82dcaef766acec7e78d37fb05bb1d5213e538fc))

## [1.12.7](https://github.com/yoda-digital/iris-gateway/compare/v1.12.6...v1.12.7) (2026-03-13)

### Bug Fixes

* [#151](https://github.com/yoda-digital/iris-gateway/issues/151) — add unit tests for engine.ts isQuietHours and vault/search.ts error paths ([#152](https://github.com/yoda-digital/iris-gateway/issues/152)) ([e113917](https://github.com/yoda-digital/iris-gateway/commit/e1139170dc689b5360f8e20595793f4f8ed277fa))

## [1.12.6](https://github.com/yoda-digital/iris-gateway/compare/v1.12.5...v1.12.6) (2026-03-13)

### Bug Fixes

* [#145](https://github.com/yoda-digital/iris-gateway/issues/145) — auto-apply verdict labels after Claude code review ([#146](https://github.com/yoda-digital/iris-gateway/issues/146)) ([835dcc4](https://github.com/yoda-digital/iris-gateway/commit/835dcc497e61850d2b1f5f35cc5887035bac2487))

## [1.12.5](https://github.com/yoda-digital/iris-gateway/compare/v1.12.4...v1.12.5) (2026-03-13)

### Bug Fixes

* **opencode:** align .opencode/ with strict config validation ([4c4df95](https://github.com/yoda-digital/iris-gateway/commit/4c4df95da00d2ec3c3623590f8c492e146c787d4))

## [1.12.4](https://github.com/yoda-digital/iris-gateway/compare/v1.12.3...v1.12.4) (2026-03-13)

### Bug Fixes

* **vault:** move turn_id index creation after column migration — closes [#148](https://github.com/yoda-digital/iris-gateway/issues/148) ([a94883a](https://github.com/yoda-digital/iris-gateway/commit/a94883a7623327e01babe58586685be49bb15b9d))

## [1.12.3](https://github.com/yoda-digital/iris-gateway/compare/v1.12.2...v1.12.3) (2026-03-13)

### Refactoring

* **tool-server:** make turn-grouping idle window configurable — closes [#138](https://github.com/yoda-digital/iris-gateway/issues/138) ([#144](https://github.com/yoda-digital/iris-gateway/issues/144)) ([281d726](https://github.com/yoda-digital/iris-gateway/commit/281d726aac2ec7d94c297a410178e935906a30da))

## [1.12.2](https://github.com/yoda-digital/iris-gateway/compare/v1.12.1...v1.12.2) (2026-03-12)

### Bug Fixes

* **ci:** intercept needs-changes-loop label — Claude implements fixes, not Codex ([239af28](https://github.com/yoda-digital/iris-gateway/commit/239af2828b8dbe6e13106ac5d69bcce1761c896e))

## [1.12.1](https://github.com/yoda-digital/iris-gateway/compare/v1.12.0...v1.12.1) (2026-03-12)

### Bug Fixes

* **ci:** pass github_token to Claude Code Review so git push works ([d409312](https://github.com/yoda-digital/iris-gateway/commit/d409312ce82844deda25dc216f718c622445a828))
* **ci:** pass github_token to Claude Code so git push works from tools ([f150c73](https://github.com/yoda-digital/iris-gateway/commit/f150c7319d4389ad14ff9355aa3d5986066b1a0c))

## [1.12.0](https://github.com/yoda-digital/iris-gateway/compare/v1.11.4...v1.12.0) (2026-03-12)

### Features

* **sdk:** expose /traces endpoints in IrisClient — closes [#137](https://github.com/yoda-digital/iris-gateway/issues/137) ([#143](https://github.com/yoda-digital/iris-gateway/issues/143)) ([6afecbc](https://github.com/yoda-digital/iris-gateway/commit/6afecbce23be73fdcc10cdc89890f526136a7049))

## [1.11.4](https://github.com/yoda-digital/iris-gateway/compare/v1.11.3...v1.11.4) (2026-03-12)

### Bug Fixes

* [#139](https://github.com/yoda-digital/iris-gateway/issues/139) — publish IrisClient as versioned npm package via exports field ([#140](https://github.com/yoda-digital/iris-gateway/issues/140)) ([700e31f](https://github.com/yoda-digital/iris-gateway/commit/700e31fc512b2bfff2d5199c6af660af2bdcfd18))

## [1.11.3](https://github.com/yoda-digital/iris-gateway/compare/v1.11.2...v1.11.3) (2026-03-12)

### Bug Fixes

* **ci:** allow anastasia-istrati[bot] to trigger Claude Code Review ([abeaaf2](https://github.com/yoda-digital/iris-gateway/commit/abeaaf2b111bd8c52b7e0ae524f9ce041736fda7))
* **ci:** allow anastasia-istrati[bot] to trigger Claude reviews ([242f327](https://github.com/yoda-digital/iris-gateway/commit/242f3276ef1a4f5db3499a2b9e0e2fc9ef47cf92))

## [1.11.2](https://github.com/yoda-digital/iris-gateway/compare/v1.11.1...v1.11.2) (2026-03-12)

### Refactoring

* **sdk:** simplify IrisClient — Transport interface + concrete return types ([4f2561a](https://github.com/yoda-digital/iris-gateway/commit/4f2561a4f535de8a06d7cb1bba6b33e080dfd99b))

## [1.11.1](https://github.com/yoda-digital/iris-gateway/compare/v1.11.0...v1.11.1) (2026-03-12)

### Bug Fixes

* **vault:** close [#135](https://github.com/yoda-digital/iris-gateway/issues/135) + close [#131](https://github.com/yoda-digital/iris-gateway/issues/131) — limit clamp + audit_log indexes ([a0ae26b](https://github.com/yoda-digital/iris-gateway/commit/a0ae26b1211af69087da84cae0a6b66b4aa49a98))

## [1.11.0](https://github.com/yoda-digital/iris-gateway/compare/v1.10.5...v1.11.0) (2026-03-12)

### Features

* **sdk:** external HTTP client for tool-server API — closes [#100](https://github.com/yoda-digital/iris-gateway/issues/100) ([#130](https://github.com/yoda-digital/iris-gateway/issues/130)) ([c38913f](https://github.com/yoda-digital/iris-gateway/commit/c38913f23522a8b9fb3a8a6d916cd1405d5a1955)), closes [#129](https://github.com/yoda-digital/iris-gateway/issues/129) [#129](https://github.com/yoda-digital/iris-gateway/issues/129)

## [1.10.5](https://github.com/yoda-digital/iris-gateway/compare/v1.10.4...v1.10.5) (2026-03-12)

### Bug Fixes

* [#132](https://github.com/yoda-digital/iris-gateway/issues/132) — clear turnStateTimer and turnState in stop() to prevent resource leak ([#136](https://github.com/yoda-digital/iris-gateway/issues/136)) ([5ffa9c8](https://github.com/yoda-digital/iris-gateway/commit/5ffa9c8c128923294cbaf855d39b51c4dd383e90))

## [1.10.4](https://github.com/yoda-digital/iris-gateway/compare/v1.10.3...v1.10.4) (2026-03-12)

### Bug Fixes

* [#133](https://github.com/yoda-digital/iris-gateway/issues/133) — add row limit to GET /traces/:turn_id (default 200, max 1000) ([#134](https://github.com/yoda-digital/iris-gateway/issues/134)) ([385514f](https://github.com/yoda-digital/iris-gateway/commit/385514f637c5700d331fe0824f614c4eb170edcb))

## [1.10.3](https://github.com/yoda-digital/iris-gateway/compare/v1.10.2...v1.10.3) (2026-03-11)

### Bug Fixes

* [#102](https://github.com/yoda-digital/iris-gateway/issues/102) — extend audit_log with turn_id/step_index, add GET /traces endpoints, auto-instrument tool-server ([#129](https://github.com/yoda-digital/iris-gateway/issues/129)) ([b3a38bd](https://github.com/yoda-digital/iris-gateway/commit/b3a38bd925c0c7cc19dd6e5b82d31fefe3f5d3ce))

## [1.10.2](https://github.com/yoda-digital/iris-gateway/compare/v1.10.1...v1.10.2) (2026-03-11)

### Bug Fixes

* **ci:** grant contents:write so Claude Code can push fixes ([e7f7e7f](https://github.com/yoda-digital/iris-gateway/commit/e7f7e7fefbdb76939948d20f1f83a56c7f34ab10))
* **ci:** grant contents:write so Claude Code can push review fixes ([ee2392b](https://github.com/yoda-digital/iris-gateway/commit/ee2392bab465cc0e2e88b7222b8a21ba43accfde))

## [1.10.1](https://github.com/yoda-digital/iris-gateway/compare/v1.10.0...v1.10.1) (2026-03-11)

### Bug Fixes

* [#99](https://github.com/yoda-digital/iris-gateway/issues/99) — wire dead metric definitions to hot paths ([#127](https://github.com/yoda-digital/iris-gateway/issues/127)) ([46ab5bc](https://github.com/yoda-digital/iris-gateway/commit/46ab5bc636e0e815fb632090de187f8e0834059d))

## [1.10.0](https://github.com/yoda-digital/iris-gateway/compare/v1.9.2...v1.10.0) (2026-03-11)

### Features

* [#103](https://github.com/yoda-digital/iris-gateway/issues/103) — capability detection at boot, probe binaries and filter manifest ([#125](https://github.com/yoda-digital/iris-gateway/issues/125)) ([4b79312](https://github.com/yoda-digital/iris-gateway/commit/4b79312f4a5afd66633c58078a342ef5fc8fdf6b))

## [1.9.2](https://github.com/yoda-digital/iris-gateway/compare/v1.9.1...v1.9.2) (2026-03-11)

### Refactoring

* **bridge:** commit untracked refactor files — supervisor.ts, skills-handlers.ts, skills-router.ts ([#124](https://github.com/yoda-digital/iris-gateway/issues/124)) ([2e9042f](https://github.com/yoda-digital/iris-gateway/commit/2e9042fe79e111c9bde8745617117dfb7a63e2a8)), closes [#123](https://github.com/yoda-digital/iris-gateway/issues/123)

## [1.9.2](https://github.com/yoda-digital/iris-gateway/compare/v1.9.1...v1.9.2) (2026-03-10)

### Bug Fixes

* [#106](https://github.com/yoda-digital/iris-gateway/issues/106) — remove `openai/gpt-4o` paid model preset from init wizard; replace with four free OpenRouter alternatives ([#119](https://github.com/yoda-digital/iris-gateway/issues/119)) — init wizard now exclusively presents free-tier models as presets, in line with zero-cost-model policy
* [#115](https://github.com/yoda-digital/iris-gateway/issues/115) — mock `InstanceCoordinator` in gateway startup tests to prevent 13 leaked `setInterval` timers per test run ([#120](https://github.com/yoda-digital/iris-gateway/issues/120))

### Tests

* [#107](https://github.com/yoda-digital/iris-gateway/issues/107) — restore coverage above 75% threshold: add 1575 lines of unit tests across `lifecycle.ts`, `intelligence-wiring.ts`, `health/trend-detector.ts`, `health/gate.ts`, `bridge/routers/system.ts` ([#114](https://github.com/yoda-digital/iris-gateway/issues/114))
* [#111](https://github.com/yoda-digital/iris-gateway/issues/111) — `governance/policy.ts` from 6.27% to ~88% coverage: 40 tests covering `PolicyEngine` enforcement, audit, and permission validation ([#117](https://github.com/yoda-digital/iris-gateway/issues/117))
* [#112](https://github.com/yoda-digital/iris-gateway/issues/112) — intelligence domain stores from <5% to ≥60% coverage: 53 tests for `ArcsStore`, `GoalsStore`, `InferenceStore`, and `InferenceEngine` ([#118](https://github.com/yoda-digital/iris-gateway/issues/118))
* [#116](https://github.com/yoda-digital/iris-gateway/issues/116) — add 5 tests for heartbeat endpoints in system router (`GET /heartbeat/status`, `POST /heartbeat/trigger`) — both happy paths and error branches ([#120](https://github.com/yoda-digital/iris-gateway/issues/120))

## [1.9.1](https://github.com/yoda-digital/iris-gateway/compare/v1.9.0...v1.9.1) (2026-03-10)

### Bug Fixes

* **init:** remove paid model preset from init wizard ([#119](https://github.com/yoda-digital/iris-gateway/issues/119)) ([decd096](https://github.com/yoda-digital/iris-gateway/commit/decd096d3f493f5d55d717bb1b28db90d8a303f0)), closes [#106](https://github.com/yoda-digital/iris-gateway/issues/106)

## [1.9.0](https://github.com/yoda-digital/iris-gateway/compare/v1.8.11...v1.9.0) (2026-03-10)

### Features

* [#101](https://github.com/yoda-digital/iris-gateway/issues/101) — multi-instance support with SQLite leader election ([#110](https://github.com/yoda-digital/iris-gateway/issues/110)) ([7535230](https://github.com/yoda-digital/iris-gateway/commit/7535230b18674ac85f2265df92a2cd045e5bf593))

## [1.8.11](https://github.com/yoda-digital/iris-gateway/compare/v1.8.10...v1.8.11) (2026-03-10)

### Bug Fixes

* [#105](https://github.com/yoda-digital/iris-gateway/issues/105) — mock heavy channel adapter deps to prevent test timeout ([8639b43](https://github.com/yoda-digital/iris-gateway/commit/8639b43d69ea0ce6c050cc85c7f03ed3b068a4bf))

## [1.8.10](https://github.com/yoda-digital/iris-gateway/compare/v1.8.9...v1.8.10) (2026-03-09)

### Bug Fixes

* [#87](https://github.com/yoda-digital/iris-gateway/issues/87) — remove opencode-client.ts from coverage exclude list ([#98](https://github.com/yoda-digital/iris-gateway/issues/98)) ([94b7bf6](https://github.com/yoda-digital/iris-gateway/commit/94b7bf612c48f6c81b6e30f9b6039adaf4a58f94))

## [1.8.9](https://github.com/yoda-digital/iris-gateway/compare/v1.8.8...v1.8.9) (2026-03-09)

### Bug Fixes

* [#93](https://github.com/yoda-digital/iris-gateway/issues/93) — remove lifecycle.ts and channel adapters from coverage exclusions ([#97](https://github.com/yoda-digital/iris-gateway/issues/97)) ([1934fd3](https://github.com/yoda-digital/iris-gateway/commit/1934fd3415439f308193881a97c3b4d8d993140c))

## [1.8.8](https://github.com/yoda-digital/iris-gateway/compare/v1.8.7...v1.8.8) (2026-03-09)

### Bug Fixes

* [#92](https://github.com/yoda-digital/iris-gateway/issues/92) — expose getInFlightCount() for heartbeat suppression, getPendingQueueSize() for circuit-breaker queue depth ([#95](https://github.com/yoda-digital/iris-gateway/issues/95)) ([295e5eb](https://github.com/yoda-digital/iris-gateway/commit/295e5eb5ad3b8aca88822f83bd11b41971c3463d))
* **ci:** replace broken plugin_marketplaces inputs with direct prompt in claude-code-review.yml ([#96](https://github.com/yoda-digital/iris-gateway/issues/96)) ([aa1b7af](https://github.com/yoda-digital/iris-gateway/commit/aa1b7afeebf2d68876bb0a4a37da008486602953)), closes [#88](https://github.com/yoda-digital/iris-gateway/issues/88)

## [1.8.7](https://github.com/yoda-digital/iris-gateway/compare/v1.8.6...v1.8.7) (2026-03-09)

### Bug Fixes

* **ci:** grant write permissions to claude.yml workflow for issue/PR comments ([#94](https://github.com/yoda-digital/iris-gateway/issues/94)) ([63c061b](https://github.com/yoda-digital/iris-gateway/commit/63c061bed263d4e6fb1723c7eb884c75eb8b4b32)), closes [#90](https://github.com/yoda-digital/iris-gateway/issues/90)

## [1.8.6](https://github.com/yoda-digital/iris-gateway/compare/v1.8.5...v1.8.6) (2026-03-09)

### Bug Fixes

* **vault-router:** implement /vault/extract — was silent stub returning empty facts ([#89](https://github.com/yoda-digital/iris-gateway/issues/89)) ([94f2d1e](https://github.com/yoda-digital/iris-gateway/commit/94f2d1e813b03e879ab5af7cf074bdc8f210fd2b)), closes [#86](https://github.com/yoda-digital/iris-gateway/issues/86) [#86](https://github.com/yoda-digital/iris-gateway/issues/86)

## [1.8.5](https://github.com/yoda-digital/iris-gateway/compare/v1.8.4...v1.8.5) (2026-03-08)

### Bug Fixes

* **telegram:** replace as any cast in setMessageReaction with typed ReactionTypeEmoji ([#84](https://github.com/yoda-digital/iris-gateway/issues/84)) ([b8d4c3a](https://github.com/yoda-digital/iris-gateway/commit/b8d4c3a3c5db664ad14ff2af3171649ef12a9f37)), closes [#79](https://github.com/yoda-digital/iris-gateway/issues/79)

## [1.8.4](https://github.com/yoda-digital/iris-gateway/compare/v1.8.3...v1.8.4) (2026-03-08)

### Bug Fixes

* **cli:** replace `as any` cast in executor.ts with typed error guard ([#77](https://github.com/yoda-digital/iris-gateway/issues/77)) ([dcb8ec1](https://github.com/yoda-digital/iris-gateway/commit/dcb8ec1f8dea26712d57224275daa1f4f16690ca)), closes [#74](https://github.com/yoda-digital/iris-gateway/issues/74)

## [1.8.3](https://github.com/yoda-digital/iris-gateway/compare/v1.8.2...v1.8.3) (2026-03-07)

### Bug Fixes

* **proactive:** remove unnecessary as any cast in executeProactive (Closes [#59](https://github.com/yoda-digital/iris-gateway/issues/59)) ([#62](https://github.com/yoda-digital/iris-gateway/issues/62)) ([e98b6f9](https://github.com/yoda-digital/iris-gateway/commit/e98b6f9481ca905714c6c25819fadabfca436ef3))

## [1.8.2](https://github.com/yoda-digital/iris-gateway/compare/v1.8.1...v1.8.2) (2026-03-07)

### Bug Fixes

* **system-router:** add tick() to HeartbeatEngine interface, remove as any cast ([#61](https://github.com/yoda-digital/iris-gateway/issues/61)) ([7a55fcb](https://github.com/yoda-digital/iris-gateway/commit/7a55fcb8958d5acd958d93e99093e4f8de23abda)), closes [#58](https://github.com/yoda-digital/iris-gateway/issues/58)

## [1.8.1](https://github.com/yoda-digital/iris-gateway/compare/v1.8.0...v1.8.1) (2026-03-07)

### Bug Fixes

* **heartbeat:** add isConnected to ChannelAdapter interface and all adapters ([#60](https://github.com/yoda-digital/iris-gateway/issues/60)) ([7ee4c98](https://github.com/yoda-digital/iris-gateway/commit/7ee4c98dc098e2465cffd566af7f26a8d3b53823)), closes [#57](https://github.com/yoda-digital/iris-gateway/issues/57)

## [1.8.0](https://github.com/yoda-digital/iris-gateway/compare/v1.7.3...v1.8.0) (2026-03-06)

### Features

* **bridge:** make sendAndWait timeout configurable per channel via sendAndWaitTimeoutMs ([#51](https://github.com/yoda-digital/iris-gateway/issues/51)) ([d58dd29](https://github.com/yoda-digital/iris-gateway/commit/d58dd2974845852d8c510907afdb1b7232c4c15a)), closes [#48](https://github.com/yoda-digital/iris-gateway/issues/48)

## [1.7.3](https://github.com/yoda-digital/iris-gateway/compare/v1.7.2...v1.7.3) (2026-03-06)

### Bug Fixes

* **arcs:** resolve stopword language per-sender at call site ([#50](https://github.com/yoda-digital/iris-gateway/issues/50)) ([ebcfbb9](https://github.com/yoda-digital/iris-gateway/commit/ebcfbb9bd2034861e6441c65b261b2073d897daf)), closes [#40](https://github.com/yoda-digital/iris-gateway/issues/40)

## [1.7.2](https://github.com/yoda-digital/iris-gateway/compare/v1.7.1...v1.7.2) (2026-03-06)

### Bug Fixes

* **health:** read version dynamically from package.json ([#49](https://github.com/yoda-digital/iris-gateway/issues/49)) ([17f324a](https://github.com/yoda-digital/iris-gateway/commit/17f324a30821888965d4337efe81486ae0ec80ee)), closes [#47](https://github.com/yoda-digital/iris-gateway/issues/47)

## [1.7.1](https://github.com/yoda-digital/iris-gateway/compare/v1.7.0...v1.7.1) (2026-03-05)

### Bug Fixes

* **metrics:** wire MetricsRegistry into HealthServer /metrics endpoint ([18881d0](https://github.com/yoda-digital/iris-gateway/commit/18881d0f0986609dcf5c08aeed85f3374ff17658)), closes [#27](https://github.com/yoda-digital/iris-gateway/issues/27)
* **triggers:** guard dormancyRecovery JSON.parse against malformed evidence ([ff5b1a6](https://github.com/yoda-digital/iris-gateway/commit/ff5b1a642a9322c703a5fccdbee819184628ad9d)), closes [#43](https://github.com/yoda-digital/iris-gateway/issues/43)

## [1.7.0](https://github.com/yoda-digital/iris-gateway/compare/v1.6.0...v1.7.0) (2026-03-05)

### Features

* two-process reliability — circuit breaker + auto-restart ([#25](https://github.com/yoda-digital/iris-gateway/issues/25)) ([106e333](https://github.com/yoda-digital/iris-gateway/commit/106e33324eaff7b19320cc18391902d7a3d98c4b))

### Bug Fixes

* **bridge:** circuit breaker actually breaks the circuit ([b93e0a5](https://github.com/yoda-digital/iris-gateway/commit/b93e0a5e89fa5daf9c787edc253386d808fae249)), closes [#39](https://github.com/yoda-digital/iris-gateway/issues/39) [#1](https://github.com/yoda-digital/iris-gateway/issues/1) [#2](https://github.com/yoda-digital/iris-gateway/issues/2) [#3](https://github.com/yoda-digital/iris-gateway/issues/3)
* **bridge:** replace silent TODO stub with not-implemented throw in tool scaffold ([ea8de37](https://github.com/yoda-digital/iris-gateway/commit/ea8de37239bf25ff1bc53189ba214dad83d4b98b)), closes [#29](https://github.com/yoda-digital/iris-gateway/issues/29)
* **circuit-breaker:** getState() returns computed HALF_OPEN without mutating ([e2e391a](https://github.com/yoda-digital/iris-gateway/commit/e2e391ab279cb1a5744482a9e5cf3f5169a03134))

## [1.6.0](https://github.com/yoda-digital/iris-gateway/compare/v1.5.0...v1.6.0) (2026-03-03)

### Features

* **goals:** inject user language into goal context for AI goal creation in user language ([45d13f3](https://github.com/yoda-digital/iris-gateway/commit/45d13f3645a35bc048b1863cdbcd02fe4b224523))
* **triggers:** replace TOMORROW_WORDS with chrono-node + fallback set (issue [#30](https://github.com/yoda-digital/iris-gateway/issues/30)) ([3690f99](https://github.com/yoda-digital/iris-gateway/commit/3690f993e26035b14d93d575661d6c8628c44aa4))

### Bug Fixes

* **triggers:** exclude past-tense context from tomorrow detection ([a39abe3](https://github.com/yoda-digital/iris-gateway/commit/a39abe343ec9f9b22ae280386680a19d282a9467))

## [1.5.0](https://github.com/yoda-digital/iris-gateway/compare/v1.4.0...v1.5.0) (2026-03-03)

### Features

* **arcs:** per-language stop word filtering via stopword library (issue [#33](https://github.com/yoda-digital/iris-gateway/issues/33)) ([26932d3](https://github.com/yoda-digital/iris-gateway/commit/26932d3c9a8c427489239a3ccad284c0bc0afe92))

### Bug Fixes

* resolve merge conflicts — arc-titles + stopwords merged correctly ([7fe1daf](https://github.com/yoda-digital/iris-gateway/commit/7fe1dafe81c75ec28f171059f040b74af638218f))

## [1.4.0](https://github.com/yoda-digital/iris-gateway/compare/v1.3.0...v1.4.0) (2026-03-03)

### Features

* **arcs:** async AI title generation via TitleGeneratorFn callback (issue [#31](https://github.com/yoda-digital/iris-gateway/issues/31)) ([37c1ec3](https://github.com/yoda-digital/iris-gateway/commit/37c1ec3317352cf07452a4231d6306f134faa2a0))

## [1.3.0](https://github.com/yoda-digital/iris-gateway/compare/v1.2.0...v1.3.0) (2026-03-03)

### Features

* iris init — interactive setup wizard ([#24](https://github.com/yoda-digital/iris-gateway/issues/24)) ([cb7c9ad](https://github.com/yoda-digital/iris-gateway/commit/cb7c9ad6a7f72a370dc84b976a379910ff3042c3))

### Bug Fixes

* **init:** surface EACCES error with actionable hint for sudo ([b85ef62](https://github.com/yoda-digital/iris-gateway/commit/b85ef62c594164d5a36e0ec1fd5d1c5507385932))

## [1.2.0](https://github.com/yoda-digital/iris-gateway/compare/v1.1.0...v1.2.0) (2026-03-03)

### Features

* **docker:** add docker-compose for zero-friction deployment ([b07bfcd](https://github.com/yoda-digital/iris-gateway/commit/b07bfcdba1278915545e036cf3153974d8e43ac3))
* **docker:** production-ready Dockerfile with multi-stage build ([21629d7](https://github.com/yoda-digital/iris-gateway/commit/21629d7045fd651d77e872972819d9aafb575e19))

## [1.1.0](https://github.com/yoda-digital/iris-gateway/compare/v1.0.5...v1.1.0) (2026-03-03)

### Features

* **metrics:** add Prometheus metrics infrastructure ([4777f02](https://github.com/yoda-digital/iris-gateway/commit/4777f023b2564c79dee94288419502119a4269f2))

### Bug Fixes

* **metrics:** add prom-client to package.json dependencies ([415d744](https://github.com/yoda-digital/iris-gateway/commit/415d7443767a2f492e3932fcf45c331c0ba9bd71))

## [1.0.5](https://github.com/yoda-digital/iris-gateway/compare/v1.0.4...v1.0.5) (2026-03-03)

### Bug Fixes

* **whatsapp:** document and harden reconnect strategy ([41e5cd1](https://github.com/yoda-digital/iris-gateway/commit/41e5cd136215aa4a2c360cbe4cd2a004eee7c2ce)), closes [#10](https://github.com/yoda-digital/iris-gateway/issues/10)

### Refactoring

* **intelligence:** split IntelligenceStore into domain stores ([2732942](https://github.com/yoda-digital/iris-gateway/commit/273294254d5a4f18acfaa6ee250005ad034dcab3)), closes [#9](https://github.com/yoda-digital/iris-gateway/issues/9)

## [1.0.4](https://github.com/yoda-digital/iris-gateway/compare/v1.0.3...v1.0.4) (2026-03-03)

### Refactoring

* **config:** externalize model selection — config not commits ([400ba9e](https://github.com/yoda-digital/iris-gateway/commit/400ba9e930b7bac9a6b8b5f5d2616253344bdc17)), closes [#7](https://github.com/yoda-digital/iris-gateway/issues/7)
* **gateway:** decompose lifecycle.ts into subsystem wiring modules ([7fd822f](https://github.com/yoda-digital/iris-gateway/commit/7fd822f61041b98ebc54ad938a22ce7eae3aea22)), closes [#8](https://github.com/yoda-digital/iris-gateway/issues/8)

## [1.0.3](https://github.com/yoda-digital/iris-gateway/compare/v1.0.2...v1.0.3) (2026-03-03)

### Refactoring

* **plugin:** decompose iris.ts into domain modules ([ce2bb27](https://github.com/yoda-digital/iris-gateway/commit/ce2bb27325310f159be64f29983fd98ea9e148c8)), closes [#6](https://github.com/yoda-digital/iris-gateway/issues/6)

## [1.0.2](https://github.com/yoda-digital/iris-gateway/compare/v1.0.1...v1.0.2) (2026-03-03)

### Refactoring

* **bridge:** split tool-server.ts into domain routers ([8cc0a90](https://github.com/yoda-digital/iris-gateway/commit/8cc0a9098fa9a1982d7d0852810177e93f7a2d95)), closes [#5](https://github.com/yoda-digital/iris-gateway/issues/5)

## [1.0.1](https://github.com/yoda-digital/iris-gateway/compare/v1.0.0...v1.0.1) (2026-03-03)

### Bug Fixes

* update README — test suite is green (531/531, 0 known failures) ([ab8010a](https://github.com/yoda-digital/iris-gateway/commit/ab8010a0f52924e8c2b207f96e8513646b1b0940)), closes [#4](https://github.com/yoda-digital/iris-gateway/issues/4)

## 1.0.0 (2026-02-15)

### Features

* add better-sqlite3 for vault storage ([b03e2a0](https://github.com/yoda-digital/iris-gateway/commit/b03e2a0ff3594bf3235cc39a7e05e7ae529ee3d8))
* **auto-reply:** add TemplateEngine with regex/keyword/command/schedule triggers ([7bc0d02](https://github.com/yoda-digital/iris-gateway/commit/7bc0d02aaf8435fc786f6550622ee3221b5a2c27))
* **auto-reply:** wire template engine into message router and config ([7921d69](https://github.com/yoda-digital/iris-gateway/commit/7921d69f74af5d15c56eff7cfd5b8730107419b8))
* **bridge:** add in-flight prompt counter + getQueueSize() ([60daf40](https://github.com/yoda-digital/iris-gateway/commit/60daf40b3897daf09e549301dc543f434ee54128))
* **bridge:** add vault, governance, and audit HTTP endpoints ([373e828](https://github.com/yoda-digital/iris-gateway/commit/373e828ee60a075cd690113f4df7157f6ecda2d6))
* **canvas:** add Canvas+A2UI with WebSocket, components, WebChat adapter ([e321137](https://github.com/yoda-digital/iris-gateway/commit/e3211372d4e8e985451c2b7c0c01ad1869f8f538))
* **cli:** add /cli/:toolName route to tool server ([ab0269a](https://github.com/yoda-digital/iris-gateway/commit/ab0269a11281cf56669b771cbfe214b5a493013e))
* **cli:** add CLI tool registry with command builder ([6753dfa](https://github.com/yoda-digital/iris-gateway/commit/6753dfa4e07737fdb571cbe61ff341dd08c5c39d))
* **cli:** add CLI tool type definitions ([78f263d](https://github.com/yoda-digital/iris-gateway/commit/78f263df82ab036a3921ad2f8a6630023dfbf15d))
* **cli:** add sandboxed CLI executor with tests ([3a5e31b](https://github.com/yoda-digital/iris-gateway/commit/3a5e31b8566eb95bfab198db7aa46158c4373310))
* **cli:** add security scan command ([04bd018](https://github.com/yoda-digital/iris-gateway/commit/04bd0183debb021610ef8b04e6d9675516878874))
* **cli:** auto-register CLI tools in OpenCode plugin ([2b4acc4](https://github.com/yoda-digital/iris-gateway/commit/2b4acc40ed402dd4a5ec55e5cff2dea0878b2a0d))
* **cli:** wire CLI executor and registry into gateway lifecycle ([3495a19](https://github.com/yoda-digital/iris-gateway/commit/3495a19cbfead4809ac2159d3f6070c467cfdbea))
* **config:** add CLI tool config schema and types ([8601971](https://github.com/yoda-digital/iris-gateway/commit/8601971b8fb97b49b0922e05d7e96b5f41adbf8f))
* **config:** add governance and mcp config schemas ([11936b4](https://github.com/yoda-digital/iris-gateway/commit/11936b4a2b5e0ab07253fdb70927d631590cf7fe))
* **config:** add onboarding and heartbeat config schemas ([0d28851](https://github.com/yoda-digital/iris-gateway/commit/0d28851d066947589e54a49091bf29a2ef15d9b9))
* **config:** add reasoning + tool_call model capabilities ([af28452](https://github.com/yoda-digital/iris-gateway/commit/af28452601dce2c77c1e4e6493664a32012c274d))
* **creators:** full OpenCode spec compliance + Iris architecture awareness ([fac48fe](https://github.com/yoda-digital/iris-gateway/commit/fac48feec059550084839877b41a7adbea23a228))
* **gateway:** wire vault and governance into lifecycle ([f4a4f72](https://github.com/yoda-digital/iris-gateway/commit/f4a4f728e773edda386335197d5acc7247996527))
* **governance:** add types and rule evaluation engine ([39ee17f](https://github.com/yoda-digital/iris-gateway/commit/39ee17f79061421d345cf7019145427cea14cffc))
* **heartbeat:** 5 health checkers (bridge, channel, vault, session, memory) ([0d1581b](https://github.com/yoda-digital/iris-gateway/commit/0d1581bb6956c7073aaa2b3bcb32df225ec43d4d))
* **heartbeat:** activity tracker with dormancy risk scoring ([508bf73](https://github.com/yoda-digital/iris-gateway/commit/508bf738b3a87ba0781703566c4f043a58ea69c2))
* **heartbeat:** adaptive engine with self-healing pipeline ([1525deb](https://github.com/yoda-digital/iris-gateway/commit/1525deb3dc56d2dee7c94be47c40b463549f3194))
* **heartbeat:** add active-hours gating module ([9c09edc](https://github.com/yoda-digital/iris-gateway/commit/9c09edc5ca212cfb137572f6fba49f40b0de30dc))
* **heartbeat:** add coalescer with debounce + queue gate ([b6fb83b](https://github.com/yoda-digital/iris-gateway/commit/b6fb83b5ab0e589c8e11bda1aef113648bff21ec))
* **heartbeat:** add dedup table + agent_id columns to store ([d98fcc4](https://github.com/yoda-digital/iris-gateway/commit/d98fcc44cfebe95c6f65691bbf8c9fdbd8a49644))
* **heartbeat:** add empty-check + exponential backoff module ([f5de61e](https://github.com/yoda-digital/iris-gateway/commit/f5de61eb3a61b2ed161e40f75100edf0a5e5f4bb))
* **heartbeat:** add heartbeat_status endpoint + plugin tool ([c7f1b3f](https://github.com/yoda-digital/iris-gateway/commit/c7f1b3f3b41fe54d57044ce3a831a01ddfb56f41))
* **heartbeat:** add per-channel visibility module ([86082d4](https://github.com/yoda-digital/iris-gateway/commit/86082d4049b92f64a02cb4247856b7a901174f92))
* **heartbeat:** add v2 config types + Zod schema ([c1d9ed1](https://github.com/yoda-digital/iris-gateway/commit/c1d9ed17bffc190f0930f5607d5a65ea24c49f7f))
* **heartbeat:** refactor engine for multi-agent + all v2 features ([1947da6](https://github.com/yoda-digital/iris-gateway/commit/1947da6933c08c390b1f8bd8b8120a12298f3a47))
* **heartbeat:** store with log, actions, and status tracking ([581ba20](https://github.com/yoda-digital/iris-gateway/commit/581ba20fb13ca357b9a9001ca5627c8a8a45d19b))
* **heartbeat:** update plugin tools + add heartbeat_trigger ([256c5e5](https://github.com/yoda-digital/iris-gateway/commit/256c5e52b6e06ddc414d9664a3ab0669bac8ee15))
* **heartbeat:** wire getQueueSize + multi-agent types to lifecycle ([df7d2af](https://github.com/yoda-digital/iris-gateway/commit/df7d2af7c7c472b086e87c36faedffd388e909fc))
* **intelligence:** add 7-subsystem intelligence layer (v0.2.0) ([10639a9](https://github.com/yoda-digital/iris-gateway/commit/10639a95071bfc41fb590a3e1a38c9cf9d816c84))
* **lifecycle:** wire onboarding enricher + heartbeat engine into gateway ([c7728c3](https://github.com/yoda-digital/iris-gateway/commit/c7728c35afd9df60917849fd5af38df9b565d3a7))
* **mcp:** add sequential-thinking MCP server ([18df650](https://github.com/yoda-digital/iris-gateway/commit/18df65064c9f29248a9d89439ef0fe68fbf0ce6c))
* **models:** multi-model routing strategy with role-based agent assignments ([f12533b](https://github.com/yoda-digital/iris-gateway/commit/f12533b8de2554972ceec9d17d498574fc50f50b))
* **model:** switch primary to aurora-alpha ([fd554c8](https://github.com/yoda-digital/iris-gateway/commit/fd554c8a6b54542797fba1045ea4640e3a5746eb))
* **model:** switch primary to glm-4.5-air ([f7b5301](https://github.com/yoda-digital/iris-gateway/commit/f7b53016bfe7e62a7d8143f3a8940324eacd0ba2))
* **onboarding:** first-contact meta-prompt injection in MessageRouter ([3c144eb](https://github.com/yoda-digital/iris-gateway/commit/3c144eb4ad721a462794f46504d797a93f7100ca))
* **onboarding:** language-agnostic enricher + heartbeat v2 plans ([edf3aa5](https://github.com/yoda-digital/iris-gateway/commit/edf3aa570106bec7d75a1b46764a61d5ca15ca09))
* **onboarding:** profile enricher with language, name, and style detection ([ba2816a](https://github.com/yoda-digital/iris-gateway/commit/ba2816a0bd5eb340300b574a6769173c9ba662e6))
* **onboarding:** signal store with types and consolidation ([1f52ff1](https://github.com/yoda-digital/iris-gateway/commit/1f52ff12cf0c1560aaad96406bd0779b4b8ebadf))
* **plugin:** create Iris OpenCode plugin with 9 tools and 6 hooks ([24a58fb](https://github.com/yoda-digital/iris-gateway/commit/24a58fbe412d4ec45b2824b2d877d96a41f68c4e))
* **plugins:** add HookBus for plugin event dispatch ([c7a4605](https://github.com/yoda-digital/iris-gateway/commit/c7a46055963e6df3a3a565dded6342af5c06a473))
* **plugins:** add plugin type definitions ([b4eaa73](https://github.com/yoda-digital/iris-gateway/commit/b4eaa73ea52662150a0ef52e480743a3a940838e))
* **plugins:** add PluginLoader with Jiti + security scanning ([469a0e3](https://github.com/yoda-digital/iris-gateway/commit/469a0e3ea7a7e87d30c6213f15fdae12a31918ba))
* **plugins:** add PluginRegistry with tool/channel/service/hook registration ([96536ab](https://github.com/yoda-digital/iris-gateway/commit/96536ab6cfb5a1697ec090389df5cef64d117e5e))
* **plugins:** dynamic tool registration from plugin manifest ([8447440](https://github.com/yoda-digital/iris-gateway/commit/844744005b7a0d3eda87603add89cfc90ab3ba70))
* **plugins:** wire Plugin SDK into lifecycle, config, and tool-server ([e1b2a44](https://github.com/yoda-digital/iris-gateway/commit/e1b2a44f1b98d6ee182ca656b566bf4d54f915b7))
* **policy:** master policy engine — structural ceiling for all agents ([fdc96de](https://github.com/yoda-digital/iris-gateway/commit/fdc96de8c1883c102683e7e65631eb19cd98545c))
* **proactive:** 7 plugin tools + system prompt injection ([10f9145](https://github.com/yoda-digital/iris-gateway/commit/10f9145372244618219f912ee7da5caa3dd7a178))
* **proactive:** add 7 tool server endpoints ([9846552](https://github.com/yoda-digital/iris-gateway/commit/9846552d90e710af8fed8794dd2a919a504a6fba))
* **proactive:** add types and config schema ([f7ba4e2](https://github.com/yoda-digital/iris-gateway/commit/f7ba4e246c251c572a966497ad36adf7c5af4c6a))
* **proactive:** intent store with schema, CRUD, quotas, engagement ([a1a5b90](https://github.com/yoda-digital/iris-gateway/commit/a1a5b90da7b4a8bdfbd4081e9b9afcfc2935c643))
* **proactive:** pulse engine with intent/trigger execution ([b8f452a](https://github.com/yoda-digital/iris-gateway/commit/b8f452a53a2b852a9c9857b36e34b8ecc77dceef))
* **proactive:** thread category from AI through intent pipeline ([5d44d89](https://github.com/yoda-digital/iris-gateway/commit/5d44d897e8c61ba0597a2c465183a7414c5637f2))
* **proactive:** wire intent store + pulse engine into lifecycle ([06017c9](https://github.com/yoda-digital/iris-gateway/commit/06017c9fe14883e66c43c0ddcced29d5d5971f31))
* **router:** add /new and /start commands to reset session ([8469109](https://github.com/yoda-digital/iris-gateway/commit/84691093c650271efd0f68d138b2b201fb8ec769))
* **security:** add code security scanner with 10 detection rules ([a7ddd32](https://github.com/yoda-digital/iris-gateway/commit/a7ddd3254fb4c27849a395094a066cde41297af0))
* **skills,agents:** add CRUD endpoints, OpenCode tools, and tests ([4df16c6](https://github.com/yoda-digital/iris-gateway/commit/4df16c6f85830cbe72bd3a6c8e78cce2e837bebb))
* **skills:** add 5 Google Workspace skills + CLI debug tracing ([d9abdeb](https://github.com/yoda-digital/iris-gateway/commit/d9abdebee5cc98f91e10990150b2318d33b9a286))
* **skills:** enrich existing + add onboarding, summarize, web-search skills ([f9c687d](https://github.com/yoda-digital/iris-gateway/commit/f9c687dee60cc2d83a8643a9cd1769a367ae3c9d))
* **streaming:** add StreamCoalescer with paragraph/sentence/word breaking ([380f17e](https://github.com/yoda-digital/iris-gateway/commit/380f17e7ac2c01022362c2bbe0312e64ba0fa6d8))
* **streaming:** wire StreamCoalescer into event handler and message router ([0cdd756](https://github.com/yoda-digital/iris-gateway/commit/0cdd7565b78b2c44f4741ce670700f27016e57e0))
* **usage:** add usage types and DB schema ([f17206e](https://github.com/yoda-digital/iris-gateway/commit/f17206e5c50c756f32db8b0e174bbba38406b6db))
* **usage:** add UsageTracker with record/summarize ([a5a5acd](https://github.com/yoda-digital/iris-gateway/commit/a5a5acdbc21d0da36ba1a587370faff1e9a86876))
* **usage:** wire tracking into event handler, tool-server, and lifecycle ([90fbdb7](https://github.com/yoda-digital/iris-gateway/commit/90fbdb7dc0b0f7ef111e0d8cf7d4f0aa4a68f86e))
* **vault:** add FTS5 full-text search for memories ([3cf38af](https://github.com/yoda-digital/iris-gateway/commit/3cf38af593f7dbcd7980c63df630fbc8356213da))
* **vault:** add memory, profile, and audit types ([d90ed57](https://github.com/yoda-digital/iris-gateway/commit/d90ed579e212bb742dcd4749178cabbf3a091375))
* **vault:** add memory/profile/audit CRUD store ([8be2f5f](https://github.com/yoda-digital/iris-gateway/commit/8be2f5fa0d995f5fbb483615bf44890adc14b6d7))
* **vault:** add SQLite database with FTS5 and schema migration ([1a0657d](https://github.com/yoda-digital/iris-gateway/commit/1a0657d194a7fa103a99f280f516f4cd5013fe29))

### Bug Fixes

* **agents:** stop instructing model to use send_message for replies ([4587841](https://github.com/yoda-digital/iris-gateway/commit/4587841fb9c038aa3a299cb5eb55e7090fd7487b))
* **arcs:** replace ASCII-only regex with Unicode-aware keyword extraction ([7d07d4b](https://github.com/yoda-digital/iris-gateway/commit/7d07d4b0c554f2522c0f186c55819e7bc15bbf85))
* **bridge:** fix race condition in sendAndWait stability detection ([8d8e2cd](https://github.com/yoda-digital/iris-gateway/commit/8d8e2cdeebc15113b1968d76df1a954c5add4530))
* **bridge:** handle reasoning-only and tool-call-only model responses ([d690f33](https://github.com/yoda-digital/iris-gateway/commit/d690f3376d14a6bd8745afdcc2061f3edaa4b209))
* **bridge:** restore sendAndWait polling — SSE is disabled ([14e924f](https://github.com/yoda-digital/iris-gateway/commit/14e924ff9a1ece533a590d640c9002d3573dc6da))
* **bridge:** strip leaked thinking tags + switch to llama-3.3-70b ([74b307e](https://github.com/yoda-digital/iris-gateway/commit/74b307e76425781c3ee3edb9452d49929cb290cc))
* **bridge:** treat empty assistant message as placeholder, not completion ([47033db](https://github.com/yoda-digital/iris-gateway/commit/47033db2bddb8eb27a362838f1fa90b7cc9b4a14))
* **ci:** specify pnpm version in action-setup ([4b0d081](https://github.com/yoda-digital/iris-gateway/commit/4b0d0815510010beb792e5529b1efd684922bc66))
* **ci:** use pnpm v10 to match project workspace format ([fa02d94](https://github.com/yoda-digital/iris-gateway/commit/fa02d94a0c1fd3541e8f5cc9f14ab2df56d801ed))
* **gateway:** add OpenCode readiness check to prevent startup race condition ([a46c0d7](https://github.com/yoda-digital/iris-gateway/commit/a46c0d76a917d097fad190eb2a1feb37885a2a61))
* intelligence logging, polling robustness, gmail skill, proactive engine ([05de326](https://github.com/yoda-digital/iris-gateway/commit/05de326818f29672a8ab649f0620e9c14d942803))
* **mcp:** use correct OpenCode McpLocalConfig format ([75c7b51](https://github.com/yoda-digital/iris-gateway/commit/75c7b5194d1b4d1721989f0b1899101cc0b9eee8))
* **model:** back to trinity-large-preview (step-3.5-flash leaks reasoning too) ([46e38d1](https://github.com/yoda-digital/iris-gateway/commit/46e38d1200d0afd13586c3319ac92ac73d6e7054))
* **model:** switch back to trinity-large-preview (llama-3.3 hangs on warmup) ([c2c8c49](https://github.com/yoda-digital/iris-gateway/commit/c2c8c49035387e1d9e4972a2d673054b10d1127b))
* **model:** switch from gpt-oss-120b to trinity-large-preview ([cd5a94e](https://github.com/yoda-digital/iris-gateway/commit/cd5a94e21cad249d05c7a166edc5f2464aec007f))
* **plugin:** resolve invalid_union error and add proactive skill system ([34bbf9b](https://github.com/yoda-digital/iris-gateway/commit/34bbf9bc1940fca9f8afe3e596f95d6e3b15ae39))
* **proactive:** persist category field in database ([8ba4490](https://github.com/yoda-digital/iris-gateway/commit/8ba4490a17b6249188f9770b48ad7bc26d7441a4))
* **test:** add missing sendAndWait method to MockOpenCodeBridge ([b732cfb](https://github.com/yoda-digital/iris-gateway/commit/b732cfb9f4d7afd975d35ba940ab37127bf3e3ee))
* **triggers:** handle edge cases in time validation and question detection ([bb42d2d](https://github.com/yoda-digital/iris-gateway/commit/bb42d2d2bc5987271e8c288f8f1ea832f372c408))
* **triggers:** replace multilingual regex with structural pattern detection ([184f711](https://github.com/yoda-digital/iris-gateway/commit/184f7111f2e50a85d03dc6497ff36079d4d2259f))
* wire agent identity and vault context resolution ([8cb72ed](https://github.com/yoda-digital/iris-gateway/commit/8cb72ed01a850cc0bab5444e2309b869792657f4))
* wire missing vault/governance endpoints, add cookbook ([2140434](https://github.com/yoda-digital/iris-gateway/commit/2140434e0fc32a36166376a08c0580bd59c0c92c))

### Refactoring

* **intelligence:** replace keyword categorizer with AI-driven passthrough ([7dceda6](https://github.com/yoda-digital/iris-gateway/commit/7dceda614650d07981e43c05e253ff1d19887bed))
* remove tool stubs (consolidated into plugin) ([5d4e02b](https://github.com/yoda-digital/iris-gateway/commit/5d4e02b0558455a7a76b64c045721b2c950f16d1))
