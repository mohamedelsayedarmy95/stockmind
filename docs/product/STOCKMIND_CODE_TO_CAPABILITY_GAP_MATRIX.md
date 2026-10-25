# STOCKMIND — CODE-TO-CAPABILITY GAP MATRIX

> **الحالة:** Series 08 (تصميم وأدلة فقط) · أُخذ من الكود في `dc4ff4d` (آخر كود مُختبَر `b3d824f`) · 2026-10-25.
> **المنهج:** قراءة مباشرة للكود (مسارات ورموز ومهاجرات)، وبحث ثابت، ومطابقة مع تقارير Series 04–07. **ما اتشغّلش أي اختبار جديد في Series 08.** أرقام الاختبارات المذكورة هي نتايج Series 07 على `b3d824f` (backend 51 suites / 347، mobile 16 / 252)، ومنسوبة له وبس.
> **تصنيفات:** `IMPLEMENTED_AND_TESTED` · `IMPLEMENTED_PARTIAL` · `BACKEND_ONLY` · `MOBILE_ONLY` · `DESIGNED_NOT_IMPLEMENTED` · `UNVERIFIED` · `NOT_PRESENT` · `CONFLICTS_WITH_EXISTING_DESIGN`.
> **تحفّظ:** "مُختبَر" هنا يعني ليه اختبار آلي موجود في الريبو. لو الخاصية ظاهرة من القراءة الثابتة بس، مكتوب **(قراءة ثابتة، مفيش اختبار runtime)**.

---

## 1. الجدول (بحسب موضوع في تفويض Series 08 §4)

### 1.1 المؤسسة والمستخدمون والصلاحيات

