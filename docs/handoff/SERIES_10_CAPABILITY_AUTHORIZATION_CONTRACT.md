# STOCKMIND — SERIES 10 CAPABILITY & AUTHORIZATION CONTRACT (S2)

> عقد تقني (DB + API + سلوك العميل) لـ **S2: Capability Profiles, Scoped Grants, Adaptive Navigation, CP-4**.
> الحالة: **منفَّذ ومختبَر على بيئة تطوير فقط** (PostgreSQL 15 مؤقتة، بيانات synthetic، بدون جهاز). **Production = NO-GO.**
> الكود هو المرجع؛ الملف ده بيوصفه. كل جملة "مضمون" ليها اختبار مذكور في §13. بيبني على `SERIES_09_AUTHORIZATION_AND_PRIVACY_CONTRACT.md` (لا يلغيه).
> **ملاحظة تصنيف:** البنود المعلّمة **[سياسة]** قرارات Director معتمدة **ولم تُنفَّذ**؛ البنود المعلّمة **[منفَّذ]** موجودة في الكود ومختبرة.

---

## 1. النموذج في خمسة أسطر

1. **القدرة (capability)** = اسم صلاحية واحد (نفس namespace الصلاحيات الحالية). الجديد: قدرة تشغيلية ممكن تتحمل **لمخزن واحد** بدل الشركة كلها.
2. **Profile** = حزمة قدرات بإصدار ثابت: `operator v1` (= سلوك Staff الحالي بالظبط) و`warehouse_manager v1` (operator + تسويات + تحويلات + تعديل بيانات المخزن). الإصدار **immutable**؛ التغيير = إصدار جديد.
3. **Grant** = (عضو، profile، مخزن، مدة، من منح ولماذا، سحب). `warehouse_access` القديم **مش بيتنسخ**: كل صف فيه = grant ضمني `operator` (dual-read).
4. **Engine** = مقيِّم نقي (`capability-evaluator.ts`) بنظرتين لنفس البيانات: `legacy` (القرار قبل Series 10 بالظبط) و`scoped` (النموذج الجديد). `CAPABILITY_MODE=off|shadow|enforce` بيحدد مين بيقرر.
5. **التفويض داخل الـ transaction**: كتابة المخزون والتعويض والتدوير بتعيد قراءة دور العضو ومنحه تحت **قفل العضو**، فتغيير صلاحية commit-ed قبل الكتابة بيرفضها، وتغيير في الطريق بيستنى لحد ما الكتابة تخلص.

---

## 2. تغييرات الـ DB (migration واحدة، additive): `1792610000000-ScopedAccess`

| العنصر | الوصف |
|---|---|
| `users UNIQUE (id, company_id)` و`warehouses UNIQUE (id, company_id)` | عشان الـ foreign keys المركّبة تمنع ربط عضو شركة بمخزن شركة تانية. |
| `permission_profiles` | `(company_id NULL للنظامية, key, version, label_key, capabilities text[], is_system, retired_at)`. صفّان نظاميان بيتزرعوا في الـ migration (literals مقصودة؛ اختبار drift بيقارنهم بثوابت التطبيق). Trigger: تغيير `capabilities/key/version/label/is_system/company` مرفوض، وحذف النظامي مرفوض؛ التغيير الوحيد المسموح `retired_at`. |
| `access_grants` | `(company_id, user_id, profile_id, scope_type='warehouse', scope_id, valid_from, valid_until, granted_by, reason, revoked_at/by, revoke_reason)`. FKs مركّبة `(user_id, company_id)` و`(scope_id, company_id)`. Unique جزئي: **grant نشط واحد لكل (عضو، مخزن)**. Trigger: هوية الـ grant لا تتغير (يتسحب بس)، والمسحوب نهائي، وprofile شركة تانية مرفوض. |
| `access_grant_events` | append-only (trigger على UPDATE): `grant | revoke | replace`، الـ actor، العضو، المخزن، الـ profile قبل/بعد، `source ∈ api | legacy_api | membership | warehouse_create`، السبب. بيتكتب **في نفس الـ transaction** بتاع التغيير. |
| `down()` | **fail-closed**: بيرفض لو في grant أو event أو profile مخصّص. `warehouse_access` مش بيتلمس. |

