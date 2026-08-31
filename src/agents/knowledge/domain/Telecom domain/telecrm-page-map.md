<!-- triggers: telecrm, crm, telecom, order approval, order review -->

# TeleCRM — Page Map (back-office order approval)

Distilled structure for the CRM back-office app that reviews and approves ingested
customer orders. Element keys map to `'TeleCRM.<Key>'` in feature files (see
`TeleCRM.properties`). This is the staff-facing side of the telecom order lifecycle:
`Customer places order → CRM approval → Installation → Activation → Verification`.

### Key concept — order linkage
The CRM operates on an **existing** order created by the customer flow. The order is
found by its order id. In scenarios, that id is a cross-scenario variable
(`$$OrderId` / `$$OrderNumber`) captured and persisted during the customer order flow.
CRM does NOT create orders.

### Login (`/login` → CRM)
- `CRMButton` = quick-login-crm (staff entry, NOT customer registration).
- Click `CRMButton` then `LoginSubmit` → lands on the CRM dashboard.
- Verify `CRMHomePage` (crm-heading) is visible to confirm login.

### Dashboard / Find Order
- Orders are listed on the dashboard.
- Locate the order row containing `$$OrderId` before acting on it.

### Review (order detail)
- `CRMReview` (btn-start-review) opens review for the selected order.
- `CRMReviewNotes` (textarea) — enter review notes.
- `CRMReviewButton` (btn-confirm-review) submits the review.
- After review, `CRMApproveButton` becomes visible → advance to approval.

### Approve (checklist popup)
- `CRMApproveButton` (btn-approve) opens the approval popup.
- The popup contains verification checks that must ALL be confirmed before approval:
  - `CRMPopupCustomerID` — "Customer ID verified"
  - `CRMPopupAddress` — "Address is serviceable"
  - `CRMPopupPlanElig` — "Plan eligibility confirmed"
- `CRMPopupApproveOrder` (btn-confirm-approve) finalizes approval.
- Rule: approval should NOT complete until every checklist item is confirmed. A negative
  case can confirm only some checks and assert the order is NOT approved (status unchanged /
  approve button still present) — do NOT invent an error message.

### Status & Logout
- `CRMStatus` shows the order status. After a successful approval it reads `CRM APPROVED`.
- `CRMLogout` logs the operator out.

### Status transitions (assert exact status text)
| Action | Expected status |
|--------|-----------------|
| Order ingested from customer | (pre-CRM) PLACED / PENDING |
| CRM approval completed | **CRM APPROVED** |
| CRM rejection | CRM REJECTED |

- Status values are fixed labels → assert with `should have text 'CRM APPROVED'`
  (strong assertion), optionally with a color check if the app color-codes status.

### Negative / edge guidance (CRM)
- Approve with an incomplete checklist → order not approved (assert status not changed /
  popup still open); never guess the exact validation message.
- Review without notes (if notes are required) → review not confirmed.
- Acting on a non-existent order id → order row not found.
- Only assert specific messages/URLs confirmed from the live app or its source.
