# Series 13 — N-1 reproduction and fix evidence (real PostgreSQL 15.19, synthetic data)

Spec: `tests/integration/owner-guard-lock-order.pg.spec.ts` (real HTTP, real `AppModule`, `CAPABILITY_MODE` default `shadow`,
`deadlock_timeout = 1s`). Raw observations: `n1-before-fix.jsonl`, `n1-seat-before-fix.jsonl` (Series 12 code `6df3ec9` + the new spec, and for the seat file the new
guard without the seat lock), `n1-after-fix.jsonl` (after `1792620000000` + seat lock). Full logs: `_local-tools\logs\stockmind_gate_s13_n1_before.log`,
`stockmind_gate_s13_seat_before.log`, `stockmind_gate_s13_n1_after2.log`.

**How each scenario is made deterministic:** the TEST holds the target owner's member row `FOR SHARE` (what an in-flight write of
that member holds). The suspension then parks at its member-row `FOR UPDATE`, i.e. AFTER it holds the target's member authority
lock (exclusive). The owner's own write (or grant) is fired and observed queued on that member lock (`pg_locks`, advisory, not
granted) while already holding the company key-share. The test releases its row either 100 ms or 1300 ms later, which decides
which transaction's `deadlock_timeout` fires first (and therefore which one PostgreSQL aborts). No outcome is decided by a sleep.

## Lock graph of the defect (before)

```
T_susp (A suspends owner B)                         T_write (owner B writes stock)
  0  company-members advisory (fair)        ✔
  2  member lock B  (exclusive)             ✔        1  companies  FOR KEY SHARE  ✔
  3  users rows A,B FOR UPDATE              ✔        2  member lock B (shared)    ⏳ waits for T_susp
     UPDATE users (B) → trigger:
  1! companies FOR UPDATE                   ⏳ waits for T_write's key-share     → cycle → 40P01
```
The trigger took step 1 (company row, exclusive) after steps 2 and 3. After the fix the trigger takes step 0 (already held: no
wait), so there is no edge from T_susp to T_write.

## Before → after

| Scenario | Before (Series 12 code) | After (Series 13) |
|---|---|---|
| Owner B writes stock while A suspends B — suspension detects the cycle (release +1300 ms) | suspension **503 AUTHORITY_BUSY** after 1026 ms; write 201; **deadlocks +1**; B still active | suspension 200 (+14 ms); write **401 ACCESS_REVOKED**, nothing written; deadlocks 0 |
| same — the write detects it (release +100 ms) | write **500**; suspension 200 after 935 ms; **deadlocks +1** | suspension 200 (+6 ms); write 401; deadlocks 0 |
| Owner B changes a Staff's warehouses while A suspends B | suspension **503**; grant 200; **deadlocks +1** | suspension 200; grant 401, Staff rows unchanged; deadlocks 0 |
| Owner suspension under a relay of other members' key-shares (`AUTHORITY_LOCK_TIMEOUT_MS=1500`) | **not finished while the relay ran; 8166 ms** (53 key-share handovers), finished only when the relay stopped: the 1.5 s timeout did **not** bound it | 200 in 11 ms while the relay ran |
| Reactivate a REMOVED member under the relay | **8162 ms**, unbounded the same way | 200 in 14 ms |
| Accept an invitation under the relay | **8344 ms**, unbounded the same way | 201 in 239 ms (incl. one bcrypt hash) |
| Three owners suspending each other in a ring + 6 concurrent writes, 6 rounds | **a 5xx in the first round** (test failed at "no 5xx"; log `stockmind_gate_s13_n1_before.log`) | 6 rounds: 0 5xx, 0 503, an owner always remains, deadlocks 0 |
| Another company holds its membership lock, company row and owner row | 200 in 10 ms (already independent) | 200 in 20 ms |
| SQL: demote the sole owner (`role='Staff'`) | **committed: 0 legitimate owners** | `owner_requires_admin_role`, 1 owner |
| SQL: demote an owner while another remains, keeping the flag / clearing it / then the last one | (not run before) | refused / committed / `last_active_owner` |
| SQL: a non-Admin row flagged owner does not count as the remaining owner | (test added later; same rule as above) | `last_active_owner` |
| SQL: a direct change waits for the application's membership lock (key given in UPPER case) | (n/a) | waits on the advisory key, then `last_active_owner` after re-check |
| SQL: two `REPEATABLE READ` sessions suspend the two owners | **both committed: 0 owners** | `owner_change_requires_read_committed` (both), 2 owners |
| SQL: two `SERIALIZABLE` sessions | second: `40001` (SSI) — already safe | unchanged (SSI), 1 owner |

**Classification:** N-1 = **CONFIRMED** (deterministic reproduction, both victims, deadlock counter, 5xx). Related findings
confirmed in the same investigation and fixed in the same series: **F13-02** unbounded wait of company-row `FOR UPDATE` under a
key-share stream (`lock_timeout` restarts per holder) affecting owner suspension, reactivation of a removed member and invitation
acceptance; **F13-03** sole owner demotable by direct SQL; **F13-04** `REPEATABLE READ` write skew on owners.

Migration evidence: `tests/integration/series13-owner-guard.migration.pg.spec.ts` (upgrade from the 12-migration Series 12 schema
with synthetic members: only `OwnerGuardLockOrder1792620000000` runs, member rows byte-identical; fresh 13-migration install has
the identical function and trigger; `down()` restores the Series 09 definitions exactly, `up()` again equals fresh).