الـ migrations بقت **12**. لا تغيير في أي migration سابقة. اعتماديات: **صفر**. `roles/permissions/user_roles/role_permissions` القديمة **مجمّدة وشغّالة** (تستخدم لتفويض مالي صريح، §10).

### Compatibility / A8
`warehouse_access` يفضل المخزن الوحيد لتخصيصات `operator`؛ المحرك بيقرأها كـ grants ضمنية. **اختبار** على بيانات الـ production المعاد بناؤها (6 أعضاء + شركتين): نطاق كل عضو في النموذج الجديد = نتيجة الاستعلام القديم حرفياً، ونتيجة النظرة `legacy` = الاستعلام القديم.

---

## 3. الـ Profiles: ما تقدر وما لا تقدر عليه **[منفَّذ]**

| | `operator v1` | `warehouse_manager v1` |
|---|---|---|
| عرض المخزن / الأرصدة / حركاته | ✔ | ✔ |
| استلام / صرف | ✔ | ✔ |
| تسوية جرد (`STOCK_ADJUSTMENT`) | ✘ | ✔ على مخازنه |
| تحويل (`STOCK_TRANSFER`) | ✘ | ✔ **والمصدر والوجهة الاتنين لازم يكونوا في منحه** |
| تعديل بيانات المخزن (`UPDATE_WAREHOUSE`) | ✘ | ✔ على مخازنه |
| إنشاء/حذف مخزن، كتالوج المنتجات (كتابة)، إدارة الفريق، recovery، audit، **رؤية التكلفة** | ✘ | ✘ |
| يشتغل بدون تفعيل المحرك | ✔ | ✘ (`requiresEnforcement`) |

- الـ profile **لا يقدر** يحمل قدرة تنظيمية أو مالية حتى لو اتكتبت في صفّه: المقيِّم بيحذف أي قدرة مش "warehouse-level" (`NEVER_FROM_A_GRANT`) وأي قدرة مش في الكتالوج (A1). اختبار tamper.
- **الهوية:** `warehouse_manager` = دور الأساس **Staff** + grant. **مش** دور `Manager` العالمي (اللي يفضل شركة-كلها كما هو، A2). `@Roles` الوحيد في الكود (`notifications/register-device` = `ADMIN, STAFF`) بيعدّي Staff، فمفيش تعارض؛ ومفيش مكان اتحلّ فيه تعارض بمنح دور Manager.

---

## 4. قواعد المقيِّم **[منفَّذ]** (`can`, `canAll`, `warehouseScope`, `mayGrantProfile`)

- **Default deny (A1):** قدرة مجهولة، عضو غير نشط، دور غير معروف، grant مسحوب/منتهي/لسه مبدأش/profile مسحوب (`retired_at`)/profile شركة تانية ← "لا".
- **Admin** = كل القدرات. **Manager** = قدرات دوره الافتراضية + أي ربط قديم، على **كل** المخازن (دلالات الشركة-كلها لم تتغير). **Staff** = قدرات الأساس (`VIEW_PRODUCT`…) + قدرات المخزن من الـ grants.
- قدرة مخزن **بدون** مخزن مسمّى (list endpoints): تُمنح لو Staff-base فيها أو أي grant فيها؛ والبيانات بتتفلتر بالنطاق بعد كده.
- **التحويل:** `canAll` على المصدر والوجهة؛ فشل واحد = رفض بدون ذكر الآخر.
- **No escalation (A4):** `mayGrantProfile`: المانح لازم يملك **كل** قدرة في الـ profile على نفس المخزن (Admin يملك الكل)، والـ profile الفاضي أو التنظيمي مش منحة.

---

## 5. وضع المحرك، الـ shadow، والرجوع **[منفَّذ]**

`CAPABILITY_MODE` (بتتقرأ **كل طلب**؛ القيمة غير المعروفة = `off`؛ الافتراضي `shadow`):