| # | القدرة المقترحة | التصنيف | الدليل (ملف / رمز / اختبار) | ملاحظة |
|---|---|---|---|---|
| C1 | Organization = Company | IMPLEMENTED_AND_TESTED | `src/domain/entities/company.entity.ts` (`companies`: name, tax_id, currency, plan…)؛ `TenantSubscriber`؛ `tests/integration/tenant-concurrency.pg.spec.ts`، `shared-warehouse.pg.spec.ts` | العزل بـ `company_id` على كل جدول + فحص `afterLoad` في `src/infrastructure/database/subscribers/tenant.subscriber.ts`. **مفيش RLS في PostgreSQL** (بحث `ROW LEVEL SECURITY` في `src/` = صفر). |
| C2 | عضوية متعددة المؤسسات لمستخدم واحد | NOT_PRESENT / CONFLICTS | `user.entity.ts`: `email` **unique** عالمياً، `company_id` على المستخدم؛ `TeamService.createInvitation` بيرفض لو الإيميل مسجّل (`Email already registered`) | مستخدم = شركة واحدة. التحويل لعضويات يحتاج جدول `memberships` (ADR A). |
| C3 | Owner منفصل عن Admin | NOT_PRESENT | `enums.ts`: `UserRole` = Admin/Manager/Staff فقط؛ `register` بيعمل أول مستخدم Admin | مفيش علم "owner" ولا حماية لآخر Admin ولا نقل ملكية. |
| C4 | الأدوار الثلاثة وصلاحياتها | IMPLEMENTED_AND_TESTED | `src/shared/constants/permissions.constant.ts` (`DEFAULT_ROLE_PERMISSIONS`)؛ `PermissionsGuard`؛ `tests/unit/permissions.guard.spec.ts` | Admin = كل شيء (بما فيه `MANAGE_RECOVERY` من Series 07)؛ Manager = المنتجات (بما فيها DELETE_PRODUCT)، إنشاء/تعديل/عرض المخازن (بدون DELETE_WAREHOUSE)، كل حركات المخزون (inbound/outbound/adjustment/transfer)، الأرصدة، الحركات، VIEW_AUDIT_LOG، **بدون** MANAGE_USERS/MANAGE_ROLES/MANAGE_RECOVERY؛ Staff = VIEW_PRODUCT + VIEW_WAREHOUSE + inbound + outbound + balance + movements. |
| C5 | أدوار/صلاحيات في قاعدة البيانات (roles, permissions, user_roles) | IMPLEMENTED_PARTIAL | `role.entity.ts`، `permission.entity.ts`، `role-permission.entity.ts`، `user-role.entity.ts`، `PermissionService.hasAll`، migration `1721800000000-Phase2RbacAudit` | `PermissionsGuard` بيجرّب الخريطة الثابتة بالـ role claim الأول ثم يرجع للجداول (fallback). `register` **ما بيكتبش** صفوف Role (بس `src/seed/seed.ts`) ← عملياً الجداول غير مستخدمة في الإنتاج. |
| C6 | Manager مقيّد بمخازن معيّنة | **CONFLICTS_WITH_EXISTING_DESIGN** | `WarehouseAccessService.FULL_ACCESS_ROLES` = Admin+Manager؛ `TeamService.setWarehouseAccess` بيرفض غير Staff (`Admin and Manager have access to every warehouse`)؛ `listMembers` بيرجّع `'all'` | المطلوب (3.3/3.4: Warehouse Manager لمخازن بعينها) عكس التصميم الحالي. |
| C7 | منح مخازن لـ Staff (scoped grants) | IMPLEMENTED_AND_TESTED | `warehouse-access.entity.ts`، `WarehouseAccessService.scope/assertCanUse`، `@WarehouseScoped` (`warehouse-access.guard.ts`)، `PUT /team/members/:id/warehouses`؛ `shared-warehouse.pg.spec.ts`، `operation-lookup.pg.spec.ts` (revoked ⇒ unavailable)، `recovery-integrity.pg.spec.ts` | الصلاحية بتتقرأ من القاعدة كل طلب. الـ grant = "مخزن" بس: مفيش قدرات لكل grant (استلام/صرف/جرد…). |
| C8 | تحويل بين مخزنين: تفويض المصدر والوجهة | IMPLEMENTED_AND_TESTED | `StockController.transfer`: `@WarehouseScoped('body.fromWarehouseId','body.toWarehouseId')` + `STOCK_TRANSFER` (Manager/Admin فقط) | |
| C9 | CP-4: مخزن جديد غير ظاهر لـ Staff الحاليين | BACKEND_ONLY (ثغرة معروفة R7) | `1792560000000-SharedWarehouseFoundation` (منح افتراضي للمخازن الموجودة وقت الـ migration فقط)؛ `WarehouseService.create` ما بيمنحش حد | الـ API لمنح الصلاحية موجود، مفيش UI ومفيش سياسة "مين ياخد المخزن الجديد". |
| C10 | دعوات (invitations) | IMPLEMENTED_AND_TESTED (backend)، MOBILE (قبول الدعوة) | `TeamService.createInvitation/revoke/listInvitations`، `AuthService.acceptInvitation` (token SHA-256، 7 أيام)، `mobile/app/(auth)/accept-invitation.tsx`؛ `shared-warehouse.pg.spec.ts` | الدعوة بدور Manager/Staff فقط. |
| C11 | إدارة الفريق على الموبايل (قائمة، منح، دعوة) | NOT_PRESENT | `mobile/app/` مفيهوش شاشة team (القائمة في §ملحق A)؛ التقارير: "Team-management UI: NOT DONE" | الـ API جاهز. |
| C12 | إيقاف/حذف عضو، تغيير دور، offboarding | **NOT_PRESENT** | `team.controller.ts`: invitations + entitlements + members (GET) + `PUT members/:id/warehouses` فقط؛ `user.entity.ts` مفيهوش `is_active/status` | مفيش طريقة لإزالة موظف سابق أو ترقيته/تنزيله **بعد** قبول الدعوة. فجوة حاكمة (ADR B). |
| C13 | Tenant/اشتراكات: plans وحدود | IMPLEMENTED_AND_TESTED (غير مُفعَّل) | `entitlements.service.ts` (`PLANS`: free 1/1، pro 3/3، business 15/10، enterprise ∞)، `ENTITLEMENTS_ENFORCED` افتراضياً off؛ `entitlements.pg.spec.ts` | بدون billing. الحدود: seats/warehouses/teamSharing فقط. |

