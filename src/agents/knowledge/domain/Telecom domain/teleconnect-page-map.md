<!-- triggers: telecom, broadband, teleconnect -->

# TeleConnect — Page Map (distilled DOM structure)

Per-page element keys (as in `TeleConnect.properties`), relationships, and the condition
that advances the flow. This is the useful part of a DOM snapshot without the noise.
Element keys map to `'TeleConnect.<Key>'` in feature files.

### Login / Register (`/login`)
- Login: `InputLoginEmail`, `InputLoginPassword` → `BtnLoginSubmit`.
- `BtnSwitchToRegister` toggles the register form ("Create an account").
- Register REUSES email/password (`InputRegisterEmail` = `login-email`,
  `InputRegisterPassword` = `login-password`) + `InputRegisterName` → `BtnRegisterSubmit`.
- Password rule: **min 6 characters**.
- Quick-login buttons (`BtnQuickLoginCrm/Installation/Activation`) are **staff/internal**, not the customer wizard.
- Advance: valid name + email + password (≥6) → navigates to `/customer`.

### Dashboard (`/customer`)
- Nav: `NavDashboard`, `NavOrders`, `NavNewOrder`; identity: `UserName`, `CustomerLogo`.
- Stats: `StatTotalOrders`, `StatInProgress`, `StatActivated`.
- Enter wizard: `NavNewOrder` ("New Connection") → `/customer/order`.

### Wizard common (`/customer/order`)
- `StepBadge` = "Step N of 6"; `StepIndicator` lists stages. `BtnNext` advances; `BtnBack` (disabled on Step 1).
- Verify `StepBadge` contains "Step N" BEFORE acting on that step.

### Step 1 — Customer Info
- Personal: `InputName`, `InputEmail`, `InputDob` (date), `SelectGender` (native select).
- Contact: `InputPhone` (required), `InputAltPhone` (optional).
- Address: `InputAddress` (textarea).
- Identity: `SelectIdType`, `InputIdNumber` (format must match ID Type), `UploadIdDocument` (optional).
- Advance: Name, Email, Phone, Address, ID Type, ID Number filled → `BtnNext`.

### Step 2 — Location (CASCADING)
- `SelectState` → `SelectCity` → `SelectArea` are dependent in order:
  City populates after State; Area populates after City.
- `InputPincode` is **auto-filled** from Area — do NOT type it.
- `InputInstallAddress` (textarea).
- Advance: State + City + Area selected in order → `BtnNext`.

### Step 3 — Plan (CARD SELECTION)
- Sibling cards: `PlanCardEntertainment` (~100 Mbps), `PlanCardWifiPhone` (~200 Mbps),
  `PlanCardWifiEntertainment` (~300 Mbps, POPULAR), `PlanCardAllInOne` (~1 Gbps).
- Select by CLICKING the card (not a dropdown). Advance: one card selected → `BtnNext`.

### Step 4 — Offers (OPTIONAL + DYNAMIC IDs)
- `OfferNone` = continue without discount (stable default).
- Offer cards carry **dynamic CUID ids** — prefer `OfferByName`
  (`contains(@data-testid,'offer-card')`) or `OfferNone` over an exact-id match.
- `PriceSummary` (Base / Final price) changes only when a discount is applied. Assert it
  visible; assert a discounted total only for a known offer amount.
- Advance: an offer OR `OfferNone` selected → `BtnNext`.

### Step 5 — Schedule
- `InputPreferredDate` (date, FUTURE, `YYYY-MM-DD`).
- Slot cards (choose one): `SlotMorning`, `SlotAfternoon`, `SlotEvening`.
- `InputSpecialInstructions` (textarea, optional).
- Advance: date + one slot → `BtnNext`.

### Step 6 — Confirm
- `BtnSubmitOrder` submits → Order Success renders.

### Order Success
- `OrderSuccess` panel; `OrderNumber` (pattern `BRD-<timestamp>-<seq>`); `ExpectedDate`.
- Assert these are **visible** — do NOT assert exact order number / date.

### Quick reference — dependencies & dynamic locators
| Concern | Rule |
|---------|------|
| Cascading selects | State → City → Area, in order (Step 2) |
| Auto-filled field | Pincode (Step 2) — never typed |
| Card selection | Plan (3), Offer (4), Slot (5) — click, not select |
| Dynamic ids | Offer cards use CUIDs → `contains()` / `OfferNone` |
| Generated values | Order number & date → assert visible, not exact |
| Step gating | Verify `StepBadge` "Step N" before acting |