| الوضع | من يقرر | ماذا يحدث |
|---|---|---|
| `off` | القديم فقط | لا شيء جديد يشتغل. |
| `shadow` | **القديم** | الجديد بيتحسب بجانبه ويتسجّل الفرق في `CapabilityShadowService` (عدادات + آخر 50 فرق، في الذاكرة، بدون بيانات الطلب). فرق "مقصود" = grant مخصّص أعطى شيئاً مش عند القديم؛ **أي نقص عن القديم أو فرق على persona قديم = غير مقصود** وبيتسجل warning. خطأ في الحساب مش بيغيّر الإجابة. |
| `enforce` | **الجديد** | PermissionsGuard وWarehouseAccessService وـ in-transaction بيستخدموا النموذج الجديد. خطأ تقييم = **رفض** (fail closed). عدم وجود نتيجة = رفض. |

- **الرجوع:** تغيير المتغيّر فقط. مفيش بيانات بتتمسح؛ الـ grants المخصّصة بتفضل لكن **مالهاش أثر** خارج `enforce` (A1).
- **A9 / لا تحكّم وهمي:** `GET /team/access-profiles` بيقول `available` لكل profile؛ و`PUT .../access` بيرفض `warehouse_manager` خارج `enforce` بـ `409 PROFILE_NOT_ENFORCED` (ولا بيكتب حاجة). `GET /me/capabilities` بيوصف **السلطة الفعلية**: خارج `enforce` بيرجّع نظرة `legacy`.
- **التفعيل (توصية، مش تفويض):** مفيش تفعيل عالمي في الكود. الافتراضي `shadow`. `enforce` للتطوير/الاختبار المحكوم فقط لحد قرار Director؛ شرط: صفر فروق غير مقصودة على بيانات حقيقية غير إنتاجية + مراجعة.

---

## 6. نقاط التنفيذ (Enforcement points)

| الطبقة | المكان | الدور |
|---|---|---|
| عملية (قدرة) | `PermissionsGuard` (class-level على Product/Warehouse/Stock/Team/AI/Recovery) | قدرة ∧ (لو الطلب بيسمّي مخزن) نطاقه. `enforce`: مخزن خارج النطاق = **404 مطابق لمخزن مش موجود**؛ قدرة ناقصة = 403. |
| نطاق | `WarehouseAccessGuard` + `WarehouseAccessService.scope()` | نفس المصدر لـ: `GET /warehouses`، تاريخ الحركات، `operations/lookup`، `changes`. |
| داخل الـ transaction | `assertActorAuthorized` في `executeMovement/applyMovementInTransaction`، `transfer`، `StockReplacementService.assertAccess`، `HistoryGenerationService.rotate` | القدرة المناسبة لنوع الحركة على المخزن (وعلى الاتنين للتحويل)، أو `MANAGE_RECOVERY` للتدوير. |
| إدارة المنح | `AccessGrantService` | `MANAGE_USERS` + anti-escalation + لا ذاتي. |

غير مغطّى عمداً: الكتالوج company-wide (قرار Q-04)، `AI` (قدرات تنظيمية بلا بيانات مخازن)، `VIEW_AUDIT_LOG` (بلا endpoint أصلاً).

---

## 7. إدارة المنح و CP-4 **[منفَّذ]**