### 1.2 الهوية والجلسات

| # | القدرة | التصنيف | الدليل | ملاحظة |
|---|---|---|---|---|
| A1 | Login + JWT access/refresh + lockout + 2FA TOTP (replay guard) | IMPLEMENTED_AND_TESTED | `auth.service.ts` (`generateTokens`: access 15m، refresh 7d؛ `secondFactorGate`)، `BruteForceService`، `TwoFactorService`؛ `auth.second-factor.spec.ts`، `two-factor.replay.pg.spec.ts`، `refresh-token.rotation.spec.ts` | |
| A2 | Google Sign-In | IMPLEMENTED_PARTIAL / UNVERIFIED على جهاز | `AuthService.googleLogin` + `FirebaseService.verifyGoogleIdToken`؛ `google-login.security.spec.ts` | مسار التحقق اتغيّر في Series 06 بدون فحص إبطال؛ ما اتجرّبش على جهاز. |
| A3 | SAML SSO | IMPLEMENTED_PARTIAL | `saml.controller.ts`، `saml.strategy.ts`، flag `SAML_ENABLED` | UNVERIFIED (مفيش اختبار مخصص مذكور). |
| A4 | **دور المستخدم يُقرأ من الـ JWT claim** | IMPLEMENTED (سلوك) | `generateTokens`: `payload = {sub, companyId, role}`؛ `JwtStrategy.validate` بيرجّع الـ claim فقط؛ `PermissionsGuard` بيستخدم `req.user.role` | تغيير الدور/الإزالة (حين تتوفر) مش بيسري قبل انتهاء الـ access token (15 دقيقة افتراضياً؛ 4 ساعات في اختبارات الجهاز). الـ warehouse scope بس بيتقرأ من DB. **(قراءة ثابتة)** |
| A5 | جلسة refresh واحدة لكل مستخدم | IMPLEMENTED (سلوك) / UNVERIFIED على جهازين | `users.refresh_token_hash` عمود واحد؛ `storeRefreshHash` | تسجيل دخول من جهاز تاني بيستبدل hash الجهاز الأول ← احتمال إن موظفين/أجهزة متعددة بنفس الحساب تفضل تقطع بعضها. **UNVERIFIED** (ما اتجرّبش جهازين). الموظفين الأفراد بهويات منفصلة = مخفّف جزئياً. |
| A6 | Revoke جلسات (logout / terminate-all / change-password) | IMPLEMENTED_AND_TESTED | `AuthController` (`logout`, `sessions/terminate-all`, `change-password`)، `refresh-token.rotation.spec.ts` | بيلغي الـ refresh فقط؛ الـ access بيفضل لحد انتهائه. |

### 1.3 المنتجات والوحدات والمواقع

