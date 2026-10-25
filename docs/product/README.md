# docs/product — فهرس وثائق المنتج والمعمارية (Series 08)

> **تحديث Series 09:** اتنفّذت **S0** (إغلاق تسريب التكلفة، D1 + D10) و**S1** (دورة حياة الأعضاء + إبطال فوري، D2 + D3) — راجع `docs/handoff/SERIES_09_ACCESS_FOUNDATION_REPORT.md` و`SERIES_09_AUTHORIZATION_AND_PRIVACY_CONTRACT.md`. باقي الشرائح (S2–S9) ما اتنفّذتش. الوثائق دي لسه مرجع التصميم؛ حالة التنفيذ في صفوف المصفوفة والـ roadmap.

> **حالة الحزمة:** توثيق وتخطيط فقط. **ولا سطر كود/migration/اعتماديات اتغيّر.** لا تفويض بتنفيذ أي شريحة.
> أُخذت الأدلة من الكود في `dc4ff4d` (آخر كود مُختبَر `b3d824f`). **ما اتشغّلش اختبارات جديدة في Series 08**؛ نتايج Series 07 منسوبة لـ `b3d824f` فقط.

## من هو المرجع لكل موضوع (authoritative)

| الموضوع | الوثيقة المرجعية |
|---|---|
| **اللي موجود فعلاً** (كود، اختبارات، عيوب مكتشفة D1–D9) | `STOCKMIND_CODE_TO_CAPABILITY_GAP_MATRIX.md` |
| الرؤية، تصنيف المقترحات (ADOPT/MODIFY/DEFER/REJECT)، ICP، tiers، KPIs، الفرضيات | `STOCKMIND_PRODUCT_BIBLE_V2.md` |
| الهرم التنظيمي، الأدوار، الصلاحيات، الخصوصية، revocation، CP-4، الاختبارات السلبية NT | `STOCKMIND_ORGANIZATION_RBAC_SPEC.md` |
| الحركات، الموافقات، العهدة، الـ 12 workflow، قواعد الحسم، `domain_events` | `STOCKMIND_MOVEMENT_GOVERNANCE_SPEC.md` |
| التنقل، الرحلات الخمس، معجم الحالات، رؤية المدير، الـ design system، اختبار الاستخدام | `STOCKMIND_ENTERPRISE_UX_BLUEPRINT.md` |
| القرارات المعمارية A–J، البدائل، المقايضات، **قرارات الـ Director المعلّقة Q-01..Q-18** | `STOCKMIND_ARCHITECTURE_DECISIONS.md` |
| الشرائح S0–S9، الاعتماد، بوابات القبول، Milestone R، سجل عوائق Production، **الـ milestone التنفيذي التالي** | `STOCKMIND_IMPLEMENTATION_ROADMAP.md` |

## وثائق سابقة ذات صلة (docs/handoff)
`STOCKMIND_AI_BRIDGE.md` · `STOCKMIND_AI_CONTINUITY.md` · `SERIES_07_RECOVERY_CONTRACT.md` (ضمانات وحدود S1/S2) · `SERIES_07_RECOVERY_INTEGRITY_REPORT.md` · `SERIES_06_*` · `STOCKMIND_DATABASE_RECOVERY_RUNBOOK.md` (v0.3).

## اصطلاحات الإحالة
`GM:<id>` = صف في مصفوفة الفجوات · `D<n>` = عيب مكتشف · `NT-<n>` = اختبار سلبي مطلوب · `Q-<n>` = قرار Director معلّق · `S<n>` = شريحة تنفيذ · `R-<n>` = عائق Production · `ADR-<A..J>`.

## عند التعارض
الكود وحالة Git أقوى من أي وثيقة هنا. وثيقة "اللي موجود" (المصفوفة) أقوى من "المقترح". والتفاصيل التقنية للاسترداد = عقد Series 07.