- `GET /team/access-profiles` · `GET /team/members/:id/access` (التخصيصات الحالية + `version` + `applicable` + الـ profiles) · `PUT /team/members/:id/access` `{assignments:[{warehouseId, profile}], expectedVersion?, reason?}` (استبدال المجموعة كلها) · `GET /team/members/:id/access/events`. كلها `MANAGE_USERS`.
- **معاملة واحدة:** `pg_advisory_xact_lock(member)` (حصري) ثم صف العضو `FOR UPDATE`، ثم التغيير والأدلة. تتكرّر الكتابة بـ `expectedVersion`: تعديلين متزامنين على نفس العضو = واحد ينجح والتاني `409 ACCESS_VERSION_CONFLICT` (اختبار).
- **قواعد:** الهدف Staff فقط (`ACCESS_NOT_APPLICABLE` لـ Admin/Manager)؛ مش مُزال (`TARGET_NOT_ACTIVE`)؛ لا ذاتي (`CANNOT_MODIFY_SELF`)؛ مخزن مكرر/مجهول/شركة تانية = 400/404؛ profile مجهول = `UNKNOWN_PROFILE`؛ `GRANT_EXCEEDS_AUTHORITY` (403) لو المانح لا يملك قدرات الـ profile على المخزن.
- **الأثر على المسارات القديمة:** `PUT /team/members/:id/warehouses` (القديم) يشتغل زي ما هو، بس بقى يقفل العضو ويسجّل events (`legacy_api`) ويتجنب صف `operator` مكرر لمخزن عليه grant أقوى. الدعوات كما هي.
- **تغيير عضوية:** الإزالة وأي تغيير دور بيسحبوا grants المخصّصة (events `membership`) فمفيش grant بيرجع بعد تخفيض لاحق (اختبار).
- **CP-4 [منفَّذ]:** مخزن جديد = **لا أحد من Staff** (لا منح تلقائي). `POST /warehouses` بيقبل `initialAccess:[{userId, profile}]` اختياري، **ذرّي** مع إنشاء المخزن: غير مصرّح له (Manager بدون `MANAGE_USERS`) = `403 ACCESS_GRANT_NOT_PERMITTED` **والمخزن مش بيتعمل**؛ تخصيص غير صالح = الـ rollback كامل. الموبايل بيعرض قسم "مين ياخد الصلاحية؟" للي يقدر فقط، وغيره بيشوف إرشاد بدل تحكّم مش شغّال.

---

## 8. `GET /me/capabilities` **[منفَّذ]**

يرجّع: `engine {mode, enforced, version}` · `accessVersion` (بصمة تتغير بالظبط لما تتغير السلطة) · `ttlSeconds` (300؛ للـ UI فقط) · `membership {status, role, isOwner}` · `capabilities {organization[], financial.viewCost, team.manage}` · `warehouses {all, items[{id, name, capabilities[], profiles[]}]}`.
- **لا يكشف:** مخازن خارج النطاق (لا id ولا اسم)، منح الآخرين، قيم التكلفة، أي secrets.
- **Cache:** `Cache-Control: no-store` و`Vary: Authorization`؛ الجسم بيتحسب من الـ DB كل مرة؛ 304 ممكن **فقط** لو الجسم الجديد مطابق حرفياً (اختبار: تغيّر منحة ← 200 مش 304).
- مش بديل عن تفويض الـ endpoints: نسخة قديمة/معدّلة على الجهاز بتخفي/تظهر زر، ما بتمنحش حاجة.

---

## 9. التفويض داخل الـ transaction وقفل العضو (A5/A6) **[منفَّذ]**

**البروتوكول:** أي شيء بيغيّر سلطة عضو (دور/حالة/grants) بياخد **قفل العضو** حصرياً (`pg_advisory_xact_lock(hashtextextended('stockmind:member:'||id))`) ثم صف العضو `FOR UPDATE`؛ أي كتابة معتمدة على السلطة دي بتاخد نفس القفل **shared** ثم صف العضو `FOR SHARE` **أول حاجة في الـ transaction**، وبعدين بتقرأ الدور والمنح وتقيّم (`assertActorAuthorized`).
**النتيجة:** تغيير committed قبل الكتابة ← الكتابة ترفض (404/403)؛ كتابة جارية ← التغيير يستنى لحد commit الكتابة. **مفيش كتابة جديدة بعد commit السحب.** العمليات اللي اتعملها commit قبل السحب **بتفضل** (مش بتتلغي).
**ترتيب الأقفال:** company row ← قفل العضو (هدف) ← صفوف الأعضاء (بالـ id) ← المخازن (بالـ id). (التعويض بياخد company `FOR SHARE` قبل قفل العضو؛ الإجراءات العضوية `FOR UPDATE`).

