# Production Admin Acceptance Report

## Status

- Mini Program / CloudBase / cloudApi: `PASS`
- Overall Dashboard production acceptance: `EXTERNAL_CHANGE_REQUIRED`
- `PRODUCTION_ACCEPTANCE_PASS` is intentionally not claimed because Dashboard credentials and browser E2E belong to the external read-only repository in this run.

## CloudApi Deployment

- Environment: `cloud1-d0geb9qt9d29ee6fc`
- Function: `cloudApi`
- Result: deployed successfully with remote dependency installation
- Package: 12 files, 63.6 KB
- Deployment used the explicit project AppID path because the implicit project-context CLI route returned `getCloudAPISignedHeader ret=41002` with an empty AppID.

## Production Defects Fixed

1. Existing training-content edits, status changes, and deletion passed CloudBase `_id`/`_openid` fields into `document.update`.
   The write boundary now strips those immutable system fields.
2. Public training catalogs exposed zero-based `policyPosition` as `day/sortOrder`.
   Public list and detail responses now map internal position 0..N-1 to display Day 1..N without changing access-control semantics.

## CloudBase CRUD

- Create: PASS, 1 affected content record
- Readback: PASS
- Edit: PASS, 1 affected content record
- Move up: PASS, 2 affected content records per adjacent swap
- Move down: PASS, 2 affected content records per adjacent swap
- Archive: PASS, 1 affected content record
- Restore: PASS, 1 affected content record
- Delete: PASS, existing `deleted_tombstone` semantics
- Cleanup: 0 active `AUTO_E2E_20260808_*` records; original content order and stored positions restored

## 216-item Ordering

- Module: `reading`
- Active records: 216
- Admin pagination: 3 pages
- Public pagination: 3 pages
- Create writes: 1 content record
- Reorder writes: 2 content records
- Delete/archive writes: 1 primary content record without list-wide renumbering
- Transaction limit: not triggered
- Public Day range: 1..216, dense and stable

## Registration Report

- Week: 2026-08-03 through 2026-08-09
- Weekly total: 13
- Daily trend total: 13
- Daily cross-checks: 2026-08-03=3, 2026-08-04=3, 2026-08-05=4, 2026-08-06=2, 2026-08-07=1
- No-data date: 2000-01-01=0
- Timezone: Asia/Shanghai (+08:00)

## User / Membership

- `adminListPhoneEntitlements`: PASS
- Production entitlement records returned: 19
- Null/empty-safe response: PASS
- Dashboard-wide user/member cards were not validated in this run because they require the external Dashboard repository and credentials.

## Authentication

- Current simulator account: admin from `admins_collection`
- Mini-program admin actions: PASS
- `adminWebListUsers` without sync token: fail closed with `DASHBOARD_TOKEN_NOT_CONFIGURED`
- `adminWebUpsertTrainingContent` without sync token: fail closed with `DASHBOARD_TOKEN_NOT_CONFIGURED`

## Automated Tests

- CloudApi Node tests: 12/12 PASS
- CloudApi JavaScript syntax checks: PASS
- Training access-policy integration check: PASS
- `git diff --check`: PASS
- DevTools production run exceptions: 0
- DevTools production run unexpected console errors: 0

## Evidence

- `reports/production-admin-acceptance/cloudbase-mini-side-1786198238701.json`
- `reports/production-admin-acceptance/cloudbase-readback-1786198493366.json`

## External Change Required

`EXTERNAL_CHANGE_REQUIRED`

- External file: `/Users/jefferyguo/koucai-content-dashboard/.env.local`
- Reason: Dashboard server-side CloudBase calls and Basic Auth need their own credentials; `cloudApi` correctly rejects `adminWeb*` calls while the shared sync token is absent.
- Suggested configuration names: `TENCENTCLOUD_SECRET_ID`, `TENCENTCLOUD_SECRET_KEY`, `CLOUDBASE_ENV_ID`, `CLOUDBASE_DATA_MODE`, `DASHBOARD_ADMIN_SYNC_TOKEN`, `DASHBOARD_ADMIN_USER`, `DASHBOARD_ADMIN_PASSWORD`.
- The same `DASHBOARD_ADMIN_SYNC_TOKEN` must also be configured in the production `cloudApi` function environment before Dashboard live E2E.
- No values are included in this report.

## Workspace Boundary Audit

- Git Root: `/Users/jefferyguo/WeChatProjects/miniprogram-1`
- Modified files outside miniprogram-1: NONE
- Created files outside miniprogram-1: NONE
- Runtime dependency introduced outside miniprogram-1: NONE
- External project modifications: NONE

## Remaining Issues

- Dashboard credential configuration and real Desktop/390px Dashboard browser acceptance remain external to this run.