| # | القدرة | التصنيف | الدليل | ملاحظة |
|---|---|---|---|---|
| P1 | منتجات (SKU، barcode، categories، soft delete) | IMPLEMENTED_AND_TESTED | `product.entity.ts`، `ProductController`، `ProductService`؛ unique `(company, sku)` | الكتالوج **على مستوى الشركة**: `GET /products` بيرجّع كل منتجات الشركة لأي حامل `VIEW_PRODUCT` (Staff كمان) بغض النظر عن مخازنه ← مفيش "إخفاء SKU غير مصرّح" (3.4). |
| P2 | **سعر التكلفة (`cost_price`)** | **IMPLEMENTED_PARTIAL + ثغرة خصوصية** | `product.entity.ts:54` (عمود text مشفّر بـ `encryptedColumn()`، اختبار `tests/unit/encrypted-column.spec.ts`)؛ `GetProductListHandler` → `ProductService.findAll` بيرجّع كيانات `Product` كاملة؛ لا `ClassSerializerInterceptor` ولا DTO حاجب؛ لا صلاحية `VIEW_COST` | التشفير على مستوى التخزين فقط. الـ transformer بيفكّ التشفير عند التحميل ← **على الأرجح أي دور فيه `VIEW_PRODUCT` (بما فيه Staff) بياخد `costPrice` في `GET /products` و`/products/:id`** **(قراءة ثابتة؛ مفيش اختبار runtime؛ ما اتأكدش بطلب فعلي)**. الإنشاء بيقبل `costPrice`؛ التعديل لا (`UpdateProductDto`). مخالف لمتطلب 3.4. |
| P3 | وحدات القياس والتعبئة (UOM) | IMPLEMENTED_PARTIAL | `unit-of-measure.entity.ts` (`conversion_factor_to_base`)، إنشاء مع المنتج (`ProductService.create`) | **الحركات كلها بالـ base quantity**: مفيش UOM على الحركة/الـ API؛ مفيش تحويل في الـ stock endpoints. |
| P4 | Lots/batches وserials | MOBILE_ONLY | `mobile/src/data/repositories.ts` (`Batch`, `Serial`)، `local-repositories.ts`؛ `ApiBatchRepository/ApiSerialRepository` بترجّع `[]`؛ backend: صفر | الوضع الأوفلاين المحلي فقط. FEFO/FIFO/LIFO محلي. |
| P5 | Zones/Stores/Storage units/Bins | MOBILE_ONLY (+ عيب) | `StoreRepository`، `StorageUnitRepository` (`pallet/rack/shelf/bin/carton/unit`) محلي؛ `ApiStoreRepository.create` بيعمل `POST /warehouses/:id/stores` — **مفيش route كده في `warehouse.controller.ts`** (مسارات: POST /, GET /, GET /:id, PATCH /:id, DELETE /:id) | الاستدعاء هيفشل 404 على السيرفر. عيب كامن (مش بيتنادى في تدفقات مختبَرة). |
| P6 | Reservations / available | IMPLEMENTED_PARTIAL | عمود `product_warehouse.reserved_quantity` (بيتحسب في `getChanges.availableQuantity`)؛ مفيش endpoint يكتبه؛ `ApiReservationRepository.create` = `NOT_SUPPORTED_ONLINE`؛ محلي بس | العمود جاهز كأساس لحجز مقابل طلبات موافقة (ADR D). |
| P7 | In-transit / quarantine / frozen | NOT_PRESENT | بحث `in_transit|quarantine` في `src/` = صفر؛ `FreezeStock/UnfreezeStock` معرّفة في `mobile/src/domain/events.ts` كـ **UNWIRED** | |

### 1.4 دفتر المخزون والحركات