**ليه advisory وليس row lock فقط (اكتشاف):**
1. `FOR UPDATE` على صف العضو ممكن **يتجوّع** (starve) خلف سيل `FOR SHARE` متداخل من كتابات نفس العضو؛ قفل advisory بيمشي بطابور عادل. (ظهر كتجمّد في اختبار الضغط قبل الإصلاح.)
2. إدخال مفتاح الـ idempotency بيعمل `KEY SHARE` على صف العضو عبر الـ FK، فلو القفل مش أول خطوة بيحصل **deadlock** مع سحب منتظر. اتصلح بجعل قفل العضو أول خطوة، وتم قياس **صفر deadlocks** في الضغط.
3. **عيب كامن من Series 09 اتقفل:** كان في عكس ترتيب أقفال بين التعويض (عضو ثم company) وتغيير العضوية (company ثم عضو)؛ التعويض دلوقتي بياخد company الأول.
- **حدود:** مفيش ادّعاء إلغاء لحظي لعملية بدأت وcommitted؛ القفل بيتحمّل الطابور (القياس §13)؛ الـ lock per-member (مش company-wide) فمفيش تسلسل بين أعضاء مختلفين.

---

## 10. المالي: `item.view_cost` و`item.set_cost` **[سياسة + منفَّذ جزئياً]**

- **[منفَّذ]** A7: لا profile مخزن ولا Manager ولا Staff بيحصل على `item.view_cost`. تفويض صريح بيتم **بدور مخصّص** (الجداول القديمة: `roles/role_permissions/user_roles`) وهو **على مستوى الشركة** وليس مخزن؛ و`/me/capabilities` بيقول `financial.viewCost` بصدق. **ممنوع وصفه كنطاق مخزن.** اختبار.
- **[سياسة R-20]** deny-by-default للـ Manager/Staff/warehouse_manager؛ منح صريح بمبادئ: مستقل، قابل للسحب، مُراجَع، لا ترقية لـ Admin. **غير منفَّذ بعد:** صلاحية مالية بنطاق مخزن (تحتاج تصميم؛ الحماية اللي تحت §4 تمنعها من أي profile).
- **`item.set_cost` (غير منفَّذ، موثّق):** الواقع الحالي: `CREATE_PRODUCT` (Admin + Manager) بتقبل `costPrice` عند الإنشاء ولا ترجّعه للـ Manager (Series 09)، و`PATCH` لا يقبله. **التصميم المقترح للـ S3+:** قدرة تنظيمية `item.set_cost` (افتراضي Admin) **غير قابلة للمنح بنطاق مخزن**. **الهجرة بدون كسر صامت:** (أ) إصدار انتقالي: Manager يفضل يكتب عند الإنشاء ويتسجّل `audit` بإن الكتابة جاءت بدون القدرة؛ (ب) إشعار العملاء؛ (ج) بعد نافذة معلنة، الطلب اللي فيه `costPrice` من حامل بلا القدرة = `403 COST_WRITE_NOT_PERMITTED` **صريح** (لا قبول وتجاهل صامت لأنه فقد بيانات). **ما اتغيّرش في Series 10:** سلوك `POST /products` كما هو (اختبار NT-12 + Manager create).

---

## 11. العميل (الموبايل) **[منفَّذ؛ اختبارات منطقية فقط، لا جهاز]**

- `useCapabilityRuntime`: snapshot في الذاكرة فقط؛ جلب عند بدء الجلسة، **عند كل عودة للتطبيق**، وعند أي 403/404 على `/stock|/warehouses|/team` (signal مدمج min 2s)؛ بيتمسح عند sign-out وتبديل الحساب. لو `accessVersion` اتغير ← `invalidateQueries` (مش مسح للـ outbox).
- التنقل: tabs `scan`/`analytics` بتختفي (`href:null`) لو مفيش ما يخدمها؛ Warehouses تفضل مع **حالة فارغة مشروحة** ("لسه مفيش مخزن متاح ليك"). زر الفريق = `team.manage`. أزرار: إضافة منتج، إضافة مخزن، حذف/حفظ المنتج، التحويل، حقل التكلفة = حسب القدرة. **أوفلاين (الجرد المحلي): كل شيء متاح (بيانات العضو نفسه).**
- شاشة `team-access`: صف لكل مخزن بـ (بدون / موظف مخزن / مسؤول مخزن)، شرح كل profile بالكلام قبل الحفظ، "N تغيير مستني"، profile مش شغّال على السيرفر معروض ومعطّل، `expectedVersion` ومعالجة 409.
- **A10:** عمليات outbox المتأخرة بيحكم فيها السيرفر وقت الإرسال: فقدان المخزن ← 404 ← `REJECTED/no-access` (مفيش إعادة تلقائية)، ومفتاح الـ idempotency **ما بيتحرقش** بالرفض فبعد إعادة المنح نفس الطلب بيتنفّذ مرة واحدة (اختبار HTTP). ما فيش ادّعاء إن السيرفر يمسح بيانات من جهاز غير متصل.
- **اختبار الجهاز: DEFERRED — DIRECTOR PHYSICAL ACCESS REQUIRED.** ولا نتيجة emulator استُخدمت.

