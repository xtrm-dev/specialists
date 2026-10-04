# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed
- Remove the `install` package bin so it no longer shadows GNU coreutils `install` on `PATH` after a global install (SPECIALISTS-4223). Use `specialists init`.

## [4.0.5] - 2026-10-04

### Added
- Add an operator surface to list and reconcile uncertain writer leases (SPECIALISTS-4251) ([3d3b7e8](https://github.com/xtrm-dev/specialists/commit/3d3b7e8e204adeae58e9fddf4552c89696d9d47f))

### Fixed
- Dedupe process channel wake vs wake-watch fallback (SPECIALISTS-4214) ([3521f83](https://github.com/xtrm-dev/specialists/commit/3521f83fcf97a18b232ca913777f6cd24e95b1cd))
- Read the wake ack from the wrapped channel prompt ([e5d21f8](https://github.com/xtrm-dev/specialists/commit/e5d21f8cbeb84b77641c6d4d2eab7cd51e629873))
- Match the channel tag attributes with literal patterns ([f601306](https://github.com/xtrm-dev/specialists/commit/f6013068f9629b084f3689a17920fbb393ce6f7d))
- Read leases from the directory the runtime writes them to (SPECIALISTS-4250) ([3f9082f](https://github.com/xtrm-dev/specialists/commit/3f9082f942fcfeebaa20f4737a017c52e814864a))
- Expose specialist_retry on the v2 MCP server (SPECIALISTS-4252) ([1d67f86](https://github.com/xtrm-dev/specialists/commit/1d67f86ad769415d798f01d10b764a15cbc3934c))
- Push one failed wake per fallback walk, not one per failed model leg (SPECIALISTS-4253) ([f4c72ce](https://github.com/xtrm-dev/specialists/commit/f4c72ce62218a8e702a73f48ee73ea6ad549cfdb))

### Project maintenance
- Publish to npm with trusted publishing (GitHub OIDC) ([adb5309](https://github.com/xtrm-dev/specialists/commit/adb5309006712e73d47b3498e3ff7c96ae4593c9))
- Regenerate dist for the channel read_with change with bun 1.3.14 ([f2aaaa0](https://github.com/xtrm-dev/specialists/commit/f2aaaa058a8ab46c8eb03e2017e577e54fe00a35))
- Regenerate dist for the lease identity fix with bun 1.3.14 ([aa6e40f](https://github.com/xtrm-dev/specialists/commit/aa6e40f6cc2402c1e4e121f4311fcce5e7c7c288))
- Regenerate dist for the lease operator surface with bun 1.3.14 ([5c81fa7](https://github.com/xtrm-dev/specialists/commit/5c81fa78e7a7ae18973e256747d2a93c85fe1c76))
- Regenerate dist for the v2 retry registration with bun 1.3.14 ([6f9cf2c](https://github.com/xtrm-dev/specialists/commit/6f9cf2c06c134d33b1ccd86e90c8293e60ef7cfc))
- Regenerate dist for the fallback failed-wake fix with bun 1.3.14 ([89fc910](https://github.com/xtrm-dev/specialists/commit/89fc910a5cff9dd701ef351ca0db585d1befdac5))

## [4.0.4] - 2026-10-03

### Added
- Unrailed wake cards, white dot chrome, italic result excerpt with ctrl+o expansion ([34b36e8](https://github.com/xtrm-dev/specialists/commit/34b36e803192477c7390c6093095229f440520a6))
- Draw Specialists wakes and MCP calls as teammate rows ([0726bc1](https://github.com/xtrm-dev/specialists/commit/0726bc1168d70fad8c8ffd62bba2cdaaee8b3c36))
- Shape Specialists wake rows like Claude Code teammate rows ([a514a67](https://github.com/xtrm-dev/specialists/commit/a514a67a16dcb066f26873d1c99990c889e83d3f))
- Add specialist_result to the Pi extension ([1c8635d](https://github.com/xtrm-dev/specialists/commit/1c8635d39cfe472aaadce15a24500fa7943400b6))
- Add specialist_result to read one activation's full result ([56f9dc0](https://github.com/xtrm-dev/specialists/commit/56f9dc0c6a329b99dc01a33164211f24a50ce725))

### Fixed
- Find a globally installed runtime from a marketplace-installed plugin ([100c5ff](https://github.com/xtrm-dev/specialists/commit/100c5ffd7ad75428ac549463fc1e238941756aea))
- Load the plugin hook scripts under bun builds without node:sqlite ([ad604b2](https://github.com/xtrm-dev/specialists/commit/ad604b2cc43508a0dab01e6708b56554c6da9076))
- Serve only the legacy MCP revision under the Claude Code plugin so the channel wake works ([78d20cd](https://github.com/xtrm-dev/specialists/commit/78d20cd936868ee03b7d4ab74007b8f962e437ed))
- Draw Specialists transcript rows from a companion plugin, specialists-ui ([f79d095](https://github.com/xtrm-dev/specialists/commit/f79d095c9445763b22b37ab99cfbf9635c4da060))
- Draw Specialists tool calls as native Claude Code tool rows ([45d6da2](https://github.com/xtrm-dev/specialists/commit/45d6da2252b81bf63f6fc1a59f10557812cda245))
- Indent the Specialists tool result line without the ⎿ marker ([aea4d59](https://github.com/xtrm-dev/specialists/commit/aea4d597e621359af5ffd13d1edc4b76a371fa56))
- Leave a blank line above each specialists-ui row, like native rows ([e1b3a38](https://github.com/xtrm-dev/specialists/commit/e1b3a38ccdbbbd5a70cf7b6c6ada72e7ec28d225))

### Performance
- Stop rebuilding the specialist registry on every status poll (SPECIALISTS-4217) (#417) ([1f3bee3](https://github.com/xtrm-dev/specialists/commit/1f3bee3ba75a9fc875e06c6bacc54718d43bef57))

### Project maintenance
- Document the managed settings and launch flag the channel wake needs ([6bb6995](https://github.com/xtrm-dev/specialists/commit/6bb69959054a32baf30fcfe2c00870be809e9fd8))
- Regenerate dist with bun 1.3.14 to match CI ([8247e5a](https://github.com/xtrm-dev/specialists/commit/8247e5a6755de851c173d63ab7e6c42cd923c9c9))
- Name both Claude Code plugins in the README ([827909b](https://github.com/xtrm-dev/specialists/commit/827909ba8d4c260c9e36fcd86d5df4f8b56a2822))
- List everything the Claude Code plugins need, and the fallback wake ([58ab473](https://github.com/xtrm-dev/specialists/commit/58ab473232bd0503d5f047e2d5c0ae4055504e78))
- Regenerate the asset contract for the using-specialists skill change ([18d1027](https://github.com/xtrm-dev/specialists/commit/18d1027d8c98b4384129aa093c4def8292078d88))
- Regenerate dist for specialist_result with bun 1.3.14 ([9a37ebd](https://github.com/xtrm-dev/specialists/commit/9a37ebd3fa63fb80d538098918ca327bc73ccfd4))

## [4.0.3] - 2026-10-02

### Added
- Rename Pi extension to native-specialists and register it in Pi by default (#418) ([b767969](https://github.com/xtrm-dev/specialists/commit/b767969fde2ff32421e3259fc6126ef6c7e16574))

## [4.0.2] - 2026-10-01

### Added
- Make the coordinator tools reachable from codemode (pi 0.99) ([690d200](https://github.com/xtrm-dev/specialists/commit/690d2003c931148986e7559855819c435e0469c4))

## [4.0.1] - 2026-10-01

### Fixed
- Load Substrate from published dist builds as well as checkouts ([48c07b5](https://github.com/xtrm-dev/specialists/commit/48c07b5472b256a5766686b45a6258118609f6ca))

### Project maintenance
- Regenerate dist for the dual-layout Substrate loader ([5612962](https://github.com/xtrm-dev/specialists/commit/56129620e15409d2c2543ee2f09b26cc06bf8013))

## [4.0.0] - 2026-09-28

### Added
- Report catalog pins against the installed extensions (#355) ([081522d](https://github.com/xtrm-dev/specialists/commit/081522d7f647dd6112c9b10d23d17c8fad2a5bf3))
- Run the catalog guard on a schedule, not only when someone runs doctor (#357) ([2ca49be](https://github.com/xtrm-dev/specialists/commit/2ca49be57b51cc2d04820126a364fdbc958c155f))
- Automatic bounded settlement publication (S1) (#360) ([67100f1](https://github.com/xtrm-dev/specialists/commit/67100f1362c01f0972e081795be805297be8e8a9))
- Discover-then-pin enabled extension tools into the effective contract ([e4ba991](https://github.com/xtrm-dev/specialists/commit/e4ba991bfb5bfc17d6cb84c062a7c3861763183c))
- Show the dispatch identity as <specialist>:<activation-id> in the fleet row ([40d7cbb](https://github.com/xtrm-dev/specialists/commit/40d7cbb77f8047dc754a7f74f8ffb7897ac66350))
- Stamp dispatching pane lineage on specialist tmux panes ([9e41927](https://github.com/xtrm-dev/specialists/commit/9e4192707f9ce3c050a48fe8717e7f250c01e3a9))
- Preserve authoritative Pi usage and cost (SPECIALISTS-120) (#394) ([62f8513](https://github.com/xtrm-dev/specialists/commit/62f85131c76ad7db57c3600d23dbea7fbf5b1ccd))
- Steer running activations; compact tool output by default ([64dda76](https://github.com/xtrm-dev/specialists/commit/64dda764995ed263c52e60e09e1547c7505cf9a9))
- Native metrics rows; accumulated elapsed_ms ([0f6fb9c](https://github.com/xtrm-dev/specialists/commit/0f6fb9cc0763d9879c9d09221a72f2ff68fb4676))
- Add Substrate issue-ref identity discipline ([ee275ce](https://github.com/xtrm-dev/specialists/commit/ee275cea43f54ea4b14bd6c64f0e13a7fa4679a6))
- Cut planner over to Substrate contract semantics ([c8b67c7](https://github.com/xtrm-dev/specialists/commit/c8b67c7a883c01c91c03b96e04721afaadb2b759))
- Make sync-docs consume pinned Issue scope ([25909ff](https://github.com/xtrm-dev/specialists/commit/25909ffe7011a6b5f554816724e9e010b653c691))
- Make chain coordinator Substrate-authority safe ([d7b20a8](https://github.com/xtrm-dev/specialists/commit/d7b20a8bde77f0dbcadc268443b58ad9d6325fdb))
- Migrate executor contract and follow-up semantics to Substrate ([c140338](https://github.com/xtrm-dev/specialists/commit/c14033874330c46066a14d616e3a5015b87eb3a9))
- Migrate debugger follow-up semantics to Substrate ([0bcb88f](https://github.com/xtrm-dev/specialists/commit/0bcb88f5c10fbf31e60be815806fb63a3047e39f))
- Make obligations scanner track Substrate Issue refs ([6f44cc6](https://github.com/xtrm-dev/specialists/commit/6f44cc657b57433bdb7e018daa5871efc4693ca3))
- Pin reviewer authority to Substrate Issue revision ([463c4a0](https://github.com/xtrm-dev/specialists/commit/463c4a016c4ce32286b08a5f92861f845bb6dbca))
- Make seconder compare diff against pinned Issue contract ([dee6b1a](https://github.com/xtrm-dev/specialists/commit/dee6b1a05a548a45e4398ffd41a9e4c59f8fa23a))
- Make security auditor use pinned Issue authority ([4f2d7ad](https://github.com/xtrm-dev/specialists/commit/4f2d7ad18d38c0fa67116f67698836267b1d885f))
- Migrate test engineer scope authority to Substrate ([2cd856c](https://github.com/xtrm-dev/specialists/commit/2cd856c909fbd009bada1ad85b8f3d13a7107d0b))
- Migrate service knowledge sync to Issue/Journal lifecycle ([d98a9a6](https://github.com/xtrm-dev/specialists/commit/d98a9a634b3833617863c7e78d1031f2828e49a5))
- Migrate changelog keeper to Issue authority ([2aa0f0e](https://github.com/xtrm-dev/specialists/commit/2aa0f0ea038256b18c706bc5ea2b382de4bdd8c2))
- Teach specialist creator Substrate-native doctrine ([2c726b7](https://github.com/xtrm-dev/specialists/commit/2c726b762dfd0c3ac4a7f95fb42248afb516f15e))
- Add Claude native Specialists fleet pane spike ([24360d6](https://github.com/xtrm-dev/specialists/commit/24360d66325350ae742e3d88c2ed7dd0323416be))
- Register Claude Mod fleet module ([f2b547a](https://github.com/xtrm-dev/specialists/commit/f2b547ab0f3912d3db3591c481bd26b4aaa4140c))
- Live Specialists fleet band and controls as a Claude Mod ([7a8e36b](https://github.com/xtrm-dev/specialists/commit/7a8e36b2a1750b5e9f91f48b67a434dc6a970aa7))
- Fold the fleet band above 3 activations into a temporary pane ([0fcd9d2](https://github.com/xtrm-dev/specialists/commit/0fcd9d238d59e9ef72b9ae4fbae48ab5495e2b2d))

### Fixed
- Re-acquire and release the workspace lease across a fallback walk (#356) ([540c00c](https://github.com/xtrm-dev/specialists/commit/540c00cce612488c91d5d20e50a14cf7c9fe0635))
- Release the lease when a prompt rejects without settling (#358) ([393ed7a](https://github.com/xtrm-dev/specialists/commit/393ed7a649c9f95dc027c6b35ba29932a540cf7b))
- Name the created issue on every refusal after inlineCreate (#359) ([d2dfc9c](https://github.com/xtrm-dev/specialists/commit/d2dfc9ca0f15490cbf16d35b7be89889a6253b75))
- Release the inline claim when the dispatch is refused (#362) ([53fca13](https://github.com/xtrm-dev/specialists/commit/53fca131ee9257ba4a489be78e10a1eb303c58ef))
- Stop the beads_* overrides and a drifted user.json from failing silently (#363) ([f35b875](https://github.com/xtrm-dev/specialists/commit/f35b87530153e46833a5492f810b407e946cb8b0))
- Pi-compat validates the pi the runtime actually loads (#364) ([37d9f43](https://github.com/xtrm-dev/specialists/commit/37d9f4312438c179cc33eb85f9f9acfda1b0f77f))
- Ephemeral ports and cleanup that survives an interrupted run (#365) ([ce33c31](https://github.com/xtrm-dev/specialists/commit/ce33c313e2603fda503ab0f3153c770915f0d809))
- Closeout — real parity, a real root cause, exactly-once publication (#367) ([c99a3c2](https://github.com/xtrm-dev/specialists/commit/c99a3c2c8fec9a5e39ba4dc9ec7ddb8b2582c0a3))
- Stop presenting the native path as complete when Substrate is absent (#368) ([8c26258](https://github.com/xtrm-dev/specialists/commit/8c262582091f34ee3e32c2f058dabc5a27ae2853))
- A resolved Substrate package is not a loadable one (#370) ([9ceccac](https://github.com/xtrm-dev/specialists/commit/9ceccac924a2a5563d51f16f1f83fef8580e9a92))
- Resolve npm: extension sources under native dispatch ([34d2ba7](https://github.com/xtrm-dev/specialists/commit/34d2ba799fba2773455d1a535d3b8e7f3ce64e92))
- Settlement publication is exactly-once across processes, not just within one ([07ecb68](https://github.com/xtrm-dev/specialists/commit/07ecb683f572e0f5a41d45350aafdfca5538d7de))
- Resolve npm: extension sources under native dispatch ([57a2c75](https://github.com/xtrm-dev/specialists/commit/57a2c75872115c88d2aeb3794501ecd21dcc3e9d))
- Refuse shadowed granted names, harden ask/escalate, mixed-baseline, probe verdict (round 2) ([f0f4897](https://github.com/xtrm-dev/specialists/commit/f0f4897a85d91de6ce3c334675c02553d22e07a2))
- R3.1 catalog reserved set, R3.2 required param, R3.3 tests, R3.4 comments ([2fe65f5](https://github.com/xtrm-dev/specialists/commit/2fe65f50c973644ecea6b8451d55e6191ebe8285))
- Resolve declared git: sources to pi checkout cache with attribution pinning ([6ae4c7e](https://github.com/xtrm-dev/specialists/commit/6ae4c7ea0fb664050c6a77cb554c15d19f9503bb))
- Name the admission mechanism of the path that prints the contract ([36d5a86](https://github.com/xtrm-dev/specialists/commit/36d5a8617a489f83d32d0b244fe669a9a5fd69fb))
- Parse native activation identities atomically (XTRM-93 N2A) ([b8f3446](https://github.com/xtrm-dev/specialists/commit/b8f34462952f51f64ec1b03d05de2754c960950f))
- Read native activations by identity from the shared families (XTRM-93 N2B) ([c8510d6](https://github.com/xtrm-dev/specialists/commit/c8510d605d04f28fc2c656b055c1ae10fa4d5645))
- Verify attempt existence instead of synthesizing it (XTRM-93 N2A review fix) ([0292b22](https://github.com/xtrm-dev/specialists/commit/0292b22508d15df0a80cdaed23cab48d8da5722c))
- Read status payloads, surface failures, and label window counts (XTRM-93 N2B review fix) ([2603358](https://github.com/xtrm-dev/specialists/commit/2603358eb525ad407b841c7e3a48ca785626335d))
- Make the primary Supervisor suite reachable (unitAI-9n93) ([fe2dcc5](https://github.com/xtrm-dev/specialists/commit/fe2dcc558cf3bd85ba6986bf1ad0f937904964b5))
- Resolve positional identity against the node resolver, not syntax (XTRM-93 N2A) ([813e3b0](https://github.com/xtrm-dev/specialists/commit/813e3b012781543bd6715ddd0eb5111ac0f9cb4a))
- Xtrm_llm_tokens_total read a shape the writer never produces (XTRM-93 N3) ([180c6b7](https://github.com/xtrm-dev/specialists/commit/180c6b787511fd9fa598ae01404ae2deb9a7d3c4))
- Enumerate latest-N activations instead of the latest-1000 event rows (XTRM-93 unitAI-kmbb9) ([8f7009d](https://github.com/xtrm-dev/specialists/commit/8f7009d0c41e97bc49d2a6720e52156ed88c3c26))
- Derive the forbidden observability dir through the production resolver (SPECIALISTS-99) ([0f1d413](https://github.com/xtrm-dev/specialists/commit/0f1d4134c4b8118a8f0545ababe08f3601734f68))
- Make the native event mapper total so unmapped names cannot be dropped silently (XTRM-93 N3.4) ([03cb33e](https://github.com/xtrm-dev/specialists/commit/03cb33e1b36750b265d09ce7becdcf8569e8aaf7))
- Replace source-string needles with execution proofs; preserve model_fallback diagnostics (SPECIALISTS-103) ([0125c57](https://github.com/xtrm-dev/specialists/commit/0125c577617a7de4ab100d5e20be362b9ce36066))
- Resolve --mine BEFORE the activation bound instead of filtering its survivors (SPECIALISTS-104) ([fb3c27a](https://github.com/xtrm-dev/specialists/commit/fb3c27a17772ffccf56d2958f4533d4182a1fff3))
- Fail closed when --mine cannot be evaluated, instead of broadening the filter (SPECIALISTS-104) ([d63d992](https://github.com/xtrm-dev/specialists/commit/d63d992c20ff4233a42acccb90ab2af6aeaa9d5d))
- Native tool_duration stale-warning producer (SPECIALISTS-102, XTRM-93 N3) ([840cf72](https://github.com/xtrm-dev/specialists/commit/840cf728c03a4162a407206905b258e674878530))
- Status.error pollution from warning emits; spec threshold parity (SPECIALISTS-102 follow-up, PR #387 review) ([ec69c6c](https://github.com/xtrm-dev/specialists/commit/ec69c6c53a3853b33330beb12eca83d8c292c183))
- Split out attempt-adoption; timer teardown tests; comment truth; legacy-faithful threshold guard ([8fbf5a8](https://github.com/xtrm-dev/specialists/commit/8fbf5a8639408bf69154df0b46d39d93eb5282c7))
- Phase accounting flushes open phases and re-enters running on resume (SPECIALISTS-106, XTRM-93 N3 Lane D) ([cba5f30](https://github.com/xtrm-dev/specialists/commit/cba5f30dd4eae8ba302a482bb1e88aa1da0c95cd))
- Telemetry-contract gate covers native mapper + runs sqlite file (SPECIALISTS-110) ([1ad3950](https://github.com/xtrm-dev/specialists/commit/1ad39508d388c72af7dc6765a29d73ef89266e9b))
- Machine-check declared-vs-executed set in telemetry-contract gate ([d4e4d92](https://github.com/xtrm-dev/specialists/commit/d4e4d92b44112c6fb5e79b2d6e7a8c7aeb446a56))
- Gate rejects vacuous suites and trigger-uncovered declarations ([6395222](https://github.com/xtrm-dev/specialists/commit/6395222f1281f0b9cf1fe37b8006e778539a4960))
- Enforce bun:sqlite suites and N3 oracle; re-point quarantine to SPECIALISTS-121 ([9d76265](https://github.com/xtrm-dev/specialists/commit/9d76265d8eb4b4e3ae066f1d3f71c6cb2de4223c))
- True oracle extraction; vacuity-proof canonical-oracle job ([6fe0892](https://github.com/xtrm-dev/specialists/commit/6fe0892a5858553af4beace68c20acac4228c150))
- Truthful docs, mixed-ownership label, bun-sqlite executed-set guard, manifest floor ([bfe6e72](https://github.com/xtrm-dev/specialists/commit/bfe6e72fdf1d0870350369ff18216eb83a14194f))
- Close native-mapper-totality fail-open holes (SPECIALISTS-111) ([df778b7](https://github.com/xtrm-dev/specialists/commit/df778b7400f547706c89bfe90148b1a0b358804a))
- Derive mapper guard comments from parser trivia ([d8224eb](https://github.com/xtrm-dev/specialists/commit/d8224eb93cf4ffb6723fb86dae938fa8cbb1ea92))
- Sink adopts the event-carried attempt id (SPECIALISTS-113) ([bdb374e](https://github.com/xtrm-dev/specialists/commit/bdb374e9d097b165662df3779474e099f5c45341))
- Flush endpoint is the last job-produced event (SPECIALISTS-119) ([7ce63fd](https://github.com/xtrm-dev/specialists/commit/7ce63fd6309c1c15287184ab2910e0c6e753ad2a))
- Persist configured/requested model and prove the fallback chain end to end (SPECIALISTS-123) ([563ceff](https://github.com/xtrm-dev/specialists/commit/563ceff08b1ca78ec0287fc909cb050fa2bf8411))
- Make Substrate Issue revision the specialist authority ([eeed16d](https://github.com/xtrm-dev/specialists/commit/eeed16de756f34b4fccf4a1188e464c035269b73))
- Align git workflow with Substrate claim and Closure semantics ([fee3f31](https://github.com/xtrm-dev/specialists/commit/fee3f3125803b6048687394b8c378b01c4fd2c10))
- Migrate executor delivery from bead lifecycle to Issue/Journal/Closure ([f4ee536](https://github.com/xtrm-dev/specialists/commit/f4ee5360bfb3fabc73afc6fbd338580792a8e84f))
- Retire Beads workflow quick-rules injection ([b8dc228](https://github.com/xtrm-dev/specialists/commit/b8dc228fc022c295b5cef3336d2b8dc3015009b6))
- Remove residual bead authority wording from executor ([50915b5](https://github.com/xtrm-dev/specialists/commit/50915b5fd8414466f399f1d5458ca5070b793637))
- Remove residual mutable-bead review semantics ([2ded2d4](https://github.com/xtrm-dev/specialists/commit/2ded2d4269bcd9452784376671b8dd3d33cb4c82))
- Remove residual bead wording from seconder ([086bac1](https://github.com/xtrm-dev/specialists/commit/086bac133316660dcf41a07d51fb2c83fb92ba3e))
- Remove residual bead scope wording from security auditor ([77f704a](https://github.com/xtrm-dev/specialists/commit/77f704aa0138caeb681c183833743ce2859f7afc))
- Remove residual bead-context control from service sync ([c75720c](https://github.com/xtrm-dev/specialists/commit/c75720cfa7593fcfb1c7efc43746fd983ac586ff))
- Remove residual bead wording from test engineer ([ce1320e](https://github.com/xtrm-dev/specialists/commit/ce1320ef6784698070316155704d3b80d4dc5c37))
- Make default handoff section tracker-neutral ([b17c02e](https://github.com/xtrm-dev/specialists/commit/b17c02ea52938395828edec61779600d4c6d5bf8))
- Preserve code-intelligence guidance across authority cutover ([109d8b1](https://github.com/xtrm-dev/specialists/commit/109d8b18d447aaf827a98ebe9124871d922d45cc))
- Migrate changelog scope to Issue refs ([f1467fd](https://github.com/xtrm-dev/specialists/commit/f1467fd22d6db007bba681ab34093a40cb10f7cf))
- Use durable Issue refs in changelog conventions ([a79d604](https://github.com/xtrm-dev/specialists/commit/a79d604a6f39385beed8dcaec99e035dd522189f))
- Make sync-docs scope Issue-native ([3b3f993](https://github.com/xtrm-dev/specialists/commit/3b3f9930e0014ff03ff952e160ab5770ea53d276))
- Route security remediation through follow-up Issues ([4ad8193](https://github.com/xtrm-dev/specialists/commit/4ad8193e6d26fe4fc8883b401ba279e2265d8c5f))
- Remove residual bead contract language from seconder ([6641c70](https://github.com/xtrm-dev/specialists/commit/6641c701be4d0a37cac76b7edb1e08059951ee3c))
- Remove residual bead authority language from test engineer ([3bf5fed](https://github.com/xtrm-dev/specialists/commit/3bf5fed3d21f5caaf6ede5183d33247a50e72661))
- Remove final Beads lineage field from reviewer ([727f948](https://github.com/xtrm-dev/specialists/commit/727f9485160b8e7699b5fb2970bfabadd5514069))
- Remove final bead scope wording from security auditor ([a4c1650](https://github.com/xtrm-dev/specialists/commit/a4c16501da998459189e576d32c38a836f1ee349))
- Remove final bead scope wording from test engineer ([e6e6d17](https://github.com/xtrm-dev/specialists/commit/e6e6d17bb2d76fb3afaee3b0dc2ada277343af26))
- Keep creator anti-Beads doctrine without forbidden command literals ([f297427](https://github.com/xtrm-dev/specialists/commit/f29742789e5e6f2b22dc27ce01cc797b166cf13d))
- Finish reviewer lineage vocabulary cutover ([2c84818](https://github.com/xtrm-dev/specialists/commit/2c848184a4ed650e3d570f78be46354743e4e7b6))
- Finish security-auditor task-template cutover ([68789ad](https://github.com/xtrm-dev/specialists/commit/68789ad3a5c00778ef2143fbd198fa4a77c0637b))
- Finish test-engineer task-template cutover ([8e75419](https://github.com/xtrm-dev/specialists/commit/8e754195291f8c3a2913d0f2021ba533dec88c2b))
- Generate Substrate-first Specialist agent guidance ([42675d6](https://github.com/xtrm-dev/specialists/commit/42675d6d76f5283820cd99d8789991055c306789))
- Make Beads health advisory legacy compatibility ([85356c1](https://github.com/xtrm-dev/specialists/commit/85356c14c6792b104292ffaf233750a63efa63a9))
- Stop treating Beads as current health authority ([e9dc875](https://github.com/xtrm-dev/specialists/commit/e9dc87579597a868edeb7636a263d9e0f3b374dc))
- Make issue_ref primary on native Specialist dispatch ([64419c2](https://github.com/xtrm-dev/specialists/commit/64419c2c2371568a1e5fd943af091c6a9d9495fb))
- Retain created_bead result aliases without Beads authority ([08d6f06](https://github.com/xtrm-dev/specialists/commit/08d6f06d7bc3937847919afd6f0455fe6c5a6e84))
- Preserve coordinator communication invariants across Substrate cutover ([7e1e1bf](https://github.com/xtrm-dev/specialists/commit/7e1e1bf278eea943a043d29dafd6af9878103372))
- Preserve coordinator completion invariant wording ([165f18d](https://github.com/xtrm-dev/specialists/commit/165f18ddf789e176cf6d5f104095ef0b2604f2f9))
- Preserve explicit stop-duty wording ([1599821](https://github.com/xtrm-dev/specialists/commit/1599821983ff6b90a6065260cca7a9154ccba545))
- Make created Issue result fields authoritative ([9ca1bb7](https://github.com/xtrm-dev/specialists/commit/9ca1bb7a71ba7519ae67a741cfe6533006f227f9))
- Render Issue identity before legacy bead aliases ([a0d73f0](https://github.com/xtrm-dev/specialists/commit/a0d73f0c23f3edcfc9d9fe4e153345dfa2809a53))
- Remove retired bd capability from debugger ([d9e04df](https://github.com/xtrm-dev/specialists/commit/d9e04df23a7405af0bd9f5d4c979c1d2e1191360))
- Reconcile cutover expectations and regenerate asset contract ([bb935d7](https://github.com/xtrm-dev/specialists/commit/bb935d7ffd307c0dd1970fea71a6676feb15113c))
- Make mandatory rules inspectable ([31c2fbb](https://github.com/xtrm-dev/specialists/commit/31c2fbb499a8caac211f5805fb31a489cfa8bfb4))
- Resolve bare skills from the repo default root before the global pool ([1193d57](https://github.com/xtrm-dev/specialists/commit/1193d57d265a6fc351ad30d2677eb6a602e7cfb7))

### Other changes
- Bound and observe the double session_start per dynamic activation ([d230251](https://github.com/xtrm-dev/specialists/commit/d2302510b3fe04a7d986a72f0a374e6797321bea))
- XTRM-93 N0: extract supervisor status contract into src/specialist/status-contract.ts ([06ff4d1](https://github.com/xtrm-dev/specialists/commit/06ff4d19c83d5c9d8689e3ac87894835634356b8))

### Project maintenance
- Remove dead Beads coupling from the native-facing runtime (#361) ([31887a4](https://github.com/xtrm-dev/specialists/commit/31887a4e55d25a57b90f06feef580ae148e29e9d))
- One execution profile shape, compared field by field (#366) ([f526de0](https://github.com/xtrm-dev/specialists/commit/f526de0fce48654897a228ac7e0cff9d259fffc5))
- Pin the dimensions where a BOTH-SIDES change was invisible (#371) ([1a96a8a](https://github.com/xtrm-dev/specialists/commit/1a96a8a33ab992b99f05d141627ad3e61798bbdd))
- Stop calling the contract quote a mechanical tie (#373) ([472b1ae](https://github.com/xtrm-dev/specialists/commit/472b1aef5fc02c1f5195090231ee3f0f493ce427))
- Measure the discover-then-pin falsifiers (unitAI-1pqtl.1) ([280f410](https://github.com/xtrm-dev/specialists/commit/280f410da7f683d8addbbfcf641a8623c4280cd0))
- Drop the re-default on the required reserved-names parameter ([1a25853](https://github.com/xtrm-dev/specialists/commit/1a25853e1bae075b8bf141d274b0dc74b0186887))
- State which extension sources the native path resolves ([4009a09](https://github.com/xtrm-dev/specialists/commit/4009a09c6f07214f32de16b3a103f14b59a0132b))
- Pin the native admission mechanism as a negative pair ([4204b7e](https://github.com/xtrm-dev/specialists/commit/4204b7ea931cae72702c530b1169fb4912f3edd4))
- Enabled extension sources under native dispatch (unitAI-1pqtl) ([4da040a](https://github.com/xtrm-dev/specialists/commit/4da040a406f26e059a2b9a8bb7aee57be7162aeb))
- True closeout of the unitAI-1pqtl extension-resolution workstream ([020efeb](https://github.com/xtrm-dev/specialists/commit/020efebaf4b87af9ad803c77f89a2645012daf0b))
- Legacy backend migration audit — capability, telemetry and identity matrices ([ff73e3c](https://github.com/xtrm-dev/specialists/commit/ff73e3cc4710490201aad40cabb09294c54b1d65))
- Correct store-anchoring consequence — three stores, two anchors ([3c48548](https://github.com/xtrm-dev/specialists/commit/3c485483fa76ef91063a472bc642231c1d9779b3))
- Prove the sp ps family orphan from the canonical DB; record identity grammar ([4aab7ab](https://github.com/xtrm-dev/specialists/commit/4aab7ab06c303216596f59b52855bc5875c00f9c))
- Open the cutover-prep execution log with N0 verified ([3ad0468](https://github.com/xtrm-dev/specialists/commit/3ad04683577508481cab2e6e7e6360840b5b517e))
- Record N2A in the cutover-prep log (verified, 77a76bf2) ([6c2ce04](https://github.com/xtrm-dev/specialists/commit/6c2ce04964b83254f4d2e33e0f60b8fcced1d25e))
- Sp ps shows a stale historical snapshot, not an empty block ([652c8ac](https://github.com/xtrm-dev/specialists/commit/652c8aca25df612c5fe1b8802c48b8911fe70727))
- Record N2B, the dist rebuild, and a discovered defect in the log ([81c2ee1](https://github.com/xtrm-dev/specialists/commit/81c2ee1bff343d8f96baeb54c0981ff11f5ea9fc))
- Fix my own EXPLAIN citation; record the waiting/status_changed finding ([7cc5e94](https://github.com/xtrm-dev/specialists/commit/7cc5e9432e8b3e8958d6ac75838fb9a2ec7738e9))
- Record the review outcome, the N2A fix, and a monitoring lesson ([ef37d16](https://github.com/xtrm-dev/specialists/commit/ef37d164faf87891186007f3fc5d6f0872146c7e))
- Close out the cutover-prep log with the review fixes ([dc400ad](https://github.com/xtrm-dev/specialists/commit/dc400ad2798cdcdddabd74695544b27259f298b4))
- Move the session metric contract out of the legacy RPC session ([11a48aa](https://github.com/xtrm-dev/specialists/commit/11a48aad2934440b29261071031b38853ee137a9))
- Reconcile onto 20b888b4; record N0.1, the row-cap residual, and the test defect ([962f599](https://github.com/xtrm-dev/specialists/commit/962f599b5033fb0a00ee9985c0a4586b3ca6e9a1))
- Rebuild the bundle from the tree reconciled onto 4dbc2261 ([4ae4ea8](https://github.com/xtrm-dev/specialists/commit/4ae4ea8b258ff0f0d76126141978b577cc69a705))
- Rebuild for the N2A positional-resolution fix ([0e76b31](https://github.com/xtrm-dev/specialists/commit/0e76b315d6080bdd6bef3fec0f0c07110a3090d4))
- Correct how dist/ must be regenerated; drop the wrong dist rebuild ([553b5a2](https://github.com/xtrm-dev/specialists/commit/553b5a239147a7bcb562b9388f033c0d35db390e))
- Expect the <specialist>:<id> dispatch token in fleet rows ([458893c](https://github.com/xtrm-dev/specialists/commit/458893c9a0a69bb656b40c3973612ef9fab51647))
- Rebuild from the lockfile-resolved dependency set ([1007b45](https://github.com/xtrm-dev/specialists/commit/1007b459b21d2c1266f3a4831c95b4b37f352b56))
- Pin the healthy-gitnexus premise instead of inheriting it ([7317071](https://github.com/xtrm-dev/specialists/commit/7317071670cb6641296813ef2858028d76b3e7ed))
- N3 telemetry evidence base and rebuilt classification ([181b429](https://github.com/xtrm-dev/specialists/commit/181b4292c8a145e73deb2a972e4a54c17b49eb89))
- Correct the dist status and record a new id-format consumer ([92debca](https://github.com/xtrm-dev/specialists/commit/92debca1313d498f754b31d647c20f6eca24acc0))
- Repair the Supervisor harness and add a canonical event oracle ([7243e53](https://github.com/xtrm-dev/specialists/commit/7243e5341e4f7c47970ed73c704459019769b8f4))
- Retire the contradictory differentialReads constant; derive the note from expectation (SPECIALISTS-103 follow-on) ([81742ac](https://github.com/xtrm-dev/specialists/commit/81742ac13bc22ca961b86edec8eda13d3ece06b5))
- Lane D closeout — reconcile migration docs with shipped mapper (SPECIALISTS-115) ([5e16b8a](https://github.com/xtrm-dev/specialists/commit/5e16b8a870213db626428d5f98d9e7c7f35a4fcc))
- Add Jev System One research scripts (XTRM-99) ([a6e5521](https://github.com/xtrm-dev/specialists/commit/a6e55215c8567bbb01ca1a14124a0508ca79056e))
- Add Lane D phase-accounting corpus provenance receipt ([906f5bd](https://github.com/xtrm-dev/specialists/commit/906f5bd2bfef88c41e7e93c4d4db34211622858b))
- State the flush policy limit (SPECIALISTS-119 round 2) ([7859653](https://github.com/xtrm-dev/specialists/commit/785965389c2ed6ab617a74c968aad156faa78cd6))
- Back the reader-terminal population figures for SPECIALISTS-119 ([7c0cd21](https://github.com/xtrm-dev/specialists/commit/7c0cd21ee0df6011b215e005a695a1413d828314))
- Discriminating canonical-oracle entry for the resume re-entry leg (SPECIALISTS-122) ([4728ad9](https://github.com/xtrm-dev/specialists/commit/4728ad937911847a813bb15583e0b2fc920dce9c))
- Harden and pin the resume-reentry canonical-oracle entry (SPECIALISTS-122 round 2) ([ab6892d](https://github.com/xtrm-dev/specialists/commit/ab6892d1f5b544876206ec021f6cfd1c97b62b2a))
- Discriminate requested vs resolved model, pin exact keys, gate the proof (SPECIALISTS-123 round 2) ([0e32d4f](https://github.com/xtrm-dev/specialists/commit/0e32d4f236db1012333a88796258c8220a76de00))
- N3 freeze audit — frozen baseline, success-item assessment and residual register ([d25c616](https://github.com/xtrm-dev/specialists/commit/d25c616d266f2e669cf322095137427ff16548a0))
- Record verified node status in the migration DAG ([0a607d2](https://github.com/xtrm-dev/specialists/commit/0a607d22a0b6eb9555ea34a1b9f380bbcba24d46))
- Budget the load ceiling in sp-serve and status suites (#402) ([7047357](https://github.com/xtrm-dev/specialists/commit/70473578b2d47fdd65089094c518a07bb07fee35))
- Using-specialists native-first cutover ([6b436e4](https://github.com/xtrm-dev/specialists/commit/6b436e43bd07c6b0c257d14d2dae5f2dd9d06d32))
- State two-runtime reality (sp operator surface + native primary, XTRM-93 transitional) ([ca421dc](https://github.com/xtrm-dev/specialists/commit/ca421dce48601795d3445aa280d0e14620e30e37))
- Update skill invariants for native-first cutover (sb show, two-runtimes, fresh asset hashes) ([151d370](https://github.com/xtrm-dev/specialists/commit/151d3709a8251c93f35c07d31e6f0bedbf794fa9))
- Native activation as primary flow, sp as operator surface ([ac91ebb](https://github.com/xtrm-dev/specialists/commit/ac91ebbb70e7810107dda6266ae4fceb50fa8bf6))
- Compress root to 149 lines (router budget) ([163bb76](https://github.com/xtrm-dev/specialists/commit/163bb767d47d29aea15621b958f83363889e0b7a))
- Point continuity cross-links at using-xtrm (starting-and-resuming-work folded upstream in core) ([c4a9f2c](https://github.com/xtrm-dev/specialists/commit/c4a9f2c1d6fbeb00b82e0188523d475d3c0402eb))
- Regenerate asset contract for continuity cross-link updates ([febd900](https://github.com/xtrm-dev/specialists/commit/febd9003c05fcfda1e0d1c777f2adb2e4ecdaf30))
- Supervisor failure classification; E=slots-8/9 stale-double ([4edf222](https://github.com/xtrm-dev/specialists/commit/4edf222e3ab85a09c54289c1cfde172c50dd0133))
- N3 freeze-audit addendum — 95/107/108 closures, 38/18 attribution ([2f9f40c](https://github.com/xtrm-dev/specialists/commit/2f9f40c275c242a40d7ef1abc978be7f21881255))
- Quarantine bead-id rule as legacy compatibility ([52e5320](https://github.com/xtrm-dev/specialists/commit/52e5320b4baa4c99dcd8fec5b5e4bd3f563e4590))
- Document Substrate-era mandatory-rule authority ([7c79daa](https://github.com/xtrm-dev/specialists/commit/7c79daae313364dd9e6c982f5f0782077e0b34d5))
- Remove retired Beads workflow block ([790fdf3](https://github.com/xtrm-dev/specialists/commit/790fdf3edc896128436ca40f7f7c5cc2f9cb0e57))
- Use Substrate issue-ref identity rule ([dd65b92](https://github.com/xtrm-dev/specialists/commit/dd65b9229dcbff01a4b8eb1236a4e57f164b3e64))
- Use Substrate issue-ref identity rule ([8d02ccc](https://github.com/xtrm-dev/specialists/commit/8d02ccc31644c70c3cf63adef898c9c64066f570))
- Use Substrate issue-ref identity rule ([350f7ba](https://github.com/xtrm-dev/specialists/commit/350f7ba6105f80c15e2e23a586faa52b1ca5f436))
- Use Substrate issue-ref identity rule ([6737f1c](https://github.com/xtrm-dev/specialists/commit/6737f1cbe6da1e797d604701d8e80cb71dd3f3a0))
- Use Substrate issue-ref identity rule ([c7740fc](https://github.com/xtrm-dev/specialists/commit/c7740fcd8df3b0467368d437cd84838370301dd6))
- Use Substrate issue-ref identity rule ([2e197e7](https://github.com/xtrm-dev/specialists/commit/2e197e795a1b62c16b0762f26d11a67ef319dc5a))
- Use Substrate issue-ref identity rule ([21a1380](https://github.com/xtrm-dev/specialists/commit/21a13802dfb1e83378cdc22d6aa99b9fba7c6882))
- Use Substrate issue-ref identity rule ([718a041](https://github.com/xtrm-dev/specialists/commit/718a0410ae0e032f78aa7ce65bfd0797fb121af5))
- Use Substrate issue-ref identity rule ([38d203e](https://github.com/xtrm-dev/specialists/commit/38d203e4ff72f418fcacb092eb32562083b1dd94))
- Use Substrate issue-ref identity rule ([79623c0](https://github.com/xtrm-dev/specialists/commit/79623c00e83c168c728cddff96d7656795e12cc0))
- Use Substrate issue-ref identity rule ([edc433e](https://github.com/xtrm-dev/specialists/commit/edc433ebbb1a3dd6a26a11fa0e7f9a4aec621801))
- Use Substrate issue-ref identity rule ([216a216](https://github.com/xtrm-dev/specialists/commit/216a216c4a1058653f23099422ddf22abe4d432f))
- Use Substrate issue-ref identity rule ([292b50f](https://github.com/xtrm-dev/specialists/commit/292b50fcc3c2db97b54fda8c0f50da4528dd9ca3))
- Use Substrate issue-ref identity rule ([d7875bf](https://github.com/xtrm-dev/specialists/commit/d7875bfc5000c6a2931a05f3c9611d081d5f4ff5))
- Use Substrate issue-ref identity rule ([3be8ba8](https://github.com/xtrm-dev/specialists/commit/3be8ba8fa33e3d370773f72d328e9f495f3886b6))
- Mark node coordinator Beads commands as legacy compatibility ([6491c58](https://github.com/xtrm-dev/specialists/commit/6491c58aa1e4d30f5aee858840413664c005b034))
- Align output contract with Substrate work semantics ([127c9a2](https://github.com/xtrm-dev/specialists/commit/127c9a2bd388f52b81161216e566740beb167cd7))
- Record Specialist definition semantic cutover ([709975e](https://github.com/xtrm-dev/specialists/commit/709975e62b156bca75047c257b012fd5bafc5378))
- Demote Beads to explicit legacy compatibility ([cd475ab](https://github.com/xtrm-dev/specialists/commit/cd475ab8062bf628ad560810a326ef9e90d13c39))
- Make Substrate/native activation the primary workflow ([7085209](https://github.com/xtrm-dev/specialists/commit/7085209cf64e85b156fb92a956bac7a486469d96))
- Make Substrate Issue the current Specialist authority ([a8ce935](https://github.com/xtrm-dev/specialists/commit/a8ce935b48e99d6837247dfb97457484ec1da0d8))
- Align Specialist skills with Substrate authority ([9cc3e06](https://github.com/xtrm-dev/specialists/commit/9cc3e06605aed942bf6d8467d98c92d38b134716))
- Separate native Issue semantics from legacy Beads config ([d359315](https://github.com/xtrm-dev/specialists/commit/d35931549e48ee7bc99cef07f66fbdbfd1ff34ad))
- Cut repo instructions over to Substrate authority ([e0312c0](https://github.com/xtrm-dev/specialists/commit/e0312c0c2a3583d3fd3e402c22c20f6d6cea6335))
- Cut repo instructions over to Substrate authority ([135a1b7](https://github.com/xtrm-dev/specialists/commit/135a1b733be701bd48ea6ac320122a55211e73ab))
- Bind mandatory-rule expectations to Substrate-era injection ([23910ee](https://github.com/xtrm-dev/specialists/commit/23910eebad83183cd776fe486cc07a5eb41752f7))
- Update golden doctrine for Substrate authority ([011a73d](https://github.com/xtrm-dev/specialists/commit/011a73dd874e1e898b8ac30c2b5e5d03ca3269cf))
- Prevent Beads lifecycle regressions in canonical assets ([d8bf72f](https://github.com/xtrm-dev/specialists/commit/d8bf72f0062f6097509edf8816042c43dd20ac79))
- Mark Beads handoff overrides as legacy compatibility ([b1b46dd](https://github.com/xtrm-dev/specialists/commit/b1b46dd24b347c4ce6b7589abf78d2ddd0e5c946))
- Distinguish native authority from legacy Beads behavior ([508054d](https://github.com/xtrm-dev/specialists/commit/508054dc8b6fd807f7d088d6f77ebdfd5549c48b))
- Present native Substrate activation as primary workflow ([e68c3a2](https://github.com/xtrm-dev/specialists/commit/e68c3a2cc317b5cdbd381ae171c198b05eb614b8))
- Use Substrate work evidence as release input ([d871c7f](https://github.com/xtrm-dev/specialists/commit/d871c7f1581bd1eb995e809e236d0a3f670e11c5))
- Distinguish Substrate authority from legacy Beads hooks ([8b04c6c](https://github.com/xtrm-dev/specialists/commit/8b04c6cebb07d456b22d8dd8091db751c9d52167))
- Mark Supervisor/Beads sections as legacy backend ([4637457](https://github.com/xtrm-dev/specialists/commit/4637457324d52979f44a9d8924e99ede7354afaa))
- Cut normative Specialists programme authority to Substrate ([c7b0fd7](https://github.com/xtrm-dev/specialists/commit/c7b0fd7f705db45cb5fd0e5396bc912d3ba39257))
- Replace current Beads authority with Substrate ([4c551cf](https://github.com/xtrm-dev/specialists/commit/4c551cf05d13f3be53c39b95fe0337a0ead6c203))
- Use Substrate as current durable-work evidence ([c7ccbe4](https://github.com/xtrm-dev/specialists/commit/c7ccbe4a07889743c1ee4660289ed3b759794683))
- Align reviewer example with pinned Issue authority ([84b70e8](https://github.com/xtrm-dev/specialists/commit/84b70e8d8e70b3328abf277737a729d4caa1e857))
- Extract Specialist doctrine cutover from N8 mechanical cleanup ([5019b42](https://github.com/xtrm-dev/specialists/commit/5019b42d8cdda26d0fadcbe6043803b927ef94e0))
- Bind help to native-first workflow ([9e8806b](https://github.com/xtrm-dev/specialists/commit/9e8806b0919a776aa663d0f64803299cc83c6f7a))
- Reconcile schema/rules audit with semantic cutover ([787da16](https://github.com/xtrm-dev/specialists/commit/787da1622777ceaccc53df89e42bd7abc57bc8a8))
- Mark Beads doctrine violation corrected ([b183620](https://github.com/xtrm-dev/specialists/commit/b183620f890ec4c2d8c409285c984ace7a52fac2))
- Reconcile Substrate cutover from master ([1ed2384](https://github.com/xtrm-dev/specialists/commit/1ed2384766705fc3454a79254f92d4abb1fd27a2))
- Cut over to Substrate, remove .beads/ state and bd hooks (#409) ([c2f601c](https://github.com/xtrm-dev/specialists/commit/c2f601c6569cb30bb2b0bfb45190711cd3192259))
- Fix inline-rule count after global retirement ([943c89c](https://github.com/xtrm-dev/specialists/commit/943c89c95d57a3825e9962e1e0264d607a59bc03))
- Label handoff table as legacy compatibility ([8d8dde3](https://github.com/xtrm-dev/specialists/commit/8d8dde34af2b11dd2e77f5735f095b91d8a32849))
- Make native Substrate workflow primary ([c3ebc18](https://github.com/xtrm-dev/specialists/commit/c3ebc18c53752ae49857b970e0427678706adbcd))
- Bind native-first workflow semantics ([5ac7406](https://github.com/xtrm-dev/specialists/commit/5ac7406911425800d77a6be1ddc1d8680f2e6de7))
- Bind Beads surface to legacy compatibility ([74000e1](https://github.com/xtrm-dev/specialists/commit/74000e1735ff49e7579d944b0f9ab9687a0393db))
- Expect legacy Beads compatibility health surface ([138a2b7](https://github.com/xtrm-dev/specialists/commit/138a2b7ae358c16d2f97035c25a7e771d097cec5))
- Bind generated guidance to Substrate authority ([76509d2](https://github.com/xtrm-dev/specialists/commit/76509d20ce72152eed7a9caddda70514e759b889))
- Enforce issue_ref-first dispatch with bead alias compatibility ([a2d0b18](https://github.com/xtrm-dev/specialists/commit/a2d0b18968431734971a4ec06c8dccd86fe35355))
- Reconcile native Specialist tool inventory ([28f7c0a](https://github.com/xtrm-dev/specialists/commit/28f7c0af399f0af995a7799a320d2054d295a432))
- Document the eighth native retry tool ([264007f](https://github.com/xtrm-dev/specialists/commit/264007f9bd236e8ccb5f84774315bd42370b0830))
- Reconcile eight native activation tools ([71e9e6a](https://github.com/xtrm-dev/specialists/commit/71e9e6a7f01c5beaeb2c656f19e908720586dddc))
- Guard generators and Pi dispatch against authority drift ([1b3df0c](https://github.com/xtrm-dev/specialists/commit/1b3df0c1cb9cace18a78782eb95a8468fe4837bd))
- Use minimal semantic-cutover version bump ([8b41f66](https://github.com/xtrm-dev/specialists/commit/8b41f667810dc313def0383462d8463e37deec43))
- Use minimal semantic-cutover version bump ([6f47f5f](https://github.com/xtrm-dev/specialists/commit/6f47f5f0c114ad4d91373bd7a11ba0789fd6a2e7))
- Use minimal semantic-cutover version bump ([3ca2905](https://github.com/xtrm-dev/specialists/commit/3ca2905474e8dbb286c7095c5ab960387fbb9492))
- Use minimal semantic-cutover version bump ([ca62ed2](https://github.com/xtrm-dev/specialists/commit/ca62ed265006c3102cd961e22cf4ea97baef1032))
- Use minimal semantic-cutover version bump ([fa28741](https://github.com/xtrm-dev/specialists/commit/fa287419ca3a08ac8774b10b015913e5b8355a25))
- Use minimal semantic-cutover version bump ([6662209](https://github.com/xtrm-dev/specialists/commit/66622090d437994a6a84aacc15a4ef389f1daeb3))
- Use minimal semantic-cutover version bump ([a6246e6](https://github.com/xtrm-dev/specialists/commit/a6246e6cc95ef22b6a72fef8087debbc13f017a2))
- Use minimal semantic-cutover version bump ([b1e6046](https://github.com/xtrm-dev/specialists/commit/b1e6046632da2a646237144f8908b9e63d050471))
- Use minimal semantic-cutover version bump ([d7cf482](https://github.com/xtrm-dev/specialists/commit/d7cf4822655913191a2a6747acea30ec74d16a1d))
- Use minimal semantic-cutover version bump ([0e2cc72](https://github.com/xtrm-dev/specialists/commit/0e2cc7260fa74965ce1bf1f357ad4f6226dcf498))
- Use minimal semantic-cutover version bump ([1890047](https://github.com/xtrm-dev/specialists/commit/1890047306d030eef51a78ab6eec7aa56bf14b9f))
- Use minimal semantic-cutover version bump ([28009fe](https://github.com/xtrm-dev/specialists/commit/28009fea07802adf85a43b7c580ad720d1faaa5e))
- Bind sync-docs scope to pinned Issue ([71fd5c1](https://github.com/xtrm-dev/specialists/commit/71fd5c14d6b71932f01f2aa7e9d28259bb0f457b))
- Pin minimal semantic-cutover role versions ([9df5aa3](https://github.com/xtrm-dev/specialists/commit/9df5aa3b9c70ce342ad64de73ce620af252d81ef))
- Pin service-knowledge semantic-cutover patch version ([553dd97](https://github.com/xtrm-dev/specialists/commit/553dd97f26a4d674f64659dafe6f4e8cde8144f3))
- Restore current repo-specific Specialist invariants ([eace07f](https://github.com/xtrm-dev/specialists/commit/eace07f62520d88492ef54256d40a1cf4faa592b))
- Preserve non-Beads project execution invariants ([0540292](https://github.com/xtrm-dev/specialists/commit/05402929a5ffa0b219eaa7dc6d136a52328459a0))
- Mark Beads/Supervisor commands as compatibility surfaces ([7c9c1b8](https://github.com/xtrm-dev/specialists/commit/7c9c1b89e29368b9fdac7fa60b79b95e556bb7e6))
- Mark Supervisor background-job guide as legacy compatibility ([2c773bb](https://github.com/xtrm-dev/specialists/commit/2c773bb5dc957a214881c5d78bb47fd7a7c74aba))
- Classify NodeSupervisor as XTRM-93 legacy compatibility ([07eb772](https://github.com/xtrm-dev/specialists/commit/07eb77288cc86f14ed906f05897a74e427f3b82f))
- Mark per-job worktrees as legacy backend semantics ([44e1a7e](https://github.com/xtrm-dev/specialists/commit/44e1a7e82a038a28522a58b12d400c23faceaec7))
- Make Core/Substrate workspace pattern current ([5e95251](https://github.com/xtrm-dev/specialists/commit/5e9525114328711edf17f257cf3c898b5f52e88e))
- Build semantic-cutover dist on branch ([647bd0c](https://github.com/xtrm-dev/specialists/commit/647bd0c03dfd492aab6d788ee1fbae7efa47fca5))
- Refresh dist for Specialist semantic cutover ([bf79290](https://github.com/xtrm-dev/specialists/commit/bf79290ab1567d0905f3020d566d303806ae7cb7))
- Remove temporary semantic-cutover dist builder ([9a61849](https://github.com/xtrm-dev/specialists/commit/9a61849ccd9bc88509bb946dd6bd14cd3fdb746f))
- Prove Issue prompts cannot inherit Beads lifecycle ([e26a8cd](https://github.com/xtrm-dev/specialists/commit/e26a8cd3e2428d0adf1538a7cdf028baae4e3ec0))
- Enforce created_issue_ref with legacy aliases ([eb8c22f](https://github.com/xtrm-dev/specialists/commit/eb8c22f6a7c70c2ae21ef48a7d36ae81df103838))
- Make created Issue fields authoritative ([3b4817d](https://github.com/xtrm-dev/specialists/commit/3b4817d100c064fa67a7f28e6ec36f41d4a9d879))
- Make issue_ref primary across frontends ([ad92c0d](https://github.com/xtrm-dev/specialists/commit/ad92c0d67335100be59d3e96c98870d6dd62c1bc))
- Complete Substrate authority cutover in normative requirements ([070b221](https://github.com/xtrm-dev/specialists/commit/070b2219c60761c437ee6af1618d10e4e8df1b13))
- Finish Beads-to-Substrate normative reconciliation ([0702326](https://github.com/xtrm-dev/specialists/commit/07023269b9ca8663716d0b96a315c033c69b32a2))
- Pin security-auditor semantic-cutover version ([7de62d1](https://github.com/xtrm-dev/specialists/commit/7de62d176b5b0dfa18838022388f0a8bfa8079fc))
- Rebuild semantic-cutover dist after frontend reconciliation ([087fc8a](https://github.com/xtrm-dev/specialists/commit/087fc8ac20f76c67a3c6de0986cd3a9ea76cd34d))
- Refresh dist for Specialist semantic cutover ([2691755](https://github.com/xtrm-dev/specialists/commit/269175529992a115262bb98e93ba9299784d4d62))
- Remove temporary semantic-cutover dist builder ([a878498](https://github.com/xtrm-dev/specialists/commit/a87849821ad3051a382df92bcb36e021246c7e02))
- Reconcile ps ownership and legacy merge semantics ([d3281e8](https://github.com/xtrm-dev/specialists/commit/d3281e8adec76bb3b4cb05f41b06d40ec7cc2275))
- Quarantine Beads edit gate as legacy implementation ([3e91903](https://github.com/xtrm-dev/specialists/commit/3e919031b959cdb527aa2dfd73e8d89880550426))
- Move execution authority table to Substrate ([751d393](https://github.com/xtrm-dev/specialists/commit/751d3932c098e5cb717a26730d4142c28673096c))
- Cut canonical execution protocol over to Issue authority ([ae97ce3](https://github.com/xtrm-dev/specialists/commit/ae97ce3771895c008559b3d8fa2ed6dcd4cfdbd6))
- Make current roadmap index Substrate-native ([af712e8](https://github.com/xtrm-dev/specialists/commit/af712e8d1eb58983ab7c518342f3bcd5d3357494))
- Remove stale Beads authority from historical pointer ([6c6b7b8](https://github.com/xtrm-dev/specialists/commit/6c6b7b8dbb8851e5532530f022e879402008c906))
- Quarantine Beads materialization as compatibility history ([41c74b6](https://github.com/xtrm-dev/specialists/commit/41c74b6caf0539f75cf7c6de8a59c1b212fd7d01))
- Mark Beads-bound TUI design superseded by XTRM-96 ([825d08e](https://github.com/xtrm-dev/specialists/commit/825d08e7fd5791a2e11477da731712595562faca))
- Mark BeadView E2E walkthrough historical ([2d38bc4](https://github.com/xtrm-dev/specialists/commit/2d38bc47200a09ab9a0b0f726b9823d7dab145b6))
- Migrate proposal/evaluation design to Issue semantics ([e425eaa](https://github.com/xtrm-dev/specialists/commit/e425eaac1856a6f033171e16f6bc02d089af1310))
- Remove stray current Beads follow-up wording from historical bannered record ([2e0d8e0](https://github.com/xtrm-dev/specialists/commit/2e0d8e083b948fb6c11b3f90fc20ae8d383c5bff))
- Rename contract reference to issue-contracts ([6700728](https://github.com/xtrm-dev/specialists/commit/6700728ec5300d96a45531c1eb1dcd98bb534b96))
- Remove legacy bead-contracts reference name ([2359c42](https://github.com/xtrm-dev/specialists/commit/2359c4276c13741f417e1a5e4d9f0ad8e29848bc))
- Rename contract reference to issue-contracts ([e17572e](https://github.com/xtrm-dev/specialists/commit/e17572efc9cb33aa1bc70997f74e3bb53bcb76c7))
- Expect issue-contracts reference ([6f5cb20](https://github.com/xtrm-dev/specialists/commit/6f5cb203782adbb3dc8f36faa705436857018a82))
- Migrate using-specialists evals to Issue semantics ([7365a8f](https://github.com/xtrm-dev/specialists/commit/7365a8f0dcd020eeeb9c6ff24856115a42ddbbf4))
- Rename progressive-disclosure contract reference ([3474453](https://github.com/xtrm-dev/specialists/commit/3474453bd4e97dac931489a774632b899c985dc1))
- Mark executor harness legacy Supervisor/Beads ([04980dc](https://github.com/xtrm-dev/specialists/commit/04980dcafa3958a4fac94eb679ecd3fe87a2b653))
- Quarantine Beads benchmark as legacy compatibility ([507dfe8](https://github.com/xtrm-dev/specialists/commit/507dfe8d807e9fdc55846a5bc913995296f97301))
- Record residual Beads asset disposition ([016a027](https://github.com/xtrm-dev/specialists/commit/016a0270a3a7bd4b7a3ebb1aa3fe6da38c257a8b))
- Align contract reads with typed Substrate service ([eebc783](https://github.com/xtrm-dev/specialists/commit/eebc783b72d4941c4c3e9688fa74f32540f7487c))
- Make Issue contract precondition service-first ([232f8af](https://github.com/xtrm-dev/specialists/commit/232f8af9d5d284f30a523e1e185848af541f6bed))
- Repair Issue-era eval semantics ([4625631](https://github.com/xtrm-dev/specialists/commit/4625631d2556dca82b3840aa6a9e7b37f3b5a284))
- Mark progressive-disclosure benchmark as dated ([9b8ce8a](https://github.com/xtrm-dev/specialists/commit/9b8ce8a815c5bc882f2b6fcf7f6f7e2e02ef0637))
- Use typed Substrate discovery services ([bbedd88](https://github.com/xtrm-dev/specialists/commit/bbedd888bc6deaaaf08ef64c8e9736c69f6e0282))
- Record Claude Mod fleet pane spike boundary ([946c493](https://github.com/xtrm-dev/specialists/commit/946c4930785a4bca2ea592a6fea6b6ef7de7067e))

## [3.21.5] - 2026-08-20

Patch focused on observability truthfulness and Pi vendored-tooling parity. `sp log` default output now filters agent-internal events (turn/tool/model.token_usage) that were drowning the 2-3 real lifecycle rows per job; the corresponding monitor recipes in `using-specialists/references/monitoring.md` are corrected to read from `.forensic_event` and to distinguish terminal (`job.completed|failed|cancelled`) from attention (waiting, `process_health.stale_detected`, `error.*`) states — the prior recipe silently matched nothing and coordinators read the silence as "still running". Background specialist dispatch now surfaces launch errors instead of returning a misleading `ok` envelope. Two Pi extension vendored-fork fixes bring `read-line-numbers` behavior in line with the Core implementation (EOF model + real-blank-line handling).

### Fixed
- Mirror Core read-line-numbers blank-line fix in vendored fork (unitAI-nx80v) (#265) ([d2785cf](https://github.com/xtrm-dev/specialists/commit/d2785cfaa6b9cfcd5251bfbcc34bb5cfee0edca0))
- Correct vendored read-line-numbers fork to Pi EOF model (unitAI-gajax) (#266) ([3760cf4](https://github.com/xtrm-dev/specialists/commit/3760cf429934f79739b628a967e78d495dbfd96d))
- Surface launch errors in the background envelope (xtrm-5kwk2) (#267) ([daba619](https://github.com/xtrm-dev/specialists/commit/daba6198ba5d1f8fcc5f5314e21ca2d5860a1c42))
- Sp log default forensic path emits every agent-internal event (unitAI-mkkjk) (#268) ([7a13d63](https://github.com/xtrm-dev/specialists/commit/7a13d638e92a7b3e3a9ef019eea75deedb150597))

### Project maintenance
- V3.21.4 release-path followups (unitAI-ip5jz) ([588593d](https://github.com/xtrm-dev/specialists/commit/588593d2380d5ff556cb6046d9d1b8f4434cba67))
- Stop the boundary-rule test depending on bd + a real bead ([1ce1006](https://github.com/xtrm-dev/specialists/commit/1ce1006f7d82283c306a046dc2acea4c9742e70b))
- Sp log --json envelope shape + correct monitor recipes (unitAI-nhl6x) (#269) ([bcdbd30](https://github.com/xtrm-dev/specialists/commit/bcdbd30cb8248155c0e57dd9243f6d32c612bab9))

## [3.21.4] - 2026-08-14

### Fixed
- Sp config show --resolved falls back to canonical catalog ([6366058](https://github.com/xtrm-dev/specialists/commit/636605877881de38cc724d9df7c86b2330915eda))
- Classify rate-limit / quota errors as transient (unitAI-63xi3.1) ([8c1c797](https://github.com/xtrm-dev/specialists/commit/8c1c797e385f38e795a102336633d7558cff1945))
- Harden --bead lookup against shell injection (unitAI-eao44, CWE-78) ([1add04a](https://github.com/xtrm-dev/specialists/commit/1add04af28b853ee8d950f267dc74bf8bbb90def))

### Project maintenance
- Regenerate v3.21.3 section via git-cliff (was incomplete) ([8155e0d](https://github.com/xtrm-dev/specialists/commit/8155e0ddbb8a8e6150e20fdbe99c5dd4ebefb461))
- Drop CHANGELOG-content assertion after v3.21.3 regeneration ([462c090](https://github.com/xtrm-dev/specialists/commit/462c090c03e3940c79048af8b4c7c0e26b4c541e))

## [3.21.3] - 2026-08-14

### Added
- Add native codex role/render surface (K3, experimental) ([6c3ffe4](https://github.com/xtrm-dev/specialists/commit/6c3ffe498b1264da0763e462309e2d8332b8e73f))
- Complete codex role invocation and result parity (K4) ([8641d36](https://github.com/xtrm-dev/specialists/commit/8641d36af64765bde73751171317bae0cc9bf786))
- Retire active Serena runtime integration (K4, unitAI-e67up.8) ([7053236](https://github.com/xtrm-dev/specialists/commit/7053236fcac9b5d244fd8edf9c9a08979c2491fe))
- Add bounded semantic review gates ([92225bb](https://github.com/xtrm-dev/specialists/commit/92225bb50903a66ffdd36c6fee423247b40621f8))
- Add contextual exploitability method ([772041e](https://github.com/xtrm-dev/specialists/commit/772041e46d669d58395e0c56c2b1237e20b637ba))
- Add semantic correctness gates ([a79c072](https://github.com/xtrm-dev/specialists/commit/a79c0729d87ad1d6d758e86d7b649a678647209f))
- Establish verified citation contract ([b3f4fff](https://github.com/xtrm-dev/specialists/commit/b3f4fff3e628522f684aff3dac3884f124e4f9ab))
- Consume read-line-numbers extension via pi -e alongside --no-extensions ([9da21eb](https://github.com/xtrm-dev/specialists/commit/9da21eb2a46f17732680002e098b76fa934600ee))

### Fixed
- Ship CHANGELOG.md in the package, compact the changelog format (#242) ([eaf044f](https://github.com/xtrm-dev/specialists/commit/eaf044f0592aa89d68ba752ec95a36b6404023ae))
- Enforce Core schema patterns in the launch-outcome consumer (K4 review) ([ba3e8dc](https://github.com/xtrm-dev/specialists/commit/ba3e8dcda63c6b5ce3de351fbec3917832f02f41))
- Enforce required-property presence in the launch-outcome consumer (K4 review r3) ([c026f40](https://github.com/xtrm-dev/specialists/commit/c026f40357382c6c22742ee27420f1e70c3c6299))
- Preserve native read fallback ([5ed558a](https://github.com/xtrm-dev/specialists/commit/5ed558aa38069ff0f4a987e29e96a715544b9d24))
- Pin injected diff evidence to immutable head ([5b79d47](https://github.com/xtrm-dev/specialists/commit/5b79d47f56330ee0423b9bcd262ac8a9585e5964))
- Reuse resolved tool contract ([25d4a70](https://github.com/xtrm-dev/specialists/commit/25d4a702107e2760dc56f561c9e17700dcc2ae0f))
- Use resolved gitnexus contract ([823aa51](https://github.com/xtrm-dev/specialists/commit/823aa51f125290a8e5204abc3bbdb418826c508e))
- Enforce mandatory rule budget floor ([61b5019](https://github.com/xtrm-dev/specialists/commit/61b50191eb985823ab64450963098ce87f2ee8c0))
- Constrain citation paths to trusted roots ([0880e4e](https://github.com/xtrm-dev/specialists/commit/0880e4e12728a86b9a6e17f986c6750ecf2afdfc))
- Fix package attestation payload gate ([6779738](https://github.com/xtrm-dev/specialists/commit/677973842140d2d1ae36b2a7ee37582757dd172a))
- Enforce release attestation provenance in CI ([0cd941e](https://github.com/xtrm-dev/specialists/commit/0cd941e964a3ff6f9632861f5ae42ad7a3f1f1d8))
- Fix package payload attestation parity ([23386dc](https://github.com/xtrm-dev/specialists/commit/23386dc91d016e6ca3e65f7faad658379db964a6))
- Pin SEC-001 workflow dependencies ([1df5c76](https://github.com/xtrm-dev/specialists/commit/1df5c76c824baf8cb03023a54b956eef6c462fe5))
- Fix CI release boundary failures ([da6a94b](https://github.com/xtrm-dev/specialists/commit/da6a94b4004c72fc0089847f8f13341baa2a6a5e))

### Other changes
- Restore native read tool fallbacks ([3ef4168](https://github.com/xtrm-dev/specialists/commit/3ef41683c1e60ad511f98dfec359f65a6f1e325d))
- Remove Pi session missing-contract GitNexus fallback ([bd86f66](https://github.com/xtrm-dev/specialists/commit/bd86f6604dcefd0d4a6c816a3708012b0b9bece7))
- Fix obligations literal false positives ([57c572f](https://github.com/xtrm-dev/specialists/commit/57c572fe06e606b8aecc908ee3022a66022f70dc))
- Restore GitNexus counts in docs ([efe26e2](https://github.com/xtrm-dev/specialists/commit/efe26e2aa8ad833ff3da9995ee332d225c13e26f))
- Harden unstaged obligations snapshot reads ([8dd9b9f](https://github.com/xtrm-dev/specialists/commit/8dd9b9f3a6dbb034ed08898d08288aa5ff1830f1))
- Restore final .4 release attestation gates ([eb61776](https://github.com/xtrm-dev/specialists/commit/eb61776f1fdee160b8b1b9e2c1efca217f3c4459))
- Pin package artifact upload ([949ff47](https://github.com/xtrm-dev/specialists/commit/949ff471081d158eb83a4f51de4e34a4b49e6b4f))
- Pin package payload workflow actions ([14a592f](https://github.com/xtrm-dev/specialists/commit/14a592ff8a990a6c0157ee0d6c933c99ace61182))

### Project maintenance
- Reconcile roadmap pickup with the released XTRM trio (#244) ([fce9e4d](https://github.com/xtrm-dev/specialists/commit/fce9e4db8616f43fe74a0fec962265c0b39bde9c))
- Characterize K1 Codex surface boundary ([c6eb842](https://github.com/xtrm-dev/specialists/commit/c6eb842bd3f01389419a39532331908dffde502a))
- Pin K1 external references ([f2cbbd3](https://github.com/xtrm-dev/specialists/commit/f2cbbd338959987a7b9da06152ed08bd86f5aceb))
- Clarify K1 Codex fixture provenance ([ba5d803](https://github.com/xtrm-dev/specialists/commit/ba5d8036346bb439c52e598dc37a1cd2c2be1fa2))
- Label K1 fixture evidence owners ([0d1d944](https://github.com/xtrm-dev/specialists/commit/0d1d944d11dc059691febb68e7298a1b23580938))
- Make K1 render evidence reproducible ([502d0be](https://github.com/xtrm-dev/specialists/commit/502d0be25b183a9cafdfb4cf2268aa668e7d0927))
- Pin K1 render error output ([779d608](https://github.com/xtrm-dev/specialists/commit/779d60826487b7710c970bf76e6ca0d43dbe48ce))
- Correct GATE-IFACE ordering for the codex surface (review round 2) ([eb74640](https://github.com/xtrm-dev/specialists/commit/eb74640e3e30cff9a48268a6a02e4f82daa08394))
- Pin prompt hardening contracts ([ca30387](https://github.com/xtrm-dev/specialists/commit/ca30387a1b6e74aa18673a3974877119fc23784b))
- Add silent refusal regression fixture ([704dd3b](https://github.com/xtrm-dev/specialists/commit/704dd3b507479e95d7353c9c4f7182a1b48724fa))
- Add green-chain refusal context fixture ([8485662](https://github.com/xtrm-dev/specialists/commit/8485662e2f6852a5026db75feb1950c35dc12333))
- Model silent refusal acceptance case ([4fa71cd](https://github.com/xtrm-dev/specialists/commit/4fa71cd0c1793f031362214f01de0bbb047eccb0))
- Record Pi v0.84.1 compatibility audit (#251) ([64f5ab3](https://github.com/xtrm-dev/specialists/commit/64f5ab3c5c745d0f04ef12f8a3d7169d99a4119a))
- Chore add to next pr ([81c626a](https://github.com/xtrm-dev/specialists/commit/81c626a0e078aed3b62d9096eade275ac48b5275))
- Checkpoint script-runner contract coverage ([cecc60c](https://github.com/xtrm-dev/specialists/commit/cecc60cb3873dffb2a321200d2ca6d173713537e))
- Fix stale script-runner quarantine expectations ([757277e](https://github.com/xtrm-dev/specialists/commit/757277e7c0c9d96f4c3c297a8aba7dc8a1e07e25))
- Cover safe snapshot reader branches ([11299c7](https://github.com/xtrm-dev/specialists/commit/11299c7ec5509dd9a47e5b7d88dd92e7374bad0a))
- Cover release attestation refusal paths ([a75c5e8](https://github.com/xtrm-dev/specialists/commit/a75c5e89747bbc862d385c4aee20931add39e24e))
- Expect immutable attestation upload action ([4b0fcf0](https://github.com/xtrm-dev/specialists/commit/4b0fcf07bf94b39e0c09aac0f0c0b6ca21e7c29f))
- Cover v3.21.3 release candidate metadata ([c7c1827](https://github.com/xtrm-dev/specialists/commit/c7c182710c65e640ed137d8065e687a4ff243e3b))
- Anchor release attestation to tagged source ([2619316](https://github.com/xtrm-dev/specialists/commit/2619316d2640a936f4a9ca34432de6cadce5d86e))
- Commit reconciled beads export and ignore runtime skill links ([4a6921f](https://github.com/xtrm-dev/specialists/commit/4a6921fe0f1bd28cf34ecf3204562d66051c425a))
- Mark 5 operator-only skills as non-model-invocable (#253) ([8331659](https://github.com/xtrm-dev/specialists/commit/8331659438d88e01ab5d08c9d2416e662bc19d8a))

## [v3.21.2] — 2026-07-28

### Added

- **Notify parent on terminal jobs** ([0873ac2](https://github.com/xtrm-dev/specialists/commit/0873ac214163b9fb9c7be88c424393eacfbafad7))

- **Advance terminal bead assignee** ([f718df6](https://github.com/xtrm-dev/specialists/commit/f718df6839d0f5c6d700b7c5ab6fe01da62e01b9))

### Fixed

- **Resolve docs review gate findings** ([ec64645](https://github.com/xtrm-dev/specialists/commit/ec64645053f1cfe5f097275d40a8fe8bd84ee49a))

- **Align CLI honesty and coordinator prompt** ([4253782](https://github.com/xtrm-dev/specialists/commit/4253782779e87e6e67eb39c8b7509808d17b8f69))

- **Preserve terminal notification contract** ([54bf9f7](https://github.com/xtrm-dev/specialists/commit/54bf9f760bda247909b10358e85a92e57adedf28))

- **Retain active sibling assignee** ([f30d10b](https://github.com/xtrm-dev/specialists/commit/f30d10b94c76decbdc4b0c967d40d0fe9413b122))

- **Bound the attach integration pty and un-quarantine it (#226)** ([c3eca68](https://github.com/xtrm-dev/specialists/commit/c3eca6828b4d2eba1d575264e67e1d9c309c14e9))

- **Restore monitoring doctrine lost in DOC-01 (#227)** ([0501e02](https://github.com/xtrm-dev/specialists/commit/0501e02c9ff2719185c4462a87f6745aa76ebedb))

- **Document --background in sp run help and guard the drift (#228)** ([d410d9b](https://github.com/xtrm-dev/specialists/commit/d410d9be725994f35e6f72d4188217d85700bb2d))

- **Reject --background --raw and tag the background launch schema (#229)** ([b1c00f9](https://github.com/xtrm-dev/specialists/commit/b1c00f96ac21dd9f24a266d770144e9b9190a586))

- **Transition dead jobs to error so the parent is notified (#232)** ([e7d467a](https://github.com/xtrm-dev/specialists/commit/e7d467ad8f2ad72c45f63800a7ca364ae61c55bf))

- **Raise hono floor to 4.12.32 (xtrm-wiy5n.4.35) (#236)** ([8cd968c](https://github.com/xtrm-dev/specialists/commit/8cd968cdccb1208546e3aaa6a8a575806a732671))

- **Refuse Node runner with a clear one-line message (xtrm-wiy5n.4.34) (#237)** ([f2940d3](https://github.com/xtrm-dev/specialists/commit/f2940d3e3a4bf839b3fa3618bc94c01253ff3361))

### Other changes

- **Fix pi-compatible JSON output for run and feed (#206)

* fix(cli): emit pi-compatible JSON events

* fix(cli): preserve replay cwd and sequence** ([922d5d3](https://github.com/xtrm-dev/specialists/commit/922d5d32bc007e9ba440084109f254fdb2d99726))

- **Fix per-job ordering in JSON feed replay (#207)

* fix(feed): preserve per-job event sequence

* fix(feed): merge per-job streams transitively** ([5fa36e0](https://github.com/xtrm-dev/specialists/commit/5fa36e03d653a5b5a5dd3431c4802942276afeae))

- **Reference service-knowledge package (PR0 relocation) (#213)** ([cb79680](https://github.com/xtrm-dev/specialists/commit/cb796800d98a3b4bf7bb48efcc7e31fb9790dec9))

- **Service-skills-sync -> service-knowledge-sync specialist (#217)** ([7f7617e](https://github.com/xtrm-dev/specialists/commit/7f7617ea696ef77fe2e424366d17d9b0f60e6aa1))

### Project maintenance

- **Auto-refresh CHANGELOG.md — pre-push hook (xtrm-reyem.12) (#208)** ([05c57e5](https://github.com/xtrm-dev/specialists/commit/05c57e568e8e11286bd159ecbc985f58e9ee5782))

- **Chore** ([601cfa8](https://github.com/xtrm-dev/specialists/commit/601cfa8e04d190831f32ab4cb817babead5433c9))

- **Reconcile enhanced PRD v3.1 (#209)** ([a11d5bc](https://github.com/xtrm-dev/specialists/commit/a11d5bcde475530cc815815ccc0fc3329590e6a8))

- **Add pr-review-gate required-status-check workflow** ([cde9fd8](https://github.com/xtrm-dev/specialists/commit/cde9fd8971e029a085d33e7131d439f92218228f))

- **Set explicit job name for readable required-check context** ([ed10f80](https://github.com/xtrm-dev/specialists/commit/ed10f806fff39da4bfe47603838625a146d8d280))

- **Drop unsupported pull_request_review_thread trigger** ([3a79f3b](https://github.com/xtrm-dev/specialists/commit/3a79f3bd732ba2c875605584d5e553823376982b))

- **Tighten to Bot __typename + paginate threads/reviews** ([448f0a6](https://github.com/xtrm-dev/specialists/commit/448f0a6aac5a43b1a0760b0caf611a41affcce71))

- **Scope tracked documentation and reconcile roadmap** ([02241c4](https://github.com/xtrm-dev/specialists/commit/02241c47732ee497d4a7b7c61d0ca3a1c9408d29))

- **Clean README whitespace** ([d1afc58](https://github.com/xtrm-dev/specialists/commit/d1afc58d0ff1cc41c768d016c1cf5a875c45cb3d))

- **Wave-2 — pull_request_review_comment trigger + preserve CR verdicts** ([91cf32d](https://github.com/xtrm-dev/specialists/commit/91cf32dc6e86bcb121501bee478230792d0f0fa6))

- **Remove tracked open issues export (#218)** ([dc8cde3](https://github.com/xtrm-dev/specialists/commit/dc8cde3145e40c52e3b23d3865413c4a5c57571e))

- **Establish issue-linked baseline quarantine** ([3ce56be](https://github.com/xtrm-dev/specialists/commit/3ce56be6920845430d614feb85338cc4ae25805f))

- **Simplify specialist monitoring guidance** ([a2619d7](https://github.com/xtrm-dev/specialists/commit/a2619d76c3a39867934f8440fe3681413bad1ee3))

- **Retire completion marker consumer** ([5c48981](https://github.com/xtrm-dev/specialists/commit/5c489813e2c8fecdc71c11f27adca6ed470cbae3))

- **Route sp run dispatch form to the CLI help (#225)** ([844ae6c](https://github.com/xtrm-dev/specialists/commit/844ae6c8bc9beacff7e86ae0088d611435f97225))

- **Map all 58 quarantined suites and restore 10 (#230)** ([ba8526c](https://github.com/xtrm-dev/specialists/commit/ba8526cd867733b8c73ee56ed5142e01e36a09f8))

- **Run the test suite on every pull request (#231)** ([c95b35c](https://github.com/xtrm-dev/specialists/commit/c95b35c2f039895b1c93d88d14d8f1f3ec2bbed2))

- **Pin bun to 1.3.14 in PR workflows (xtrm-wiy5n.4.30) (#233)** ([e7fadb8](https://github.com/xtrm-dev/specialists/commit/e7fadb8165792289ea57b1961632576bc5bf9d61))

- **Stop the progressive-disclosure doc stating counts that go stale (xtrm-wiy5n.4.23) (#235)** ([69daedd](https://github.com/xtrm-dev/specialists/commit/69daedda077d3c90661e27b506ad4949903676bc))

- **Commit the injected block, conditioned on runtime support (xtrm-wiy5n.4.36) (#238)** ([731b423](https://github.com/xtrm-dev/specialists/commit/731b4232cf8a3cb74bafee685e4658d6accccc8f))

## [v3.21.1] — 2026-07-22

## [v3.21.0] — 2026-07-18

### Added

- **Wire verified-audit skill into reviewer.specialist.json** ([0a6895c](https://github.com/xtrm-dev/specialists/commit/0a6895c95dac898f97ca6af9d94265c2c52246e5))

- **Isolate ambient pool + force turn-1 body load (unitAI-0o3pv, -qeguh, -uv1yg)** ([3d77800](https://github.com/xtrm-dev/specialists/commit/3d7780010061d844363436452aca5257da6f8d82))

- **Add --surface to sp view (#195)** ([ab88775](https://github.com/xtrm-dev/specialists/commit/ab8877542c07668ee0a359b226402b02a9135c86))

- **Help audit + cliff cleanup + repo metadata + release docs (r6g.3, WIP) (#196)** ([0f4a31d](https://github.com/xtrm-dev/specialists/commit/0f4a31d316a277c2b51ec56e04c659de48987b83))

### Fixed

- **ESRCH crash in Background jobs check** ([76ce52a](https://github.com/xtrm-dev/specialists/commit/76ce52adc4148b0b9140b864ebc51445fe318944))

- **Skip template specialists in model-configured check + skip null-id sqlite rows** ([0d450ed](https://github.com/xtrm-dev/specialists/commit/0d450ed48d65543336d35ea172af16a17a329765))

- **Bump stall_timeout_ms + Phase 6 self-open-PR (xtrm-efa2a.1, xtrm-vu2ro.1) (#192)** ([7bcd3a0](https://github.com/xtrm-dev/specialists/commit/7bcd3a06f25e376706d949bbbd6b97f0dd81c390))

- **Render Claude skill commands separately** ([2fbcabd](https://github.com/xtrm-dev/specialists/commit/2fbcabd4c1498927dea248ee9d6e0192cf13f62e))

- **Rebuild Claude skill prefix distribution** ([d560314](https://github.com/xtrm-dev/specialists/commit/d5603144a9ba97b154cb32b42f214a572029d401))

- **Trust OSV verdict and preserve unknown launch mode** ([578ef90](https://github.com/xtrm-dev/specialists/commit/578ef9090a56de5d19016f56e45df6f3c443fbb9))

- **Reject OSV scanner operational exits** ([4e37caa](https://github.com/xtrm-dev/specialists/commit/4e37caa6bed9ebfa85e304dbcef5d7aa31c4e7d1))

- **Isolate pull request workflow trust boundary** ([797b8f3](https://github.com/xtrm-dev/specialists/commit/797b8f3baf4148f880ef9eb1903e46f16e89cb5b))

- **Close PR 193 Ubuntu CI gaps** ([c5d46fe](https://github.com/xtrm-dev/specialists/commit/c5d46fef38c29a1f5911e2d222021f5e7ba78937))

- **Reject compound PR workflow guards** ([e93d8bd](https://github.com/xtrm-dev/specialists/commit/e93d8bdf6ad256bbcdc2bba63af84b7af61d37b0))

- **Validate rendered skill names** ([e44b451](https://github.com/xtrm-dev/specialists/commit/e44b4515fa6862032b9f84c1ac637420150eeb50))

### Other changes

- **Orphan releasing/SKILL.md — core owns it** ([455e123](https://github.com/xtrm-dev/specialists/commit/455e12321c93bd80c39478641a7a69449c63ce53))

### Project maintenance

- **Record the post-release launcher smoke** ([670d213](https://github.com/xtrm-dev/specialists/commit/670d2134ee6fff2ab12158c49b460e0c76bd3555))

- **Correlate xtmux coordination replies (#188)** ([a575696](https://github.com/xtrm-dev/specialists/commit/a575696f32862c9d548fd4b09f5a3cf42c0254c1))

- **Reviewer-path interaction with /skill: prefix** ([f6fdb90](https://github.com/xtrm-dev/specialists/commit/f6fdb90177b2b4be1c9ffded8a3739cc43a32ddb))

- **Retire repo-local mirror checks, redirect to global vendored paths** ([d0ce4c2](https://github.com/xtrm-dev/specialists/commit/d0ce4c29077680f25847e3ecf1d1a91fd2503788))

- **Refresh [Unreleased] with verified-audit wire** ([ec36b3f](https://github.com/xtrm-dev/specialists/commit/ec36b3fc1bc2b3d846af68a130eec5cd4c4b9253))

- **Resync task-prompt d.ts with source docstring** ([9f86070](https://github.com/xtrm-dev/specialists/commit/9f860700657d40475fdc030772adfda6c5726438))

## [v3.20.0] — 2026-07-14

### Other changes

- **PR E — runtime-origin: direct spawn binding (E1..E6, epic unitAI-z8uli) (#185)

* chore(changelog): add git-cliff config and changelog

Generic type-based parsers; repo-specific scopes to be tuned (see P0 bead).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

* feat(runtime-origin): add RuntimeOriginV1 module (E1)

Adds src/specialist/runtime-origin.ts: the leaf module the whole runtime-origin
integration builds on (spec /home/dawid/dev/xtmux docs/xtmux-gaps.md §11, §13.1-4).

- RuntimeOriginV1 type verbatim from spec §11.
- SpecialistSpawnOriginV1 discriminated union (§13.3) — consumed by E4.
- SPECIALISTS_RUNTIME_ORIGIN_V1 env var name constant.
- validateRuntimeOrigin: strict schema check with unknown-field rejection.
  Forward-compat via schema_version bump, not silent pass-through.
- captureRuntimeOrigin: DI-injectable subprocess runner, 500ms timeout,
  never throws. Returns undefined on outside-tmux / ENOENT / non-zero /
  parse-fail / schema-fail / oversize / runner-throw.
- decodePropagatedOrigin: auto-detects raw JSON vs base64url from leading
  char; preserves `verified`; rewrites capture_source='propagated'.
- encodePropagatedOrigin: base64url canonical encoding.

Log surface: single-line `[specialists] component=runtime-origin
event={capture,propagate,reject} outcome=... reason=... duration_ms=...`
via console.warn. Never logs raw JSON payload. 16KiB payload cap.

Failure behavior non-negotiable per spec §15: NEVER fails a Specialists
run; NEVER fabricates a binding.

Bead: unitAI-z8uli.1 (epic unitAI-z8uli PR E direct spawn binding).
33 tests pass, tsc clean.

* feat(runtime-origin): capture at sp run boundary + background propagation (E2+E3)

E2 (unitAI-z8uli.2) — capture BEFORE --background branch (spec §13.1):
The invoking pane's identity must be resolved here. The detached child's
TMUX_PANE resolves to the sp-* feed pane, so capture MUST precede the
detach. A propagated origin in the environment (background re-invocation)
wins over ambient capture — the child rediscovering its own sp-* pane is
the exact bug the propagation exists to prevent.

E3 (unitAI-z8uli.3) — SPECIALISTS_RUNTIME_ORIGIN_V1 through detach (§13.2):
When ambientRuntimeOrigin is present, encodePropagatedOrigin (base64url)
injects it into the child env via BOTH branches — createTmuxSession's
extraEnv and cpSpawn's env — so the child's `sp run` decode step recovers
the original pane's origin instead of ambient-capturing its own sp-* pane.

No child env noise when no origin exists — empty {} spread.

Downstream: launchSpecialist call still receives no origin — E4 threads
it through RunOptions → SupervisorStatus → run_start.

Smoke: `bun run src/index.ts run --help` exit 0.
Tests: 33/33 in tests/unit/specialist/runtime-origin.test.ts pass.
tsc clean for run.ts.

* feat(runtime-origin): thread SupervisorStatus + RunOptions + run_start (E4)

Types added:
- RunOptions (runner.ts): ambientRuntimeOrigin, explicitParentJobId.
- LaunchSpecialistOptions (launch.ts): same two fields, forwarded into
  the RunOptions constructed for Supervisor.
- SupervisorStatus (supervisor.ts): spawn_origin, parent_job_id,
  root_runtime_origin (all optional; no schema migration — persisted into
  status_json blob per spec §13.6).
- SupervisorStatus.startup_context: compact projection —
  spawn_origin_kind, parent_job_id, root_pane_id, root_agent_instance_id.
- TimelineEventRunStart.startup_snapshot: same compact projection.

Precedence codified per spec §13.4:
- resolveSpawnOrigin() helper in runtime-origin.ts encapsulates the
  explicit parent > ambient > unknown decision. Kept in the leaf module
  so precedence is unit-testable in isolation. F2 (unitAI-z8uli.8)
  refines the specialist.job case by looking up the parent's stored
  root_runtime_origin so the whole chain shares one root.

Wiring:
- cli/run.ts launchSpecialist call passes ambientRuntimeOrigin captured
  in E2.
- launch.ts forwards both fields into Supervisor's RunOptions.
- supervisor.ts:1274 initialStatus construction runs resolveSpawnOrigin
  once and populates status + startup_context together.
- observability-sqlite.ts readForensicContext surfaces the persisted
  origin fields verbatim from status_json (E5 tightens types when it
  builds the ForensicSpawnedByLink shape).

Non-regression check:
- runtime-origin.test.ts 38/38 pass (+5 for resolveSpawnOrigin).
- Baseline supervisor.test.ts pre-existing failures verified equal
  with/without this change (37 fail, 3 errors — events.jsonl ENOENT
  in test env, not runtime-origin-related).
- tsc clean.

Bead: unitAI-z8uli.4.

* feat(forensic): enrich job.started with typed origin links + labels guard (E5)

Adds the durable pane→job / job→job forensic link surface (spec
docs/xtmux-gaps.md §13.5, §16).

Types:
- ForensicCorrelation.parent_job_id typed field (was catch-all).
- ForensicSpawnedByLink discriminated union — pane form
  (xtmux.agent_instance + host_id + full tmux ID triple + optional
  agent_instance_id) or child form (specialist.job + job_id).
- ForensicRootRuntimeOrigin — compact projection (host_id + tmux_pane_id
  + optional agent_instance_id). Only fields needed to reconnect a job to
  its root pane; captured_at_ms / capture_source / verified / bead_id
  stay in status_json, not in the durable forensic link.

Emission:
- forensicEventFromTimelineEvent(run_start, ...) attaches typed
  `links.spawned_by` + `links.root_runtime_origin`. Only run_start.
- bodyForTimelineEvent gained a 2nd context param and a 'run_start' case:
  body.origin_source ∈ {xtmux-context, propagated, child-of-specialist,
  none}; body.origin_verified; body.launch_mode ∈ {foreground, background,
  unknown} — derived from origin_source (propagated ⇒ background).
- correlation.parent_job_id populated for child jobs only.

Whitelist projection:
- projectSpawnedByLink / projectRootRuntimeOrigin exported. Both strip
  unknown fields — defence against future RuntimeOriginV1 additions
  bleeding into the immutable event surface. Adding a field to the link
  requires an explicit whitelist change here.

Prometheus label guard:
- FORBIDDEN_PROMETHEUS_LABELS gains parent_job_id, agent_instance_id,
  host_id, tmux_session_id, tmux_window_id, tmux_pane_id (spec §16).
  Test asserts each. High-cardinality identifiers stay in
  forensic-correlation / links / Console read models — never labels.

Reader contract:
- No links.spawned_by is emitted for kind:'unknown' — reader assumes
  missing = no known binding.
- No links entry on non-run_start events.

Observability wiring:
- observability-sqlite.ts writeForensicEventRow threads parentJobId,
  spawnOrigin, rootRuntimeOrigin (read from status_json by
  readForensicContext in E4) into the emitter context.

Tests: 21 new (forensic-run-start-origin.test.ts) + 26 pre-existing
forensic-events.test.ts all green. tsc clean.

Bead: unitAI-z8uli.5.

* feat(ps): expose spawn_origin / parent_job_id / root_runtime_origin (E6)

sp ps --json (both --inspect and flat list) and human --inspect now expose
the runtime-origin fields recorded on SupervisorStatus (spec §13.7).

- renderInspectJson: additive spread of spawn_origin, parent_job_id,
  root_runtime_origin — absent for legacy rows to keep --json output
  byte-stable.
- renderJson flat list: same three fields per row.
- renderInspect human: one compact line, only when origin is present:
    spawned-by host-<8> / <session>:<pane> / agent <8>
    spawned-by specialist.job <parent-8>
  Never a misleading "unknown" line — kind:'unknown' renders nothing.

Exported formatSpawnedByLine for isolated unit-testing. 5 formatter
tests cover pane origin, agent-optional path, specialist.job form,
absent origin, kind:'unknown'. tsc clean; sp ps --help smoke green.

Bead: unitAI-z8uli.6.

---------

Co-authored-by: jaggerxtrm <dawid.jgg@gmail.com>
Co-authored-by: Claude Opus 4.8 (1M context) <noreply@anthropic.com>** ([5f3dfc4](https://github.com/xtrm-dev/specialists/commit/5f3dfc414dbcdd1169d1096a512d9d46beb7bfa1))

- **PR F — runtime-origin: descendant lineage + E2E reconstruction (F1..F4, epic unitAI-z8uli) (#186)

* feat(launch): explicit parent_job_id on internal member spawns (F1)

Threads explicitParentJobId through the only two internal sites that create
a separate SupervisorStatus from inside a running specialist context:

- job-control.ts:startJob signature accepts optional explicitParentJobId
  and merges it into RunOptions. E4's resolveSpawnOrigin already consumes
  this as the top-precedence gate — a populated value flips the child's
  SupervisorStatus.spawn_origin.kind to 'specialist.job'.

- node-supervisor.ts member-spawn call sites (primary spawn + replacement
  respawn) now pass explicitParentJobId: this.coordinatorJobId when the
  coordinator id is known.

Every internal dispatch emits:

    [specialists] component=launch event=child-dispatch
      parent_job_id=... node_id=... member_id=... outcome=ok

Sites deliberately NOT touched:
- Coordinator spawns — ROOT of node execution, no parent.
- spawnDynamicMember — public API without owner context in scope.
- use_specialist.tool — runner.run() directly, no separate SupervisorStatus.
- cli/chat.ts + cli/node.ts — user-invoked, not specialist-invoked;
  ambient-origin capture at those entry points is an E2 gap, follow-up.
- script-runner.ts — READ_ONLY sp script, no job lifecycle.

tsc clean; runtime-origin / forensic / ps unit tests still 64/64 green.

Bead: unitAI-z8uli.7.

* feat(supervisor): inherit root_runtime_origin from parent job (F2)

When an initial SupervisorStatus is being constructed for a child job
(runOptions.explicitParentJobId set), the supervisor reads the parent's
persisted SupervisorStatus via sqliteClient.readStatus and inherits its
root_runtime_origin into the child's own status.

E4's resolveSpawnOrigin helper accepts inheritedRootRuntimeOrigin as its
third input; F2 just wires the value. The whole chain A → J1 → J2 → ... → Jn
now shares one root pane binding.

Failure behavior:
- Missing parent status (parent already terminal / never persisted):
  root_runtime_origin stays undefined. NEVER fabricated.
- Sqlite lookup throws: caught, logged, no fabrication. Child allocation
  still succeeds — the epic's failure-behavior invariant holds.

Log surface:
  [specialists] component=launch event=inherit
    parent_job_id=... outcome={ok, parent-missing, lookup-failed}

The precedence rule (explicit parent > ambient > unknown) is unchanged.

Bead: unitAI-z8uli.8. tsc clean; 64 tests still green.

* feat(runtime-origin): forensic lineage reconstruction + redaction sweep (F4)

Adds the F4 acceptance surface for spec §18 end-to-end fixture and §16
redaction rules.

New module: src/specialist/runtime-origin-reconstruct.ts
- reconstructLineage(events) → Map<job_id, ReconstructedJobNode>. Pure
  functional over ForensicEvent[]; no live sqliteClient, no jobRegistry,
  no tmux. This is exactly the Console (§14) read model at the forensic
  level.
- redactionSweep(events) → { forbidden_label_hits, payload_leaks }.
  Scans event.resource for any of the 6 forbidden runtime-origin
  identifiers (spec §16) and event.body for prompt/raw_command/raw_diff/
  model_output/raw_error leaks. Regression guard for future emission
  changes.

Integration test: tests/integration/specialist/lineage-e2e.test.ts
- A (pane %17) → J1 (background, propagated origin) → J2 (child of J1):
  reconstruction proves J1<->A, J2<->J1, J2<->A all resolvable from the
  event stream alone.
- Outside-tmux negative control: no spawned_by, no root_runtime_origin.
- Purity: reconstruction is idempotent over independent calls (no
  hidden runtime state).
- Clean sweep: zero forbidden-label hits, zero payload leaks on the
  fixture stream.
- Synthetic regressions: forbidden label promoted onto resource, and
  prompt leak in body, are both caught.

Live-with-real-xtmux gate: deferred until xtmux-j46.2 lands on xtmux
main. The reconstruction CONTRACT is verified today.

Total: 70 tests pass across 4 files (runtime-origin, forensic-run-start-
origin, ps-spawned-by-line, lineage-e2e). tsc clean.

Bead: unitAI-z8uli.10.** ([62af1ee](https://github.com/xtrm-dev/specialists/commit/62af1ee60501b46d7a51aea5f0b9f231b3d738a1))

## [v3.19.0] — 2026-07-14

### Added

- **Expose read-only task-prompt renderer (sp render-task)** ([147c671](https://github.com/xtrm-dev/specialists/commit/147c67125fcb04e659934bacfa2bb4d9e47a2359))

  Extract sp run's task-side prompt assembly into one pure seam
  (src/specialist/task-prompt.ts renderTaskPrompt) and reuse it from a new
  read-only CLI so `xt pi/claude --role` can send the same initial user prompt
  without forking renderer logic. SpecialistRunner.run now delegates to the seam;
  buildBeadContext / renderTemplate / buildMandatoryRulesInjection are unchanged.

  Execution-only steps stay out of the renderer: pre-scripts and the reviewer
  git-diff context (the latter enters sp run via appendExecutionContext, still
  before the hash, so prompt_hash semantics are unchanged). Mandatory-rule
  resolution failure is fatal for the renderer but keeps sp run's warn-and-skip.

  Dedup chain-coordinator task_template: $prompt and $bead_context both resolved
  to the same string, rendering the full bead context twice on every tracked run.

  Closes unitAI-6639v.1, unitAI-6639v.4

### Fixed

- **Repoint skill refs to the global root and hard-fail missing skills** ([3f829b6](https://github.com/xtrm-dev/specialists/commit/3f829b6534247f8cdb036cc39a3feb42d5d1f77a))

  The global-skills migration retired `.xtrm/skills/active/` in favour of
  `~/.xtrm/skills/default/`, but every vendored specialist still pointed at the
  old root. Nothing surfaced it: the loader passed bare relative paths through
  unchanged, validateBeforeRun only warned, and pi silently ignores a
  nonexistent `--skill` (exit 0, no diagnostic). chain-coordinator and its
  siblings had been running with no skills loaded at all.

  Repoint every stale reference, not just skills.paths: bare skill names and the
  repo-local memory-audit-transaction path resolved against cwd and broke inside
  worktrees; sync-docs' pre-script pointed at a file that no longer existed (it
  never hard-failed because the check only verifies the `bash` binary); and
  researcher's prompt prose named the retired root.

  Promote a missing declared skill from a warning to a pre-launch hard failure so
  a stale skill path can never again reach pi unnoticed.

  Closes unitAI-6639v.2.1

- **Stop re-expanding variables inside bead content** ([ca46e59](https://github.com/xtrm-dev/specialists/commit/ca46e59a22c8ce05e09c5146cd3ad1f15e70fa15))

  The task render ran twice: the first pass substituted $prompt with the bead
  body, and the second re-scanned the result. A bead whose text contained a
  literal $cwd or $bead_id therefore had it replaced with the real value — bead
  content was being treated as template source.

  Render once over the original template with the union variable map. Every
  template-origin token still resolves; only the injected content is no longer
  re-scanned.

  Closes unitAI-6639v.5

### Project maintenance

- **Add git-cliff config and changelog** ([d648135](https://github.com/xtrm-dev/specialists/commit/d64813593f8996ed02e4dc3d92ad813d20f31bf7))

  Generic type-based parsers; repo-specific scopes to be tuned (see P0 bead).

- **Split using-specialists into a router + on-demand references** ([b973312](https://github.com/xtrm-dev/specialists/commit/b973312dd2f53368b5218b5b0938a86f6704d08e))

  using-specialists was a 1416-line monolith injected in full into every session
  that referenced it — 98KB of eager context for chain-coordinator, most of it
  irrelevant to the phase it was in.

  Split it into a 256-line router that carries only always-needed policy (rules,
  gates, specialist choice, escalation, promotion gate) plus six bundled
  references loaded per phase. Sections were moved verbatim by line range, and
  references/content-migration-map.json records where each of the 41 original
  sections went, so "no content loss" is machine-testable rather than asserted.
  Coordinator eager payload drops to 21,689 bytes (-78%).

  The asset-contract generator collected only files literally named SKILL.md, so
  bundled resources would have shipped untracked and a missing reference could
  pass release and fresh-install validation unnoticed. It now tracks everything
  under config/skills except evals/, which also closes a pre-existing gap where
  four shipped skill scripts were absent from the contract.

  Closes unitAI-6639v.2.2

- **Validate progressive disclosure, selective loading, and role parity** ([23cd9e1](https://github.com/xtrm-dev/specialists/commit/23cd9e19dadc36abde48f4be501051b4ad0f6171))

  Covers unitAI-6639v.3: prove the split skill preserves behaviour, that an agent
  loads only what its phase needs, and that the three surfaces that build a task
  prompt agree.

  - role-envelope-parity: the pi/claude/sp-run matrix from the .1 parity decision.
    pi and claude are byte-identical on the task side; sp run differs only by the
    execution-only layers (pre-scripts, reviewer diff); prompt.system never leaks.
  - selective-loading: each phase has exactly one owning reference, the router
    routes to it, and the router alone answers always-needed policy. Cross-file
    references are pointers, not copies — ownership is the invariant.
  - three progressive-disclosure eval scenarios, each asserting the agent does NOT
    open references irrelevant to its phase.
  - benchmark artifact comparing v3.7 with v3.8, incl. live smoke transcripts and
    the known limitations.

  Closes unitAI-6639v.3

## [v3.18.3] — 2026-07-13

### Changed

- `using-specialists` skill and the `chain-coordinator` specialist now use the `xtmux` command prefix instead of the legacy `tmux-session-picker` name for coordinator→orchestrator escalation. `chain-coordinator`'s `external_commands` allowlist was updated to match, so the coordinator can actually run the command its prompt names (xtmux-d0a.22, #184).

## [v3.18.2] — 2026-07-12

### Added
- **Interactive chain coordination specialist (`unitAI-f9ixg`, #175).** Added `chain-coordinator` for tracking and coordinating interactive epic chains.

### Changed
- **Canonical orchestration skill (`fa893e36`).** Consolidated versioned `using-specialists-v2`/`v3` guidance under `using-specialists`; existing-project sync removes retired managed copies while preserving user-owned active skills.
- **Effective-spec inspection (`xtmux-1lb.4`, #178).** `sp view --raw` now returns the merged effective specification.

- **Unified code-restraint discipline across mandatory-rule + orchestrator skill (`unitAI-pzmwf`).** The single-line `code-quality-defaults` mandatory rule (SRP/DRY/KISS/YAGNI) is now the canonical home for the full restraint lens executor/reviewer/seconder share: the 7-rung ladder (YAGNI → reuse → stdlib → native → installed dep → one line → minimum), rules against unrequested abstractions and premature scaffolding, an explicit "never simplify away" boundary (input validation at trust boundaries, error handling that prevents data loss, security, accessibility, explicitly requested behavior, understanding the problem), a `// SIMPLIFIED: <ceiling>. upgrade when <trigger>.` marker convention for deliberate shortcuts (unmarked shortcuts silently rot; marked ones stay tracked), and the finding-report tag vocabulary (`delete: / stdlib: / native: / yagni: / shrink: / keep:`) that both reviewer and seconder now cite verbatim in their smell-pass sections. Reviewer's system prompt gained a `## Simplification Findings` section that instructs it to cross-check every proposed cut with `gitnexus_impact` before recommending and to refute overclaimed shrinks with `keep:` naming the load-bearing reason. Seconder's `## Quality smell pass` now emits `quality_findings` entries using the same tag vocab in the `issue` field. `config/skills/using-specialists/SKILL.md` gained a `## Restraint And The Ladder` section teaching the orchestrator to write narrower SCOPE / explicit NON_GOALS in bead contracts, consume `shrink:`/`delete:` findings verbatim during review loops, apply the same ladder when implementing directly, and pick between one-bead-vs-epic scoping by a 30-minute bounded-diff heuristic. Zero external plugin brand references in shipped text — this is the specialists ecosystem's own discipline, not a rebadge.

### Fixed
- **Terminal result fallback (`#179`).** Completed jobs preserve fallback output when the terminal event has no text.

- **Terminal-alive orphan reaper — pi keep-alive sessions no longer leak indefinitely (`unitAI-yme9q`).** Closes the class of orphans surfaced by a live audit: 8 real jobs across `dev/console` with SQLite rows marked `done`/`error` for 60–180+ minutes while their bun wrapper and detached `pi` child (plus 10 MCP workers each in the worst cases) were still running, plus a 28060-minute-old zombie in `mercury/quant`. Root cause: standalone `sp run <spec> --bead ... &` invocations dispatch a keep-alive `pi` session whose `closeFn()` is only invoked by an external actor sending `{type:"resume"|"close"}` over the job's FIFO or by the `waiting_auto_close_ms` watchdog (default `0`/disabled) — with neither present, the session survives the job's terminal transition indefinitely. Every existing cleanup surface missed it: `collectStaleSpecialistJobs` filtered to `starting|running|waiting` (explicitly excluding terminal jobs), `orphaned-keep-alive` additionally required `ppid===1` (none of the leaked processes were reparented because their tmux/shell parent was still alive), and `sp stop` short-circuited to "already finalized" without checking real PID liveness. Three-surface fix: (a) `collectStaleSpecialistJobs` in `src/specialist/process-health.ts` gains a second pass over `done|error|cancelled` statuses whose PID is still alive past `minTerminalAliveAgeMs` (default 60s — pi's own group-SIGKILL backstop is 8s, so anything past a minute is definitively leaked), yielding a new `reason: 'terminal-alive'` that does NOT require `ppid===1`; (b) `reapStaleSpecialistJobs` in `src/cli/clean.ts` kills the whole process group (SIGTERM → 500ms grace → group-SIGKILL to `-pid`) so the detached pi child and its MCP workers all die together, without overwriting the DB row (job was correctly terminal, only the process leaked); (c) `stopJob` in `src/specialist/control.ts` now checks `isProcessAlive(pid, started_at_ms)` before returning "already finalized", emits a new `stop_terminal_alive_reaped` control event, and prints `Reaped orphaned PID <pid> for job <id>`. Verified end-to-end: `sp clean --reap-orphans` detected and killed a seeded orphan (message: `Reaped 1 stale specialist job`), `sp stop <job>` group-killed a real 12-hour-old sleep-3600 detached child in <2s. 8 new/updated unit tests (`process-health.test.ts` + `stop.test.ts`) plus a `StatusFixture` test helper that clears long-standing tsc excess-property noise across the whole file. Full `bunx tsc --noEmit` clean; targeted vitest 29/29.

## [v3.18.1] — 2026-07-04

### Added
- **Live tmux panes for background specialists (`specialists-14k`, PR #163).** `sp run <name> --background` now launches the real run in the tmux pane, waits for the `SPECIALISTS_BG_JOB_ID_PATH` handoff, then switches the same pane to `sp feed <job> --follow`. Operators selecting the tmux session see the same timeline as `sp feed` without manually running a second command. The handoff emits `tmux_live_feed_started` telemetry and preserves prompt redaction; smoke fixed the wrapper's shell background syntax before linking globally.
- **Full assistant text in `sp feed` (`specialists-2jc`, PR #163).** Feed timeline `text` events can now carry non-thinking assistant `content`; human feed renders multiline assistant messages with deterministic truncation markers, while JSON/NDJSON consumers remain backward-compatible with legacy `text` events that only have `char_count`. Pi session plumbing extracts assistant text from streaming `text_delta`, `message_end`, and final `agent_end` boundaries, de-dupes duplicate terminal content, and keeps thinking/reasoning events separate.
- **Durable PR/base drift fields on specialist_jobs (`specialists-05q.1`).** V13 schema migration adds 10 nullable columns to `specialist_jobs` (`pr_url`, `pr_head_sha`, `pr_state`, `pr_merge_state`, `pr_classification`, `pr_base_ref`, `pr_base_sha`, `pr_drift_checked_at_ms`, `base_sha_pinned`, `base_sha_pinned_at_ms`). `SupervisorStatus` gains matching optional fields for serialization symmetry. New typed surface on `ObservabilitySqliteClient`: `PrDriftState`/`PrDriftStatePatch` types, `readPrDriftState(jobId)`, `updatePrDriftState(jobId, patch)` (partial-update; `null` clears, omitted keys unchanged). Backward-compatible — old JSON blobs decode with the new fields undefined. Bridge → substrate: columns rename 1:1 onto `containers.*` per specialists-roadmap §B.3.
- **Stale-base fetch-and-pin gate + `--accept-stale-base --reason` (`specialists-05q.3`).** `sp run` gains `--base-sha <sha>`, `--base-ref <branch>`, and `--accept-stale-base --reason "<text>"`. New `resolveBasePin()` runs `git fetch` and computes a structured refusal envelope on stale base: `{ ok: false, error_code: "stale_base", blocked_by, next_safe_action, base_sha_pinned, base_sha_observed, current_sha, branch, worktree_path, commits_behind }`. Fetch failures emit `error_code: "base_fetch_failed"` with `{ blocked_by: ["fetch_or_resolve_failure"], underlying_error }` rather than crashing dispatch. `--force-stale-base` retained as a deprecated alias with a one-line stderr deprecation warning. Pin is persisted via `updatePrDriftState({ base_sha_pinned, base_sha_pinned_at_ms })` on the chain-identity row.
- **PR drift refresh + attention surface (`specialists-05q.2`).** `doctor --pr-drift` shells out to `gh pr view --json state,mergeable,mergeStateStatus,baseRefName,baseRefOid,headRefOid` for each PR-linked job whose `pr_drift_checked_at_ms` is stale (default: > 5 min) or null. `deriveClassification()` maps GitHub status to the canonical vocabulary: `clean | needs-rebase | conflicted | blocked | stale | unknown`. `gh` failures (missing binary, network, no PR) classify as `unknown` and emit a sha256-hashed `gh_stderr_hash` field — `refreshPrDriftForJob` never throws. Structured log per refresh: `{ component: "pr_drift", event: "refresh_attempted"|"refresh_completed"|"refresh_failed", job_id, duration_ms, gh_stderr_hash, pr_classification, branch?, checked_at_ms? }`. `sp ps` gains a `[drift:<classification>]` badge on the status line for non-clean classifications, a `--needs-attention` filter flag (keeps only jobs whose `pr_classification` is non-clean), and `sp ps --json` adds an additive `attention_reasons[]` array. New `listJobsNeedingPrDriftRefresh(olderThanMs?)` helper on `ObservabilitySqliteClient`.
- **Dead-job audit (`specialists-05q.4`).** `doctor --reap-dead-jobs [--dry-run] [--json]` scans `specialist_jobs` rows in active states (`starting`/`running`/`waiting`) with PIDs that fail `process.kill(pid, 0)` (ESRCH) and have been idle for > 60s. Conservative predicate (all four conditions must hold) prevents false dead-marking. Cancellation reason: `container-restart-orphan`. Each finding emits one `xtrm.forensic.v1` event `{ event_family: "lifecycle", event_name: "dead_declared", body: { job_id, pid, age_ms, reason, dry_run } }` (suppressed in dry-run) plus a structured stderr log. New `collectStaleSpecialistJobs({ minAgeMs })` query helper. JSON envelope: `{ dryRun, found:[{job_id, pid, reason, age_ms}], cancelled }`.

### Changed
- **`executor-delivery` mandatory-rule: scope allowlist + never-close-anchor-bead (EVAL-10/13, `mercury-market-data-i2kb`).** Extracted from mmd-sprint 2026-07-03. Executor now must parse the bead's `SCOPE` section into an explicit path allowlist before the first edit and refuse `git commit`/`push` if any staged path is outside the allowlist — closes the systemic scope-pollution failure where two workers force-pushed `.serena/project.yml`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, and an unrelated chore commit alongside their real fix. Executor also must not close the anchor bead; anchor closure is a post-verification concern owned by the orchestrator after judge PASS + deploy-monitor window clean.
- **`test-runner-execution-scope` mandatory-rule: bash-pytest fallback + CI-parity pyright (EVAL-11/15, `mercury-market-data-3ele`).** On tool-call-parse failures from the underlying model (observed against Kimi during mmd-sprint 2026-07-03), test-runner now falls back to invoking the same command directly via bash (`pytest`, `npm test`, etc.), labels the result `fallback:bash`, and records the parse-error signature so orchestrators can steer subsequent runs off the failing backend — a tool-call-parse error is a model-runtime bug, not a test failure. Pyright must run the way CI runs it (same version, same venv-activation state); a local pyright pass under a divergent environment hides `NaTType | Unknown` and similar stub-visibility drift that only fails at merge time.
- **`using-specialists-v3` skill: contract:draft/ready bead-promotion gate + rule #15 hard-refuse (v3.6 → v3.7).** Adds new rule #15 to the Never-Do checklist ("Never dispatch a specialist against a bead tagged `contract:draft`"), a "Draft Beads And The Promotion Gate" section teaching the two-phase capture-then-promote workflow (`bd create --labels contract:draft` → `bd set-state <id> contract=ready` before dispatch), and a Table-updates row on `contract:draft` dispatch. Ported from xtrm-tools PR #351 (`xtrm-824xs`); closes the vendor-drift concern tracked as xtrm-tools bead `xtrm-rcsmu`.
- **`using-specialists-v3` skill: canonical bead nesting + title convention (`unitAI-2mro0`, v3.5 → v3.6).** `bd create --parent` was previously framed as epic-only ("epic-child edge"), so orchestrators defaulted every explorer/executor/reviewer/seconder/security bead spawned mid-chain to a loose top-level bead instead of nesting. The skill now clarifies `--parent` works on any bead type and nests recursively (`bd-x.1.1`), and defaults to nesting any specialist-dispatch bead under the bead it services, combined with typed `bd dep add --type` edges for semantic relationship. Also canonicalizes the `<specialist-role>: <task>` bead title convention (previously a single ad hoc example) via a new "Bead Title Convention" section, with root task/epic umbrella beads exempt. Canonical single-chain and multi-chain flow examples updated to demonstrate both. Swept to all fleet repos under `~/dev` and `~/projects/mercury`.
- **`specialists-roadmap.md` §B durable runtime track + ownership split (`specialists-05q.5`).** New section pins ownership of PR/base drift work across four owners (xt / sp / bd-substrate / xtrm-Mercury collaborator doc) with a 4-row migration table (PR drift fields, base_sha pin, attention view, dead-job audit) using `rename`/`attach`/`retire` migration-shape vocabulary. Inline notes on §3.2 Opp 1 (lease arbitration belongs to bd merge-slot, NOT new `sp lease*` columns) and Opp 7 (absorbs `specialists-05q.3` fetch-and-pin base SHA semantics — not a new opportunity). No changes to the existing twelve-opportunity structure.

### Fixed
- **`sp merge` rebuild step skips non-Node repos (mmd-sprint memory `sp-merge-tsc-false-positive`).** `runRebuild` in `src/cli/merge.ts` unconditionally shelled out to `bun run build`, which failed on Python (and other non-Node) repos with no `package.json` or no `scripts.build`. Sibling `runTypecheckGate` already skipped when no `tsconfig.json` was present; the parallel guard was missing from `runRebuild`. Added `hasNodeBuildScript()` helper that reads `package.json` for a non-empty `scripts.build` and skips with a clear "no package.json build script — non-Node repo" message. Also clarified the tsc-gate skip message to say "non-TS repo" instead of the ambiguous "no tsconfig". Full `bunx tsc --noEmit` clean.
- **`sp ps` / `sp status` reconciliation (`specialists-otm`, PR #163).** Shared status loading now merges SQLite and legacy file snapshots by freshness, repairs stale active rows when a terminal `run_complete` exists, and records dead-job evidence without hiding actionable rows. Malformed `status_json` rows are filtered instead of collapsing the whole dashboard to zero jobs, so `sp ps`, `sp ps --json`, and `sp ps <job>` agree across running, waiting, terminal, dead, and cleaned rows.
- **Gitleaks historical baseline (`unitAI-xsrpn`).** Added a redacted Gitleaks baseline for acknowledged 2025 history findings and wired PR/push/scheduled scans to `--baseline-path`, so CI blocks new leaks without repeatedly failing on immutable historical debt.
- **release-gate core co-vendoring dispatch (`unitAI-p1ecm`).** The release-gate workflow now dispatches asset-contract validation directly to `xtrm-dev/core` via `gh api` with raw JSON, avoiding the `peter-evans/repository-dispatch` redirect/content-length failure from the old `Jaggerxtrm/xtrm-tools` target. Payload now sends `specialists_tag` as `v<package_version>` instead of `master`.

## [v3.18.0] — 2026-06-24

### Added
- **`sp console` v2 — full TUI rewrite (epic `unitAI-ctb4u`, PR #125).** Replaces the original prototype console with a complete multi-view terminal UI built on `@earendil-works/pi-tui`. Views: `ps` (live process list with tree depth, context %, status glyphs, column-adaptive layout), `feed` (live/forensic event stream with follow mode), `job` (inspect fields + action list), `result` (full job output), `bead` (linked bead doc + live state), `diff` (worktree + commit SHA fallback), `config` (global `user.json` override editor), `repoConfig` (repo registry management). 24-bit ANSI palette sourced from mock-v2 design doc. Keybindings: `↑↓`/`j/k` navigate, `↵` open feed, `r` result, `i` inspect, `b` bead, `d` diff, `g` config, `R` repos, `h` history, `a` all, `/` filter, `x` stop, `tab`/`1-9` switch repo, `0` ALL view, `q` quit.
- **ALL view — aggregated cross-repo dashboard with cursor navigation.** Opening `sp console` now lands on an ALL view (`0` to return from any tab) showing active jobs across all configured repos sorted by activity, with per-repo section headers. `↑↓`/`j/k` moves a cursor through individual job rows; `↵` opens the selected job's feed, `r`/`i`/`b`/`d`/`g`/`R`/`x` work as in `ps` — automatically switching to the job's repo before opening the view. The stats bar always shows full ps-style metrics (health / rss / cpu / orphans) for the current repo on all tabs including ALL.
- **`x` — stop job keybinding in `ps` and `all` views.** Pressing `x` on any selected or cursor job sends SIGTERM via `stopJob` in `control.ts`, using the job's own repo `jobsDir`. A brief confirmation message (`sent SIGTERM to <job-id>`) appears in the status bar. Works in both `ps` (selected row) and `all` (cursor row, cross-repo).
- **Multi-repo auto-discovery and `console.json` persistence (PRs #141, #143).** `sp console` auto-discovers sibling repos up to depth 2 (worktree-safe: skips `.git/` trees and the `specialists` package itself) on first launch and persists the list to `~/.config/specialists/console.json`. Subsequent launches reload the saved list for instant startup. `--add-repo <path>` and `--remove-repo <name>` CLI flags manage the list without opening the TUI.
- **`RepoConfigView` — interactive repo registry management inside the console (PR #142).** `R` from `ps` opens an in-TUI editor for `console.json`: `+` add a repo (path → name two-step), `d` remove, `e` edit path, `n` edit name, `r` rescan (depth-2 inline), `s` toggle inactive rows. All mutations share the same `RuntimeClient` persistence surface as the CLI flags.
- **DiffView SHA fallback for dead-worktree jobs (`unitAI-ctb4u.29`, PR #135).** When a job's worktree has been removed, DiffView falls back to the recorded `git_commit_sha` from `supervisor_status`. The section title changes to `diff summary · @<sha7> (commit)` so operators know they are viewing a historical snapshot rather than a live worktree diff.
- **`sp ps` gets TUI-themed rows and stats line (`unitAI-ugw4s`, PR #144).** The `sp ps` shell command now renders job rows using the same 24-bit ANSI palette, status glyphs, and column-adaptive layout as `sp console`. The stats line (`jobs N/M · running N waiting N · …`) is appended below the table in dim text. Non-TTY output falls back to plain text as before.
- **Snapshot-diff engine ported from gitboard (`unitAI-ctb4u.19`, PR #137).** `src/specialist/snapshot-diff.ts` provides stable SHA-256 hashing of job snapshots (`snapshotHash`) and upsert/tombstone delta computation (`snapshotDiff`). The console poll loop uses the hash to skip no-op dispatches and the delta to expire paint-cache entries for tombstoned jobs only, avoiding full-cache invalidation on every tick.
- **Interactive `waiting_auto_close_ms` global override (`unitAI-pj2mm`, PR #152).** `waiting_auto_close_ms` is now settable via the global `~/.config/specialists/user.json` overlay without editing each package specialist JSON. `sp console`'s ConfigView (`g`) displays the effective default next to `inherit` (e.g. `inherit (120000)`) when no override is active. All 24 package specialist JSONs had their stale `null` placeholder removed (`null` triggered a schema validation error at dispatch; field is `number | undefined`).
- **`quant-methodologist` and `quant-researcher` specialists (NEW, package tier).** Two new quant-focused READ_ONLY specialists ship at `config/specialists/` (v1.0.0). `quant-methodologist` audits and designs quantitative analytics methodology/pipelines for market-data systems — formulas, units, conventions, numerical probes, model assumptions, and creative-but-conservative pipeline proposals (`thinking_level: high`, LOW read/probe, no implementation edits). `quant-researcher` gathers source-backed evidence for mathematical finance, market microstructure, econometrics, exchange/product conventions, academic papers, package semantics, DeepWiki repo scans, and GitHub implementation snippets (LOW research, no local code edits). Both ship with `model = null` / `fallback_model = null` resolved via the KAN-90 global config layer (commit `78e0b53b`).
- **KAN-91 expanded global overrides.** Phase 0 adds the nested execution and prompt override machinery that keeps loader allowlists and `user.json` schema in sync.
- **KAN-91 user-environment overrides.** Phase 1 allowlists `prompt.system_prompt_mode`, per-specialist Serena/GitNexus extension opt-outs, `notes_mode`, `output_file`, and prompt/stdout byte limits in the global `user.json` layer.
- **KAN-91 fallback model chains.** Phase 2 adds `execution.fallback_models` arrays, keeps legacy `fallback_model`, and walks fallback chains only on transient provider failures.
- **KAN-91 preset references.** Phase 3 adds `@preset/<name>` model and fallback references with package preset lookup, depth/cycle guards, telemetry, and type validation.
- **KAN-91 global override upgrade notes.** `sp init --global` now writes a `_doc` sentinel in strict JSON and points users to `docs/upgrade-notes/kan-91-expanded-overrides.md` for field semantics.
- **Console-safe AgentOps operations surfaces.** `sp serve` now exposes read-only per-job normalized forensic streams at `GET /jobs/:job_id/feed-events` and `/api/specialists/jobs/:job_id/feed-events`; Prometheus projection adds bounded `xtrm_chains_total` / `xtrm_chain_duration_seconds`, projects gate verdict and evidence-ref counters, forbids raw diff labels, keeps chain/job/file/diff drill-down in forensic events, and documents the console-facing telemetry contract updates (`unitAI-5ljfu`).
- **AgentOps correlation and MCP telemetry pre-wiring.** Forensic events now carry optional `session_id`, `conversation_id`, `trace_id`, `span_id`, and `parent_span_id` correlation fields through Pi session metadata, supervisor status, SQLite forensic writes, and `sp feed`/`sp log` JSON surfaces. MCP timeline events normalize to canonical `mcp.*` names, preserve MCP/JSON-RPC/trace identifiers as correlation/body data only, and project bounded `xtrm_mcp_operations_total` metrics without implying a live MCP emitter (`unitAI-eoqxp.3.1`, `unitAI-eoqxp.3.2`).
- **Telemetry contract validation and token-first cost semantics.** Forbidden Prometheus labels now include session/conversation/MCP/JSON-RPC/eval/policy/identity correlation IDs, AgentOps catalog fixtures cover job/MCP/identity/policy/eval/service-skills/pulse/token provenance examples, and the telemetry docs explicitly keep USD cost out of runtime metrics until billing/pricing provenance exists (`unitAI-eoqxp.3.5`, `unitAI-v1fzu`).
- **AgentOps forensic telemetry bridge — `xtrm.forensic.v1` runtime envelopes, persistence, and query surface.** Specialist runtime events now dual-write canonical forensic envelopes into `specialist_forensic_events`, with deterministic redaction before persistence/output and additive `forensic_event` payloads on `sp feed --json` / `sp log --json` while preserving legacy fields. New `sp forensic <job-id> --json` emits persisted NDJSON evidence for a job; real-job smoke `ddc421` validated 68 events across `job`, `model`, `turn`, `tool`, and `git` families (`unitAI-60w93.2`, `.3`, `.4`, `.8`, `.9`, `.10`, `.14`, `unitAI-z2s17`).
- **AgentOps Prometheus projection — `sp metrics --prometheus` plus `sp serve` `GET /metrics`.** Specialists now exports low-cardinality Prometheus/OpenMetrics text for job state, job totals, duration/wait histograms, turns, context usage, tool calls, LLM tokens, queue depth, process/worktree gauges, and projection timestamp. The projection is table-derived/replay-safe for current state, validates text syntax in CI, and keeps high-cardinality IDs (`job_id`, `chain_id`, `participant_id`) out of labels (`unitAI-60w93.5`, `.6`, `.7`, `.11`, `.12`, `.13`).
- **AgentOps telemetry readiness smoke for gitboard handoff (`unitAI-ub65d.4`, PR #114).** Closes the `unitAI-ub65d` epic by validating the shipped telemetry meets the gitboard materializer handoff contract: forensic stream carries normalized `xtrm.forensic.v1` rows with `body` + `redaction`, job metrics carry turns/tools/model + token split + `usage_source`, evidence includes verdict/result and diff/commit refs where present, and `sp metrics --prometheus` stays bounded.
- **`sp setup` CLI verb + benchmark data module (Epic `unitAI-t86wh`, PRs #119, #120).** New top-level `sp setup` verb composes `sp init --global` / `sp edit --global` / `sp doctor --specialists` into a benchmark-driven model-assignment workflow: `--discovery [--json]`, `--fetch-benchmarks [--json]`, `--plan <budget-preset>`, `--apply`, and `--probe-only`. Backed by `src/specialist/benchmarks.ts` (PR #119) — a pinned SSOT snapshot from `artificialanalysis.ai` (primary) + `lmarena.ai` (secondary) plus an agentic-followthrough probe suite that catches model failure modes public leaderboards miss.
- **`sp list` / `specialists list` — per-specialist version badge, package-version header, and new-release alert.** Each row now renders the spec's own `metadata.version` as a `[vX.Y.Z]` badge after the name (e.g. `seconder [v1.0.0]`); the header line shows the running package version (`Specialists (N)  specialists v<pkg>`); and when the existing version-check finds a newer published tag, `sp list` prints `new version <v> available, run npm i -g @jaggerxtrm/specialists@<v>`. Rows are sorted alphabetically by name (human output and `--json`, ordering-only — `--json` stays a top-level array, backward-compatible). Reuses `getVersionCheckResult()` (TTY-gated, 6h cache, 2s timeout, silent on failure) via a new `formatListVersionAlert()` — no new network/cache path (`unitAI-k5vx7`).

### Changed
- **Per-repo `SourceQueue` for poll isolation (`unitAI-ctb4u.20`, PR #138).** Each repo now gets its own `SourceQueue` (1 500ms coalesce) instead of a shared `setInterval`. Tab-switching cancels the prior repo's pending dispatch immediately; no stale poll from the previous repo can race the destination repo's first render.
- **Per-row paint cache in `ProcessView` (`unitAI-ctb4u.21`, PR #139).** Rendered job-row strings are cached by composite key `jobId|status|ctxBucket|width|depth|selected|datePrefix`. A poll tick with unchanged rows skips all `renderJobRow` calls. Cache is bounded to `totalJobs × 2` and is cleared on repo switch and tombstone delivery, preventing cross-repo bleed and unbounded growth in long sessions.
- **Dependency-bump CI policy adoption (`unitAI-c7zdy`, PR #154).** OSV PR scans are now advisory by default but fail on SECURITY_FORCED findings, while push/schedule scans remain hard gates. `package-payload` separates install/build/pack/assert steps so harness failures no longer masquerade as payload-contract failures. Added a dry-run-first dependency verdict materializer for advisor/followup/gate substrate artifacts.
- **Specialist model selection moves to a per-user global config (KAN-90 / `unitAI-1gtou`).** Every `config/specialists/*.specialist.json` now ships with `execution.model = null` and `execution.fallback_model = null`. The `SpecialistLoader` resolves each specialist via a 3-layer field-merge (`package canonical → ~/.config/specialists/user.json → .specialists/user`); the legacy `.specialists/default/` mirror was retired (commit `31a6421c`) and stale entries are pruned by `drift-detector` / `sp prune-stale-defaults`. New CLI surface: `sp init --global`, `sp edit --global`, `sp doctor --specialists`. Missing models after merge raise `SpecialistMissingModelError` at dispatch with a pointer to `sp edit --global`. Blocked fields (`execution.permission_required`, `mandatory_rules`, `capabilities`, `output_schema`, `auto_commit`, `prompt.system`, `skills.scripts`) are stripped from the global layer and surfaced via `sp doctor --specialists`. Upgrade guide: `docs/upgrade-notes/kan-90-global-user-config.md`. (Commits `5f8d725e`, `6604c144`, `6b69a6fe`, plus this commit.)
- **`setup-specialists` skill v1.0 → v2.0 + `specialists-creator` skill v1.3 → v1.4 — KAN-90/91 global-config workflow (`unitAI-vme0p`).** `setup-specialists` is fully rewritten (162 → 261 LOC) to teach the 3-layer field merge, the `sp init --global` / `sp edit --global` / `sp doctor --specialists` workflow, the `OVERRIDE_ALLOWED_*` allowlist (model + fallback chains + thinking_level + byte limits + extension opt-out + `notes_mode` + `output_file` + `system_prompt_mode`), `@preset/<cheap|medium|power>` references, and operator pitfalls (positional-form vim fallthrough, `thinking_level: off` breaking thinking-class models, repo-override shadowing global). The previous v1.0 literally claimed "There is no supported global override layer yet" — false since KAN-90 shipped on 2026-06-13. `specialists-creator` gains an additive `## Global User Override Layer (KAN-90/91)` section (+118 LOC) that mirrors the per-spec field reference to the global-layer dot-path syntax, so authors of a new specialist can document the same fields once and have them work in both layers. Operators landing in a fresh `@jaggerxtrm/specialists` install via `/setup-specialists` or `/specialists-creator` now read the current truth instead of the stale claim.
- **`setup-specialists` skill v3.0 interactive playbook — phase contracts + interactive checkpoints (`unitAI-hdrr6`, PR #121).** Rewrites `setup-specialists` into a directed 5-phase flow: `sp setup --discovery`, `sp setup --fetch-benchmarks --json`, five explicit `AskUserQuestion` checkpoints (budget/provider/auth/privacy/probe shape), deterministic `sp setup --plan` output/table proposal review, and `sp setup --apply` verification with optional `sp setup --probe-only` flow. Adds strict parse contracts for `pi --list-models`, `sp doctor --specialists`, `sp list --full`, and benchmark JSON so multiple orchestrators can produce identical state and proposals.
- **`sp script` trusted-mode hardening + script-specialist observability (`unitAI-4zask`/`unitAI-mally`/`unitAI-q5t29`, PR #145).** Finishes the `service-skills-sync` script-specialist refit: strict JSON machine-output handling with prose + fenced-JSON recovery for the final wrapper path, live script-specialist observability rows/events surfaced in `sp ps` / `sp feed`, and hardened trusted script mode so dangerous local-script / write-capable execution is explicit rather than implicit.
- **`service-skills-sync` specialist v1.4.0 — mandatory Phase 2.5 diff content scan for non-symbol drift.** Adds a `git diff <last_sync_ref>..HEAD` scan step between Serena cross-check and classify, grepping for renamed env vars, new/removed exception sites, error log strings, docker container/image renames, and new API endpoints (6 patterns). The `audited-and-unchanged` verdict now requires a clean diff scan in addition to a gitnexus cosmetic signal. Missing `last_sync_ref` emits a new `⚠ Triage-incomplete` verdict rather than silently passing. New `service-skills-diff-scan-mandatory` mandatory rule enforces the contract. Motivated by `py_backend-0ondo` (darth-feedor) where string-literal-only drift was mislabeled as semantic-unchanged (`unitAI-ekt17`).
- **`test-runner` specialist — `task_template` aligns with exact-command-wins scope semantics.** Pinned exact commands from the orchestrator/test-engineer now explicitly win over manifest-detected fallback (fallback is clearly labelled as evidence, never a scope override) (`v2.0.0 → v2.0.1`, PR #102).

### Fixed
- **pi-coding-agent ownership/package references corrected (`unitAI-fgpxv`).** README, bootstrap/service docs, and `sp init` optional prerequisite hints now point to `earendil-works` (`https://github.com/earendil-works/pi-coding-agent`, `@earendil-works/pi-coding-agent`) instead of stale xtrm/Jaggerxtrm or mariozechner references.
- **Defensive render against malformed `status_json` rows (`unitAI-ctb4u.27`, PR #126).** Per-row `try/catch` in `renderProcessRows` prevents a single corrupt `status_json` entry from crashing the entire ProcessView paint loop; malformed rows render as `?? <malformed row dropped>` without disrupting adjacent rows.
- **Generic `↑↓` keys gated to `ps`/scroll views only (`unitAI-ctb4u.30`, PR #127).** The generic `move` reducer action was consuming arrow keys even in `config` and `diff` views, which have their own cursor handlers. The gate prevents it from swallowing keys before view-specific handlers can win.
- **`ConfigView` hint text enriched with operational guidance (`unitAI-ctb4u.31`, PR #128).** Each editable field's `allowedHint` now includes concrete examples and constraint descriptions so operators understand valid values without leaving the TUI.
- **Scroll and `selectedRow` reset on back-from-detail (`unitAI-kz1ud`, PR #129).** Navigating back from feed/result/inspect/bead/diff to `ps` previously retained the scroll position from the detail view, leaving the cursor off-screen. The `back` action now resets both `scroll` and `selectedRow` to 0.
- **Forensic feed `TYPE_W` column widened to 32 (`unitAI-3wm6x`, PR #130).** The type column in feed-event rows was truncated to 16 characters, cutting off longer forensic event type names such as `xtrm.forensic.v1.*`.
- **`stderr` writes consolidated through `log.ts` single-sink (`unitAI-21sn4`, PR #131).** Four separate `process.stderr.write` call-sites in `runtime.ts` bypassed the structured `logError` sink, preventing log-level filtering and test interception.
- **`sp console --help` updated to v2 keybindings with parity guard (`unitAI-ctb4u.23`, PR #132).** The help text now matches the live keymap; a compile-time parity check ensures the help string and `handleInput` handlers cannot silently diverge.
- **Global-config writes use atomic `tmp + rename` (`unitAI-ctb4u.17`, PR #133).** Direct overwrite of `user.json` was susceptible to torn reads on interrupted writes. Writes now go to `user.json.tmp` followed by `fs.renameSync` — atomic on POSIX.
- **`ps` default `historyMode` aligned with `sp ps` shell default (`unitAI-ctb4u.26`, PR #134).** `sp console` opened in `history` mode (all jobs) while `sp ps` defaulted to `default` (running + recent only). Both now default to `default`; `h` in the console cycles through modes as before.
- **`supervisor.dispose()` now reaps the pi/Serena session (`unitAI-pjst5`, PR #150).** `dispose()` previously closed sqlite/tmux/FIFO only and never explicitly stopped the Serena extension subprocess attached via `script-runner.ts:977-979`. After worktree removal, Serena LSPs survived indefinitely and could accumulate across long-running sessions until the host exhausted memory. The supervisor finalizer now reaps the extension subprocess group explicitly. Complementary to upstream `@jaggerxtrm/pi-extensions` PR #306 (KAN-110-A `resolveSessionCwd` — eliminates the duplicate-daemon race that was the other source of orphans); together the two close the orphaned-Serena class.
- **`observability.db` no longer leaves a zero-byte placeholder when bootstrap fails (`unitAI-nuh7l`, PR #151).** Previous behavior: when `sqlite_open` failed during runtime startup the path was left as a 0-byte file with the open error silently swallowed; subsequent invocations short-circuited on the empty file and never re-tried bootstrap, blocking forensic event capture for the affected jobs. Open failures are now surfaced explicitly so the orchestrator/operator can diagnose, and the bootstrap path no longer creates the placeholder.
- **`sp edit --global <name.field> <value>` now applies the value instead of falling through to vim (`unitAI-61h1b`, PR #123).** `parseArgs` no longer consumes the first positional as the specialist name when `--global` is active, so the documented positional form works without `--set`. In addition, bare `sp edit --global` (no path) now fails fast with a script-friendly hint (`specialists edit --global --set <name>.<field.path> <value>`) when stdin is not a TTY — prior behavior was to spawn `$EDITOR` and hang indefinitely in non-TTY contexts (scripts, hooks).
- **`sp script` JSON recovery from streamed assistant text (PR #146).** When `PiAgentSession.getLastOutput()` leaked raw tool-call markup (`<|tool_calls_section_begin|> …`), trusted local `sp script` runs (e.g. `service-skills-sync`) failed with `invalid_json`. The final-wrapper recovery path now prefers the last completed streamed assistant message as a cleaner source before falling back to the one-turn JSON repair flow. Adds a focused regression test for the real failure mode and rebuilds dist.
- **Live smoke harness architectural improvements (`unitAI-o5rwj`, PR #124).** New `tests/integration/cli/live-smoke.helpers.ts` (`createLiveSmokeHome` scopes specialist overrides via `XDG_CONFIG_HOME` while preserving real `HOME` so `~/.pi` credentials resolve; `snapshotJobIds` + `waitForNewJobId` provide filesystem-based job-id discovery when stdout is empty) and a `.beads` symlink so `sp run` dispatched from a temp repo can resolve beads created in the repo root. Improves test isolation and unblocks KAN-91 live smoke.

### Security
- **`esbuild` pinned to `^0.28.1` to clear GHSA-gv7w-rqvm-qjhr (`unitAI-mtghu`, PR #118).** Clears the CVSS 8.1 High advisory (GHSA-gv7w-rqvm-qjhr) and the CVSS 2.5 Low advisory (GHSA-g7r4-m6w7-qqqr) on esbuild ≤ 0.28.0, which were failing OSV scan on every PR. esbuild is transitive (via `tsx@4.22.3` and `vite`); a single `package.json` override resolves both ranges.
- **`hono` bumped to 4.12.26 and `vite` pinned to 8.0.16 (devDependency) for OSV cleanup (PR #149).** Clears residual OSV findings; `vite` is moved back to `devDependencies` after a `bun update` had promoted it into runtime deps, and `bun.lock` regenerated.

## [v3.17.0] — 2026-05-31

### Added
- **`seconder` specialist (NEW, package tier).** The fused post-writer gate from canon `docs/design/chain-templates.md` §2.3 — collapses the old split between scope/compliance (reviewer phase-1) and code-quality smell (`code-sanity`) into one READ_ONLY dispatch (`openai-codex/gpt-5.4-mini`) emitting a structured dual-verdict JSON: `scope_verdict` + `scope_findings` + `quality_verdict` + `quality_findings` + `overall_verdict`. The chain reducer reads `overall_verdict` to advance or route back to the writer; the reviewer reads the dimension-tagged findings. Replaces `code-sanity`, which is **removed** this release (see Removed) (`unitAI-4e194`, `unitAI-wz2ag`, `unitAI-321ir`).
- **`test-engineer` specialist (NEW, package tier).** Post-implementation behavioral-test author from the actual diff (canon §2.5). MEDIUM, `openai-codex/gpt-5.5`, `requires_worktree`. Produces tests + fixtures + smoke/E2E harnesses + telemetry assertions and emits exact `test-runner` commands via a structured schema (`status`, `files_changed`, `coverage_map`, `smoke_e2e_commands`, `telemetry_assertions`, `test_runner_commands`, `known_deferred_paths`, `source_bug_suspicions`). Ambidextrous role (§3.16): the same spec is the **primary writer** in `test-only` chains and the **secondary writer** in `code-with-tests` chains — the system prompt is mode-agnostic and the position arrives via the dispatch-time mandate. Forbidden from patching production source by default (`unitAI-sfwe1`, `unitAI-sfwe1.1`).
- **Two NEW chain-template formulas — `code-with-tests` (§3.14) and `test-only` (§3.15).** `code-with-tests`: dual-writer production chain (`executor` writes the diff, `test-engineer` writes tests against it) at high/critical scrutiny. `test-only`: single-writer chain when scope is test-paths only (`test-engineer` as primary writer). Both carry the ambidextrous `test-engineer` mandate in the step `description` (pre-substrate position-injection mechanism, §3.16) (`unitAI-f9kku`).
- **Seconder dual-verdict eval + QA-routing eval.** `.specialists/evals/seconder/` — a reproducible static eval with three fixtures (wrong-scope → `scope_verdict` FAIL, bad-quality → `quality_verdict` FAIL, clean → `overall_verdict` PASS) each carrying an `expected-verdict.json`, plus an operator-run `run.sh` and a token-cost note (`unitAI-o7j1a`). `config/skills/using-specialists-v3/evals/` gained four QA-routing eval cases (test-engineer primary vs secondary writer, test-runner owner-routing, reviewer-consumes-QA-evidence) + a passing vitest harness (`unitAI-sfwe1.5`).
- **`transcriber` specialist (NEW, package tier).** Promotes the documentation-grade YouTube transcriber prompt to the shipped package catalog at `config/specialists/transcriber.specialist.json`. v1.6.0 uses `openai-codex/gpt-5.3-codex`, title-derived transcript/analysis filenames, narrow subtitle language extraction to avoid YouTube 429 fanout, immediate section-by-section writes, dense technical `DETAILED SECTION ANALYSIS`, `TECHNICAL EXTRACTION TABLES`, and a coverage/quality audit to prevent shallow “2-line per 5 minutes” outputs (`unitAI-jfw26`).
- **`sp log` runtime/provenance stream** — new operator-facing log command for specialist runtime debugging. It reads `observability.db`, shows dispatch/control/status/error/auto-commit provenance separate from `sp feed`, supports `--json` NDJSON for full payloads, `--follow`, `--since`, `--limit`, job/bead/specialist/node filters, and `--all-events` for raw feed-like internals (`unitAI-gqpvw`, `unitAI-vfqgq`).
- **`sp log` parent-directory/global mode** — when run outside a repo root with no local specialists DB, `sp log` discovers immediate child repos containing `.specialists/db/observability.db` and aggregates their runtime rows as one global log; `--repo <name>` narrows output to a single child repo (`unitAI-v5xfu`).
- **`obligations-scanner` specialist** (NEW) — READ_ONLY, cheap (`openai-codex/gpt-5.4-mini`, `bare: true`, ~30s target) pre-review marker scan. Scans executor/debugger diffs for newly-introduced `TODO`/`FIXME`/`HACK`/`XXX`/`TEMP`/`WIP`/`NOTE(release)` markers in production code. Distinguishes production vs test/fixture surfaces. Recognizes structured `// TODO(<bead-id>): reason` format and treats it as TRACKED when the linked bead is open. Verdict: `CLEAN | OBLIGATIONS_FOUND | BLOCKED` with a JSON `output_schema` the reviewer consumes directly. Iron-style obligations tracking (`unitAI-kglvm.3`).
- **`docs/design/iron-review-hardening.html`** — design doc visualizing the new pipeline (SCRUTINY taxonomy, old-vs-new chain flow, per-specialist changes, git-state precondition, manual execution plan). Mirrored to `~/second-mind/1-projects/Mercury/` for sync (`unitAI-fpwbr`, `unitAI-1n56e`, `unitAI-ejdi1`).
- **`service-skills-sync` specialist (NEW, package tier).** Promotes the Service Skills Librarian (previously a market-data user-tier override) to a shipped package specialist at `config/specialists/service-skills-sync.specialist.json`. MEDIUM, `openai-codex/gpt-5.4-mini`; keeps per-service expert-persona `SKILL.md` docs in sync with code drift using gitnexus (`detect_changes`/`impact`/`context`) + Serena, gated by a `drift_detector.py` pre-scan. The per-service knowledge layer the future devops agent reads (DevOps PRD §7.1) (`unitAI-g8zr3`).
- **`researcher` specialist v1.2.0 → v1.3.0 — general-web pipeline (Mode 4).** Adds a fourth research mode closing the web-research gap (previously the researcher reached library docs/repos/code/social but had no general web search or arbitrary-URL read): `ddgs` (DuckDuckGo search CLI, no API key — `uv tool install ddgs`) discovers authoritative URLs, then `agent-browser` (native Rust CLI + Chrome daemon — `npm i -g agent-browser`) reads any URL including JS-rendered pages. Documented in `prompt.system` Mode 4 + `config/mandatory-rules/research-tool-routing.md`. `capabilities.external_commands` deliberately left empty — it is a hard pre-run gate (`runner.ts validateBeforeRun` throws on a missing PATH binary), so declaring these heavy tools would break the shipped researcher in projects without them; documented as available-on-demand with install hints instead (`unitAI-qgvld`).
- **`notes_mode` specialist field + markdown-native 3-state handoff.** New top-level `notes_mode` enum (`full-trail` default | `final-only`) controls how each turn's handoff is persisted to BOTH the input bead notes and `output_file`. The supervisor renders a markdown-native 3-state handoff — `### <specialist> · <model> · [turn N · WAITING]` trail blocks plus a canonical `## <specialist> · <model> · [FINAL · DONE]` block — with the specialist's output verbatim, a single italic metadata footer (empty/zero/unknown fields omitted), and a provider-prefix-stripped model string; no divider rules or emoji. One shared content source feeds bead notes, `output_file`, and `sp result`. `final-only` persists only the canonical FINAL block and overwrites `output_file`, for non-coding/chained pipelines where the next specialist reads the previous one's note or file as input (`unitAI-10y07`, `unitAI-yiazs`).

### Changed
- **`test-runner` specialist — upgraded to the QA failure-routing contract (canon §2.5).** Now prefers exact commands from `test-engineer`/orchestrator and falls back to manifest-detected runners only when none are supplied (clearly labeled as fallback). Classifies every failure by owner — `test_engineer` (test/fixture/harness wrong, or new untested feature), `debugger_or_executor` (missing telemetry / source behavior regression), `infrastructure`, `pre_existing` — and never writes tests or patches source (LOW). Backed by `config/mandatory-rules/test-runner-execution-scope.md` (`unitAI-sfwe1.2`).
- **`reviewer` specialist — refactored to phase-2-only (seconder fusion, canon §2.3).** The phase-1 compliance/scope check now lives in `seconder`'s `scope_verdict`; the reviewer keeps only phase-2 (adversarial deep code-quality audit + machine-readable Release Checklist + ddiff re-review on PARTIAL) and treats a `seconder` PASS as the upstream scope gate. Two-phase framing removed from the prompt (`unitAI-4e194`, `unitAI-sowpa`).
- **13 chain-template formulas rewired for the canonical QA pipeline.** Every production-diff template (`code-standard`, `code-with-advisors`, `debug`, `security-deep`, `restitch`) now wires `writer → seconder → test-engineer → test-runner → [security-auditor if sensitive] → obligations-scanner → reviewer` (canon §2.1) — `code-sanity` renamed to `seconder`, `test-engineer` + `test-runner` inserted. README overlay table + roadmap Opp 14/15 status updated (`unitAI-f9kku`).
- **`using-specialists-v3` skill — canonical seconder-fusion pipeline.** SKILL.md now teaches `writer → seconder → test-engineer → test-runner → [security] → obligations → reviewer`, the QA failure-routing matrix (§2.5), and SCRUTINY reframed as a **chain property that modulates structure, not quality** (§2.2) — including the `none` tier for read-only chains and the required-at-creation rule. `seconder` replaces the `code-sanity` seconder slot; reviewer documented as phase-2-only (`unitAI-096re`, folds `unitAI-sfwe1.3`).
- **`sp log` human output is leaner and calmer.** Default output now hides agent-internal turn/tool/text/thinking/token rows already covered by `sp feed`, keeps runtime-owned rows only, collapses repo/path/branch/worktree metadata into one compact `worktree=<repo>/<worktree>` field, uses a restrained professional color palette (dim metadata, plain job ids, bold specialist names, color-coded `status=<state>`, green/yellow/red/cyan only for semantic state), and collapses adjacent duplicate display rows caused by duplicated runtime events while preserving full payloads in `--json` (`unitAI-vfqgq`, `unitAI-npjlq`, `unitAI-f5k0p`).
- **`reviewer` specialist — Iron-inspired prompt overhaul.** Five new system-prompt sections, additions only (existing source-of-truth priority and AUTHORITATIVE REVIEW CONTEXT preserved verbatim) (`unitAI-kglvm.1`):
  - **SCRUTINY tier behavior** (`low | medium | high | critical`) — reads field from bead contract; defaults to `medium`; tiers reviewer depth from seconder-only spot-check (low) through file-by-file sign-off with mandatory `gitnexus_impact` (high) to required second-opinion (critical).
  - **Scrutiny auto-escalation** — surface-pattern floor table raises level regardless of bead's stated SCRUTINY when diff touches `auth/*`, `**/credentials*`, `**/token*` (→ high), `config/specialists/*.json` (→ high), `src/specialist/{runner,schema}.ts` (→ high), `**/*.lock` (→ medium + security-auditor required), `migrations/**` (→ high), `src/permissions/*` / `hooks/**` (→ critical). Author's level is a floor, not a ceiling.
  - **Re-review after PARTIAL (Ddiff mode)** — when re-reviewing a fixed PARTIAL, scope to delta since prior verdict, carry forward prior approvals, audit only newly-touched files/symbols.
  - **Obligations scan** — consumes `obligations-scanner` JSON output if present, else scans diff inline; production markers → PARTIAL unless accepted via bead `NON_GOALS` or structured `// TODO(<bead-id>):` reference; test/fixture markers noted but not blocking.
  - **Release Checklist** (REQUIRED) — machine-readable block appended to every verdict for future `sp merge` enforcement.
- **`executor` and `debugger` specialists — Obligations discipline.** New system-prompt section instructs both codegen specialists to avoid introducing in-code obligation markers in production paths by default; if work is genuinely deferred, file a follow-up bead via `bd create --deps discovered-from:<current>`; if a marker is truly needed at a code site, use structured form `// TODO(<follow-up-bead-id>): <reason>` where the linked bead is open and listed in current bead's `NON_GOALS`. Prevents PARTIAL fix-loops from the new obligations-scanner gate. Test/fixture paths exempt (`unitAI-kglvm.4`).
- **`using-specialists-v3` skill: v3.4 → v3.5 (Iron-style orchestration).** Substantial restructure aligned with the above specialist changes (`unitAI-kglvm.5`):
  - "Advisory Passes" section reframed as three mandatory gates: **Seconder Gate** (`code-sanity`), **Security Gate** (`security-auditor` on sensitive surfaces), **Obligations Gate** (`obligations-scanner`). Skip rules tightened.
  - NEW **SCRUTINY taxonomy** section: tier behavior + auto-escalation surface table. SCRUTINY field added to task/epic, executor, reviewer bead contract templates.
  - NEW **Git State Precondition** section: four-check pre-flight (working tree clean, HEAD contains prior chain commits, no orphaned worktrees, in-sync integration branch) required before dispatching any chain that depends on prior chain output. Strictness-by-scenario table.
  - **Rule #9 INVERTED**: manual git workflow is now canonical; `sp merge` and `sp epic merge` are PROHIBITED (known broken, awaiting separate rework epic). Cherry-Pick Playbook promoted to canonical multi-chain merge path. `sp finalize` removed from documented orchestrator workflow.
  - **Rule #13 exception clause** added for epics that restructure the specialists themselves (operator-authorized manual-orchestrator-direct work).
  - **Rule #14 NEW**: Git State Precondition reference.
  - `obligations-scanner` row added to Choosing The Specialist table. `parallel-review` marked deprecated.
  - Escalation Matrix and Failure Recovery tables rewritten: sp-merge rows replaced with git-workflow recovery patterns (stale `.git/index.lock`, `info/exclude` vs tracked beads file, FF-via-`git update-ref` when checkout blocked).
- **CLAUDE.md "Common gotchas" section rewritten** to match the new canonical: manual merge, explicit `sp stop` for keep-alive cleanup, Iron-style gates mandatory, Git State Precondition, bd auto-export churn handling, package-tier specialist edits via direct JSON.
- **`bd` auto-export pain fix.** `bd config set export.git-add false` disables per-write auto-staging of `.beads/issues.jsonl` (silent mid-work; no checkout aborts; no `.git/index.lock` races). Paired with a custom block added to `.git/hooks/pre-commit` AFTER bd's managed markers — runs `git add -f .beads/issues.jsonl` so commits naturally include the fresh JSONL snapshot via the existing pre-commit hook chain. Eliminates the runaway `chore(beads): export state` commits that plagued every multi-bd-op session. Verified end-to-end in this repo (commits `63ac83f6`, `4c1f19a5`, `1e014f33`) (`unitAI-mg18o`).
- **`output_file` decoupled from `SPECIALISTS_JOB_FILE_OUTPUT`.** A specialist that sets `output_file` now always writes its full result — foreground and `--background` (tmux) — independent of the env flag, which now only gates the debug file-mirrors (`events.jsonl` / `status.json` / `result.txt`). Previously `--background` (tmux) runs silently dropped `output_file` because the env var did not propagate into the tmux session. The single-writer invariant is preserved (the supervisor owns the file in supervised runs; `suppressRunnerFileOutput` still skips the runner write), and `.specialists/*-result.md` was added to `.gitignore` since specs with `output_file` now always write. `output_file`, `notes_mode`, and the handoff envelope are documented in `docs/authoring.md` and the `specialists-creator` skill (`unitAI-f58ma`, `unitAI-g8rqg`).

### Removed
- **`code-sanity` specialist removed — superseded by `seconder`.** The Iron seconder gate (briefly promoted as `code-sanity` mid-cycle, `unitAI-kglvm.2`) is replaced by the new `seconder` specialist, which fuses its code-quality smell pass with the reviewer's old phase-1 scope check into one dual-verdict gate (canon §2.3). `config/specialists/code-sanity.specialist.json` deleted; all operational references across the v3/auto/v2 skills, `reviewer.specialist.json`, chain-template formula prose, and `docs/specialists-catalog.md` renamed to `seconder`. Two historical lineage notes preserved (`seconder.specialist.json`'s absorbed-mandate section + the v3 SKILL §2.3 fusion explanation) (`unitAI-321ir`, `unitAI-4e194`).
- `sp merge` / `sp epic merge` / `sp finalize` removed from documented orchestrator workflow in `using-specialists-v3`. Commands still exist in the `sp` binary (no source-code removal) but the skill explicitly prohibits their use pending a separate rework epic. Operators reaching for them should use the documented manual git workflow instead.

### Changed (prior)
- All 17 package-shipped specialists in `config/specialists/` now declare the v3.16.0 schema additions explicitly: `execution.bare: false` and `prompt.system_prompt_mode: "append"`. Values match the previous absent-field defaults — pure-mechanical, zero behavior change — but every shipped spec is now self-documenting at the schema level instead of relying on per-runner legacy fallbacks. `bare.specialist.json` retains its explicit `bare: true` + `replace` (`unitAI-51r2w`).

### Fixed
- **`seconder --job` now receives the writer diff.** Reused worktree dispatches populate the existing `$writer_diff` template variable from the same bounded branch/staged/unstaged diff source used by reviewer diff injection, so seconder can make concrete scope/quality verdicts without orchestrator-pasted evidence (`unitAI-bycl3`).
- `sp stop` / `sp resume` control-plane actions now treat observability writes as best-effort: status/control telemetry failures no longer prevent SIGTERM delivery or falsely report a delivered resume as a steer-pipe write failure (`unitAI-dkhi3`).
- OSV scan now resolves `GHSA-q8mj-m7cp-5q26` by overriding all `qs` lockfile entries to `6.15.2`; `bun.lock` no longer contains vulnerable `qs@6.15.1` entries (`unitAI-dkhi3`).
- Supervisor status reads now reconcile dead `starting`/`running` specialist jobs to terminal `error` with a `run_complete(ERROR)` event, so reviewer crashes during heavy bash validation no longer leave `sp ps`/`sp result` stuck on stale `running` rows (`unitAI-6x6p6`, `unitAI-uzyut`).
- **Per-turn handoff notes now append instead of replace.** `appendBeadNote` called `bd update --notes` (whole-field replace), so each per-turn specialist handoff clobbered the previous one — multi-turn jobs left only the last (often empty) note on the bead, recoverable only from `observability.db`. Switched to `bd update --append-notes` and exported `formatBeadNotes`. (The appended handoff format was subsequently finalized to the markdown-native 3-state form — see the `notes_mode` entry under Added.) Tests in `bead-notes.test.ts` + new `supervisor-bead-notes.test.ts` (sibling, since `supervisor.test.ts` is excluded from the default run) (`unitAI-sx5qk`).
- **`[FINAL · DONE]` handoff block now emitted on `sp stop` for keep-alive jobs.** The canonical FINAL block was silently skipped on the dominant keep-alive→`sp stop` path because `src/specialist/control.ts` constructed the `Supervisor` without a `beadsClient`, so `finalizeWaitingJob`'s `bead_id && beadsClient` guard never fired; `stopJob` also never invoked `finalizeWaitingJob` for `waiting` jobs. Both fixed, and keep-alive turn summaries skip the duplicate non-final done write, so a keep-alive run yields one `[turn N · WAITING]` per turn plus one `[FINAL · DONE]` at stop (`unitAI-mis38`).

## [v3.16.0] — 2026-05-23

### Added
- `sp attach` now opens a chat-style TUI for active specialist jobs, including bare-picker launch and explicit `sp attach <job-id>` attach flows.
- `sp chat` V1 ships as an interactive TUI for active jobs with `@earendil-works/pi-tui`, full keyboard input, and feed parity (`unitAI-u4fdd`).
- `execution.bare` adds zero-runtime-injection package-class specialists plus `bare.specialist.json` template support (`unitAI-rz0cp`).
- `docs/bare-specialists.md` documents bare specialists and package-class runtime behavior (`unitAI-w8t6y`).

### Changed
- `prompt.system_prompt_mode` now supports `append` and `replace` across both runner paths (`unitAI-qngis`).
- `specialists-creator` v1.4.0 adds a Bare specialists section, mandatory_rules layering, and script-class vs package-class runtime split guidance (`unitAI-dp0rw`, `unitAI-w8t6y`).

### Fixed
- Bare `sp attach` now has a real keyboard picker: Up/Down moves the highlighted active job and Enter attaches it.
- Attach targets are limited to active jobs (`running`, `waiting`, `starting`); terminal jobs are hidden from the picker and rejected when requested explicitly.
- Waiting-job attach input now uses live status/fifo data and sends resume/follow-up instead of stale `steer`; duplicate submit guards prevent double-resume busy errors.

### Security
- Pin `idna` above OSV advisory (`f7599a22`).

## [v3.15.4] — 2026-05-21

### Added
- `src/pi/session.ts` pre-spawn `serena-pool` hook: dynamically imports `ensureSerenaForRoot` from the globally installed `@jaggerxtrm/pi-extensions/extensions/serena-pool` (Bun loader) and injects `SERENA_MCP_PORT` into the pi child's `baseEnv` before spawn. `pi-serena-tools` reads the port at construction time and reuses the shared per-repo-root daemon instead of spawning its own on a random port (`unitAI-v0wpf`, `unitAI-ij37x`).
- E2E validation under linked global `sp`: single Serena per worktree on deterministic port, distinct ports across worktrees of the same repo, Serena-disabled specialists confirmed no-op, no random-port duplicate spawns (`unitAI-3gjgh`).

### Changed
- Read-only specialists no longer load Serena: `code-sanity`, `explorer`, `overthinker`, `changelog-drafter` set `execution.extensions.serena=false` and remove the `serena-cheatsheet` template_set where present. Saves ~80–150 MB resident per invocation. Phase 1 of the LSP overhead reduction epic (`unitAI-kg4t9`, `unitAI-c4g0m`).
- `docs/design/conversations.md` absorbs validated patterns from Statecraft / Envoy: explicit authority decision procedure (§10.1) with valid/invalid source lists, `system.epoch_bump` message kind for capability change re-read, `provenance_json` column on `conversation_messages`, read/ack separation invariant (cursor-through-N), authority-lane-per-participant invariant, `cannot_emit` spec field, structured error envelope (§10.2), and capture pattern for >8KB payloads (`unitAI-0p8w3`).

## [v3.15.3] — 2026-05-19

### Changed
- Expanded `using-specialists-v3` guidance with the full `bd dep --type` relationship vocabulary, duplicate/supersede commands, and typed relationship examples woven through existing specialist workflow flows (`unitAI-ylphl.8`).
- Reframed the workflow catalog epic around an executable `sp workflows` CLI/router and propagated the updated skill mirror across xtrm-managed repos (`unitAI-ylphl`).
- Refreshed README and high-traffic docs for v3.14-v3.15 release drift: first-time install/update flow, package-canonical defaults, current specialist catalog, xtrm-tools relationship, service examples, and stale doc links (`unitAI-xvvqb`).

## [v3.15.2] — 2026-05-14

### Fixed
- `sp ps -f` follow mode now behaves like a terminal dashboard instead of a print loop: TTY output uses alternate-screen in-place redraw with cursor restoration and unchanged-frame dedupe, while piped output is ANSI-free append snapshots with EPIPE-safe shutdown (`unitAI-fqo38`).
- `sp run --background` now works correctly again: the tmux wrapper used `/bin/bash -lc` (login shell) which rebuilt PATH from `/etc/profile` only, stripping NVM/bun from PATH and causing `pi` spawn ENOENT. Changed to `/bin/bash -c` so the wrapper inherits the parent process PATH (`unitAI-baz0t`).

## [v3.15.1] — 2026-05-14

### Changed
- `sp prune-stale-defaults` now removes all `.specialists/default/` entries — both byte-identical and diverged — by default, since the entire default tier is drift debt relative to the package-canonical source. Use `--keep-diverged` to retain the old conservative behavior of pruning only redundant (byte-identical) entries (`unitAI-4vuvd`).
- `sp init --sync-defaults` is now deprecated and prints a loud drift-debt warning pointing operators to `sp pin <id>` for intentional version pins. Doctor wording updated to match new `DriftStatus` names (`unitAI-3yys6`).

### Fixed
- `sp list-rules` now includes the package-canonical mandatory-rules tier in its matrix, so a fresh npm install no longer reports 0 rules. The resolver calls `resolveCanonicalAssetDir('mandatory-rules')` as the lowest-priority fallback, matching the actual runner resolution order (`unitAI-5s8df`).

## [v3.15.0] — 2026-05-14

### Added
- `LICENSE` file at repo root — MIT, 2026 copyright `Dawid (Jaggerxtrm)`. Now ships in the npm payload (asserted by the package-payload CI gate). README badge ↔ ship parity restored (`unitAI-3m27y`).
- `package.json` top-level `types` field pointing at `dist/types/lib.d.ts` — TS consumers can now import `@jaggerxtrm/specialists/lib` with type resolution from the root (`unitAI-3m27y`).
- `dist/asset-contract.json` — deterministic, byte-identical-on-regen manifest of every asset specialists ships: `schema_version`, `package_version`, sha256-hashed `shipped_skills` / `shipped_specialists` / `shipped_mandatory_rules` / `shipped_catalogs` / `shipped_nodes` / `shipped_hooks`. Generator at `scripts/generate-asset-contract.mjs` (npm script `generate:contract`). Manifest excludes wall-clock timestamps so xtrm-tools can verify its vendor mirror by sha-comparison instead of a hand-maintained vendor list (`unitAI-cww2s`).
- `.github/workflows/release-gate.yml` — fires on push to master + manual `workflow_dispatch`. paths-filter detects cross-repo asset path changes; regenerates `dist/asset-contract.json` and asserts byte-equality against the committed copy (fails on drift with a clear remediation command); fires `repository_dispatch` to `Jaggerxtrm/xtrm-tools` with `event_type=specialists-asset-validation` and `client_payload` containing the specialists git SHA + tag. Requires `XTRM_TOOLS_DISPATCH_PAT` repo secret (`unitAI-dnqas`).
- `sp merge --target-branch <name>` flag — rebase target override for chains forked from non-`origin/HEAD` branches. Threaded through `parseOptions`, `resolveDefaultBranchName`, `isBranchAlreadyPublished`, `previewBranchMergeDelta`, `rebaseBranchOntoMaster`, `assertBranchMergeWorthiness`, `runMergePlan` in both `sp merge` and `sp epic merge`. Validated via `git rev-parse --verify <branch>^{commit}` before use. Backward-compatible — missing flag preserves current `origin/HEAD` behavior. Retires the xtrm-nr05 cherry-pick playbook for non-main-fork chains (`unitAI-a6e60`).
- `sp clean --reap-orphans` adds a third detection reason: `dead-toolchain`. Surfaces specialist jobs whose PID is alive but `ppid != 1` and which haven't emitted any `tool` or `think` event in the last 30 minutes while status is `running` or `waiting`. Closes the market-data zombie-job pattern (jobs 525851 / 89ab98) where supervisor `stall_timeout_ms` missed the case. Powered by new `ObservabilitySqliteClient.getLastActivityTimestampMs(jobId)` reading `MAX(t) FROM specialist_events WHERE type IN ('tool', 'think')` (`unitAI-wq0mw`).
- `sp list-rules` now shows `.specialists/user/mandatory-rules` as the highest-priority overlay tier in the matrix (matches the runner's actual resolution order). `docs/surface-ownership.md` + `config/mandatory-rules/README.md` synced to document the user-overlay tier alongside specialist user overrides (`unitAI-7ezse`).

- `sp clean --reap-orphans` now also detects stale specialist jobs: dead-pid (DB row in `starting`/`running`/`waiting` whose PID is gone) and orphaned-keep-alive (alive PID with `ppid=1` and `specialists run`/`sp run` cmdline). Both gated by a 30-minute min-age threshold to avoid racing in-progress jobs. Dry-run prints `jobId`, `pid`, `beadId`, `specialist`, `cwd`, `ageMs`, `reason`. Apply mode SIGTERMs alive stale processes and marks the DB row `cancelled` with a `stale-reaper:<reason>` note — observability history preserved (`unitAI-8tm35`).
- `sp feed <job-id>` now replays full DB event history from `observability.db` in seq order for snapshot mode, with `--limit` still capping output and `--follow` unchanged.
- CI workflow `.github/workflows/package-payload.yml` — runs on PRs touching `package.json`, `src/`, `config/`, `dist/`, the assert script, or the workflow itself. Two jobs: `payload-contract` runs `npm pack --dry-run --json` through `scripts/assert-package-payload.sh` against a required asset list (dist entrypoints, `config/specialists/{executor,reviewer}.specialist.json`, `config/mandatory-rules/{executor-delivery,index}`, `config/skills/using-specialists-v3/SKILL.md`, `config/catalog/{index,native,gitnexus,serena}.json`); `packed-smoke` builds, packs, installs the tarball to an isolated `/tmp/sp-smoke-prefix`, and exercises `sp --version` / `doctor --check-drift` / `prune-stale-defaults --dry-run` / `clean --dry-run` / `list --compact` (`unitAI-1j9om` / `unitAI-bf7qw`).
- `scripts/assert-package-payload.sh` — bash helper, `set -euo pipefail`, exits non-zero with explicit missing-asset list when a required path is absent from the dry-run pack JSON.
- New skill `config/skills/using-specialists-auto/` (v1.0) — operator-offline paranoid autonomous orchestration mode for multi-item release runs. Codifies per-role sleep cadence, pre-merge ritual, reviewer rebuttal pattern, dist-rebuild-per-P0 discipline, batch memory-gate close loop, and escalation criteria. Activates on "auto mode", "go", "run autonomously", or similar handover phrasing.
- `sp ps` process-health dashboard — reports Linux `/proc` health above the job dashboard: aggregate specialist process count, Dolt sql-server count, Serena LSP workspaces, orphan count, RSS, CPU, age, MemAvailable thresholds, and JSON `process_health` output. Detailed per-process rows are available via `sp ps --health` (`unitAI-uof0t`).
- `sp clean --ps` soft-clean workflow — hides terminal dashboard history from default `sp ps` with `ps_hidden_at` / `ps_hidden_reason` metadata while preserving SQLite audit history; `sp ps --include-cleaned` and `sp ps --all` restore audit visibility (`unitAI-59nry`).
- `sp clean --reap-orphans` flag — kills leaked dolt/gitnexus/pi processes by walking `/proc`. Matches three orphan classes: `dolt sql-server` whose cwd is under `*/.worktrees/*`, `gitnexus mcp` orphaned to PID 1, `pi`/`pi-coding-agent` orphaned to PID 1. SIGTERM + 1.5s grace + SIGKILL escalation. Linux-only (depends on `/proc`). Combine with `--dry-run` for safe preview (`unitAI-85xxp`).
- `template_field_misuse` error_type returned by `runScriptSpecialist` when `input.template` is the literal name of a key on `spec.prompt` (e.g. `task_template`, `normalize_template`, `system`) instead of a template body — catches the production bug where consumers pass a key name and the service treats it as a 13-char prompt (`unitAI-i6khn`).
- Reference Python client at `clients/python/` — stdlib-only, ~170 LOC, with `pyproject.toml` and live-service smoke tests. Mirrors the closed `error_type` taxonomy 1:1 plus a caller-side `transport` value (`unitAI-huwov`).
- `execution.expected_output_keys: string[]` on script-class specs — triggers a required-keys check independent of `response_format`, so text-format specs that ship a JSON contract inline in `task_template` get `error_type: "invalid_json"` on hallucinated key sets instead of saving corrupt output. Documented in `docs/authoring.md` and `docs/examples/smoke-echo-text-expected-keys.specialist.json` (`unitAI-31kwe`).
- Dockerfile-level `HEALTHCHECK` (node-fetch on `/healthz`, port 8000, 30s interval) — operators inheriting the image get container health reporting for free; explicit compose-level `healthcheck:` is now only needed when overriding the listen port (`unitAI-cnlea`).

### Fixed
- `sp feed -f` (global follow mode, no specific job-id) no longer hangs indefinitely when keep-alive `waiting` jobs remain in the dashboard. `followMerged()` now treats keep-alive `waiting` as terminal-equivalent for exit purposes in global mode. Per-job follow (`sp feed <id> -f`) keeps tracking across `sp resume` turns. `--forever` still overrides for daemon-style usage. Closes GH#76 reported by `Rico1109` (`unitAI-032n4`).
- `sp merge` `bunx tsc --noEmit` post-merge gate no longer false-positives on repos without a `tsconfig.json` (markdown / notes / non-TypeScript projects). `runTypecheckGate` in `src/cli/merge.ts` now checks for tsconfig existence and prints `TypeScript gate: skipped (no tsconfig)` when absent, instead of treating tsc's help-text exit as a merge failure. Closes GH#71 (`unitAI-dpf3a`).
- `sp feed <job-id>` snapshot mode now replays full event history for that job from `observability.db` instead of truncating to the last ~8 events. `queryTimeline` / `readAllJobEvents` use a jobId-scoped DB read path when `filter.jobId` is set (instead of `listStatuses` → filter, which silently dropped events). Reviewers running the documented `sp feed <reviewed_job_id>` audit path now actually see executor's `gitnexus_*` tool events; the previous behavior was the structural cause of the reviewer "missing tool-event evidence" false-PARTIAL pattern that plagued multi-session orchestration. Cleaner `job <id> not found in .specialists/db/observability.db` message replaces the generic `No jobs directory found.` (`unitAI-889dv`).
- `sp merge` `MERGE_DIRTY_IGNORE_PREFIXES` extended with `.beads/` and `.xtrm/skills/active/` — `sp merge` no longer refuses on dirty main when only bd auto-export (`.beads/issues.jsonl`) or gitnexus stat refresh (`.xtrm/skills/active/**`) noise dirties the tree. Existing `.xtrm/reports/`, `.wolf/`, `.specialists/jobs/`, `dist/` entries unchanged. Hit 8× per multi-chain session before the fix (`unitAI-pqe96`).
- `sp run --background` detached spawn now pipes child stderr (`stdio: ['ignore', 'ignore', 'pipe']`) and forwards it to the parent's stderr, with non-zero exit when the child fails before writing a jobId. Operators no longer see only the generic `Warning: job started but ID not yet available` when the dispatch was refused by the epic-guard or stale-base check — the actual refusal reason surfaces. tmux dispatch path unchanged (tmux captures its own stderr in pane) (`unitAI-xbofm`).
- `sp doctor` Category A check now validates the flat `.xtrm/skills/active/<skill>` symlink layout that `sp init` writes, instead of the scoped `active/claude/<skill>` + `active/pi/<skill>` layout that no longer exists. Loop over `['claude', 'pi']` removed; `.claude/skills` and `.pi/skills` are now expected to symlink directly to `.xtrm/skills/active`. Fresh `sp init` followed by `sp doctor` no longer reports 4 false-positive Category A failures on first run (`unitAI-5voar`).
- `package.json` `files` allowlist tightened to explicit subdirs (`config/specialists/`, `config/mandatory-rules/`, `config/skills/`, `config/catalog/`, `config/nodes/`, `config/hooks/`, `config/presets.json`, plus `LICENSE`). `.npmignore` additionally excludes `config/benchmarks/` and `config/skills/**/evals/`. Payload shrank 258 → 256 files; dev artifacts (benchmarks, evals) no longer ship. CI `package-payload.yml` now asserts `LICENSE` is present (`unitAI-3m27y`).
- Reviewer injected-diff sources (`buildInjectedReviewerDiffVariables` in `src/cli/run.ts`) now filter each source's `files[]` against `AUTO_COMMIT_NOISE_PREFIXES` (`.xtrm/`, `.wolf/`, `.specialists/jobs/`, `.beads/`) before the empty-source fall-through. Noise-only unstaged files (e.g. `.xtrm/SKILL.md` from gitnexus stat refresh) no longer shadow the real branch-vs-base diff. Combined with `unitAI-889dv` (full DB replay), this fully retires the reviewer false-PARTIAL pattern that doubled review-turn counts (`unitAI-lqsha`).
- Reviewer specialist (`config/specialists/reviewer.specialist.json`) blast-radius gate relaxed to accept multiple evidence forms: `gitnexus_impact` event, pre-injected `$gitnexus_summary` block, `gitnexus_detect_changes` event, or LOW `impact_report.highest_risk` in `sp result`. Reviewer only flags a real gap when NONE present AND the diff touches MEDIUM+ surface (auth/secrets/input/public API/schema/control flow/framework). Safety net post-`889dv`'s structural fix (`unitAI-6fsxp`).
- Researcher specialist (`config/specialists/researcher.specialist.json`) consolidated and v-bumped 1.1.0 → 1.2.0. Model: `nano-gpt/qwen/qwen3.5-397b-a17b-thinking` → `openai-codex/gpt-5.4-mini` (qwen3.5-thinking documented to flail with parallel-rejected tool calls; gpt-5.4-mini matches executor's choice — proven for tool-heavy Bash CLI workloads); fallback `google-gemini-cli/gemini-3.1-pro-preview` (long-context fallback for research synthesis). Description rewritten with aggressive "DISPATCH BEFORE answering any library/API/framework/CLI question from training data" framing. System prompt consolidated to 3-mode structure (Targeted / Discovery / Media); skills list reduced from 4 to 1 (the 3 dropped skills — `find-docs`, `deepwiki`, `github-search` — were 100% duplicates of inlined prompt content; saves ~3-4k tokens per dispatch). `mandatory_rules` adds `per-turn-handoff-schema`. Stale `.specialists/user/researcher.specialist.json` overlay removed.
- All specialists swapped off `anthropic/claude-*` models — operator environments without Anthropic API access can now dispatch every specialist without silent dispatch failures. Three specialists had Claude as PRIMARY and were fully broken: `test-runner` (`claude-haiku-4-5` → `openai-codex/gpt-5.4-mini`), `specialists-creator` (`claude-sonnet-4-6` → `openai-codex/gpt-5.5`), `xt-merge` (`claude-sonnet-4-6` → `openai-codex/gpt-5.4-mini`). Six others had Claude as fallback (silent never-fire on primary failure): `overthinker`, `executor`, `changelog-keeper`, `node-coordinator` now fall back to `google-gemini-cli/gemini-3.1-pro-preview`; `explorer`, `changelog-drafter` fall back to `google-gemini-cli/gemini-3-flash-preview`. Final provider distribution: 12 specialists primary on openai-codex, 2 on nano-gpt/glm-5, 0 on anthropic — fallback diversity via gemini + glm.
- `sp init --help`, `sp clean --help`, `sp merge --help`, `sp finalize --help`, `sp doctor --help` refreshed to reflect post-`vwrnq`/`usj9y`/`8tm35`/`wq0mw`/`amzec`/`a6e60`/`pqe96` drift: sp init notes Bun runtime + ordered xtrm-tools install; sp clean documents `--reap-orphans` `dead-toolchain` reason; sp merge usage includes `--target-branch <name>` + auto-ignore note; sp finalize notes SQLite-first verdict read + cascade; sp doctor notes `--check-drift` Category A scope (`unitAI-3r268`).
- `sp finalize <job-id>` now succeeds when reviewer PASS verdict is persisted in SQLite even if `result.txt` was never written. Root cause: `SPECIALISTS_JOB_FILE_OUTPUT` defaults to `off`, so `<jobsDir>/<reviewer-id>/result.txt` never existed for `--job`-launched reviewers; `supervisor.readResult` only checked the file path; the PASS regex never matched. Fix: `supervisor.readResult` now reads `specialist_results.output` via `withSqliteOperation('readResult', ...)` first, falls back to the file. Eliminates the operator-override pattern that required `sp stop <exec>` + manual cleanup after every reviewer PASS dispatched via `--job` (`unitAI-amzec`).
- Executor specialist prompt no longer instructs broad `git add -A` staging. Workflow Step 5 now reads "Prefer runtime `auto_commit: checkpoint_on_waiting`; when manual staging is needed, use explicit paths only". Testing Awareness adds an explicit ban on staging `.beads/`, `.xtrm/`, `.wolf/`, `.specialists/jobs/`, `.pi/`. Self-Review adds a `git diff --cached --name-only` vs bead SCOPE check. Closes the silent-worktree-index-contamination class that broke `mercury-market-data .beads` via PR #103 on 2026-05-11 (`unitAI-dmu9q`).
- `sp init` now prints actionable, ordered recovery commands when the xtrm prerequisite is missing. Two distinct error paths: missing `xt` CLI → "install xtrm-tools globally → xt install → xt init → verify"; present `xt` CLI but missing `.xtrm/` → "run xt init in this repo → verify". `package.json` adds an underscore-prefixed `_runtime_prerequisites.xtrm-tools` field documenting the requirement without adding an npm dependency. README quickstart, `src/cli/quickstart.ts` step 1, `docs/installation.md`, and `docs/bootstrap.md` now declare the ordered install path Bun → xtrm-tools → xt install → xt init → @jaggerxtrm/specialists → sp init. `sp list`, `sp doctor --check-drift`, and `sp prune-stale-defaults` are documented as Category A commands that do not require `xt` or `.xtrm/` (`unitAI-usj9y`, audit `unitAI-go847`, docs `unitAI-6xm0f`).
- Tool catalog is now package-canonical at `config/catalog/` (was `.specialists/catalog/`). `loadSharedToolCatalogIndex` in `src/pi/session.ts` tries cwd `.specialists/catalog/index.json` first (user override path — created on demand) and falls back to `resolveCanonicalAssetDir('catalog')/index.json` from the installed package. Eliminates the silent-tool-policy-degrade that occurred for npm-installed users without a source checkout — verified by `sp list` working from a non-repo cwd. `docs/installation.md` Category A list now explicitly names `config/catalog/`. File history preserved via `git mv` (`unitAI-jj7hy`).
- AGENTS.md Specialists block is now wrapped in `<!-- specialists:start --> ... <!-- specialists:end -->` HTML sentinels, making `sp init` re-runs fully idempotent. `ensureAgentsMd` has four branches: file missing → write block; sentinels present → byte-identical replace (no-op when unchanged); legacy `## Specialists` marker but no sentinels → migrate by parsing from marker to next H2 / EOF and replacing the full legacy span; neither → append. `README.md` line 82 no longer falsely claims `sp init` injects `CLAUDE.md` (it never did; the line was a 2026-05 audit finding) (`unitAI-sgw9g`, audit `unitAI-3o3gf`).
- `package.json` declares `engines.bun: ">=1.0.0"` (was `node: ">=16.0.0"` which was misleading — the built `dist/index.js` is `bun build --target=bun` with `#!/usr/bin/env bun` shebang and uses bun-only APIs). `src/index.ts` adds an early `globalThis.Bun` runtime guard that prints an actionable error with the `https://bun.sh/install` URL and exits non-zero — defense in depth for code paths where Bun is technically available but the import sequence runs before the shebang takes effect. README quick start, `src/cli/quickstart.ts`, and `docs/installation.md` now declare Bun as a runtime prerequisite (`unitAI-vwrnq`).
- `sp ps` process-health specialist count no longer treats Serena/GitNexus MCP servers, tsserver, shell wrappers, or generic tooling as specialist jobs. The count is now intentionally narrow: direct `sp/specialists run` commands and pi-coding-agent processes only. Unknown `sp ps` flags now fail fast; `sp ps --ps` points operators to `sp clean --ps` (`unitAI-f2vhd`).
- `sp ps` no longer defaults to raw historical terminal rows. The default dashboard shows active jobs plus unresolved terminal problems, detailed process tables require `--health`, and Dolt/orphan regressions raise WARN instead of a false OK (`unitAI-0wbhi`, `unitAI-eeiza`, `unitAI-59nry`).
- `sp clean --reap-orphans` also detects deleted-cwd Dolt/tool leaks, covering stale worktree cleanup cases missed by the initial orphan collector (`unitAI-uxpl2`).
- Reviewer evidence collection now surfaces executor GitNexus tool-call evidence: reviewer prompt instructs `sp feed <reviewed_job_id>` fallback, and runner pre-injects `$gitnexus_summary` from the reviewed executor's `run_complete` observability event when dispatched with `--job` (`unitAI-gufaf`).
- `provisionWorktree`: drop the `.beads` dir→symlink swap entirely. Worktree provisioning now `rm -rf <worktree>/.beads` and marks the tracked `.beads/*` paths as `skip-worktree` via the new `markBeadsSkipWorktree` helper. Modern bd 1.0.3 stores `core.hooksPath` as an absolute parent path at `bd init`, so the worktree inherits parent hooks via shared git config — no on-disk `.beads/` is needed, and bd resolves the DB via git common-dir. Removes a serious merge hazard: any branch carrying the worktree-local `.beads` symlink (mode 120000) wipes the parent's `.beads/` on squash-merge into main (real incident: projects/infra PR #39, 2026-05-12). Removes now-unused `readFileSync`/`writeFileSync` imports. Supersedes `unitAI-u08e8` / `xtrm-nsca`. The xtrm-tools `xt end` pre-push guard (`xtrm-w1ip`) stays in place as defense-in-depth for older clones and non-CLI push paths (`unitAI-yvqmf`).
- `provisionWorktree` previously suppressed phantom `.beads/` deletions inside specialist worktree checkpoint commits via `info/exclude` + `skip-worktree`. Now superseded by `unitAI-yvqmf` above (no symlink → no noise to suppress) (`unitAI-u08e8`).
- `sp run --bead <id>` no longer race-spawns duplicate jobs against the same bead+specialist when a keep-alive job is already in `waiting`. The active-job check now includes `waiting` (was `starting`/`running` only), and `sp run` performs an early SQLite pre-flight before the supervisor fork — failing fast with `existing <status> job '<id>' already targets bead '<id>'` plus a hint to resume via `--job <id>` or cancel via `sp stop <id>` (`unitAI-55cb3`).
- `supervisor.handleResumeTurn` now auto-finalizes a keep-alive session when the resume turn produces a PASS-shaped Compliance Verdict — closes the gap that made `sp finalize <id>` necessary after every resume-driven PASS. Initial-turn auto-finalize was already in place; the resume-turn path now mirrors it (`unitAI-y6crh`).
- `supervisor` now triggers `npx gitnexus analyze` immediately after each successful auto-commit checkpoint for MEDIUM/HIGH-permission specialists (was: only at terminal completion). Reviewers/orchestrators inspecting a keep-alive worktree mid-session no longer see stale graph data. Embeddings are preserved when `.gitnexus/meta.json` shows `stats.embeddings > 0` (passes `--embeddings`). Checkpoint-time and terminal-time fires dedupe via `lastGitnexusAnalyzedSha`. Timeline events (`gitnexus_analyze_started` / `gitnexus_analyze_start_failed`) tag `backend` with the source (`checkpoint` / `terminal`) and use the dual-write `appendTimelineEvent` path so they land in `observability.db` regardless of `SPECIALISTS_JOB_FILE_OUTPUT` gating — visible in `sp feed` / `sp result` (`unitAI-hrsvj`).
- `provisionWorktree` (and xt claude / xt pi `launchWorktreeSession` in xtrm-tools) now replaces bd's stub `.beads/` inside new worktrees with a symlink to `<commonRoot>/.beads`. bd's post-checkout/pre-commit/post-merge git hooks (registered via parent's `core.hooksPath = .beads/hooks/`) re-fire on any git operation inside the worktree (notably supervisor's auto-commit checkpoint) and would otherwise re-scaffold a per-worktree `.beads/` + dolt-sql-server (60–200 MB RSS each, plus a process-leak vector on cleanup, plus the user-reported `database 'jaggers_agent_tools' not found` symptom in xtrm-tools). The symlink is preserved by all bd hooks and routes bd inside the worktree to the parent's data — single shared dolt server, shared writes (`unitAI-0wz2p` / `xtrm-as7d`).
- `supervisor.startDetachedGitnexusAnalyze` now invokes `npx gitnexus analyze --skip-agents-md --no-stats` (still passes `--embeddings` when `.gitnexus/meta.json` shows `stats.embeddings > 0`). The graph is still re-indexed (downstream `gitnexus_impact`/`context` queries see fresh data), but the AGENTS.md/CLAUDE.md edit pass and stat-block refresh are skipped — these would dirty the worktree branch on every checkpoint and cause noisy auto-commit churn.
- `pi/session.ts` no longer leaks `gitnexus mcp` / `serena mcp` child processes when a `--keep-alive` specialist is cancelled or torn down. `pi` is now spawned with `detached: true` so it owns its process group, and the cancellation paths (`close()` and `kill()`) replace the old 2s redundant SIGTERM with an 8s graceful window followed by a `process.kill(-pid, 'SIGKILL')` group-kill backstop. The redundant SIGTERM had been racing pi's in-flight MCP dispose: pi's RPC-mode handler at `rpc-mode.js:533` saw `shuttingDown=true` and called `process.exit(143)` synchronously, aborting `manager.closeAll()` mid-flight and orphaning MCP children to PID 1. The new window is enough for the worst-case ~4s/server `transport.close()` graceful path; the group-SIGKILL backstop reaps anything that survives (`unitAI-1phu7` / `unitAI-ctl0o`).
- `tests/integration/cli/run.integration.test.ts` background cases now bootstrap the observability DB via the CLI pre-run path (`src/cli/run.ts` `ensureObservabilityDb`) and the tmux dispatch path falls back to an active-job SQLite lookup when the 5s `latest` poll-deadline expires. Background dispatches no longer print the generic "Warning: job started but ID not yet available" when the child is alive and registered — operators see the real job id (`unitAI-sxmmy`, `unitAI-dq6vr`).
- `beads-commit-gate` no longer cascades when a reviewer auto-claims a review bead. The gate now requires an explicit owner KV before treating a claim as actionable; cleanup + docs added, regression test in place (`unitAI-352ni`).
- All 4 residual npm audit findings rooted in `@modelcontextprotocol/sdk@1.29.0`'s transitive chain patched via `package.json` `overrides`: `fast-uri` ^3.1.2 (high; path traversal + host confusion), `ip-address` ^10.2.0 (moderate; XSS in Address6 HTML methods), `hono` ^4.12.18 (moderate; 6 advisories incl JWT validation + cache leakage). `npm audit` returns 0 vulnerabilities (down from 20 pre-release). MCP SDK is already at latest; overrides should be removed when an upstream release bumps these (`unitAI-938u5`).

### Changed
- Specialist prompt library cleanup (epic `unitAI-q4669`, 4 rounds): added `~/.xtrm/skills/default` as second pi skills fallback path in `.pi/settings.json` (defense-in-depth; canonical path remains `.xtrm/skills/active` via project symlink chain into the installed xtrm-tools); authored 4 new shared mandatory rules (`code-quality-defaults`, `diagnose-loop`, `research-tool-routing`, `security-review-defaults`); expanded `gitnexus-required` with an execution-flow bullet; pruned 22 redundant `skills.paths` entries across 10 specialists (`code-sanity`, `debugger`, `executor`, `explorer`, `memory-processor`, `overthinker`, `planner`, `researcher`, `reviewer`, `security-auditor`); opted in `per-turn-handoff-schema` + `bead-id-verbatim` for 8 more specialists (node-coordinator deliberately excluded — its prompt explicitly forbids JSON output as final coordinator surface); `sp list-rules` confirms zero orphan rules. Cross-repo follow-up tracked as `xtrm-4h6u` (installer should scaffold both pi skills paths by default).
- Debugger discipline hardened (`unitAI-si4yi`, discovered from `unitAI-tytob`): `config/mandatory-rules/diagnose-loop.md` expanded with Matt Pocock-style contract — fast deterministic feedback loop required before code changes (blocker if unreproducible); 3–5 falsifiable hypotheses tested one variable at a time; `[DEBUG-<id>]` tagged instrumentation must be removed before completion; convert minimized repro into regression test only when a correct seam exists, otherwise route the architecture/testability finding to overthinker or planner instead of forcing a brittle test. `debugger-trace-first` rule deleted (redundant with diagnose-loop's first sentence). `config/skills/using-specialists-v3/SKILL.md` adds a new `## Bug Diagnosis Chain` section under "Choosing The Specialist" that tells the orchestrator: do not dispatch executor while bug cause is unknown — default chain is test-runner/debugger → debugger repro+hypotheses → minimal fix → test-runner rerun → code-sanity/security-auditor when risk surface applies → reviewer gate, with overthinker/planner only for architecture/testability fallout.
- `vitest` + `@vitest/coverage-v8` devDependencies bumped from `^2.1.8` to `^4.1.6` (`unitAI-zxz9f`). Resolves the 6 moderate findings in the Vitest 2 tooling chain (vitest/vite/vite-node/esbuild/@vitest/mocker/@vitest/coverage-v8). Empirical comparison on this repo: Vitest 4 is materially less flaky and faster — 87 failed / 1017 passed / 2 unhandled errors / 44s wall vs Vitest 2.1.8 baseline of 135 failed / 969 passed / 10 unhandled errors / 74s wall. No config edits needed: `server.deps.external`, coverage thresholds, and the existing test exclude list carry forward unchanged; all test files use the stable surface (`describe`/`it`/`expect`/`vi`/`beforeEach`/`afterEach`); `bun --bun vitest run` remains the canonical command path.
- `memory-processor` specialist redesigned for N>500 bd memory audits. Old single-pass workflow exhausted context past ~150-200 memories (Phase 5 per-entry classification text + Phase 7 inline `bd forget` cumulated in chat history regardless of model context size). New design: chunked file-backed audit ledger documented in `config/skills/memory-audit-transaction/SKILL.md`, with a pre-script (`config/skills/memory-audit-transaction/scripts/pre-bulk-export.sh`) that runs `bd memories --json` in a single dolt query (~ms, no per-key `bd recall` round-trips) and stages the artifacts at `.tmp/memory-audit/` before the model spawns. Spec system_prompt + task_template rewritten to defer to the skill and forbid: per-entry chat output, default-Current-without-evidence, destructive git commands. Model also switched from `nano-gpt/qwen/qwen3.5-397b-a17b-thinking` to `openai-codex/gpt-5.3-codex` — qwen3.5 via nano-gpt exhibited persistent per-turn flailing (5 rejected tool calls per turn) plus 95% default-to-Current with empty evidence on a live 508-memory audit; gpt-5.3-codex completed the same audit with 91/508 evidence-backed prunes (18% rate) in 22min for $0.019 (`unitAI-pwojn.1`, parent epic `unitAI-pwojn` Phase A; runtime support Phase B+C still open).
- Canonical specialist model defaults migrated off the unavailable `dashscope` provider. `memory-processor` now uses `nano-gpt/deepseek/deepseek-v4-pro-cheaper:thinking` (synthesis workload, operator preference). `researcher` and the `executor-benchmark-matrix` use `nano-gpt/qwen/qwen3.5-397b-a17b-thinking` (faithful family match, 256K context, thinking-enabled). The `cheap` preset in `config/presets.json` switched to `nano-gpt/moonshotai/kimi-k2.5` (no-thinking, matches the preset's `thinking_level: off`). Stale local `.specialists/user/memory-processor.specialist.json` override removed — canonical now matches operator choice (`unitAI-ght3j`).
- `test-runner` specialist v2.0.0 — now polyglot: pre-script detects manifest (`package.json` / `pyproject.toml` / `pytest.ini` / `setup.cfg` / `Cargo.toml` / `go.mod`) and dispatches the canonical test command (`npm test`, `pytest`, `cargo test`, `go test ./...`); falls back to a `[test-runner] no project test manifest detected` descriptive message with exit 0 instead of a missing-binary crash. system prompt + task_template are project-language-aware. `vitest`/`jest` removed from tags (`unitAI-0er69`).
- `executor` and `debugger` specialist prompts soften hardcoded `tsc --noEmit` / `npm run lint` references to neutral "project-appropriate lint and typecheck" phrasing with multi-language examples (Node / Python / Rust / Go) (`unitAI-dults`).
- `executor` post-script is manifest-aware: `package.json` → `npm run lint`, `pyproject.toml`/`setup.cfg` → `ruff` + `mypy` (when on PATH), `Cargo.toml` → `cargo clippy`/`check`, `go.mod` → `go vet`, none → descriptive no-op (`unitAI-dults`).
- `reviewer` specialist system prompt step 4 (Job linkage and evidence collection) now teaches `git diff $(git merge-base HEAD master)..HEAD` for the canonical changed-range and explicitly forbids rebase / squash / reset / amend / hand-merge / making new commits in the reviewed worktree. Auto-commit checkpoints (live since Apr 13 `11e9b016`) produce N-commit feature branches; reviewer was sometimes panicking and trying git surgery. `sp merge` / `sp epic merge` own publication squashing.

### Changed
- `docs/specialists-service.md` documents the full closed `error_type` taxonomy (now includes `template_field_misuse`, `prompt_too_large`, `output_too_large`) and cross-references the Python reference client (`unitAI-huwov`).
- `docs/examples/specialists_client.py` removed; canonical reference now lives at `clients/python/specialists_client.py` (`unitAI-huwov`).
- New `docs/deploying-alongside.md` — copyable compose recipe for adding `specialists-service` to an existing multi-service stack on a non-host network, with the three required tweaks (`user:`, `HOME=/pi-home`, rw `.specialists/`) explained and a symptom→cause→fix troubleshooting matrix (`unitAI-2fz5b`).

---

## [v3.14.1] — 2026-05-07

### Changed
- `changelog-keeper` specialist scoped to `CHANGELOG.md` only — no longer bumps version, builds, commits, tags, pushes, or publishes; the `/releasing` skill owns those steps and dispatches `changelog-keeper` only to fill `[Unreleased]` gaps from xt reports (`unitAI-g29jv`).

---

## [v3.14.0] — 2026-05-07

### Added
- `sp serve` operational logging with `--log-level off|info|debug` and structured JSON `/v1/generate` request events (`unitAI-8y70l`).
- `sp serve --readiness-canary off|warn|require` for Pi child readiness validation (`unitAI-z2vpq`).
- Script-runner JSON output-contract injection from `response_format: json` schema (`unitAI-z2vpq.4`).
- Local dev container name `sp-service-dev` to distinguish repo-local Compose dev service from consumer-owned `specialists-service` (`unitAI-826pp`).
- Paranoid-mode orchestration discipline, sleep-timer monitoring, mandatory security/sanity chain, project-specific specialist guidance, and worktree cleanup steps in `using-specialists-v3` skill.

### Changed
- Script-runner sends rendered prompts via stdin instead of argv to prevent process-list leakage and avoid Pi CLI parsing on `--`/`@`-prefixed content (`unitAI-z2vpq.1`).
- Script-runner spawns Pi child with `cwd: projectDir` so service consumers resolve files relative to their configured project (`unitAI-z2vpq.2`).
- Rendered prompt-size preflight added before Pi spawn (`prompt_too_large`, `execution.prompt_limit_bytes`, `SPECIALISTS_SCRIPT_PROMPT_LIMIT_BYTES`, 4MiB default) (`unitAI-z2vpq.3`).
- `sp serve --allow-local-scripts` and `skills.scripts` in script/service mode now fail-closed until a sandboxed lifecycle exists (`unitAI-z2vpq.7`).
- `--allow-skills-roots` boundary validation switched to normalized `path.relative` containment for both `skills.paths` and `prompt.skill_inherit` (`unitAI-z2vpq.6`).
- Trusted skills forwarded to Pi child as explicit repeated `--skill` arguments only (`unitAI-z2vpq.5`).
- `--db-path` now treated as an exact SQLite file path (`unitAI-z2vpq.8`).
- script-runner forwards `spec.prompt.system` via Pi `--system-prompt` (full override) when set, so non-coding specialists no longer inherit pi's default coding-agent system prompt (`specialists-37x`).
- AGENTS.md: replaced hardcoded `sp` command catalog with `sp help` instruction and added `sp steer` to orchestration command list.

### Fixed
- `--offline` flag now propagates to script-runner Pi invocation in `sp serve` (`f61032a5`).
- Script-runner isolates Pi prompts from project context (`specialists-6vy`).

---

## [v3.13.0] — 2026-05-05

### Added
- Documented the canonical-live Category A and xtrm-managed Category B distribution model, including installation, skill/hook drift, and operator refresh commands (`unitAI-o4khi`).

### Changed
- Removed deprecated `sp poll`; use `sp ps <id> --json` for status, `sp feed <id>` for events, and `sp result <id>` for final output (unitAI-kbxu7).
- `update-specialists` v2.1 now separates specialists-owned runtime refresh (`sp doctor --check-drift`, `sp prune-stale-defaults`) from xtrm-owned asset refresh (`xt doctor`, `xt update`) so operators do not conflate the two distribution tracks (`unitAI-tsnwh.5`, `unitAI-o4khi`, `specialists-4iq`).

### Fixed
- Bundled `sp doctor`, `sp status`, and related diagnostics no longer crash when resolving package metadata from installed `dist/index.js`; version checks now support both source and packaged layouts (`specialists-4iq`).
- `security-auditor` no longer ships machine-specific `/home/dawid/projects/xtrm-tools` skill paths; optional security skills now resolve through repo-relative `.xtrm/skills/optional/...` paths (`specialists-4iq`).

---

## [v3.12.0] — 2026-05-05

### Added
- `specialists list --full` live registry surface now shows worktree behavior, chain position, median runtime, and role-specific mandatory rules for routing (unitAI-5ad59543)
- `using-specialists-v3` skill adds live-registry orchestration guidance and keeps command discovery centered on `specialists list --full` and `sp help` (unitAI-3ecd8ddf; unitAI-d222b022)
- `specialists list` routing descriptions now stay rich enough to support live role selection from registry output (unitAI-a1605ced; unitAI-0539c3cd)

### Changed
- `changelog-keeper` draft flow now uses script-safe changelog synthesis from curated xt reports (unitAI-0b179f8f)
- `sp script` timeout and scope-bleed handling tightened so long-running script work does not bleed into adjacent worktree state (unitAI-22c0bf39)
- Epic merge dirty-state integration tests stabilized after merge/publication edge cases (unitAI-eb68cf6c)
- `sp release` / release-pipeline handoff and `using-specialists-v3` activation docs updated for v3 orchestration flow (unitAI-fc588ba4; unitAI-5677cce8; unitAI-fb0ed5ee)
- Specialist metadata and mandatory rules refreshed so live registry output reflects current roles and policies (unitAI-5b3c3839; unitAI-77e21085; unitAI-d1ca9f96; unitAI-28781c48)

### Fixed
- Scope-bleed fix paired with raised script timeout to keep release drafting bounded (unitAI-22c0bf39)
- `sp epic merge` dirty-tree publication path now survives unrelated dirty state and preserves merge-ready validation (unitAI-eb68cf6c)
- `sp config show --resolved` and repo-local mandatory rules now resolve from current worktree instead of stale global dist (unitAI-77e21085)

---

## [v3.11.0] — 2026-05-03

### Added
- `changelog-keeper` specialist v1 for release-note synthesis from curated xt reports (unitAI-znkgi.2)
- Releasing skill workflow for prepare/publish release flow after CLI removal (unitAI-fhbf4)
- `sp doctor` / `sp status` version-check nudges with cached tag awareness and per-tag dedupe (unitAI-znkgi.9)
- `using-kpi` skill for KPI analysis and payload/runtime observability recipes (unitAI-drs41.4)
- `sp db extract` / `sp db stats` surfaces for KPI extraction and analysis help (unitAI-drs41.4; unitAI-svnft)
- GitNexus-required new-file escape hatch rule for additive specialist/doc changes (unitAI-znkgi.7)
- `sp release prepare` range flags `--from` / `--to` for explicit backfill windows (unitAI-1evl2)
- `sp release` publish-time validation for top-section gating, annotated tag creation, and push flow (unitAI-znkgi.3)

### Changed
- `sp release prepare` now accepts markdown-only specialist output, normalizes missing section keys, and keeps section replacement bounded (unitAI-8elrc; unitAI-1avsn; unitAI-a3s9a)
- `changelog-keeper` output tightened with fallback chain and stricter section fidelity for release drafts (unitAI-8elrc; unitAI-khlqj)
- `sp clean` migrated to DB-first job selection with PID-primary stale-process cleanup (`--processes`) (unitAI-ltwme)
- `sp clean --keep` now preserves chain-root jobs referenced by epic membership by default; `--aggressive-prune` bypasses that protection for hard purges, and `sp ps --include-terminal` renders orphaned terminal epics without dropping chain rows (unitAI-b0bc62)
- `sp script` stdout cap raised to 128MB with incremental parse for oversized streams (unitAI-9cygd; unitAI-a47ub)
- `sp script` retained cap handling fixed so overflow recovery stays stable under repeated reads (unitAI-1avsn; unitAI-a47ub)
- `sp script` template-check / compat guard fix for spec loading under release-related flows (unitAI-r7zte)
- `sp release` semver section label now derives from `--to HEAD` correctly (unitAI-7qu0t)
- `sp release` draft parser now accepts array-shape sections and markdown fallback (unitAI-a3s9a)
- Release parser now accepts JSON drafts missing section keys and backfills empty buckets (unitAI-1avsn)
- `using-specialists-v2`, `update-specialists`, `CLAUDE.md`, `AGENTS.md`, and related docs synced for release awareness and update checks (unitAI-znkgi.5; unitAI-jhhu4.1; unitAI-c190df90)
- `docs/design/gzrx-tool-catalog.md` aligned with source policy for centralized tool catalog design (unitAI-gzrx)
- `src/cli/doctor.ts` drift check now warns on stale user-overlay specialists before they shadow defaults (unitAI-bb3h6)
- `src/specialist/script-runner.ts` and tests got stdout-cap, parse, and tool-allowlist fixes across release/debugger work (unitAI-9cygd; unitAI-1avsn; unitAI-a47ub; unitAI-c6he0)
- `src/cli/release.ts` / `src/cli/version-check.ts` / `src/cli/clean.ts` got the release, version-check, and DB-first cleanup flow updates (unitAI-znkgi.3; unitAI-znkgi.9; unitAI-ltwme)
- `docs/observability-metrics.md`, `docs/cli-reference.md`, and skill mirrors updated for KPI and release workflow drift (unitAI-drs41.4; unitAI-znkgi.5)

### Fixed
- Release draft rendering now handles markdown-only output and JSON drafts missing section keys without losing bullets (unitAI-8elrc; unitAI-1avsn)
- `sp script` overflow handling now preserves retained caps across parse retries and large stdout bursts (unitAI-a47ub)
- `sp release` publish/prepare validation now rejects section-label and array-shape edge cases before bad tags land (unitAI-7qu0t; unitAI-a3s9a)
- `sp clean` no longer depends on file-era job dirs and survives deleted process state (unitAI-ltwme)

### Removed
- `sp release` CLI path replaced by releasing skill workflow for publishing releases (unitAI-fhbf4)

---

## [3.10.0] - 2026-04-27

Reviewer traceability, hook DB migration, `/lib` export, `list-rules` CLI, and the `serena-cheatsheet` mandatory rule.

### Added
- `sp list-rules` — rule × specialist matrix CLI for inspecting which mandatory rules each specialist loads (unitAI-wv3l9)
- `/lib` subpath export for Node consumers embedding the runner library (unitAI-rw13n)
- `serena-cheatsheet` mandatory rule providing per-specialist Serena-tool guidance, opt-in via `template_sets` (unitAI-acb59b59)
- Auto-close linked bead on terminal job status (cancelled/done/error) — supervisor closes the bead when the job ends (unitAI-9truh)
- PID-liveness inference for zombie job visibility in readers (unitAI-zw9w1)
- `output_type` surfaced in `SupervisorStatus` and `run_complete` events (unitAI-e90j)

### Changed
- Default `--context-depth` raised from 1 to 3 — chained specialists now see own bead + predecessor + parent task by default (unitAI-231x)
- `sp poll` deprecated in favor of `sp ps` (state) + `sp feed` (stream) (unitAI-zjhsj)
- Reviewer prompts now include diff context wired through cleanly (unitAI-18d1d)
- `serena-cheatsheet` removed from `default_template_sets`; specialists must opt in explicitly (unitAI-49188)

### Fixed
- `specialists-complete` hook reads job state via `sp ps` (DB-first) instead of stale file paths (unitAI-q5k2p)
- `specialists-creator` spec now includes `fallback_model` field as required (unitAI-9ilgw)
- Reviewer traceability gaps for GitNexus invocation evidence and injected diff context (unitAI-ctkk9)
- CLI help test stabilized for bun spawn behavior (unitAI-56f98)

---

## [3.9.0] - 2026-04-26

`fln4q-epic` SQLite observability migration, `specialists-service` v1 (HTTP + CLI surfaces for script-class specialists), `sp script` CLI, and a strict 1:1 schema-to-runtime cut.

### Added
- `sp script` CLI — synchronous one-shot specialist invocation (READ_ONLY, template + variables, JSON out) for service/script consumers (unitAI-2cbbae)
- `specialists-service` v1 — HTTP and CLI surfaces for script-class specialists (`sp serve` + `sp script`) (unitAI-fln4q)
- Script target validate mode for pre-run validation of scripts/commands/tools/shebangs (unitAI-4b591)
- Pre-flight `pi-coding-agent` compat regression CI workflow (unitAI-5077f)
- Mercury atomic-summarizer schema-target PoC example (unitAI-f2075)
- Python adapter reference for `darth-feedor` migration (unitAI-f98788)

### Changed
- **Strict 1:1 schema-to-runtime cut**: every JSON field must map to a runtime consumer. Dropped `CommunicationSchema` (`next_specialists`, `publishes`), `capabilities.diagnostic_scripts`, `prompt.normalize_template`, `prompt.examples`, `execution.preferred_profile`, `execution.approval_mode`, `metadata.author`, `metadata.created`, root `heartbeat`, deprecated `ScriptEntry.path` alias. 26 specs + `docs/authoring.md` + `config/skills/specialists-creator/SKILL.md` + `src/cli/view.ts` + `scaffold-specialist.ts` updated in lockstep (unitAI-68edd, unitAI-8n0aa)
- Schema validation now uniform across all 26 specs; `xt-merge` `output_to` → `output_file` (typo'd dead alias was silently dropping merge result writes) (unitAI-02deb, unitAI-yb9qu)
- Schema preserves unknown keys via `.passthrough()` on every nested `SpecialistSchema` object — fixes silent acceptance of typo'd fields (unitAI-f27c8)
- `--user-dir` → `--project-dir` rename in `sp script` and `sp serve` with deprecated alias retained (unitAI-rfjbd)
- Pi 0.70.x compatibility — dropped `args.push('--', prompt)` option terminator in `script-runner.ts`; image base unpinned to `@latest` (unitAI-w0h7z)
- `fln4q-A`: env-gated file fallback for `attach`/`list`/`poll`/`status`/`feed_specialist` with `SPECIALISTS_JOB_FILE_OUTPUT` (unitAI-5521c)
- `fln4q-B`: detached watchdog DB-backed child read path; `cleanupProcesses` file fallback gated by env (unitAI-50283, unitAI-91cfea)
- `fln4q-B2` v2: Bun runtime helper, mode-split watchdog, read-only DB child (unitAI-73c1d)
- DB-first job reads, crash recovery, event reads, job cleanup readers (multiple commits, fln4q-epic)
- Supervisor file writes gated behind `SPECIALISTS_JOB_FILE_OUTPUT` env (unitAI-ppkdg)
- README documentation map points to specialists-service docs
- `sp serve` and `sp script` surfaced in core commands list (unitAI-2f8f4)
- `db` legacy migration tooling clarified; canonical store is SQLite (unitAI-23a1c, unitAI-3425a)

### Fixed
- NDJSON parser handles pi's real `message_end` and `agent_end` shapes (prior parser matched a fictional shape that the test mock perpetuated) (unitAI-68owr)
- Pi `errorMessage` surfacing — when content is empty, `message.errorMessage` flows through error taxonomy so quota/auth errors no longer silently return success-with-empty-output (unitAI-68owr)
- JSON-mode markdown fence stripping — `stripMarkdownFences()` runs before `JSON.parse` for `response_format=json` so kimi-style fenced output parses (unitAI-68owr)
- `specialists-creator` JSON corruption — zsh prompt artifact had been pasted into the file as a JSON key; only caught after `.passthrough()` exposed the silent survival of unknown keys (unitAI-826wl)
- Stale `.xtrm/skills/active/pi/<name>/` skill paths bulk-swept across canonical and mirror specs (`pi/` subdirectory removed in prior layout migration but references lingered) (unitAI-826wl)
- `withSqliteOperation` callbacks now return non-undefined sentinel (unitAI-f30e56)

### Removed
- `parallel-review` specialist files (renamed to `parallel-runner` in 3.4.0; spec files lingered until cleanup)
- 11 declarative-only schema fields (no runtime consumer — see Changed → strict 1:1 schema cut)

---

## [3.8.0] - 2026-04-26

`specialists-service` v1 — HTTP and CLI surfaces for script-class specialists, plus a strict 1:1 schema cut so every JSON field maps to a runtime consumer.

### Added
- **`sp serve`**: Node `http` server exposing `POST /v1/generate` and `GET /healthz` for script-class specialists; real semaphore queue with HTTP 429 on contention, SIGTERM forwarding to in-flight pi children, 4MB stdout cap, trace rows persisted to canonical `observability.db` with `surface: 'script_specialist'` (unitAI-c6uvn).
- **`sp script <name>`**: One-shot CLI peer to `sp serve` for cron and host scripts; cron-friendly exit codes (0/1/2/3/4/5/6/7/75); `--single-instance <lockpath>` uses `flock` with `EX_TEMPFAIL` on contention (unitAI-6qctn).
- **`sp validate <path> --target script`**: Offline pre-deploy validator that runs schema parse plus `compatGuard` and exits non-zero on failure with structured error (unitAI-bahj1).
- **Docker image**: Multi-stage `oven/bun` build, non-root UID 10001 user, `WORKDIR /work`, `ARG PI_VERSION=latest`. Sidecar template at `docker/compose.example.yml` (unitAI-atwom).
- **CI canary `.github/workflows/pi-compat.yml`**: Weekly cron + PR-triggered smoke that fails loud on pi spawn-flag drift; no quota, no secrets, no LLM calls (unitAI-nsru6).
- **Reference Python adapter `docs/examples/specialists_client.py`**: Stdlib-only, mirrors the closed `error_type` union with a `TRANSPORT` value for caller-side HTTP failures; live-smoked end-to-end against real pi (unitAI-s2won).
- **Reference script-class spec `docs/examples/mercury-atomic-summarizer.specialist.json`**: Phase 1 first-spec, copyable, validated against the migration doc's schema target (unitAI-t9t11).
- **Reference smoke spec `docs/examples/smoke-echo.specialist.json`**: For verifying a fresh deployment.
- **`handoff-feedor.md`**: One-page operator handoff at repo root for adopting `specialists-service` v1 in darth-feedor.
- **Documentation**: `docs/specialists-service.md` (canonical contract), `docs/specialists-service-install.md` (build-from-repo install with rootless-podman + Fedora-SELinux notes), `docs/specialists-service-evaluation.md` (production-evaluation memo), `docs/release-image.md` (maintainer build/push reference), `Script-class authoring` section in `docs/authoring.md`, `Schema target` translation table in `docs/darth-feedor-migration.md`.
- **Spec uniformity audit script `config/skills/specialists-creator/scripts/audit-spec-uniformity.mjs`**: Portable, reports parse failures and unknown keys; KNOWN sets stay in lockstep with `src/specialist/schema.ts`.

### Changed
- **Zod schema passthrough**: `SpecialistSchema` now uses `.passthrough()` on every nested object so unknown keys survive `parseSpecialist()` and `sp edit` round-trip stops silently dropping fields (unitAI-xutg2).
- **Strict 1:1 schema-to-runtime cut**: Every JSON field must map to a runtime consumer (unitAI-8n0aa). Dropped `CommunicationSchema` entirely (`next_specialists`, `publishes`), `capabilities.diagnostic_scripts`, `prompt.normalize_template`, `prompt.examples`, `execution.preferred_profile`, `execution.approval_mode`, `metadata.author`, `metadata.created`, root `heartbeat`, and the deprecated `ScriptEntry.path` alias. 26 specs, `docs/authoring.md`, `config/skills/specialists-creator/SKILL.md`, `src/cli/view.ts`, and `scaffold-specialist.ts` updated in lockstep.
- **`--user-dir` → `--project-dir`**: Flag renamed in `sp script` and `sp serve` (the flag has always been the project root, not a user-spec dir); `--user-dir` retained as a deprecated alias (unitAI-rfjbd).
- **Pi 0.70.x compatibility**: Dropped the `args.push('--', prompt)` option terminator in `src/specialist/script-runner.ts`; both 0.64 and 0.70.2 accept positional prompt. Image base unpinned to `@earendil-works/pi-coding-agent@latest` (unitAI-w0h7z).
- **`xt-merge` output_to → output_file**: Migrated to canonical top-level field — a typo'd dead alias had been silently dropping `merge-prs-result.md` writes since the spec was authored (unitAI-yb9qu).
- **README documentation map**: Now points to the new specialists-service docs.

### Fixed
- **NDJSON parser real shape handling**: Now handles pi's real `message_end` and `agent_end` event shapes; prior parser matched a fictional shape that the test mock perpetuated, returning empty assistant text in production (unitAI-68owr).
- **Pi `errorMessage` surfacing**: When content is empty, `message.errorMessage` is surfaced through the error taxonomy so quota and auth errors no longer silently return `success: true` with empty output (unitAI-68owr).
- **JSON-mode markdown fence stripping**: `stripMarkdownFences()` runs before `JSON.parse` for `response_format=json` responses; some models (e.g. kimi) wrap JSON in markdown code fences regardless of the format directive (unitAI-68owr).
- **`specialists-creator.specialist.json` JSON corruption**: A zsh prompt artifact had been pasted into the file as a JSON key (`"permission_requiredspecialists — zsh "`); only caught after `.passthrough()` exposed the silent survival of unknown keys (unitAI-826wl).
- **Stale skill-path sweep**: Bulk-swept 19 stale `.xtrm/skills/active/pi/<name>/` skill paths across canonical and mirror specs; the `pi/` subdirectory was removed in a prior layout migration but the references were never updated (unitAI-826wl).

### Removed
- **`parallel-review` specialist files**: Removed from canonical and mirror (renamed to `parallel-runner` in 3.4.0; spec files lingered until this cleanup).
- **11 declarative-only schema fields**: See Changed → strict 1:1 schema cut. None had a runtime consumer.

[Unreleased]: https://github.com/Jaggerxtrm/specialists/compare/v3.11.0...HEAD
[v3.11.0]: https://github.com/Jaggerxtrm/specialists/releases/tag/v3.11.0
[3.10.0]: https://github.com/Jaggerxtrm/specialists/releases/tag/v3.10.0
[3.9.0]: https://github.com/Jaggerxtrm/specialists/releases/tag/v3.9.0
[3.8.0]: https://github.com/Jaggerxtrm/specialists/releases/tag/v3.8.0
