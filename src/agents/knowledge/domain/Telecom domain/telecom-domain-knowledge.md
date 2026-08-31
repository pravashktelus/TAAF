<!-- triggers: telecom, broadband, teleconnect, telecrm, teleinstall, teleactivate, televerify -->

# Telecom Domain Knowledge — Core

Domain knowledge for automating telecom / broadband apps (e.g. TeleConnect — retail
broadband order management). Use it for domain-aware test cases and assertions.
(Companion files in this folder: data & validation, page map.)

---

## Actors / Roles

| Role | Description | App |
|------|-------------|-----|
| Customer | Registers and places broadband orders | Customer portal (self-service) |
| CRM Agent | Reviews and approves/rejects orders | CRM (back office) |
| Installation Engineer | Schedules + completes installation | Installation app |
| Activation Engineer | Activates the connection | Activation app |
| Verification Officer | Verifies KYC / final checks | Verification app |

---

## Order Lifecycle (Order-to-Activation Journey)

A **hand-off chain** — each stage depends on the previous:

```
Customer places order → CRM approval → Installation → Activation → Verification / live
```

| Stage | Owner | Entry State | Exit State |
|-------|-------|-------------|------------|
| Order Placement | Customer | (none) | PLACED / PENDING |
| Order Approval | CRM Agent | PLACED | APPROVED / REJECTED |
| Installation | Install Engineer | APPROVED | INSTALLED |
| Activation | Activation Engineer | INSTALLED | ACTIVATED |
| Verification | Verification Officer | ACTIVATED | VERIFIED / LIVE |

**Dependency chain:** the order number created in the customer flow flows through every
downstream app. Capture it at placement and reuse it (`store` + `persist` → `$$OrderNumber`)
in CRM / Install / Activate / Verify scenarios.

---

## Broadband Order Wizard (Customer Portal) — overview

A new connection is placed via a **6-step wizard** with a "Step N of 6" indicator and
Back/Continue navigation.

| Step | Name | Purpose |
|------|------|---------|
| 1 | Customer Info | Personal + contact + ID details |
| 2 | Location | Installation location (cascading selects) |
| 3 | Plan | Choose a broadband plan |
| 4 | Offers | Optional discount/offer |
| 5 | Schedule | Installation date + time slot |
| 6 | Confirm | Review + submit |
| ✓ | Success | Order number (BRD-...), Expected Date |

**Wizard rules:** verify the step indicator before acting on a step; selects in Step 2
are cascading (State → City → Area); the success order number follows a prefix pattern
(`BRD-<timestamp>-<seq>`) — assert it is visible, not an exact value.

---

## Back-Office Apps (CRM / Installation / Activation / Verification)

- **Staff-facing** — reached via dedicated/quick-login, not customer registration.
- Operate on an **existing** order (by order number) — they do not create orders.
- Typical flow: search order by number → open → review → change status
  (Approve/Reject/Schedule/Install/Activate/Verify) → verify the status transition.
- The order number captured from the customer flow is the linking key across all four.