| # | القدرة | التصنيف | الدليل | ملاحظة |
|---|---|---|---|---|
| L1 | دفتر حركات single-entry مع رصيد جاري | IMPLEMENTED_AND_TESTED | `stock_movements` (`quantity_change`, `running_balance`, `revision`)، `product_warehouse.base_quantity`، `StockService.applyMovementInTransaction` (قفل صف المخزون، فحص رصيد ≥ 0)؛ `stock.service.spec.ts`، `tenant-concurrency.pg.spec.ts` | **مش double-entry.** مفيش قيد دائن/مدين ولا حساب in-transit. **عدم سالبية الرصيد مفروضة بالتطبيق فقط:** بحث `CHECK` في `src/migrations` ما لقاش قيد على `product_warehouse` (القيود الوحيدة: دور الدعوة، plan، حالة الاشتراك). |
| L2 | عدم قابلية التعديل | IMPLEMENTED_PARTIAL | مفيش API يعدّل/يحذف حركة؛ **مفيش trigger ولا REVOKE** على `stock_movements` (التريجر الوحيد: ترقيم revision)؛ `onDelete: RESTRICT` على FK | Immutability بالاتفاقية + التطبيق، مش بقيد DB. |
| L3 | تحويل بين مخزنين | IMPLEMENTED_AND_TESTED (فوري) | `StockService.transfer`: ساقين في transaction واحدة تحت ترتيب أقفال ثابت، `reference_id` مشترك | **مفيش حالة وسيطة (in-transit)، مفيش استلام/تسليم/custody.** |
| L4 | تسوية/جرد (adjustment) | IMPLEMENTED_PARTIAL | `POST /stock/adjustment` (`STOCK_ADJUSTMENT`: Manager/Admin)، `AdjustmentDto.reason` → `notes` | مفيش stocktake كعملية (مفيش counting sessions)، مفيش اعتماد. |
| L5 | حقول المساءلة: initiator, approver, executor, recipient, purpose, reason code, order ref | **IMPLEMENTED_PARTIAL** | الموجود: `user_id` (المنفّذ المصادَق)، `notes`، `reference_type` ∈ {PURCHASE, SALE, COUNT, TRANSFER}، `reference_id` (uuid، للتحويل فقط)، `created_at` (وقت السيرفر) | الناقص: approver، recipient/counterparty، reason code، مرجع مستند/أمر، وقت جهاز الالتقاط (`captured_at`)، UOM، تقييم مالي. الـ mobile المحلي (`InventoryEvent`) فيه `approvedBy`، `reason`، `reference`، `costImpact` لكن ده محلي. |
| L6 | قيمة مالية/تقييم (valuation) | NOT_PRESENT | `stock_movements` مفيهوش أي عمود مالي؛ `dashboardStats` أونلاين = `null` | ولا دفتر أستاذ مالي (يفضل خارج النطاق). |
| L7 | Idempotency للكتابة | IMPLEMENTED_AND_TESTED | `stock_idempotency_keys` + `claimIdempotencyKey`؛ `shared-warehouse.pg.spec.ts` | |
| L8 | Revisions / sync cursor / anchors | IMPLEMENTED_AND_TESTED | `warehouses.stock_revision`، `getChanges`، `1792580000000` (trigger + unique)؛ `sync-cursor-reset.pg.spec.ts`، `release-safety.migration.pg.spec.ts` | |
| L9 | History generation + rotation | IMPLEMENTED_AND_TESTED (Series 07) | `1792590000000`، `HistoryGenerationService`، `recovery-integrity.pg.spec.ts` (32) | الـ marker بيتراجع مع restore (عقد S07 §6). |
| L10 | S1 تعويض آمن | IMPLEMENTED_AND_TESTED + device PARTIAL | `StockReplacementService`، `stock_replacements`، mobile `replacement.ts` | |
| L11 | مصالحة الإيصالات (outbox + lookup) | IMPLEMENTED_AND_TESTED + device | `outbox.ts`، `outbox-reconcile.ts`، `OperationLookupService` | |

### 1.5 التدقيق والمراقبة والإشعارات