---

## 12. سياسات Director (R-18/R-19/R-20) — مفصولة عن الوظائف **[سياسة]**

| | القرار | الحالة |
|---|---|---|
| R-18 `audit_logs` القديمة | تنظيف محكوم مُعتمد مبدئياً (redaction بدون حذف سجلات، backup + dry-run + تحقق + audit للتنفيذ، حماية النسخ الأصلية، لا ادعاء tamper-proof) | **غير منفَّذ**، تنفيذه على Production/Neon **محجوب**، ومهمة تشغيلية منفصلة. |
| R-19 ملكية legacy | backfill "Admin واحد" يفضل؛ الغامض يحتاج دليل موثوق وقرار مشغّل بتحقق مستقل؛ لا اختيار تلقائي ولا ذاتي؛ نقل الملكية workflow مستقبلي بـ MFA حديث | **غير منفَّذ** (لا backfill إنتاجي ولا SQL إنتاجي). السلوك الحالي: fail-closed. |
| R-20 التكلفة | موضح في §10 | رفض افتراضي **منفَّذ**؛ نطاق مخزن مالي غير منفَّذ. |

---

## 13. خريطة الاختبارات (كل "مضمون" ← اختبار)

| الضمان | الاختبار |
|---|---|
| A1/A2/A3/A4/A7 نقياً: parity لكل persona × قدرة × مخزن، tamper، anti-escalation، mode | `tests/unit/capability-evaluator.spec.ts` |
| Schema: تطابق الـ literals مع الثوابت، parity نطاق الأعضاء على بيانات legacy، tenant-safe FKs، immutability، أحداث append-only، down() fail-closed | `tests/integration/release-safety.migration.pg.spec.ts` |
| A3 (قوائم/مخزن مباشر/رصيد/sync/lookup/replacement/تحويل/404 مطابق)، A2 للـ Manager والـ Staff، A4 (Staff/Manager/scoped/مفوَّض)، A5، A7، A9 (`/me/capabilities`)، CP-4، tenant، A6 (3 سيناريوهات + ضغط بلا deadlock)، A10 | `tests/integration/scoped-access.pg.spec.ts` (`CAPABILITY_MODE=enforce`) |
| shadow/off/enforce: صفر فروق غير مقصودة، فرق مقصود لمنحة مخصّصة، رفض profile بلا أثر، fail-closed | `tests/integration/capability-shadow.pg.spec.ts` |
| قياس الأداء والتنافس | `tests/integration/capability-perf.pg.spec.ts` ← `series10-evidence/s2-perf.json` |
| الموبايل: `can`/التنقل/الحالة الفارغة/fallback/diff/تخصيصات/signal، وعقد الـ UI (قدرات ومفاتيح i18n حقيقية)، وأسماء القدرات ⊆ كتالوج السيرفر | `mobile/src/domain/capabilities.test.ts`, `ui-contract.test.ts`, `team-actions.test.ts` + `tests/unit/capability-evaluator.spec.ts` (A9 cross-contract) |
| Negative controls (backend + mobile) | `series10-evidence/negative-controls*.txt` |

## 14. غير منفَّذ عمداً (خارج التفويض)

موافقات، dashboard حي، عهدة، محاسبة، profiles مخصّصة من الشركة، منح مؤقتة بواجهة (الـ schema يدعم `valid_until` والمحرك بيحترمه؛ مفيش API لتعيينه)، مخزن/موقع داخلي، صلاحية مالية بنطاق مخزن، `item.set_cost` كقدرة، تفعيل `enforce` افتراضياً، تنظيف audit، نقل ملكية، step-up، واجهة تاريخ أحداث المنح على الموبايل (الـ API موجود).