| # | القدرة | التصنيف | الدليل | ملاحظة |
|---|---|---|---|---|
| U1 | Audit log لكل كتابة HTTP | IMPLEMENTED_AND_TESTED | `AuditLogInterceptor` (POST/PUT/PATCH/DELETE)، `AuditLogService.write`، قناع الحقول الحساسة (`maskSensitive`)؛ `audit-log.interceptor.spec.ts`، `audit-log.redaction.spec.ts` | **best-effort**: فشل الكتابة بيتبلع (`audit must never break the request flow`)، **مش في نفس transaction الحركة**، والـ lookup مستثنى (`@SkipAudit`). |
| U2 | سجل التدقيق append-only / hash chain / WORM | **NOT_PRESENT** | بحث `hash_chain|prev_hash|WORM` في `src/` = صفر؛ مفيش trigger على `audit_logs`. الموجود append-only فعلي: `history_generation_events` (UPDATE ممنوع بـ trigger) | الـ hash chain الوحيد في الريبو **محلي على الجهاز** للوضع الأوفلاين: `mobile/src/domain/event-hash.ts`، `docs/event-schema.md` — مش سلطة السيرفر. |
| U3 | قراءة سجل التدقيق من API/موبايل | NOT_PRESENT | `VIEW_AUDIT_LOG` معرّفة (Manager/Admin) لكن **مفيش controller بيقرأ `audit_logs`**؛ `ApiActivityRepository.list()` = `[]` | |
| U4 | نسبة العملية لموظف مصادَق | IMPLEMENTED_AND_TESTED | `stock_movements.user_id`؛ `MovementResponseDto.user {id,name}`؛ `GET /stock/changes` بيرجّع `userId` | الاسم في `/stock/movements/:productId` فقط. |
| U5 | Activity feed إداري عبر المخازن | NOT_PRESENT | لا endpoint؛ أقرب شيء: `GET /stock/changes/:warehouseId` لكل مخزن (cursor، `userId`، النوع، الكمية) | ممكن يكون أساس feed بالـ merge من العميل (ADR E). شاشة `mobile/app/activity.tsx` محلية. |
| U6 | Push notifications | IMPLEMENTED_PARTIAL | `FcmService.sendStockNotification(userId, …)` بتبعت **لأجهزة نفس المستخدم اللي نفّذ الحركة** مع `productId` و`quantity` في الـ payload؛ `NotificationsController.register-device` | مفيش إشعار للمدير بحركة موظف. **`@Roles(ADMIN, STAFF)` على register-device بيستثني Manager** (عيب كامن، قراءة ثابتة). الـ payload بيحمل ids/كميات (لا تكلفة). |
| U7 | Retention / revocation hygiene | IMPLEMENTED_PARTIAL | موبايل: `warehouse-sync.ts` بيمسح الكاش عند `denied`، إيصالات 7 أيام، `no-access` في الـ outbox؛ سيرفر: مفيش retention لـ `stock_idempotency_keys` ولا `audit_logs` (S5) | |

### 1.6 الموبايل: التنقل والتجربة

| # | القدرة | التصنيف | الدليل | ملاحظة |
|---|---|---|---|---|
| M1 | تنقل ثابت 5 تبويبات (Dashboard, Scan, Warehouses, Analytics, Settings) | IMPLEMENTED | `mobile/app/(tabs)/_layout.tsx` | **مش مبني على صلاحيات**: الدور بيتعرض في Settings بس (`settings.tsx:177`). Staff بيشوف أزرار إنشاء مخزن/منتج ويقابل 403 من السيرفر. |
| M2 | وضعين (offline محلي / online dev preview) | IMPLEMENTED | `operationMode`، `ONLINE_MODE_DEV_PREVIEW`؛ تبديل من Settings | الأونلاين **dev-preview فقط** (`__DEV__` + متغيرات). |
| M3 | Outbox + مراجعة + تعويض | IMPLEMENTED_AND_TESTED + device PARTIAL | Series 03–07 | استلام/صرف فقط في الـ outbox؛ transfer/adjustment أونلاين فقط. |
| M4 | باركود/مسح | MOBILE (محلي) / UNVERIFIED هذه السلسلة | `app/(tabs)/scan.tsx`، `products.barcode`؛ `ApiProductRepository.findByBarcode` بيحمّل القايمة كلها | |
| M5 | عربي/إنجليزي + RTL | IMPLEMENTED_PARTIAL | `mobile/src/i18n/locales/{ar,en}.json` + اختبار تطابق المفاتيح لمسار المراجعة | عربي على الجهاز: **UNVERIFIED** (مش اتجرّب في Series 07). لا component tests. |
| M6 | تحليلات/تقارير | NOT_PRESENT أونلاين | `ApiStockRepository.dashboardStats` = `{stockValue:null, pendingSyncCount:null}`؛ `GET /analytics/*` مش موجود | |
| M7 | AI (ask / reorder) | BACKEND_ONLY / UNVERIFIED | `ai.controller.ts` (`POST /ai/ask`, `GET /ai/reorder/:productId`)، `HuggingFaceService` | دقة وجودة غير مقاسة. لا ادّعاء ML. |

### 1.7 تكامل وبيئة

| # | القدرة | التصنيف | الدليل |
|---|---|---|---|
| E1 | Export/import، webhooks، API keys، تكامل ERP | NOT_PRESENT | قائمة الـ controllers: ai, auth, health, notifications, product, recovery, saml, stock, team, warehouse |
| E2 | Redis (cache/rate state) | IMPLEMENTED / UNVERIFIED حقيقي | `RedisService` يعطّل نفسه بدون `REDIS_URL`؛ `redis.service.resilience.spec.ts` (محاكاة) |
| E3 | TLS للقاعدة | **R12 مفتوح** | `app.module.ts:79` `ssl: { rejectUnauthorized: false }` لما `DB_SSL=true` |
| E4 | OCR / computer vision / forecasting / WORM / compliance | NOT_PRESENT | لا كود |

---

## 2. عيوب وملاحظات اتكشفت أثناء الجرد (للتوثيق، **من غير إصلاح**)

| # | الوصف | الخطورة | مستوى الدليل | الإجراء المقترح |
|---|---|---|---|---|
| D1 | `costPrice` بيتسلّم (مفكوك التشفير) لأي دور فيه `VIEW_PRODUCT` عبر `GET /products` | **عالية** (خصوصية مالية 3.4) | قراءة ثابتة (entity + service + handler، بلا serializer) — **اتأكد تشغيلياً في Series 09** (Staff استلم التكلفة في list وdetail) | Slice S0 في الـ roadmap: DTO حاجب + `VIEW_COST` + اختبار سلبي؛ **أول حاجة تتأكد بطلب فعلي** قبل الإصلاح. **✅ اتقفل في Series 09 (S0):** allowlist DTO + `item.view_cost` (Admin فقط افتراضياً) + NT-12؛ الدليل `series09-evidence/s0-{before,after}-fix.json` |
| D2 | مفيش إيقاف/إزالة عضو ولا تغيير دور | عالية (Governance) | قراءة ثابتة (controller + entity) | S1. **✅ اتقفل في Series 09 (S1):** suspend/reactivate/remove/revoke-sessions/role change + `membership_events` + Team screen |
| D3 | الدور من الـ JWT claim (نافذة ≤ 15 دقيقة) + الـ access token ما بيتأكدش من وجود المستخدم | متوسطة | قراءة ثابتة | S1: `status` + `token_version` أو lookup كل طلب. **✅ اتقفل في Series 09 (S1):** lookup بالـ PK كل طلب (status، `token_version`، الشركة، **الدور من الصف**) + فحص `FOR SHARE` جوه transaction الكتابة؛ +0.33 ms وسيط محلياً |
| D4 | الكتالوج company-wide لكل الأدوار | متوسطة (3.4) | قراءة ثابتة | قرار منتج: كتالوج مشترك مقبول أم scoping بالـ SKU؟ (Q-04) |
| D5 | `ApiStoreRepository.create` → endpoint مش موجود | منخفضة | قراءة ثابتة | يتصلح مع تصميم locations |
| D6 | `register-device` بيستثني Manager (`@Roles(ADMIN, STAFF)`) | منخفضة-متوسطة | قراءة ثابتة | S3 (الإشعارات) |
| D7 | refresh token واحد لكل مستخدم | متوسطة لو الأجهزة المتعددة بنفس الحساب | قراءة ثابتة، UNVERIFIED على جهازين | جلسات per-device (ADR B) أو التحقق على جهازين |
| D8 | audit best-effort وخارج transaction الحركة | متوسطة (evidentiary) | قراءة ثابتة | ADR G |
| D9 | `VIEW_AUDIT_LOG` بلا endpoint | منخفضة | قراءة ثابتة | S3/S4 |
| **D10** | **(جديد، Series 09)** `audit_logs` كانت بتخزّن `costPrice` بالنص الصريح (request + response لـ create/update/image) — بيكسر تشفير التخزين لأي قارئ للـ audit | **عالية** | **مُثبت تشغيلياً** (4 صفوف في الاختبار) | **✅ الكتابة الجديدة اتقفلت (S0):** redaction في الـ interceptor وفي الـ sink. **الصفوف القديمة لسه ممكن تحتوي القيمة** في أي بيئة اشتغلت بالإصدار القديم — تنظيف مشغّل منفصل (غير منفّذ، يحتاج تفويض) |

---

## 3. ملحق A — مسارات الموبايل الحالية (`mobile/app`)

`(auth)/accept-invitation, login, register` · `(onboarding)/language, mode, offline-start` · `(tabs)/index, scan, warehouses, analytics, settings` · `activity` · `crash-reports` · `help` · `movement/[productId]` · `outbox` · `outbox-review` · `product/[productId], new` · `products` · `store/[storeId]` · `warehouse/[warehouseId], new`. **مفيش:** team، approvals، transfers، stocktake، reports.

## 4. ملحق B — الاختبارات المرجعية (Series 07، `b3d824f`)

Backend PG ×3: **51/51 suites، 347/347**؛ Mobile Jest **16/16، 252/252**؛ جهاز واحد (تدفق S1/S2 PARTIAL). لا تُنسب هذه النتايج لأي كود بعد `b3d824f`، ولا لـ Series 08 (توثيق فقط).

---

## 4. تحديث حالة الصفوف بعد Series 09 و10 (الكود هو المرجع؛ هذا ملخص)

| الصف | الحالة الجديدة | الدليل |
|---|---|---|
| C3 Owner منفصل عن Admin | **IMPLEMENTED_AND_TESTED** (Series 09): `users.is_owner`، backfill بدليل "Admin واحد"، trigger آخر owner، سياسة owner-only على Admins | `1792600000000`، `membership-policy.ts`، `access-lifecycle.pg.spec.ts` |
| C6 Manager مقيّد بمخازن | **حُلّ بإضافة لا بتغيير** (Series 10): `Manager` يفضل شركة-كلها؛ **`warehouse_manager`** = Staff + grant بنطاق مخازن، تحت `CAPABILITY_MODE=enforce` فقط | `capability-evaluator.ts`، `scoped-access.pg.spec.ts` |
| C7 منح مخازن | **IMPLEMENTED_AND_TESTED** + profiles: `operator` (= القديم حرفياً، parity مُثبت) و`warehouse_manager`؛ الإدارة عبر `PUT /team/members/:id/access` بإصدار تفاؤلي، anti-escalation، أحداث | `access-grant.service.ts` |
| C8 تحويل: تفويض الطرفين | يفضل، وبقى **داخل الـ transaction** كمان وللـ scoped manager (المصدر والوجهة الاتنين) | `actor-guard.ts`، A6 |
| C9 CP-4 | **IMPLEMENTED (backend + mobile)**: لا منح تلقائي؛ `initialAccess` ذرّي عند الإنشاء؛ غير المخوّل = 403 والمخزن لا يُنشأ؛ إرشاد في الواجهة | `warehouse.service.ts`، `warehouse/new.tsx` |
| C11 إدارة الفريق على الموبايل | **IMPLEMENTED (منطق + شاشات، بدون جهاز)**: قائمة، إجراءات العضو، شاشة صلاحيات المخازن | `team.tsx`، `team-access.tsx` |
| C12 offboarding / تغيير دور | **IMPLEMENTED_AND_TESTED** (Series 09) | `membership.service.ts` |
| A4 الدور من الـ claim | **اتقفل** (Series 09): الدور والحالة من الـ DB كل طلب | `jwt.strategy.ts` |
| M1 تنقل ثابت | **متكيّف** (Series 10) أونلاين: tabs/أزرار حسب `GET /me/capabilities`؛ أوفلاين كامل (بيانات العضو نفسه) | `useCapabilities.ts`، `capabilities.ts` |
| P2 التكلفة | **اتقفل** (Series 09)؛ `item.set_cost` **موثّق وغير منفَّذ** (Series 10 contract §10) | — |
| **D11 (جديد، Series 10)** | عكس ترتيب أقفال بين **التعويض** (عضو ثم company) و**تغيير العضوية** (company ثم عضو) كان كامناً من Series 09 (deadlock نادر)؛ ثم تجويع `FOR UPDATE` خلف `FOR SHARE` متداخل ظهر في اختبار الضغط | اتقفلا بقفل العضو العادل والترتيب الموحّد (contract §9) |
